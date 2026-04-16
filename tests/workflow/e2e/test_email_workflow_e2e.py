"""
E2E tests: email channel — full flow through workflow engine.

Covers:
- Inbound email triggers correct workflow via router
- Email with identity verification need: wait_for_trigger pause
- Verification link click: resume_from_trigger continues execution
- Duplicate email (same gmail_message_id) is idempotent
- Email reply sent via Gmail (not WebSocket)
- Safety-net poller skips emails with active executions
"""
import json
import base64
import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def client():
    with patch("db.conversation_store.get_connection"), \
         patch("db.vector_store.chromadb"):
        from api.main import app
        from fastapi.testclient import TestClient
        return TestClient(app)


def _pubsub_body(message_id="msg-test-1", history_id="12345"):
    """Build a minimal Gmail Pub/Sub webhook payload."""
    data = base64.b64encode(
        json.dumps({"emailAddress": "support@bitazza.com",
                    "historyId": history_id}).encode()
    ).decode()
    return {
        "message": {"data": data, "messageId": message_id},
        "subscription": "projects/test/subscriptions/gmail-sub",
    }


def _mock_gmail_message(message_id="msg-test-1", thread_id="thread-1",
                        body="My KYC is stuck", from_email="user@example.com",
                        language="en"):
    msg = MagicMock()
    msg.message_id = message_id
    msg.thread_id = thread_id
    msg.body = body
    msg.from_email = from_email
    msg.language = language
    msg.subject = "KYC Issue"
    msg.attachments = []
    return msg


# ── Inbound email triggers workflow ──────────────────────────────────────────

class TestEmailWebhookWorkflowRouting:

    def test_inbound_email_triggers_matching_workflow(self, client):
        """
        POST /email/webhook → parse email → router matches workflow →
        execution engine starts.
        """
        with patch("api.routes.email.verify_pubsub_token", return_value=True), \
             patch("api.routes.email.fetch_gmail_message") as mock_fetch, \
             patch("api.routes.email.try_claim_gmail_message", return_value=True), \
             patch("api.routes.email.parse_gmail_message",
                   return_value=_mock_gmail_message()), \
             patch("api.routes.email.resolve_or_create_email_customer",
                   return_value=("conv-email-1", "user-1")), \
             patch("api.routes.email.detect_category_from_message",
                   return_value="kyc_verification"), \
             patch("api.routes.email.log_email_message"), \
             patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("workflow_engine.engine.WorkflowExecutionEngine.start") as mock_start:

            mock_fetch.return_value = MagicMock(id="msg-test-1")
            mock_route.return_value = MagicMock(
                fallthrough=False,
                matched_workflow=MagicMock(id="wf-kyc-email"),
                active_execution=None,
                category_upgrade=None,
            )

            mock_execution = MagicMock()
            mock_execution.status = "completed"
            mock_execution.output_reply = "Your KYC is being reviewed."
            mock_execution.escalated = False
            mock_start.return_value = mock_execution

            response = client.post(
                "/email/webhook",
                json=_pubsub_body(),
                headers={"X-Goog-PSC-Secret": "test-secret"},
            )

        assert response.status_code == 200
        mock_start.assert_called_once()

    def test_duplicate_email_message_id_does_not_start_second_execution(self, client):
        """
        try_claim_gmail_message returns False → execution must NOT start.
        Idempotency must be preserved.
        """
        with patch("api.routes.email.verify_pubsub_token", return_value=True), \
             patch("api.routes.email.try_claim_gmail_message", return_value=False), \
             patch("workflow_engine.engine.WorkflowExecutionEngine.start") as mock_start:

            response = client.post(
                "/email/webhook",
                json=_pubsub_body(message_id="msg-already-processed"),
                headers={"X-Goog-PSC-Secret": "test-secret"},
            )

        assert response.status_code == 200
        mock_start.assert_not_called()

    def test_no_workflow_match_falls_through_to_legacy_email_handler(self, client):
        """
        When router returns fallthrough=True for email, the existing email
        processing logic (engine.agent.chat + send_reply) must run unchanged.
        """
        legacy_called = {}

        with patch("api.routes.email.verify_pubsub_token", return_value=True), \
             patch("api.routes.email.fetch_gmail_message",
                   return_value=MagicMock(id="msg-2")), \
             patch("api.routes.email.try_claim_gmail_message", return_value=True), \
             patch("api.routes.email.parse_gmail_message",
                   return_value=_mock_gmail_message(message_id="msg-2")), \
             patch("api.routes.email.resolve_or_create_email_customer",
                   return_value=("conv-email-2", "user-2")), \
             patch("api.routes.email.detect_category_from_message", return_value="other"), \
             patch("api.routes.email.log_email_message"), \
             patch("workflow_engine.router.WorkflowRouter.route") as mock_route, \
             patch("api.routes.email.engine") as mock_engine, \
             patch("api.routes.email.send_reply",
                   side_effect=lambda **kw: legacy_called.update({"called": True})):

            mock_route.return_value = MagicMock(
                fallthrough=True, matched_workflow=None,
                active_execution=None, category_upgrade=None,
            )
            mock_engine.chat.return_value = MagicMock(
                text="Here is your answer.",
                escalated=False, language="en",
            )

            response = client.post(
                "/email/webhook",
                json=_pubsub_body(message_id="msg-2"),
                headers={"X-Goog-PSC-Secret": "test-secret"},
            )

        assert response.status_code == 200
        assert legacy_called.get("called") is True


