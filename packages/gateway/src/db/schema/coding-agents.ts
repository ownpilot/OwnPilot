/**
 * Coding Agent, CLI Provider, Orchestration, Orchestra & Artifact Tables
 */

export const CODING_AGENTS_TABLES_SQL = `
-- =====================================================
-- CODING AGENT TABLES
-- =====================================================

-- Coding agent results (persisted task outcomes)
CREATE TABLE IF NOT EXISTS coding_agent_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT,
  provider TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT,
  model TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  mode TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- CLI providers (user-registered CLI tools as coding agent providers)
CREATE TABLE IF NOT EXISTS cli_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  binary_path TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  icon TEXT,
  color TEXT,
  auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK(auth_method IN ('none', 'config_center', 'env_var')),
  config_service_name TEXT,
  api_key_env_var TEXT,
  default_args JSONB NOT NULL DEFAULT '[]',
  prompt_template TEXT,
  output_format TEXT DEFAULT 'text'
    CHECK(output_format IN ('text', 'json', 'stream-json')),
  default_timeout_ms INTEGER NOT NULL DEFAULT 300000,
  max_timeout_ms INTEGER NOT NULL DEFAULT 1800000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- CLI tool policies (per-user, per-tool execution policies)
CREATE TABLE IF NOT EXISTS cli_tool_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  tool_name TEXT NOT NULL,
  policy TEXT NOT NULL DEFAULT 'prompt'
    CHECK(policy IN ('allowed', 'prompt', 'blocked')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tool_name)
);

-- Coding agent per-provider permission profiles
CREATE TABLE IF NOT EXISTS coding_agent_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_ref TEXT NOT NULL,
  io_format TEXT NOT NULL DEFAULT 'text'
    CHECK(io_format IN ('text', 'json', 'stream-json')),
  fs_access TEXT NOT NULL DEFAULT 'read-write'
    CHECK(fs_access IN ('none', 'read-only', 'read-write', 'full')),
  allowed_dirs JSONB NOT NULL DEFAULT '[]',
  network_access BOOLEAN NOT NULL DEFAULT TRUE,
  shell_access BOOLEAN NOT NULL DEFAULT TRUE,
  git_access BOOLEAN NOT NULL DEFAULT TRUE,
  autonomy TEXT NOT NULL DEFAULT 'semi-auto'
    CHECK(autonomy IN ('supervised', 'semi-auto', 'full-auto')),
  max_file_changes INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_ref)
);

-- Coding agent skill attachments (skills/instructions per provider)
CREATE TABLE IF NOT EXISTS coding_agent_skill_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_ref TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'extension'
    CHECK(type IN ('extension', 'inline')),
  extension_id TEXT,
  label TEXT,
  instructions TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Coding agent subscription/budget tracking
CREATE TABLE IF NOT EXISTS coding_agent_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_ref TEXT NOT NULL,
  tier TEXT,
  monthly_budget_usd REAL NOT NULL DEFAULT 0,
  current_spend_usd REAL NOT NULL DEFAULT 0,
  max_concurrent_sessions INTEGER NOT NULL DEFAULT 3,
  reset_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_ref)
);

-- Orchestration runs: multi-step CLI tool orchestration
CREATE TABLE IF NOT EXISTS orchestration_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  goal TEXT NOT NULL,
  provider TEXT NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning', 'running', 'waiting_user', 'paused', 'completed', 'failed', 'cancelled')),
  steps JSONB NOT NULL DEFAULT '[]',
  current_step INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 10,
  auto_mode BOOLEAN NOT NULL DEFAULT FALSE,
  enable_analysis BOOLEAN NOT NULL DEFAULT TRUE,
  skill_ids JSONB NOT NULL DEFAULT '[]',
  permissions JSONB,
  total_duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ORCHESTRA_EXECUTIONS: Multi-agent plan execution audit
CREATE TABLE IF NOT EXISTS orchestra_executions (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  strategy TEXT NOT NULL,
  state TEXT NOT NULL,
  plan JSONB NOT NULL,
  task_results JSONB NOT NULL DEFAULT '[]',
  total_duration_ms INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ARTIFACTS: AI-generated interactive content with data bindings
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  type VARCHAR(20) NOT NULL CHECK (type IN ('html', 'svg', 'markdown', 'form', 'chart', 'react')),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB NOT NULL DEFAULT '[]',
  pinned BOOLEAN NOT NULL DEFAULT false,
  dashboard_position INTEGER,
  dashboard_size VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (dashboard_size IN ('small', 'medium', 'large', 'full')),
  version INTEGER NOT NULL DEFAULT 1,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ARTIFACT_VERSIONS: Version history for artifact content
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CODING_AGENTS_MIGRATIONS_SQL = `
--- ORCHESTRATION RUNS: Add enable_analysis column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orchestration_runs' AND column_name = 'enable_analysis') THEN
    ALTER TABLE orchestration_runs ADD COLUMN enable_analysis BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;
`;

export const CODING_AGENTS_INDEXES_SQL = `
-- Coding agent results indexes
CREATE INDEX IF NOT EXISTS idx_coding_agent_results_user ON coding_agent_results(user_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_results_session ON coding_agent_results(session_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_results_created ON coding_agent_results(created_at DESC);

-- CLI providers indexes
CREATE INDEX IF NOT EXISTS idx_cli_providers_user ON cli_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_cli_providers_active ON cli_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_cli_providers_user_name ON cli_providers(user_id, name);

-- CLI tool policies indexes
CREATE INDEX IF NOT EXISTS idx_cli_tool_policies_user ON cli_tool_policies(user_id);
CREATE INDEX IF NOT EXISTS idx_cli_tool_policies_user_tool ON cli_tool_policies(user_id, tool_name);

-- Coding agent permissions indexes
CREATE INDEX IF NOT EXISTS idx_coding_agent_perms_user ON coding_agent_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_perms_provider ON coding_agent_permissions(user_id, provider_ref);

-- Coding agent skill attachments indexes
CREATE INDEX IF NOT EXISTS idx_coding_agent_skills_user ON coding_agent_skill_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_skills_provider ON coding_agent_skill_attachments(user_id, provider_ref);

-- Coding agent subscriptions indexes
CREATE INDEX IF NOT EXISTS idx_coding_agent_subs_user ON coding_agent_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_subs_provider ON coding_agent_subscriptions(user_id, provider_ref);

-- Orchestration runs indexes
CREATE INDEX IF NOT EXISTS idx_orchestration_runs_user ON orchestration_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestration_runs_status ON orchestration_runs(user_id, status);

-- Orchestra indexes
CREATE INDEX IF NOT EXISTS idx_orchestra_executions_parent ON orchestra_executions(parent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestra_executions_user ON orchestra_executions(user_id, started_at DESC);

-- Artifact indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_pinned ON artifacts(user_id, pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id, version DESC);
`;
