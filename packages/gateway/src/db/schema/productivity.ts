export const PRODUCTIVITY_TABLES_SQL = `
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
`;

export const PRODUCTIVITY_MIGRATIONS_SQL = ``;

export const PRODUCTIVITY_INDEXES_SQL = `
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

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_user_status ON pomodoro_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs(habit_id, date);
`;
