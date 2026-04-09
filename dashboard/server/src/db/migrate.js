// Run once to set up schema: node src/db/migrate.js
const pool = require('./pg');

const SQL = `
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (agents/supervisors/admins)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR UNIQUE NOT NULL,
  name          VARCHAR NOT NULL,
  password_hash VARCHAR NOT NULL,
  role          VARCHAR NOT NULL CHECK (role IN ('super_admin','supervisor','agent','kyc_agent','finance_agent')),
  team          VARCHAR NOT NULL DEFAULT 'cs',
  state         VARCHAR NOT NULL DEFAULT 'Offline' CHECK (state IN ('Available','Busy','Break','Offline')),
  active_chats  INT NOT NULL DEFAULT 0,
  max_chats     INT NOT NULL DEFAULT 3,
  skills        TEXT[] DEFAULT '{}',
  shift         VARCHAR,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bitazza_uid   VARCHAR UNIQUE,
  line_uid      VARCHAR UNIQUE,
  fb_psid       VARCHAR UNIQUE,
  email         VARCHAR,
  name          VARCHAR,
  tier          VARCHAR NOT NULL DEFAULT 'Standard' CHECK (tier IN ('VIP','EA','Standard')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID REFERENCES customers(id),
  owner_id             UUID REFERENCES users(id),   -- NEVER changes on handoff
  assigned_to          UUID REFERENCES users(id),
  team                 VARCHAR NOT NULL DEFAULT 'cs',
  channel              VARCHAR NOT NULL CHECK (channel IN ('line','facebook','email','web')),
  status               VARCHAR NOT NULL DEFAULT 'Open_Live'
                         CHECK (status IN ('Open_Live','In_Progress','Pending_Customer',
                                           'Closed_Resolved','Closed_Unresponsive',
                                           'Orphaned','Escalated')),
  priority             INT NOT NULL DEFAULT 3 CHECK (priority IN (1,2,3)),
  category             VARCHAR,
  tags                 TEXT[] DEFAULT '{}',
  sla_deadline         TIMESTAMPTZ,
  sla_breached         BOOLEAN NOT NULL DEFAULT false,
  last_customer_msg_at TIMESTAMPTZ,
  nudge_sent_at        TIMESTAMPTZ,
  csat_score           INT CHECK (csat_score BETWEEN 1 AND 5),
  ai_persona           JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer_updated ON tickets (customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_pending ON tickets (status, last_customer_msg_at)
  WHERE status = 'Pending_Customer';
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, assigned_to);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type VARCHAR NOT NULL CHECK (sender_type IN ('customer','agent','bot','system','internal_note','whisper')),
  sender_id   UUID,
  content     TEXT NOT NULL,
  channel     VARCHAR,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket_created ON messages (ticket_id, created_at ASC);

-- Canned responses
CREATE TABLE IF NOT EXISTS canned_responses (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut  VARCHAR NOT NULL,
  title     VARCHAR NOT NULL,
  body      TEXT NOT NULL,
  scope     VARCHAR NOT NULL DEFAULT 'shared' CHECK (scope IN ('shared','personal')),
  owner_id  UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  VARCHAR UNIQUE NOT NULL,
  color VARCHAR DEFAULT '#000000'
);

-- AI Studio flows
CREATE TABLE IF NOT EXISTS ai_studio_flows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR NOT NULL,
  flow_json     JSONB NOT NULL DEFAULT '{}',
  published     BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  published_by  UUID REFERENCES users(id),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id),
  action      VARCHAR NOT NULL,
  target_type VARCHAR,
  target_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Roles table (dynamic roles) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  name       VARCHAR PRIMARY KEY,
  is_preset  BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed preset roles
INSERT INTO roles (name, is_preset) VALUES
  ('agent',          true),
  ('kyc_agent',      true),
  ('finance_agent',  true),
  ('supervisor',     true),
  ('admin',          true),
  ('super_admin',    true)
ON CONFLICT (name) DO NOTHING;

-- ── Role permissions table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_name  VARCHAR NOT NULL REFERENCES roles(name) ON DELETE CASCADE ON UPDATE CASCADE,
  permission VARCHAR NOT NULL,
  PRIMARY KEY (role_name, permission)
);

-- Seed preset role permissions (mirrors hardcoded NAV + action rules)
INSERT INTO role_permissions (role_name, permission) VALUES
  -- agent
  ('agent', 'section.home'),
  ('agent', 'section.inbox'),
  ('agent', 'inbox.reply'),
  ('agent', 'inbox.close'),
  ('agent', 'inbox.escalate'),
  ('agent', 'inbox.internal_note'),
  ('agent', 'inbox.claim'),
  -- kyc_agent
  ('kyc_agent', 'section.home'),
  ('kyc_agent', 'section.inbox'),
  ('kyc_agent', 'inbox.reply'),
  ('kyc_agent', 'inbox.close'),
  ('kyc_agent', 'inbox.escalate'),
  ('kyc_agent', 'inbox.internal_note'),
  ('kyc_agent', 'inbox.claim'),
  -- finance_agent
  ('finance_agent', 'section.home'),
  ('finance_agent', 'section.inbox'),
  ('finance_agent', 'inbox.reply'),
  ('finance_agent', 'inbox.close'),
  ('finance_agent', 'inbox.escalate'),
  ('finance_agent', 'inbox.internal_note'),
  ('finance_agent', 'inbox.claim'),
  -- supervisor
  ('supervisor', 'section.home'),
  ('supervisor', 'section.inbox'),
  ('supervisor', 'section.supervisor'),
  ('supervisor', 'section.analytics'),
  ('supervisor', 'section.metrics'),
  ('supervisor', 'section.studio'),
  ('supervisor', 'inbox.reply'),
  ('supervisor', 'inbox.assign'),
  ('supervisor', 'inbox.close'),
  ('supervisor', 'inbox.escalate'),
  ('supervisor', 'inbox.internal_note'),
  ('supervisor', 'inbox.claim'),
  ('supervisor', 'supervisor.whisper'),
  ('supervisor', 'studio.publish'),
  -- admin
  ('admin', 'section.home'),
  ('admin', 'section.inbox'),
  ('admin', 'section.supervisor'),
  ('admin', 'section.analytics'),
  ('admin', 'section.knowledge'),
  ('admin', 'section.admin'),
  ('admin', 'inbox.reply'),
  ('admin', 'inbox.assign'),
  ('admin', 'inbox.close'),
  ('admin', 'inbox.escalate'),
  ('admin', 'inbox.internal_note'),
  ('admin', 'inbox.claim'),
  ('admin', 'admin.agents'),
  ('admin', 'admin.roles'),
  ('admin', 'admin.settings'),
  -- super_admin (all)
  ('super_admin', 'section.home'),
  ('super_admin', 'section.inbox'),
  ('super_admin', 'section.supervisor'),
  ('super_admin', 'section.analytics'),
  ('super_admin', 'section.metrics'),
  ('super_admin', 'section.studio'),
  ('super_admin', 'section.knowledge'),
  ('super_admin', 'section.users'),
  ('super_admin', 'section.admin'),
  ('super_admin', 'inbox.reply'),
  ('super_admin', 'inbox.assign'),
  ('super_admin', 'inbox.close'),
  ('super_admin', 'inbox.escalate'),
  ('super_admin', 'inbox.internal_note'),
  ('super_admin', 'inbox.claim'),
  ('super_admin', 'supervisor.whisper'),
  ('super_admin', 'studio.publish'),
  ('super_admin', 'admin.agents'),
  ('super_admin', 'admin.roles'),
  ('super_admin', 'admin.settings')
ON CONFLICT DO NOTHING;

-- Backfill section.knowledge, section.users, and user360.* permissions
INSERT INTO role_permissions (role_name, permission) VALUES
  ('admin',         'section.knowledge'),
  ('super_admin',   'section.knowledge'),
  -- section.users: who can access User360 page
  ('agent',         'section.users'),
  ('kyc_agent',     'section.users'),
  ('finance_agent', 'section.users'),
  ('supervisor',    'section.users'),
  ('admin',         'section.users'),
  ('super_admin',   'section.users'),
  -- user360.identity: basic name/email/phone/tier/KYC status
  ('agent',         'user360.identity'),
  ('kyc_agent',     'user360.identity'),
  ('finance_agent', 'user360.identity'),
  ('supervisor',    'user360.identity'),
  ('admin',         'user360.identity'),
  ('super_admin',   'user360.identity'),
  -- user360.kyc: full KYC detail (rejection reason, reviewed date)
  ('kyc_agent',     'user360.kyc'),
  ('supervisor',    'user360.kyc'),
  ('admin',         'user360.kyc'),
  ('super_admin',   'user360.kyc'),
  -- user360.restrictions: restriction type, reason, lift date
  ('agent',         'user360.restrictions'),
  ('kyc_agent',     'user360.restrictions'),
  ('finance_agent', 'user360.restrictions'),
  ('supervisor',    'user360.restrictions'),
  ('admin',         'user360.restrictions'),
  ('super_admin',   'user360.restrictions'),
  -- user360.financials: balances, transactions, spot & futures trades
  ('finance_agent', 'user360.financials'),
  ('supervisor',    'user360.financials'),
  ('admin',         'user360.financials'),
  ('super_admin',   'user360.financials'),
  -- user360.tickets: CS ticket history
  ('agent',         'user360.tickets'),
  ('kyc_agent',     'user360.tickets'),
  ('finance_agent', 'user360.tickets'),
  ('supervisor',    'user360.tickets'),
  ('admin',         'user360.tickets'),
  ('super_admin',   'user360.tickets')
ON CONFLICT DO NOTHING;

-- roles.display_name — optional human-readable label for custom roles
DO $$ BEGIN
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS display_name VARCHAR;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Idempotent column backfills (safe to re-run)
DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_persona JSONB;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_customer_msg_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_score INT;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel VARCHAR;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
EXCEPTION WHEN others THEN NULL;
END $$;

-- users.active — soft-delete flag
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN others THEN NULL;
END $$;

-- users.avatar_url
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR;
EXCEPTION WHEN others THEN NULL;
END $$;

-- users.role: drop old CHECK constraint, add FK to roles table
-- Step 1: ensure all existing role values exist in roles (already seeded above)
-- Step 2: drop old constraint (named or unnamed — use DO block to be safe)
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Step 3: add FK constraint (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_fk
    FOREIGN KEY (role) REFERENCES roles(name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- customers: phone, kyc_status, external_id (widget user_id for fast lookups)
DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS kyc_status VARCHAR;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS external_id VARCHAR UNIQUE;
EXCEPTION WHEN others THEN NULL;
END $$;

-- customers.tier: expand CHECK constraint to include new tiers from mock API
DO $$ BEGIN
  ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_tier_check;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── Assignment Rules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_rules (
  key        VARCHAR PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Seed defaults (mirrors current hardcoded logic — idempotent)
INSERT INTO assignment_rules (key, value) VALUES
  ('category_team_map', '{
    "kyc_verification":    "kyc",
    "withdrawal_issue":    "withdrawals",
    "account_restriction": "cs",
    "password_2fa_reset":  "cs",
    "fraud_security":      "cs"
  }'),
  ('sticky_agent_hours',  '12'),
  ('vip_auto_priority1',  'true'),
  ('sla_minutes',         '{"1": 1, "2": 3, "3": 10}')
ON CONFLICT (key) DO NOTHING;

-- Seed a default super_admin (password: admin123)
INSERT INTO users (email, name, password_hash, role, team, state)
VALUES (
  'admin@bitazza.com',
  'Admin',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lihC',
  'super_admin',
  'cs',
  'Available'
) ON CONFLICT (email) DO NOTHING;

-- Seed specialist agents for team-based routing tests
-- All passwords: agent123
INSERT INTO users (email, name, password_hash, role, team, max_chats, state) VALUES
  -- KYC team
  ('mint@bitazza.com',   'Mint',  '$2a$10$mBiadgYwPZWH8cJE7KYkYOlKCMxRYfzBZpd.zAcUMDvxKZ7dt8SBK', 'kyc_agent',     'kyc',        3, 'Available'),
  -- Withdrawals / finance team
  ('arm@bitazza.com',    'Arm',   '$2a$10$mBiadgYwPZWH8cJE7KYkYOlKCMxRYfzBZpd.zAcUMDvxKZ7dt8SBK', 'finance_agent', 'withdrawals', 3, 'Available'),
  -- General CS team (handles account_restriction, password/2FA, other)
  ('james@bitazza.com',  'James', '$2a$10$mBiadgYwPZWH8cJE7KYkYOlKCMxRYfzBZpd.zAcUMDvxKZ7dt8SBK', 'agent',         'cs',          3, 'Available'),
  ('ploy@bitazza.com',   'Ploy',  '$2a$10$mBiadgYwPZWH8cJE7KYkYOlKCMxRYfzBZpd.zAcUMDvxKZ7dt8SBK', 'agent',         'cs',          3, 'Available'),
  ('nook@bitazza.com',   'Nook',  '$2a$10$mBiadgYwPZWH8cJE7KYkYOlKCMxRYfzBZpd.zAcUMDvxKZ7dt8SBK', 'agent',         'cs',          3, 'Available')
ON CONFLICT (email) DO NOTHING;

-- AI draft log — tracks every draft generated by the copilot for auditing
CREATE TABLE IF NOT EXISTS ai_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  instruction   TEXT NOT NULL DEFAULT '',
  partial_draft TEXT NOT NULL DEFAULT '',
  generated     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_drafts_ticket_idx ON ai_drafts(ticket_id);
`;

(async () => {
  const client = await pool.connect();
  try {
    console.log('[migrate] Running migrations…');
    await client.query(SQL);
    console.log('[migrate] Done.');
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
