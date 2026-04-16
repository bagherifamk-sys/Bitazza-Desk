"""Workflow engine exception types."""


class TriggerTokenExpiredError(Exception):
    """Raised when a trigger token is not found or has already been consumed."""


class WorkflowNotFoundError(Exception):
    """Raised when a workflow_id references a workflow that doesn't exist."""


class NodeExecutionError(Exception):
    """Raised when a node fails and the error should be captured as a step result."""
    def __init__(self, node_id: str, message: str):
        self.node_id = node_id
        super().__init__(f"Node {node_id}: {message}")
