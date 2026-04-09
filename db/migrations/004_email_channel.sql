-- Migration 004: Email channel support
-- Run with: psql $DATABASE_URL -f db/migrations/004_email_channel.sql

-- 1. Add gmail_thread_id to tickets for fast thread → ticket lookup
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
    ADD COLUMN IF NOT EXISTS subject         TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_gmail_thread_id ON tickets(gmail_thread_id)
    WHERE gmail_thread_id IS NOT NULL;

-- 2. Add 'Escalated' as a valid ticket status (alongside existing Open_Live, In_Progress, etc.)
-- PostgreSQL enums require ALTER TYPE; if status is a plain TEXT column this is a no-op constraint.
-- Check your schema — if status uses an ENUM type, run the ALTER TYPE variant below instead.
-- TEXT column variant (most likely based on existing code):
-- No DDL needed — TEXT columns accept any value.

-- ENUM variant (only if tickets.status is an ENUM type):
-- DO $$
-- BEGIN
--     IF NOT EXISTS (
--         SELECT 1 FROM pg_enum
--         WHERE enumtypid = 'ticket_status'::regtype
--           AND enumlabel = 'Escalated'
--     ) THEN
--         ALTER TYPE ticket_status ADD VALUE 'Escalated';
--     END IF;
-- END$$;

-- 3. Per-email-message log (one row per individual email in a thread)
CREATE TABLE IF NOT EXISTS email_threads (
    id               TEXT PRIMARY KEY,
    ticket_id        UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    gmail_thread_id  TEXT        NOT NULL,
    gmail_message_id TEXT        NOT NULL,  -- Google's Message-ID, unique per email
    direction        TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    from_email       TEXT,
    from_name        TEXT,
    subject          TEXT,
    snippet          TEXT,                  -- first 200 chars, for dashboard previews
    attachments      JSONB       NOT NULL DEFAULT '[]',
    raw_headers      JSONB       NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_threads_message_id
    ON email_threads(gmail_message_id);

CREATE INDEX IF NOT EXISTS idx_email_threads_ticket_id
    ON email_threads(ticket_id);

CREATE INDEX IF NOT EXISTS idx_email_threads_thread_id
    ON email_threads(gmail_thread_id);

-- 4. Signed one-time tokens for email identity verification
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token       TEXT        PRIMARY KEY,
    ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_email  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,                -- NULL = not yet used
    verified_user_id TEXT,                 -- populated on successful verification
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verify_tokens_ticket
    ON email_verification_tokens(ticket_id);

CREATE INDEX IF NOT EXISTS idx_email_verify_tokens_expires
    ON email_verification_tokens(expires_at)
    WHERE used_at IS NULL;

-- 5. CSAT tokens for email star-rating links
CREATE TABLE IF NOT EXISTS email_csat_tokens (
    token       TEXT        PRIMARY KEY,
    ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    score       SMALLINT    CHECK (score BETWEEN 1 AND 5),  -- NULL until clicked
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_csat_tokens_ticket
    ON email_csat_tokens(ticket_id);
