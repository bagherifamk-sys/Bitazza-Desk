-- Migration 007: Notification channel configs for scheduled reports
-- Stores per-channel credentials and report preferences for daily/weekly reports.

CREATE TABLE IF NOT EXISTS notification_channel_configs (
    channel     VARCHAR PRIMARY KEY,          -- 'slack' | 'teams' | 'discord' | 'line' | 'email' | 'notion' | 'confluence'
    enabled     BOOLEAN NOT NULL DEFAULT false,
    config      JSONB    NOT NULL DEFAULT '{}',   -- credentials: webhook_url, token, to_emails, page_id, etc.
    reports     JSONB    NOT NULL DEFAULT '{"daily": true, "weekly": true}',
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
