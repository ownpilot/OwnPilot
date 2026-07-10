-- Migration 006: Agent Orchestra (multi-agent collaboration)
-- Stores completed orchestra plan executions for audit and history.

CREATE TABLE IF NOT EXISTS orchestra_executions (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('sequential', 'parallel', 'dag')),
  state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'cancelled', 'timeout')),
  plan JSONB NOT NULL,
  task_results JSONB NOT NULL DEFAULT '[]',
  total_duration_ms INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orchestra_executions_parent ON orchestra_executions(parent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestra_executions_user ON orchestra_executions(user_id, started_at DESC);
