# Workflow Engine Test Suite

## Structure

```
tests/workflow/
├── unit/
│   ├── test_execution_engine.py     — WorkflowExecutionEngine state machine
│   ├── test_nodes.py                — All node types in isolation
│   ├── test_router.py               — WorkflowRouter trigger matching + active execution
│   ├── test_channel_adapter.py      — Widget + email normalization
│   └── test_category_upgrade.py    — Option C: upgrade preserves state, carries forward
│
├── integration/
│   ├── test_workflow_db.py          — DB store: CRUD, executions, trigger tokens, guard
│   ├── test_workflow_agent_integration.py — ai_reply node ↔ engine.agent.chat()
│   ├── test_auto_transition_guard.py — Auto-transitions skip active workflow tickets
│   └── test_email_workflow.py       — Email channel: normalization, verify flow, reply routing
│
├── regression/
│   ├── test_existing_system_unaffected.py — engine.agent.chat() contract, escalation, security order
│   └── test_default_workflows.py    — Default workflows produce identical results to legacy agent
│
└── e2e/
    ├── test_widget_workflow_e2e.py  — Full widget message → workflow → response
    ├── test_email_workflow_e2e.py   — Full email webhook → workflow → Gmail reply
    └── test_studio_test_execution.py — Studio dry-run: per-node steps, no side effects
```

## Running

```bash
# All workflow tests
pytest tests/workflow/ -v

# Unit only (fast)
pytest tests/workflow/unit/ -v

# Regression only (verify existing behavior unchanged)
pytest tests/workflow/regression/ -v

# E2E only
pytest tests/workflow/e2e/ -v

# Full suite including existing tests
pytest tests/ -v
```

## Key invariants these tests enforce

1. `security_filter` runs BEFORE generation — tested in every ai_reply test
2. `compliance_filter` runs AFTER generation — tested in every ai_reply test
3. No workflow match → legacy agent runs unchanged
4. Workflow engine failure → falls through to legacy agent
5. `update_customer_from_profile` called on every successful profile lookup
6. Email uses `status=Escalated`, widget uses `status=pending_human`
7. Auto-transitions skip tickets with active workflow executions
8. Dry-run never persists, never sends replies
9. Category upgrade (Option C) preserves all prior variables
10. Duplicate gmail_message_id never starts a second execution
