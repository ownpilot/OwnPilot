-- Add idx_claw_sessions_state to support fast lookups by session state.
-- ClawsRepository.getInterruptedSessions() filters claw_sessions on
-- state IN ('running', 'waiting', 'starting'). Without this index, that
-- scan is O(n) over the full claw_sessions table on every server boot.
-- The index was previously declared in db/schema/claw.ts CLAW_INDEXES_SQL
-- but never produced as a versioned migration, so existing PostgreSQL
-- installs that bootstrap via the migrations folder lacked it.

CREATE INDEX IF NOT EXISTS idx_claw_sessions_state ON claw_sessions(state);
