"""
Integration tests: auto-transition job must NOT fire on tickets
with an active workflow execution.

Existing auto_transitions.py is not modified — the guard is a new
is_workflow_active() check that runs before each transition.
"""
import pytest
from unittest.mock import patch, MagicMock, call


class TestAutoTransitionWorkflowGuard:

    def test_auto_transition_skips_ticket_with_active_workflow(self):
        """
        If is_workflow_active(ticket_id) returns True, update_ticket_status
        must NOT be called for that ticket.
        """
        from engine.auto_transitions import run_auto_transitions
        import asyncio

        buckets = {
            "pending_customer_expired": [
                {"id": "ticket-workflow-active", "channel": "widget"},
                {"id": "ticket-no-workflow", "channel": "widget"},
            ],
            "snoozed_expired": [],
            "resolved_expired": [],
        }

        def fake_is_active(ticket_id, **kwargs):
            return ticket_id == "ticket-workflow-active"

        with patch("engine.auto_transitions.get_tickets_for_auto_transition",
                   return_value=buckets), \
             patch("engine.auto_transitions.update_ticket_status") as mock_update, \
             patch("engine.auto_transitions.get_pending_verification_tickets",
                   return_value=[]), \
             patch("engine.auto_transitions.is_workflow_active",
                   side_effect=fake_is_active):
            asyncio.get_event_loop().run_until_complete(run_auto_transitions())

        # Only the non-workflow ticket should have been transitioned
        updated_ids = [c.args[0] for c in mock_update.call_args_list]
        assert "ticket-workflow-active" not in updated_ids
        assert "ticket-no-workflow" in updated_ids

    def test_auto_transition_processes_ticket_without_active_workflow(self):
        from engine.auto_transitions import run_auto_transitions
        import asyncio

        buckets = {
            "pending_customer_expired": [
                {"id": "ticket-free", "channel": "email"},
            ],
            "snoozed_expired": [],
            "resolved_expired": [],
        }

        with patch("engine.auto_transitions.get_tickets_for_auto_transition",
                   return_value=buckets), \
             patch("engine.auto_transitions.update_ticket_status") as mock_update, \
             patch("engine.auto_transitions.get_pending_verification_tickets",
                   return_value=[]), \
             patch("engine.auto_transitions.is_workflow_active", return_value=False):
            asyncio.get_event_loop().run_until_complete(run_auto_transitions())

        updated_ids = [c.args[0] for c in mock_update.call_args_list]
        assert "ticket-free" in updated_ids

    def test_resolved_expired_also_guarded(self):
        from engine.auto_transitions import run_auto_transitions
        import asyncio

        buckets = {
            "pending_customer_expired": [],
            "snoozed_expired": [],
            "resolved_expired": [
                {"id": "ticket-resolved-active", "channel": "widget"},
            ],
        }

        with patch("engine.auto_transitions.get_tickets_for_auto_transition",
                   return_value=buckets), \
             patch("engine.auto_transitions.update_ticket_status") as mock_update, \
             patch("engine.auto_transitions.get_pending_verification_tickets",
                   return_value=[]), \
             patch("engine.auto_transitions.is_workflow_active", return_value=True):
            asyncio.get_event_loop().run_until_complete(run_auto_transitions())

        mock_update.assert_not_called()

    def test_snoozed_expired_also_guarded(self):
        from engine.auto_transitions import run_auto_transitions
        import asyncio

        buckets = {
            "pending_customer_expired": [],
            "snoozed_expired": [
                {"id": "ticket-snoozed-active"},
                {"id": "ticket-snoozed-free"},
            ],
            "resolved_expired": [],
        }

        def fake_is_active(tid, **kwargs):
            return tid == "ticket-snoozed-active"

        with patch("engine.auto_transitions.get_tickets_for_auto_transition",
                   return_value=buckets), \
             patch("engine.auto_transitions.update_ticket_status") as mock_update, \
             patch("engine.auto_transitions.get_pending_verification_tickets",
                   return_value=[]), \
             patch("engine.auto_transitions.is_workflow_active",
                   side_effect=fake_is_active):
            asyncio.get_event_loop().run_until_complete(run_auto_transitions())

        updated_ids = [c.args[0] for c in mock_update.call_args_list]
        assert "ticket-snoozed-active" not in updated_ids
        assert "ticket-snoozed-free" in updated_ids

    def test_existing_behavior_unchanged_when_no_workflow_module(self):
        """
        If is_workflow_active import fails (module not yet present), auto_transitions
        must fall back to processing all tickets as before. Backward compatibility.
        """
        from engine.auto_transitions import run_auto_transitions
        import asyncio

        buckets = {
            "pending_customer_expired": [{"id": "ticket-1", "channel": "widget"}],
            "snoozed_expired": [],
            "resolved_expired": [],
        }

        with patch("engine.auto_transitions.get_tickets_for_auto_transition",
                   return_value=buckets), \
             patch("engine.auto_transitions.update_ticket_status") as mock_update, \
             patch("engine.auto_transitions.get_pending_verification_tickets",
                   return_value=[]), \
             patch("engine.auto_transitions.is_workflow_active",
                   side_effect=ImportError("module not found")):
            # Should not crash — falls back gracefully
            asyncio.get_event_loop().run_until_complete(run_auto_transitions())

        # Ticket is still processed (fail-open: don't block transitions on guard failure)
        updated_ids = [c.args[0] for c in mock_update.call_args_list]
        assert "ticket-1" in updated_ids
