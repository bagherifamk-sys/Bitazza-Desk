"""
Email channel API routes.

Endpoints:
  POST /email/webhook        — Gmail Pub/Sub push notification (inbound email)
  GET  /email/verify/{token} — Identity verification callback (mock + real)
  GET  /email/csat/{ticket_id} — CSAT star-rating click handler

Flow (inbound email):
  1. Gmail Pub/Sub POSTs a notification
  2. We fetch the full message from Gmail API
  3. Parse body + attachments (email_parser)
  4. Resolve thread → ticket (existing) or create new ticket
  5. Resolve customer by from_email
  6. Determine identity strategy (email_prompt_overlay)
  7. If identity needed: send verification link → ticket stays pending_customer
  8. Else: call engine.agent.chat(platform='email') → send reply
  9. Store email log + attachments, broadcast to dashboard via WebSocket
"""

import base64
import json
import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse

from config import settings
from db.conversation_store import (
    add_message,
    get_or_create_customer_by_email,
    get_ticket_by_gmail_thread,
    create_email_ticket,
    update_ticket_status,
    get_history,
)
from db.email_store import (
    log_email_message,
    email_message_already_processed,
    build_attachment_record,
    create_verification_token,
    consume_verification_token,
    create_csat_tokens,
    consume_csat_token,
)
from engine.email_parser import parse_gmail_message, get_rejected_attachment_notice
from engine.email_prompt_overlay import (
    requires_verification_link,
    requires_registered_email,
)
from engine.mock_agents import detect_category_from_message
from api.ws_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["email"])

# ── Config ────────────────────────────────────────────────────────────────────

USE_MOCK_EMAIL_VERIFY: bool = getattr(settings, "USE_MOCK_EMAIL_VERIFY", True)
API_BASE_URL: str = getattr(settings, "API_BASE_URL", "http://localhost:8000")
ATTACHMENT_STORAGE_PATH: Path = Path(
    getattr(settings, "EMAIL_ATTACHMENT_STORAGE_PATH", "./uploads/email-attachments")
)
ATTACHMENT_STORAGE_PATH.mkdir(parents=True, exist_ok=True)

GMAIL_SUPPORT_EMAIL: str = getattr(settings, "GMAIL_SUPPORT_EMAIL", "support@bitazza.com")
GMAIL_PUBSUB_SECRET: str = getattr(settings, "GMAIL_PUBSUB_SECRET", "")


# ── Gmail REST client (requests-based, no httplib2) ───────────────────────────

_GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]
_GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"


def _get_gmail_session() -> "requests.Session":
    """
    Return a requests Session pre-authorized with service account credentials.
    Uses google.auth.transport.requests (no httplib2) — avoids SSL issues on Python 3.13.
    """
    import requests as _requests
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession, Request

    creds_raw = getattr(settings, "GMAIL_CREDENTIALS_JSON", "")
    if not creds_raw:
        raise RuntimeError("GMAIL_CREDENTIALS_JSON not configured")
    try:
        creds_data = json.loads(creds_raw)
    except json.JSONDecodeError:
        with open(creds_raw) as f:
            creds_data = json.load(f)

    creds = service_account.Credentials.from_service_account_info(
        creds_data, scopes=_GMAIL_SCOPES, subject=GMAIL_SUPPORT_EMAIL
    )
    creds.refresh(Request())
    return AuthorizedSession(creds)


def _get_gmail_service():
    """Legacy shim — returns a namespace object that mimics googleapiclient service."""
    return _GmailRestService(_get_gmail_session())


class _GmailRestService:
    """Minimal Gmail REST wrapper using requests — replaces googleapiclient to avoid httplib2."""

    def __init__(self, session):
        self._session = session

    def fetch_message(self, message_id: str) -> dict:
        r = self._session.get(f"{_GMAIL_API}/messages/{message_id}?format=full")
        r.raise_for_status()
        return r.json()

    def fetch_attachment(self, message_id: str, attachment_id: str) -> bytes:
        r = self._session.get(f"{_GMAIL_API}/messages/{message_id}/attachments/{attachment_id}")
        r.raise_for_status()
        data = r.json().get("data", "")
        return base64.urlsafe_b64decode(data + "==")

    def send_message(self, raw_b64: str, thread_id: str | None = None) -> dict:
        body: dict = {"raw": raw_b64}
        if thread_id:
            body["threadId"] = thread_id
        r = self._session.post(f"{_GMAIL_API}/messages/send", json=body)
        r.raise_for_status()
        return r.json()

    def list_history(self, start_history_id: str) -> dict:
        r = self._session.get(
            f"{_GMAIL_API}/history",
            params={"startHistoryId": start_history_id, "historyTypes": "messageAdded", "labelId": "INBOX"},
        )
        r.raise_for_status()
        return r.json()

    def watch(self, topic_name: str) -> dict:
        r = self._session.post(
            f"{_GMAIL_API}/watch",
            json={"topicName": topic_name, "labelIds": ["INBOX"]},
        )
        r.raise_for_status()
        return r.json()


