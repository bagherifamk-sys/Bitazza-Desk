"""
condition node — evaluates a variable against a value and routes to
true_next or false_next.

Operators: == != contains starts_with > <
Missing variable always takes false_next.
"""
from __future__ import annotations
import logging
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult

logger = logging.getLogger(__name__)


def _evaluate(variable_value: str, operator: str, test_value: str) -> bool:
    try:
        if operator == "==":
            return str(variable_value) == str(test_value)
        if operator == "!=":
            return str(variable_value) != str(test_value)
        if operator == "contains":
            return str(test_value).lower() in str(variable_value).lower()
        if operator == "starts_with":
            return str(variable_value).lower().startswith(str(test_value).lower())
        if operator == ">":
            return float(variable_value) > float(test_value)
        if operator == "<":
            return float(variable_value) < float(test_value)
    except (ValueError, TypeError):
        pass
    return False


class ConditionNode:

    def run(self, node: WorkflowNode, ctx: ExecutionContext) -> NodeResult:
        variable  = node.config.get("variable", "")
        operator  = node.config.get("operator", "==")
        value     = node.config.get("value", "")
        true_next = node.config.get("true_next")
        false_next = node.config.get("false_next")

        var_value = ctx.variables.get(variable)
        if var_value is None:
            branch = "false"
            next_id = false_next
        elif _evaluate(var_value, operator, value):
            branch = "true"
            next_id = true_next
        else:
            branch = "false"
            next_id = false_next

        return NodeResult(
            output={"branch": branch, "next_node_id": next_id},
            next_node_id=next_id,
        )
