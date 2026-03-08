/**
 * Core Tables — conversations, messages, request logs, channels, costs, agents, settings
 */

export const CORE_TABLES_SQL = `
-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Conversations table (chat history)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT,
  agent_id TEXT,
  agent_name TEXT,
  provider TEXT,
  model TEXT,
  system_prompt TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Messages table (chat messages)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  trace TEXT,
  is_error BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Request logs table (for debugging)
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('chat', 'completion', 'embedding', 'tool', 'agent', 'other')),
  provider TEXT,
  model TEXT,
  endpoint TEXT,
  method TEXT NOT NULL DEFAULT 'POST',
  request_body JSONB,
  response_body JSONB,
  status_code INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  error TEXT,
  error_stack TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMP,
  last_activity_at TIMESTAMP
);

-- Channel messages (inbox)
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_id TEXT,
  sender_name TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  attachments JSONB,
  reply_to_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cost tracking table
CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  conversation_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost REAL NOT NULL DEFAULT 0,
  output_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agent configs table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  system_prompt TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

export const CORE_MIGRATIONS_SQL = `
-- =====================================================
-- CONVERSATIONS TABLE MIGRATIONS
-- =====================================================

-- Conversations: ensure 'agent_name' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'agent_name') THEN
    ALTER TABLE conversations ADD COLUMN agent_name TEXT;
  END IF;
END $$;

-- =====================================================
-- REQUEST LOGS TABLE MIGRATIONS
-- =====================================================

-- Request logs: ensure all required columns exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_logs' AND column_name = 'error_stack') THEN
    ALTER TABLE request_logs ADD COLUMN error_stack TEXT;
  END IF;
END $$;

-- =====================================================
-- MESSAGES: Add attachments column
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'attachments') THEN
    ALTER TABLE messages ADD COLUMN attachments JSONB;
  END IF;
END $$;

-- =====================================================
-- CHANNEL_MESSAGES: Add conversation_id for unified chat
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'channel_messages' AND column_name = 'conversation_id') THEN
    ALTER TABLE channel_messages ADD COLUMN conversation_id TEXT;
  END IF;
END $$;

-- Backfill conversation_id from channel_sessions
UPDATE channel_messages cm SET conversation_id = cs.conversation_id
FROM channel_sessions cs
WHERE cm.channel_id = cs.channel_plugin_id
  AND cm.conversation_id IS NULL
  AND cs.conversation_id IS NOT NULL;

-- =====================================================
-- UCP (Universal Channel Protocol) MIGRATIONS
-- =====================================================

-- CHANNEL_MESSAGES: Add UCP thread ID and rich content columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'channel_messages' AND column_name = 'ucp_thread_id') THEN
    ALTER TABLE channel_messages ADD COLUMN ucp_thread_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'channel_messages' AND column_name = 'ucp_content') THEN
    ALTER TABLE channel_messages ADD COLUMN ucp_content JSONB;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_channel_messages_ucp_thread
  ON channel_messages(ucp_thread_id)
  WHERE ucp_thread_id IS NOT NULL;

-- CHANNEL_BRIDGES: Cross-channel message bridging
CREATE TABLE IF NOT EXISTS channel_bridges (
  id TEXT PRIMARY KEY,
  source_channel_id TEXT NOT NULL,
  target_channel_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'both'
    CHECK (direction IN ('source_to_target', 'target_to_source', 'both')),
  filter_pattern TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_bridges_source
  ON channel_bridges(source_channel_id)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_channel_bridges_target
  ON channel_bridges(target_channel_id)
  WHERE enabled = true;

-- =====================================================
-- DROP FK constraints on logging/tracking tables
-- (logs should never fail due to FK violations)
-- =====================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'request_logs_conversation_id_fkey'
      AND table_name = 'request_logs'
  ) THEN
    ALTER TABLE request_logs DROP CONSTRAINT request_logs_conversation_id_fkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'costs_conversation_id_fkey'
      AND table_name = 'costs'
  ) THEN
    ALTER TABLE costs DROP CONSTRAINT costs_conversation_id_fkey;
  END IF;
END $$;

-- System settings: gateway-level key-value store.
-- Used for pairing key and per-platform owner identity.
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CORE_INDEXES_SQL = `
-- Core indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_request_logs_user ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_conversation ON request_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_type ON request_logs(type);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_error ON request_logs(error);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created ON channel_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation ON channel_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_costs_provider ON costs(provider);
CREATE INDEX IF NOT EXISTS idx_costs_created ON costs(created_at);
CREATE INDEX IF NOT EXISTS idx_costs_conversation ON costs(conversation_id);
`;
