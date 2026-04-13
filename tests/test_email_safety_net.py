"""
Tests for the Gmail email safety-net: polling fallback, unreplied scanner,
and all supporting DB helpers.

Coverage:
  - db.conversation_store: get/set_gmail_history_cursor, get_unreplied_email_tickets,
    backfill_outbound_message
  - api.routes.email: run_email_safety_net() — polling fallback and scanner branches
  - api.routes.email: _gmail_thread_has_outbound()
  - api.routes.email: _extract_message_body()
"""

import base64
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Shared SQLite adapter (mirrors test_conversation_store.py) ────────────────
# Translates psycopg2-style queries to SQLite so tests run without a real DB.

def _make_sqlite_conn():
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            name TEXT,
            email TEXT UNIQUE,
            phone TEXT,
            tier TEXT DEFAULT 'regular',
            kyc_status TEXT,
            external_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            customer_id TEXT REFERENCES customers(id),
            channel TEXT DEFAULT 'widget',
            status TEXT DEFAULT 'Open_Live',
            category TEXT,
            priority INTEGER DEFAULT 3,
            team TEXT DEFAULT 'cs',
            assigned_to TEXT,
            ai_persona TEXT,
            csat_score INTEGER,
            gmail_thread_id TEXT,
            subject TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            ticket_id TEXT REFERENCES tickets(id),
            sender_type TEXT,
            content TEXT,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS email_threads (
            id TEXT PRIMARY KEY,
            ticket_id TEXT REFERENCES tickets(id),
            gmail_thread_id TEXT NOT NULL,
            gmail_message_id TEXT NOT NULL UNIQUE,
            direction TEXT NOT NULL,
            from_email TEXT,
            from_name TEXT,
            subject TEXT,
            snippet TEXT,
            attachments TEXT DEFAULT '[]',
            raw_headers TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS gmail_history_cursor (
            id INTEGER PRIMARY KEY DEFAULT 1,
            history_id TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            name TEXT UNIQUE
        );

        CREATE TABLE IF NOT EXISTS ticket_tags (
            ticket_id TEXT,
            tag_id TEXT,
            PRIMARY KEY (ticket_id, tag_id)
        );
    """)
    return conn


class _FakeCursor:
    """Adapts psycopg2-style queries to SQLite."""

    def __init__(self, sqlite_conn):
        self._cur = sqlite_conn.cursor()
        self.rowcount = 0

    def _translate(self, sql: str) -> str:
        import re
        sql = sql.replace("%s", "?")
        sql = re.sub(r"::\w+", "", sql)
        sql = re.sub(r"gen_random_uuid\(\)", "lower(hex(randomblob(16)))", sql)
        # Strip entire "AND col > NOW() - INTERVAL '...'" clauses — SQLite has no
        # interval arithmetic; dropping the clause makes tests filter-agnostic
        sql = re.sub(r"AND\s+\w+\.\w+\s*[<>]=?\s*NOW\s*\(\)\s*-\s*INTERVAL\s*'[^']*'", "", sql)
        sql = re.sub(r"NOW\(\)", "CURRENT_TIMESTAMP", sql)
        sql = re.sub(r"EXTRACT\(EPOCH FROM (\w+)\)", r"strftime('%s', \1)", sql)
        # Convert PostgreSQL upsert to SQLite INSERT OR REPLACE
        sql = re.sub(
            r"INSERT\s+INTO\s+(\S+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON CONFLICT.*",
            lambda m: f"INSERT OR REPLACE INTO {m.group(1)} ({m.group(2)}) VALUES ({m.group(3)})",
            sql,
            flags=re.DOTALL | re.IGNORECASE,
        )
        sql = re.sub(r"ON CONFLICT[^;]*DO NOTHING", "", sql, flags=re.DOTALL | re.IGNORECASE)
        return sql

    def execute(self, sql: str, params=()):
        translated = self._translate(sql)
        if params:
            params = tuple(
                json.dumps(p) if isinstance(p, (dict, list)) else p
                for p in params
            )
        self._cur.execute(translated, params)
        self.rowcount = self._cur.rowcount

    def executescript(self, sql: str):
        self._cur.executescript(sql)

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return _RowAdapter(row, self._cur.description)

    def fetchall(self):
        rows = self._cur.fetchall()
        return [_RowAdapter(r, self._cur.description) for r in rows]

    def __iter__(self):
        for row in self._cur:
            yield _RowAdapter(row, self._cur.description)


class _RowAdapter:
    """Makes sqlite3.Row behave like psycopg2 RealDictRow (supports [] and .get())."""

    def __init__(self, row, description):
        if description:
            keys = [d[0] for d in description]
            self._data = dict(zip(keys, row))
        else:
            self._data = {}

    def __getitem__(self, key):
        v = self._data[key]
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v)
            except (ValueError, TypeError):
                pass
        return v

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key):
        return key in self._data

    def keys(self):
        return self._data.keys()

    def items(self):
        return ((k, self[k]) for k in self._data)


class _FakeConn:
    def __init__(self, sqlite_conn):
        self._conn = sqlite_conn
        self._cur = _FakeCursor(sqlite_conn)

    def cursor(self):
        return _FakeCursor(self._conn)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        pass  # keep in-memory DB alive across calls


# ── Shared DB fixture ─────────────────────────────────────────────────────────

@pytest.fixture()
def sqlite_db():
    """Return a shared in-memory SQLite connection for the test."""
    return _make_sqlite_conn()


@pytest.fixture(autouse=True)
def mock_db(sqlite_db, monkeypatch):
    """Patch conversation_store._conn and email_store._conn to use SQLite."""
    fake_conn = _FakeConn(sqlite_db)

    @contextmanager
    def _fake_conn_ctx():
        yield fake_conn

    import db.conversation_store as store
    import db.email_store as estore
    monkeypatch.setattr(store, "_conn", _fake_conn_ctx)
    monkeypatch.setattr(estore, "_conn", _fake_conn_ctx)
    monkeypatch.setattr(store, "_fetch_user_profile", lambda uid: {})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _insert_customer(sqlite_db, email="test@example.com", name="Test User") -> str:
    cid = str(uuid.uuid4())
    sqlite_db.execute(
        "INSERT INTO customers (id, name, email) VALUES (?, ?, ?)",
        (cid, name, email),
    )
    sqlite_db.commit()
    return cid


def _insert_ticket(sqlite_db, customer_id: str, channel="email", status="Open_Live",
                   gmail_thread_id=None, subject="Test Subject") -> str:
    tid = str(uuid.uuid4())
    sqlite_db.execute(
        """INSERT INTO tickets (id, customer_id, channel, status, gmail_thread_id, subject)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (tid, customer_id, channel, status, gmail_thread_id, subject),
    )
    sqlite_db.commit()
    return tid


