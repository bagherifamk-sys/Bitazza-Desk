"""Studio routes — workflow test-run endpoint proxied from Node.js."""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any

router = APIRouter(prefix="/studio", tags=["studio"])


class TestRunRequest(BaseModel):
    workflow: dict[str, Any]
    sample_message: str = "Hello"
    channel: str = "widget"
    category: str = "other"
    language: str = "en"
    user_id: str = "test-user"
    extra_variables: dict[str, Any] = {}


@router.post("/test-run")
def studio_test_run(body: TestRunRequest):
    """
    Dry-run a workflow against a sample message.
    Called by Node.js dashboard server (proxied from /api/studio/flows/:id/test-run).
    Returns per-step results for the Studio test panel.
    """
    try:
        from workflow_engine.store import _row_to_workflow
        from workflow_engine.test_runner import run_test_execution

        # The workflow dict may come from the DB row directly (from Node.js studio.js)
        # _row_to_workflow accepts a dict with id, name, nodes_json, edges_json, etc.
        wf_data = body.workflow
        workflow = _row_to_workflow(wf_data)

        result = run_test_execution(
            workflow=workflow,
            sample_message=body.sample_message,
            channel=body.channel,
            category=body.category,
            language=body.language,
            user_id=body.user_id,
            extra_variables=body.extra_variables or {},
        )
        return result

    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("studio test-run failed")
        return {"steps": [], "completed": False, "error": str(exc)}
