export const AUTONOMOUS_TABLES_SQL = `
-- =====================================================
-- AUTONOMOUS AI TABLES
-- =====================================================

-- Memories table (persistent memory for AI assistant)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL CHECK(type IN ('fact', 'preference', 'conversation', 'event', 'skill')),
  content TEXT NOT NULL,
  content_hash TEXT,
  embedding vector(1536),
  source TEXT,
  source_id TEXT,
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  tags JSONB DEFAULT '[]',
  accessed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  accessed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- Goals table (long-term objectives)
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'abandoned')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
  parent_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  due_date TIMESTAMP,
  progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- Goal steps table (actionable steps for goals)
CREATE TABLE IF NOT EXISTS goal_steps (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped')),
  order_num INTEGER NOT NULL,
  dependencies JSONB DEFAULT '[]',
  result TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Triggers table (proactive automation)
CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK(type IN ('schedule', 'event', 'condition', 'webhook')),
  config JSONB NOT NULL DEFAULT '{}',
  action JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
  last_fired TIMESTAMP,
  next_fire TIMESTAMP,
  fire_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Trigger history (execution log)
CREATE TABLE IF NOT EXISTS trigger_history (
  id TEXT PRIMARY KEY,
  trigger_id TEXT,
  trigger_name TEXT,
  fired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'skipped')),
  result TEXT,
  error TEXT,
  duration_ms INTEGER
);

-- Plans table (autonomous plan execution)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
  source TEXT,
  source_id TEXT,
  trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  autonomy_level INTEGER NOT NULL DEFAULT 1 CHECK(autonomy_level >= 0 AND autonomy_level <= 4),
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER,
  checkpoint TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- Plan steps table (individual steps in a plan)
CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  order_num INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan')),
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting')),
  dependencies JSONB DEFAULT '[]',
  result TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  on_success TEXT,
  on_failure TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Plan execution history
CREATE TABLE IF NOT EXISTS plan_history (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('started', 'step_started', 'step_completed', 'step_failed', 'paused', 'resumed', 'completed', 'failed', 'cancelled', 'checkpoint')),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- HEARTBEATS TABLE (NL-to-cron periodic tasks)
-- =====================================================

CREATE TABLE IF NOT EXISTS heartbeats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  schedule_text TEXT NOT NULL,
  cron TEXT NOT NULL,
  task_description TEXT NOT NULL,
  trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- EMBEDDING CACHE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS embedding_cache (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  use_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(content_hash, model_name)
);
`;

export const AUTONOMOUS_MIGRATIONS_SQL = `
-- Triggers table: ensure 'enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'triggers' AND column_name = 'enabled') THEN
    ALTER TABLE triggers ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- =====================================================
-- TRIGGER HISTORY: Add trigger_name, make trigger_id nullable
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trigger_history' AND column_name = 'trigger_name') THEN
    ALTER TABLE trigger_history ADD COLUMN trigger_name TEXT;
  END IF;
END $$;

-- Make trigger_id nullable (drop NOT NULL) for history preservation
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trigger_history' AND column_name = 'trigger_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE trigger_history ALTER COLUMN trigger_id DROP NOT NULL;
  END IF;
END $$;

-- =====================================================
-- MEMORIES TABLE: Full-Text Search (tsvector)
-- =====================================================

-- Add search_vector column for PostgreSQL full-text search
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE memories ADD COLUMN search_vector tsvector;
  END IF;
END $$;

-- Backfill search_vector for existing rows
UPDATE memories SET search_vector = to_tsvector('english', content)
WHERE search_vector IS NULL;

-- Auto-update trigger: keeps search_vector in sync with content
CREATE OR REPLACE FUNCTION memories_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_search_vector ON memories;
CREATE TRIGGER trg_memories_search_vector
  BEFORE INSERT OR UPDATE OF content ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_search_vector_trigger();

--- MEMORIES: Add content_hash column for deduplication
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'content_hash') THEN
    ALTER TABLE memories ADD COLUMN content_hash TEXT;
  END IF;
END $$;

-- =====================================================
-- PGVECTOR: Migrate embedding column from BYTEA to vector
-- =====================================================

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Migrate embedding column type from BYTEA to vector(1536)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories'
      AND column_name = 'embedding'
      AND data_type = 'bytea'
  ) THEN
    ALTER TABLE memories DROP COLUMN embedding;
    ALTER TABLE memories ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- Add vector column if it does not exist at all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE memories ADD COLUMN embedding vector(1536);
  END IF;
END $$;
`;

export const AUTONOMOUS_INDEXES_SQL = `
-- Autonomous AI indexes
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority DESC);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);
CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON goal_steps(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_steps_status ON goal_steps(status);

-- Trigger indexes
CREATE INDEX IF NOT EXISTS idx_triggers_user ON triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type ON triggers(type);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_triggers_next_fire ON triggers(next_fire);
CREATE INDEX IF NOT EXISTS idx_trigger_history_trigger ON trigger_history(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_history_fired ON trigger_history(fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_history_status ON trigger_history(status);

-- Plan indexes
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_priority ON plans(priority DESC);
CREATE INDEX IF NOT EXISTS idx_plans_goal ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plans_trigger ON plans(trigger_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);
CREATE INDEX IF NOT EXISTS idx_plan_steps_order ON plan_steps(plan_id, order_num);
CREATE INDEX IF NOT EXISTS idx_plan_history_plan ON plan_history(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_history_created ON plan_history(created_at DESC);

-- Heartbeat indexes
CREATE INDEX IF NOT EXISTS idx_heartbeats_user ON heartbeats(user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_enabled ON heartbeats(enabled);
CREATE INDEX IF NOT EXISTS idx_heartbeats_trigger ON heartbeats(trigger_id);

-- Embedding cache indexes
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(content_hash, model_name);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_used ON embedding_cache(last_used_at);

-- Full-text search GIN index on memories
CREATE INDEX IF NOT EXISTS idx_memories_search_vector ON memories USING GIN (search_vector);

-- pgvector: HNSW index for cosine similarity search on memories
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories'
      AND column_name = 'embedding'
      AND udt_name = 'vector'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'memories'
        AND indexname = 'idx_memories_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_memories_embedding_hnsw
        ON memories USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END $$;

-- Composite indexes for high-frequency multi-column queries
CREATE INDEX IF NOT EXISTS idx_goals_user_status ON goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans(user_id, status);
`;
