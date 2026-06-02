# Plan 14 — OpenTelemetry Observability Migration

**Priority:** P2
**Effort:** L (1 week)
**Risk:** Low
**Depends on:** 12 (test stability for the new instrumentation tests)
**Source reports:** `refactor.md` §4.1, §12 (Notable OTel gaps), §11
(don't introduce new state library)

---

## Context

The gateway has an internal `tracing` ALS (AsyncLocalStorage) context
in `packages/gateway/src/tracing/index.ts` that provides per-request
trace context. It is functional but limited:

- No OTel, no Sentry, no Prometheus exporter.
- The internal trace types are not exported.
- Subsystems listed in `refactor.md` §12 emit no structured spans:
  - `ToolExecutor.executeTool()` — no parent span for tool calls
  - `BaseRepository.query()` — no DB query spans
  - `AgentRunner.executeCycle()` / `SoulHeartbeatService.run()` — no
    agent cycle spans
  - `WorkflowService.dispatchNode()` — node-level spans missing
  - WebSocket message handlers

This plan introduces `@opentelemetry/sdk-node` with auto-instrumentation
for Postgres, HTTP, and Hono. The internal `tracing` module becomes a
thin wrapper that _also_ emits OTel spans. Self-hosted users can
ignore OTel; ops users wire any backend (Jaeger, Tempo, Datadog,
Honeycomb, Sentry).

## Scope

- `packages/gateway/src/tracing/index.ts` (existing, becomes OTel-aware)
- `packages/gateway/src/services/tool/executor.ts` (tool span)
- `packages/gateway/src/db/repositories/base.ts` (DB span)
- `packages/gateway/src/services/claw/runner.ts` (cycle span)
- `packages/gateway/src/services/soul/heartbeat.ts` (heartbeat span)
- `packages/gateway/src/services/workflow/workflow-service.ts` (node span)
- `packages/gateway/src/ws/server.ts` (WS message span)
- `packages/gateway/package.json` (adds OTel deps)

## Goals

1. `@opentelemetry/sdk-node` is integrated; auto-instrumentation
   covers `http`, `pg`, `hono`, and `ioredis` (if used).
2. The internal `tracing` API is preserved (no breaking change for
   existing call sites).
3. Domain-flavored span names — `tool_call`, `memory_recall`,
   `autonomy_check`, `claw.cycle`, `workflow.node`, `db.query` —
   are emitted with consistent attributes.
4. The OTel SDK is gated behind `OWNPILOT_OTEL_ENABLED` (default off
   for self-hosted; on when `OTEL_EXPORTER_OTLP_ENDPOINT` is set).
5. Existing `pino` logs are bridged to OTel via `pino-opentelemetry-
transport` so log lines include `traceId` / `spanId`.
6. A new `audit.observability` page in the admin UI shows the active
   span exporter and recent span rate.

## Implementation Steps

### Step 1 — Add OTel dependencies

In `packages/gateway/package.json`:

```json
"dependencies": {
  "@opentelemetry/api": "^1.9.0",
  "@opentelemetry/sdk-node": "^0.55.0",
  "@opentelemetry/auto-instrumentations-node": "^0.52.0",
  "@opentelemetry/exporter-trace-otlp-http": "^0.55.0",
  "@opentelemetry/resources": "^1.27.0",
  "@opentelemetry/semantic-conventions": "^1.27.0"
}
```

The `OTLP HTTP exporter` is the default; users can switch to gRPC or
stdout via env vars (`OTEL_TRACES_EXPORTER=console` for local dev).

### Step 2 — Initialize the SDK

Create `packages/gateway/src/tracing/otel-init.ts`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let started = false;
export function startOtel() {
  if (started || process.env.OWNPILOT_OTEL_ENABLED !== 'true') return;
  const sdk = new NodeSDK({
    resource: { 'service.name': 'ownpilot-gateway' },
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
      }),
    ],
  });
  sdk.start();
  started = true;
}
```

Call `startOtel()` from `server.ts` _before_ any other module is
imported (OTel's monkey-patching must happen at boot).

### Step 3 — Wrap the internal `tracing` module

In `packages/gateway/src/tracing/index.ts`:

- Keep the ALS context for cross-cutting metadata.
- Add a `withSpan(name, attributes, fn)` helper that creates an OTel
  span, runs `fn(span)`, and ends the span on completion (with error
  capture on throw).
- The existing `tracing.getContext()` API is preserved; it now also
  sets the current OTel context.

### Step 4 — Instrument the call sites

For each of the five subsystems, wrap the entry point in
`withSpan(...)`:

- `ToolExecutor.executeTool(name, args)` — span name `tool.execute`,
  attributes `{ tool.name, tool.kind, tool.duration_ms }`.
- `BaseRepository.query(sql, params)` — span name `db.query`,
  attributes `{ db.system: 'postgresql', db.statement: sql,
db.operation: parseOp(sql) }`. **Important:** redact bind parameters
  in production (they may contain PII).
- `ClawRunner.runCycle(...)` — span name `claw.cycle`,
  attributes `{ claw.id, cycle.number, cycle.kind }`.
- `SoulHeartbeatService.run()` — span name `soul.heartbeat`,
  attributes `{ soul.id, soul.kind }`.
- `WorkflowService.dispatchNode(...)` — span name `workflow.node`,
  attributes `{ workflow.id, node.id, node.kind }`.
- `WSGateway.handleMessage(msg)` — span name `ws.message`,
  attributes `{ ws.kind, ws.client_id }`.

### Step 5 — Bridge `pino` to OTel

Replace the existing `pino` transport with
`pino-opentelemetry-transport`:

```ts
import pino from 'pino';
const log = pino({
  transport: {
    target: 'pino-opentelemetry-transport',
    options: {
      /* resource attributes */
    },
  },
});
```

Log lines now include `traceId` and `spanId` for correlation. The
existing log-search UI works unchanged; the OTel-aware UI surfaces
the trace alongside the log.

### Step 6 — Admin observability panel

Add a new admin route `GET /api/v1/admin/observability` that returns:

- The active span exporter (`otlp-http` / `console` / `none`).
- The number of spans emitted in the last 60 seconds.
- A list of recent trace IDs sampled at 0.1% (rate-limited to avoid
  leaking too much).

The admin UI page renders this with a link to the OTel backend for
deep-dive.

## Acceptance Criteria

1. Setting `OWNPILOT_OTEL_ENABLED=true` and
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` causes the
   gateway to emit OTLP traces on every request.
