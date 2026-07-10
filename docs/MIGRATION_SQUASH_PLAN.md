# Migration Squash Plan

**Date:** 2026-07-10  
**Author:** System audit  
**Status:** Plan (not yet executed)

---

## Current State

`packages/gateway/src/db/migrations/postgres/` contains **41 numbered SQL files** (001–041).

### Problem

- 5 "drop" migrations (020, 025, 038) revert schema decisions made in earlier migrations
- Every fresh deployment runs all 41 files sequentially (~10s+ startup overhead)
- Understanding the "current schema" requires mentally combining all 41 files
- 2 migrations create the same table (`user_extensions` in 001 and 009) — works via `IF NOT EXISTS` but confusing

### Goal

Squash into a single `001_initial_schema.sql` that represents the current desired state, keeping the old files as a history archive for reference only.

---

## Migration Timeline

```
001 ── Initial schema (1177 lines) ─────────────────────────────────────────►
002 ── background_agents ─────────────────────────── DROP 025 ──► ✂️
003 ── background_agents_v2 ──────────────────────── DROP 025 ──► ✂️
004 ── subagent_history ──────────────────────────── DROP 038 ──► ✂️
005 ── channel_bridges ─────────────────────────────────────────► ✅
006 ── orchestra_executions ──────────────────────── DROP 038 ──► ✂️
007 ── artifacts + artifact_versions ──────────────────────────► ✅
008 ── browser_workflows ──────────────────────────────────────► ✅
009 ── user_extensions (duplicate of 001) ─────────────────────► 🚩 duplicate
010 ── edge_devices, edge_commands, edge_telemetry ────────────► ✅
011 ── agent_souls (ALTERs, no CREATE) ───────────────────────► 🔄 absorbed
012 ── soul_provider (ALTERs, no CREATE) ─────────────────────► 🔄 absorbed
013 ── background_agents_skills ├── DROP 025 ──► ✂️
014 ── memories_content_hash (ALTER) ─────────────────────────► 🔄 absorbed
015 ── owner_pairing → system_settings ───────────────────────► ✅
016 ── orchestration_enable_analysis (ALTER) ├── DROP 038 ──► ✂️
017 ── autonomy_log_signal_ids (ALTER) ───────────────────────► 🔄 absorbed
018 ── fleets, fleet_sessions, fleet_tasks ├── DROP 038 ──► ✂️
019 ── crew_shared_memory, crew_task_queue ───────────────────► ✅
020 ── DROP projects, reminders ─────────────────────────────────► absorb
021 ── expenses ───────────────────────────────────────────────► ✅
022 ── claws, claw_sessions, claw_history ─────────────────────► ✅
023 ── claw_fixes (ALTERs) ───────────────────────────────────► 🔄 absorbed
024 ── provider_billing (ALTER) ───────────────────────────────► 🔄 absorbed
025 ── DROP background_agent* ───────────────────────────────────► absorb
026 ── subagent_parent_type_update ├── DROP 038 ──► ✂️
027 ── performance_indexes (CREATE INDEX) ─────────────────────► 🔄 absorbed
028 ── ui_sessions ───────────────────────────────────────────► ✅
029 ── claw_advanced_config (ALTER) ──────────────────────────► 🔄 absorbed
030 ── idempotency_keys ──────────────────────────────────────► ✅
031 ── job_queue (ALTER) ─────────────────────────────────────► 🔄 absorbed
032 ── retention_policies ────────────────────────────────────► ✅
033 ── usage_records ─────────────────────────────────────────► ✅
034 ── claw_session_state_index (CREATE INDEX) ───────────────► 🔄 absorbed
035 ── user_extension_removals ───────────────────────────────► ✅
036 ── fleet_last_cycle_at (ALTER) ├── DROP 038 ──► ✂️
037 ── perf_indexes (CREATE INDEX) ───────────────────────────► 🔄 absorbed
038 ── DROP fleet*, subagent*, orchestra* ─────────────────────► absorb
039 ── conversation_fts (CREATE INDEX) ───────────────────────► 🔄 absorbed
040 ── dm_pairing → dm_pairing_requests ──────────────────────► ✅
041 ── canvas_elements ───────────────────────────────────────► ✅
```

Legend:

- ✅ = Table still active in current schema
- ✂️ = Table created then later dropped — exclude from squash
- 🔄 = ALTER TABLE / CREATE INDEX only — absorb into base
- 🚩 = Duplicate CREATE — resolve in squash

---

## Squash Plan

### Step 1: Identify tables to exclude (created then dropped)

