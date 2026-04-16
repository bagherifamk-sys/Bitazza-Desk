"""
account_lookup node — fetches account data using authenticated user_id.

user_id always comes from ExecutionContext (JWT-derived), never from node config.
Calls update_customer_from_profile on success — mandatory side effect.
"""
from __future__ import annotations
import logging
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult

logger = logging.getLogger(__name__)

_TOOL_MAP = {
    "get_user_profile":        "get_user_profile",
    "get_account_restrictions": "get_account_restrictions",
    "get_kyc_status":          "get_kyc_status",
    "get_deposit_status":      "get_deposit_status",
    "get_withdrawal_status":   "get_withdrawal_status",
    "get_trading_availability": "get_trading_availability",
}


def get_user_profile(user_id: str) -> dict:
    from engine.account_tools import get_user_profile as _fn
    return _fn(user_id=user_id)


def update_customer_from_profile(user_id: str, profile: dict) -> None:
    from db.conversation_store import update_customer_from_profile as _fn
    _fn(user_id, profile)


class AccountLookupNode:

    def run(self, node: WorkflowNode, ctx: ExecutionContext) -> NodeResult:
        tool_name = node.config.get("tool", "get_user_profile")
        user_id   = ctx.user_id  # always from authenticated context

        if tool_name not in _TOOL_MAP:
            logger.warning("Unknown account tool: %s", tool_name)
            return NodeResult(
                output={"error": f"Unknown tool: {tool_name}"},
                next_node_id=node.next_node_id,
            )

        if tool_name == "get_user_profile":
            result = get_user_profile(user_id=user_id)
            if "error" not in result:
                update_customer_from_profile(user_id, result)
            return NodeResult(
                output={"profile": result},
                next_node_id=node.next_node_id,
            )

        # Other tools
        from engine import account_tools
        fn = getattr(account_tools, tool_name, None)
        if fn is None:
            return NodeResult(
                output={"error": f"Tool not implemented: {tool_name}"},
                next_node_id=node.next_node_id,
            )
        result = fn(user_id=user_id)
        return NodeResult(
            output={tool_name: result},
            next_node_id=node.next_node_id,
        )
