-- Agent Souls & Autonomous Crews
-- Persistent identity, heartbeat automation, inter-agent communication, crews

-- ── Agent Souls ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_souls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  identity JSONB NOT NULL,
  purpose JSONB NOT NULL,
  autonomy JSONB NOT NULL,
  heartbeat JSONB NOT NULL,
  relationships JSONB DEFAULT '{}',
  evolution JSONB NOT NULL,
  boot_sequence JSONB DEFAULT '{}',
  workspace_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_souls_agent ON agent_souls(agent_id);

-- ── Soul Version History ────────────────────────────
CREATE TABLE IF NOT EXISTS agent_soul_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_id UUID NOT NULL REFERENCES agent_souls(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_reason TEXT,
  changed_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soul_versions_soul ON agent_soul_versions(soul_id, version DESC);

-- ── Agent Messages ──────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_crew ON agent_messages(crew_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent_id, created_at DESC);

-- ── Crews ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  template_id VARCHAR(50),
  coordination_pattern VARCHAR(20),
  status VARCHAR(20) DEFAULT 'active',
  workspace_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Crew Membership ─────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_crew_members (
  crew_id UUID NOT NULL REFERENCES agent_crews(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (crew_id, agent_id)
);

-- ── Heartbeat Log ───────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_heartbeat_log_agent ON heartbeat_log(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_cost ON heartbeat_log(agent_id, created_at) WHERE cost > 0;
