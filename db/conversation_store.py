"""
Conversation and ticket state storage — PostgreSQL (shared with dashboard).

All widget conversations are written directly into the dashboard's PostgreSQL
schema (customers / tickets / messages tables), so the Node dashboard sees them
without any sync layer.

Requires: psycopg2-binary  (add to requirements.txt)
Env var:  DATABASE_URL  — same connection string used by the Node dashboard.
"""
import json, logging, time, uuid
from contextlib import contextmanager

import psycopg2

logger = logging.getLogger(__name__)
import psycopg2.extras
from config import settings

DATABASE_URL = settings.DATABASE_URL


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


def init_db() -> None:
    """No-op — schema is managed by the Node dashboard's migrate.js."""
    pass


# ── Helpers ──────────────────────────────────────────────────────────────────

def _role_to_sender_type(role: str) -> str:
    """Map widget roles to dashboard sender_type values."""
    return {
        "user": "customer",
        "assistant": "bot",
        "agent": "agent",
        "system": "system",
    }.get(role, role)


def _sender_type_to_role(sender_type: str) -> str:
    return {
        "customer": "user",
        "bot": "assistant",
        "agent": "agent",
        "system": "system",
        "internal_note": "agent",
        "whisper": "agent",
    }.get(sender_type, sender_type)


# ── Conversations / Customers ─────────────────────────────────────────────────

def _fetch_user_profile(user_id: str) -> dict:
    """
    Fetch user profile from the User/KYC API (mock or real).
    Returns an empty dict on any failure — customer creation continues without it.
    """
    import requests as _requests
    use_mock = settings.USE_MOCK_USER_API
    base = settings.USER_API_BASE_URL
    key  = settings.USER_API_KEY
    prefix = "/mock" if use_mock else ""
    try:
        r = _requests.get(
            f"{base}{prefix}/user",
            params={"user_id": user_id},
            headers={"Authorization": f"Bearer {key}"},
            timeout=3,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        logger.exception("Failed to fetch user profile for user_id=%s — continuing without it", user_id)
    return {}


def _ensure_customer(cur, user_id: str) -> str:
    """
    Look up a customer by their widget user_id.
    Creates one if it doesn't exist, enriching with real profile data from the
    User/KYC API so the dashboard shows name, email, tier, and KYC status.
    Returns the customer UUID.
    """
    cur.execute("SELECT id FROM customers WHERE external_id = %s", (user_id,))
    row = cur.fetchone()
    if row:
        return row["id"]

    # Fall back to name-tag lookup for rows created before external_id column existed
    tag = f"widget:{user_id}"
    cur.execute("SELECT id FROM customers WHERE name = %s", (tag,))
    row = cur.fetchone()
    if row:
        # Backfill external_id + profile fields on legacy rows
        try:
            profile = _fetch_user_profile(user_id)
            first = profile.get("first_name", "")
            last  = profile.get("last_name", "")
            display_name = f"{first} {last}".strip()
            email      = profile.get("email") or None
            phone      = profile.get("phone") or None
            tier       = profile.get("tier") or None
            kyc_status = (profile.get("kyc") or {}).get("status") or None
            cur.execute("""
                UPDATE customers
                SET external_id = %s,
                    name        = COALESCE(NULLIF(%s,''), name),
                    email       = COALESCE(%s, email),
                    phone       = COALESCE(%s, phone),
                    tier        = COALESCE(%s, tier),
                    kyc_status  = COALESCE(%s, kyc_status)
                WHERE id = %s
            """, (user_id, display_name, email, phone, tier, kyc_status, row["id"]))
        except Exception:
            logger.exception("Failed to backfill profile for legacy customer user_id=%s — skipping enrichment", user_id)
        return row["id"]

    # New customer — fetch profile to populate real data
    profile = _fetch_user_profile(user_id)
    customer_id = str(uuid.uuid4())

    first = profile.get("first_name", "")
    last  = profile.get("last_name", "")
    display_name = f"{first} {last}".strip() or tag
    email        = profile.get("email") or None
    phone        = profile.get("phone") or None
    tier         = profile.get("tier") or "regular"
    kyc_status   = (profile.get("kyc") or {}).get("status") or None

    cur.execute("""
        INSERT INTO customers (id, name, email, phone, tier, kyc_status, external_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (customer_id, display_name, email, phone, tier, kyc_status, user_id))
    return customer_id


def create_conversation(user_id: str, platform: str, language: str = "en", issue_category: str | None = None) -> str:
    """
    Creates (or reuses) a customer row and opens a new ticket.
    Returns the ticket ID, which is used as the conversation_id throughout
    the Python layer so everything maps 1-to-1 with dashboard tickets.
    """
    with _conn() as conn:
        cur = conn.cursor()
        customer_id = _ensure_customer(cur, user_id)

        ticket_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO tickets (id, customer_id, channel, status, category, priority, team)
            VALUES (%s, %s, 'web', 'Open_Live', %s, 3, 'cs')
        """, (ticket_id, customer_id, issue_category or 'ai_handling'))

    return ticket_id  # ticket_id IS the conversation_id in the Python layer


def update_ticket_category(conversation_id: str, category: str) -> None:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE tickets SET category = %s, updated_at = NOW() WHERE id = %s",
            (category, conversation_id),
        )