2. The five subsystems (tool, db, claw, soul, workflow, ws) emit
   spans with the documented attributes.
3. `pino` log lines include `traceId` and `spanId` when an active span
   exists.
4. The existing `tracing` API (`getContext`, `runWithContext`, etc.)
   still works; existing call sites need no changes.
5. The admin observability page returns live data; the test asserts
   the response shape.
6. No regression in any existing test (the OTel SDK is initialized
   _after_ tests start, in `server.ts` only).

## Test Plan

- `tests/tracing/otel-init.test.ts` — env-gated initialization; the
  SDK is not started when `OWNPILOT_OTEL_ENABLED !== 'true'`.
- `tests/tracing/with-span.test.ts` — happy path, exception path,
  ALS context propagation.
- `tests/services/tool-executor.test.ts` — assert a `tool.execute`
  span is created (use the in-memory exporter for assertions).
- `tests/admin/observability.test.ts` — the new admin route returns
  the expected shape.

## Risks & Rollback

- **Risk:** The OTel auto-instrumentation adds latency and memory
  overhead. Mitigation: the SDK is opt-in; the default for self-
  hosted users is off. Operators can profile before turning it on.
- **Risk:** Auto-instrumentation of `fs` is too noisy (every file
  read emits a span). Mitigation: disabled in Step 2.
- **Risk:** DB query parameter redaction is imperfect — PII may
  leak through. Mitigation: redact via a configurable allowlist;
  default to redact all `string` parameters.
- **Rollback:** Set `OWNPILOT_OTEL_ENABLED=false` (or unset) and
  restart. The SDK is fully feature-gated.

## Out of Scope

- Migrating from pino to a different logger. Pino is the right tool.
- Adding metrics (counters, histograms). OTel metrics are a
  separate SDK; this plan covers traces only.
- Adding profiling (continuous CPU / allocation profiling). OTel
  profiling is experimental; defer.
- Distributed tracing across the CLI / UI clients. The browser side
  is out of scope; the gateway's own spans are the focus.
