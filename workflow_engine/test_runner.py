"""
Dry-run test execution for the AI Studio.

run_test_execution() runs a workflow against a sample message without:
  - persisting execution state to DB
  - sending any replies (WebSocket or email)
  - modifying any tickets

Returns a list of step results (per-node input/output/variables_after/error)
for display in the studio UI.
"""
from __future__ import annotations
import uuid
import logging
from typing import Any
from workflow_engine.models import (
    Workflow, WorkflowNode, ExecutionContext, ExecutionStatus, WorkflowExecution,
)

logger = logging.getLogger(__name__)


def build_dry_run_context(
    sample_message: str,
    channel: str,
    category: str,
    language: str,
    user_id: str = "test-user",
    conversation_id: str | None = None,
    extra_variables: dict | None = None,
) -> ExecutionContext:
    cid = conversation_id or str(uuid.uuid4())  # must be valid UUID for DB queries
    variables = {
        "language":        language,
        "channel":         channel,
        "category":        category,
        "user_id":         user_id,
        "conversation_id": cid,
        "user_message":    sample_message,
        "consecutive_low_confidence": 0,
    }
    if extra_variables:
        variables.update(extra_variables)
    return ExecutionContext(
        variables=variables,
        conversation_id=cid,
        user_id=user_id,
        channel=channel,
        dry_run=True,
    )


def run_test_execution(
    workflow: Workflow,
    sample_message: str,
    channel: str,
    category: str,
    language: str,
    user_id: str = "test-user",
    extra_variables: dict | None = None,
) -> dict[str, Any]:
    """
    Execute a workflow in dry-run mode.

    Returns:
        {
          "steps": [...],   # per-node step results
          "completed": bool,
          "error": str | None,
        }
    """
    from workflow_engine.engine import _get_node_runner

    ctx = build_dry_run_context(
        sample_message=sample_message,
        channel=channel,
        category=category,
        language=language,
        user_id=user_id,
        extra_variables=extra_variables,
    )

    steps: list[dict] = []
    current_node_id = workflow.first_node().id if workflow.first_node() else None
    error: str | None = None
    completed = False

    while current_node_id:
        node = workflow.get_node(current_node_id)
        if node is None:
            error = f"Node {current_node_id} not found in workflow"
            break

        step_input = dict(ctx.variables)

        try:
            runner = _get_node_runner(node.kind)
            result = runner.run(node, ctx)

            # Merge outputs into context for next node
            ctx.variables.update(result.output)

            steps.append({
                "node_id":        node.id,
                "kind":           node.kind,
                "input":          step_input,
                "output":         result.output,
                "variables_after": dict(ctx.variables),
                "error":          None,
                "paused":         result.pause,
                "waiting_for":    result.waiting_for,
            })

            if result.pause:
                # Execution paused — show the pause step and stop
                completed = False
                break

            current_node_id = result.next_node_id

        except Exception as exc:
            steps.append({
                "node_id":        node.id,
                "kind":           node.kind,
                "input":          step_input,
                "output":         None,
                "variables_after": dict(ctx.variables),
                "error":          str(exc),
                "paused":         False,
                "waiting_for":    None,
            })
            error = f"Execution stopped at node {node.id}: {exc}"
            completed = False
            break
    else:
        completed = True

    # Build conversation preview (what the customer would actually see)
    conversation: list[dict] = [{"role": "user", "text": sample_message}]
    for step in steps:
        out = step.get("output") or {}
        if out.get("reply"):
            conversation.append({"role": "bot", "text": out["reply"]})
        if out.get("escalated"):
            conversation.append({"role": "system", "text": "→ Escalated to human agent"})
        elif out.get("resolved"):
            conversation.append({"role": "system", "text": "✓ Ticket resolved"})
        if step.get("paused"):
            conversation.append({"role": "system", "text": "⏸ Waiting for customer reply"})

    return {
        "steps":        steps,
        "completed":    completed,
        "error":        error,
        "conversation": conversation,
    }
