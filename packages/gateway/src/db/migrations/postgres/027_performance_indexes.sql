-- Performance indexes for frequently queried columns identified during codebase audit.
-- All use IF NOT EXISTS for idempotency.

-- Fleet tasks: scheduler queries by status + priority ordering
CREATE INDEX IF NOT EXISTS idx_fleet_tasks_status_priority
  ON fleet_tasks (status, priority DESC, created_at ASC);

-- Chat history: every LLM turn filters by chat_id + orders by created_at
CREATE INDEX IF NOT EXISTS idx_chat_history_chat_id_created
  ON chat_history (chat_id, created_at DESC);

-- Agent costs: date-range reports on append-only table
CREATE INDEX IF NOT EXISTS idx_agent_costs_created_at
  ON agent_costs (created_at);

-- Channel messages: composite for the dominant (platform, chat_id) query pattern
CREATE INDEX IF NOT EXISTS idx_channel_messages_platform_chat
  ON channel_messages (platform, chat_id, created_at DESC);

-- Workflow executions: history by workflow + active execution lookup
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id
  ON workflow_executions (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status
  ON workflow_executions (status) WHERE status IN ('running', 'paused');

-- Memories: type-filtered queries
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);

-- Custom data: category filter
CREATE INDEX IF NOT EXISTS idx_custom_data_category ON custom_data (category);

-- Habits: status and category filters
CREATE INDEX IF NOT EXISTS idx_habits_status ON habits (status);
