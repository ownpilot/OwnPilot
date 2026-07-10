-- Migration 005: Universal Channel Protocol (UCP)
--
-- Adds UCP extensions to the channel system:
-- 1. channel_messages: UCP thread ID and rich content
-- 2. channel_bridges: Cross-channel message bridging

-- ============================================================================
-- Extend channel_messages with UCP fields
-- ============================================================================

ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS ucp_thread_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS ucp_content JSONB;

CREATE INDEX IF NOT EXISTS idx_channel_messages_ucp_thread
  ON channel_messages(ucp_thread_id)
  WHERE ucp_thread_id IS NOT NULL;

-- ============================================================================
-- Channel bridges
-- ============================================================================

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
