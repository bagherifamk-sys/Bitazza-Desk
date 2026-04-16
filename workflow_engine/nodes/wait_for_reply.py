"""
wait_for_reply node — pauses execution until the next inbound message.

Works for both widget (next WebSocket message) and email (next email reply
on the same thread). The distinction is handled by how the engine resumes.
"""
from __future__ import annotations
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult


class WaitForReplyNode:

    def run(self, node: WorkflowNode, ctx: ExecutionContext) -> NodeResult:
        return NodeResult(
            output={},
            next_node_id=node.next_node_id,
            pause=True,
            waiting_for="message",
        )
