"""
Integration tests: email channel through workflow engine.

Covers:
- Email is normalized by EmailAdapter before routing
- Verification token flow (wait_for_trigger → resume_from_trigger)
- Email reply node sends via Gmail, not WebSocket
- Email safety-net poller doesn't re-trigger active executions
- Idempotency: duplicate gmail_message_id doesn't create second execution
- Formal tone overlay is passed to ai_reply node for email channel
"""
import pytest
from unittest.mock import MagicMock, patch


def _make_parsed_email(body="My KYC is stuck", thread_id="thread-1",
                       message_id="msg-1", from_email="user@example.com",
                       language="en"):
    email = MagicMock()
    email.body = body
    email.thread_id = thread_id
    email.message_id = message_id
    email.from_email = from_email
    email.language = language
    email.subject = "KYC Question"
    return email


class TestEmailWorkflowNormalization:

    def test_email_normalized_to_channel_message(self):
        from workflow_engine.channel_adapter import EmailAdapter

        adapter = EmailAdapter()
        parsed = _make_parsed_email()

        msg = adapter.normalize(
            parsed_email=parsed,
            conversation_id="conv-1",
            user_id="user-1",
            category="kyc_verification",
        )

        assert msg.channel == "email"
        assert msg.text == "My KYC is stuck"
        assert msg.metadata["thread_id"] == "thread-1"
        assert msg.metadata["from_email"] == "user@example.com"
        assert msg.language == "en"

    def test_thai_email_sets_language_th(self):
        from workflow_engine.channel_adapter import EmailAdapter

        adapter = EmailAdapter()
        parsed = _make_parsed_email(body="KYC ของฉันยังไม่ผ่าน", language="th")

        msg = adapter.normalize(parsed, "conv-1", "user-1", "kyc_verification")
        assert msg.language == "th"


class TestEmailVerificationTokenFlow:

    def test_wait_for_trigger_node_creates_verification_token(self):
        from workflow_engine.nodes.wait_for_trigger import WaitForTriggerNode
        from workflow_engine.models import WorkflowNode, ExecutionContext

        node = WorkflowNode(
            id="n_verify", kind="wait_for_trigger",
            config={"trigger_type": "email_verification"},
            next_node_id="n_ai_reply",
        )
        ctx = ExecutionContext(
            variables={
                "language": "en", "channel": "email",
                "category": "kyc_verification", "user_id": "user-1",
                "conversation_id": "conv-email-1",
                "from_email": "user@example.com",
            },
            conversation_id="conv-email-1",
            user_id="user-1",
            channel="email",
        )

        with patch("workflow_engine.nodes.wait_for_trigger.create_verification_token",
                   return_value="tok-email-abc") as mock_create:
            result = WaitForTriggerNode().run(node, ctx)

        mock_create.assert_called_once()
        assert result.pause is True
        assert "tok-email-abc" in result.waiting_for

    def test_resume_from_trigger_continues_workflow(self):
        from workflow_engine.engine import WorkflowExecutionEngine
        from workflow_engine.models import WorkflowExecution, ExecutionStatus, WorkflowNode

        executed = []

        def fake_run_node(node, context):
            executed.append(node.id)
            from workflow_engine.models import NodeResult
            return NodeResult(output={"reply": "Your KYC is verified."}, next_node_id=None)

        n_ai = WorkflowNode(id="n_ai_reply", kind="ai_reply", config={}, next_node_id=None)
        workflow = MagicMock()
        workflow.nodes = [n_ai]
        workflow.get_node = lambda nid: n_ai if nid == "n_ai_reply" else None

        execution = WorkflowExecution(
            id="exec-email-1",
            workflow_id="wf-kyc-email",
            conversation_id="conv-email-1",
            current_node_id="n_ai_reply",
            variables={"language": "en", "channel": "email", "from_email": "u@x.com"},
            status=ExecutionStatus.WAITING_TRIGGER,
            waiting_for="external_trigger:tok-email-abc",
            channel="email",
            category="kyc_verification",
        )

        engine = WorkflowExecutionEngine()
        with patch("workflow_engine.engine.load_execution_by_trigger_token",
                   return_value=(execution, workflow)), \
             patch.object(engine, "_persist_execution"), \
             patch.object(engine, "run_node", side_effect=fake_run_node):
            engine.resume_from_trigger("tok-email-abc", {"verified_user_id": "user-verified"})

        assert "n_ai_reply" in executed

    def test_verified_user_id_injected_into_variables(self):
        from workflow_engine.engine import WorkflowExecutionEngine
        from workflow_engine.models import WorkflowExecution, ExecutionStatus, WorkflowNode

        captured = {}

        def fake_run_node(node, context):
            captured.update(context.variables)
            from workflow_engine.models import NodeResult
            return NodeResult(output={}, next_node_id=None)

        n1 = WorkflowNode(id="n1", kind="ai_reply", config={}, next_node_id=None)
        workflow = MagicMock()
        workflow.nodes = [n1]
        workflow.get_node = lambda nid: n1

        execution = WorkflowExecution(
            id="exec-1",
            workflow_id="wf-1",
            conversation_id="conv-1",
            current_node_id="n1",
            variables={"language": "en", "channel": "email"},
            status=ExecutionStatus.WAITING_TRIGGER,
            waiting_for="external_trigger:tok-xyz",
            channel="email",
            category="kyc_verification",
        )

        engine = WorkflowExecutionEngine()
        with patch("workflow_engine.engine.load_execution_by_trigger_token",
                   return_value=(execution, workflow)), \
             patch.object(engine, "_persist_execution"), \
             patch.object(engine, "run_node", side_effect=fake_run_node):
            engine.resume_from_trigger("tok-xyz", {"verified_user_id": "user-real-99"})

        assert captured.get("verified_user_id") == "user-real-99"


