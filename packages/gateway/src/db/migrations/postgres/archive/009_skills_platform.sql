-- 009: Skills Platform (Phase 6)
-- Adds permission and npm fields to user_extensions table

-- Create user_extensions table if it doesn't exist (for fresh installs)
CREATE TABLE IF NOT EXISTS user_extensions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  format TEXT NOT NULL DEFAULT 'ownpilot',
  icon TEXT,
  author_name TEXT,
  manifest JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled', 'disabled', 'error')),
  source_path TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  installed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add columns for skills platform (idempotent)
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS npm_package TEXT;
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS npm_version TEXT;
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"required":[],"optional":[]}';
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS granted_permissions JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_extensions_npm ON user_extensions(npm_package) WHERE npm_package IS NOT NULL;

-- Core indexes for user_extensions
CREATE INDEX IF NOT EXISTS idx_user_extensions_user ON user_extensions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_extensions_name ON user_extensions(user_id, name);
CREATE INDEX IF NOT EXISTS idx_user_extensions_status ON user_extensions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_extensions_user_name ON user_extensions(user_id, name);
