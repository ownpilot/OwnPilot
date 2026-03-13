-- Fleet System: Coordinated background agent army
-- Tables: fleets (config), fleet_sessions (runtime), fleet_tasks (queue), fleet_worker_history

-- Fleet configurations
CREATE TABLE IF NOT EXISTS fleets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  mission TEXT NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'on-demand',
  schedule_config JSONB DEFAULT '{}',
  workers JSONB NOT NULL DEFAULT '[]',
  budget JSONB DEFAULT '{}',
  concurrency_limit INTEGER NOT NULL DEFAULT 5,
  auto_start BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT,
  model TEXT,
  shared_context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleets_user_id ON fleets(user_id);

-- Fleet execution sessions
CREATE TABLE IF NOT EXISTS fleet_sessions (
  id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  active_workers INTEGER NOT NULL DEFAULT 0,
  shared_context JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_fleet_sessions_fleet_id ON fleet_sessions(fleet_id);

-- Fleet task queue
CREATE TABLE IF NOT EXISTS fleet_tasks (
  id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_worker TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'queued',
  input JSONB,
  output TEXT,
  depends_on JSONB DEFAULT '[]',
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fleet_tasks_fleet_id ON fleet_tasks(fleet_id);
CREATE INDEX IF NOT EXISTS idx_fleet_tasks_status ON fleet_tasks(status);

-- Fleet worker execution history
CREATE TABLE IF NOT EXISTS fleet_worker_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES fleet_sessions(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  task_id TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  output TEXT DEFAULT '',
  tool_calls JSONB DEFAULT '[]',
  tokens_used JSONB,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_worker_history_session_id ON fleet_worker_history(session_id);