def assign_ai_persona(conversation_id: str, name: str, avatar: str, avatar_url: str) -> None:
    persona = json.dumps({"ai_name": name, "ai_avatar": avatar, "ai_avatar_url": avatar_url})
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE tickets SET ai_persona = %s::jsonb, category = 'ai_handling'
            WHERE id = %s
        """, (persona, conversation_id))


def get_ai_persona(conversation_id: str) -> dict:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT ai_persona FROM tickets WHERE id = %s", (conversation_id,))
        row = cur.fetchone()
    if not row or not row["ai_persona"]:
        return {"name": None, "avatar": None, "avatar_url": None}
    data = row["ai_persona"]
    return {"name": data.get("ai_name"), "avatar": data.get("ai_avatar"), "avatar_url": data.get("ai_avatar_url")}


# ── Messages ──────────────────────────────────────────────────────────────────

def add_message(conversation_id: str, role: str, content: str, metadata: dict = {}) -> str:
    """conversation_id here is the ticket_id in the dashboard schema."""
    msg_id = str(uuid.uuid4())
    sender_type = _role_to_sender_type(role)
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO messages (id, ticket_id, sender_type, content, metadata)
            VALUES (%s, %s, %s, %s, %s)
        """, (msg_id, conversation_id, sender_type, content, json.dumps(metadata)))
        # Touch ticket updated_at
        cur.execute("UPDATE tickets SET updated_at = NOW() WHERE id = %s", (conversation_id,))
    return msg_id


def get_history(conversation_id: str, limit: int = 10) -> list[dict]:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT sender_type, content, created_at, metadata
            FROM messages
            WHERE ticket_id = %s
              AND sender_type != 'internal_note'
            ORDER BY created_at DESC
            LIMIT %s
        """, (conversation_id, limit))
        rows = cur.fetchall()
    result = []
    for r in reversed(rows):
        raw_meta = r["metadata"]
        meta = json.loads(raw_meta) if isinstance(raw_meta, str) and raw_meta else (raw_meta or {})
        # Belt-and-suspenders: also skip anything flagged internal in metadata
        if meta.get("is_internal_note"):
            continue
        entry: dict = {
            "role": _sender_type_to_role(r["sender_type"]),
            "content": r["content"],
            "created_at": int(r["created_at"].timestamp()) if r["created_at"] else 0,
        }
        if r["sender_type"] == "agent" and meta.get("agent_name"):
            entry["agent_name"] = meta["agent_name"]
            entry["agent_avatar"] = meta.get("agent_avatar", meta["agent_name"][0].upper())
            if meta.get("agent_avatar_url"):
                entry["agent_avatar_url"] = meta["agent_avatar_url"]
        result.append(entry)
    return result


# ── Tickets ───────────────────────────────────────────────────────────────────

def create_ticket(conversation_id: str, escalation_reason: str) -> str:
    """
    In the unified schema the ticket already exists (created in create_conversation).
    On escalation we update its status and return the same ticket ID.
    """
    if escalation_reason == "ai_handling":
        # Initial creation — ticket already created; just return the id
        return conversation_id

    # Real escalation — mark ticket as Escalated
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE tickets
            SET status = 'Escalated', updated_at = NOW()
            WHERE id = %s
        """, (conversation_id,))
    return conversation_id


