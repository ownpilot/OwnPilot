-- 019_claw_crew_enhancements.sql
-- Adds crew shared memory and crew task queue tables for enhanced crew orchestration.

-- Crew shared memory store
CREATE TABLE IF NOT EXISTS crew_shared_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id UUID NOT NULL REFERENCES agent_crews(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crew_memory_crew ON crew_shared_memory(crew_id, category, created_at DESC);

-- Crew task queue (pull-based, agents claim tasks)
CREATE TABLE IF NOT EXISTS crew_task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id UUID NOT NULL REFERENCES agent_crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  claimed_by TEXT,
  task_name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  context TEXT,
  expected_output TEXT,
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  result TEXT,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crew_tasks_crew ON crew_task_queue(crew_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_crew_tasks_claimed ON crew_task_queue(claimed_by, status);
