/**
 * Claw Schema — Unified autonomous agent runtime tables
 */

export const CLAW_TABLES_SQL = `
-- =====================================================
-- CLAW TABLES (unified autonomous agent runtime)
-- =====================================================

-- Claw configurations
CREATE TABLE IF NOT EXISTS claws (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cyclic',
  allowed_tools JSONB DEFAULT '[]',
  limits JSONB NOT NULL DEFAULT '{}',
  interval_ms INTEGER,
  event_filters JSONB DEFAULT '[]',
  auto_start BOOLEAN NOT NULL DEFAULT FALSE,
  stop_condition TEXT,
  provider TEXT,
  model TEXT,
  workspace_id TEXT,
  soul_id TEXT,
  parent_claw_id TEXT REFERENCES claws(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  sandbox TEXT NOT NULL DEFAULT 'auto',
  coding_agent_provider TEXT,
  skills JSONB DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Claw runtime sessions (1:1 with active claw)
CREATE TABLE IF NOT EXISTS claw_sessions (
  claw_id TEXT PRIMARY KEY REFERENCES claws(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'starting',
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  last_cycle_at TIMESTAMPTZ,
  last_cycle_duration_ms INTEGER,
  last_cycle_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  persistent_context JSONB DEFAULT '{}',
  inbox JSONB DEFAULT '[]',
  artifacts JSONB DEFAULT '[]',
  pending_escalation JSONB
);

-- Claw execution history
CREATE TABLE IF NOT EXISTS claw_history (
  id TEXT PRIMARY KEY,
  claw_id TEXT NOT NULL REFERENCES claws(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'cycle',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  tool_calls JSONB DEFAULT '[]',
  output_message TEXT DEFAULT '',
  tokens_used JSONB,
  cost_usd NUMERIC(10,6),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CLAW_MIGRATIONS_SQL = `
-- Add event_filters column (for event-driven mode)
ALTER TABLE claws ADD COLUMN IF NOT EXISTS event_filters JSONB DEFAULT '[]';

-- Claw audit log (per-tool-call tracking)
CREATE TABLE IF NOT EXISTS claw_audit_log (
  id TEXT PRIMARY KEY,
  claw_id TEXT NOT NULL REFERENCES claws(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB DEFAULT '{}',
  tool_result TEXT DEFAULT '',
  success BOOLEAN NOT NULL DEFAULT TRUE,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'tool',
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claw_audit_claw ON claw_audit_log(claw_id, executed_at DESC);
`;

export const CLAW_INDEXES_SQL = `
-- Claw indexes
CREATE INDEX IF NOT EXISTS idx_claws_user_id ON claws(user_id);
CREATE INDEX IF NOT EXISTS idx_claws_parent ON claws(parent_claw_id);
CREATE INDEX IF NOT EXISTS idx_claw_history_claw ON claw_history(claw_id, executed_at DESC);
`;
