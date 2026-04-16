-- Migration 007: Workflow Engine
-- Additive only — no changes to existing tables.
-- Adds: workflows, workflow_executions, workflow_active flag on tickets.

-- ── workflows ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    trigger_channel  TEXT NOT NULL DEFAULT 'any',   -- 'widget' | 'email' | 'any'
    trigger_category TEXT NOT NULL DEFAULT 'any',   -- 'kyc_verification' | ... | 'any'
    nodes_json       JSONB NOT NULL DEFAULT '[]',
    edges_json       JSONB NOT NULL DEFAULT '[]',
    published        BOOLEAN NOT NULL DEFAULT FALSE,
    version          INTEGER NOT NULL DEFAULT 1,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    published_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_published
    ON workflows (published, trigger_channel, trigger_category);

-- ── workflow_executions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_executions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id      UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    conversation_id  TEXT NOT NULL,   -- matches tickets.id
    current_node_id  TEXT,
    variables_json   JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'running',
                     -- running | waiting_message | waiting_trigger
                     -- completed | failed | abandoned
    waiting_for      TEXT,            -- NULL | 'message' | 'external_trigger:{token}'
    channel          TEXT NOT NULL,   -- 'widget' | 'email'
    category         TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_conversation
    ON workflow_executions (conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_waiting_for
    ON workflow_executions (waiting_for)
    WHERE waiting_for IS NOT NULL;

-- ── workflow_active flag on tickets ────────────────────────────────────────
-- Allows auto_transitions.py to fast-check without joining executions.

ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS workflow_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tickets_workflow_active
    ON tickets (workflow_active)
    WHERE workflow_active = TRUE;

-- ── Updated-at trigger (shared pattern) ───────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_workflows_updated_at ON workflows;
CREATE TRIGGER set_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_workflow_executions_updated_at ON workflow_executions;
CREATE TRIGGER set_workflow_executions_updated_at
    BEFORE UPDATE ON workflow_executions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
