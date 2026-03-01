-- Subagent execution history
-- Ephemeral tasks spawned by parent agents (chat, background-agent, or other subagents)
-- No "config" table needed — subagents are ephemeral, not persistent.

CREATE TABLE IF NOT EXISTS subagent_history (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('chat', 'background-agent', 'subagent')),
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'cancelled', 'timeout')),
  result TEXT,
  error TEXT,
  tool_calls JSONB NOT NULL DEFAULT '[]',
  turns_used INTEGER NOT NULL DEFAULT 0,
  tool_calls_used INTEGER NOT NULL DEFAULT 0,
  tokens_used JSONB,
  duration_ms INTEGER,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  spawned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subagent_history_parent ON subagent_history(parent_id, spawned_at DESC);
CREATE INDEX IF NOT EXISTS idx_subagent_history_user ON subagent_history(user_id, spawned_at DESC);
