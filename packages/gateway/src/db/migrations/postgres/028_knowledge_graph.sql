-- 028: Knowledge Graph tables for Graph RAG + HITL + Workflow Hooks
-- Supports entity-relationship graph alongside existing vector embeddings
--
-- Access model: knowledge_entities & knowledge_relations belong to (user_id, agent_id).
--   - agent_id is nullable: NULL means "global / shared" knowledge for that user.
--   - Queries MUST filter by user_id; agent_id filters are optional (NULL = all agents).
--   - This ensures strict data isolation: users cannot see other users' graphs,
--     and agents within one user have their own scoped knowledge.

-- Enable pg_trgm for entity name fuzzy search (must be before indexes that use it)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Knowledge Entities (nodes in knowledge graph)
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT,                                -- NULL = shared knowledge, non-NULL = agent-scoped
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'concept',  -- concept, person, organization, location, event, tool, etc.
  description TEXT,
  properties JSONB DEFAULT '{}',
  embedding vector(1536),                       -- for entity similarity search
  source_ids JSONB DEFAULT '[]',                -- memory IDs or document IDs that mentioned this entity
  mention_count INTEGER DEFAULT 1,
  importance REAL DEFAULT 0.5,                  -- 0-1, decays over time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_user ON knowledge_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_agent ON knowledge_entities(user_id, agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ke_user_agent_name ON knowledge_entities(user_id, COALESCE(agent_id, ''), name);
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type ON knowledge_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_name ON knowledge_entities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_embedding ON knowledge_entities USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Knowledge Entity Embeddings (separate table for vector search)
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_entity_embeddings (
  entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  embedding vector(1536),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kee_embedding ON knowledge_entity_embeddings USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Knowledge Relations (edges in knowledge graph)
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT,                                -- mirrors entity ownership
  source_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,                  -- e.g. 'works_at', 'reports_to', 'depends_on', 'part_of'
  weight REAL DEFAULT 1.0,                      -- relationship strength
  properties JSONB DEFAULT '{}',
  context TEXT,                                 -- sentence/paragraph where this relation was found
  source_id TEXT,                               -- memory/document where this was extracted from
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_user ON knowledge_relations(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_agent ON knowledge_relations(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_type ON knowledge_relations(relation_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_relations_unique
  ON knowledge_relations(user_id, source_entity_id, target_entity_id, relation_type);

-- ============================================================================
-- Knowledge Collections (agent-level KB grouping)
-- Each agent can have multiple collections (e.g. "project docs", "meeting notes")
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT,                                -- NULL = user-level collection
  name TEXT NOT NULL,
  description TEXT,
  config JSONB DEFAULT '{}',                    -- collection-specific RAG settings
  entity_count INTEGER DEFAULT 0,
  relation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_collections_user ON knowledge_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_collections_agent ON knowledge_collections(user_id, agent_id);

-- ============================================================================
-- HITL Requests (Human-in-the-Loop approval queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS hitl_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  workflow_log_id TEXT,
  workflow_id TEXT,
  node_id TEXT,
  interaction_type TEXT NOT NULL DEFAULT 'approve_reject',  -- approve_reject, collect_input, review_tool_calls, multi_turn
  mode TEXT NOT NULL DEFAULT 'pre_execution',                -- pre_execution, post_execution
  status TEXT NOT NULL DEFAULT 'pending',                    -- pending, approved, rejected, modified, expired, cancelled
  prompt_message TEXT,
  context JSONB DEFAULT '{}',
  response JSONB,                                           -- decision + modified_content + feedback
  timeout_seconds INTEGER DEFAULT 1800,
  expires_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hitl_requests_user ON hitl_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_hitl_requests_status ON hitl_requests(status);
CREATE INDEX IF NOT EXISTS idx_hitl_requests_workflow ON hitl_requests(workflow_log_id);

-- ============================================================================
-- Workflow Hook Configs (per-workflow hook settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_hook_configs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  hook_type TEXT NOT NULL,      -- logging, metrics, notification, webhook, custom
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',    -- hook-specific settings (url, channel, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_hook_configs_workflow ON workflow_hook_configs(workflow_id);

-- ============================================================================
-- Workflow Generation History
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  goal TEXT NOT NULL,                          -- original natural-language goal
  decomposition JSONB,                         -- task decomposition tree
  generated_workflow JSONB,                    -- resulting workflow definition
  metrics JSONB,                               -- decomposition metrics (depth, complexity, etc.)
  provider TEXT,
  model TEXT,
  status TEXT DEFAULT 'completed',             -- pending, completed, failed
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_generations_user ON workflow_generations(user_id);

-- (pg_trgm extension created at top of file)
