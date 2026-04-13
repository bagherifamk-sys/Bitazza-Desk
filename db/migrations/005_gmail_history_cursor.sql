-- Migration 005: Persistent Gmail historyId cursor for safety-net polling
-- Run with: psql $DATABASE_URL -f db/migrations/005_gmail_history_cursor.sql

-- Single-row table storing the last successfully processed Gmail historyId.
-- The safety-net poller reads from here so it never re-processes old emails,
-- and writes back after each successful poll to advance the bookmark.
CREATE TABLE IF NOT EXISTS gmail_history_cursor (
    id          INT         PRIMARY KEY DEFAULT 1,  -- always one row
    history_id  TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);
