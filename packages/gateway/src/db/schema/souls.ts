/**
 * Agent Souls, Crews, Heartbeat, Background Agents & Subagent Tables
 */

export const SOULS_TABLES_SQL = `
-- =====================================================
-- AGENT SOULS & AUTONOMOUS CREWS
-- =====================================================

-- Agent Souls — persistent identity injected into prompts
CREATE TABLE IF NOT EXISTS agent_souls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  identity JSONB NOT NULL,
  purpose JSONB NOT NULL,
  autonomy JSONB NOT NULL,
  heartbeat JSONB NOT NULL,
  relationships JSONB DEFAULT '{}',
  evolution JSONB NOT NULL,
  boot_sequence JSONB DEFAULT '{}',
  provider JSONB DEFAULT NULL,
  skill_access JSONB DEFAULT NULL,
  workspace_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

-- Soul Version History — snapshots for rollback
CREATE TABLE IF NOT EXISTS agent_soul_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_id UUID NOT NULL REFERENCES agent_souls(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_reason TEXT,
  changed_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill Usage — track when agents use/learn from skills
CREATE TABLE IF NOT EXISTS skill_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  usage_type VARCHAR(20) NOT NULL CHECK(usage_type IN ('learned', 'referenced', 'executed', 'adapted')),
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Messages — inter-agent communication
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id TEXT,
  to_agent_id TEXT,
  type VARCHAR(30) NOT NULL,
  subject VARCHAR(200),
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  priority VARCHAR(10) DEFAULT 'normal',
  thread_id UUID,
  requires_response BOOLEAN DEFAULT false,
  deadline TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'sent',
  crew_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- Crews — groups of collaborating agents
CREATE TABLE IF NOT EXISTS agent_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  template_id VARCHAR(50),
  coordination_pattern VARCHAR(20),
  status VARCHAR(20) DEFAULT 'active',
  workspace_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crew Membership — which agents belong to which crew
CREATE TABLE IF NOT EXISTS agent_crew_members (
  crew_id UUID NOT NULL REFERENCES agent_crews(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (crew_id, agent_id)
);

-- Heartbeat Log — audit trail for every heartbeat cycle
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  soul_version INTEGER,
  tasks_run JSONB DEFAULT '[]',
  tasks_skipped JSONB DEFAULT '[]',
  tasks_failed JSONB DEFAULT '[]',
  duration_ms INTEGER,
  token_usage JSONB DEFAULT '{"input":0,"output":0}',
  cost DECIMAL(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Background agents: persistent, long-running autonomous agents
CREATE TABLE IF NOT EXISTS background_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('continuous', 'interval', 'event')),
  allowed_tools JSONB NOT NULL DEFAULT '[]',
  limits JSONB NOT NULL DEFAULT '{}',
  interval_ms INTEGER,
  event_filters JSONB,
  auto_start BOOLEAN NOT NULL DEFAULT false,
  stop_condition TEXT,
  provider TEXT,
  model TEXT,
  skills JSONB DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Background agent sessions: runtime state (persists across restarts)
CREATE TABLE IF NOT EXISTS background_agent_sessions (
  agent_id TEXT PRIMARY KEY REFERENCES background_agents(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'paused', 'waiting', 'completed', 'failed', 'stopped')),
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  last_cycle_at TIMESTAMPTZ,
  last_cycle_duration_ms INTEGER,
  last_cycle_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  persistent_context JSONB NOT NULL DEFAULT '{}',
  inbox JSONB NOT NULL DEFAULT '[]'
);

-- Background agent history: cycle execution logs
CREATE TABLE IF NOT EXISTS background_agent_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES background_agents(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  tool_calls JSONB NOT NULL DEFAULT '[]',
  output_message TEXT NOT NULL DEFAULT '',
  tokens_used JSONB,
  cost_usd NUMERIC(10, 6),
  duration_ms INTEGER NOT NULL,
  turns INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subagent history: ephemeral task execution audit log
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
`;

export const SOULS_MIGRATIONS_SQL = `
--- AGENT_SOULS: Add provider column for storing primary/fallback provider config
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_souls' AND column_name = 'provider') THEN
    ALTER TABLE agent_souls ADD COLUMN provider JSONB DEFAULT NULL;
  END IF;
END $$;

--- Create index for provider queries
CREATE INDEX IF NOT EXISTS idx_agent_souls_provider ON agent_souls USING GIN (provider);

--- AGENT_SOULS: Add skill_access column for storing agent skill permissions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_souls' AND column_name = 'skill_access') THEN
    ALTER TABLE agent_souls ADD COLUMN skill_access JSONB DEFAULT NULL;
  END IF;
END $$;

--- Create index for skill_access queries
CREATE INDEX IF NOT EXISTS idx_agent_souls_skill_access ON agent_souls USING GIN (skill_access);
`;

export const SOULS_INDEXES_SQL = `
-- Agent soul indexes
CREATE INDEX IF NOT EXISTS idx_agent_souls_agent ON agent_souls(agent_id);
CREATE INDEX IF NOT EXISTS idx_soul_versions_soul ON agent_soul_versions(soul_id, version DESC);

-- Skill usage indexes
CREATE INDEX IF NOT EXISTS idx_skill_usage_agent ON skill_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_skill ON skill_usage(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_type ON skill_usage(usage_type);
CREATE INDEX IF NOT EXISTS idx_skill_usage_created ON skill_usage(created_at);

-- Agent message indexes
CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_crew ON agent_messages(crew_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent_id, created_at DESC);

-- Heartbeat log indexes
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_agent ON heartbeat_log(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_cost ON heartbeat_log(agent_id, created_at) WHERE cost > 0;

-- Background agent indexes
CREATE INDEX IF NOT EXISTS idx_background_agents_user ON background_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_background_agents_auto_start ON background_agents(auto_start) WHERE auto_start = true;
CREATE INDEX IF NOT EXISTS idx_bg_agent_history_agent ON background_agent_history(agent_id, executed_at DESC);

-- Subagent history indexes
CREATE INDEX IF NOT EXISTS idx_subagent_history_parent ON subagent_history(parent_id, spawned_at DESC);
CREATE INDEX IF NOT EXISTS idx_subagent_history_user ON subagent_history(user_id, spawned_at DESC);
`;
