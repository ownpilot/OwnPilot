-- Browser Workflows
CREATE TABLE IF NOT EXISTS browser_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  steps JSONB NOT NULL DEFAULT '[]',
  parameters JSONB NOT NULL DEFAULT '[]',
  trigger_id TEXT,
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_browser_workflows_user ON browser_workflows(user_id, created_at DESC);