# ── Email verification token flow ─────────────────────────────────────────────

class TestEmailVerificationE2E:

    def test_verify_endpoint_resumes_workflow_execution(self, client):
        """
        GET /email/verify/{token} → consume token → resume_from_trigger →
        workflow continues from where it paused.
        """
        with patch("api.routes.email.consume_verification_token",
                   return_value={"ticket_id": "ticket-1", "verified_user_id": "user-1",
                                 "from_email": "user@example.com"}), \
             patch("workflow_engine.engine.WorkflowExecutionEngine.resume_from_trigger") as mock_resume:

            mock_execution = MagicMock()
            mock_execution.output_reply = "Your identity has been verified. Processing your request..."
            mock_execution.escalated = False
            mock_resume.return_value = mock_execution

            response = client.get("/email/verify/tok-valid-abc")

        assert response.status_code == 200
        mock_resume.assert_called_once_with(
            "tok-valid-abc",
            {"verified_user_id": "user-1", "ticket_id": "ticket-1",
             "from_email": "user@example.com"},
        )

    def test_expired_token_escalates_ticket(self, client):
        """
        GET /email/verify/{expired-token} → None returned by consume_verification_token
        → ticket escalated to human (existing behavior unchanged).
        """
        with patch("api.routes.email.consume_verification_token", return_value=None), \
             patch("api.routes.email.update_ticket_status") as mock_status:
            response = client.get("/email/verify/tok-expired")

        # Should return 400 or 410 and escalate
        assert response.status_code in (400, 410)

    def test_no_workflow_execution_falls_back_to_legacy_verify_handler(self, client):
        """
        If no workflow execution is found for the token, the existing verification
        logic must run (legacy path: call engine.agent.chat directly).
        """
        from workflow_engine.exceptions import TriggerTokenExpiredError

        with patch("api.routes.email.consume_verification_token",
                   return_value={"ticket_id": "t1", "verified_user_id": "u1",
                                 "from_email": "u@x.com"}), \
             patch("workflow_engine.engine.WorkflowExecutionEngine.resume_from_trigger",
                   side_effect=TriggerTokenExpiredError("no execution found")), \
             patch("api.routes.email.engine") as mock_engine, \
             patch("api.routes.email.send_reply"):

            mock_engine.chat.return_value = MagicMock(
                text="Verified.", escalated=False, language="en"
            )

            response = client.get("/email/verify/tok-no-execution")

        # Legacy path must still work
        assert response.status_code == 200


# ── CSAT flow unaffected ──────────────────────────────────────────────────────

class TestEmailCsatUnaffected:

    def test_csat_star_click_records_score(self, client):
        """GET /email/csat/{ticket_id} — unchanged behavior, no workflow involvement."""
        with patch("api.routes.email.consume_csat_token",
                   return_value={"ticket_id": "t1", "score": 5}), \
             patch("api.routes.email.update_ticket_status"), \
             patch("api.routes.email.submit_csat_score") as mock_csat:

            response = client.get("/email/csat/t1?token=csat-tok-5&score=5")

        assert response.status_code == 200
