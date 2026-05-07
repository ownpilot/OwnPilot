# ADR-001: Persistent Job Queue Layer

**Status:** Proposed | **Date:** 2026-05-07 | **Deciders:** OwnPilot Team

---

## Context

Five autonomous systems in OwnPilot implement cron-like or event-driven logic with no durable persistence across process restarts:

- **Triggers** (schedule, event, webhook) — in-memory timer + DB state
- **Plans** — step executor with DB state per step
- **Workflows** — DAG engine with `workflow_logs` written per-run, but in-progress node state is lost on crash
- **Subagents** — sessions in-memory + DB, heartbeat-based orphan detection
- **Heartbeats** (`SoulHeartbeatService`) — `FOR UPDATE SKIP LOCKED` via `pg_advisory_lock` for singleton enforcement

**Failure Scenario:** Workflow engine is running a 24-node DAG, node #7 is executing. Gateway process is killed (OOM, deploy, SIGKILL). On restart: the in-progress node state is lost. This is **at-most-once** execution. The user expects **at-least-once** or **exactly-once**.

The `EventSystem` is entirely in-memory. The `ClawManager` holds `Map<clawId, ClawSession>` in-memory. Fleet sessions are in-memory.

---

## Decision

Introduce a **durable job queue** backed by **Postgres** — no new infrastructure (Redis/RabbitMQ) required. Jobs live in a `jobs` table. Workers use `FOR UPDATE SKIP LOCKED` to claim jobs, preventing multiple workers from picking up the same job.

**Chosen implementation:** `pg-boss` (pg-boss on npm) — pure Node.js, Postgres-based, no extra services, async messaging with job persistence. Alternative considered: **Graphile Worker** (same Postgres-only approach, but synchronous migration-first pattern). pg-boss chosen for its simpler async job enqueue API and first-class retry with exponential backoff.

---

## Requirements

1. **At-least-once execution** — a job must be retried until it succeeds or reaches dead-letter limit
2. **Exactly-once tool execution** — idempotency keys (already in place) prevent duplicate tool execution from retries
3. **No extra infrastructure** — must run on existing Postgres
4. **Priority support** — system jobs (health checks, orphan reconciliation) must outrank user jobs
5. **Dead-letter queue** — jobs that fail N times go to a DLQ table for manual inspection
6. **Observability** — queue depth, job success/failure rates visible in metrics

---

## Schema Design

### `jobs` table

```sql
CREATE TABLE jobs (
  id              TEXT        PRIMARY KEY,         -- job ID (UUID)
  name            TEXT        NOT NULL,             -- job type (e.g. "workflow_node", "trigger_fire")
  queue           TEXT        NOT NULL DEFAULT 'default',
  priority        INTEGER     NOT NULL DEFAULT 0,    -- higher = more urgent
  payload         JSONB       NOT NULL DEFAULT '{}',
  result          JSONB,
  status          TEXT        NOT NULL DEFAULT 'available'
                   CHECK(status IN ('available', 'active', 'completed', 'failed', 'cancelled')),
  run_after       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jobs_attempts_check CHECK (attempts <= max_attempts)
);

CREATE INDEX idx_jobs_priority_status_run_after
  ON jobs(priority DESC, status, run_after)
  WHERE status = 'available';
```

### `job_history` table (dead-letter + audit)

```sql
CREATE TABLE job_history (
  id              TEXT        PRIMARY KEY,
  job_id          TEXT        NOT NULL,
  job_name        TEXT        NOT NULL,
  queue           TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  result          JSONB,
  status          TEXT        NOT NULL,
  attempt         INTEGER     NOT NULL,
  max_attempts    INTEGER     NOT NULL,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error           TEXT,
  PRIMARY KEY(id, failed_at)
) PARTITION BY RANGE (failed_at);
```

---

## Retry Policy

- Exponential backoff: `min(attempt^2 * 5 seconds, 1 hour)`
- Max attempts: configurable per job type (default 3)
- After max attempts: move to `job_history`, job marked `failed`
- Cancellation: worker checks `status` before execution; cancelled jobs skipped

---

## Integration Plan

### Phase 1: Infrastructure (gateway)
1. Add `jobs` + `job_history` tables to `schema/core.ts`
2. Add `JobQueueService` (wraps pg-boss) to `services/`
3. Add `enqueueJob(name, payload, options)` function
4. Add `enqueueJobAtPriority(queue, priority)` for system jobs

### Phase 2: Workflow System (gateway)
1. Refactor `WorkflowService.dispatchNode()` to enqueue each node as a job instead of executing synchronously
2. Worker pool (configurable size, default 4) claims available jobs, executes, writes results, triggers dependents via gating
3. Node outputs stored in DB — crash recovery reads last successful node output + resumes from next pending node
4. Workflow-level job groups: all nodes in a workflow share a `workflow_run_id`; orphan cleanup marks incomplete runs on restart

### Phase 3: Trigger + Plan Systems (gateway)
1. `TriggerService.scheduleJob()` → enqueue for cron jobs
2. `PlanExecutor` → each step becomes a job; step N+1 enqueued after step N succeeds
3. Subagent sessions → wake up, re-claim in-progress job on reconnect

### Phase 4: Fleet + Subagent (gateway)
1. Fleet worker pool claims jobs from `fleet_tasks` queue
2. Subagent worker pool claims from `subagent_jobs` queue
3. `requeueOrphanedTasks()` replaced by jobs that self-recover on worker restart

---

## Consequences

### Positive
- **Crash recovery**: workers restart, see `active`/`available` jobs, continue
- **Horizontal scaling**: multiple gateway instances share the same queue via `FOR UPDATE SKIP LOCKED`
- **Retry with backoff**: no thundering herd on transient failures
- **No extra infra**: uses existing Postgres, deployed via migration

### Negative
- **Added latency**: jobs are queued, not synchronous; UI feedback must reflect queued state
- **Complexity**: requires managing job state machine + worker pool lifecycle
- **Transaction boundaries**: job claim + result write must be atomic; careful use of `FOR UPDATE SKIP LOCKED`

### Risks
- **Queue depth explosion**: if workers are slower than enqueuers, queue grows unbounded. Mitigate: monitor queue depth in metrics, alert at threshold, circuit-breaker on enqueue
- **Job lock contention**: many workers competing for same priority tier. Mitigate: partition by queue name + priority

---

## Alternatives Considered

| Option | Why Not |
|--------|---------|
| **Redis** (Bull/BullMQ) | Extra infrastructure to deploy/monitor; Redis failure = queue unavailable |
| **Graphile Worker** | More opinionated (synchronous, migration-first); pg-boss async API fits our enqueue-anywhere pattern better |
| **In-memory only** | Already the problem we are solving |
| **SQS/IronMQ** | Cloud-only, not self-hosted; adds vendor lock-in |

---

## Implementation Notes

- **Idempotency keys** (already implemented): `executeTool()` uses SHA-256(toolName+args) as idempotency key. This is orthogonal to the job queue — tool deduplication works regardless of queue implementation.
- **Orphan reconciliation** (already implemented): `reconcileOrphanedSessions()` handles crash recovery for in-flight sessions. The job queue supplements this: after a crash, orphaned jobs are re-claimed by workers within seconds.
- **Existing cleanup methods** (`cleanupOld`, `cleanupHistory`) remain valid for data retention, independent of the job queue.
