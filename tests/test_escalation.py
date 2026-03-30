"""Tests for escalation engine."""
import pytest
from engine.escalation import should_escalate, estimate_confidence


# ── should_escalate ───────────────────────────────────────────────────────────

def test_high_confidence_no_escalate():
    escalate, reason = should_escalate("What is my KYC status?", confidence=0.9)
    assert escalate is False
    assert reason == ""


def test_low_confidence_escalates():
    escalate, reason = should_escalate("some question", confidence=0.3)
    assert escalate is True
    assert reason == "low_confidence"


def test_human_request_escalates():
    for phrase in ["I want to talk to a human", "connect me to an agent", "speak to someone"]:
        escalate, reason = should_escalate(phrase, confidence=0.9)
        assert escalate is True, f"Expected escalation for: {phrase}"
        assert reason == "user_requested_human"


def test_fraud_keyword_escalates():
    escalate, reason = should_escalate("My account was hacked", confidence=0.9)
    assert escalate is True
    assert reason == "sensitive_keyword"


def test_repeated_low_confidence_escalates():
    escalate, reason = should_escalate("?", confidence=0.7, consecutive_low_confidence=3)
    assert escalate is True
    assert reason == "repeated_unclear_exchanges"


def test_thai_human_request():
    escalate, reason = should_escalate("ขอคุยกับ agent หน่อยได้ไหม", confidence=0.9)
    assert escalate is True


# ── estimate_confidence ───────────────────────────────────────────────────────

def test_confidence_with_rag_chunks():
    chunks = [{"text": "KYC means Know Your Customer", "metadata": {}}]
    score = estimate_confidence("Your KYC is pending review and will be processed shortly.", chunks)
    assert score >= 0.6


def test_confidence_hedged_response():
    score = estimate_confidence("I'm not sure about this, I don't know.", [])
    assert score < 0.6


def test_confidence_no_chunks_short_reply():
    score = estimate_confidence("Ok.", [])
    assert score < 0.5
