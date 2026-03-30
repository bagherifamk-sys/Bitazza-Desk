"""Tests for conversation store — SQLite CRUD operations."""
import pytest
import os
from pathlib import Path

# Use a test DB so we don't pollute production data
os.environ.setdefault("CHROMA_PATH", "./data/chroma_test")

import db.conversation_store as store


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    """Point DB to a temp file for each test."""
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "test.db")
    store.init_db()


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
    assert tickets[0]["status"] == "open"


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
    store.update_ticket_status(tid, "resolved", agent_id="agent_007")

    tickets = store.get_open_tickets()
    ids = [t["id"] for t in tickets]
    assert tid not in ids  # resolved tickets not in open queue


def test_get_nonexistent_ticket():
    result = store.get_ticket_with_history("nonexistent-id")
    assert result is None
