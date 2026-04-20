-- Migration 009: notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,          -- 'agent' | 'supervisor' | 'all'
  type        TEXT NOT NULL,          -- 'sla_breach' | 'sla_warning' | 'assigned' | 'vip_waiting' | 'agent_offline' | 'whisper' | 'escalated' | 'customer_reply'
  priority    TEXT NOT NULL,          -- 'critical' | 'high' | 'medium' | 'info'
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  ticket_id   TEXT,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_created
  ON notifications(user_id, read, created_at DESC);
