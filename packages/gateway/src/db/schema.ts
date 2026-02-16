/**
 * PostgreSQL Schema Definition
 *
 * All table definitions for the OwnPilot database
 */

import { getLog } from '../services/log.js';

const log = getLog('Schema');

export const SCHEMA_SQL = `
-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Conversations table (chat history)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT,
  agent_id TEXT,
  agent_name TEXT,
  provider TEXT,
  model TEXT,
  system_prompt TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Messages table (chat messages)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  trace TEXT,
  is_error BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Request logs table (for debugging)
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('chat', 'completion', 'embedding', 'tool', 'agent', 'other')),
  provider TEXT,
  model TEXT,
  endpoint TEXT,
  method TEXT NOT NULL DEFAULT 'POST',
  request_body JSONB,
  response_body JSONB,
  status_code INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  error TEXT,
  error_stack TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMP,
  last_activity_at TIMESTAMP
);

-- Channel messages (inbox)
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_id TEXT,
  sender_name TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  attachments JSONB,
  reply_to_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cost tracking table
CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  conversation_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost REAL NOT NULL DEFAULT 0,
  output_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agent configs table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  system_prompt TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- PERSONAL DATA TABLES
-- =====================================================

-- Bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  favicon TEXT,
  category TEXT,
  tags JSONB DEFAULT '[]',
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_visited_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'markdown',
  category TEXT,
  tags JSONB DEFAULT '[]',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  color TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  due_date TIMESTAMP,
  due_time TEXT,
  reminder_at TIMESTAMP,
  category TEXT,
  tags JSONB DEFAULT '[]',
  parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  project_id TEXT,
  recurrence TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT DEFAULT 'UTC',
  recurrence TEXT,
  reminder_minutes INTEGER,
  category TEXT,
  tags JSONB DEFAULT '[]',
  color TEXT,
  external_id TEXT,
  external_source TEXT,
  attendees JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  avatar TEXT,
  birthday TEXT,
  address TEXT,
  notes TEXT,
  relationship TEXT,
  tags JSONB DEFAULT '[]',
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  external_id TEXT,
  external_source TEXT,
  social_links JSONB DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  last_contacted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Projects table (for grouping tasks)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
  due_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Reminders table (standalone reminders)
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  description TEXT,
  remind_at TIMESTAMP NOT NULL,
  recurrence TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  related_type TEXT,
  related_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Quick captures (inbox for quick thoughts/ideas)
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'thought' CHECK(type IN ('idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other')),
  tags JSONB DEFAULT '[]',
  source TEXT,
  url TEXT,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_as_type TEXT CHECK(processed_as_type IN ('note', 'task', 'bookmark', 'discarded') OR processed_as_type IS NULL),
  processed_as_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- =====================================================
-- PRODUCTIVITY PLUGIN TABLES
-- =====================================================

-- Pomodoro sessions
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL CHECK(type IN ('work', 'short_break', 'long_break')),
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'interrupted')),
  task_description TEXT,
  duration_minutes INTEGER NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  interrupted_at TIMESTAMP,
  interruption_reason TEXT
);

-- Pomodoro settings (per user)
CREATE TABLE IF NOT EXISTS pomodoro_settings (
  user_id TEXT PRIMARY KEY DEFAULT 'default',
  work_duration INTEGER NOT NULL DEFAULT 25,
  short_break_duration INTEGER NOT NULL DEFAULT 5,
  long_break_duration INTEGER NOT NULL DEFAULT 15,
  sessions_before_long_break INTEGER NOT NULL DEFAULT 4,
  auto_start_breaks BOOLEAN NOT NULL DEFAULT FALSE,
  auto_start_work BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Pomodoro daily stats (for streak tracking)
CREATE TABLE IF NOT EXISTS pomodoro_daily_stats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  completed_sessions INTEGER NOT NULL DEFAULT 0,
  total_work_minutes INTEGER NOT NULL DEFAULT 0,
  total_break_minutes INTEGER NOT NULL DEFAULT 0,
  interruptions INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Habits
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK(frequency IN ('daily', 'weekly', 'weekdays', 'custom')),
  target_days JSONB DEFAULT '[]',
  target_count INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  category TEXT,
  color TEXT,
  icon TEXT,
  reminder_time TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_longest INTEGER NOT NULL DEFAULT 0,
  total_completions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Habit logs (daily completions)
CREATE TABLE IF NOT EXISTS habit_logs (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(habit_id, date)
);

-- =====================================================
-- AUTONOMOUS AI TABLES
-- =====================================================

-- Memories table (persistent memory for AI assistant)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL CHECK(type IN ('fact', 'preference', 'conversation', 'event', 'skill')),
  content TEXT NOT NULL,
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
-- OAUTH INTEGRATIONS & MEDIA SETTINGS
-- =====================================================

-- OAuth integrations (Gmail, Google Calendar, Google Drive, etc.)
CREATE TABLE IF NOT EXISTS oauth_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_iv TEXT NOT NULL,
  expires_at TIMESTAMP,
  scopes JSONB NOT NULL DEFAULT '[]',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked', 'error')),
  last_sync_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider, service)
);


-- =====================================================
-- USER WORKSPACE ISOLATION TABLES
-- =====================================================

-- User workspaces (isolated environments per user)
CREATE TABLE IF NOT EXISTS user_workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
  storage_path TEXT NOT NULL,
  container_config JSONB NOT NULL DEFAULT '{}',
  container_id TEXT,
  container_status TEXT NOT NULL DEFAULT 'stopped' CHECK(container_status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP
);

-- User containers (active Docker containers)
CREATE TABLE IF NOT EXISTS user_containers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  container_id TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK(status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
  memory_mb INTEGER NOT NULL DEFAULT 512,
  cpu_cores REAL NOT NULL DEFAULT 0.5,
  network_policy TEXT NOT NULL DEFAULT 'none',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP,
  stopped_at TIMESTAMP,
  memory_peak_mb INTEGER DEFAULT 0,
  cpu_time_ms INTEGER DEFAULT 0,
  network_bytes_in INTEGER DEFAULT 0,
  network_bytes_out INTEGER DEFAULT 0
);

-- Code executions history
CREATE TABLE IF NOT EXISTS code_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  container_id TEXT,
  language TEXT NOT NULL CHECK(language IN ('python', 'javascript', 'shell')),
  code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  stdout TEXT,
  stderr TEXT,
  exit_code INTEGER,
  error TEXT,
  execution_time_ms INTEGER,
  memory_used_mb INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Workspace audit log
CREATE TABLE IF NOT EXISTS workspace_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('create', 'read', 'write', 'delete', 'execute', 'start', 'stop')),
  resource_type TEXT NOT NULL CHECK(resource_type IN ('workspace', 'file', 'container', 'execution')),
  resource TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- AI MODELS MANAGEMENT TABLES
-- =====================================================

-- User model configurations (overrides for models.dev data)
CREATE TABLE IF NOT EXISTS user_model_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  pricing_input REAL,
  pricing_output REAL,
  context_window INTEGER,
  max_output INTEGER,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id, model_id)
);

-- Custom providers (aggregators like fal.ai, together.ai, etc.)
CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  api_base_url TEXT,
  api_key_setting TEXT,
  provider_type TEXT NOT NULL DEFAULT 'openai_compatible' CHECK(provider_type IN ('openai_compatible', 'custom')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id)
);

-- User provider configs (overrides for built-in providers - survives models.dev sync)
CREATE TABLE IF NOT EXISTS user_provider_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  base_url TEXT,
  provider_type TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  api_key_env TEXT,
  notes TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id)
);

-- Custom Data table (for AI-created dynamic tools)
CREATE TABLE IF NOT EXISTS custom_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- Custom Tools table (LLM-defined tools)
CREATE TABLE IF NOT EXISTS custom_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  code TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'pending_approval', 'rejected')),
  permissions JSONB NOT NULL DEFAULT '[]',
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'llm')),
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- =====================================================
-- CUSTOM DATA TABLES (AI-managed dynamic schemas)
-- =====================================================

-- Custom table schemas (metadata about AI-created tables)
CREATE TABLE IF NOT EXISTS custom_table_schemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  columns JSONB NOT NULL DEFAULT '[]',
  owner_plugin_id TEXT,
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Custom data records (data stored in AI-created tables)
CREATE TABLE IF NOT EXISTS custom_data_records (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES custom_table_schemas(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- EXECUTION PERMISSIONS (granular code execution security)
-- =====================================================

CREATE TABLE IF NOT EXISTS execution_permissions (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'local' CHECK(mode IN ('local','docker','auto')),
  execute_javascript TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_javascript IN ('blocked','prompt','allowed')),
  execute_python TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_python IN ('blocked','prompt','allowed')),
  execute_shell TEXT NOT NULL DEFAULT 'blocked' CHECK(execute_shell IN ('blocked','prompt','allowed')),
  compile_code TEXT NOT NULL DEFAULT 'blocked' CHECK(compile_code IN ('blocked','prompt','allowed')),
  package_manager TEXT NOT NULL DEFAULT 'blocked' CHECK(package_manager IN ('blocked','prompt','allowed')),
  updated_at TIMESTAMP DEFAULT NOW()
);
`;

