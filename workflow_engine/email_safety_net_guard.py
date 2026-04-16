"""
Email safety-net guard.

The email safety-net poller (api/routes/email.py) must not re-trigger
a workflow for a conversation that already has an active execution.

should_process_email() is called before the poller processes each message.
"""
from __future__ import annotations
from workflow_engine.store import get_active_execution


def should_process_email(gmail_message_id: str, conversation_id: str) -> bool:
    """
    Return False if there is already an active workflow execution for
    this conversation — the message is being handled, don't re-process.
    """
    active = get_active_execution(conversation_id)
    return active is None