def _insert_email_thread(sqlite_db, ticket_id: str, gmail_thread_id: str,
                         gmail_message_id: str, direction="inbound") -> None:
    row_id = str(uuid.uuid4())
    sqlite_db.execute(
        """INSERT INTO email_threads
           (id, ticket_id, gmail_thread_id, gmail_message_id, direction, from_email, snippet)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (row_id, ticket_id, gmail_thread_id, gmail_message_id, direction,
         "customer@example.com", "snippet"),
    )
    sqlite_db.commit()


def _insert_message(sqlite_db, ticket_id: str, sender_type="customer", content="hello") -> str:
    mid = str(uuid.uuid4())
    sqlite_db.execute(
        "INSERT INTO messages (id, ticket_id, sender_type, content) VALUES (?, ?, ?, ?)",
        (mid, ticket_id, sender_type, content),
    )
    sqlite_db.commit()
    return mid


# ═════════════════════════════════════════════════════════════════════════════
# DB HELPER TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestGmailHistoryCursor:
    """get_gmail_history_cursor / set_gmail_history_cursor"""

    def test_returns_none_when_empty(self):
        from db.conversation_store import get_gmail_history_cursor
        assert get_gmail_history_cursor() is None

    def test_set_and_get_cursor(self, sqlite_db):
        from db.conversation_store import get_gmail_history_cursor, set_gmail_history_cursor
        set_gmail_history_cursor("12345678")
        assert get_gmail_history_cursor() == "12345678"

    def test_update_overwrites_previous(self, sqlite_db):
        from db.conversation_store import get_gmail_history_cursor, set_gmail_history_cursor
        set_gmail_history_cursor("100")
        set_gmail_history_cursor("200")
        assert get_gmail_history_cursor() == "200"

    def test_cursor_persists_across_calls(self, sqlite_db):
        from db.conversation_store import get_gmail_history_cursor, set_gmail_history_cursor
        set_gmail_history_cursor("99999")
        # Call get twice — should be idempotent
        assert get_gmail_history_cursor() == "99999"
        assert get_gmail_history_cursor() == "99999"


class TestGetUnrepliedEmailTickets:
    """get_unreplied_email_tickets — finds tickets with inbound but no outbound"""

    def test_returns_empty_when_no_tickets(self):
        from db.conversation_store import get_unreplied_email_tickets
        assert get_unreplied_email_tickets() == []

    def test_finds_ticket_with_inbound_only(self, sqlite_db):
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-1")
        _insert_email_thread(sqlite_db, tid, "thread-1", "msg-001", direction="inbound")

        results = get_unreplied_email_tickets()
        assert len(results) == 1
        assert str(results[0]["ticket_id"]) == tid

    def test_excludes_ticket_with_outbound(self, sqlite_db):
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-2")
        _insert_email_thread(sqlite_db, tid, "thread-2", "msg-in-1", direction="inbound")
        _insert_email_thread(sqlite_db, tid, "thread-2", "msg-out-1", direction="outbound")

        assert get_unreplied_email_tickets() == []

    def test_excludes_pending_customer_tickets(self, sqlite_db):
        """Tickets awaiting customer action (e.g. verification) should be skipped."""
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, status="Pending_Customer", gmail_thread_id="thread-3")
        _insert_email_thread(sqlite_db, tid, "thread-3", "msg-002", direction="inbound")

        assert get_unreplied_email_tickets() == []

    def test_excludes_closed_tickets(self, sqlite_db):
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        for status in ("Closed_Resolved", "Closed_Unresponsive"):
            tid = _insert_ticket(sqlite_db, cid, status=status,
                                 gmail_thread_id=f"thread-closed-{status}")
            _insert_email_thread(sqlite_db, tid, f"thread-closed-{status}",
                                 f"msg-{status}", direction="inbound")

        assert get_unreplied_email_tickets() == []

    def test_excludes_non_email_channel(self, sqlite_db):
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, channel="widget")
        _insert_email_thread(sqlite_db, tid, "thread-widget", "msg-widget", direction="inbound")

        assert get_unreplied_email_tickets() == []

    def test_multiple_unreplied_tickets(self, sqlite_db):
        from db.conversation_store import get_unreplied_email_tickets
        cid = _insert_customer(sqlite_db)
        t1 = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-a")
        t2 = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-b")
        _insert_email_thread(sqlite_db, t1, "thread-a", "msg-a", direction="inbound")
        _insert_email_thread(sqlite_db, t2, "thread-b", "msg-b", direction="inbound")

        results = get_unreplied_email_tickets()
        ids = {str(r["ticket_id"]) for r in results}
        assert t1 in ids
        assert t2 in ids


class TestBackfillOutboundMessage:
    """backfill_outbound_message — writes missing sent messages into DB"""

    def test_writes_to_email_threads(self, sqlite_db):
        from db.conversation_store import backfill_outbound_message
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-bf")

        backfill_outbound_message(
            ticket_id=tid,
            gmail_thread_id="thread-bf",
            gmail_message_id="sent-msg-001",
            from_email="ava@freedom.world",
            subject="Re: Test",
            content="Hello, this is the bot reply.",
            sent_at="Mon, 01 Jan 2024 10:00:00 +0000",
        )

        row = sqlite_db.execute(
            "SELECT * FROM email_threads WHERE gmail_message_id = ?", ("sent-msg-001",)
        ).fetchone()
        assert row is not None
        assert row["direction"] == "outbound"
        assert row["from_email"] == "ava@freedom.world"

    def test_writes_to_messages_table(self, sqlite_db):
        from db.conversation_store import backfill_outbound_message
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-bf2")

        backfill_outbound_message(
            ticket_id=tid,
            gmail_thread_id="thread-bf2",
            gmail_message_id="sent-msg-002",
            from_email="ava@freedom.world",
            subject="Re: Test",
            content="Backfilled reply content.",
            sent_at="",
        )

        msg = sqlite_db.execute(
            "SELECT * FROM messages WHERE ticket_id = ? AND sender_type = 'bot'", (tid,)
        ).fetchone()
        assert msg is not None
        assert msg["content"] == "Backfilled reply content."

    def test_idempotent_on_duplicate_message_id(self, sqlite_db):
        """Calling backfill twice with the same gmail_message_id should not raise."""
        from db.conversation_store import backfill_outbound_message
        cid = _insert_customer(sqlite_db)
        tid = _insert_ticket(sqlite_db, cid, gmail_thread_id="thread-bf3")

        kwargs = dict(
            ticket_id=tid,
            gmail_thread_id="thread-bf3",
            gmail_message_id="sent-msg-003",
            from_email="ava@freedom.world",
            subject="Re: Test",
            content="Reply.",
            sent_at="",
        )
        backfill_outbound_message(**kwargs)
        # Second call must not raise even if email_threads has UNIQUE constraint
        try:
            backfill_outbound_message(**kwargs)
        except Exception as exc:
            pytest.fail(f"Second backfill raised unexpectedly: {exc}")


# ═════════════════════════════════════════════════════════════════════════════
# _gmail_thread_has_outbound TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestGmailThreadHasOutbound:
    """Unit tests for _gmail_thread_has_outbound() — checks Gmail API for sent messages."""

    def _make_service(self, thread_messages: list[dict]) -> MagicMock:
        """Build a mock _GmailRestService that returns the given thread messages."""
        service = MagicMock()
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"messages": thread_messages}
        service._session.get.return_value = resp
        return service

    def test_detects_outbound_from_support_email(self):
        from api.routes.email import _gmail_thread_has_outbound, GMAIL_SUPPORT_EMAIL
        thread_msgs = [
            {
                "id": "msg-sent-1",
                "payload": {"headers": [{"name": "From", "value": GMAIL_SUPPORT_EMAIL}]},
            }
        ]
        service = self._make_service(thread_msgs)
        has_out, msg_id, _ = _gmail_thread_has_outbound(service, "thread-xyz")
        assert has_out is True
        assert msg_id == "msg-sent-1"

    def test_no_outbound_when_only_inbound(self):
        from api.routes.email import _gmail_thread_has_outbound
        thread_msgs = [
            {
                "id": "msg-in-1",
                "payload": {"headers": [{"name": "From", "value": "customer@example.com"}]},
            }
        ]
        service = self._make_service(thread_msgs)
        has_out, msg_id, _ = _gmail_thread_has_outbound(service, "thread-xyz")
        assert has_out is False
        assert msg_id == ""

    def test_returns_true_on_api_error_fail_safe(self):
        """On any exception, we assume replied — prevents double-reply."""
        from api.routes.email import _gmail_thread_has_outbound
        service = MagicMock()
        service._session.get.side_effect = RuntimeError("network error")
        has_out, _, _ = _gmail_thread_has_outbound(service, "thread-err")
        assert has_out is True

    def test_empty_thread_returns_false(self):
        from api.routes.email import _gmail_thread_has_outbound
        service = self._make_service([])
        has_out, msg_id, _ = _gmail_thread_has_outbound(service, "thread-empty")
        assert has_out is False

    def test_mixed_thread_detects_outbound(self):
        """Thread with both inbound and outbound — should detect the outbound."""
        from api.routes.email import _gmail_thread_has_outbound, GMAIL_SUPPORT_EMAIL
        thread_msgs = [
            {"id": "msg-in", "payload": {"headers": [{"name": "From", "value": "cust@example.com"}]}},
            {"id": "msg-out", "payload": {"headers": [{"name": "From", "value": GMAIL_SUPPORT_EMAIL}]}},
        ]
        service = self._make_service(thread_msgs)
        has_out, msg_id, _ = _gmail_thread_has_outbound(service, "thread-mixed")
        assert has_out is True
        assert msg_id == "msg-out"


# ═════════════════════════════════════════════════════════════════════════════
# _extract_message_body TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestExtractMessageBody:
    """Unit tests for _extract_message_body() — decodes Gmail message payload."""

    def _encode(self, text: str) -> str:
        return base64.urlsafe_b64encode(text.encode()).decode()

    def test_extracts_plain_text_payload(self):
        from api.routes.email import _extract_message_body
        msg = {
            "payload": {
                "mimeType": "text/plain",
                "body": {"data": self._encode("Hello world")},
                "parts": [],
                "headers": [],
            },
            "snippet": "",
        }
        assert _extract_message_body(msg) == "Hello world"

    def test_extracts_from_multipart_parts(self):
        from api.routes.email import _extract_message_body
        msg = {
            "payload": {
                "mimeType": "multipart/alternative",
                "body": {},
                "parts": [
                    {
                        "mimeType": "text/plain",
                        "body": {"data": self._encode("Plain body")},
                    },
                    {
                        "mimeType": "text/html",
                        "body": {"data": self._encode("<p>HTML body</p>")},
                    },
                ],
                "headers": [],
            },
            "snippet": "fallback",
        }
        result = _extract_message_body(msg)
        assert result == "Plain body"

    def test_falls_back_to_snippet(self):
        from api.routes.email import _extract_message_body
        msg = {
            "payload": {
                "mimeType": "multipart/alternative",
                "body": {},
                "parts": [],
                "headers": [],
            },
            "snippet": "snippet fallback text",
        }
        assert _extract_message_body(msg) == "snippet fallback text"

    def test_handles_empty_payload(self):
        from api.routes.email import _extract_message_body
        msg = {"payload": {}, "snippet": ""}
        result = _extract_message_body(msg)
        assert isinstance(result, str)


# ═════════════════════════════════════════════════════════════════════════════
# run_email_safety_net TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestRunEmailSafetyNet:
    """
    Integration-level tests for run_email_safety_net().
    External services (Gmail API, AI agent, email sender) are mocked.
    """

    def _make_gmail_service(self, history_resp=None, thread_resp=None, fetch_msg=None):
        """Build a mock _GmailRestService."""
        service = MagicMock()
        service.list_history.return_value = history_resp or {"history": [], "historyId": "5000"}
        service.fetch_message.return_value = fetch_msg or {
            "payload": {"mimeType": "text/plain", "body": {"data": ""}, "parts": [], "headers": []},
            "snippet": "reply body",
        }

        thread_response = MagicMock()
        thread_response.raise_for_status = MagicMock()
        thread_response.json.return_value = thread_resp or {"messages": []}
        service._session.get.return_value = thread_response
        return service

    # ── Polling fallback ──────────────────────────────────────────────────────

    async def test_polling_skipped_when_no_cursor(self):
        """If no history cursor is stored, polling fallback does nothing."""
        with (
            patch("api.routes.email._get_gmail_service") as mock_svc,
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=[]),
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()
            # Gmail service should not have been called for history
            mock_svc.return_value.list_history.assert_not_called()

    async def test_polling_processes_missed_messages(self):
        """Polling fallback calls _process_inbound_email for each new message."""
        history_resp = {
            "history": [
                {"messagesAdded": [{"message": {"id": "missed-msg-1", "labelIds": ["INBOX"]}}]}
            ],
            "historyId": "6000",
        }
        service = self._make_gmail_service(history_resp=history_resp)

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value="5000"),
            patch("api.routes.email.set_gmail_history_cursor") as mock_set,
            patch("api.routes.email.set_last_history_id"),
            patch("api.routes.email._process_inbound_email", new_callable=AsyncMock) as mock_proc,
            patch("api.routes.email.get_unreplied_email_tickets", return_value=[]),
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()

            mock_proc.assert_called_once_with("missed-msg-1")
            mock_set.assert_called_with("6000")

    async def test_polling_skips_sent_label_messages(self):
        """Messages with SENT label (our outbound emails) are not re-processed."""
        history_resp = {
            "history": [
                {"messagesAdded": [{"message": {"id": "sent-msg-1", "labelIds": ["SENT"]}}]}
            ],
            "historyId": "6001",
        }
        service = self._make_gmail_service(history_resp=history_resp)

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value="5000"),
            patch("api.routes.email.set_gmail_history_cursor"),
            patch("api.routes.email.set_last_history_id"),
            patch("api.routes.email._process_inbound_email", new_callable=AsyncMock) as mock_proc,
            patch("api.routes.email.get_unreplied_email_tickets", return_value=[]),
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()
            mock_proc.assert_not_called()

    async def test_polling_advances_bookmark(self):
        """After polling, the DB cursor is updated to the latest historyId."""
        history_resp = {"history": [], "historyId": "9999"}
        service = self._make_gmail_service(history_resp=history_resp)

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value="8000"),
            patch("api.routes.email.set_gmail_history_cursor") as mock_set,
            patch("api.routes.email.set_last_history_id"),
            patch("api.routes.email._process_inbound_email", new_callable=AsyncMock),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=[]),
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()
            mock_set.assert_called_with("9999")

    # ── Unreplied scanner ─────────────────────────────────────────────────────

    async def test_scanner_backfills_when_gmail_has_outbound(self):
        """
        When Gmail shows a sent message but our DB has no outbound record,
        the scanner backfills the message into DB without firing a new reply.
        """
        from api.routes.email import GMAIL_SUPPORT_EMAIL
        unreplied = [{
            "ticket_id": "ticket-001",
            "status": "Open_Live",
            "gmail_thread_id": "thread-001",
            "subject": "Need help",
            "category": "kyc_verification",
            "customer_email": "cust@example.com",
            "customer_name": "Test User",
            "customer_id": "cust-001",
        }]
        thread_resp = {
            "messages": [
                {
                    "id": "sent-already",
                    "payload": {
                        "headers": [
                            {"name": "From", "value": GMAIL_SUPPORT_EMAIL},
                            {"name": "date", "value": "Mon, 01 Jan 2024 10:00:00 +0000"},
                            {"name": "Subject", "value": "Re: Need help"},
                        ]
                    },
                }
            ]
        }
        fetch_msg = {
            "payload": {
                "mimeType": "text/plain",
                "body": {"data": base64.urlsafe_b64encode(b"Bot reply").decode()},
                "parts": [],
                "headers": [
                    {"name": "From", "value": GMAIL_SUPPORT_EMAIL},
                    {"name": "date", "value": "Mon, 01 Jan 2024 10:00:00 +0000"},
                    {"name": "Subject", "value": "Re: Need help"},
                ],
            },
            "snippet": "Bot reply",
        }
        service = self._make_gmail_service(thread_resp=thread_resp, fetch_msg=fetch_msg)

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=unreplied),
            patch("api.routes.email.backfill_outbound_message") as mock_backfill,
            patch("api.routes.email.update_ticket_status") as mock_status,
            patch("engine.agent.chat") as mock_chat,
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()

            mock_backfill.assert_called_once()
            mock_chat.assert_not_called()  # no new reply fired
            mock_status.assert_called_with("ticket-001", "pending_customer")

    async def test_scanner_fires_ai_reply_when_genuinely_unreplied(self):
        """
        When neither our DB nor Gmail has any sent message, the scanner fires
        the AI agent and sends a reply.
        """
        unreplied = [{
            "ticket_id": "ticket-002",
            "status": "Open_Live",
            "gmail_thread_id": "thread-002",
            "subject": "KYC issue",
            "category": "kyc_verification",
            "customer_email": "cust@example.com",
            "customer_name": "Test User",
            "customer_id": "cust-002",
        }]
        service = self._make_gmail_service(thread_resp={"messages": []})

        mock_agent_response = MagicMock()
        mock_agent_response.text = "Here is how to fix your KYC."
        mock_agent_response.confidence = 0.9
        mock_agent_response.escalated = False
        mock_agent_response.resolved = False

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=unreplied),
            patch("api.routes.email.get_history", return_value=[
                {"role": "user", "content": "My KYC was rejected"}
            ]),
            patch("api.routes.email._resolve_user_id", return_value="user-001"),
            patch("engine.agent.chat", return_value=mock_agent_response) as mock_chat,
            patch("engine.email_sender.send_reply", return_value="sent-msg-new"),
            patch("api.routes.email.create_csat_tokens", return_value=None),
            patch("db.email_store.log_email_message"),
            patch("api.routes.email.add_message"),
            patch("api.routes.email.update_ticket_status") as mock_status,
            patch("api.routes.email.manager") as mock_manager,
        ):
            mock_manager.broadcast = AsyncMock()
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()

            mock_chat.assert_called_once()
            mock_status.assert_called_with("ticket-002", "pending_customer")

    async def test_scanner_skips_ticket_with_no_gmail_thread_id(self):
        """Tickets without a gmail_thread_id are skipped gracefully."""
        unreplied = [{
            "ticket_id": "ticket-003",
            "status": "Open_Live",
            "gmail_thread_id": None,
            "subject": "Missing thread",
            "category": "general",
            "customer_email": "x@example.com",
            "customer_name": "X",
            "customer_id": "cust-003",
        }]
        with (
            patch("api.routes.email._get_gmail_service"),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=unreplied),
            patch("engine.agent.chat") as mock_chat,
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()
            mock_chat.assert_not_called()

    async def test_scanner_does_not_double_reply_when_already_replied(self):
        """
        Even if DB shows unreplied, if Gmail confirms a sent message exists,
        we must NOT fire a new AI reply (backfill only).
        """
        from api.routes.email import GMAIL_SUPPORT_EMAIL
        unreplied = [{
            "ticket_id": "ticket-004",
            "status": "Open_Live",
            "gmail_thread_id": "thread-004",
            "subject": "Already answered",
            "category": "general",
            "customer_email": "c@example.com",
            "customer_name": "C",
            "customer_id": "cust-004",
        }]
        thread_resp = {
            "messages": [
                {
                    "id": "already-sent",
                    "payload": {"headers": [{"name": "From", "value": GMAIL_SUPPORT_EMAIL}]},
                }
            ]
        }
        fetch_msg = {
            "payload": {
                "mimeType": "text/plain",
                "body": {"data": base64.urlsafe_b64encode(b"already sent").decode()},
                "parts": [],
                "headers": [
                    {"name": "From", "value": GMAIL_SUPPORT_EMAIL},
                    {"name": "date", "value": ""},
                    {"name": "Subject", "value": "Re: Already answered"},
                ],
            },
            "snippet": "already sent",
        }
        service = self._make_gmail_service(thread_resp=thread_resp, fetch_msg=fetch_msg)

        with (
            patch("api.routes.email._get_gmail_service", return_value=service),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=unreplied),
            patch("api.routes.email.backfill_outbound_message"),
            patch("api.routes.email.update_ticket_status"),
            patch("engine.agent.chat") as mock_chat,
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()
            mock_chat.assert_not_called()

    async def test_scanner_handles_empty_unreplied_list(self):
        """No unreplied tickets — scanner should complete without error."""
        with (
            patch("api.routes.email._get_gmail_service"),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=[]),
        ):
            from api.routes.email import run_email_safety_net
            await run_email_safety_net()  # must not raise

    async def test_scanner_continues_after_single_ticket_error(self):
        """
        If one ticket causes an exception (e.g. Gmail API error), the scanner
        should continue processing the remaining tickets.
        """
        unreplied = [
            {
                "ticket_id": "ticket-bad",
                "status": "Open_Live",
                "gmail_thread_id": "thread-bad",
                "subject": "Bad",
                "category": "general",
                "customer_email": "bad@example.com",
                "customer_name": "Bad",
                "customer_id": "cust-bad",
            },
            {
                "ticket_id": "ticket-good",
                "status": "Open_Live",
                "gmail_thread_id": "thread-good",
                "subject": "Good",
                "category": "general",
                "customer_email": "good@example.com",
                "customer_name": "Good",
                "customer_id": "cust-good",
            },
        ]

        def _thread_has_outbound(service, thread_id):
            if thread_id == "thread-bad":
                raise RuntimeError("simulated Gmail error")
            return False, "", ""

        with (
            patch("api.routes.email._get_gmail_service"),
            patch("api.routes.email.get_gmail_history_cursor", return_value=None),
            patch("api.routes.email.get_unreplied_email_tickets", return_value=unreplied),
            patch("api.routes.email._gmail_thread_has_outbound", side_effect=_thread_has_outbound),
            patch("api.routes.email.get_history", return_value=[{"role": "user", "content": "hi"}]),
            patch("api.routes.email._resolve_user_id", return_value="u"),
            patch("engine.agent.chat") as mock_chat,
            patch("engine.email_sender.send_reply", return_value="sent"),
            patch("api.routes.email.create_csat_tokens", return_value=None),
            patch("db.email_store.log_email_message"),
            patch("api.routes.email.add_message"),
            patch("api.routes.email.update_ticket_status"),
            patch("api.routes.email.manager") as mock_mgr,
        ):
            mock_agent = MagicMock()
            mock_agent.text = "reply"
            mock_agent.confidence = 0.9
            mock_agent.escalated = False
            mock_agent.resolved = False
            mock_chat.return_value = mock_agent
            mock_mgr.broadcast = AsyncMock()

            from api.routes.email import run_email_safety_net
            await run_email_safety_net()

            # Good ticket still processed despite bad ticket failing
            mock_chat.assert_called_once()

    # ── Bookmark integration ──────────────────────────────────────────────────

    async def test_webhook_advances_db_cursor(self):
        """
        The webhook handler should call set_gmail_history_cursor after
        successfully processing a notification.
        """
        with (
            patch("api.routes.email._get_gmail_service") as mock_svc,
            patch("api.routes.email._process_inbound_email", new_callable=AsyncMock),
            patch("api.routes.email.set_gmail_history_cursor") as mock_set,
            patch("api.routes.email.set_last_history_id"),
        ):
            service = MagicMock()
            service.list_history.return_value = {"history": [], "historyId": "7777"}
            mock_svc.return_value = service

            data = json.dumps({"emailAddress": "ava@freedom.world", "historyId": 7777})
            encoded = base64.urlsafe_b64encode(data.encode()).decode()
            body = {"message": {"data": encoded}}

            from api.routes.email import router
            from fastapi import FastAPI
            app = FastAPI()
            app.include_router(router)
            from fastapi.testclient import TestClient
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post("/email/webhook", json=body)
            assert resp.status_code == 200
            mock_set.assert_called_with("7777")
