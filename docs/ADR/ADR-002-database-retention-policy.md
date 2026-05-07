# ADR-002: Database Retention Policy

**Date:** 2026-05-07
**Status:** Proposed
**Priority:** P2

---

## Context

The following tables grow unbounded without automated retention enforcement:
`request_logs`, `audit_log`, `claw_history`, `claw_audit_log`, `workflow_logs`, `plan_history`, `trigger_history`, `heartbeat_log`, `subagent_history`, `embedding_cache`, `jobs`, `job_history`, `provider_metrics`

Each has a `cleanup*` method in its repository, but cleanup must be triggered manually or via per-service `setInterval` — creating scattered, inconsistent cleanup logic with no central policy.

---

## Decision

Centralize retention enforcement at the database level using a single nightly cleanup job. A `retention_policies` table defines per-table retention intervals. A nightly cron job (fired via the existing `JobQueueService`) runs all due cleanups.

### Retention Intervals

| Table | Retention | Rationale |
|-------|-----------|-----------|
| `request_logs` | 30 days | API debugging, auditability |
| `audit_log` | 90 days | Compliance requirement |
| `claw_history` | 90 days | Audit trail |
| `claw_audit_log` | 30 days | High-volume audit detail |
| `workflow_logs` | 90 days | Workflow execution history |
| `plan_history` | 90 days | Plan execution history |
| `trigger_history` | 30 days | Trigger event log |
| `heartbeat_log` | 30 days | High-frequency heartbeat events |
| `subagent_history` | 90 days | Agent execution history |
| `embedding_cache` | 7 days | LRU cache, auto-evicts |
| `jobs` | 30 days | Completed/failed jobs |
| `job_history` | 90 days | Dead-letter entries |
| `provider_metrics` | 30 days | High-frequency telemetry |

---

## Schema

```sql
CREATE TABLE IF NOT EXISTS retention_policies (
  table_name     TEXT PRIMARY KEY,
  retention_days INTEGER NOT NULL DEFAULT 30,
  last_cleanup   TIMESTAMPTZ,
  enabled        BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO retention_policies (table_name, retention_days, enabled) VALUES
  ('request_logs',     30, true),
  ('audit_log',        90, true),
  ('claw_history',     90, true),
  ('claw_audit_log',   30, true),
  ('workflow_logs',    90, true),
  ('plan_history',     90, true),
  ('trigger_history',  30, true),
  ('heartbeat_log',   30, true),
  ('subagent_history',90, true),
  ('embedding_cache',  7,  true),
  ('jobs',             30, true),
  ('job_history',      90, true),
  ('provider_metrics', 30, true)
ON CONFLICT (table_name) DO NOTHING;
```

---

## Cleanup Job

A single `nightly_retention_cleanup` job runs daily at 02:00 UTC (configurable). For each enabled policy:
1. Call the table's existing `cleanup{N}(retention_days)` method
2. Update `retention_policies.last_cleanup = NOW()`
3. Log count of deleted records

### Implementation

```typescript
// services/retention-service.ts
export class RetentionService {
  async runCleanup(): Promise<Record<string, number>> {
    const policies = await repo.listEnabled();
    const results: Record<string, number> = {};
    for (const policy of policies) {
      const count = await this.cleanupTable(policy.tableName, policy.retentionDays);
      await repo.updateLastCleanup(policy.tableName);
      results[policy.tableName] = count;
    }
    return results;
  }

  private async cleanupTable(table: string, days: number): Promise<number> {
    const methods: Record<string, () => Promise<number>> = {
      request_logs:      () => getRequestLogsRepository().cleanupOld(days),
      audit_log:        () => getAuditRepository().cleanupOld(days),
      claw_history:     () => getClawsRepository().cleanupOldHistory(days),
      claw_audit_log:   () => getClawsRepository().cleanupOldAuditLog(days),
      workflow_logs:    () => getWorkflowsRepository().cleanupOld(days),
      plan_history:     () => getPlansRepository().cleanupOld(days),
      trigger_history:  () => getTriggersRepository().cleanupHistory(days),
      heartbeat_log:    () => getHeartbeatRepository().cleanupOld(days),
      subagent_history: () => getSubagentsRepository().cleanupOld(days),
      embedding_cache:  () => getEmbeddingCacheRepository().cleanupOld(days),
      jobs:             () => getJobsRepository().cleanupOld(days),
      job_history:      () => getJobsRepository().cleanupHistory(days),
      provider_metrics: () => getProviderMetricsRepository().cleanupOld(days),
    };
    const fn = methods[table];
    if (!fn) { log.warn('No cleanup method for table', { table }); return 0; }
    return fn();
  }
}
```

Nightly job registration in `server.ts`:
```typescript
const { getJobQueueService } = await import('./services/job-queue-service.js');
const queue = getJobQueueService();
await queue.enqueue('nightly_retention_cleanup', {}, { queue: 'system', priority: 100, runAfter: nextUTCMidnight() });
```

---

## DB-Level Enforcement (Future)

Partition-based TTL expiry is the long-term solution (Postgres 15+ native table partitioning with `DETACH PARTITION` + `DROP TABLE` for expired partitions). This requires Drizzle ORM migration (gap 24.3) and is deferred.

Until then, the nightly job is the enforcement mechanism.

---

## Consequences

- **Positive:** Single cleanup schedule, configurable per table, observable via `retention_policies.last_cleanup`, no per-service timers
- **Negative:** Nightly cleanup may run long on large tables — consider batching (cleanup 10K rows at a time, reschedule if needed)
- **Workaround:** `enabled=false` disables cleanup for a table temporarily (e.g., before a migration)
