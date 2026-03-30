"""Integration tests for the FastAPI endpoints using TestClient."""
import pytest
import os
from pathlib import Path

os.environ.setdefault("CHROMA_PATH", "./data/chroma_test")
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
os.environ.setdefault("FRESHDESK_API_KEY", "test")
os.environ.setdefault("FRESHDESK_SUBDOMAIN", "test.freshdesk.com")
os.environ.setdefault("JWT_SECRET", "test-secret")

from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


@pytest.fixture
def client(tmp_path, monkeypatch):
    import db.conversation_store as cs
    monkeypatch.setattr(cs, "DB_PATH", tmp_path / "test.db")
    cs.init_db()

    from api.main import app
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_chat_start(client):
    r = client.post("/chat/start", json={"platform": "bitazza"})
    assert r.status_code == 200
    data = r.json()
    assert "conversation_id" in data
    assert len(data["conversation_id"]) == 36


def test_chat_message_calls_agent(client):
    # Start conversation
    r = client.post("/chat/start", json={"platform": "web"})
    conv_id = r.json()["conversation_id"]

    # Mock the agent so we don't need a real Gemini key
    mock_result = MagicMock()
    mock_result.text = "Your KYC is currently pending."
    mock_result.language = "en"
    mock_result.escalated = False
    mock_result.escalation_reason = ""
    mock_result.ticket_id = None

    with patch("api.routes.chat.chat", return_value=mock_result):
        r = client.post("/chat/message", json={
            "conversation_id": conv_id,
            "message": "What is my KYC status?",
        })

    assert r.status_code == 200
    data = r.json()
    assert data["reply"] == "Your KYC is currently pending."
    assert data["escalated"] is False


def test_chat_message_empty_blocked(client):
    r = client.post("/chat/start", json={"platform": "web"})
    conv_id = r.json()["conversation_id"]
    r = client.post("/chat/message", json={"conversation_id": conv_id, "message": "  "})
    assert r.status_code == 400


def test_dashboard_tickets_empty(client):
    r = client.get("/dashboard/tickets")
    assert r.status_code == 200
    assert r.json()["tickets"] == []


def test_dashboard_ticket_not_found(client):
    r = client.get("/dashboard/tickets/nonexistent-id")
    assert r.status_code == 404


def test_chat_history(client):
    r = client.post("/chat/start", json={"platform": "web"})
    conv_id = r.json()["conversation_id"]
    r = client.get(f"/chat/history/{conv_id}")
    assert r.status_code == 200
    assert "history" in r.json()
