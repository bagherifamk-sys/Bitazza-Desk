"""
Email-specific database operations.

Handles:
- email_threads table (per-message log)
- email_verification_tokens table
- email_csat_tokens table
- Attachment storage path records (stored in email_threads.attachments JSONB)
"""

import hashlib
import hmac
import json
import logging
import secrets
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta

import psycopg2
import psycopg2.extras

from config import settings

logger = logging.getLogger(__name__)

DATABASE_URL: str = settings.DATABASE_URL
CSAT_TOKEN_SECRET: str = getattr(settings, "CSAT_TOKEN_SECRET", "dev-csat-secret-change-in-prod")
VERIFICATION_EXPIRY_HOURS: int = int(getattr(settings, "EMAIL_VERIFICATION_EXPIRY_HOURS", 24))
CSAT_EXPIRY_DAYS: int = 7


@contextmanager
def _conn():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        logger.exception("DB transaction failed — rolling back")
        conn.rollback()
        raise
    finally:
        conn.close()


# ── email_threads ─────────────────────────────────────────────────────────────

def log_email_message(
    *,
    ticket_id: str,
    gmail_thread_id: str,
    gmail_message_id: str,
    direction: str,           # 'inbound' | 'outbound'
    from_email: str,
    from_name: str,
    subject: str,
    snippet: str,
    attachments: list[dict],  # [{filename, mime_type, size_bytes, storage_url}]
    raw_headers: dict,
) -> str:
    """Insert a row into email_threads. Returns the row ID."""
    row_id = str(uuid.uuid4())
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO email_threads
                (id, ticket_id, gmail_thread_id, gmail_message_id, direction,
                 from_email, from_name, subject, snippet, attachments, raw_headers)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            ON CONFLICT (gmail_message_id) DO NOTHING
        """, (
            row_id, ticket_id, gmail_thread_id, gmail_message_id, direction,
            from_email, from_name, subject, snippet,
            json.dumps(attachments), json.dumps(raw_headers),
        ))
    return row_id


def get_email_thread(ticket_id: str) -> list[dict]:
    """Return all email_threads rows for a ticket, ordered oldest first."""
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM email_threads
            WHERE ticket_id = %s
            ORDER BY created_at ASC
        """, (ticket_id,))
        return [dict(r) for r in cur.fetchall()]


def email_message_already_processed(gmail_message_id: str) -> bool:
    """Check if this Gmail message has already been ingested (idempotency guard)."""
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM email_threads WHERE gmail_message_id = %s",
            (gmail_message_id,),
        )
        return cur.fetchone() is not None


def try_claim_gmail_message(gmail_message_id: str) -> bool:
    """
    Atomically claim a Gmail message for processing.
    Returns True if this call won the claim (proceed with processing).
    Returns False if another call already claimed it (skip — duplicate delivery).

    Uses INSERT ON CONFLICT so the claim is a single atomic DB operation,
    preventing the TOCTOU race where two concurrent webhook calls both pass
    the email_message_already_processed() pre-check before either logs the row.
    """
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO email_processing_claims (gmail_message_id, claimed_at)
            VALUES (%s, NOW())
            ON CONFLICT (gmail_message_id) DO NOTHING
            RETURNING gmail_message_id
        """, (gmail_message_id,))
        return cur.fetchone() is not None


# ── Attachment storage ────────────────────────────────────────────────────────

def build_attachment_record(
    *,
    filename: str,
    mime_type: str,
    size_bytes: int,
    storage_path: str,
    gmail_attachment_id: str,
    scanned: bool = False,
    scan_clean: bool = False,
) -> dict:
    """Build the JSONB dict stored in email_threads.attachments."""
    return {
        "filename": filename,
        "mime_type": mime_type,
        "size_bytes": size_bytes,
        "storage_path": storage_path,
        "gmail_attachment_id": gmail_attachment_id,
        "scanned": scanned,
        "scan_clean": scan_clean,
    }


# ── email_verification_tokens ─────────────────────────────────────────────────

def create_verification_token(ticket_id: str, from_email: str) -> str:
    """
    Generate a signed one-time verification token and store it.
    Returns the token string (to be embedded in the verification URL).
    """
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=VERIFICATION_EXPIRY_HOURS)

    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO email_verification_tokens
                (token, ticket_id, from_email, expires_at)
            VALUES (%s, %s, %s, %s)
        """, (token, ticket_id, from_email, expires_at))

    logger.info("Created verification token for ticket=%s email=%s", ticket_id, from_email)
    return token


def consume_verification_token(token: str, user_id: str) -> dict | None:
    """
    Validate and consume a verification token.
    Returns the token row dict on success, None if invalid/expired/used.
    Marks the token as used and records the verified user_id.
    """
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM email_verification_tokens
            WHERE token = %s
              AND used_at IS NULL
              AND expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        if not row:
            return None

        cur.execute("""
            UPDATE email_verification_tokens
            SET used_at = NOW(), verified_user_id = %s
            WHERE token = %s
        """, (user_id, token))

    logger.info("Verification token consumed: ticket=%s user_id=%s", row["ticket_id"], user_id)
    return dict(row)


def get_pending_verification_tickets(older_than_hours: int = 24) -> list[dict]:
    """
    Return tickets with an unconsumed, expired verification token.
    Used by auto_transitions to escalate timed-out identity verifications.
    """
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT t.token, t.ticket_id, t.from_email, t.expires_at
            FROM email_verification_tokens t
            WHERE t.used_at IS NULL
              AND t.expires_at < NOW()
        """)
        return [dict(r) for r in cur.fetchall()]


# ── email_csat_tokens ─────────────────────────────────────────────────────────

def _sign_csat_token(token: str, ticket_id: str, score: int) -> str:
    """HMAC-sign the token so score can't be tampered with in the URL."""
    msg = f"{token}:{ticket_id}:{score}".encode()
    return hmac.new(CSAT_TOKEN_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def create_csat_tokens(ticket_id: str) -> dict[int, str]:
    """
    Generate one signed token per star rating (1–5).
    Stores all in email_csat_tokens. Returns {score: token} dict.
    """
    tokens: dict[int, str] = {}
    expires_at = datetime.now(timezone.utc) + timedelta(days=CSAT_EXPIRY_DAYS)

    with _conn() as conn:
        cur = conn.cursor()
        for score in range(1, 6):
            token = secrets.token_urlsafe(24)
            cur.execute("""
                INSERT INTO email_csat_tokens (token, ticket_id, score, expires_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (token, ticket_id, score, expires_at))
            tokens[score] = token

    return tokens


def consume_csat_token(ticket_id: str, score: int, token: str) -> bool:
    """
    Validate and consume a CSAT token. Updates tickets.csat_score on success.
    Returns True if valid and recorded, False otherwise.
    """
    if score not in range(1, 6):
        return False

    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM email_csat_tokens
            WHERE token = %s
              AND ticket_id = %s
              AND score = %s
              AND used_at IS NULL
              AND expires_at > NOW()
        """, (token, ticket_id, score))
        row = cur.fetchone()
        if not row:
            return False

        cur.execute(
            "UPDATE email_csat_tokens SET used_at = NOW() WHERE token = %s",
            (token,),
        )
        cur.execute(
            "UPDATE tickets SET csat_score = %s, updated_at = NOW() WHERE id = %s",
            (score, ticket_id),
        )

    logger.info("CSAT recorded: ticket=%s score=%d", ticket_id, score)
    return True
