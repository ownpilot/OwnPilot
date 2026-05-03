/**
 * UI Session Schema — persistent UI and MCP session tokens
 */

export const UI_SESSIONS_TABLES_SQL = `
-- =====================================================
-- UI SESSION TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS ui_sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'ui',
  user_id TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  metadata JSONB DEFAULT '{}'
);
`;

export const UI_SESSIONS_MIGRATIONS_SQL = ``;

export const UI_SESSIONS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_ui_sessions_expires_at ON ui_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ui_sessions_kind ON ui_sessions(kind);
`;
