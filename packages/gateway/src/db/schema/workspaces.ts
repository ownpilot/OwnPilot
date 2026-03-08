/**
 * Workspace & Code Execution Tables
 */

export const WORKSPACES_TABLES_SQL = `
-- =====================================================
-- USER WORKSPACE ISOLATION TABLES
-- =====================================================

-- User workspaces (isolated environments per user)
CREATE TABLE IF NOT EXISTS user_workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
  storage_path TEXT NOT NULL,
  container_config JSONB NOT NULL DEFAULT '{}',
  container_id TEXT,
  container_status TEXT NOT NULL DEFAULT 'stopped' CHECK(container_status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP
);

-- User containers (active Docker containers)
CREATE TABLE IF NOT EXISTS user_containers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  container_id TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK(status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
  memory_mb INTEGER NOT NULL DEFAULT 512,
  cpu_cores REAL NOT NULL DEFAULT 0.5,
  network_policy TEXT NOT NULL DEFAULT 'none',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP,
  stopped_at TIMESTAMP,
  memory_peak_mb INTEGER DEFAULT 0,
  cpu_time_ms INTEGER DEFAULT 0,
  network_bytes_in INTEGER DEFAULT 0,
  network_bytes_out INTEGER DEFAULT 0
);

-- Code executions history
CREATE TABLE IF NOT EXISTS code_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  container_id TEXT,
  language TEXT NOT NULL CHECK(language IN ('python', 'javascript', 'shell')),
  code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  stdout TEXT,
  stderr TEXT,
  exit_code INTEGER,
  error TEXT,
  execution_time_ms INTEGER,
  memory_used_mb INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Workspace audit log
CREATE TABLE IF NOT EXISTS workspace_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('create', 'read', 'write', 'delete', 'execute', 'start', 'stop')),
  resource_type TEXT NOT NULL CHECK(resource_type IN ('workspace', 'file', 'container', 'execution')),
  resource TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- EXECUTION PERMISSIONS (granular code execution security)
-- =====================================================

CREATE TABLE IF NOT EXISTS execution_permissions (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'local' CHECK(mode IN ('local','docker','auto')),
  execute_javascript TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_javascript IN ('blocked','prompt','allowed')),
  execute_python TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_python IN ('blocked','prompt','allowed')),
  execute_shell TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_shell IN ('blocked','prompt','allowed')),
  compile_code TEXT NOT NULL DEFAULT 'blocked' CHECK(compile_code IN ('blocked','prompt','allowed')),
  package_manager TEXT NOT NULL DEFAULT 'blocked' CHECK(package_manager IN ('blocked','prompt','allowed')),
  updated_at TIMESTAMP DEFAULT NOW()
);
`;

export const WORKSPACES_MIGRATIONS_SQL = `
-- =====================================================
-- EXECUTION PERMISSIONS: Add enabled/mode columns
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_permissions' AND column_name = 'enabled') THEN
    ALTER TABLE execution_permissions ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_permissions' AND column_name = 'mode') THEN
    ALTER TABLE execution_permissions ADD COLUMN mode TEXT NOT NULL DEFAULT 'local';
  END IF;
END $$;
`;

export const WORKSPACES_INDEXES_SQL = `
-- Workspace indexes
CREATE INDEX IF NOT EXISTS idx_user_workspaces_user ON user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_status ON user_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_user_containers_workspace ON user_containers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_containers_user ON user_containers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_containers_status ON user_containers(status);
CREATE INDEX IF NOT EXISTS idx_code_executions_workspace ON code_executions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_executions_user ON code_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_code_executions_status ON code_executions(status);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_user ON workspace_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_workspace ON workspace_audit(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_created ON workspace_audit(created_at DESC);
`;
