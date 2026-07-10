-- Drop legacy autonomous-agent systems removed in 2026-05-23 cleanup.
--
-- These three subsystems overlapped with Claw + Workflow and added cognitive
-- load without unique capabilities:
--   - Fleet: worker army (covered by Claw concurrent + Workflow parallelNode)
--   - Subagent: ephemeral spawn (covered by claw_spawn_subclaw / crew delegate_task)
--   - Orchestra: multi-task DAG (tightly coupled to Subagent; gone with it)
--
-- All drops use IF EXISTS for idempotency. CASCADE removes child foreign-key
-- references (fleet_sessions → fleets, fleet_tasks → fleets, etc.).

-- Fleet system
DROP TABLE IF EXISTS fleet_worker_history CASCADE;
DROP TABLE IF EXISTS fleet_tasks CASCADE;
DROP TABLE IF EXISTS fleet_sessions CASCADE;
DROP TABLE IF EXISTS fleets CASCADE;

-- Subagent system
DROP TABLE IF EXISTS subagent_history CASCADE;

-- Orchestra system
DROP TABLE IF EXISTS orchestra_executions CASCADE;

-- Clean up retention_policies entries for dropped tables (no-op if absent).
DELETE FROM retention_policies WHERE table_name IN (
  'subagent_history',
  'orchestra_executions',
  'fleets',
  'fleet_sessions',
  'fleet_tasks',
  'fleet_worker_history'
);