def get_ticket_id_by_conversation(conversation_id: str) -> str | None:
    """In the unified schema, conversation_id == ticket_id."""
    return conversation_id


def is_human_handling(conversation_id: str) -> bool:
    """
    Returns True if a human agent has taken over this conversation.
    Condition: status is 'Escalated' OR a human agent is assigned (assigned_to is set).
    """
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, assigned_to FROM tickets WHERE id = %s", (conversation_id,))
        row = cur.fetchone()
    if not row:
        return False
    return row["status"] == "Escalated" or row["assigned_to"] is not None


def update_ticket_status(ticket_id: str, status: str, agent_id: str | None = None) -> None:
    # Map Python status names → dashboard status enum
    STATUS_MAP = {
        "ai_handling": "Open_Live",
        "pending_human": "Open_Live",
        "assigned": "In_Progress",
        "pending_customer": "Pending_Customer",
        "pending_internal": "Pending_Customer",
        "transferred": "In_Progress",
        "snoozed": "Pending_Customer",
        "blocked": "Pending_Customer",
        "resolved": "Closed_Resolved",
        "closed": "Closed_Resolved",
        "in_progress": "In_Progress",
        "escalated": "Escalated",
        "spam": "Closed_Unresponsive",
        # Pass-through dashboard statuses
        "Open_Live": "Open_Live",
        "In_Progress": "In_Progress",
        "Pending_Customer": "Pending_Customer",
        "Closed_Resolved": "Closed_Resolved",
        "Closed_Unresponsive": "Closed_Unresponsive",
        "Escalated": "Escalated",
    }
    pg_status = STATUS_MAP.get(status, "Open_Live")
    with _conn() as conn:
        cur = conn.cursor()
        if agent_id:
            cur.execute("""
                UPDATE tickets SET status = %s, assigned_to = %s::uuid, updated_at = NOW()
                WHERE id = %s
            """, (pg_status, agent_id, ticket_id))
        else:
            cur.execute("""
                UPDATE tickets SET status = %s, updated_at = NOW()
                WHERE id = %s
            """, (pg_status, ticket_id))


def submit_csat_score(ticket_id: str, score: int) -> None:
    """Store customer CSAT rating and mark ticket resolved."""
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE tickets
            SET csat_score = %s,
                status = 'Closed_Resolved',
                updated_at = NOW()
            WHERE id = %s
        """, (score, ticket_id))


def transfer_ticket(ticket_id: str, transferred_to: str, agent_id: str | None = None) -> None:
    update_ticket_status(ticket_id, "transferred", agent_id)


def snooze_ticket(ticket_id: str, snooze_until_timestamp: int, agent_id: str | None = None) -> None:
    update_ticket_status(ticket_id, "snoozed", agent_id)


def block_ticket(ticket_id: str, blocked_on: str, agent_id: str | None = None) -> None:
    update_ticket_status(ticket_id, "blocked", agent_id)


def set_pending_internal(ticket_id: str, blocked_on: str, agent_id: str | None = None) -> None:
    update_ticket_status(ticket_id, "pending_internal", agent_id)


# ── Dashboard queries ─────────────────────────────────────────────────────────

def get_all_conversations() -> list[dict]:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                t.id,
                c.id AS user_id,
                t.channel AS platform,
                'en' AS language,
                t.status,
                EXTRACT(EPOCH FROM t.created_at)::bigint AS created_at,
                EXTRACT(EPOCH FROM t.updated_at)::bigint AS updated_at,
                t.id AS ticket_id,
                t.status AS ticket_status,
                t.category AS escalation_reason,
                (SELECT content FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                c.name AS customer_name
            FROM tickets t
            LEFT JOIN customers c ON t.customer_id = c.id
            ORDER BY t.updated_at DESC
            LIMIT 200
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_conversation_with_history(conversation_id: str) -> dict | None:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT t.*, c.id AS cust_id, c.name AS customer_name, c.email AS customer_email
            FROM tickets t
            LEFT JOIN customers c ON t.customer_id = c.id
            WHERE t.id = %s
        """, (conversation_id,))
        ticket = cur.fetchone()
        if not ticket:
            return None
        ticket = dict(ticket)

        cur.execute("""
            SELECT sender_type, content,
                   EXTRACT(EPOCH FROM created_at)::bigint AS created_at
            FROM messages
            WHERE ticket_id = %s
            ORDER BY created_at ASC
        """, (conversation_id,))
        msgs = cur.fetchall()

    result = {
        "id": ticket["id"],
        "user_id": ticket["cust_id"],
        "platform": ticket["channel"],
        "language": "en",
        "status": ticket["status"],
        "created_at": int(ticket["created_at"].timestamp()) if ticket.get("created_at") else 0,
        "updated_at": int(ticket["updated_at"].timestamp()) if ticket.get("updated_at") else 0,
        "ai_agent_name": None,
        "ai_agent_avatar": None,
        "ai_agent_avatar_url": None,
        "ticket": {
            "id": ticket["id"],
            "status": ticket["status"],
            "escalation_reason": ticket.get("category") or "ai_handling",
            "assigned_agent_id": str(ticket["assigned_to"]) if ticket.get("assigned_to") else None,
        },
        "history": [
            {
                "role": _sender_type_to_role(m["sender_type"]),
                "content": m["content"],
                "created_at": m["created_at"],
            }
            for m in msgs
        ],
    }
    # Merge persona if stored
    persona = get_ai_persona(conversation_id)
    result["ai_agent_name"] = persona["name"]
    result["ai_agent_avatar"] = persona["avatar"]
    result["ai_agent_avatar_url"] = persona["avatar_url"]
    return result