/**
 * Migration SQL to add missing columns to existing tables
 * This ensures backward compatibility when schema evolves
 */
export const MIGRATIONS_SQL = `
-- =====================================================
-- MIGRATIONS: Add missing columns to existing tables
-- (Safe to run multiple times - idempotent)
-- =====================================================

-- Triggers table: ensure 'enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'triggers' AND column_name = 'enabled') THEN
    ALTER TABLE triggers ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- =====================================================
-- CUSTOM TOOLS TABLE MIGRATIONS
-- Handles both old schema (implementation, enabled) and new schema (code, status)
-- =====================================================

-- Custom tools: Add 'code' column (new name for 'implementation')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'code') THEN
    -- Check if old 'implementation' column exists to migrate data
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'implementation') THEN
      ALTER TABLE custom_tools ADD COLUMN code TEXT;
      UPDATE custom_tools SET code = implementation;
      ALTER TABLE custom_tools ALTER COLUMN code SET NOT NULL;
    ELSE
      ALTER TABLE custom_tools ADD COLUMN code TEXT NOT NULL DEFAULT '';
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'category' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'category') THEN
    ALTER TABLE custom_tools ADD COLUMN category TEXT;
  END IF;
END $$;

-- Custom tools: Add 'status' column (new name for 'enabled')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'status') THEN
    ALTER TABLE custom_tools ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    -- Migrate from 'enabled' column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'enabled') THEN
      UPDATE custom_tools SET status = CASE WHEN enabled = TRUE THEN 'active' ELSE 'disabled' END;
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'permissions' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'permissions') THEN
    ALTER TABLE custom_tools ADD COLUMN permissions JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

-- Custom tools: Add 'requires_approval' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'requires_approval') THEN
    ALTER TABLE custom_tools ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Custom tools: Add 'created_by' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'created_by') THEN
    ALTER TABLE custom_tools ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user';
    -- Migrate from 'source' column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'source') THEN
      UPDATE custom_tools SET created_by = COALESCE(source, 'user');
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'version' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'version') THEN
    ALTER TABLE custom_tools ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Custom tools: Add 'metadata' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'metadata') THEN
    ALTER TABLE custom_tools ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- Custom tools: Add 'usage_count' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'usage_count') THEN
    ALTER TABLE custom_tools ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Custom tools: Add 'last_used_at' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'last_used_at') THEN
    ALTER TABLE custom_tools ADD COLUMN last_used_at TIMESTAMP;
  END IF;
END $$;

-- =====================================================
-- MODEL & PROVIDER CONFIG MIGRATIONS
-- =====================================================

-- User model configs: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_model_configs' AND column_name = 'is_enabled') THEN
    ALTER TABLE user_model_configs ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- Custom providers: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_providers' AND column_name = 'is_enabled') THEN
    ALTER TABLE custom_providers ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- User provider configs: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_provider_configs' AND column_name = 'is_enabled') THEN
    ALTER TABLE user_provider_configs ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- =====================================================
-- CONVERSATIONS TABLE MIGRATIONS
-- =====================================================

-- Conversations: ensure 'agent_name' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'agent_name') THEN
    ALTER TABLE conversations ADD COLUMN agent_name TEXT;
  END IF;
END $$;

-- =====================================================
-- REQUEST LOGS TABLE MIGRATIONS
-- =====================================================

-- Request logs: ensure all required columns exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_logs' AND column_name = 'error_stack') THEN
    ALTER TABLE request_logs ADD COLUMN error_stack TEXT;
  END IF;
END $$;

-- =====================================================
-- API CENTER: DEMAND-DRIVEN DEPENDENCIES
-- =====================================================

-- Custom tools: Add 'required_api_keys' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'required_api_keys') THEN
    ALTER TABLE custom_tools ADD COLUMN required_api_keys JSONB DEFAULT '[]';
  END IF;
END $$;

-- API services: Add 'required_by' column (only if api_services still exists before migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_services') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_services' AND column_name = 'required_by') THEN
      ALTER TABLE api_services ADD COLUMN required_by JSONB DEFAULT '[]';
    END IF;
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

-- =============================================================================
-- Config Center tables (replaces api_services)
-- =============================================================================
CREATE TABLE IF NOT EXISTS config_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  docs_url TEXT,
  config_schema JSONB NOT NULL DEFAULT '[]',
  multi_entry BOOLEAN NOT NULL DEFAULT FALSE,
  required_by JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_services_name ON config_services(name);
CREATE INDEX IF NOT EXISTS idx_config_services_category ON config_services(category);
CREATE INDEX IF NOT EXISTS idx_config_services_active ON config_services(is_active);

CREATE TABLE IF NOT EXISTS config_entries (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Default',
  data JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_entries_service ON config_entries(service_name);
CREATE INDEX IF NOT EXISTS idx_config_entries_active ON config_entries(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_entries_default
  ON config_entries(service_name) WHERE is_default = TRUE;

-- Migrate data from api_services to config_services (if api_services exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_services') THEN
    -- Migrate service definitions
    INSERT INTO config_services (id, name, display_name, category, description, docs_url, config_schema, multi_entry, required_by, is_active, created_at, updated_at)
    SELECT
      id, name, display_name, category, description, docs_url,
      jsonb_build_array(
        jsonb_build_object('name', 'api_key', 'label', 'API Key', 'type', 'secret', 'required', false, 'envVar', COALESCE(env_var_name, ''), 'order', 0),
        jsonb_build_object('name', 'base_url', 'label', 'Base URL', 'type', 'url', 'required', false, 'order', 1)
      ),
      false,
      COALESCE(required_by, '[]'::jsonb),
      is_active,
      created_at,
      updated_at
    FROM api_services
    ON CONFLICT(name) DO NOTHING;

    -- Migrate entries (api_key + base_url + extra_config values)
    INSERT INTO config_entries (id, service_name, label, data, is_default, is_active, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      name,
      'Default',
      jsonb_strip_nulls(jsonb_build_object('api_key', api_key, 'base_url', base_url) || COALESCE(extra_config, '{}'::jsonb)),
      true,
      is_active,
      created_at,
      updated_at
    FROM api_services
    WHERE api_key IS NOT NULL OR base_url IS NOT NULL OR (extra_config IS NOT NULL AND extra_config != '{}'::jsonb)
    ON CONFLICT DO NOTHING;

    -- Drop old table
    DROP TABLE api_services;
  END IF;
END $$;

-- =====================================================
-- PLUGIN STATE PERSISTENCE
-- =====================================================
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK(status IN ('enabled', 'disabled', 'error')),
  settings JSONB NOT NULL DEFAULT '{}',
  granted_permissions JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  installed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- CUSTOM TABLE SCHEMAS: Plugin ownership
-- =====================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_table_schemas' AND column_name = 'owner_plugin_id') THEN
    ALTER TABLE custom_table_schemas ADD COLUMN owner_plugin_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_table_schemas' AND column_name = 'is_protected') THEN
    ALTER TABLE custom_table_schemas ADD COLUMN is_protected BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- =====================================================
-- LOCAL AI PROVIDERS
-- =====================================================

CREATE TABLE IF NOT EXISTS local_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('lmstudio', 'ollama', 'localai', 'vllm', 'custom')),
  base_url TEXT NOT NULL,
  api_key TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  discovery_endpoint TEXT,
  last_discovered_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS local_models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  local_provider_id TEXT NOT NULL REFERENCES local_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '["chat", "streaming"]',
  context_window INTEGER DEFAULT 32768,
  max_output INTEGER DEFAULT 4096,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, local_provider_id, model_id)
);

-- =====================================================
-- CHANNEL IDENTITY & AUTH TABLES
-- =====================================================

-- Channel users: maps platform identities to OwnPilot user IDs
CREATE TABLE IF NOT EXISTS channel_users (
  id TEXT PRIMARY KEY,
  ownpilot_user_id TEXT NOT NULL DEFAULT 'default',
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP,
  verification_method TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(platform, platform_user_id)
);

-- Channel sessions: per-channel conversation state
CREATE TABLE IF NOT EXISTS channel_sessions (
  id TEXT PRIMARY KEY,
  channel_user_id TEXT NOT NULL REFERENCES channel_users(id) ON DELETE CASCADE,
  channel_plugin_id TEXT NOT NULL,
  platform_chat_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP,
  UNIQUE(channel_user_id, channel_plugin_id, platform_chat_id)
);

-- Channel verification tokens (PIN/token auth flow)
CREATE TABLE IF NOT EXISTS channel_verification_tokens (
  id TEXT PRIMARY KEY,
  ownpilot_user_id TEXT NOT NULL DEFAULT 'default',
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  expires_at TIMESTAMP NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  used_by_channel_user_id TEXT REFERENCES channel_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  used_at TIMESTAMP
);

-- =====================================================
-- DROP FK constraints on logging/tracking tables
-- (logs should never fail due to FK violations)
-- =====================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'request_logs_conversation_id_fkey'
      AND table_name = 'request_logs'
  ) THEN
    ALTER TABLE request_logs DROP CONSTRAINT request_logs_conversation_id_fkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'costs_conversation_id_fkey'
      AND table_name = 'costs'
  ) THEN
    ALTER TABLE costs DROP CONSTRAINT costs_conversation_id_fkey;
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
-- SKILL PACKAGES (shareable tool + prompt + trigger bundles)
-- =====================================================

CREATE TABLE IF NOT EXISTS skill_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  category TEXT DEFAULT 'other',
  icon TEXT,
  author_name TEXT,
  manifest JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK(status IN ('enabled', 'disabled', 'error')),
  source_path TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  installed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- EXECUTION PERMISSIONS: Add enabled/mode columns
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_permissions' AND column_name = 'enabled') THEN
    ALTER TABLE execution_permissions ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_permissions' AND column_name = 'mode') THEN
    ALTER TABLE execution_permissions ADD COLUMN mode TEXT NOT NULL DEFAULT 'local';
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
`;

