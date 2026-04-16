"""
set_variable node — sets a named variable in the execution context.

Value supports {{interpolation}} from existing variables.
"""
from __future__ import annotations
import re
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult


def _interpolate(text: str, variables: dict) -> str:
    def replacer(m):
        key = m.group(1).strip()
        return str(variables.get(key, m.group(0)))
    return re.sub(r"\{\{([^}]+)\}\}", replacer, text)


class SetVariableNode:

    def run(self, node: WorkflowNode, ctx: ExecutionContext) -> NodeResult:
        variable = node.config.get("variable", "")
        raw_value = node.config.get("value", "")
        value = _interpolate(str(raw_value), ctx.variables)

        return NodeResult(
            output={variable: value},
            next_node_id=node.next_node_id,
        )
