-- Usage Records — DB-backed persistence for UsageTracker
-- Replaces in-memory-only storage so costs survive restarts

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost DECIMAL(10, 6) DEFAULT 0,
  latency_ms DECIMAL(10, 2) DEFAULT 0,
  request_type TEXT DEFAULT 'chat',
  error TEXT,
  session_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_timestamp ON usage_records(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_provider ON usage_records(provider);