def get_open_tickets() -> list[dict]:
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                t.id,
                t.status,
                t.channel,
                t.category,
                t.priority,
                t.assigned_to,
                t.assigned_to AS assigned_agent_id,
                EXTRACT(EPOCH FROM t.created_at)::bigint AS created_at,
                EXTRACT(EPOCH FROM t.updated_at)::bigint AS updated_at,
                (SELECT content FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT EXTRACT(EPOCH FROM created_at)::bigint FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
                c.id        AS cust_id,
                c.name      AS cust_name,
                c.email     AS cust_email,
                c.phone     AS cust_phone,
                c.tier      AS cust_tier,
                c.kyc_status AS cust_kyc_status,
                c.external_id AS cust_external_id
            FROM tickets t
            JOIN customers c ON t.customer_id = c.id
            WHERE t.status NOT IN ('Closed_Resolved', 'Closed_Unresponsive')
            ORDER BY t.priority ASC, t.updated_at DESC
        """)
        rows = cur.fetchall()

    result = []
    for r in rows:
        ticket = dict(r)
        result.append({
            "id":               ticket["id"],
            "status":           ticket["status"],
            "channel":          ticket["channel"],
            "category":         ticket["category"],
            "priority":         ticket["priority"] or 3,
            "assigned_to":      str(ticket["assigned_to"]) if ticket.get("assigned_to") else None,
            "assigned_agent_id": str(ticket["assigned_agent_id"]) if ticket.get("assigned_agent_id") else None,
            "created_at":       ticket["created_at"],
            "updated_at":       ticket["updated_at"],
            "last_message":     ticket["last_message"],
            "last_message_at":  ticket["last_message_at"],
            "tags":             [],
            "customer": {
                "id":          ticket["cust_id"],
                "user_id":     ticket["cust_external_id"] or ticket["cust_id"],
                "name":        ticket["cust_name"] or "—",
                "email":       ticket["cust_email"],
                "phone":       ticket["cust_phone"],
                "tier":        ticket["cust_tier"] or "regular",
                "kyc_status":  ticket["cust_kyc_status"],
            },
        })
    return result


def get_ticket_with_history(ticket_id: str) -> dict | None:
    return get_conversation_with_history(ticket_id)


# ── Auto-transitions ──────────────────────────────────────────────────────────

def get_tickets_for_auto_transition() -> dict:
    """Returns tickets eligible for automatic status transitions."""
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM tickets
            WHERE status = 'Pending_Customer'
              AND updated_at < NOW() - INTERVAL '48 hours'
        """)
        pending_customer_expired = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT * FROM tickets
            WHERE status = 'Closed_Resolved'
              AND updated_at < NOW() - INTERVAL '24 hours'
        """)
        resolved_expired = [dict(r) for r in cur.fetchall()]

    return {
        "pending_customer_expired": pending_customer_expired,
        "snoozed_expired": [],
        "resolved_expired": resolved_expired,
    }
