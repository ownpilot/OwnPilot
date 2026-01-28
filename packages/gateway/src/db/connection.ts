/**
 * Database Connection
 *
 * SQLite database connection management
 * Uses the paths module for proper data directory management
 */

import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { getDatabasePath, initializeDataDirectories } from '../paths/index.js';

let db: Database.Database | null = null;

export interface DatabaseConfig {
  path?: string;
  inMemory?: boolean;
  verbose?: boolean;
}

/**
 * Get or create database connection
 */
export function getDatabase(config?: DatabaseConfig): Database.Database {
  console.log('[Database] getDatabase() called');
  if (db) {
    console.log('[Database] Returning existing connection');
    return db;
  }
  console.log('[Database] Creating new connection...');

  // Initialize data directories first
  initializeDataDirectories();

  const dbPath = config?.inMemory
    ? ':memory:'
    : config?.path ?? getDatabasePath();

  // Ensure directory exists
  if (!config?.inMemory && dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  db = new Database(dbPath, {
    verbose: config?.verbose ? console.log : undefined,
  });

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  try {
    console.log('[Database] Initializing schema...');
    initializeSchema(db);
    console.log('[Database] Schema initialized successfully.');
  } catch (error) {
    console.error('[Database] Schema initialization failed:', error);
    throw error;
  }

  // Run seeds (delayed import to avoid circular dependency)
  setTimeout(() => {
    import('./seeds/index.js').then(({ runSeeds }) => runSeeds()).catch(() => {});
  }, 100);

  console.log(`Database connected: ${dbPath}`);
  return db;
}

/**
 * Initialize database schema
 */
function initializeSchema(database: Database.Database): void {
  database.exec(`
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
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}'
    );

    -- Messages table (chat messages)
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      trace TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
      request_body TEXT,
      response_body TEXT,
      status_code INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      duration_ms INTEGER,
      error TEXT,
      error_stack TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    -- Channels table
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      connected_at TEXT,
      last_activity_at TEXT
    );

    -- Channel messages (inbox)
    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      external_id TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      sender_id TEXT,
      sender_name TEXT,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      attachments TEXT,
      reply_to_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    -- Agent configs table
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      system_prompt TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Settings table (key-value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      tags TEXT DEFAULT '[]',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Notes table
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'markdown',
      category TEXT,
      tags TEXT DEFAULT '[]',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tasks table
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      due_date TEXT,
      due_time TEXT,
      reminder_at TEXT,
      category TEXT,
      tags TEXT DEFAULT '[]',
      parent_id TEXT,
      project_id TEXT,
      recurrence TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    -- Calendar events table
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      timezone TEXT DEFAULT 'UTC',
      recurrence TEXT,
      reminder_minutes INTEGER,
      category TEXT,
      tags TEXT DEFAULT '[]',
      color TEXT,
      external_id TEXT,
      external_source TEXT,
      attendees TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      tags TEXT DEFAULT '[]',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      external_id TEXT,
      external_source TEXT,
      social_links TEXT DEFAULT '{}',
      custom_fields TEXT DEFAULT '{}',
      last_contacted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reminders table (standalone reminders)
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      remind_at TEXT NOT NULL,
      recurrence TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      related_type TEXT,
      related_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Quick captures (inbox for quick thoughts/ideas)
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'thought' CHECK(type IN ('idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other')),
      tags TEXT DEFAULT '[]',
      source TEXT,
      url TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      processed_as_type TEXT CHECK(processed_as_type IN ('note', 'task', 'bookmark', 'discarded') OR processed_as_type IS NULL),
      processed_as_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
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
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      interrupted_at TEXT,
      interruption_reason TEXT
    );

    -- Pomodoro settings (per user)
    CREATE TABLE IF NOT EXISTS pomodoro_settings (
      user_id TEXT PRIMARY KEY DEFAULT 'default',
      work_duration INTEGER NOT NULL DEFAULT 25,
      short_break_duration INTEGER NOT NULL DEFAULT 5,
      long_break_duration INTEGER NOT NULL DEFAULT 15,
      sessions_before_long_break INTEGER NOT NULL DEFAULT 4,
      auto_start_breaks INTEGER NOT NULL DEFAULT 0,
      auto_start_work INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      target_days TEXT DEFAULT '[]',
      target_count INTEGER NOT NULL DEFAULT 1,
      unit TEXT,
      category TEXT,
      color TEXT,
      icon TEXT,
      reminder_time TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      streak_current INTEGER NOT NULL DEFAULT 0,
      streak_longest INTEGER NOT NULL DEFAULT 0,
      total_completions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Habit logs (daily completions)
    CREATE TABLE IF NOT EXISTS habit_logs (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'default',
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
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
      embedding BLOB,
      source TEXT,
      source_id TEXT,
      importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
      tags TEXT DEFAULT '[]',
      accessed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT,
      metadata TEXT DEFAULT '{}'
    );

    -- Goals table (long-term objectives)
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'abandoned')),
      priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
      parent_id TEXT,
      due_date TEXT,
      progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (parent_id) REFERENCES goals(id) ON DELETE SET NULL
    );

    -- Goal steps table (actionable steps for goals)
    CREATE TABLE IF NOT EXISTS goal_steps (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped')),
      order_num INTEGER NOT NULL,
      dependencies TEXT DEFAULT '[]',
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );

    -- Triggers table (proactive automation)
    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('schedule', 'event', 'condition', 'webhook')),
      config TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 1 AND priority <= 10),
      last_fired TEXT,
      next_fire TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Trigger history (execution log)
    CREATE TABLE IF NOT EXISTS trigger_history (
      id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL,
      fired_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'skipped')),
      result TEXT,
      error TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (trigger_id) REFERENCES triggers(id) ON DELETE CASCADE
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
      trigger_id TEXT,
      goal_id TEXT,
      autonomy_level INTEGER NOT NULL DEFAULT 1 CHECK(autonomy_level >= 0 AND autonomy_level <= 4),
      max_retries INTEGER NOT NULL DEFAULT 3,
      retry_count INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER,
      checkpoint TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (trigger_id) REFERENCES triggers(id) ON DELETE SET NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );

    -- Plan steps table (individual steps in a plan)
    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      order_num INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan')),
      name TEXT NOT NULL,
      description TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting')),
      dependencies TEXT DEFAULT '[]',
      result TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      timeout_ms INTEGER,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      on_success TEXT,
      on_failure TEXT,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );

    -- Plan execution history
    CREATE TABLE IF NOT EXISTS plan_history (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      step_id TEXT,
      event_type TEXT NOT NULL CHECK(event_type IN ('started', 'step_started', 'step_completed', 'step_failed', 'paused', 'resumed', 'completed', 'failed', 'cancelled', 'checkpoint')),
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES plan_steps(id) ON DELETE SET NULL
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
      expires_at TEXT,
      scopes TEXT NOT NULL DEFAULT '[]',
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked', 'error')),
      last_sync_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider, service)
    );

    -- Media provider settings (per-capability provider selection)
    CREATE TABLE IF NOT EXISTS media_provider_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      capability TEXT NOT NULL CHECK(capability IN ('image_generation', 'vision', 'tts', 'stt', 'weather')),
      provider TEXT NOT NULL,
      model TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, capability)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
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
      container_config TEXT NOT NULL DEFAULT '{}',
      container_id TEXT,
      container_status TEXT NOT NULL DEFAULT 'stopped' CHECK(container_status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity_at TEXT
    );

    -- User containers (active Docker containers)
    CREATE TABLE IF NOT EXISTS user_containers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      container_id TEXT NOT NULL UNIQUE,
      image TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting' CHECK(status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
      memory_mb INTEGER NOT NULL DEFAULT 512,
      cpu_cores REAL NOT NULL DEFAULT 0.5,
      network_policy TEXT NOT NULL DEFAULT 'none',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity_at TEXT,
      stopped_at TEXT,
      memory_peak_mb INTEGER DEFAULT 0,
      cpu_time_ms INTEGER DEFAULT 0,
      network_bytes_in INTEGER DEFAULT 0,
      network_bytes_out INTEGER DEFAULT 0,
      FOREIGN KEY (workspace_id) REFERENCES user_workspaces(id) ON DELETE CASCADE
    );

    -- Code executions history
    CREATE TABLE IF NOT EXISTS code_executions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES user_workspaces(id) ON DELETE CASCADE
    );

    -- Workspace audit log
    CREATE TABLE IF NOT EXISTS workspace_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      action TEXT NOT NULL CHECK(action IN ('create', 'read', 'write', 'delete', 'execute', 'start', 'stop')),
      resource_type TEXT NOT NULL CHECK(resource_type IN ('workspace', 'file', 'container', 'execution')),
      resource TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    -- OAuth & Media settings indexes
    CREATE INDEX IF NOT EXISTS idx_oauth_integrations_user ON oauth_integrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_integrations_provider ON oauth_integrations(user_id, provider);
    CREATE INDEX IF NOT EXISTS idx_oauth_integrations_service ON oauth_integrations(user_id, provider, service);
    CREATE INDEX IF NOT EXISTS idx_oauth_integrations_status ON oauth_integrations(status);
    CREATE INDEX IF NOT EXISTS idx_media_provider_settings_user ON media_provider_settings(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_provider_settings_capability ON media_provider_settings(user_id, capability);

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
      capabilities TEXT NOT NULL DEFAULT '[]',
      pricing_input REAL,
      pricing_output REAL,
      context_window INTEGER,
      max_output INTEGER,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_custom INTEGER NOT NULL DEFAULT 0,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      is_enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider_id)
    );

    -- User provider configs (overrides for built-in providers - survives models.dev sync)
    CREATE TABLE IF NOT EXISTS user_provider_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      provider_id TEXT NOT NULL,
      base_url TEXT,
      provider_type TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      api_key_env TEXT,
      notes TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider_id)
    );

    -- AI Models management indexes
    CREATE INDEX IF NOT EXISTS idx_user_model_configs_user ON user_model_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_model_configs_provider ON user_model_configs(user_id, provider_id);
    CREATE INDEX IF NOT EXISTS idx_user_model_configs_enabled ON user_model_configs(is_enabled);
    CREATE INDEX IF NOT EXISTS idx_custom_providers_user ON custom_providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_custom_providers_enabled ON custom_providers(is_enabled);
    CREATE INDEX IF NOT EXISTS idx_user_provider_configs_user ON user_provider_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_provider_configs_provider ON user_provider_configs(user_id, provider_id);
    CREATE INDEX IF NOT EXISTS idx_user_provider_configs_enabled ON user_provider_configs(is_enabled);
  `);
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('Database connection closed');
  }
}

/**
 * Get raw database instance (for advanced operations)
 */
export function getRawDatabase(): Database.Database | null {
  return db;
}