| Table                       | Created By | Dropped By |
| --------------------------- | ---------- | ---------- |
| `background_agents`         | 002        | 025        |
| `background_agent_sessions` | 002        | 025        |
| `background_agent_history`  | 002        | 025        |
| `subagent_history`          | 004        | 038        |
| `orchestra_executions`      | 006        | 038        |
| `fleets`                    | 018        | 038        |
| `fleet_sessions`            | 018        | 038        |
| `fleet_tasks`               | 018        | 038        |
| `fleet_worker_history`      | 018        | 038        |

### Step 2: Identify tables to create in squashed schema

**From 001 (keep only non-dropped):**
conversations, messages, request_logs, channels, channel_messages, costs, agents, settings, bookmarks, notes, tasks, calendar_events, contacts, captures, pomodoro_sessions, pomodoro_settings, pomodoro_daily_stats, habits, habit_logs, memories, goals, goal_steps, triggers, trigger_history, plans, plan_steps, plan_history, oauth_integrations, user_workspaces, user_containers, code_executions, workspace_audit, user_model_configs, custom_providers, user_provider_configs, custom_data, custom_tools, custom_table_schemas, custom_data_records, config_services, config_entries, plugins, user_extensions, local_providers, local_models, channel_users, channel_sessions, channel_verification_tokens

**Drop from 001 (never used):** projects, reminders

**Add from later migrations (still active):**

- `channel_bridges` (005)
- `artifacts`, `artifact_versions` (007)
- `browser_workflows` (008)
- `edge_devices`, `edge_commands`, `edge_telemetry` (010)
- `system_settings` (015)
- `crew_shared_memory`, `crew_task_queue` (019)
- `expenses` (021)
- `claws`, `claw_sessions`, `claw_history` (022)
- `ui_sessions` (028)
- `idempotency_keys` (030)
- `retention_policies` (032)
- `usage_records` (033)
- `user_extension_removals` (035)
- `dm_pairing_requests` (040)
- `canvas_elements` (041)

**Note:** `user_extensions` is created in both 001 and 009. Remove the duplicate from 009's additions.

### Step 3: Absorb ALTER TABLE and CREATE INDEX statements

These modify tables from 001 and should be included in the squashed `CREATE TABLE` definitions:

| Migration | Change                       | Target Table                |
| --------- | ---------------------------- | --------------------------- |
| 011       | ADD COLUMN soul_config, etc. | agents                      |
| 012       | ADD COLUMN provider          | souls (effect on agents)    |
| 014       | ADD COLUMN content_hash      | memories                    |
| 017       | ADD COLUMN signal_ids        | autonomy_log                |
| 023       | Various ALTERs               | claws, claw_sessions        |
| 024       | ADD COLUMN billing fields    | providers                   |
| 027       | CREATE INDEX                 | various                     |
| 029       | ADD COLUMN advanced_config   | claws                       |
| 031       | ALTER job_queue              | (if table exists post-038)  |
| 034       | CREATE INDEX                 | claw_sessions               |
| 036       | ADD COLUMN last_cycle_at     | fleets → EXCLUDED (dropped) |
| 037       | CREATE INDEX                 | various                     |
| 039       | CREATE INDEX                 | conversations               |

### Step 4: Resolve naming conflicts

- `user_extensions` — created in 001 (line 750) AND in 009. Remove from 001 or 009; squash keeps the final `CREATE TABLE IF NOT EXISTS` with all columns from both versions.

### Step 5: Verification

After generating the squashed `001_initial_schema.sql`:

1. Run `pnpm migration:smoke` — verify against a fresh DB
2. Run existing test suite — verify no code-level breakage
3. Archive old files to `packages/gateway/src/db/migrations/postgres/archive/`

---

## Concrete File Manifest

### New `001_initial_schema.sql` (estimated: ~1500 lines)

Contains full CREATE TABLE for all 50+ active tables, with all ALTER TABLE additions baked in, plus all CREATE INDEX statements.

### Archive directory

```
postgres/archive/
├── 001_initial_schema.sql      # original
├── 002_background_agents.sql
├── 003_background_agents_v2.sql
├── ...
└── 041_canvas_elements.sql
```

The archive is for historical reference only — never executed.

### Migration runner update

The migration runner (`packages/gateway/src/db/migrations/runner.ts` or equivalent) should be updated to only scan non-archived `.sql` files, or switch to a single-file approach.

---

## When to Execute

This squash should be done when:

1. A fresh production deployment is planned (squash invalidates existing DBs)
2. OR a migration compatibility shim is written to detect old schema versions
3. The migration runner supports a "checkpoint" concept

**Risk:** Squashing means existing databases cannot be incrementally migrated. Requires either:

- Full DB re-creation from the squashed migration (acceptable for early-stage projects)
- A compatibility layer that detects old schema and applies only delta migrations

For OwnPilot's current stage, **option A (full re-create)** is recommended — the project is pre-v1.0 and no production DBs depend on incremental migration history.
