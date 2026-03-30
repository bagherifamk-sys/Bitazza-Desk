"""
Background job for automatic ticket state transitions.
Runs on a schedule via asyncio. Registered in api/main.py lifespan.

Rules:
- pending_customer → snoozed after 48h of no activity
- snoozed → closed after snooze_until timestamp passes (7 days max)
- resolved → closed after 24h of no activity
"""
import asyncio
import logging
import time
from db.conversation_store import get_tickets_for_auto_transition, update_ticket_status

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 300  # run every 5 minutes


async def run_auto_transitions() -> None:
    """Process all expired ticket states."""
    try:
        buckets = get_tickets_for_auto_transition()

        for ticket in buckets.get("pending_customer_expired", []):
            update_ticket_status(ticket["id"], "snoozed")
            logger.info("Auto-snoozed ticket %s (pending_customer 48h timeout)", ticket["id"])

        for ticket in buckets.get("snoozed_expired", []):
            update_ticket_status(ticket["id"], "closed")
            logger.info("Auto-closed ticket %s (snooze expired)", ticket["id"])

        for ticket in buckets.get("resolved_expired", []):
            update_ticket_status(ticket["id"], "closed")
            logger.info("Auto-closed ticket %s (resolved 24h timeout)", ticket["id"])

    except Exception:
        logger.exception("Error in auto_transitions job")


async def start_auto_transition_loop() -> None:
    """Infinite loop — call this as an asyncio task from app lifespan."""
    while True:
        await run_auto_transitions()
        await asyncio.sleep(INTERVAL_SECONDS)
