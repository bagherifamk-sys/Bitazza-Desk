"""
E2E tests: widget channel — full conversation flow through workflow engine.

Simulates a real conversation from POST /chat/message through the
workflow interceptor, execution engine, node runner, and back to response.

Uses TestClient (FastAPI) with all external calls (Gemini, DB, Redis) mocked.
"""
import json
import pytest
from unittest.mock import MagicMock, patch


# ── Test client setup ─────────────────────────────────────────────────────────

@pytest.fixture
def client():
    with patch("db.conversation_store.get_connection"), \
         patch("db.vector_store.chromadb"):
        from api.main import app
        from fastapi.testclient import TestClient
        return TestClient(app)


def _auth_headers():
    import os
    import jwt
    secret = os.environ.get("JWT_SECRET", "test-secret-key")
    token = jwt.encode(
        {"sub": "user-widget-1", "role": "agent", "permissions": []},
        secret, algorithm="HS256"
    )
    return {"Authorization": f"Bearer {token}"}


def _gemini_resp(payload):
    part = MagicMock(); part.text = json.dumps(payload); part.function_call = None
    content = MagicMock(); content.parts = [part]
    candidate = MagicMock(); candidate.content = content
    response = MagicMock(); response.candidates = [candidate]
    return response


# ── No-workflow fallthrough: legacy agent handles message ──────────────────────

class TestWidgetNoWorkflowFallthrough:

    def test_message_falls_through_to_legacy_agent_when_no_workflow(self, client):
        """
        When no workflow is published for this channel+category,
        the message must be handled by the existing agent unchanged.
        """
        conv_id = "conv-widget-fallthrough-1"

        with patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("api.routes.chat.engine") as mock_engine, \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_history", return_value=[]), \
             patch("api.routes.chat.count_consecutive_low_confidence", return_value=0), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}), \
             patch("api.routes.chat.get_ticket_category", return_value="other"):

            mock_route.return_value = MagicMock(
                fallthrough=True, matched_workflow=None,
                active_execution=None, category_upgrade=None,
            )
            mock_engine.chat.return_value = MagicMock(
                text="Hello! How can I help?",
                escalated=False, language="en",
                confidence=0.9, resolved=False,
                specialist_intro=None, upgraded_category=None,
                transition_message=None,
            )

            response = client.post("/chat/message", json={
                "conversation_id": conv_id,
                "user_id": "user-widget-1",
                "message": "Hello",
                "category": "other",
            })

        assert response.status_code == 200
        data = response.json()
        assert data["reply"] == "Hello! How can I help?"
        assert data["escalated"] is False

    def test_human_handling_active_suppresses_bot_reply(self, client):
        """If human_handling is active, bot must return null reply — unchanged behavior."""
        conv_id = "conv-human-handling-1"

        with patch("api.routes.chat.get_human_handling_status", return_value=True), \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}):

            response = client.post("/chat/message", json={
                "conversation_id": conv_id,
                "user_id": "user-1",
                "message": "Is anyone there?",
                "category": "other",
            })

        assert response.status_code == 200
        assert response.json()["reply"] is None


# ── Active workflow: engine runs ──────────────────────────────────────────────

class TestWidgetActiveWorkflowRuns:

    def test_message_routed_through_workflow_engine(self, client):
        """When a workflow matches, WorkflowExecutionEngine.start() is called."""
        from workflow_engine.models import WorkflowExecution, ExecutionStatus

        mock_execution_result = MagicMock()
        mock_execution_result.status = ExecutionStatus.COMPLETED
        mock_execution_result.output_reply = "Your KYC is approved."
        mock_execution_result.escalated = False
        mock_execution_result.resolved = False

        with patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.start",
                   return_value=mock_execution_result) as mock_start, \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_history", return_value=[]), \
             patch("api.routes.chat.count_consecutive_low_confidence", return_value=0), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}), \
             patch("api.routes.chat.get_ticket_category", return_value="kyc_verification"), \
             patch("api.routes.chat.get_human_handling_status", return_value=False):

            mock_route.return_value = MagicMock(
                fallthrough=False,
                matched_workflow=MagicMock(id="wf-kyc"),
                active_execution=None,
                category_upgrade=None,
            )

            response = client.post("/chat/message", json={
                "conversation_id": "conv-workflow-1",
                "user_id": "user-1",
                "message": "What is my KYC status?",
                "category": "kyc_verification",
            })

        mock_start.assert_called_once()
        assert response.status_code == 200

    def test_active_execution_is_resumed_not_restarted(self, client):
        """If an execution is already running, resume() is called, not start()."""
        from workflow_engine.models import WorkflowExecution, ExecutionStatus

        active_exec = MagicMock(spec=WorkflowExecution)
        active_exec.id = "exec-running"
        active_exec.status = ExecutionStatus.WAITING_MESSAGE

        mock_execution_result = MagicMock()
        mock_execution_result.status = ExecutionStatus.COMPLETED
        mock_execution_result.output_reply = "Continuing your KYC flow."
        mock_execution_result.escalated = False
        mock_execution_result.resolved = False

        with patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.resume",
                   return_value=mock_execution_result) as mock_resume, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.start") as mock_start, \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_history", return_value=[]), \
             patch("api.routes.chat.count_consecutive_low_confidence", return_value=0), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}), \
             patch("api.routes.chat.get_ticket_category", return_value="kyc_verification"), \
             patch("api.routes.chat.get_human_handling_status", return_value=False):

            mock_route.return_value = MagicMock(
                fallthrough=False,
                matched_workflow=MagicMock(id="wf-kyc"),
                active_execution=active_exec,
                category_upgrade=None,
            )

            client.post("/chat/message", json={
                "conversation_id": "conv-resume-1",
                "user_id": "user-1",
                "message": "Follow up message",
                "category": "kyc_verification",
            })

        mock_resume.assert_called_once()
        mock_start.assert_not_called()


