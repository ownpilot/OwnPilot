/**
 * Workflow, Autonomy & MCP Server Tables
 */

export const WORKFLOWS_TABLES_SQL = `
-- Workflows (visual DAG tool pipelines)
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive')),
  variables JSONB NOT NULL DEFAULT '{}',
  input_schema JSONB NOT NULL DEFAULT '[]',
  last_run TIMESTAMP,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Workflow version snapshots (auto-created on save)
CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  variables JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_id, version)
);

-- Workflow execution logs (per-run history)
CREATE TABLE IF NOT EXISTS workflow_logs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  workflow_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'awaiting_approval')),
  node_results JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Workflow approval gates (pause/resume for human approval)
CREATE TABLE IF NOT EXISTS workflow_approvals (
  id TEXT PRIMARY KEY,
  workflow_log_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  context JSONB NOT NULL DEFAULT '{}',
  message TEXT,
  decided_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Autonomy Engine pulse log
CREATE TABLE IF NOT EXISTS autonomy_log (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  pulsed_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  duration_ms   INTEGER,
  signals_found INTEGER NOT NULL DEFAULT 0,
  llm_called    BOOLEAN NOT NULL DEFAULT FALSE,
  actions_count INTEGER NOT NULL DEFAULT 0,
  actions       JSONB NOT NULL DEFAULT '[]',
  report_msg    TEXT,
  error         TEXT,
  manual        BOOLEAN NOT NULL DEFAULT FALSE,
  signal_ids    JSONB NOT NULL DEFAULT '[]',
  urgency_score REAL NOT NULL DEFAULT 0
);

-- MCP Servers (external MCP server connections)
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio'
    CHECK(transport IN ('stdio', 'sse', 'streamable-http')),
  command TEXT,
  args JSONB DEFAULT '[]',
  env JSONB DEFAULT '{}',
  url TEXT,
  headers JSONB DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_connect BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK(status IN ('connected', 'disconnected', 'error', 'connecting')),
  error_message TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
`;

export const WORKFLOWS_MIGRATIONS_SQL = `
-- =====================================================
-- WORKFLOWS: Add input_schema column
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workflows' AND column_name = 'input_schema') THEN
    ALTER TABLE workflows ADD COLUMN input_schema JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;
`;

export const WORKFLOWS_INDEXES_SQL = `
-- Workflow indexes
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_created ON workflows(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_logs_workflow ON workflow_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_logs_status ON workflow_logs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_logs_started ON workflow_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow ON workflow_versions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_versions_created ON workflow_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_user ON workflow_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_status ON workflow_approvals(status);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_log ON workflow_approvals(workflow_log_id);

-- MCP server indexes
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

-- Autonomy log indexes
CREATE INDEX IF NOT EXISTS idx_autonomy_log_user ON autonomy_log(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomy_log_time ON autonomy_log(pulsed_at DESC);
`;
