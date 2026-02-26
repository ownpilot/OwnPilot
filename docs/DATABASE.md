# Database Documentation

Comprehensive reference for OwnPilot's PostgreSQL database layer. This document covers the schema, all tables, the repository pattern, data stores, seed data, migrations, connection management, and relationship model.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Schema Definition](#2-schema-definition)
3. [Table Reference](#3-table-reference)
   - [Core Tables](#31-core-tables)
   - [Personal Data Tables](#32-personal-data-tables)
   - [Productivity Tables](#33-productivity-tables)
   - [Autonomous AI Tables](#34-autonomous-ai-tables)
   - [OAuth and Media Tables](#35-oauth-and-media-tables)
   - [AI Models Tables](#36-ai-models-tables)
   - [Custom Data Tables](#37-custom-data-tables)
   - [Workspace Tables](#38-workspace-tables)
   - [Config Tables](#39-config-tables)
   - [Plugin Tables](#310-plugin-tables)
   - [Local AI Tables](#311-local-ai-tables)
   - [Coding & CLI Tables](#312-coding--cli-tables)
4. [Relationships and Entity Diagram](#4-relationships-and-entity-diagram)
5. [Index Strategy](#5-index-strategy)
6. [Repository Pattern](#6-repository-pattern)
7. [Data Stores](#7-data-stores)
8. [Seed Data](#8-seed-data)
9. [Migrations](#9-migrations)
10. [Connection Management](#10-connection-management)
11. [Docker Compose Setup](#11-docker-compose-setup)
12. [Environment Variables](#12-environment-variables)

---

## 1. Overview

OwnPilot uses **PostgreSQL 16** as its sole production database. The database layer lives inside the `packages/gateway` package and follows a strict layered architecture:

```
packages/gateway/src/db/
  adapters/              # Database adapter abstraction
    types.ts             # DatabaseAdapter interface, DatabaseConfig, getDatabaseConfig()
    postgres-adapter.ts  # PostgresAdapter implementation using pg Pool
    index.ts             # Adapter singleton (getAdapter, initializeAdapter, closeAdapter)
  repositories/          # One repository per domain (extends BaseRepository)
    base.ts              # BaseRepository abstract class
    index.ts             # Re-exports all repositories
    conversations.ts
    messages.ts
    agents.ts
    ... (40+ repository files)
  seeds/                 # Seed data modules
    default-agents.ts    # Loads agent configs from JSON
    plans-seed.ts        # Example plan seeds
    config-services-seed.ts  # Known service definitions
    index.ts             # seedDefaultAgents(), runSeeds()
  schema.ts              # SCHEMA_SQL, MIGRATIONS_SQL, INDEXES_SQL, initializeSchema()
  data-stores.ts         # DataStore<T> implementations wrapping repositories
```

### Key Design Decisions

- **Text primary keys** -- Every table uses `TEXT PRIMARY KEY` with UUIDs or human-readable identifiers, never auto-incrementing integers.
- **JSONB for flexible data** -- Columns like `metadata`, `config`, `tags`, `tool_calls`, and `parameters` use PostgreSQL `JSONB` for schema-flexible storage.
- **Idempotent schema creation** -- All `CREATE TABLE` and `CREATE INDEX` statements use `IF NOT EXISTS`. Migrations use `DO $$ ... END $$` blocks that check `information_schema.columns` before adding columns.
- **Cascade deletes for child tables** -- Child records (messages, steps, logs) are automatically deleted when their parent is removed.
- **Timestamps via `NOW()`** -- All tables use `TIMESTAMP NOT NULL DEFAULT NOW()` for `created_at`; most also track `updated_at`.

---

## 2. Schema Definition

**Source file:** `packages/gateway/src/db/schema.ts`

The schema is defined as three exported SQL template literals and one initialization function:

### 2.1 SCHEMA_SQL

Contains all `CREATE TABLE IF NOT EXISTS` statements. Tables are grouped by domain with SQL comments marking each section. This string creates every table from scratch when executed against an empty database.

### 2.2 MIGRATIONS_SQL

Contains idempotent `ALTER TABLE` statements wrapped in PL/pgSQL `DO $$ ... END $$` blocks. Each block checks `information_schema.columns` before adding a column, making it safe to run repeatedly. Also includes:

- Table creation for `config_services` and `config_entries` (created in migrations because they replaced the older `api_services` table).
- Data migration logic from the deprecated `api_services` table to `config_services` / `config_entries`, including automatic `DROP TABLE api_services` after migration.
- Creation of `plugins`, `local_providers`, and `local_models` tables.

### 2.3 INDEXES_SQL

Contains all `CREATE INDEX IF NOT EXISTS` statements. Over 100 indexes are defined, organized by table group. See [Section 5](#5-index-strategy) for the full strategy.

### 2.4 initializeSchema()

```typescript
export async function initializeSchema(exec: (sql: string) => Promise<void>): Promise<void>;
```

Runs all three SQL blocks in order:

1. `SCHEMA_SQL` -- creates tables
2. `MIGRATIONS_SQL` -- applies column additions and data migrations
3. `INDEXES_SQL` -- creates indexes

This function is called automatically on the **first database connection** via the adapter initialization path (`adapters/index.ts` -> `createAdapter()`).

---

## 3. Table Reference

OwnPilot defines **47 tables** organized into 11 domain groups. Every table uses `TEXT PRIMARY KEY`.

---

### 3.1 Core Tables

These tables support the primary chat and agent functionality.

#### `conversations`

Stores chat conversation sessions.

| Column          | Type      | Constraints                | Description          |
| --------------- | --------- | -------------------------- | -------------------- |
| `id`            | TEXT      | PRIMARY KEY                | Conversation UUID    |
| `user_id`       | TEXT      | NOT NULL DEFAULT 'default' | Owner user           |
| `title`         | TEXT      |                            | Conversation title   |
| `agent_id`      | TEXT      |                            | Associated agent     |
| `agent_name`    | TEXT      |                            | Agent display name   |
| `provider`      | TEXT      |                            | AI provider used     |
| `model`         | TEXT      |                            | AI model used        |
| `system_prompt` | TEXT      |                            | Custom system prompt |
| `message_count` | INTEGER   | NOT NULL DEFAULT 0         | Cached message count |
| `is_archived`   | BOOLEAN   | NOT NULL DEFAULT FALSE     | Archive flag         |
| `created_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time        |
| `updated_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update time     |
| `metadata`      | JSONB     | DEFAULT '{}'               | Arbitrary metadata   |

#### `messages`

Individual messages within a conversation.

| Column            | Type      | Constraints                                             | Description           |
| ----------------- | --------- | ------------------------------------------------------- | --------------------- |
| `id`              | TEXT      | PRIMARY KEY                                             | Message UUID          |
| `conversation_id` | TEXT      | NOT NULL, FK -> conversations(id) ON DELETE CASCADE     | Parent conversation   |
| `role`            | TEXT      | NOT NULL, CHECK IN ('system','user','assistant','tool') | Message role          |
| `content`         | TEXT      | NOT NULL                                                | Message body          |
| `provider`        | TEXT      |                                                         | AI provider           |
| `model`           | TEXT      |                                                         | AI model              |
| `tool_calls`      | JSONB     |                                                         | Tool call definitions |
| `tool_call_id`    | TEXT      |                                                         | Tool call response ID |
| `trace`           | TEXT      |                                                         | Debug trace           |
| `is_error`        | BOOLEAN   | NOT NULL DEFAULT FALSE                                  | Error indicator       |
| `input_tokens`    | INTEGER   |                                                         | Token usage (input)   |
| `output_tokens`   | INTEGER   |                                                         | Token usage (output)  |
| `created_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()                                  | Creation time         |

#### `request_logs`

HTTP request and API call logging for debugging.

| Column            | Type      | Constraints                                                                 | Description          |
| ----------------- | --------- | --------------------------------------------------------------------------- | -------------------- |
| `id`              | TEXT      | PRIMARY KEY                                                                 | Log entry UUID       |
| `user_id`         | TEXT      | NOT NULL DEFAULT 'default'                                                  | User making request  |
| `conversation_id` | TEXT      | FK -> conversations(id) ON DELETE SET NULL                                  | Related conversation |
| `type`            | TEXT      | NOT NULL, CHECK IN ('chat','completion','embedding','tool','agent','other') | Request type         |
| `provider`        | TEXT      |                                                                             | AI provider          |
| `model`           | TEXT      |                                                                             | AI model             |
| `endpoint`        | TEXT      |                                                                             | Target endpoint      |
| `method`          | TEXT      | NOT NULL DEFAULT 'POST'                                                     | HTTP method          |
| `request_body`    | JSONB     |                                                                             | Request payload      |
| `response_body`   | JSONB     |                                                                             | Response payload     |
| `status_code`     | INTEGER   |                                                                             | HTTP status code     |
| `input_tokens`    | INTEGER   |                                                                             | Token usage (input)  |
| `output_tokens`   | INTEGER   |                                                                             | Token usage (output) |
| `total_tokens`    | INTEGER   |                                                                             | Token usage (total)  |
| `duration_ms`     | INTEGER   |                                                                             | Request duration     |
| `error`           | TEXT      |                                                                             | Error message        |
| `error_stack`     | TEXT      |                                                                             | Error stack trace    |
| `ip_address`      | TEXT      |                                                                             | Client IP            |
| `user_agent`      | TEXT      |                                                                             | Client user agent    |
| `created_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()                                                      | Log time             |

#### `channels`

External communication channel configurations (Telegram).

| Column             | Type      | Constraints                     | Description           |
| ------------------ | --------- | ------------------------------- | --------------------- |
| `id`               | TEXT      | PRIMARY KEY                     | Channel UUID          |
| `type`             | TEXT      | NOT NULL                        | Channel type          |
| `name`             | TEXT      | NOT NULL                        | Display name          |
| `status`           | TEXT      | NOT NULL DEFAULT 'disconnected' | Connection status     |
| `config`           | JSONB     | NOT NULL DEFAULT '{}'           | Channel configuration |
| `created_at`       | TIMESTAMP | NOT NULL DEFAULT NOW()          | Creation time         |
| `connected_at`     | TIMESTAMP |                                 | Last connection time  |
| `last_activity_at` | TIMESTAMP |                                 | Last activity time    |

#### `channel_messages`

Messages received from or sent to external channels.

| Column         | Type      | Constraints                                    | Description         |
| -------------- | --------- | ---------------------------------------------- | ------------------- |
| `id`           | TEXT      | PRIMARY KEY                                    | Message UUID        |
| `channel_id`   | TEXT      | NOT NULL, FK -> channels(id) ON DELETE CASCADE | Parent channel      |
| `external_id`  | TEXT      |                                                | Platform message ID |
| `direction`    | TEXT      | NOT NULL, CHECK IN ('inbound','outbound')      | Message direction   |
| `sender_id`    | TEXT      |                                                | Sender identifier   |
| `sender_name`  | TEXT      |                                                | Sender name         |
| `content`      | TEXT      | NOT NULL                                       | Message body        |
| `content_type` | TEXT      | NOT NULL DEFAULT 'text'                        | Content type        |
| `attachments`  | JSONB     |                                                | File attachments    |
| `reply_to_id`  | TEXT      |                                                | Reply target        |
| `metadata`     | JSONB     | DEFAULT '{}'                                   | Extra metadata      |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                         | Creation time       |

#### `costs`

AI API usage cost tracking.

| Column            | Type      | Constraints                                | Description            |
| ----------------- | --------- | ------------------------------------------ | ---------------------- |
| `id`              | TEXT      | PRIMARY KEY                                | Cost entry UUID        |
| `provider`        | TEXT      | NOT NULL                                   | AI provider            |
| `model`           | TEXT      | NOT NULL                                   | AI model               |
| `conversation_id` | TEXT      | FK -> conversations(id) ON DELETE SET NULL | Related conversation   |
| `input_tokens`    | INTEGER   | NOT NULL DEFAULT 0                         | Input tokens consumed  |
| `output_tokens`   | INTEGER   | NOT NULL DEFAULT 0                         | Output tokens consumed |
| `total_tokens`    | INTEGER   | NOT NULL DEFAULT 0                         | Total tokens           |
| `input_cost`      | REAL      | NOT NULL DEFAULT 0                         | Input cost in dollars  |
| `output_cost`     | REAL      | NOT NULL DEFAULT 0                         | Output cost in dollars |
| `total_cost`      | REAL      | NOT NULL DEFAULT 0                         | Total cost             |
| `created_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()                     | Time of API call       |

#### `agents`

Pre-configured AI agent profiles with system prompts and tool access.

| Column          | Type      | Constraints            | Description                                                     |
| --------------- | --------- | ---------------------- | --------------------------------------------------------------- |
| `id`            | TEXT      | PRIMARY KEY            | Agent identifier                                                |
| `name`          | TEXT      | NOT NULL UNIQUE        | Display name                                                    |
| `system_prompt` | TEXT      |                        | System prompt template                                          |
| `provider`      | TEXT      | NOT NULL               | Default AI provider                                             |
| `model`         | TEXT      | NOT NULL               | Default AI model                                                |
| `config`        | JSONB     | NOT NULL DEFAULT '{}'  | Agent configuration (maxTokens, temperature, tools, toolGroups) |
| `created_at`    | TIMESTAMP | NOT NULL DEFAULT NOW() | Creation time                                                   |
| `updated_at`    | TIMESTAMP | NOT NULL DEFAULT NOW() | Last update time                                                |

#### `settings`

Global key-value settings store.

| Column       | Type      | Constraints            | Description      |
| ------------ | --------- | ---------------------- | ---------------- |
| `key`        | TEXT      | PRIMARY KEY            | Setting key      |
| `value`      | TEXT      | NOT NULL               | Setting value    |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Last update time |

---

### 3.2 Personal Data Tables

User-facing data management for personal productivity.

#### `bookmarks`

Web bookmark storage with categorization and visit tracking.

| Column            | Type      | Constraints                | Description   |
| ----------------- | --------- | -------------------------- | ------------- |
| `id`              | TEXT      | PRIMARY KEY                | Bookmark UUID |
| `user_id`         | TEXT      | NOT NULL DEFAULT 'default' | Owner user    |
| `url`             | TEXT      | NOT NULL                   | Bookmark URL  |
| `title`           | TEXT      | NOT NULL                   | Page title    |
| `description`     | TEXT      |                            | Description   |
| `favicon`         | TEXT      |                            | Favicon URL   |
| `category`        | TEXT      |                            | Category      |
| `tags`            | JSONB     | DEFAULT '[]'               | Tag array     |
| `is_favorite`     | BOOLEAN   | NOT NULL DEFAULT FALSE     | Favorite flag |
| `visit_count`     | INTEGER   | NOT NULL DEFAULT 0         | Visit counter |
| `last_visited_at` | TIMESTAMP |                            | Last visit    |
| `created_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time |
| `updated_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update   |

#### `notes`

Rich-text notes with markdown support.

| Column         | Type      | Constraints                 | Description    |
| -------------- | --------- | --------------------------- | -------------- |
| `id`           | TEXT      | PRIMARY KEY                 | Note UUID      |
| `user_id`      | TEXT      | NOT NULL DEFAULT 'default'  | Owner user     |
| `title`        | TEXT      | NOT NULL                    | Note title     |
| `content`      | TEXT      | NOT NULL                    | Note body      |
| `content_type` | TEXT      | NOT NULL DEFAULT 'markdown' | Content format |
| `category`     | TEXT      |                             | Category       |
| `tags`         | JSONB     | DEFAULT '[]'                | Tag array      |
| `is_pinned`    | BOOLEAN   | NOT NULL DEFAULT FALSE      | Pin flag       |
| `is_archived`  | BOOLEAN   | NOT NULL DEFAULT FALSE      | Archive flag   |
| `color`        | TEXT      |                             | Display color  |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()      | Creation time  |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()      | Last update    |

#### `tasks`

Task management with subtask hierarchy and project grouping.

| Column         | Type      | Constraints                                                                            | Description                    |
| -------------- | --------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `id`           | TEXT      | PRIMARY KEY                                                                            | Task UUID                      |
| `user_id`      | TEXT      | NOT NULL DEFAULT 'default'                                                             | Owner user                     |
| `title`        | TEXT      | NOT NULL                                                                               | Task title                     |
| `description`  | TEXT      |                                                                                        | Task details                   |
| `status`       | TEXT      | NOT NULL DEFAULT 'pending', CHECK IN ('pending','in_progress','completed','cancelled') | Current status                 |
| `priority`     | TEXT      | NOT NULL DEFAULT 'normal', CHECK IN ('low','normal','high','urgent')                   | Priority level                 |
| `due_date`     | TIMESTAMP |                                                                                        | Due date                       |
| `due_time`     | TEXT      |                                                                                        | Due time string                |
| `reminder_at`  | TIMESTAMP |                                                                                        | Reminder time                  |
| `category`     | TEXT      |                                                                                        | Category                       |
| `tags`         | JSONB     | DEFAULT '[]'                                                                           | Tag array                      |
| `parent_id`    | TEXT      | FK -> tasks(id) ON DELETE SET NULL                                                     | Parent task (self-referencing) |
| `project_id`   | TEXT      |                                                                                        | Associated project             |
| `recurrence`   | TEXT      |                                                                                        | Recurrence rule                |
| `completed_at` | TIMESTAMP |                                                                                        | Completion time                |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                 | Creation time                  |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                 | Last update                    |

#### `calendar_events`

Personal calendar event storage with recurrence and attendee support.

| Column             | Type      | Constraints                | Description              |
| ------------------ | --------- | -------------------------- | ------------------------ |
| `id`               | TEXT      | PRIMARY KEY                | Event UUID               |
| `user_id`          | TEXT      | NOT NULL DEFAULT 'default' | Owner user               |
| `title`            | TEXT      | NOT NULL                   | Event title              |
| `description`      | TEXT      |                            | Event details            |
| `location`         | TEXT      |                            | Location                 |
| `start_time`       | TIMESTAMP | NOT NULL                   | Start time               |
| `end_time`         | TIMESTAMP |                            | End time                 |
| `all_day`          | BOOLEAN   | NOT NULL DEFAULT FALSE     | All-day flag             |
| `timezone`         | TEXT      | DEFAULT 'UTC'              | Timezone                 |
| `recurrence`       | TEXT      |                            | Recurrence rule          |
| `reminder_minutes` | INTEGER   |                            | Minutes before to remind |
| `category`         | TEXT      |                            | Category                 |
| `tags`             | JSONB     | DEFAULT '[]'               | Tag array                |
| `color`            | TEXT      |                            | Display color            |
| `external_id`      | TEXT      |                            | External service ID      |
| `external_source`  | TEXT      |                            | External service name    |
| `attendees`        | JSONB     | DEFAULT '[]'               | Attendee list            |
| `created_at`       | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time            |
| `updated_at`       | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update              |

#### `contacts`

Contact information with social links and custom fields.

| Column              | Type      | Constraints                | Description           |
| ------------------- | --------- | -------------------------- | --------------------- |
| `id`                | TEXT      | PRIMARY KEY                | Contact UUID          |
| `user_id`           | TEXT      | NOT NULL DEFAULT 'default' | Owner user            |
| `name`              | TEXT      | NOT NULL                   | Full name             |
| `nickname`          | TEXT      |                            | Nickname              |
| `email`             | TEXT      |                            | Email address         |
| `phone`             | TEXT      |                            | Phone number          |
| `company`           | TEXT      |                            | Company name          |
| `job_title`         | TEXT      |                            | Job title             |
| `avatar`            | TEXT      |                            | Avatar URL            |
| `birthday`          | TEXT      |                            | Birthday string       |
| `address`           | TEXT      |                            | Physical address      |
| `notes`             | TEXT      |                            | Contact notes         |
| `relationship`      | TEXT      |                            | Relationship type     |
| `tags`              | JSONB     | DEFAULT '[]'               | Tag array             |
| `is_favorite`       | BOOLEAN   | NOT NULL DEFAULT FALSE     | Favorite flag         |
| `external_id`       | TEXT      |                            | External service ID   |
| `external_source`   | TEXT      |                            | External service name |
| `social_links`      | JSONB     | DEFAULT '{}'               | Social media links    |
| `custom_fields`     | JSONB     | DEFAULT '{}'               | User-defined fields   |
| `last_contacted_at` | TIMESTAMP |                            | Last contact time     |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time         |
| `updated_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update           |

#### `projects`

Project containers for grouping tasks.

| Column        | Type      | Constraints                                                           | Description     |
| ------------- | --------- | --------------------------------------------------------------------- | --------------- |
| `id`          | TEXT      | PRIMARY KEY                                                           | Project UUID    |
| `user_id`     | TEXT      | NOT NULL DEFAULT 'default'                                            | Owner user      |
| `name`        | TEXT      | NOT NULL                                                              | Project name    |
| `description` | TEXT      |                                                                       | Project details |
| `color`       | TEXT      |                                                                       | Display color   |
| `icon`        | TEXT      |                                                                       | Display icon    |
| `status`      | TEXT      | NOT NULL DEFAULT 'active', CHECK IN ('active','completed','archived') | Project status  |
| `due_date`    | TIMESTAMP |                                                                       | Due date        |
| `created_at`  | TIMESTAMP | NOT NULL DEFAULT NOW()                                                | Creation time   |
| `updated_at`  | TIMESTAMP | NOT NULL DEFAULT NOW()                                                | Last update     |

#### `reminders`

Standalone reminders with optional entity linking.

| Column         | Type      | Constraints                | Description        |
| -------------- | --------- | -------------------------- | ------------------ |
| `id`           | TEXT      | PRIMARY KEY                | Reminder UUID      |
| `user_id`      | TEXT      | NOT NULL DEFAULT 'default' | Owner user         |
| `title`        | TEXT      | NOT NULL                   | Reminder title     |
| `description`  | TEXT      |                            | Reminder details   |
| `remind_at`    | TIMESTAMP | NOT NULL                   | Target time        |
| `recurrence`   | TEXT      |                            | Recurrence rule    |
| `is_completed` | BOOLEAN   | NOT NULL DEFAULT FALSE     | Completion flag    |
| `related_type` | TEXT      |                            | Linked entity type |
| `related_id`   | TEXT      |                            | Linked entity ID   |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time      |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update        |

#### `captures`

Quick-capture inbox for ideas, thoughts, and snippets.

| Column              | Type      | Constraints                                                                                                | Description          |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| `id`                | TEXT      | PRIMARY KEY                                                                                                | Capture UUID         |
| `user_id`           | TEXT      | NOT NULL DEFAULT 'default'                                                                                 | Owner user           |
| `content`           | TEXT      | NOT NULL                                                                                                   | Capture text         |
| `type`              | TEXT      | NOT NULL DEFAULT 'thought', CHECK IN ('idea','thought','todo','link','quote','snippet','question','other') | Capture type         |
| `tags`              | JSONB     | DEFAULT '[]'                                                                                               | Tag array            |
| `source`            | TEXT      |                                                                                                            | Origin source        |
| `url`               | TEXT      |                                                                                                            | Related URL          |
| `processed`         | BOOLEAN   | NOT NULL DEFAULT FALSE                                                                                     | Processing flag      |
| `processed_as_type` | TEXT      | CHECK IN ('note','task','bookmark','discarded') OR NULL                                                    | What it became       |
| `processed_as_id`   | TEXT      |                                                                                                            | ID of created entity |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                                     | Creation time        |
| `processed_at`      | TIMESTAMP |                                                                                                            | Processing time      |

---

### 3.3 Productivity Tables

Time tracking, focus sessions, and habit building.

#### `pomodoro_sessions`

Individual Pomodoro timer sessions.

| Column                | Type      | Constraints                                                                | Description                 |
| --------------------- | --------- | -------------------------------------------------------------------------- | --------------------------- |
| `id`                  | TEXT      | PRIMARY KEY                                                                | Session UUID                |
| `user_id`             | TEXT      | NOT NULL DEFAULT 'default'                                                 | Owner user                  |
| `type`                | TEXT      | NOT NULL, CHECK IN ('work','short_break','long_break')                     | Session type                |
| `status`              | TEXT      | NOT NULL DEFAULT 'running', CHECK IN ('running','completed','interrupted') | Current status              |
| `task_description`    | TEXT      |                                                                            | What the user is working on |
| `duration_minutes`    | INTEGER   | NOT NULL                                                                   | Planned duration            |
| `started_at`          | TIMESTAMP | NOT NULL DEFAULT NOW()                                                     | Start time                  |
| `completed_at`        | TIMESTAMP |                                                                            | Completion time             |
| `interrupted_at`      | TIMESTAMP |                                                                            | Interruption time           |
| `interruption_reason` | TEXT      |                                                                            | Why it was interrupted      |

#### `pomodoro_settings`

Per-user Pomodoro configuration.

| Column                       | Type      | Constraints                   | Description                |
| ---------------------------- | --------- | ----------------------------- | -------------------------- |
| `user_id`                    | TEXT      | PRIMARY KEY DEFAULT 'default' | User ID (primary key)      |
| `work_duration`              | INTEGER   | NOT NULL DEFAULT 25           | Work session minutes       |
| `short_break_duration`       | INTEGER   | NOT NULL DEFAULT 5            | Short break minutes        |
| `long_break_duration`        | INTEGER   | NOT NULL DEFAULT 15           | Long break minutes         |
| `sessions_before_long_break` | INTEGER   | NOT NULL DEFAULT 4            | Sessions before long break |
| `auto_start_breaks`          | BOOLEAN   | NOT NULL DEFAULT FALSE        | Auto-start breaks          |
| `auto_start_work`            | BOOLEAN   | NOT NULL DEFAULT FALSE        | Auto-start work            |
| `updated_at`                 | TIMESTAMP | NOT NULL DEFAULT NOW()        | Last update                |

#### `pomodoro_daily_stats`

Aggregated daily Pomodoro statistics for streak tracking.

| Column                | Type    | Constraints                | Description              |
| --------------------- | ------- | -------------------------- | ------------------------ |
| `id`                  | TEXT    | PRIMARY KEY                | Stats entry UUID         |
| `user_id`             | TEXT    | NOT NULL DEFAULT 'default' | Owner user               |
| `date`                | TEXT    | NOT NULL                   | Date string (YYYY-MM-DD) |
| `completed_sessions`  | INTEGER | NOT NULL DEFAULT 0         | Sessions completed       |
| `total_work_minutes`  | INTEGER | NOT NULL DEFAULT 0         | Work time                |
| `total_break_minutes` | INTEGER | NOT NULL DEFAULT 0         | Break time               |
| `interruptions`       | INTEGER | NOT NULL DEFAULT 0         | Interruption count       |

UNIQUE constraint on `(user_id, date)`.

#### `habits`

Habit definitions with streak tracking.

| Column              | Type      | Constraints                                                               | Description             |
| ------------------- | --------- | ------------------------------------------------------------------------- | ----------------------- |
| `id`                | TEXT      | PRIMARY KEY                                                               | Habit UUID              |
| `user_id`           | TEXT      | NOT NULL DEFAULT 'default'                                                | Owner user              |
| `name`              | TEXT      | NOT NULL                                                                  | Habit name              |
| `description`       | TEXT      |                                                                           | Habit details           |
| `frequency`         | TEXT      | NOT NULL DEFAULT 'daily', CHECK IN ('daily','weekly','weekdays','custom') | Recurrence pattern      |
| `target_days`       | JSONB     | DEFAULT '[]'                                                              | Days of week for custom |
| `target_count`      | INTEGER   | NOT NULL DEFAULT 1                                                        | Target per period       |
| `unit`              | TEXT      |                                                                           | Measurement unit        |
| `category`          | TEXT      |                                                                           | Category                |
| `color`             | TEXT      |                                                                           | Display color           |
| `icon`              | TEXT      |                                                                           | Display icon            |
| `reminder_time`     | TEXT      |                                                                           | Daily reminder time     |
| `is_archived`       | BOOLEAN   | NOT NULL DEFAULT FALSE                                                    | Archive flag            |
| `streak_current`    | INTEGER   | NOT NULL DEFAULT 0                                                        | Current streak          |
| `streak_longest`    | INTEGER   | NOT NULL DEFAULT 0                                                        | Best streak             |
| `total_completions` | INTEGER   | NOT NULL DEFAULT 0                                                        | Lifetime completions    |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                    | Creation time           |
| `updated_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                    | Last update             |

#### `habit_logs`

Daily habit completion records.

| Column      | Type      | Constraints                                  | Description              |
| ----------- | --------- | -------------------------------------------- | ------------------------ |
| `id`        | TEXT      | PRIMARY KEY                                  | Log entry UUID           |
| `habit_id`  | TEXT      | NOT NULL, FK -> habits(id) ON DELETE CASCADE | Parent habit             |
| `user_id`   | TEXT      | NOT NULL DEFAULT 'default'                   | Owner user               |
| `date`      | TEXT      | NOT NULL                                     | Date string (YYYY-MM-DD) |
| `count`     | INTEGER   | NOT NULL DEFAULT 1                           | Completion count         |
| `notes`     | TEXT      |                                              | Optional notes           |
| `logged_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                       | Log time                 |

UNIQUE constraint on `(habit_id, date)`.

---

### 3.4 Autonomous AI Tables

Support for persistent AI memory, goal tracking, proactive triggers, and autonomous plan execution.

#### `memories`

Persistent AI memory store for facts, preferences, and context.

| Column           | Type      | Constraints                                                             | Description               |
| ---------------- | --------- | ----------------------------------------------------------------------- | ------------------------- |
| `id`             | TEXT      | PRIMARY KEY                                                             | Memory UUID               |
| `user_id`        | TEXT      | NOT NULL DEFAULT 'default'                                              | Owner user                |
| `type`           | TEXT      | NOT NULL, CHECK IN ('fact','preference','conversation','event','skill') | Memory type               |
| `content`        | TEXT      | NOT NULL                                                                | Memory content            |
| `embedding`      | BYTEA     |                                                                         | Vector embedding (binary) |
| `source`         | TEXT      |                                                                         | Where memory originated   |
| `source_id`      | TEXT      |                                                                         | Source entity ID          |
| `importance`     | REAL      | NOT NULL DEFAULT 0.5, CHECK >= 0 AND <= 1                               | Importance score (0-1)    |
| `tags`           | JSONB     | DEFAULT '[]'                                                            | Tag array                 |
| `accessed_count` | INTEGER   | NOT NULL DEFAULT 0                                                      | Access counter            |
| `created_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()                                                  | Creation time             |
| `updated_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()                                                  | Last update               |
| `accessed_at`    | TIMESTAMP |                                                                         | Last access time          |
| `metadata`       | JSONB     | DEFAULT '{}'                                                            | Extra metadata            |

#### `goals`

Long-term objectives with hierarchical sub-goal support.

| Column         | Type      | Constraints                                                                     | Description                    |
| -------------- | --------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `id`           | TEXT      | PRIMARY KEY                                                                     | Goal UUID                      |
| `user_id`      | TEXT      | NOT NULL DEFAULT 'default'                                                      | Owner user                     |
| `title`        | TEXT      | NOT NULL                                                                        | Goal title                     |
| `description`  | TEXT      |                                                                                 | Goal details                   |
| `status`       | TEXT      | NOT NULL DEFAULT 'active', CHECK IN ('active','paused','completed','abandoned') | Goal status                    |
| `priority`     | INTEGER   | NOT NULL DEFAULT 5, CHECK >= 1 AND <= 10                                        | Priority (1-10)                |
| `parent_id`    | TEXT      | FK -> goals(id) ON DELETE SET NULL                                              | Parent goal (self-referencing) |
| `due_date`     | TIMESTAMP |                                                                                 | Due date                       |
| `progress`     | REAL      | NOT NULL DEFAULT 0, CHECK >= 0 AND <= 100                                       | Completion percent             |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                                                          | Creation time                  |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                                                          | Last update                    |
| `completed_at` | TIMESTAMP |                                                                                 | Completion time                |
| `metadata`     | JSONB     | DEFAULT '{}'                                                                    | Extra metadata                 |

#### `goal_steps`

Actionable steps toward completing a goal.

| Column         | Type      | Constraints                                                                                    | Description        |
| -------------- | --------- | ---------------------------------------------------------------------------------------------- | ------------------ |
| `id`           | TEXT      | PRIMARY KEY                                                                                    | Step UUID          |
| `goal_id`      | TEXT      | NOT NULL, FK -> goals(id) ON DELETE CASCADE                                                    | Parent goal        |
| `title`        | TEXT      | NOT NULL                                                                                       | Step title         |
| `description`  | TEXT      |                                                                                                | Step details       |
| `status`       | TEXT      | NOT NULL DEFAULT 'pending', CHECK IN ('pending','in_progress','completed','blocked','skipped') | Step status        |
| `order_num`    | INTEGER   | NOT NULL                                                                                       | Execution order    |
| `dependencies` | JSONB     | DEFAULT '[]'                                                                                   | Dependent step IDs |
| `result`       | TEXT      |                                                                                                | Execution result   |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                         | Creation time      |
| `completed_at` | TIMESTAMP |                                                                                                | Completion time    |

#### `triggers`

Proactive automation triggers (scheduled, event-based, conditional, webhook).

| Column        | Type      | Constraints                                                   | Description                                               |
| ------------- | --------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| `id`          | TEXT      | PRIMARY KEY                                                   | Trigger UUID                                              |
| `user_id`     | TEXT      | NOT NULL DEFAULT 'default'                                    | Owner user                                                |
| `name`        | TEXT      | NOT NULL                                                      | Trigger name                                              |
| `description` | TEXT      |                                                               | Trigger details                                           |
| `type`        | TEXT      | NOT NULL, CHECK IN ('schedule','event','condition','webhook') | Trigger type                                              |
| `config`      | JSONB     | NOT NULL DEFAULT '{}'                                         | Type-specific config (cron, eventType, condition, secret) |
| `action`      | JSONB     | NOT NULL DEFAULT '{}'                                         | Action to execute (type + payload)                        |
| `enabled`     | BOOLEAN   | NOT NULL DEFAULT TRUE                                         | Active flag                                               |
| `priority`    | INTEGER   | NOT NULL DEFAULT 5, CHECK >= 1 AND <= 10                      | Priority (1-10)                                           |
| `last_fired`  | TIMESTAMP |                                                               | Last execution time                                       |
| `next_fire`   | TIMESTAMP |                                                               | Next scheduled execution                                  |
| `fire_count`  | INTEGER   | NOT NULL DEFAULT 0                                            | Total executions                                          |
| `created_at`  | TIMESTAMP | NOT NULL DEFAULT NOW()                                        | Creation time                                             |
| `updated_at`  | TIMESTAMP | NOT NULL DEFAULT NOW()                                        | Last update                                               |

#### `trigger_history`

Execution log for triggers.

| Column        | Type      | Constraints                                        | Description        |
| ------------- | --------- | -------------------------------------------------- | ------------------ |
| `id`          | TEXT      | PRIMARY KEY                                        | History UUID       |
| `trigger_id`  | TEXT      | NOT NULL, FK -> triggers(id) ON DELETE CASCADE     | Parent trigger     |
| `fired_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()                             | Execution time     |
| `status`      | TEXT      | NOT NULL, CHECK IN ('success','failure','skipped') | Result status      |
| `result`      | TEXT      |                                                    | Execution result   |
| `error`       | TEXT      |                                                    | Error message      |
| `duration_ms` | INTEGER   |                                                    | Execution duration |

#### `plans`

Autonomous multi-step plan definitions and execution state.

| Column           | Type      | Constraints                                                                                          | Description                         |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `id`             | TEXT      | PRIMARY KEY                                                                                          | Plan UUID                           |
| `user_id`        | TEXT      | NOT NULL DEFAULT 'default'                                                                           | Owner user                          |
| `name`           | TEXT      | NOT NULL                                                                                             | Plan name                           |
| `description`    | TEXT      |                                                                                                      | Plan details                        |
| `goal`           | TEXT      | NOT NULL                                                                                             | What the plan achieves              |
| `status`         | TEXT      | NOT NULL DEFAULT 'pending', CHECK IN ('pending','running','paused','completed','failed','cancelled') | Execution status                    |
| `current_step`   | INTEGER   | NOT NULL DEFAULT 0                                                                                   | Current step index                  |
| `total_steps`    | INTEGER   | NOT NULL DEFAULT 0                                                                                   | Total step count                    |
| `progress`       | REAL      | NOT NULL DEFAULT 0, CHECK >= 0 AND <= 100                                                            | Completion percent                  |
| `priority`       | INTEGER   | NOT NULL DEFAULT 5, CHECK >= 1 AND <= 10                                                             | Priority (1-10)                     |
| `source`         | TEXT      |                                                                                                      | Where plan originated               |
| `source_id`      | TEXT      |                                                                                                      | Source entity ID                    |
| `trigger_id`     | TEXT      | FK -> triggers(id) ON DELETE SET NULL                                                                | Associated trigger                  |
| `goal_id`        | TEXT      | FK -> goals(id) ON DELETE SET NULL                                                                   | Associated goal                     |
| `autonomy_level` | INTEGER   | NOT NULL DEFAULT 1, CHECK >= 0 AND <= 4                                                              | AI autonomy (0=manual, 4=full auto) |
| `max_retries`    | INTEGER   | NOT NULL DEFAULT 3                                                                                   | Retry limit                         |
| `retry_count`    | INTEGER   | NOT NULL DEFAULT 0                                                                                   | Current retry count                 |
| `timeout_ms`     | INTEGER   |                                                                                                      | Execution timeout                   |
| `checkpoint`     | TEXT      |                                                                                                      | Serialized checkpoint               |
| `error`          | TEXT      |                                                                                                      | Error message                       |
| `created_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                               | Creation time                       |
| `updated_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                               | Last update                         |
| `started_at`     | TIMESTAMP |                                                                                                      | Execution start                     |
| `completed_at`   | TIMESTAMP |                                                                                                      | Execution end                       |
| `metadata`       | JSONB     | DEFAULT '{}'                                                                                         | Extra metadata                      |

#### `plan_steps`

Individual steps within a plan.

| Column         | Type      | Constraints                                                                                                   | Description         |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| `id`           | TEXT      | PRIMARY KEY                                                                                                   | Step UUID           |
| `plan_id`      | TEXT      | NOT NULL, FK -> plans(id) ON DELETE CASCADE                                                                   | Parent plan         |
| `order_num`    | INTEGER   | NOT NULL                                                                                                      | Execution order     |
| `type`         | TEXT      | NOT NULL, CHECK IN ('tool_call','llm_decision','user_input','condition','parallel','loop','sub_plan')         | Step type           |
| `name`         | TEXT      | NOT NULL                                                                                                      | Step name           |
| `description`  | TEXT      |                                                                                                               | Step details        |
| `config`       | JSONB     | NOT NULL DEFAULT '{}'                                                                                         | Step configuration  |
| `status`       | TEXT      | NOT NULL DEFAULT 'pending', CHECK IN ('pending','running','completed','failed','skipped','blocked','waiting') | Execution status    |
| `dependencies` | JSONB     | DEFAULT '[]'                                                                                                  | Dependent step IDs  |
| `result`       | TEXT      |                                                                                                               | Execution result    |
| `error`        | TEXT      |                                                                                                               | Error message       |
| `retry_count`  | INTEGER   | NOT NULL DEFAULT 0                                                                                            | Current retry count |
| `max_retries`  | INTEGER   | NOT NULL DEFAULT 3                                                                                            | Retry limit         |
| `timeout_ms`   | INTEGER   |                                                                                                               | Step timeout        |
| `started_at`   | TIMESTAMP |                                                                                                               | Execution start     |
| `completed_at` | TIMESTAMP |                                                                                                               | Execution end       |
| `duration_ms`  | INTEGER   |                                                                                                               | Execution duration  |
| `on_success`   | TEXT      |                                                                                                               | Success handler     |
| `on_failure`   | TEXT      |                                                                                                               | Failure handler     |
| `metadata`     | JSONB     | DEFAULT '{}'                                                                                                  | Extra metadata      |

#### `plan_history`

Event log for plan execution lifecycle.

| Column       | Type      | Constraints                                                                                                                                   | Description   |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `id`         | TEXT      | PRIMARY KEY                                                                                                                                   | History UUID  |
| `plan_id`    | TEXT      | NOT NULL, FK -> plans(id) ON DELETE CASCADE                                                                                                   | Parent plan   |
| `step_id`    | TEXT      | FK -> plan_steps(id) ON DELETE SET NULL                                                                                                       | Related step  |
| `event_type` | TEXT      | NOT NULL, CHECK IN ('started','step_started','step_completed','step_failed','paused','resumed','completed','failed','cancelled','checkpoint') | Event type    |
| `details`    | JSONB     | DEFAULT '{}'                                                                                                                                  | Event details |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                                                                        | Event time    |

---

### 3.5 OAuth and Media Tables

#### `oauth_integrations`

OAuth tokens for external service integrations (Gmail, Google Calendar, etc.).

| Column                    | Type      | Constraints                                                                | Description                           |
| ------------------------- | --------- | -------------------------------------------------------------------------- | ------------------------------------- |
| `id`                      | TEXT      | PRIMARY KEY                                                                | Integration UUID                      |
| `user_id`                 | TEXT      | NOT NULL DEFAULT 'default'                                                 | Owner user                            |
| `provider`                | TEXT      | NOT NULL                                                                   | OAuth provider (google, microsoft)    |
| `service`                 | TEXT      | NOT NULL                                                                   | Service name (gmail, calendar, drive) |
| `access_token_encrypted`  | TEXT      | NOT NULL                                                                   | Encrypted access token                |
| `refresh_token_encrypted` | TEXT      |                                                                            | Encrypted refresh token               |
| `token_iv`                | TEXT      | NOT NULL                                                                   | Initialization vector for decryption  |
| `expires_at`              | TIMESTAMP |                                                                            | Token expiration                      |
| `scopes`                  | JSONB     | NOT NULL DEFAULT '[]'                                                      | Granted scopes                        |
| `email`                   | TEXT      |                                                                            | Associated email                      |
| `status`                  | TEXT      | NOT NULL DEFAULT 'active', CHECK IN ('active','expired','revoked','error') | Integration status                    |
| `last_sync_at`            | TIMESTAMP |                                                                            | Last synchronization                  |
| `error_message`           | TEXT      |                                                                            | Error details                         |
| `created_at`              | TIMESTAMP | NOT NULL DEFAULT NOW()                                                     | Creation time                         |
| `updated_at`              | TIMESTAMP | NOT NULL DEFAULT NOW()                                                     | Last update                           |

UNIQUE constraint on `(user_id, provider, service)`.

#### `media_provider_settings`

Per-capability media provider routing (which provider handles image generation, TTS, etc.).

| Column       | Type      | Constraints                                                            | Description              |
| ------------ | --------- | ---------------------------------------------------------------------- | ------------------------ |
| `id`         | TEXT      | PRIMARY KEY                                                            | Setting UUID             |
| `user_id`    | TEXT      | NOT NULL DEFAULT 'default'                                             | Owner user               |
| `capability` | TEXT      | NOT NULL, CHECK IN ('image_generation','vision','tts','stt','weather') | Media capability         |
| `provider`   | TEXT      | NOT NULL                                                               | Selected provider        |
| `model`      | TEXT      |                                                                        | Model identifier         |
| `config`     | JSONB     | DEFAULT '{}'                                                           | Provider-specific config |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                                                 | Creation time            |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                                                 | Last update              |

UNIQUE constraint on `(user_id, capability)`.

---

### 3.6 AI Models Tables

#### `user_model_configs`

User overrides for AI model metadata (pricing, capabilities, display names).

| Column           | Type      | Constraints                | Description            |
| ---------------- | --------- | -------------------------- | ---------------------- |
| `id`             | TEXT      | PRIMARY KEY                | Config UUID            |
| `user_id`        | TEXT      | NOT NULL DEFAULT 'default' | Owner user             |
| `provider_id`    | TEXT      | NOT NULL                   | Provider identifier    |
| `model_id`       | TEXT      | NOT NULL                   | Model identifier       |
| `display_name`   | TEXT      |                            | Custom display name    |
| `capabilities`   | JSONB     | NOT NULL DEFAULT '[]'      | Model capabilities     |
| `pricing_input`  | REAL      |                            | Input price per token  |
| `pricing_output` | REAL      |                            | Output price per token |
| `context_window` | INTEGER   |                            | Context window size    |
| `max_output`     | INTEGER   |                            | Max output tokens      |
| `is_enabled`     | BOOLEAN   | NOT NULL DEFAULT TRUE      | Enabled flag           |
| `is_custom`      | BOOLEAN   | NOT NULL DEFAULT FALSE     | Custom model flag      |
| `config`         | JSONB     | DEFAULT '{}'               | Extra config           |
| `created_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time          |
| `updated_at`     | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update            |

UNIQUE constraint on `(user_id, provider_id, model_id)`.

#### `custom_providers`

User-defined AI provider aggregators (fal.ai, together.ai, etc.).

| Column            | Type      | Constraints                                                                   | Description              |
| ----------------- | --------- | ----------------------------------------------------------------------------- | ------------------------ |
| `id`              | TEXT      | PRIMARY KEY                                                                   | Provider UUID            |
| `user_id`         | TEXT      | NOT NULL DEFAULT 'default'                                                    | Owner user               |
| `provider_id`     | TEXT      | NOT NULL                                                                      | Provider slug            |
| `display_name`    | TEXT      | NOT NULL                                                                      | Display name             |
| `api_base_url`    | TEXT      |                                                                               | API base URL             |
| `api_key_setting` | TEXT      |                                                                               | Settings key for API key |
| `provider_type`   | TEXT      | NOT NULL DEFAULT 'openai_compatible', CHECK IN ('openai_compatible','custom') | Compatibility type       |
| `is_enabled`      | BOOLEAN   | NOT NULL DEFAULT TRUE                                                         | Enabled flag             |
| `config`          | JSONB     | DEFAULT '{}'                                                                  | Extra config             |
| `created_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()                                                        | Creation time            |
| `updated_at`      | TIMESTAMP | NOT NULL DEFAULT NOW()                                                        | Last update              |

UNIQUE constraint on `(user_id, provider_id)`.

#### `user_provider_configs`

User overrides for built-in AI providers (base URL, API key environment variable, enable/disable).

| Column          | Type      | Constraints                | Description               |
| --------------- | --------- | -------------------------- | ------------------------- |
| `id`            | TEXT      | PRIMARY KEY                | Config UUID               |
| `user_id`       | TEXT      | NOT NULL DEFAULT 'default' | Owner user                |
| `provider_id`   | TEXT      | NOT NULL                   | Provider slug             |
| `base_url`      | TEXT      |                            | Custom base URL           |
| `provider_type` | TEXT      |                            | Provider type override    |
| `is_enabled`    | BOOLEAN   | NOT NULL DEFAULT TRUE      | Enabled flag              |
| `api_key_env`   | TEXT      |                            | Environment variable name |
| `notes`         | TEXT      |                            | Admin notes               |
| `config`        | JSONB     | DEFAULT '{}'               | Extra config              |
| `created_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time             |
| `updated_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update               |

UNIQUE constraint on `(user_id, provider_id)`.

---

### 3.7 Custom Data Tables

AI-created and user-created dynamic data structures.

#### `custom_data`

Simple key-value store for AI-created dynamic data.

| Column       | Type      | Constraints                | Description    |
| ------------ | --------- | -------------------------- | -------------- |
| `id`         | TEXT      | PRIMARY KEY                | Entry UUID     |
| `user_id`    | TEXT      | NOT NULL DEFAULT 'default' | Owner user     |
| `key`        | TEXT      | NOT NULL                   | Data key       |
| `value`      | JSONB     | NOT NULL                   | Data value     |
| `metadata`   | JSONB     | DEFAULT '{}'               | Extra metadata |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time  |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update    |

UNIQUE constraint on `(user_id, key)`.

#### `custom_tools`

LLM-defined or user-defined tools with executable code.

| Column              | Type      | Constraints                                                                             | Description            |
| ------------------- | --------- | --------------------------------------------------------------------------------------- | ---------------------- |
| `id`                | TEXT      | PRIMARY KEY                                                                             | Tool UUID              |
| `user_id`           | TEXT      | NOT NULL DEFAULT 'default'                                                              | Owner user             |
| `name`              | TEXT      | NOT NULL                                                                                | Tool name              |
| `description`       | TEXT      | NOT NULL                                                                                | Tool description       |
| `parameters`        | JSONB     | NOT NULL DEFAULT '{}'                                                                   | JSON Schema parameters |
| `code`              | TEXT      | NOT NULL                                                                                | Executable code        |
| `category`          | TEXT      |                                                                                         | Tool category          |
| `status`            | TEXT      | NOT NULL DEFAULT 'active', CHECK IN ('active','disabled','pending_approval','rejected') | Tool status            |
| `permissions`       | JSONB     | NOT NULL DEFAULT '[]'                                                                   | Required permissions   |
| `requires_approval` | BOOLEAN   | NOT NULL DEFAULT FALSE                                                                  | Approval required flag |
| `created_by`        | TEXT      | NOT NULL DEFAULT 'user', CHECK IN ('user','llm')                                        | Creator type           |
| `version`           | INTEGER   | NOT NULL DEFAULT 1                                                                      | Version number         |
| `metadata`          | JSONB     | DEFAULT '{}'                                                                            | Extra metadata         |
| `usage_count`       | INTEGER   | NOT NULL DEFAULT 0                                                                      | Usage counter          |
| `last_used_at`      | TIMESTAMP |                                                                                         | Last usage time        |
| `required_api_keys` | JSONB     | DEFAULT '[]'                                                                            | Required API key names |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                  | Creation time          |
| `updated_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                  | Last update            |

UNIQUE constraint on `(user_id, name)`.

#### `custom_table_schemas`

Metadata for AI-created dynamic tables.

| Column         | Type      | Constraints            | Description        |
| -------------- | --------- | ---------------------- | ------------------ |
| `id`           | TEXT      | PRIMARY KEY            | Schema UUID        |
| `name`         | TEXT      | NOT NULL UNIQUE        | Table name slug    |
| `display_name` | TEXT      | NOT NULL               | Display name       |
| `description`  | TEXT      |                        | Table description  |
| `columns`      | JSONB     | NOT NULL DEFAULT '[]'  | Column definitions |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW() | Creation time      |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW() | Last update        |

#### `custom_data_records`

Records stored in AI-created dynamic tables.

| Column       | Type      | Constraints                                                | Description   |
| ------------ | --------- | ---------------------------------------------------------- | ------------- |
| `id`         | TEXT      | PRIMARY KEY                                                | Record UUID   |
| `table_id`   | TEXT      | NOT NULL, FK -> custom_table_schemas(id) ON DELETE CASCADE | Parent schema |
| `data`       | JSONB     | NOT NULL DEFAULT '{}'                                      | Record data   |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                                     | Creation time |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW()                                     | Last update   |

---

### 3.8 Workspace Tables

Isolated user environments for code execution with Docker containers.

#### `user_workspaces`

User workspace definitions.

| Column             | Type      | Constraints                                                                              | Description         |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- | ------------------- |
| `id`               | TEXT      | PRIMARY KEY                                                                              | Workspace UUID      |
| `user_id`          | TEXT      | NOT NULL                                                                                 | Owner user          |
| `name`             | TEXT      | NOT NULL                                                                                 | Workspace name      |
| `description`      | TEXT      |                                                                                          | Workspace details   |
| `status`           | TEXT      | NOT NULL DEFAULT 'active', CHECK IN ('active','suspended','deleted')                     | Workspace status    |
| `storage_path`     | TEXT      | NOT NULL                                                                                 | Filesystem path     |
| `container_config` | JSONB     | NOT NULL DEFAULT '{}'                                                                    | Docker config       |
| `container_id`     | TEXT      |                                                                                          | Active container ID |
| `container_status` | TEXT      | NOT NULL DEFAULT 'stopped', CHECK IN ('stopped','starting','running','stopping','error') | Container state     |
| `created_at`       | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                   | Creation time       |
| `updated_at`       | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                   | Last update         |
| `last_activity_at` | TIMESTAMP |                                                                                          | Last activity       |

#### `user_containers`

Active Docker containers associated with workspaces.

| Column              | Type      | Constraints                                                                               | Description         |
| ------------------- | --------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `id`                | TEXT      | PRIMARY KEY                                                                               | Record UUID         |
| `workspace_id`      | TEXT      | NOT NULL, FK -> user_workspaces(id) ON DELETE CASCADE                                     | Parent workspace    |
| `user_id`           | TEXT      | NOT NULL                                                                                  | Owner user          |
| `container_id`      | TEXT      | NOT NULL UNIQUE                                                                           | Docker container ID |
| `image`             | TEXT      | NOT NULL                                                                                  | Docker image        |
| `status`            | TEXT      | NOT NULL DEFAULT 'starting', CHECK IN ('stopped','starting','running','stopping','error') | Container state     |
| `memory_mb`         | INTEGER   | NOT NULL DEFAULT 512                                                                      | Memory limit        |
| `cpu_cores`         | REAL      | NOT NULL DEFAULT 0.5                                                                      | CPU core limit      |
| `network_policy`    | TEXT      | NOT NULL DEFAULT 'none'                                                                   | Network policy      |
| `started_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                    | Start time          |
| `last_activity_at`  | TIMESTAMP |                                                                                           | Last activity       |
| `stopped_at`        | TIMESTAMP |                                                                                           | Stop time           |
| `memory_peak_mb`    | INTEGER   | DEFAULT 0                                                                                 | Peak memory usage   |
| `cpu_time_ms`       | INTEGER   | DEFAULT 0                                                                                 | Total CPU time      |
| `network_bytes_in`  | INTEGER   | DEFAULT 0                                                                                 | Network inbound     |
| `network_bytes_out` | INTEGER   | DEFAULT 0                                                                                 | Network outbound    |

#### `code_executions`

Code execution history within workspaces.

| Column              | Type      | Constraints                                                                                           | Description        |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------ |
| `id`                | TEXT      | PRIMARY KEY                                                                                           | Execution UUID     |
| `workspace_id`      | TEXT      | NOT NULL, FK -> user_workspaces(id) ON DELETE CASCADE                                                 | Parent workspace   |
| `user_id`           | TEXT      | NOT NULL                                                                                              | Owner user         |
| `container_id`      | TEXT      |                                                                                                       | Container used     |
| `language`          | TEXT      | NOT NULL, CHECK IN ('python','javascript','shell')                                                    | Code language      |
| `code_hash`         | TEXT      |                                                                                                       | Code content hash  |
| `status`            | TEXT      | NOT NULL DEFAULT 'pending', CHECK IN ('pending','running','completed','failed','timeout','cancelled') | Execution status   |
| `stdout`            | TEXT      |                                                                                                       | Standard output    |
| `stderr`            | TEXT      |                                                                                                       | Standard error     |
| `exit_code`         | INTEGER   |                                                                                                       | Process exit code  |
| `error`             | TEXT      |                                                                                                       | Error message      |
| `execution_time_ms` | INTEGER   |                                                                                                       | Execution duration |
| `memory_used_mb`    | INTEGER   |                                                                                                       | Memory consumed    |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                                                                | Creation time      |
| `started_at`        | TIMESTAMP |                                                                                                       | Execution start    |
| `completed_at`      | TIMESTAMP |                                                                                                       | Execution end      |

#### `workspace_audit`

Audit log for all workspace operations.

| Column          | Type      | Constraints                                                                    | Description         |
| --------------- | --------- | ------------------------------------------------------------------------------ | ------------------- |
| `id`            | TEXT      | PRIMARY KEY                                                                    | Audit UUID          |
| `user_id`       | TEXT      | NOT NULL                                                                       | Acting user         |
| `workspace_id`  | TEXT      |                                                                                | Target workspace    |
| `action`        | TEXT      | NOT NULL, CHECK IN ('create','read','write','delete','execute','start','stop') | Action type         |
| `resource_type` | TEXT      | NOT NULL, CHECK IN ('workspace','file','container','execution')                | Resource type       |
| `resource`      | TEXT      |                                                                                | Resource identifier |
| `success`       | BOOLEAN   | NOT NULL DEFAULT TRUE                                                          | Success flag        |
| `error`         | TEXT      |                                                                                | Error message       |
| `ip_address`    | TEXT      |                                                                                | Client IP           |
| `user_agent`    | TEXT      |                                                                                | Client user agent   |
| `created_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()                                                         | Event time          |

---

### 3.9 Config Tables

Schema-driven service configuration management, replacing the older `api_services` table.

#### `config_services`

Service definitions with typed configuration schemas.

| Column          | Type      | Constraints                | Description                           |
| --------------- | --------- | -------------------------- | ------------------------------------- |
| `id`            | TEXT      | PRIMARY KEY                | Service UUID                          |
| `name`          | TEXT      | NOT NULL UNIQUE            | Service slug                          |
| `display_name`  | TEXT      | NOT NULL                   | Display name                          |
| `category`      | TEXT      | NOT NULL DEFAULT 'general' | Service category                      |
| `description`   | TEXT      |                            | Service description                   |
| `docs_url`      | TEXT      |                            | Documentation link                    |
| `config_schema` | JSONB     | NOT NULL DEFAULT '[]'      | Field definitions array               |
| `multi_entry`   | BOOLEAN   | NOT NULL DEFAULT FALSE     | Supports multiple entries             |
| `required_by`   | JSONB     | DEFAULT '[]'               | Tools/features that need this service |
| `is_active`     | BOOLEAN   | NOT NULL DEFAULT TRUE      | Active flag                           |
| `created_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time                         |
| `updated_at`    | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update                           |

#### `config_entries`

Actual configuration values for each service.

| Column         | Type      | Constraints                | Description          |
| -------------- | --------- | -------------------------- | -------------------- |
| `id`           | TEXT      | PRIMARY KEY                | Entry UUID           |
| `service_name` | TEXT      | NOT NULL                   | Parent service name  |
| `label`        | TEXT      | NOT NULL DEFAULT 'Default' | Entry label          |
| `data`         | JSONB     | NOT NULL DEFAULT '{}'      | Configuration values |
| `is_default`   | BOOLEAN   | NOT NULL DEFAULT FALSE     | Default entry flag   |
| `is_active`    | BOOLEAN   | NOT NULL DEFAULT TRUE      | Active flag          |
| `created_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()     | Creation time        |
| `updated_at`   | TIMESTAMP | NOT NULL DEFAULT NOW()     | Last update          |

Has a partial unique index: only one entry per `service_name` where `is_default = TRUE`.

---

### 3.10 Plugin Tables

#### `plugins`

Plugin state persistence.

| Column                | Type      | Constraints                                                         | Description         |
| --------------------- | --------- | ------------------------------------------------------------------- | ------------------- |
| `id`                  | TEXT      | PRIMARY KEY                                                         | Plugin identifier   |
| `name`                | TEXT      | NOT NULL                                                            | Plugin name         |
| `version`             | TEXT      | NOT NULL DEFAULT '1.0.0'                                            | Plugin version      |
| `status`              | TEXT      | NOT NULL DEFAULT 'enabled', CHECK IN ('enabled','disabled','error') | Plugin state        |
| `settings`            | JSONB     | NOT NULL DEFAULT '{}'                                               | Plugin settings     |
| `granted_permissions` | JSONB     | NOT NULL DEFAULT '[]'                                               | Granted permissions |
| `error_message`       | TEXT      |                                                                     | Error details       |
| `installed_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                              | Install time        |
| `updated_at`          | TIMESTAMP | NOT NULL DEFAULT NOW()                                              | Last update         |

---

### 3.11 Local AI Tables

#### `local_providers`

Local AI inference endpoints (LM Studio, Ollama, LocalAI, vLLM).

| Column               | Type      | Constraints                                                        | Description           |
| -------------------- | --------- | ------------------------------------------------------------------ | --------------------- |
| `id`                 | TEXT      | PRIMARY KEY                                                        | Provider UUID         |
| `user_id`            | TEXT      | NOT NULL DEFAULT 'default'                                         | Owner user            |
| `name`               | TEXT      | NOT NULL                                                           | Provider name         |
| `provider_type`      | TEXT      | NOT NULL, CHECK IN ('lmstudio','ollama','localai','vllm','custom') | Provider type         |
| `base_url`           | TEXT      | NOT NULL                                                           | API endpoint URL      |
| `api_key`            | TEXT      |                                                                    | Optional API key      |
| `is_enabled`         | BOOLEAN   | NOT NULL DEFAULT TRUE                                              | Enabled flag          |
| `is_default`         | BOOLEAN   | NOT NULL DEFAULT FALSE                                             | Default provider flag |
| `discovery_endpoint` | TEXT      |                                                                    | Model list endpoint   |
| `last_discovered_at` | TIMESTAMP |                                                                    | Last model discovery  |
| `metadata`           | JSONB     | DEFAULT '{}'                                                       | Extra metadata        |
| `created_at`         | TIMESTAMP | NOT NULL DEFAULT NOW()                                             | Creation time         |
| `updated_at`         | TIMESTAMP | NOT NULL DEFAULT NOW()                                             | Last update           |

#### `local_models`

Models available through local providers.

| Column              | Type      | Constraints                                           | Description         |
| ------------------- | --------- | ----------------------------------------------------- | ------------------- |
| `id`                | TEXT      | PRIMARY KEY                                           | Model UUID          |
| `user_id`           | TEXT      | NOT NULL DEFAULT 'default'                            | Owner user          |
| `local_provider_id` | TEXT      | NOT NULL, FK -> local_providers(id) ON DELETE CASCADE | Parent provider     |
| `model_id`          | TEXT      | NOT NULL                                              | Model identifier    |
| `display_name`      | TEXT      | NOT NULL                                              | Display name        |
| `capabilities`      | JSONB     | NOT NULL DEFAULT '["chat","streaming"]'               | Model capabilities  |
| `context_window`    | INTEGER   | DEFAULT 32768                                         | Context window size |
| `max_output`        | INTEGER   | DEFAULT 4096                                          | Max output tokens   |
| `is_enabled`        | BOOLEAN   | NOT NULL DEFAULT TRUE                                 | Enabled flag        |
| `metadata`          | JSONB     | DEFAULT '{}'                                          | Extra metadata      |
| `created_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                | Creation time       |
| `updated_at`        | TIMESTAMP | NOT NULL DEFAULT NOW()                                | Last update         |

UNIQUE constraint on `(user_id, local_provider_id, model_id)`.

---

### 3.12 Coding & CLI Tables

#### `coding_agent_results`

Persists the results of coding agent task executions.

| Column        | Type        | Constraints              | Description                               |
| ------------- | ----------- | ------------------------ | ----------------------------------------- |
| `id`          | `TEXT`      | `PRIMARY KEY`            | UUID identifier                           |
| `user_id`     | `TEXT`      | `NOT NULL`               | Owner user ID                             |
| `provider`    | `TEXT`      | `NOT NULL`               | Agent provider (claude-code, codex, etc.) |
| `prompt`      | `TEXT`      | `NOT NULL`               | Task prompt                               |
| `output`      | `TEXT`      |                          | Agent output text                         |
| `exit_code`   | `INTEGER`   |                          | Process exit code                         |
| `duration_ms` | `INTEGER`   |                          | Execution duration in milliseconds        |
| `success`     | `BOOLEAN`   | `DEFAULT false`          | Whether the task succeeded                |
| `metadata`    | `JSONB`     |                          | Additional execution metadata             |
| `created_at`  | `TIMESTAMP` | `NOT NULL DEFAULT NOW()` | Creation timestamp                        |

#### `cli_providers`

Stores user-registered CLI tool providers for the coding agents system. These appear as `custom:{name}`.

| Column                | Type        | Constraints                  | Description                             |
| --------------------- | ----------- | ---------------------------- | --------------------------------------- |
| `id`                  | `TEXT`      | `PRIMARY KEY`                | UUID identifier                         |
| `name`                | `TEXT`      | `NOT NULL`                   | Provider name (lowercase, alphanumeric) |
| `display_name`        | `TEXT`      | `NOT NULL`                   | Human-readable display name             |
| `description`         | `TEXT`      |                              | Provider description                    |
| `binary`              | `TEXT`      | `NOT NULL`                   | Path to binary executable               |
| `category`            | `TEXT`      |                              | Tool category                           |
| `icon`                | `TEXT`      |                              | Icon identifier                         |
| `color`               | `TEXT`      |                              | Display color                           |
| `auth_method`         | `TEXT`      | `DEFAULT 'none'`             | none, config_center, or env_var         |
| `config_service_name` | `TEXT`      |                              | Config Center service name              |
| `api_key_env_var`     | `TEXT`      |                              | Environment variable for API key        |
| `default_args`        | `JSONB`     |                              | Default command-line arguments          |
| `prompt_template`     | `TEXT`      |                              | Template for prompt formatting          |
| `output_format`       | `TEXT`      | `DEFAULT 'text'`             | text, json, or stream-json              |
| `default_timeout_ms`  | `INTEGER`   |                              | Default execution timeout               |
| `max_timeout_ms`      | `INTEGER`   |                              | Maximum allowed timeout                 |
| `user_id`             | `TEXT`      | `NOT NULL DEFAULT 'default'` | Owner user ID                           |
| `is_active`           | `BOOLEAN`   | `DEFAULT true`               | Whether provider is active              |
| `created_at`          | `TIMESTAMP` | `NOT NULL DEFAULT NOW()`     | Creation timestamp                      |
| `updated_at`          | `TIMESTAMP` | `NOT NULL DEFAULT NOW()`     | Last update timestamp                   |

#### `cli_tool_policies`

Per-tool security policies for CLI tool execution.

| Column       | Type        | Constraints              | Description                                 |
| ------------ | ----------- | ------------------------ | ------------------------------------------- |
| `id`         | `TEXT`      | `PRIMARY KEY`            | UUID identifier                             |
| `user_id`    | `TEXT`      | `NOT NULL`               | Owner user ID                               |
| `tool_name`  | `TEXT`      | `NOT NULL`               | CLI tool name (from catalog or custom:name) |
| `policy`     | `TEXT`      | `NOT NULL`               | allowed, prompt, or blocked                 |
| `created_at` | `TIMESTAMP` | `NOT NULL DEFAULT NOW()` | Creation timestamp                          |
| `updated_at` | `TIMESTAMP` | `NOT NULL DEFAULT NOW()` | Last update timestamp                       |

**Unique constraint:** `(user_id, tool_name)` — one policy per user per tool.

**Repositories:**

| Repository                     | Source File               | Description                         |
| ------------------------------ | ------------------------- | ----------------------------------- |
| `CodingAgentResultsRepository` | `coding-agent-results.ts` | CRUD for task execution results     |
| `CliProvidersRepository`       | `cli-providers.ts`        | CRUD for custom CLI providers       |
| `CliToolPoliciesRepository`    | `cli-tool-policies.ts`    | Per-tool security policy management |

---

## 4. Relationships and Entity Diagram

### 4.1 Cascade Delete Relationships

When the parent row is deleted, all child rows are automatically removed.

```
conversations ──< messages           (ON DELETE CASCADE)
conversations ──< plan_history       (through plans)
channels      ──< channel_messages   (ON DELETE CASCADE)
plans         ──< plan_steps         (ON DELETE CASCADE)
plans         ──< plan_history       (ON DELETE CASCADE)
goals         ──< goal_steps         (ON DELETE CASCADE)
triggers      ──< trigger_history    (ON DELETE CASCADE)
habits        ──< habit_logs         (ON DELETE CASCADE)
custom_table_schemas ──< custom_data_records  (ON DELETE CASCADE)
user_workspaces ──< user_containers  (ON DELETE CASCADE)
user_workspaces ──< code_executions  (ON DELETE CASCADE)
local_providers ──< local_models     (ON DELETE CASCADE)
```

### 4.2 Set Null on Delete Relationships

When the parent row is deleted, the foreign key in the child is set to NULL.

```
conversations  <── request_logs.conversation_id  (ON DELETE SET NULL)
conversations  <── costs.conversation_id         (ON DELETE SET NULL)
triggers       <── plans.trigger_id              (ON DELETE SET NULL)
goals          <── plans.goal_id                 (ON DELETE SET NULL)
plan_steps     <── plan_history.step_id          (ON DELETE SET NULL)
```

### 4.3 Self-Referencing Relationships

```
tasks.parent_id  -> tasks.id    (ON DELETE SET NULL)  -- subtask hierarchy
goals.parent_id  -> goals.id    (ON DELETE SET NULL)  -- sub-goal hierarchy
```

### 4.4 Conceptual Entity Relationship Diagram

```
                          CORE
 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  settings (key-value)         agents                     │
 │                                                          │
 │  conversations ──────< messages                          │
 │       │                                                  │
 │       ├─── request_logs (SET NULL)                       │
 │       └─── costs (SET NULL)                              │
 │                                                          │
 │  channels ──────< channel_messages                       │
 └──────────────────────────────────────────────────────────┘

                     PERSONAL DATA
 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  bookmarks    notes    contacts    reminders  captures   │
 │                                                          │
 │  projects ···· tasks.project_id (logical)                │
 │                                                          │
 │  tasks ──┐  (self-ref: parent_id)                        │
 │          └──> tasks                                      │
 │                                                          │
 │  calendar_events                                         │
 └──────────────────────────────────────────────────────────┘

                      PRODUCTIVITY
 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  pomodoro_settings    pomodoro_sessions                  │
 │                       pomodoro_daily_stats               │
 │                                                          │
 │  habits ──────< habit_logs                               │
 └──────────────────────────────────────────────────────────┘

                     AUTONOMOUS AI
 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  memories                                                │
 │                                                          │
 │  goals ──┐  (self-ref: parent_id)                        │
 │          └──> goals                                      │
 │       └──────< goal_steps                                │
 │                                                          │
 │  triggers ──────< trigger_history                        │
 │       │                                                  │
 │       └── plans.trigger_id (SET NULL)                    │
 │                                                          │
 │  goals ─── plans.goal_id (SET NULL)                      │
 │                                                          │
 │  plans ──────< plan_steps                                │
 │       └──────< plan_history ···· plan_steps (SET NULL)   │
 └──────────────────────────────────────────────────────────┘

                   WORKSPACE / CONFIG / AI
 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  user_workspaces ──< user_containers                     │
 │                  ──< code_executions                     │
 │  workspace_audit                                         │
 │                                                          │
 │  oauth_integrations    media_provider_settings           │
 │                                                          │
 │  user_model_configs    custom_providers                  │
 │  user_provider_configs                                   │
 │                                                          │
 │  config_services    config_entries                        │
 │                                                          │
 │  plugins                                                 │
 │                                                          │
 │  local_providers ──< local_models                        │
 │                                                          │
 │  custom_data     custom_tools                            │
 │  custom_table_schemas ──< custom_data_records            │
 └──────────────────────────────────────────────────────────┘
```

---

## 5. Index Strategy

All indexes use `CREATE INDEX IF NOT EXISTS` for idempotent execution. The strategy follows these principles:

### 5.1 Access Pattern Indexes

Every table with a `user_id` column has an index on `(user_id)` to support multi-tenant filtering:

```sql
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
-- ... repeated for all user-scoped tables
```

### 5.2 Status and Filter Indexes

Tables with `status`, `type`, `category`, or boolean flag columns have single-column indexes to accelerate WHERE clauses:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_habits_archived ON habits(is_archived);
```

### 5.3 Temporal Indexes (DESC)

Frequently sorted-by-time columns use descending indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
```

### 5.4 Foreign Key Indexes

Every foreign key column is indexed to accelerate JOIN operations and cascade deletes:

```sql
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON goal_steps(goal_id);
```

### 5.5 Composite Indexes

Multi-column indexes for common compound lookups:

```sql
CREATE INDEX IF NOT EXISTS idx_plan_steps_order ON plan_steps(plan_id, order_num);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_service ON oauth_integrations(user_id, provider, service);
CREATE INDEX IF NOT EXISTS idx_custom_data_key ON custom_data(user_id, key);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_pomodoro_daily_user_date ON pomodoro_daily_stats(user_id, date);
```

### 5.6 Partial Unique Index

The `config_entries` table has a partial unique index ensuring only one default entry per service:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_entries_default
  ON config_entries(service_name) WHERE is_default = TRUE;
```

### 5.7 Total Index Count by Group

| Group                                                                                      | Index Count                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Core (conversations, messages, request_logs, channels, costs)                              | 17                                   |
| Personal Data (bookmarks, notes, tasks, calendar, contacts, projects, reminders, captures) | 15                                   |
| Productivity (pomodoro, habits)                                                            | 10                                   |
| Autonomous AI (memories, goals, triggers, plans)                                           | 22                                   |
| Workspace                                                                                  | 9                                    |
| OAuth and Media                                                                            | 6                                    |
| AI Models                                                                                  | 9                                    |
| Custom Data and Tools                                                                      | 7                                    |
| Config Services                                                                            | 3 (created inline in MIGRATIONS_SQL) |
| Local AI                                                                                   | 4                                    |
| **Total**                                                                                  | **102+**                             |

---

## 6. Repository Pattern

**Source directory:** `packages/gateway/src/db/repositories/`

Every data domain has a dedicated repository class that extends `BaseRepository`. Repositories encapsulate all SQL queries and expose typed methods. There are **40+ repository files**.

### 6.1 BaseRepository

**File:** `packages/gateway/src/db/repositories/base.ts`

```typescript
export abstract class BaseRepository {
  protected adapter: DatabaseAdapter | null = null;

  // Core query methods
  protected async query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  protected async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  protected async execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  protected async exec(sql: string): Promise<void>;
  protected async transaction<T>(fn: () => Promise<T>): Promise<T>;

  // SQL dialect helpers
  protected now(): string; // Returns 'NOW()'
  protected boolean(value: boolean): unknown;
  protected parseBoolean(value: unknown): boolean;
}
```

The `BaseRepository` lazily acquires the database adapter via `getAdapter()`. All repositories inherit this behavior.

### 6.2 IRepository Interface

All repositories conform to the `IRepository<T>` interface pattern, which standardizes common query operations:

```typescript
interface IRepository<T> {
  getById(id: string): Promise<T | null>;
  list(query?: StandardQuery): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

interface StandardQuery {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, unknown>;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

The `BaseRepository` provides a `paginatedQuery()` helper that wraps standard list queries with pagination:

```typescript
protected async paginatedQuery<T>(
  sql: string,
  countSql: string,
  params: unknown[],
  page: number,
  pageSize: number
): Promise<PaginatedResult<T>>;
```

### 6.3 Repository Catalog

Each repository exports: the repository class, a factory function, TypeScript interfaces for row types and input types, and optionally a singleton instance.

| Repository File         | Class                         | Tables Managed                                                     |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `conversations.ts`      | `ConversationsRepository`     | conversations                                                      |
| `messages.ts`           | `MessagesRepository`          | messages                                                           |
| `chat.ts`               | `ChatRepository`              | conversations + messages (combined)                                |
| `logs.ts`               | `LogsRepository`              | request_logs                                                       |
| `channels.ts`           | `ChannelsRepository`          | channels                                                           |
| `channel-messages.ts`   | `ChannelMessagesRepository`   | channel_messages                                                   |
| `costs.ts`              | `CostsRepository`             | costs                                                              |
| `agents.ts`             | `AgentsRepository`            | agents                                                             |
| `settings.ts`           | `SettingsRepository`          | settings                                                           |
| `bookmarks.ts`          | `BookmarksRepository`         | bookmarks                                                          |
| `notes.ts`              | `NotesRepository`             | notes                                                              |
| `tasks.ts`              | `TasksRepository`             | tasks                                                              |
| `calendar.ts`           | `CalendarRepository`          | calendar_events                                                    |
| `contacts.ts`           | `ContactsRepository`          | contacts                                                           |
| `captures.ts`           | `CapturesRepository`          | captures                                                           |
| `pomodoro.ts`           | `PomodoroRepository`          | pomodoro_sessions, pomodoro_settings, pomodoro_daily_stats         |
| `habits.ts`             | `HabitsRepository`            | habits, habit_logs                                                 |
| `memories.ts`           | `MemoriesRepository`          | memories                                                           |
| `goals.ts`              | `GoalsRepository`             | goals, goal_steps                                                  |
| `triggers.ts`           | `TriggersRepository`          | triggers, trigger_history                                          |
| `plans.ts`              | `PlansRepository`             | plans, plan_steps, plan_history                                    |
| `oauth-integrations.ts` | `OAuthIntegrationsRepository` | oauth_integrations                                                 |
| `media-settings.ts`     | `MediaSettingsRepository`     | media_provider_settings                                            |
| `model-configs.ts`      | `ModelConfigsRepository`      | user_model_configs, custom_providers, user_provider_configs        |
| `custom-data.ts`        | `CustomDataRepository`        | custom_data, custom_table_schemas, custom_data_records             |
| `custom-tools.ts`       | `CustomToolsRepository`       | custom_tools                                                       |
| `workspaces.ts`         | `WorkspacesRepository`        | user_workspaces, user_containers, code_executions, workspace_audit |
| `plugins.ts`            | `PluginsRepository`           | plugins                                                            |
| `config-services.ts`    | `ConfigServicesRepository`    | config_services, config_entries                                    |
| `local-providers.ts`    | `LocalProvidersRepository`    | local_providers, local_models                                      |

### 6.4 Usage Pattern

Repositories are consumed in two ways:

**Factory function (for user-scoped data):**

```typescript
import { createTasksRepository } from './repositories/index.js';

const tasksRepo = createTasksRepository('user-123');
const tasks = await tasksRepo.list({ status: 'pending' });
```

**Singleton instance (for global data):**

```typescript
import { agentsRepo, settingsRepo } from './repositories/index.js';

const agents = await agentsRepo.getAll();
const theme = await settingsRepo.get('theme');
```

### 6.5 Repository Index

**File:** `packages/gateway/src/db/repositories/index.ts`

Re-exports all repository classes, factory functions, singleton instances, and TypeScript type definitions from every repository file. This is the single import point for consumers.

---

## 7. Data Stores

**File:** `packages/gateway/src/db/data-stores.ts`

Data stores implement the `DataStore<T>` interface from `@ownpilot/core`, providing a clean abstraction layer between the core package and PostgreSQL repositories. Each store wraps a repository and handles type mapping (database row types to core domain types).

### 7.1 Available Stores

| Store Class     | Wraps Repository      | Core Type               |
| --------------- | --------------------- | ----------------------- |
| `BookmarkStore` | `BookmarksRepository` | `Bookmark`              |
| `NoteStore`     | `NotesRepository`     | `Note`                  |
| `TaskStore`     | `TasksRepository`     | `Task`                  |
| `CalendarStore` | `CalendarRepository`  | `PersonalCalendarEvent` |
| `ContactStore`  | `ContactsRepository`  | `Contact`               |

### 7.2 DataStore Interface

Each store implements these methods:

```typescript
interface DataStore<T> {
  get(id: string): Promise<T | null>;
  list(filter?: Record<string, unknown>): Promise<T[]>;
  search(query: string): Promise<T[]>;
  create(data: Omit<T, 'id' | 'createdAt'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}
```

### 7.3 Factory Function

```typescript
import { createDataStores } from './data-stores.js';

const stores = createDataStores('user-123');
// stores.bookmarks, stores.notes, stores.tasks, stores.calendar, stores.contacts
```

### 7.4 Backwards Compatibility

Legacy aliases are exported for migration from the older SQLite-based system:

```typescript
export const SQLiteBookmarkStore = BookmarkStore; // @deprecated
export const SQLiteNoteStore = NoteStore; // @deprecated
export const SQLiteTaskStore = TaskStore; // @deprecated
export const SQLiteCalendarStore = CalendarStore; // @deprecated
export const SQLiteContactStore = ContactStore; // @deprecated
export const createSQLiteDataStores = createDataStores; // @deprecated
```

---

## 8. Seed Data

### 8.1 Default Agents

**File:** `packages/gateway/src/db/seeds/default-agents.ts`

Loads agent configurations from the JSON file at `packages/gateway/data/seeds/default-agents.json`. Each agent includes:

- `id` and `name` (with optional emoji prefix)
- `systemPrompt` -- the agent's personality and instructions
- `provider` / `model` -- always set to `'default'` (resolved at runtime)
- `config` -- includes `maxTokens`, `temperature`, `maxTurns`, `maxToolCalls`, `tools`, and `toolGroups`

The `seedDefaultAgents()` function (in `seeds/index.ts`) only seeds when the `agents` table is empty. It uses the `agentsRepo` singleton to insert each agent.

### 8.2 Example Plans

**File:** `packages/gateway/src/db/seeds/plans-seed.ts`

Creates three example plans with steps:

| Plan Name           | Steps                                  | Purpose                                   |
| ------------------- | -------------------------------------- | ----------------------------------------- |
| Weekly Goal Review  | 3 (tool_call, tool_call, llm_decision) | Review active goals and generate insights |
| Daily Memory Digest | 2 (tool_call, llm_decision)            | Summarize recent memories                 |
| Task Cleanup        | 2 (tool_call, llm_decision)            | Find overdue or stale tasks               |

The `seedExamplePlans()` function checks existing plans by name and skips duplicates.

### 8.3 Config Services

**File:** `packages/gateway/src/db/seeds/config-services-seed.ts`

Pre-populates the `config_services` table with definitions for known external services. Each entry defines:

- A typed `configSchema` (array of field definitions with types like `secret`, `string`, `url`, `number`, `boolean`, `select`)
- Category classification (`weather`, `email`, `media`, `translation`, `search`, `messaging`)
- Documentation URLs

Known services include: OpenWeatherMap, WeatherAPI, SMTP, IMAP, ElevenLabs, Deepgram, DeepL, Tavily, Serper, Perplexity, and Telegram.

The `seedConfigServices()` function uses idempotent upserts and cleans up stale services that are no longer in the seed list.

### 8.4 Main Seed Script

**File:** `packages/gateway/scripts/seed-database.ts`

A standalone script that seeds data via the REST API (requires the server to be running):

```bash
npx tsx scripts/seed-database.ts
```

Seeds: agents (from JSON), sample tasks, sample notes, sample memories, and sample goals.

### 8.5 Trigger and Plan Seeds

**File:** `packages/gateway/scripts/seed-triggers-plans.ts`

A standalone script that seeds trigger and plan data via the REST API:

```bash
npx tsx scripts/seed-triggers-plans.ts
```

Seeds 10 sample triggers across all four types (schedule, event, condition, webhook) and 5 sample plans with full step definitions (Morning Routine Analysis, Weekly Goal Review, Email Processing Pipeline, Code Review Assistant, Research Topic Deep Dive).

---

## 9. Migrations

### 9.1 Schema Migrations (MIGRATIONS_SQL)

All schema migrations live in the `MIGRATIONS_SQL` constant in `schema.ts`. They follow a strict idempotent pattern using PL/pgSQL:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'table_name' AND column_name = 'column_name'
  ) THEN
    ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value;
  END IF;
END $$;
```

This pattern is safe to run any number of times. The migrations cover:

**triggers table:**

- Added `enabled` column (BOOLEAN DEFAULT TRUE)

**custom_tools table (major migration):**

- `implementation` -> `code` (column rename with data migration)
- `enabled` -> `status` (boolean to enum migration)
- `source` -> `created_by` (column rename with data migration)
- Added: `category`, `permissions`, `requires_approval`, `version`, `metadata`, `usage_count`, `last_used_at`, `required_api_keys`

**Model and provider config tables:**

- Added `is_enabled` column to `user_model_configs`, `custom_providers`, `user_provider_configs`

**conversations table:**

- Added `agent_name` column

**request_logs table:**

- Added `error_stack` column

### 9.2 Table Migration (api_services -> config_services)

The most complex migration replaces the old `api_services` table with `config_services` + `config_entries`:

1. Creates new `config_services` and `config_entries` tables
2. Checks if `api_services` exists
3. Migrates service definitions with schema transformation
4. Migrates configuration values (api_key, base_url, extra_config) into `config_entries`
5. Drops the old `api_services` table

### 9.3 SQLite to PostgreSQL Migration

**File:** `packages/gateway/scripts/migrate-to-postgres.ts`

A full database migration tool for users moving from the deprecated SQLite backend:

```bash
# Preview what would be migrated
pnpm tsx scripts/migrate-to-postgres.ts --dry-run

# Migrate all data
pnpm tsx scripts/migrate-to-postgres.ts

# Clear target tables first, then migrate
pnpm tsx scripts/migrate-to-postgres.ts --truncate

# Skip schema creation (if already exists)
pnpm tsx scripts/migrate-to-postgres.ts --skip-schema
```

The migrator:

1. Opens the SQLite database in read-only mode
2. Connects to PostgreSQL via a connection pool
3. Iterates tables in dependency order (26 tables, parents before children)
4. Converts SQLite types: INTEGER booleans -> true/false, TEXT timestamps -> TIMESTAMP, TEXT JSON -> JSONB
5. Inserts rows in batches of 100 with `ON CONFLICT DO NOTHING`
6. Prints a detailed summary table with success/failure counts

---

## 10. Connection Management

### 10.1 Adapter Architecture

**Files:** `packages/gateway/src/db/adapters/`

The database layer uses an adapter pattern with a single implementation:

```
DatabaseAdapter (interface)
  └── PostgresAdapter (pg Pool)
```

The `DatabaseAdapter` interface defines:

| Method                     | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `query<T>(sql, params)`    | Execute SELECT, return rows                       |
| `queryOne<T>(sql, params)` | Execute SELECT, return first row or null          |
| `execute(sql, params)`     | Execute INSERT/UPDATE/DELETE, return change count |
| `transaction<T>(fn)`       | Execute function in BEGIN/COMMIT/ROLLBACK         |
| `exec(sql)`                | Execute raw SQL (schema changes)                  |
| `close()`                  | Close connection pool                             |
| `now()`                    | SQL timestamp expression (`NOW()`)                |
| `placeholder(index)`       | Parameter placeholder (`$1`, `$2`, ...)           |
| `boolean(value)`           | Convert boolean for storage                       |

### 10.2 PostgreSQL Connection Pool

The `PostgresAdapter` uses the `pg` library (node-postgres) with connection pooling:

```typescript
this.pool = new Pool({
  connectionString: config.postgresUrl,
  max: config.postgresPoolSize || 10, // Maximum connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Timeout on new connection attempts
});
```

### 10.3 Global Singleton

The adapter module (`adapters/index.ts`) maintains a global singleton:

```typescript
// First call creates the adapter and initializes the schema
const adapter = await getAdapter();

// Subsequent calls return the cached instance
const adapter = await getAdapter();

// Synchronous access (must be initialized first)
const adapter = getAdapterSync();

// Explicit initialization
await initializeAdapter(config);

// Cleanup on shutdown
await closeAdapter();
```

### 10.4 Schema Auto-Initialization

On the first `createAdapter()` call, the schema is automatically initialized:

```typescript
if (!schemaInitialized) {
  await initializeSchema(async (sql) => pgAdapter.exec(sql));
  schemaInitialized = true;
}
```

This ensures the database schema is always up to date when the application starts.

### 10.5 Placeholder Conversion

The adapter automatically converts SQLite-style `?` placeholders to PostgreSQL `$1, $2, ...` style, allowing repositories to use either format:

```typescript
private convertPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index++;
    return `$${index}`;
  });
}
```

---

## 11. Docker Compose Setup

### 11.1 Database-Only (Development)

**File:** `docker-compose.db.yml`

Runs only the PostgreSQL container for local development:

```bash
docker compose -f docker-compose.db.yml up -d
```

Configuration:

| Parameter      | Default                  | Description                 |
| -------------- | ------------------------ | --------------------------- |
| Image          | `postgres:16-alpine`     | PostgreSQL 16 on Alpine     |
| Container name | `ownpilot-db`            | Docker container name       |
| Host port      | `25432`                  | Maps to container port 5432 |
| Username       | `ownpilot`               | PostgreSQL user             |
| Password       | `ownpilot_secret`        | PostgreSQL password         |
| Database       | `ownpilot`               | PostgreSQL database name    |
| Volume         | `ownpilot-postgres-data` | Persistent data             |

Health check: `pg_isready -U ownpilot -d ownpilot` (every 10s, 5 retries).

### 11.2 Full Stack

**File:** `docker-compose.yml`

Runs PostgreSQL, the gateway API server, and optionally the UI:

```bash
# Full stack with database
docker compose --profile postgres up -d

# Full stack with UI
docker compose --profile postgres --profile ui up -d
```

The gateway service depends on the PostgreSQL service with a health check condition. Environment variables are passed through for database connection, API keys, Telegram integration, authentication, and autonomy settings.

---

## 12. Environment Variables

### 12.1 Database Connection

| Variable             | Required | Default                  | Description                       |
| -------------------- | -------- | ------------------------ | --------------------------------- |
| `DATABASE_URL`       | No       | (built from parts below) | Full PostgreSQL connection string |
| `POSTGRES_HOST`      | No       | `localhost`              | PostgreSQL hostname               |
| `POSTGRES_PORT`      | No       | `25432`                  | PostgreSQL port                   |
| `POSTGRES_USER`      | No       | `ownpilot`               | PostgreSQL username               |
| `POSTGRES_PASSWORD`  | No       | `ownpilot_secret`        | PostgreSQL password               |
| `POSTGRES_DB`        | No       | `ownpilot`               | PostgreSQL database name          |
| `POSTGRES_POOL_SIZE` | No       | `10`                     | Maximum connection pool size      |
| `DB_VERBOSE`         | No       | `false`                  | Enable verbose SQL logging        |

If `DATABASE_URL` is not set, the connection string is built from the individual `POSTGRES_*` variables:

```
postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}
```

### 12.2 Production Warning

In production (`NODE_ENV=production`), the system logs a warning if no explicit database credentials are provided. Default credentials are intended only for local development with Docker Compose.

### 12.3 Default Connection String

For local development with the provided Docker Compose setup:

```
postgresql://ownpilot:ownpilot_secret@localhost:25432/ownpilot
```