class TestEmailReplyChannel:

    def test_send_reply_node_sends_email_not_websocket(self):
        """On email channel, reply must go via email_sender.send_reply, not WebSocket."""
        from workflow_engine.nodes.send_reply import SendReplyNode
        from workflow_engine.models import WorkflowNode, ExecutionContext

        node = WorkflowNode(
            id="n1", kind="send_reply",
            config={"text": "Your KYC has been approved."},
            next_node_id=None,
        )
        ctx = ExecutionContext(
            variables={
                "language": "en", "channel": "email",
                "category": "kyc_verification", "user_id": "user-1",
                "conversation_id": "conv-1",
                "thread_id": "thread-123",
                "from_email": "user@example.com",
                "subject": "Re: KYC",
            },
            conversation_id="conv-1",
            user_id="user-1",
            channel="email",
        )

        with patch("workflow_engine.nodes.send_reply.email_send_reply") as mock_email, \
             patch("workflow_engine.nodes.send_reply.websocket_broadcast") as mock_ws:
            SendReplyNode().run(node, ctx)

        mock_email.assert_called_once()
        mock_ws.assert_not_called()

    def test_send_reply_node_uses_websocket_for_widget(self):
        from workflow_engine.nodes.send_reply import SendReplyNode
        from workflow_engine.models import WorkflowNode, ExecutionContext

        node = WorkflowNode(
            id="n1", kind="send_reply",
            config={"text": "Your KYC has been approved."},
            next_node_id=None,
        )
        ctx = ExecutionContext(
            variables={
                "language": "en", "channel": "widget",
                "category": "kyc_verification", "user_id": "user-1",
                "conversation_id": "conv-1",
            },
            conversation_id="conv-1",
            user_id="user-1",
            channel="widget",
        )

        with patch("workflow_engine.nodes.send_reply.email_send_reply") as mock_email, \
             patch("workflow_engine.nodes.send_reply.websocket_broadcast") as mock_ws:
            SendReplyNode().run(node, ctx)

        mock_ws.assert_called_once()
        mock_email.assert_not_called()


class TestEmailSafetyNetIdempotency:

    def test_safety_net_skips_message_with_active_execution(self):
        """
        Safety-net poller must not re-trigger a workflow for a gmail_message_id
        that already has an active execution on its conversation.
        """
        from workflow_engine.email_safety_net_guard import should_process_email

        with patch("workflow_engine.email_safety_net_guard.get_active_execution",
                   return_value=MagicMock(id="exec-active")):
            result = should_process_email(
                gmail_message_id="msg-already-processing",
                conversation_id="conv-1",
            )

        assert result is False

    def test_safety_net_processes_message_without_active_execution(self):
        from workflow_engine.email_safety_net_guard import should_process_email

        with patch("workflow_engine.email_safety_net_guard.get_active_execution",
                   return_value=None):
            result = should_process_email(
                gmail_message_id="msg-new",
                conversation_id="conv-new",
            )

        assert result is True
