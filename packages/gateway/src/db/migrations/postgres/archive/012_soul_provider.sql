-- Migration: Add provider configuration to agent_souls
-- Stores primary and fallback provider/model for soul agents

ALTER TABLE agent_souls ADD COLUMN IF NOT EXISTS provider JSONB DEFAULT NULL;

-- Index for querying souls by provider
CREATE INDEX IF NOT EXISTS idx_agent_souls_provider ON agent_souls USING GIN (provider);
