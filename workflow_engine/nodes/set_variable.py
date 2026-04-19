"""
set_variable node — sets a named variable in the execution context.

Value supports {{interpolation}} from existing variables.
"""
from __future__ import annotations
import re
from workflow_engine.models import WorkflowNode, ExecutionContext, NodeResult


def _interpolate(text: str, variables: dict) -> str:
    """Replace {{variable_name}} or {{dot.path}} with values from context variables."""
    def replacer(m):
        path = m.group(1).strip()
        if path in variables:
            return str(variables[path])
        parts = path.split(".")
        val = variables
        for part in parts:
            if isinstance(val, dict):
                val = val.get(part)
            else:
                return m.group(0)
            if val is None:
                return m.group(0)
        return str(val)
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
