-- 037_perf_indexes.sql
-- Hot-path indexes that match the actual query shapes used by
-- FleetManager.tick() and the trigger dispatch loop.
--
-- Both queries today rely on single-column indexes that the planner
-- has to combine + sort over. With realistic row counts (queued
-- tasks per fleet, total enabled schedule triggers) these turn into
-- visible CPU floors in the polling loops.

-- FleetManager.tick() calls FleetRepository.getReadyTasks(fleetId, limit)
-- which runs: WHERE fleet_id = $1 AND status = 'queued' ORDER BY priority, created_at
-- Existing indexes are on (fleet_id) and (status) separately. The composite
-- lets Postgres filter on both predicates from a single index scan.
CREATE INDEX IF NOT EXISTS idx_fleet_tasks_fleet_status
  ON fleet_tasks(fleet_id, status);

-- TriggersRepository.getDueTriggers() runs:
-- WHERE user_id = $1 AND enabled = true AND type = 'schedule'
--   AND next_fire IS NOT NULL AND next_fire <= $2
-- The existing idx_triggers_next_fire(next_fire) full-column index also
-- contains disabled / non-schedule / never-scheduled rows. A partial
-- index keeps only candidates, shrinking the polling scan dramatically
-- as users accumulate disabled or event-type triggers.
CREATE INDEX IF NOT EXISTS idx_triggers_due
  ON triggers(user_id, next_fire)
  WHERE enabled = true AND type = 'schedule' AND next_fire IS NOT NULL;
