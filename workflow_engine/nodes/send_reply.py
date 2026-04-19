"""
send_reply node — sends a static or interpolated text reply.

Channel routing:
- widget → websocket_broadcast
- email  → email_send_reply

In dry-run mode (ctx.dry_run=True), no broadcast or send happens,
but output still contains the reply text for inspection.
"""
from __future__ import annotations
import re
import logging
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


def _interpolate(text: str, variables: dict) -> str:
    """Replace {{variable_name}} or {{dot.path}} with values from context variables."""
    def replacer(m):
        path = m.group(1).strip()
        # Try flat key first
        if path in variables:
            return str(variables[path])
        # Walk dot-notation path: "account.status" → variables["account"]["status"]
        parts = path.split(".")
        val = variables
        for part in parts:
            if isinstance(val, dict):
                val = val.get(part)
            else:
                return m.group(0)  # path broken — return original token
            if val is None:
                return m.group(0)
        return str(val)
    return re.sub(r"\{\{([^}]+)\}\}", replacer, text)


def websocket_broadcast(conversation_id: str, text: str) -> None:
    """Broadcast reply to widget WebSocket. Imported here to allow test patching."""
    try:
        from api.routes.chat import broadcast_to_conversation
        broadcast_to_conversation(conversation_id, {"type": "bot_message", "content": text})
    except Exception:
        logger.exception("websocket_broadcast failed for %s", conversation_id)


def email_send_reply(*, thread_id: str, to_email: str, subject: str, body: str,
                     language: str = "en") -> None:
    """Send formal email reply via Gmail. Imported here to allow test patching."""
    try:
        from engine.email_sender import send_reply as _send
        _send(
            thread_id=thread_id,
            to_email=to_email,
            subject=subject,
            body=body,
            language=language,
        )
    except Exception:
        logger.exception("email_send_reply failed")


class SendReplyNode:

    def run(self, node: WorkflowNode, ctx: ExecutionContext) -> NodeResult:
        text = _interpolate(node.config.get("text", ""), ctx.variables)

        if not ctx.dry_run:
            channel = ctx.variables.get("channel", ctx.channel)
            if channel == "email":
                email_send_reply(
                    thread_id=ctx.variables.get("thread_id", ""),
                    to_email=ctx.variables.get("from_email", ""),
                    subject=ctx.variables.get("subject", ""),
                    body=text,
                    language=ctx.variables.get("language", "en"),
                )
            else:
                websocket_broadcast(ctx.conversation_id, text)

        return NodeResult(
            output={"reply": text},
            next_node_id=node.next_node_id,
            pause=False,
        )
