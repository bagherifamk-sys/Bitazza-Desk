"""
Unit tests for workflow_engine.channel_adapter.

Verifies that both widget and email inputs are normalized into a
consistent ChannelMessage, and that channel-specific reply functions
are wired correctly.
"""
import pytest
from unittest.mock import MagicMock, patch


# ── Widget adapter ────────────────────────────────────────────────────────────

class TestWidgetAdapter:

    def test_normalizes_widget_request_to_channel_message(self):
        from workflow_engine.channel_adapter import WidgetAdapter

        adapter = WidgetAdapter()
        msg = adapter.normalize(
            text="I need help with my KYC",
            conversation_id="conv-1",
            user_id="user-42",
            category="kyc_verification",
            language="en",
            metadata={},
        )

        assert msg.text == "I need help with my KYC"
        assert msg.channel == "widget"
        assert msg.conversation_id == "conv-1"
        assert msg.user_id == "user-42"
        assert msg.category == "kyc_verification"
        assert msg.language == "en"

    def test_widget_reply_fn_calls_websocket_broadcast(self):
        from workflow_engine.channel_adapter import WidgetAdapter

        adapter = WidgetAdapter()
        mock_broadcast = MagicMock()

        reply_fn = adapter.make_reply_fn(
            conversation_id="conv-1",
            broadcast_fn=mock_broadcast,
        )
        reply_fn("Your KYC is approved.")
        mock_broadcast.assert_called_once_with("conv-1", "Your KYC is approved.")

    def test_widget_adapter_sets_channel_widget(self):
        from workflow_engine.channel_adapter import WidgetAdapter
        adapter = WidgetAdapter()
        msg = adapter.normalize("hello", "conv-1", "user-1", "other", "en", {})
        assert msg.channel == "widget"

    def test_widget_adapter_preserves_metadata(self):
        from workflow_engine.channel_adapter import WidgetAdapter
        adapter = WidgetAdapter()
        meta = {"session_id": "sess-abc", "platform": "mobile"}
        msg = adapter.normalize("hi", "conv-1", "user-1", "other", "en", meta)
        assert msg.metadata["session_id"] == "sess-abc"


# ── Email adapter ─────────────────────────────────────────────────────────────

class TestEmailAdapter:

    def test_normalizes_parsed_email_to_channel_message(self):
        from workflow_engine.channel_adapter import EmailAdapter

        parsed_email = MagicMock()
        parsed_email.body = "I cannot withdraw my funds"
        parsed_email.thread_id = "thread-123"
        parsed_email.message_id = "msg-456"
        parsed_email.from_email = "customer@example.com"
        parsed_email.language = "en"

        adapter = EmailAdapter()
        msg = adapter.normalize(
            parsed_email=parsed_email,
            conversation_id="conv-email-1",
            user_id="user-99",
            category="withdrawal_issue",
        )

        assert msg.text == "I cannot withdraw my funds"
        assert msg.channel == "email"
        assert msg.conversation_id == "conv-email-1"
        assert msg.metadata["thread_id"] == "thread-123"
        assert msg.metadata["message_id"] == "msg-456"
        assert msg.metadata["from_email"] == "customer@example.com"

    def test_email_reply_fn_calls_send_reply(self):
        from workflow_engine.channel_adapter import EmailAdapter

        adapter = EmailAdapter()
        mock_send = MagicMock()

        reply_fn = adapter.make_reply_fn(
            thread_id="thread-123",
            to_email="customer@example.com",
            subject="Re: Withdrawal Issue",
            send_fn=mock_send,
        )
        reply_fn("Your withdrawal is being processed.")
        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args
        assert "Your withdrawal is being processed." in str(call_kwargs)

    def test_email_adapter_sets_channel_email(self):
        from workflow_engine.channel_adapter import EmailAdapter

        parsed = MagicMock()
        parsed.body = "test"
        parsed.thread_id = "t1"
        parsed.message_id = "m1"
        parsed.from_email = "x@y.com"
        parsed.language = "en"

        adapter = EmailAdapter()
        msg = adapter.normalize(parsed, "conv-1", "user-1", "other")
        assert msg.channel == "email"

    def test_email_adapter_language_from_parsed_email(self):
        from workflow_engine.channel_adapter import EmailAdapter

        parsed = MagicMock()
        parsed.body = "สวัสดี"
        parsed.thread_id = "t1"
        parsed.message_id = "m1"
        parsed.from_email = "x@y.com"
        parsed.language = "th"

        adapter = EmailAdapter()
        msg = adapter.normalize(parsed, "conv-1", "user-1", "other")
        assert msg.language == "th"


# ── Built-in variables ────────────────────────────────────────────────────────

class TestChannelAdapterBuiltins:

    def test_builtin_variables_all_present(self):
        from workflow_engine.channel_adapter import WidgetAdapter
        adapter = WidgetAdapter()
        msg = adapter.normalize("hi", "conv-abc", "user-xyz", "other", "th", {})
        assert msg.conversation_id == "conv-abc"
        assert msg.user_id == "user-xyz"
        assert msg.language == "th"
        assert msg.channel == "widget"

    def test_language_detection_fallback(self):
        """If no language passed, adapter detects from text."""
        from workflow_engine.channel_adapter import WidgetAdapter
        adapter = WidgetAdapter()
        # Thai text
        msg = adapter.normalize("สวัสดีครับ ต้องการความช่วยเหลือ", "conv-1", "u-1", "other",
                                language=None, metadata={})
        assert msg.language == "th"

    def test_english_detection_fallback(self):
        from workflow_engine.channel_adapter import WidgetAdapter
        adapter = WidgetAdapter()
        msg = adapter.normalize("Hello I need help with my account", "conv-1", "u-1", "other",
                                language=None, metadata={})
        assert msg.language == "en"
