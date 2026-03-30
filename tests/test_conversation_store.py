"""Tests for conversation store — mocked PostgreSQL via patch."""
import pytest
import os
import uuid
import sqlite3
import re
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import patch, MagicMock

os.environ.setdefault("CHROMA_PATH", "./data/chroma_test")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")

import db.conversation_store as store


def _make_sqlite_conn():
    """Create an in-memory SQLite DB with the same schema as PostgreSQL."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE customers (
            id TEXT PRIMARY KEY,
            name TEXT, email TEXT, phone TEXT,
            tier TEXT DEFAULT 'regular',
            kyc_status TEXT, external_id TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE tickets (
            id TEXT PRIMARY KEY,
            customer_id TEXT,
            channel TEXT DEFAULT 'web',
            status TEXT DEFAULT 'Open_Live',
            category TEXT,
            priority INTEGER DEFAULT 3,
            team TEXT DEFAULT 'cs',
            assigned_to TEXT,
            ai_persona TEXT,
            csat_score INTEGER,
            created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
            updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
        )
    """)
    conn.execute("""
        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            ticket_id TEXT,
            sender_type TEXT,
            content TEXT,
            metadata TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
        )
    """)
    conn.execute("""
        CREATE TABLE tags (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE ticket_tags (
            ticket_id TEXT,
            tag_id TEXT,
            PRIMARY KEY (ticket_id, tag_id)
        )
    """)
    conn.commit()
    return conn


class _FakeCursor:
    """Wraps sqlite3 cursor to behave like psycopg2 RealDictCursor.
    Translates %s placeholders to ? for sqlite3 compatibility.
    """
    def __init__(self, sqlite_cursor):
        self._cur = sqlite_cursor
        self._rows = []
        self._row_iter = iter([])

    def execute(self, sql, params=()):
        # Translate psycopg2 %s -> sqlite3 ?
        sql = sql.replace("%s", "?")
        # Strip PostgreSQL type casts
        sql = sql.replace("::jsonb", "").replace("::uuid", "").replace("::bigint", "")
        # Replace NOW() with SQLite equivalent
        sql = sql.replace("NOW()", "strftime('%Y-%m-%d %H:%M:%f', 'now')")
        # Replace EXTRACT(EPOCH FROM ...) patterns
        sql = re.sub(r"EXTRACT\(EPOCH FROM ([^)]+)\)::bigint", r"strftime('%s', \1)", sql)
        sql = re.sub(r"EXTRACT\(EPOCH FROM ([^)]+)\)", r"strftime('%s', \1)", sql)
        # Remove INTERVAL expressions (not supported in sqlite)
        sql = re.sub(r"- INTERVAL '[^']+' \w+", "", sql, flags=re.IGNORECASE)
        # Add rowid tiebreaker to ORDER BY created_at to ensure stable ordering
        sql = re.sub(r"ORDER BY created_at (ASC|DESC)", r"ORDER BY created_at \1, rowid \1", sql, flags=re.IGNORECASE)
        self._cur.execute(sql, params)
        self._rows = self._cur.fetchall()
        self._row_iter = iter(self._rows)

    @staticmethod
    def _coerce_row(row: dict) -> dict:
        """Convert SQLite datetime strings to datetime objects for timestamp columns."""
        for key in ("created_at", "updated_at"):
            val = row.get(key)
            if isinstance(val, str):
                # SQLite strftime('%Y-%m-%d %H:%M:%f') → "2024-01-01 12:00:00.123"
                for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
                    try:
                        row[key] = datetime.strptime(val, fmt)
                        break
                    except ValueError:
                        pass
        return row

    def fetchone(self):
        try:
            row = next(self._row_iter)
            return self._coerce_row(dict(row)) if row is not None else None
        except StopIteration:
            return None

    def fetchall(self):
        result = [self._coerce_row(dict(r)) for r in self._rows]
        self._rows = []
        self._row_iter = iter([])
        return result

    def __iter__(self):
        return (dict(r) for r in self._rows)


class _FakeConn:
    def __init__(self, sqlite_conn):
        self._conn = sqlite_conn

    def cursor(self):
        return _FakeCursor(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        pass  # keep in-memory DB alive across test


@pytest.fixture(autouse=True)
def mock_db(monkeypatch):
    """Replace _conn with a fake context manager backed by in-memory SQLite."""
    sqlite_conn = _make_sqlite_conn()
    fake_conn = _FakeConn(sqlite_conn)

    @contextmanager
    def fake_context_manager():
        yield fake_conn
        fake_conn.commit()

    monkeypatch.setattr(store, "_conn", fake_context_manager)
    monkeypatch.setattr(store, "_fetch_user_profile", lambda user_id: {})


def test_create_conversation():
    cid = store.create_conversation("user_123", "bitazza", "en")
    assert isinstance(cid, str)
    assert len(cid) == 36  # UUID


def test_add_and_get_messages():
    cid = store.create_conversation("user_1", "web", "th")
    store.add_message(cid, "user", "สวัสดี")
    store.add_message(cid, "assistant", "สวัสดีครับ ช่วยอะไรได้ไหม")

    history = store.get_history(cid, limit=10)
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"


def test_get_history_limit():
    cid = store.create_conversation("user_2", "web")
    for i in range(15):
        store.add_message(cid, "user", f"message {i}")
    history = store.get_history(cid, limit=5)
    assert len(history) == 5


def test_create_ticket():
    cid = store.create_conversation("user_3", "bitazza")
    tid = store.create_ticket(cid, "low_confidence")
    assert isinstance(tid, str)


def test_get_open_tickets():
    cid = store.create_conversation("user_4", "freedom")
    store.create_ticket(cid, "user_requested_human")
    tickets = store.get_open_tickets()
    assert len(tickets) >= 1
    # PostgreSQL schema uses status values like "Open_Live", "Escalated", etc.
    assert tickets[0]["status"] in ("Open_Live", "Escalated", "In_Progress", "Pending_Customer")


def test_get_ticket_with_history():
    cid = store.create_conversation("user_5", "web")
    store.add_message(cid, "user", "I need help")
    store.add_message(cid, "assistant", "I can help you")
    tid = store.create_ticket(cid, "low_confidence")

    ticket = store.get_ticket_with_history(tid)
    assert ticket is not None
    assert ticket["id"] == tid
    assert len(ticket["history"]) == 2


def test_update_ticket_status():
    cid = store.create_conversation("user_6", "bitazza")
    tid = store.create_ticket(cid, "sensitive_keyword")
    store.update_ticket_status(tid, "resolved", agent_id=None)

    tickets = store.get_open_tickets()
    ids = [t["id"] for t in tickets]
    assert tid not in ids  # resolved tickets not in open queue


def test_get_nonexistent_ticket():
    result = store.get_ticket_with_history("nonexistent-id")
    assert result is None