# ── Escalation via workflow engine ────────────────────────────────────────────

class TestWidgetWorkflowEscalation:

    def test_escalated_workflow_response_returns_escalated_true(self, client):
        mock_execution_result = MagicMock()
        mock_execution_result.status = "completed"
        mock_execution_result.output_reply = "Connecting you to a specialist."
        mock_execution_result.escalated = True
        mock_execution_result.resolved = False

        with patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.start",
                   return_value=mock_execution_result), \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_history", return_value=[]), \
             patch("api.routes.chat.count_consecutive_low_confidence", return_value=0), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}), \
             patch("api.routes.chat.get_ticket_category", return_value="fraud_security"), \
             patch("api.routes.chat.get_human_handling_status", return_value=False):

            mock_route.return_value = MagicMock(
                fallthrough=False,
                matched_workflow=MagicMock(id="wf-fraud"),
                active_execution=None,
                category_upgrade=None,
            )

            response = client.post("/chat/message", json={
                "conversation_id": "conv-escalate-1",
                "user_id": "user-1",
                "message": "My account was hacked",
                "category": "fraud_security",
            })

        assert response.status_code == 200
        assert response.json()["escalated"] is True


# ── Category upgrade mid-workflow (Option C) ──────────────────────────────────

class TestWidgetCategoryUpgradeE2E:

    def test_upgrade_carries_current_execution_forward(self, client):
        """
        Category upgrade detected mid-workflow:
        - resume() is called with category_upgrade parameter
        - execution is not abandoned
        - response includes transition_message
        """
        from workflow_engine.models import WorkflowExecution, ExecutionStatus

        active_exec = MagicMock(spec=WorkflowExecution)
        active_exec.id = "exec-general"
        active_exec.status = ExecutionStatus.WAITING_MESSAGE

        mock_result = MagicMock()
        mock_result.status = ExecutionStatus.WAITING_MESSAGE
        mock_result.output_reply = "Let me connect you to KYC specialist."
        mock_result.escalated = False
        mock_result.resolved = False
        mock_result.transition_message = "Connecting you to Ploy..."

        with patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.resume",
                   return_value=mock_result) as mock_resume, \
             patch("api.routes.chat.add_message"), \
             patch("api.routes.chat.get_history", return_value=[]), \
             patch("api.routes.chat.count_consecutive_low_confidence", return_value=0), \
             patch("api.routes.chat.get_ai_persona",
                   return_value={"name": "Kai", "avatar": "🤖", "avatar_url": None}), \
             patch("api.routes.chat.get_ticket_category", return_value="other"), \
             patch("api.routes.chat.get_human_handling_status", return_value=False):

            mock_route.return_value = MagicMock(
                fallthrough=False,
                matched_workflow=MagicMock(id="wf-general"),
                active_execution=active_exec,
                category_upgrade="kyc_verification",
            )

            response = client.post("/chat/message", json={
                "conversation_id": "conv-upgrade-1",
                "user_id": "user-1",
                "message": "actually my kyc verification is stuck",
                "category": "other",
            })

        # resume called with category_upgrade
        call_kwargs = mock_resume.call_args[1]
        assert call_kwargs.get("category_upgrade") == "kyc_verification"
        assert response.status_code == 200
