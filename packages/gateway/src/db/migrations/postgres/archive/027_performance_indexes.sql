-- Performance indexes for frequently queried columns identified during codebase audit.
-- All use IF NOT EXISTS for idempotency.
--
-- NOTE (CRIT-3 fix): the original version of this migration also created
-- indexes on chat_history, agent_costs, channel_messages(platform, chat_id),
-- workflow_executions, and habits.status — none of which exist in this
-- schema. Fresh `docker compose up` halted because Postgres aborted the init
-- script on the first missing relation. Lines for non-existent tables/columns
-- have been removed. If those tables are introduced in a later migration,
-- add their indexes there alongside the CREATE TABLE.

-- Fleet tasks index removed — fleet system dropped in migration 038.

-- Memories: type-filtered queries
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);

-- Custom data: category filter
CREATE INDEX IF NOT EXISTS idx_custom_data_category ON custom_data (category);

-- Habits: archived filter (the schema uses is_archived BOOLEAN — there is no
-- status column). Partial index covers the dominant "list active habits" path.
CREATE INDEX IF NOT EXISTS idx_habits_active
  ON habits (user_id, created_at DESC) WHERE is_archived = FALSE;
