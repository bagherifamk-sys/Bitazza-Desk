-- Migration 006: Atomic idempotency guard for inbound Gmail message processing
-- Run with: psql $DATABASE_URL -f db/migrations/006_email_processing_claims.sql
--
-- Prevents duplicate processing when Pub/Sub retries a notification while the
-- first webhook call is still in-flight (TOCTOU race in the pre-check).
-- Each inbound gmail_message_id is claimed exactly once via INSERT ON CONFLICT.

CREATE TABLE IF NOT EXISTS email_processing_claims (
    gmail_message_id  TEXT        PRIMARY KEY,
    claimed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
