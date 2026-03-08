/**
 * Channel Identity, Auth & User Extension Tables
 */

export const CHANNELS_TABLES_SQL = `
-- =====================================================
-- CHANNEL IDENTITY & AUTH TABLES
-- =====================================================

-- Channel users: maps platform identities to OwnPilot user IDs
CREATE TABLE IF NOT EXISTS channel_users (
  id TEXT PRIMARY KEY,
  ownpilot_user_id TEXT NOT NULL DEFAULT 'default',
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP,
  verification_method TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(platform, platform_user_id)
);

-- Channel sessions: per-channel conversation state
CREATE TABLE IF NOT EXISTS channel_sessions (
  id TEXT PRIMARY KEY,
  channel_user_id TEXT NOT NULL REFERENCES channel_users(id) ON DELETE CASCADE,
  channel_plugin_id TEXT NOT NULL,
  platform_chat_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP,
  UNIQUE(channel_user_id, channel_plugin_id, platform_chat_id)
);

-- Channel verification tokens (PIN/token auth flow)
CREATE TABLE IF NOT EXISTS channel_verification_tokens (
  id TEXT PRIMARY KEY,
  ownpilot_user_id TEXT NOT NULL DEFAULT 'default',
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  expires_at TIMESTAMP NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  used_by_channel_user_id TEXT REFERENCES channel_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  used_at TIMESTAMP
);
`;

export const CHANNELS_MIGRATIONS_SQL = `
-- =====================================================
-- MIGRATION: Rename skill_packages -> user_extensions (MUST run BEFORE CREATE TABLE)
-- =====================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skill_packages')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_extensions') THEN
    ALTER TABLE skill_packages RENAME TO user_extensions;
  END IF;
END $$;

-- Add format column to user_extensions (for AgentSkills.io support)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_extensions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_extensions' AND column_name = 'format') THEN
    ALTER TABLE user_extensions ADD COLUMN format TEXT NOT NULL DEFAULT 'ownpilot';
  END IF;
END $$;

-- Drop old indexes if they exist (new ones are created below via CREATE INDEX IF NOT EXISTS)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_skill_packages_user') THEN
    DROP INDEX idx_skill_packages_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_skill_packages_status') THEN
    DROP INDEX idx_skill_packages_status;
  END IF;
END $$;

-- Now create the table (only if neither old nor new table existed — fresh install)
CREATE TABLE IF NOT EXISTS user_extensions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  category TEXT DEFAULT 'other',
  format TEXT NOT NULL DEFAULT 'ownpilot'
    CHECK(format IN ('ownpilot', 'agentskills')),
  icon TEXT,
  author_name TEXT,
  manifest JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK(status IN ('enabled', 'disabled', 'error')),
  source_path TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  installed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

export const CHANNELS_INDEXES_SQL = `
-- Channel identity & auth indexes
CREATE INDEX IF NOT EXISTS idx_channel_users_ownpilot ON channel_users(ownpilot_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_users_platform ON channel_users(platform, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_users_verified ON channel_users(is_verified);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_user ON channel_sessions(channel_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_plugin ON channel_sessions(channel_plugin_id);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_conversation ON channel_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_channel_verification_token ON channel_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_channel_verification_user ON channel_verification_tokens(ownpilot_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_verification_expires ON channel_verification_tokens(expires_at);

-- Extension indexes
CREATE INDEX IF NOT EXISTS idx_user_extensions_user ON user_extensions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_extensions_status ON user_extensions(status);
`;
