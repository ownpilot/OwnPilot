-- ADR-002: Database Retention Policy
-- gap 24.3 Phase 1 — centralized retention enforcement
-- Creates retention_policies metadata table.
-- Each table's actual cleanup is handled by its existing repository cleanup method.
-- A nightly job (via JobQueueService) reads this table and runs due cleanups.

CREATE TABLE IF NOT EXISTS retention_policies (
  table_name     TEXT PRIMARY KEY,
  retention_days INTEGER NOT NULL DEFAULT 30,
  last_cleanup   TIMESTAMPTZ,
  enabled        BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO retention_policies (table_name, retention_days, enabled) VALUES
  ('request_logs',      30, true),
  ('audit_log',         90, true),
  ('claw_history',      90, true),
  ('claw_audit_log',     30, true),
  ('workflow_logs',     90, true),
  ('plan_history',      90, true),
  ('trigger_history',   30, true),
  ('heartbeat_log',    30, true),
  ('subagent_history', 90, true),
  ('embedding_cache',    7, true),
  ('jobs',              30, true),
  ('job_history',       90, true),
  ('provider_metrics',  30, true)
ON CONFLICT (table_name) DO NOTHING;
