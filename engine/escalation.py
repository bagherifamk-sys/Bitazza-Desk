"""
Escalation engine — decides when to hand off to a human agent.
"""
import re
from config.settings import ESCALATION_CONFIDENCE_THRESHOLD, ESCALATION_KEYWORDS, ESCALATION_HUMAN_PHRASES


def should_escalate(
    user_message: str,
    confidence: float,
    consecutive_low_confidence: int = 0,
) -> tuple[bool, str]:
    """
    Returns (escalate: bool, reason: str).
    Checks confidence score, keywords, and explicit human requests.
    """
    msg_lower = user_message.lower()

    # Explicit human request
    if any(phrase in msg_lower for phrase in ESCALATION_HUMAN_PHRASES):
        return True, "user_requested_human"

    # Security/sensitive keywords
    if any(kw in msg_lower for kw in ESCALATION_KEYWORDS):
        return True, "sensitive_keyword"

    # Low confidence
    if confidence < ESCALATION_CONFIDENCE_THRESHOLD:
        return True, "low_confidence"

    # Repeated low-confidence turns
    if consecutive_low_confidence >= 3:
        return True, "repeated_unclear_exchanges"

    return False, ""