export const INDEXES_SQL = `
-- =====================================================
-- INDEXES
-- =====================================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_request_logs_user ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_conversation ON request_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_type ON request_logs(type);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_error ON request_logs(error);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created ON channel_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_costs_provider ON costs(provider);
CREATE INDEX IF NOT EXISTS idx_costs_created ON costs(created_at);
CREATE INDEX IF NOT EXISTS idx_costs_conversation ON costs(conversation_id);

-- Personal data indexes
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(user_id);
CREATE INDEX IF NOT EXISTS idx_captures_processed ON captures(processed);
CREATE INDEX IF NOT EXISTS idx_captures_type ON captures(type);
CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);

-- Pomodoro indexes
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_user ON pomodoro_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_status ON pomodoro_sessions(status);
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_started ON pomodoro_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pomodoro_daily_user_date ON pomodoro_daily_stats(user_id, date);

-- Habits indexes
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habits_archived ON habits(is_archived);
CREATE INDEX IF NOT EXISTS idx_habits_category ON habits(category);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs(habit_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, date);

-- Autonomous AI indexes
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at DESC);
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

-- Workspace indexes
CREATE INDEX IF NOT EXISTS idx_user_workspaces_user ON user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_status ON user_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_user_containers_workspace ON user_containers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_containers_user ON user_containers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_containers_status ON user_containers(status);
CREATE INDEX IF NOT EXISTS idx_code_executions_workspace ON code_executions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_executions_user ON code_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_code_executions_status ON code_executions(status);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_user ON workspace_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_workspace ON workspace_audit(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_created ON workspace_audit(created_at DESC);

-- OAuth indexes
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_user ON oauth_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_provider ON oauth_integrations(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_service ON oauth_integrations(user_id, provider, service);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_status ON oauth_integrations(status);


-- AI Models management indexes
CREATE INDEX IF NOT EXISTS idx_user_model_configs_user ON user_model_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_configs_provider ON user_model_configs(user_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_user_model_configs_enabled ON user_model_configs(is_enabled);
CREATE INDEX IF NOT EXISTS idx_custom_providers_user ON custom_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_providers_enabled ON custom_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_user ON user_provider_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_provider ON user_provider_configs(user_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_enabled ON user_provider_configs(is_enabled);

-- Custom data indexes
CREATE INDEX IF NOT EXISTS idx_custom_data_user ON custom_data(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_data_key ON custom_data(user_id, key);

-- Custom tools indexes
CREATE INDEX IF NOT EXISTS idx_custom_tools_user ON custom_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_tools_name ON custom_tools(user_id, name);
CREATE INDEX IF NOT EXISTS idx_custom_tools_status ON custom_tools(status);
CREATE INDEX IF NOT EXISTS idx_custom_tools_created_by ON custom_tools(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_tools_category ON custom_tools(category);

-- Custom table schemas indexes
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_name ON custom_table_schemas(name);
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_owner ON custom_table_schemas(owner_plugin_id);
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_protected ON custom_table_schemas(is_protected);
CREATE INDEX IF NOT EXISTS idx_custom_data_records_table ON custom_data_records(table_id);

-- Local AI Providers indexes
CREATE INDEX IF NOT EXISTS idx_local_providers_user ON local_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_local_providers_enabled ON local_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_local_providers_default ON local_providers(is_default);
CREATE INDEX IF NOT EXISTS idx_local_models_provider ON local_models(local_provider_id);
CREATE INDEX IF NOT EXISTS idx_local_models_enabled ON local_models(is_enabled);

-- Channel identity & auth indexes
CREATE INDEX IF NOT EXISTS idx_channel_users_ownpilot ON channel_users(ownpilot_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_users_platform ON channel_users(platform, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_users_verified ON channel_users(is_verified);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_user ON channel_sessions(channel_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_plugin ON channel_sessions(channel_plugin_id);
CREATE INDEX IF NOT EXISTS idx_channel_sessions_conversation ON channel_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_channel_verification_token ON channel_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_channel_verification_user ON channel_verification_tokens(ownpilot_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_verification_expires ON channel_verification_tokens(expires_at);

-- Heartbeat indexes
CREATE INDEX IF NOT EXISTS idx_heartbeats_user ON heartbeats(user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_enabled ON heartbeats(enabled);
CREATE INDEX IF NOT EXISTS idx_heartbeats_trigger ON heartbeats(trigger_id);

-- Skill package indexes
CREATE INDEX IF NOT EXISTS idx_skill_packages_user ON skill_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_packages_status ON skill_packages(status);

-- Composite indexes for high-frequency multi-column queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_user_status ON goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_user_status ON pomodoro_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs(habit_id, date);

-- Full-text search GIN index on memories
CREATE INDEX IF NOT EXISTS idx_memories_search_vector ON memories USING GIN (search_vector);

-- Embedding cache indexes
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(content_hash, model_name);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_used ON embedding_cache(last_used_at);

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
`;

/**
 * Initialize PostgreSQL schema
 */
export async function initializeSchema(exec: (sql: string) => Promise<void>): Promise<void> {
  log.info('[Schema] Initializing PostgreSQL schema...');

  // Create tables
  await exec(SCHEMA_SQL);
  log.info('[Schema] Tables created');

  // Run migrations (add missing columns to existing tables)
  await exec(MIGRATIONS_SQL);
  log.info('[Schema] Migrations applied');

  // Create indexes
  await exec(INDEXES_SQL);
  log.info('[Schema] Indexes created');

  log.info('[Schema] PostgreSQL schema initialized successfully');
}