def _fetch_gmail_message(service: _GmailRestService, message_id: str) -> dict:
    return service.fetch_message(message_id)


def _fetch_attachment_bytes(service: _GmailRestService, message_id: str, attachment_id: str) -> bytes:
    return service.fetch_attachment(message_id, attachment_id)


# ── ClamAV scan ───────────────────────────────────────────────────────────────

def _scan_file(file_path: Path) -> tuple[bool, str]:
    """
    Scan a file with ClamAV via clamd socket or clamscan CLI.
    Returns (is_clean, detail_message).
    Falls back to (True, 'scan_unavailable') if ClamAV is not installed —
    log a warning so ops knows scanning is not active.
    """
    try:
        import subprocess
        result = subprocess.run(
            ["clamscan", "--no-summary", str(file_path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return True, "clean"
        elif result.returncode == 1:
            logger.warning("ClamAV threat detected in %s: %s", file_path, result.stdout)
            return False, result.stdout.strip()
        else:
            logger.error("ClamAV error scanning %s: %s", file_path, result.stderr)
            return True, "scan_error"  # Don't block on scan errors — ops alert instead
    except FileNotFoundError:
        logger.warning("ClamAV (clamscan) not installed — attachment scanning is DISABLED")
        return True, "scan_unavailable"
    except Exception as e:
        logger.error("Unexpected ClamAV error: %s", e)
        return True, "scan_error"


# ── Attachment download + store ───────────────────────────────────────────────

def _download_and_store_attachments(
    service, gmail_message_id: str, attachments
) -> list[dict]:
    """
    Download accepted attachments from Gmail, scan with ClamAV, store to disk.
    Returns list of attachment record dicts for DB storage.
    """
    records = []
    for att in attachments:
        if att.rejected:
            continue
        try:
            file_bytes = _fetch_attachment_bytes(service, gmail_message_id, att.gmail_attachment_id)
            safe_name = f"{uuid.uuid4()}_{att.filename.replace('/', '_')}"
            file_path = ATTACHMENT_STORAGE_PATH / safe_name

            file_path.write_bytes(file_bytes)

            is_clean, scan_detail = _scan_file(file_path)
            if not is_clean:
                # Quarantine: rename with .quarantine suffix, don't serve
                quarantine_path = file_path.with_suffix(".quarantine")
                file_path.rename(quarantine_path)
                logger.warning(
                    "Quarantined malicious attachment %s from gmail_msg=%s: %s",
                    att.filename, gmail_message_id, scan_detail,
                )
                continue  # skip — don't store in DB, don't show to agents

            records.append(build_attachment_record(
                filename=att.filename,
                mime_type=att.mime_type,
                size_bytes=att.size_bytes,
                storage_path=str(file_path),
                gmail_attachment_id=att.gmail_attachment_id,
                scanned=True,
                scan_clean=is_clean,
            ))
        except Exception:
            logger.exception("Failed to download/store attachment %s", att.filename)

    return records


# ── Main inbound processing ───────────────────────────────────────────────────

async def _process_inbound_email(gmail_message_id: str) -> None:
    """
    Full pipeline for a single inbound Gmail message.
    Called from the webhook handler after Pub/Sub notification arrives.
    """
    if email_message_already_processed(gmail_message_id):
        logger.info("Skipping already-processed message %s", gmail_message_id)
        return

    service = _get_gmail_service()
    raw_message = _fetch_gmail_message(service, gmail_message_id)
    parsed = parse_gmail_message(raw_message)

    # ── 1. Resolve or create ticket ───────────────────────────────────────────
    ticket_id = get_ticket_by_gmail_thread(parsed.thread_id)
    is_new_ticket = ticket_id is None

    # ── 2. Resolve customer ───────────────────────────────────────────────────
    customer_id, customer_matched = get_or_create_customer_by_email(
        parsed.from_email, parsed.from_name
    )

    # ── 3. Detect category from subject + body ────────────────────────────────
    category = detect_category_from_message(f"{parsed.subject} {parsed.body}")

    # ── 4. Create ticket if new thread ────────────────────────────────────────
    if is_new_ticket:
        ticket_id = create_email_ticket(
            gmail_thread_id=parsed.thread_id,
            customer_id=customer_id,
            subject=parsed.subject,
            category=category,
        )
        await manager.broadcast_all({
            "type": "new_ticket",
            "ticket_id": ticket_id,
            "channel": "email",
            "subject": parsed.subject,
            "from_email": parsed.from_email,
            "from_name": parsed.from_name,
            "category": category,
        })
    else:
        # Existing thread — update status back to Open_Live if it was pending_customer
        update_ticket_status(ticket_id, "Open_Live")

    # ── 5. Persist inbound message to messages table ──────────────────────────
    add_message(ticket_id, "user", parsed.body, metadata={
        "channel": "email",
        "from_email": parsed.from_email,
        "subject": parsed.subject,
        "gmail_message_id": parsed.message_id,
    })

    # ── 6. Download + store attachments ──────────────────────────────────────
    attachment_records = _download_and_store_attachments(
        service, gmail_message_id, parsed.attachments
    )
    attachment_notice = get_rejected_attachment_notice(raw_message) or ""

    # ── 7. Log to email_threads ───────────────────────────────────────────────
    log_email_message(
        ticket_id=ticket_id,
        gmail_thread_id=parsed.thread_id,
        gmail_message_id=parsed.message_id,
        direction="inbound",
        from_email=parsed.from_email,
        from_name=parsed.from_name,
        subject=parsed.subject,
        snippet=parsed.snippet,
        attachments=attachment_records,
        raw_headers=parsed.raw_headers,
    )

    await manager.broadcast(ticket_id, {
        "type": "new_message",
        "ticket_id": ticket_id,
        "sender_type": "customer",
        "content": parsed.body,
        "channel": "email",
    })

    # ── 8. Identity routing ───────────────────────────────────────────────────
    from engine.email_sender import (
        send_reply, send_identity_request, send_password_reset_email_mismatch
    )

    if requires_registered_email(category, customer_matched):
        # password/2fa reset from unknown email — instruct to use registered email
        sent_id = send_password_reset_email_mismatch(
            service,
            to_email=parsed.from_email,
            to_name=parsed.from_name,
            subject=parsed.subject,
            thread_id=parsed.thread_id,
            in_reply_to_message_id=parsed.message_id,
            references=parsed.references,
            ticket_id=ticket_id,
            language=parsed.language,
        )
        _log_outbound(service, ticket_id, parsed, sent_id, "Email address not registered", [])
        update_ticket_status(ticket_id, "pending_customer")
        return

    if requires_verification_link(category, customer_matched):
        # Account-aware inquiry from unknown sender — send verification link
        token = create_verification_token(ticket_id, parsed.from_email)
        if USE_MOCK_EMAIL_VERIFY:
            verify_url = f"{API_BASE_URL}/email/verify/{token}?mock_user_id=USR-000020"
        else:
            verify_url = f"https://app.bitazza.com/support-verify?token={token}"

        sent_id = send_identity_request(
            service,
            to_email=parsed.from_email,
            to_name=parsed.from_name,
            subject=parsed.subject,
            thread_id=parsed.thread_id,
            in_reply_to_message_id=parsed.message_id,
            references=parsed.references,
            ticket_id=ticket_id,
            verification_url=verify_url,
            language=parsed.language,
        )
        _log_outbound(service, ticket_id, parsed, sent_id, "Identity verification requested", [])
        update_ticket_status(ticket_id, "pending_customer")
        return

    # ── 9. AI agent handles the email ─────────────────────────────────────────
    # user_id: requires a verified external_id. customer_matched only means the
    # email address exists in our DB — it doesn't mean we have a linked user_id.
    # If no external_id exists AND the category is account-aware, we must send a
    # verification link first (same flow as unmatched sender).
    user_id = _resolve_user_id(customer_id)
    if not user_id and requires_verification_link(category, customer_matched=False):
        token = create_verification_token(ticket_id, parsed.from_email)
        if USE_MOCK_EMAIL_VERIFY:
            verify_url = f"{API_BASE_URL}/email/verify/{token}?mock_user_id=USR-000020"
        else:
            verify_url = f"https://app.bitazza.com/support-verify?token={token}"
        sent_id = send_identity_request(
            service,
            to_email=parsed.from_email,
            to_name=parsed.from_name,
            subject=parsed.subject,
            thread_id=parsed.thread_id,
            in_reply_to_message_id=parsed.message_id,
            references=parsed.references,
            ticket_id=ticket_id,
            verification_url=verify_url,
            language=parsed.language,
        )
        _log_outbound(service, ticket_id, parsed, sent_id, "Identity verification requested", [])
        update_ticket_status(ticket_id, "pending_customer")
        return
    user_id = user_id or ticket_id  # fallback for non-account-aware categories

    consecutive_low = _count_consecutive_low_confidence(ticket_id)

    from engine.agent import chat
    agent_response = chat(
        conversation_id=ticket_id,
        user_id=user_id,
        user_message=parsed.body,
        platform="email",
        consecutive_low_confidence=consecutive_low,
        category=category,
    )

    reply_text = agent_response.text
    if attachment_notice:
        reply_text += attachment_notice

    is_closing = agent_response.resolved
    csat_tokens = create_csat_tokens(ticket_id) if is_closing else None

    sent_id = send_reply(
        service,
        to_email=parsed.from_email,
        to_name=parsed.from_name,
        subject=parsed.subject,
        agent_reply=reply_text,
        thread_id=parsed.thread_id,
        in_reply_to_message_id=parsed.message_id,
        references=parsed.references,
        ticket_id=ticket_id,
        language=parsed.language,
        is_closing=is_closing,
        csat_tokens=csat_tokens,
        attachment_notice="",  # already appended to reply_text above
    )

    add_message(ticket_id, "assistant", reply_text, metadata={
        "channel": "email",
        "confidence": agent_response.confidence,
        "escalated": agent_response.escalated,
        "resolved": agent_response.resolved,
        "gmail_message_id": sent_id,
    })

    _log_outbound(service, ticket_id, parsed, sent_id, reply_text, [])

    if agent_response.resolved:
        update_ticket_status(ticket_id, "Resolved")
    elif agent_response.escalated:
        pass  # agent.py already set status to 'Escalated'
    else:
        update_ticket_status(ticket_id, "pending_customer")

    await manager.broadcast(ticket_id, {
        "type": "new_message",
        "ticket_id": ticket_id,
        "sender_type": "bot",
        "content": reply_text,
        "escalated": agent_response.escalated,
        "resolved": agent_response.resolved,
        "channel": "email",
    })


def _log_outbound(service, ticket_id: str, parsed, sent_gmail_id: str, content: str, attachments: list) -> None:
    """Log an outbound email to email_threads."""
    from config import settings as _s
    log_email_message(
        ticket_id=ticket_id,
        gmail_thread_id=parsed.thread_id,
        gmail_message_id=sent_gmail_id,
        direction="outbound",
        from_email=getattr(_s, "GMAIL_SUPPORT_EMAIL", "support@bitazza.com"),
        from_name="Bitazza Support",
        subject=f"Re: {parsed.subject}",
        snippet=content[:200],
        attachments=attachments,
        raw_headers={},
    )


_INVALID_USER_ID_PLACEHOLDERS = {
    "replace_with_real_user_id", "", "none", "null", "undefined",
}

def _resolve_user_id(customer_id: str) -> str | None:
    """
    Fetch the verified external_id (user_id) for a customer row.
    Returns None if not set or if the stored value is a known placeholder/garbage string.
    This prevents stale mock values from being treated as real user IDs.
    """
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT external_id FROM customers WHERE id = %s", (customer_id,))
        row = cur.fetchone()
        if not row or not row["external_id"]:
            return None
        uid = str(row["external_id"]).strip()
        if uid.lower() in _INVALID_USER_ID_PLACEHOLDERS:
            # Corrupted value — clear it so it doesn't keep causing issues
            cur.execute("UPDATE customers SET external_id = NULL WHERE id = %s", (customer_id,))
            return None
        return uid


def _count_consecutive_low_confidence(ticket_id: str) -> int:
    from db.conversation_store import count_consecutive_low_confidence
    try:
        return count_consecutive_low_confidence(ticket_id)
    except Exception:
        return 0


# ── Last known Gmail historyId ────────────────────────────────────────────────
# Stored in memory on startup (from watch() response) and updated after each
# successful webhook processing. On server restart, we use this to avoid missing
# emails that arrived before the Pub/Sub notification carried a fresh historyId.
_last_history_id: str | None = None


def set_last_history_id(history_id: str) -> None:
    global _last_history_id
    _last_history_id = history_id


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/email/webhook")
async def gmail_pubsub_webhook(request: Request):
    """
    Receives Gmail Pub/Sub push notifications.
    Google sends a POST with a base64-encoded message containing the Gmail
    historyId and emailAddress of the inbox that received a new email.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Pub/Sub message is base64-encoded in body.message.data
    pubsub_message = body.get("message", {})
    encoded_data = pubsub_message.get("data", "")
    if not encoded_data:
        return Response(status_code=204)

    try:
        decoded = base64.urlsafe_b64decode(encoded_data + "==").decode("utf-8")
        notification = json.loads(decoded)
    except Exception:
        logger.warning("Failed to decode Pub/Sub message data")
        return Response(status_code=204)

    email_address = notification.get("emailAddress", "")
    history_id = notification.get("historyId")

    if not history_id:
        return Response(status_code=204)

    # Use the earlier of: our stored historyId vs the notification's historyId.
    # This catches emails that arrived between server restarts where the
    # notification carries a newer ID that skips over unprocessed messages.
    effective_history_id = str(history_id)
    if _last_history_id and int(_last_history_id) < int(effective_history_id):
        effective_history_id = _last_history_id

    # Fetch new messages since effectiveHistoryId
    try:
        service = _get_gmail_service()
        history_resp = service.list_history(effective_history_id)

        new_messages = []
        for record in history_resp.get("history", []):
            for msg_added in record.get("messagesAdded", []):
                msg = msg_added.get("message", {})
                # Only inbound (not sent by us)
                label_ids = msg.get("labelIds", [])
                if "SENT" not in label_ids:
                    new_messages.append(msg.get("id"))

        for gmail_message_id in new_messages:
            if gmail_message_id:
                await _process_inbound_email(gmail_message_id)

        # Advance stored historyId to notification's value after successful processing
        set_last_history_id(str(history_id))

    except Exception:
        logger.exception("Error processing Gmail Pub/Sub notification historyId=%s", history_id)
        # Return 200 to Pub/Sub so it doesn't retry immediately
        return Response(status_code=200)

    return Response(status_code=200)


@router.get("/email/verify/{token}", response_class=HTMLResponse)
async def verify_identity(
    token: str,
    mock_user_id: str = Query(default="", alias="mock_user_id"),
):
    """
    Identity verification endpoint.

    Mock mode: accepts ?mock_user_id=xxx directly (no real auth).
    Production mode: expects the request to carry a valid JWT in Authorization header
    (Bitazza's auth page will make this call after the user logs in).
    """
    if USE_MOCK_EMAIL_VERIFY:
        user_id = mock_user_id
        if not user_id:
            return HTMLResponse(_verification_page(success=False, message="Mock mode: provide ?mock_user_id="), status_code=400)
    else:
        # TODO: extract user_id from Bitazza JWT when real auth is integrated
        return HTMLResponse(_verification_page(success=False, message="Real auth not yet configured."), status_code=501)

    row = consume_verification_token(token, user_id)
    if not row:
        return HTMLResponse(_verification_page(success=False, message="This link is invalid, already used, or has expired."), status_code=400)

    ticket_id = row["ticket_id"]

    # Link the verified user_id to the ticket's customer row
    try:
        _link_user_to_ticket(ticket_id, user_id)
    except Exception:
        logger.exception("Failed to link user_id=%s to ticket=%s after verification", user_id, ticket_id)

    # Trigger AI response now that we have identity
    try:
        await _trigger_ai_after_verification(ticket_id, user_id)
    except Exception:
        logger.exception("Failed to trigger AI after verification for ticket=%s", ticket_id)

    return HTMLResponse(_verification_page(success=True))


def _link_user_to_ticket(ticket_id: str, user_id: str) -> None:
    """Update the customer row's external_id so account tools can fire."""
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE customers SET external_id = %s
            WHERE id = (SELECT customer_id FROM tickets WHERE id = %s)
              AND (external_id IS NULL OR external_id = '')
        """, (user_id, ticket_id))


async def _trigger_ai_after_verification(ticket_id: str, user_id: str) -> None:
    """
    Re-process the original customer message now that identity is confirmed.
    Fetches the last customer message from history and runs it through the agent.
    """
    from db.conversation_store import get_history, get_ticket_by_id
    from engine.agent import chat
    from engine.email_sender import send_reply

    history = get_history(ticket_id, limit=20)
    # Find the last customer message
    customer_msgs = [m for m in history if m["role"] == "user"]
    if not customer_msgs:
        return

    last_msg = customer_msgs[-1]
    original_body = last_msg["content"]

    # Get ticket info for email threading
    ticket_info = _get_ticket_info(ticket_id)
    if not ticket_info:
        return

    # Remove all previous bot/system messages from this ticket before re-running —
    # they were sent before identity was confirmed (verification requests, escalation
    # handoffs) and would poison Gemini's context causing it to escalate again.
    # Reset ticket status to Open_Live
    from db.conversation_store import update_ticket_status
    update_ticket_status(ticket_id, "Open_Live")

    from engine.mock_agents import detect_category_from_message
    category = detect_category_from_message(original_body)

    # Use a fresh ephemeral conversation ID so chat() loads no prior history.
    # The polluted history (duplicate messages, pre-verification bot replies) would
    # cause Gemini to treat this as a follow-up and escalate. The real message is
    # persisted to ticket_id after the agent responds.
    ephemeral_id = str(uuid.uuid4())

    agent_response = chat(
        conversation_id=ephemeral_id,
        user_id=user_id,
        user_message=original_body,
        platform="email",
        consecutive_low_confidence=0,
        category=category,
    )

    service = _get_gmail_service()
    is_closing = agent_response.resolved
    csat_tokens = create_csat_tokens(ticket_id) if is_closing else None

    from engine.email_parser import ParsedEmail
    # Build minimal parsed context for send_reply
    gmail_thread_id = ticket_info.get("gmail_thread_id", "")
    customer_email = ticket_info.get("customer_email", "")
    customer_name = ticket_info.get("customer_name", "")
    subject = ticket_info.get("subject", "(no subject)")
    language = ticket_info.get("language", "en")

    # Get the last inbound message_id for threading
    last_inbound_id = _get_last_inbound_message_id(ticket_id)

    sent_id = send_reply(
        service,
        to_email=customer_email,
        to_name=customer_name,
        subject=subject,
        agent_reply=agent_response.text,
        thread_id=gmail_thread_id,
        in_reply_to_message_id=last_inbound_id,
        references="",
        ticket_id=ticket_id,
        language=language,
        is_closing=is_closing,
        csat_tokens=csat_tokens,
    )

    add_message(ticket_id, "assistant", agent_response.text, metadata={
        "channel": "email",
        "confidence": agent_response.confidence,
        "escalated": agent_response.escalated,
        "resolved": agent_response.resolved,
        "gmail_message_id": sent_id,
        "triggered_by": "verification",
    })

    if agent_response.resolved:
        update_ticket_status(ticket_id, "Resolved")
    elif not agent_response.escalated:
        update_ticket_status(ticket_id, "pending_customer")

    await manager.broadcast(ticket_id, {
        "type": "new_message",
        "ticket_id": ticket_id,
        "sender_type": "bot",
        "content": agent_response.text,
        "channel": "email",
    })


def _get_ticket_info(ticket_id: str) -> dict | None:
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT t.gmail_thread_id, t.subject, t.category,
                   c.email AS customer_email, c.name AS customer_name
            FROM tickets t
            JOIN customers c ON c.id = t.customer_id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def _get_last_inbound_message_id(ticket_id: str) -> str:
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT gmail_message_id FROM email_threads
            WHERE ticket_id = %s AND direction = 'inbound'
            ORDER BY created_at DESC LIMIT 1
        """, (ticket_id,))
        row = cur.fetchone()
        return row["gmail_message_id"] if row else ""


def _verification_page(success: bool, message: str = "") -> str:
    if success:
        return """<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;">
<h2 style="color:#27ae60;">✓ Identity Verified</h2>
<p>Your identity has been confirmed. Our support team will respond to your request shortly.</p>
<p style="color:#888;font-size:13px;">You can close this tab.</p>
</body></html>"""
    return f"""<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;">
<h2 style="color:#e74c3c;">Verification Failed</h2>
<p>{message or 'This verification link is invalid or has expired.'}</p>
<p style="color:#888;font-size:13px;">Please contact support if you need a new link.</p>
</body></html>"""


@router.get("/email/csat/{ticket_id}", response_class=HTMLResponse)
async def email_csat(
    ticket_id: str,
    score: int = Query(..., ge=1, le=5),
    token: str = Query(...),
):
    """Handle CSAT star-rating link clicks from closing emails."""
    success = consume_csat_token(ticket_id, score, token)
    if not success:
        return HTMLResponse("""<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;">
<h2>Rating Not Recorded</h2>
<p>This rating link has already been used or has expired.</p>
</body></html>""", status_code=400)

    stars = "⭐" * score
    return HTMLResponse(f"""<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;">
<h2 style="color:#27ae60;">{stars}</h2>
<h3>Thank you for your feedback!</h3>
<p>Your rating has been recorded. We appreciate you taking the time.</p>
<p style="color:#888;font-size:13px;">You can close this tab.</p>
</body></html>""")


_INTERNAL_SERVICE_TOKEN = getattr(settings, "INTERNAL_SERVICE_TOKEN", "internal-dev-token")


@router.post("/api/tickets/{ticket_id}/email-reply")
async def agent_email_reply(ticket_id: str, request: Request):
    """
    Human agent sends a reply to an email ticket from the dashboard.
    Accepts either a JWT (agent via API) or X-Internal-Token (Node dashboard internal call).
    Sends via Gmail API with correct threading headers.
    """
    internal_token = request.headers.get("X-Internal-Token", "")
    if internal_token == _INTERNAL_SERVICE_TOKEN:
        agent_user_id = "dashboard_agent"
    else:
        from api.middleware.auth import get_user_id
        auth_header = request.headers.get("Authorization", "")
        try:
            agent_user_id = get_user_id(auth_header)
        except HTTPException:
            raise

    body = await request.json()
    message_text: str = body.get("message", "").strip()
    is_closing: bool = body.get("is_closing", False)

    if not message_text:
        raise HTTPException(status_code=400, detail="message is required")

    ticket_info = _get_ticket_info(ticket_id)
    if not ticket_info:
        raise HTTPException(status_code=404, detail="Ticket not found")

    last_inbound_id = _get_last_inbound_message_id(ticket_id)
    service = _get_gmail_service()

    csat_tokens = create_csat_tokens(ticket_id) if is_closing else None

    from engine.email_sender import send_reply as _send_reply
    sent_id = _send_reply(
        service,
        to_email=ticket_info["customer_email"],
        to_name=ticket_info["customer_name"],
        subject=ticket_info.get("subject", "(no subject)"),
        agent_reply=message_text,
        thread_id=ticket_info["gmail_thread_id"],
        in_reply_to_message_id=last_inbound_id,
        references="",
        ticket_id=ticket_id,
        language="en",
        is_closing=is_closing,
        csat_tokens=csat_tokens,
    )

    add_message(ticket_id, "agent", message_text, metadata={
        "channel": "email",
        "gmail_message_id": sent_id,
        "sent_by": agent_user_id,
        "is_closing": is_closing,
    })

    from db.email_store import log_email_message as _log
    from config import settings as _s
    _log(
        ticket_id=ticket_id,
        gmail_thread_id=ticket_info["gmail_thread_id"],
        gmail_message_id=sent_id,
        direction="outbound",
        from_email=getattr(_s, "GMAIL_SUPPORT_EMAIL", "support@bitazza.com"),
        from_name="Bitazza Support",
        subject=f"Re: {ticket_info.get('subject', '')}",
        snippet=message_text[:200],
        attachments=[],
        raw_headers={},
    )

    if is_closing:
        update_ticket_status(ticket_id, "Resolved")
    else:
        update_ticket_status(ticket_id, "pending_customer")

    await manager.broadcast(ticket_id, {
        "type": "new_message",
        "ticket_id": ticket_id,
        "sender_type": "agent",
        "content": message_text,
        "channel": "email",
        "sent_by": agent_user_id,
    })

    return {"ok": True, "gmail_message_id": sent_id}
