-- Background Agents: persistent, long-running autonomous agents
-- Three tables: configs, runtime sessions, execution history

-- ============================================================================
-- background_agents: Agent configuration (persisted)
-- ============================================================================

CREATE TABLE IF NOT EXISTS background_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('continuous', 'interval', 'event')),
  allowed_tools JSONB NOT NULL DEFAULT '[]',
  limits JSONB NOT NULL DEFAULT '{}',
  interval_ms INTEGER,
  event_filters JSONB,
  auto_start BOOLEAN NOT NULL DEFAULT false,
  stop_condition TEXT,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_agents_user ON background_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_background_agents_auto_start ON background_agents(auto_start) WHERE auto_start = true;

-- ============================================================================
-- background_agent_sessions: Runtime state (persists across restarts)
-- ============================================================================

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

-- ============================================================================
-- background_agent_history: Cycle execution logs (30-day retention)
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_bg_agent_history_agent ON background_agent_history(agent_id, executed_at DESC);
