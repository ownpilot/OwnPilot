# OwnPilot Built-in Data Reference

Complete reference for all built-in data types stored in the OwnPilot PostgreSQL database. Every table, column, relationship, constraint, associated AI tool, and API route is documented here.

---

## Table of Contents

1. [Conversations & Messages](#1-conversations--messages)
2. [Personal Data](#2-personal-data)
3. [Productivity](#3-productivity)
4. [Finance](#4-finance)
5. [Autonomous AI](#5-autonomous-ai)
6. [Custom Tools & Data](#6-custom-tools--data)
7. [Cost Tracking](#7-cost-tracking)
8. [Request Logs](#8-request-logs)
9. [Channels](#9-channels)
10. [Settings](#10-settings)
11. [Agents](#11-agents)
12. [Media & OAuth](#12-media--oauth)
13. [AI Models](#13-ai-models)
14. [Workspace Isolation](#14-workspace-isolation)
15. [Config Center](#15-config-center)
16. [Plugins](#16-plugins)
17. [Local AI](#17-local-ai)

---

## 1. Conversations & Messages

The core chat infrastructure. Every interaction between a user and the AI is recorded as a conversation containing ordered messages.

### 1.1 `conversations`

Top-level container for chat sessions. Each conversation holds a sequence of messages and is optionally bound to a specific agent, provider, and model.

| Column          | Type                     | Default     | Nullable | Description                                                            |
| --------------- | ------------------------ | ----------- | -------- | ---------------------------------------------------------------------- |
| `id`            | TEXT                     | --          | PK       | Unique identifier (UUID-style string)                                  |
| `user_id`       | TEXT                     | `'default'` | NOT NULL | Owner of the conversation                                              |
| `title`         | TEXT                     | --          | Yes      | Display title, often auto-generated from the first user message        |
| `agent_id`      | TEXT                     | --          | Yes      | Foreign reference to the agent that handled this conversation          |
| `agent_name`    | TEXT                     | --          | Yes      | Denormalized agent name for fast display                               |
| `provider`      | TEXT                     | --          | Yes      | AI provider used (e.g., `openai`, `anthropic`, `google`)               |
| `model`         | TEXT                     | --          | Yes      | Specific model identifier (e.g., `gpt-4o`, `claude-sonnet-4-20250514`) |
| `system_prompt` | TEXT                     | --          | Yes      | The system prompt active during this conversation                      |
| `message_count` | INTEGER                  | `0`         | NOT NULL | Cached count of messages in this conversation                          |
| `is_archived`   | BOOLEAN                  | `FALSE`     | NOT NULL | Whether the user has archived this conversation                        |
| `created_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | When the conversation was started                                      |
| `updated_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Last modification timestamp                                            |
| `metadata`      | JSONB                    | `'{}'`      | Yes      | Extensible JSON metadata (custom tags, UI state, etc.)                 |

**Indexes:**

- `idx_conversations_user` on `(user_id)` -- fast per-user listing
- `idx_conversations_updated` on `(updated_at DESC)` -- recent-first sorting
- `idx_conversations_archived` on `(is_archived)` -- archive filtering

**Relationships:**

- Has many `messages` (cascade delete)
- Has many `costs` (set null on delete)
- Has many `request_logs` (set null on delete)
- Optionally references `agents` via `agent_id`

**API Routes:**

- `GET /api/v1/chat/conversations` -- List conversations
- `GET /api/v1/chat/conversations/:id` -- Get conversation with messages
- `POST /api/v1/chat/conversations` -- Create conversation
- `PATCH /api/v1/chat/conversations/:id` -- Update conversation (title, archive)
- `DELETE /api/v1/chat/conversations/:id` -- Delete conversation and all messages

---

### 1.2 `messages`

Individual messages within a conversation. Supports system, user, assistant, and tool roles following the OpenAI/Anthropic message format.

| Column            | Type                     | Default | Nullable | Constraint                                       | Description                                                          |
| ----------------- | ------------------------ | ------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `id`              | TEXT                     | --      | PK       | --                                               | Unique identifier                                                    |
| `conversation_id` | TEXT                     | --      | NOT NULL | FK -> `conversations(id)` ON DELETE CASCADE      | Parent conversation                                                  |
| `role`            | TEXT                     | --      | NOT NULL | CHECK IN (`system`, `user`, `assistant`, `tool`) | Message author role                                                  |
| `content`         | TEXT                     | --      | NOT NULL | --                                               | Message text content                                                 |
| `provider`        | TEXT                     | --      | Yes      | --                                               | Which AI provider generated this (for assistant messages)            |
| `model`           | TEXT                     | --      | Yes      | --                                               | Which model generated this                                           |
| `tool_calls`      | JSONB                    | --      | Yes      | --                                               | Array of tool call requests made by the assistant                    |
| `tool_call_id`    | TEXT                     | --      | Yes      | --                                               | For `tool` role messages: the ID of the tool call being responded to |
| `trace`           | JSONB                    | --      | Yes      | --                                               | Execution trace data for debugging                                   |
| `is_error`        | BOOLEAN                  | `FALSE` | NOT NULL | --                                               | Whether this message represents an error                             |
| `input_tokens`    | INTEGER                  | --      | Yes      | --                                               | Tokens consumed by the input (for assistant messages)                |
| `output_tokens`   | INTEGER                  | --      | Yes      | --                                               | Tokens generated in the output                                       |
| `created_at`      | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | --                                               | When the message was created                                         |

**Indexes:**

- `idx_messages_conversation` on `(conversation_id)` -- fast conversation loading
- `idx_messages_created` on `(created_at)` -- chronological ordering
- `idx_messages_role` on `(role)` -- role-based filtering

**Role semantics:**

- `system` -- System prompt or context injection. Typically the first message.
- `user` -- Human user input.
- `assistant` -- AI-generated response. May include `tool_calls`.
- `tool` -- Result of a tool execution, linked back via `tool_call_id`.

**`tool_calls` JSONB structure:**

```json
[
  {
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "add_task",
      "arguments": "{\"title\":\"Buy groceries\",\"priority\":\"high\"}"
    }
  }
]
```

**API Routes:**

- Messages are accessed through conversation endpoints.
- `POST /api/v1/chat` -- Send a message and receive a streamed response.

---

## 2. Personal Data

User-owned personal information managed through both the REST API and AI tool calls. All personal data tables share a common `user_id` column defaulting to `'default'` for single-user deployments.

### 2.1 `tasks`

Task management with priorities, due dates, subtask hierarchy, and project grouping.

| Column         | Type                     | Default     | Nullable | Constraint                                                    | Description                               |
| -------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------- | ----------------------------------------- |
| `id`           | TEXT                     | --          | PK       | --                                                            | Unique identifier                         |
| `user_id`      | TEXT                     | `'default'` | NOT NULL | --                                                            | Owner                                     |
| `title`        | TEXT                     | --          | NOT NULL | --                                                            | Task title                                |
| `description`  | TEXT                     | --          | Yes      | --                                                            | Detailed description                      |
| `status`       | TEXT                     | `'pending'` | NOT NULL | CHECK IN (`pending`, `in_progress`, `completed`, `cancelled`) | Current status                            |
| `priority`     | TEXT                     | `'normal'`  | NOT NULL | CHECK IN (`low`, `normal`, `high`, `urgent`)                  | Priority level                            |
| `due_date`     | TEXT                     | --          | Yes      | --                                                            | Due date string (YYYY-MM-DD)              |
| `due_time`     | TEXT                     | --          | Yes      | --                                                            | Due time string (HH:MM)                   |
| `reminder_at`  | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                            | When to send a reminder                   |
| `category`     | TEXT                     | --          | Yes      | --                                                            | User-defined category                     |
| `tags`         | JSONB                    | `'[]'`      | Yes      | --                                                            | Array of string tags                      |
| `parent_id`    | TEXT                     | --          | Yes      | FK -> `tasks(id)` ON DELETE SET NULL                          | Parent task for subtask hierarchy         |
| `project_id`   | TEXT                     | --          | Yes      | --                                                            | Associated project                        |
| `recurrence`   | TEXT                     | --          | Yes      | --                                                            | Recurrence rule (e.g., `daily`, `weekly`) |
| `completed_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                            | When the task was completed               |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                            | Creation time                             |
| `updated_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                            | Last update time                          |

**Indexes:**

- `idx_tasks_user` on `(user_id)`
- `idx_tasks_status` on `(status)`
- `idx_tasks_due` on `(due_date)`
- `idx_tasks_project` on `(project_id)`

**Relationships:**

- Self-referential via `parent_id` for subtask trees.
- Logically references `projects` via `project_id`.

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_task` | Create a new task with title, due date, priority, category, and notes |
| `list_tasks` | List tasks with filters (status, priority, category, search, limit) |
| `complete_task` | Mark a task as completed by ID |
| `update_task` | Update any task fields by ID |
| `delete_task` | Delete a task by ID |
| `batch_add_tasks` | Create multiple tasks at once |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/personal/tasks` | List tasks with query filters |
| `GET` | `/api/v1/personal/tasks/today` | Tasks due today |
| `GET` | `/api/v1/personal/tasks/overdue` | Overdue tasks |
| `GET` | `/api/v1/personal/tasks/upcoming` | Tasks due in the next N days |
| `GET` | `/api/v1/personal/tasks/categories` | All task categories |
| `GET` | `/api/v1/personal/tasks/:id` | Single task by ID |
| `POST` | `/api/v1/personal/tasks` | Create a task |
| `PATCH` | `/api/v1/personal/tasks/:id` | Update a task |
| `POST` | `/api/v1/personal/tasks/:id/complete` | Mark task complete |
| `DELETE` | `/api/v1/personal/tasks/:id` | Delete a task |

---

### 2.2 `bookmarks`

Web bookmark management with favorites, visit tracking, and categorization.

| Column            | Type                     | Default     | Nullable | Description                                |
| ----------------- | ------------------------ | ----------- | -------- | ------------------------------------------ |
| `id`              | TEXT                     | --          | PK       | Unique identifier                          |
| `user_id`         | TEXT                     | `'default'` | NOT NULL | Owner                                      |
| `url`             | TEXT                     | --          | NOT NULL | Bookmark URL                               |
| `title`           | TEXT                     | --          | NOT NULL | Display title                              |
| `description`     | TEXT                     | --          | Yes      | User description or auto-extracted summary |
| `favicon`         | TEXT                     | --          | Yes      | Favicon URL                                |
| `category`        | TEXT                     | --          | Yes      | User-defined category                      |
| `tags`            | JSONB                    | `'[]'`      | Yes      | Array of string tags                       |
| `is_favorite`     | BOOLEAN                  | `FALSE`     | NOT NULL | Whether this is a favorite                 |
| `visit_count`     | INTEGER                  | `0`         | NOT NULL | Number of times visited                    |
| `last_visited_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | Last visit timestamp                       |
| `created_at`      | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Creation time                              |
| `updated_at`      | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Last update time                           |

**Indexes:**

- `idx_bookmarks_user` on `(user_id)`
- `idx_bookmarks_category` on `(category)`

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_bookmark` | Save a bookmark with URL, title, description, category, tags |
| `list_bookmarks` | List bookmarks with filters (category, favorite, search, limit) |
| `delete_bookmark` | Delete a bookmark by ID |
| `batch_add_bookmarks` | Save multiple bookmarks at once |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/personal/bookmarks` | List bookmarks |
| `GET` | `/api/v1/personal/bookmarks/favorites` | Favorite bookmarks |
| `GET` | `/api/v1/personal/bookmarks/recent` | Recently added bookmarks |
| `GET` | `/api/v1/personal/bookmarks/categories` | All categories |
| `GET` | `/api/v1/personal/bookmarks/:id` | Single bookmark |
| `POST` | `/api/v1/personal/bookmarks` | Create bookmark |
| `PATCH` | `/api/v1/personal/bookmarks/:id` | Update bookmark |
| `POST` | `/api/v1/personal/bookmarks/:id/favorite` | Toggle favorite status |
| `DELETE` | `/api/v1/personal/bookmarks/:id` | Delete bookmark |

---

### 2.3 `notes`

Markdown note storage with pinning, archiving, and color coding.

| Column         | Type                     | Default      | Nullable | Description                           |
| -------------- | ------------------------ | ------------ | -------- | ------------------------------------- |
| `id`           | TEXT                     | --           | PK       | Unique identifier                     |
| `user_id`      | TEXT                     | `'default'`  | NOT NULL | Owner                                 |
| `title`        | TEXT                     | --           | NOT NULL | Note title                            |
| `content`      | TEXT                     | --           | NOT NULL | Note body content                     |
| `content_type` | TEXT                     | `'markdown'` | NOT NULL | Content format (currently `markdown`) |
| `category`     | TEXT                     | --           | Yes      | User-defined category                 |
| `tags`         | JSONB                    | `'[]'`       | Yes      | Array of string tags                  |
| `is_pinned`    | BOOLEAN                  | `FALSE`      | NOT NULL | Whether the note is pinned to the top |
| `is_archived`  | BOOLEAN                  | `FALSE`      | NOT NULL | Whether the note is archived          |
| `color`        | TEXT                     | --           | Yes      | Display color (hex or name)           |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`      | NOT NULL | Creation time                         |
| `updated_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`      | NOT NULL | Last update time                      |

**Indexes:**

- `idx_notes_user` on `(user_id)`
- `idx_notes_category` on `(category)`

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_note` | Create a note with title, content, category, tags |
| `list_notes` | List notes with filters (category, pinned, search, limit) |
| `update_note` | Update a note by ID |
| `delete_note` | Delete a note by ID |
| `batch_add_notes` | Create multiple notes at once |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/personal/notes` | List notes |
| `GET` | `/api/v1/personal/notes/pinned` | Pinned notes |
| `GET` | `/api/v1/personal/notes/archived` | Archived notes |
| `GET` | `/api/v1/personal/notes/categories` | All categories |
| `GET` | `/api/v1/personal/notes/:id` | Single note |
| `POST` | `/api/v1/personal/notes` | Create note |
| `PATCH` | `/api/v1/personal/notes/:id` | Update note |
| `POST` | `/api/v1/personal/notes/:id/pin` | Toggle pin |
| `POST` | `/api/v1/personal/notes/:id/archive` | Archive note |
| `POST` | `/api/v1/personal/notes/:id/unarchive` | Unarchive note |
| `DELETE` | `/api/v1/personal/notes/:id` | Delete note |

---

### 2.4 `calendar_events`

Calendar events with timezone support, recurrence, reminders, attendees, and external calendar sync.

| Column             | Type                     | Default     | Nullable | Description                                          |
| ------------------ | ------------------------ | ----------- | -------- | ---------------------------------------------------- |
| `id`               | TEXT                     | --          | PK       | Unique identifier                                    |
| `user_id`          | TEXT                     | `'default'` | NOT NULL | Owner                                                |
| `title`            | TEXT                     | --          | NOT NULL | Event title                                          |
| `description`      | TEXT                     | --          | Yes      | Event description                                    |
| `location`         | TEXT                     | --          | Yes      | Physical or virtual location                         |
| `start_time`       | TIMESTAMP WITH TIME ZONE | --          | NOT NULL | Event start (required)                               |
| `end_time`         | TIMESTAMP WITH TIME ZONE | --          | Yes      | Event end (optional for open-ended events)           |
| `all_day`          | BOOLEAN                  | `FALSE`     | NOT NULL | Whether this is an all-day event                     |
| `timezone`         | TEXT                     | `'UTC'`     | Yes      | IANA timezone identifier                             |
| `recurrence`       | TEXT                     | --          | Yes      | Recurrence rule string                               |
| `reminder_minutes` | INTEGER                  | --          | Yes      | Minutes before the event to send a reminder          |
| `category`         | TEXT                     | --          | Yes      | Event category                                       |
| `tags`             | JSONB                    | `'[]'`      | Yes      | Array of string tags                                 |
| `color`            | TEXT                     | --          | Yes      | Display color                                        |
| `external_id`      | TEXT                     | --          | Yes      | ID from an external calendar (Google Calendar, etc.) |
| `external_source`  | TEXT                     | --          | Yes      | Source system name (e.g., `google_calendar`)         |
| `attendees`        | JSONB                    | `'[]'`      | Yes      | Array of attendee objects                            |
| `created_at`       | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Creation time                                        |
| `updated_at`       | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Last update time                                     |

**Indexes:**

- `idx_calendar_user` on `(user_id)`
- `idx_calendar_start` on `(start_time)`

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_calendar_event` | Create an event with title, start/end time, location, reminder |
| `list_calendar_events` | List events with filters (date range, category, search) |
| `delete_calendar_event` | Delete an event by ID |
| `batch_add_calendar_events` | Create multiple events at once |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/personal/calendar` | List events with query filters |
| `GET` | `/api/v1/personal/calendar/today` | Today's events |
| `GET` | `/api/v1/personal/calendar/upcoming` | Events in the next N days |
| `GET` | `/api/v1/personal/calendar/categories` | All categories |
| `GET` | `/api/v1/personal/calendar/:id` | Single event |
| `POST` | `/api/v1/personal/calendar` | Create event |
| `PATCH` | `/api/v1/personal/calendar/:id` | Update event |
| `DELETE` | `/api/v1/personal/calendar/:id` | Delete event |

---

### 2.5 `contacts`

Contact management with rich profile data, social links, custom fields, and external sync.

| Column              | Type                     | Default     | Nullable | Description                                                        |
| ------------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------------ |
| `id`                | TEXT                     | --          | PK       | Unique identifier                                                  |
| `user_id`           | TEXT                     | `'default'` | NOT NULL | Owner                                                              |
| `name`              | TEXT                     | --          | NOT NULL | Full name                                                          |
| `nickname`          | TEXT                     | --          | Yes      | Nickname or alias                                                  |
| `email`             | TEXT                     | --          | Yes      | Primary email                                                      |
| `phone`             | TEXT                     | --          | Yes      | Primary phone                                                      |
| `company`           | TEXT                     | --          | Yes      | Company or organization                                            |
| `job_title`         | TEXT                     | --          | Yes      | Job title                                                          |
| `avatar`            | TEXT                     | --          | Yes      | Avatar image URL                                                   |
| `birthday`          | TEXT                     | --          | Yes      | Birthday string (YYYY-MM-DD or MM-DD)                              |
| `address`           | TEXT                     | --          | Yes      | Mailing or physical address                                        |
| `notes`             | TEXT                     | --          | Yes      | Free-text notes about this contact                                 |
| `relationship`      | TEXT                     | --          | Yes      | Relationship type (e.g., `friend`, `colleague`, `family`)          |
| `tags`              | JSONB                    | `'[]'`      | Yes      | Array of string tags                                               |
| `is_favorite`       | BOOLEAN                  | `FALSE`     | NOT NULL | Favorite contact                                                   |
| `external_id`       | TEXT                     | --          | Yes      | ID from external source                                            |
| `external_source`   | TEXT                     | --          | Yes      | Source system name                                                 |
| `social_links`      | JSONB                    | `'{}'`      | Yes      | Object of social media links `{ twitter: "...", linkedin: "..." }` |
| `custom_fields`     | JSONB                    | `'{}'`      | Yes      | Arbitrary key-value pairs for user-defined fields                  |
| `last_contacted_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | When the contact was last reached out to                           |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Creation time                                                      |
| `updated_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Last update time                                                   |

**Indexes:**

- `idx_contacts_user` on `(user_id)`
- `idx_contacts_name` on `(name)`

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_contact` | Create a contact with name, email, phone, company, relationship, etc. |
| `list_contacts` | List contacts with filters (relationship, company, favorite, search) |
| `update_contact` | Update a contact by ID |
| `delete_contact` | Delete a contact by ID |
| `batch_add_contacts` | Create multiple contacts at once |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/personal/contacts` | List contacts |
| `GET` | `/api/v1/personal/contacts/favorites` | Favorite contacts |
| `GET` | `/api/v1/personal/contacts/recent` | Recently contacted |
| `GET` | `/api/v1/personal/contacts/birthdays` | Upcoming birthdays (next N days) |
| `GET` | `/api/v1/personal/contacts/relationships` | All relationship types |
| `GET` | `/api/v1/personal/contacts/companies` | All companies |
| `GET` | `/api/v1/personal/contacts/:id` | Single contact |
| `POST` | `/api/v1/personal/contacts` | Create contact |
| `PATCH` | `/api/v1/personal/contacts/:id` | Update contact |
| `POST` | `/api/v1/personal/contacts/:id/favorite` | Toggle favorite |
| `DELETE` | `/api/v1/personal/contacts/:id` | Delete contact |

---

### 2.6 `projects`

Lightweight project containers for grouping tasks. A project provides a high-level organizational boundary.

| Column        | Type                     | Default     | Nullable | Constraint                                   | Description             |
| ------------- | ------------------------ | ----------- | -------- | -------------------------------------------- | ----------------------- |
| `id`          | TEXT                     | --          | PK       | --                                           | Unique identifier       |
| `user_id`     | TEXT                     | `'default'` | NOT NULL | --                                           | Owner                   |
| `name`        | TEXT                     | --          | NOT NULL | --                                           | Project name            |
| `description` | TEXT                     | --          | Yes      | --                                           | Description             |
| `color`       | TEXT                     | --          | Yes      | --                                           | Display color           |
| `icon`        | TEXT                     | --          | Yes      | --                                           | Display icon identifier |
| `status`      | TEXT                     | `'active'`  | NOT NULL | CHECK IN (`active`, `completed`, `archived`) | Project lifecycle state |
| `due_date`    | TEXT                     | --          | Yes      | --                                           | Target completion date  |
| `created_at`  | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                           | Creation time           |
| `updated_at`  | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                           | Last update time        |

**Indexes:**

- `idx_projects_user` on `(user_id)`

**Relationships:**

- Logically referenced by `tasks.project_id`.

---

### 2.7 `reminders`

Standalone reminders that can optionally link to other entities (tasks, events, etc.).

| Column         | Type                     | Default     | Nullable | Description                                        |
| -------------- | ------------------------ | ----------- | -------- | -------------------------------------------------- |
| `id`           | TEXT                     | --          | PK       | Unique identifier                                  |
| `user_id`      | TEXT                     | `'default'` | NOT NULL | Owner                                              |
| `title`        | TEXT                     | --          | NOT NULL | Reminder title                                     |
| `description`  | TEXT                     | --          | Yes      | Additional details                                 |
| `remind_at`    | TIMESTAMP WITH TIME ZONE | --          | NOT NULL | When to fire the reminder                          |
| `recurrence`   | TEXT                     | --          | Yes      | Recurrence rule                                    |
| `is_completed` | BOOLEAN                  | `FALSE`     | NOT NULL | Whether the reminder has been acknowledged         |
| `related_type` | TEXT                     | --          | Yes      | Type of the related entity (`task`, `event`, etc.) |
| `related_id`   | TEXT                     | --          | Yes      | ID of the related entity                           |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Creation time                                      |
| `updated_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | Last update time                                   |

**Indexes:**

- `idx_reminders_user` on `(user_id)`
- `idx_reminders_time` on `(remind_at)`

---

### 2.8 `captures`

Quick-capture inbox for rapidly recording ideas, thoughts, TODOs, links, quotes, and snippets. Captures are later triaged ("processed") into proper data types like notes, tasks, or bookmarks.

| Column              | Type                     | Default     | Nullable | Constraint                                                                            | Description                                              |
| ------------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `id`                | TEXT                     | --          | PK       | --                                                                                    | Unique identifier                                        |
| `user_id`           | TEXT                     | `'default'` | NOT NULL | --                                                                                    | Owner                                                    |
| `content`           | TEXT                     | --          | NOT NULL | --                                                                                    | The captured content                                     |
| `type`              | TEXT                     | `'thought'` | NOT NULL | CHECK IN (`idea`, `thought`, `todo`, `link`, `quote`, `snippet`, `question`, `other`) | Type of capture                                          |
| `tags`              | JSONB                    | `'[]'`      | Yes      | --                                                                                    | Array of string tags                                     |
| `source`            | TEXT                     | --          | Yes      | --                                                                                    | Where the capture came from (e.g., `chat`, `web`, `api`) |
| `url`               | TEXT                     | --          | Yes      | --                                                                                    | Associated URL (for `link` type)                         |
| `processed`         | BOOLEAN                  | `FALSE`     | NOT NULL | --                                                                                    | Whether the capture has been triaged                     |
| `processed_as_type` | TEXT                     | --          | Yes      | CHECK IN (`note`, `task`, `bookmark`, `discarded`) or NULL                            | What it was converted to                                 |
| `processed_as_id`   | TEXT                     | --          | Yes      | --                                                                                    | ID of the entity created during processing               |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                                    | When captured                                            |
| `processed_at`      | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                                    | When processed                                           |

**Indexes:**

- `idx_captures_user` on `(user_id)`
- `idx_captures_processed` on `(processed)`
- `idx_captures_type` on `(type)`
- `idx_captures_created` on `(created_at DESC)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/productivity/captures` | List captures with filters |
| `GET` | `/api/v1/productivity/captures/inbox` | Unprocessed captures |
| `GET` | `/api/v1/productivity/captures/stats` | Capture statistics |
| `GET` | `/api/v1/productivity/captures/:id` | Single capture |
| `POST` | `/api/v1/productivity/captures` | Create a capture |
| `POST` | `/api/v1/productivity/captures/:id/process` | Process (triage) a capture |
| `DELETE` | `/api/v1/productivity/captures/:id` | Delete a capture |

---

### 2.9 Personal Data Summary

A unified summary endpoint aggregates counts across all personal data types.

**API Route:**

- `GET /api/v1/personal/summary` -- Returns counts for tasks (total, pending, overdue, due today), bookmarks (total, favorites), notes (total, pinned), calendar (total, today, upcoming), and contacts (total, favorites, upcoming birthdays).

---

## 3. Productivity

Time management and habit-building tools.

### 3.1 `pomodoro_sessions`

Individual Pomodoro timer sessions (work, short break, or long break).

| Column                | Type                     | Default     | Nullable | Constraint                                       | Description                                     |
| --------------------- | ------------------------ | ----------- | -------- | ------------------------------------------------ | ----------------------------------------------- |
| `id`                  | TEXT                     | --          | PK       | --                                               | Unique identifier                               |
| `user_id`             | TEXT                     | `'default'` | NOT NULL | --                                               | Owner                                           |
| `type`                | TEXT                     | --          | NOT NULL | CHECK IN (`work`, `short_break`, `long_break`)   | Session type                                    |
| `status`              | TEXT                     | `'running'` | NOT NULL | CHECK IN (`running`, `completed`, `interrupted`) | Current state                                   |
| `task_description`    | TEXT                     | --          | Yes      | --                                               | What the user is working on during this session |
| `duration_minutes`    | INTEGER                  | --          | NOT NULL | --                                               | Planned duration in minutes                     |
| `started_at`          | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                               | Session start time                              |
| `completed_at`        | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                               | When the session completed normally             |
| `interrupted_at`      | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                               | When the session was interrupted                |
| `interruption_reason` | TEXT                     | --          | Yes      | --                                               | Reason for interruption                         |

**Indexes:**

- `idx_pomodoro_sessions_user` on `(user_id)`
- `idx_pomodoro_sessions_status` on `(status)`
- `idx_pomodoro_sessions_started` on `(started_at DESC)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/productivity/pomodoro/session` | Get active session |
| `POST` | `/api/v1/productivity/pomodoro/session/start` | Start a new session |
| `POST` | `/api/v1/productivity/pomodoro/session/:id/complete` | Complete a session |
| `POST` | `/api/v1/productivity/pomodoro/session/:id/interrupt` | Interrupt a session |
| `GET` | `/api/v1/productivity/pomodoro/sessions` | List past sessions |

---

### 3.2 `pomodoro_settings`

Per-user Pomodoro timer configuration.

| Column                       | Type                     | Default     | Description                           |
| ---------------------------- | ------------------------ | ----------- | ------------------------------------- |
| `user_id`                    | TEXT                     | `'default'` | PK. User identifier                   |
| `work_duration`              | INTEGER                  | `25`        | Work session length in minutes        |
| `short_break_duration`       | INTEGER                  | `5`         | Short break length in minutes         |
| `long_break_duration`        | INTEGER                  | `15`        | Long break length in minutes          |
| `sessions_before_long_break` | INTEGER                  | `4`         | Work sessions before a long break     |
| `auto_start_breaks`          | BOOLEAN                  | `FALSE`     | Automatically start breaks            |
| `auto_start_work`            | BOOLEAN                  | `FALSE`     | Automatically start next work session |
| `updated_at`                 | TIMESTAMP WITH TIME ZONE | `NOW()`     | Last settings change                  |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/productivity/pomodoro/settings` | Get Pomodoro settings |
| `PATCH` | `/api/v1/productivity/pomodoro/settings` | Update settings |

---

### 3.3 `pomodoro_daily_stats`

Aggregated daily statistics for Pomodoro usage. Used for streak tracking and productivity analysis.

| Column                | Type    | Default     | Constraint                      | Description                       |
| --------------------- | ------- | ----------- | ------------------------------- | --------------------------------- |
| `id`                  | TEXT    | --          | PK                              | Unique identifier                 |
| `user_id`             | TEXT    | `'default'` | NOT NULL                        | Owner                             |
| `date`                | TEXT    | --          | NOT NULL, UNIQUE(user_id, date) | Date string (YYYY-MM-DD)          |
| `completed_sessions`  | INTEGER | `0`         | NOT NULL                        | Number of completed work sessions |
| `total_work_minutes`  | INTEGER | `0`         | NOT NULL                        | Total minutes spent working       |
| `total_break_minutes` | INTEGER | `0`         | NOT NULL                        | Total minutes on breaks           |
| `interruptions`       | INTEGER | `0`         | NOT NULL                        | Number of interruptions           |

**Indexes:**

- `idx_pomodoro_daily_user_date` on `(user_id, date)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/productivity/pomodoro/stats` | Overall statistics plus today's stats |
| `GET` | `/api/v1/productivity/pomodoro/stats/daily/:date` | Stats for a specific date |

---

### 3.4 `habits`

Habit tracking with flexible frequency, streak computation, and archiving.

| Column              | Type                     | Default     | Nullable | Constraint                                         | Description                                                 |
| ------------------- | ------------------------ | ----------- | -------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `id`                | TEXT                     | --          | PK       | --                                                 | Unique identifier                                           |
| `user_id`           | TEXT                     | `'default'` | NOT NULL | --                                                 | Owner                                                       |
| `name`              | TEXT                     | --          | NOT NULL | --                                                 | Habit name                                                  |
| `description`       | TEXT                     | --          | Yes      | --                                                 | Description of the habit                                    |
| `frequency`         | TEXT                     | `'daily'`   | NOT NULL | CHECK IN (`daily`, `weekly`, `weekdays`, `custom`) | How often the habit should occur                            |
| `target_days`       | JSONB                    | `'[]'`      | Yes      | --                                                 | For `custom` frequency: array of day numbers (0=Sun..6=Sat) |
| `target_count`      | INTEGER                  | `1`         | NOT NULL | --                                                 | Target completions per period                               |
| `unit`              | TEXT                     | --          | Yes      | --                                                 | Unit of measurement (e.g., `glasses`, `pages`, `minutes`)   |
| `category`          | TEXT                     | --          | Yes      | --                                                 | Category                                                    |
| `color`             | TEXT                     | --          | Yes      | --                                                 | Display color                                               |
| `icon`              | TEXT                     | --          | Yes      | --                                                 | Display icon                                                |
| `reminder_time`     | TEXT                     | --          | Yes      | --                                                 | Time of day for reminder (HH:MM)                            |
| `is_archived`       | BOOLEAN                  | `FALSE`     | NOT NULL | --                                                 | Whether the habit is archived                               |
| `streak_current`    | INTEGER                  | `0`         | NOT NULL | --                                                 | Current consecutive completion streak                       |
| `streak_longest`    | INTEGER                  | `0`         | NOT NULL | --                                                 | All-time longest streak                                     |
| `total_completions` | INTEGER                  | `0`         | NOT NULL | --                                                 | Total number of completions                                 |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                 | Creation time                                               |
| `updated_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                 | Last update time                                            |

**Indexes:**

- `idx_habits_user` on `(user_id)`
- `idx_habits_archived` on `(is_archived)`
- `idx_habits_category` on `(category)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/productivity/habits` | List habits |
| `GET` | `/api/v1/productivity/habits/today` | Today's habits with completion status |
| `GET` | `/api/v1/productivity/habits/categories` | All categories |
| `GET` | `/api/v1/productivity/habits/:id` | Habit details with stats |
| `POST` | `/api/v1/productivity/habits` | Create a habit |
| `PATCH` | `/api/v1/productivity/habits/:id` | Update a habit |
| `DELETE` | `/api/v1/productivity/habits/:id` | Delete a habit |
| `POST` | `/api/v1/productivity/habits/:id/archive` | Archive a habit |
| `POST` | `/api/v1/productivity/habits/:id/log` | Log a completion |
| `GET` | `/api/v1/productivity/habits/:id/logs` | Get completion logs |

---

### 3.5 `habit_logs`

Daily completion records for habits. Each log represents one or more completions of a habit on a specific date.

| Column      | Type                     | Default     | Constraint                                     | Description                         |
| ----------- | ------------------------ | ----------- | ---------------------------------------------- | ----------------------------------- |
| `id`        | TEXT                     | --          | PK                                             | Unique identifier                   |
| `habit_id`  | TEXT                     | --          | NOT NULL, FK -> `habits(id)` ON DELETE CASCADE | Parent habit                        |
| `user_id`   | TEXT                     | `'default'` | NOT NULL                                       | Owner                               |
| `date`      | TEXT                     | --          | NOT NULL, UNIQUE(habit_id, date)               | Date string (YYYY-MM-DD)            |
| `count`     | INTEGER                  | `1`         | NOT NULL                                       | Number of completions on this date  |
| `notes`     | TEXT                     | --          | Yes                                            | Optional notes about the completion |
| `logged_at` | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL                                       | When this log was recorded          |

**Indexes:**

- `idx_habit_logs_habit` on `(habit_id)`
- `idx_habit_logs_date` on `(date)`
- `idx_habit_logs_user_date` on `(user_id, date)`

---

## 4. Finance

### 4.1 Expense Tracking

Expenses are stored in a JSON file (`~/.ownpilot/expenses.json`), not in PostgreSQL. The system provides both AI tool access and a REST API.

**Expense Entry structure:**

```typescript
interface ExpenseEntry {
  id: string; // "exp_<timestamp>_<random>"
  date: string; // "YYYY-MM-DD"
  amount: number;
  currency: string; // Default: "TRY"
  category: ExpenseCategory;
  description: string;
  paymentMethod?: string;
  tags?: string[];
  source: string; // "web", "chat", "api"
  receiptImage?: string;
  createdAt: string; // ISO timestamp
  notes?: string;
}
```

**Expense Categories:**
| Category | Color |
|----------|-------|
| `food` | `#FF6B6B` |
| `transport` | `#4ECDC4` |
| `utilities` | `#45B7D1` |
| `entertainment` | `#96CEB4` |
| `shopping` | `#FFEAA7` |
| `health` | `#DDA0DD` |
| `education` | `#98D8C8` |
| `travel` | `#F7DC6F` |
| `subscription` | `#BB8FCE` |
| `housing` | `#85C1E9` |
| `other` | `#AEB6BF` |

**AI Tools:**
| Tool Name | Description |
|-----------|-------------|
| `add_expense` | Add an expense with amount, category, description, date |
| `query_expenses` | Query expenses by date range, category, search |
| `export_expenses` | Export expenses as structured data |
| `expense_summary` | Get summary by period (today, this_week, this_month, etc.) |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/expenses` | List expenses with filters (startDate, endDate, category, search) |
| `GET` | `/api/v1/expenses/summary` | Get expense summary for a period |
| `GET` | `/api/v1/expenses/monthly` | Monthly breakdown for a year |
| `POST` | `/api/v1/expenses` | Add an expense |
| `PUT` | `/api/v1/expenses/:id` | Update an expense |
| `DELETE` | `/api/v1/expenses/:id` | Delete an expense |

---

## 5. Autonomous AI

Tables that power the AI's autonomous capabilities: persistent memory, goal management, trigger automation, and multi-step plan execution.

### 5.1 `memories`

Persistent memory for the AI assistant. The AI stores facts, preferences, conversation summaries, events, and skills it learns about the user over time.

| Column           | Type                     | Default     | Nullable | Constraint                                                        | Description                                                 |
| ---------------- | ------------------------ | ----------- | -------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `id`             | TEXT                     | --          | PK       | --                                                                | Unique identifier                                           |
| `user_id`        | TEXT                     | `'default'` | NOT NULL | --                                                                | Owner                                                       |
| `type`           | TEXT                     | --          | NOT NULL | CHECK IN (`fact`, `preference`, `conversation`, `event`, `skill`) | Memory type                                                 |
| `content`        | TEXT                     | --          | NOT NULL | --                                                                | The memory content (natural language)                       |
| `embedding`      | BYTEA                    | --          | Yes      | --                                                                | Vector embedding for semantic search                        |
| `source`         | TEXT                     | --          | Yes      | --                                                                | Where the memory was learned (e.g., `conversation`, `tool`) |
| `source_id`      | TEXT                     | --          | Yes      | --                                                                | ID of the source entity                                     |
| `importance`     | REAL                     | `0.5`       | NOT NULL | CHECK >= 0 AND <= 1                                               | Importance score (0.0 to 1.0)                               |
| `tags`           | JSONB                    | `'[]'`      | Yes      | --                                                                | Array of string tags                                        |
| `accessed_count` | INTEGER                  | `0`         | NOT NULL | --                                                                | Number of times this memory was retrieved                   |
| `created_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                | When the memory was created                                 |
| `updated_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                | Last update time                                            |
| `accessed_at`    | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                | Last time the memory was accessed                           |
| `metadata`       | JSONB                    | `'{}'`      | Yes      | --                                                                | Extensible metadata                                         |

**Indexes:**

- `idx_memories_user` on `(user_id)`
- `idx_memories_type` on `(type)`
- `idx_memories_importance` on `(importance DESC)`
- `idx_memories_created` on `(created_at DESC)`
- `idx_memories_accessed` on `(accessed_at DESC)`

**Memory type semantics:**

- `fact` -- Factual information about the user (name, location, preferences).
- `preference` -- User preference (communication style, formatting).
- `conversation` -- Summary of a past conversation.
- `event` -- Notable event the user mentioned.
- `skill` -- Something the AI learned to do for this user.

**AI Tools (MEMORY_TOOLS):**
| Tool Name | Description |
|-----------|-------------|
| `remember` | Store a new memory with content, type, importance, tags |
| `recall` | Search memories by query, type, minimum importance |
| `forget` | Delete a specific memory by ID |
| `list_memories` | List all memories with optional type and importance filter |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/memories` | List memories with filters |
| `POST` | `/api/v1/memories` | Create a memory |
| `GET` | `/api/v1/memories/:id` | Get a specific memory |
| `PATCH` | `/api/v1/memories/:id` | Update a memory |
| `DELETE` | `/api/v1/memories/:id` | Delete a memory |

---

### 5.2 `goals`

Long-term objectives with hierarchical sub-goals and progress tracking.

| Column         | Type                     | Default     | Nullable | Constraint                                              | Description                        |
| -------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------- | ---------------------------------- |
| `id`           | TEXT                     | --          | PK       | --                                                      | Unique identifier                  |
| `user_id`      | TEXT                     | `'default'` | NOT NULL | --                                                      | Owner                              |
| `title`        | TEXT                     | --          | NOT NULL | --                                                      | Goal title                         |
| `description`  | TEXT                     | --          | Yes      | --                                                      | Detailed description               |
| `status`       | TEXT                     | `'active'`  | NOT NULL | CHECK IN (`active`, `paused`, `completed`, `abandoned`) | Goal status                        |
| `priority`     | INTEGER                  | `5`         | NOT NULL | CHECK >= 1 AND <= 10                                    | Priority (1=lowest, 10=highest)    |
| `parent_id`    | TEXT                     | --          | Yes      | FK -> `goals(id)` ON DELETE SET NULL                    | Parent goal for sub-goal hierarchy |
| `due_date`     | TEXT                     | --          | Yes      | --                                                      | Target date                        |
| `progress`     | REAL                     | `0`         | NOT NULL | CHECK >= 0 AND <= 100                                   | Completion percentage              |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                      | Creation time                      |
| `updated_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                      | Last update time                   |
| `completed_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                      | Completion time                    |
| `metadata`     | JSONB                    | `'{}'`      | Yes      | --                                                      | Extensible metadata                |

**Indexes:**

- `idx_goals_user` on `(user_id)`
- `idx_goals_status` on `(status)`
- `idx_goals_priority` on `(priority DESC)`
- `idx_goals_parent` on `(parent_id)`

**Relationships:**

- Self-referential via `parent_id` for sub-goal trees.
- Has many `goal_steps` (cascade delete).
- Has many `plans` via `plans.goal_id` (set null on delete).

**AI Tools (GOAL_TOOLS):**
| Tool Name | Description |
|-----------|-------------|
| `create_goal` | Create a new goal with title, description, priority, due date |
| `list_goals` | List goals with status and priority filters |
| `update_goal` | Update goal status, progress, or details |
| `delete_goal` | Delete a goal |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/goals` | List goals |
| `POST` | `/api/v1/goals` | Create a goal |
| `GET` | `/api/v1/goals/:id` | Get goal with steps |
| `PATCH` | `/api/v1/goals/:id` | Update a goal |
| `DELETE` | `/api/v1/goals/:id` | Delete a goal |

---

### 5.3 `goal_steps`

Actionable steps for achieving a goal. Steps are ordered and can have dependencies on other steps.

| Column         | Type                     | Default     | Nullable | Constraint                                                             | Description                            |
| -------------- | ------------------------ | ----------- | -------- | ---------------------------------------------------------------------- | -------------------------------------- |
| `id`           | TEXT                     | --          | PK       | --                                                                     | Unique identifier                      |
| `goal_id`      | TEXT                     | --          | NOT NULL | FK -> `goals(id)` ON DELETE CASCADE                                    | Parent goal                            |
| `title`        | TEXT                     | --          | NOT NULL | --                                                                     | Step title                             |
| `description`  | TEXT                     | --          | Yes      | --                                                                     | Detailed description                   |
| `status`       | TEXT                     | `'pending'` | NOT NULL | CHECK IN (`pending`, `in_progress`, `completed`, `blocked`, `skipped`) | Current state                          |
| `order_num`    | INTEGER                  | --          | NOT NULL | --                                                                     | Execution order (0-based)              |
| `dependencies` | JSONB                    | `'[]'`      | Yes      | --                                                                     | Array of step IDs this step depends on |
| `result`       | TEXT                     | --          | Yes      | --                                                                     | Outcome of the step                    |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                     | Creation time                          |
| `completed_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                     | Completion time                        |

**Indexes:**

- `idx_goal_steps_goal` on `(goal_id)`
- `idx_goal_steps_status` on `(status)`

---

### 5.4 `triggers`

Proactive automation triggers. The AI can create and manage triggers that fire on schedules, events, conditions, or webhooks.

| Column        | Type                     | Default     | Nullable | Constraint                                             | Description                                                                   |
| ------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `id`          | TEXT                     | --          | PK       | --                                                     | Unique identifier                                                             |
| `user_id`     | TEXT                     | `'default'` | NOT NULL | --                                                     | Owner                                                                         |
| `name`        | TEXT                     | --          | NOT NULL | --                                                     | Trigger name                                                                  |
| `description` | TEXT                     | --          | Yes      | --                                                     | Description                                                                   |
| `type`        | TEXT                     | --          | NOT NULL | CHECK IN (`schedule`, `event`, `condition`, `webhook`) | Trigger type                                                                  |
| `config`      | JSONB                    | `'{}'`      | NOT NULL | --                                                     | Type-specific configuration (cron, event name, condition logic, webhook path) |
| `action`      | JSONB                    | `'{}'`      | NOT NULL | --                                                     | What happens when the trigger fires (tool calls, messages, plans)             |
| `enabled`     | BOOLEAN                  | `TRUE`      | NOT NULL | --                                                     | Whether the trigger is active                                                 |
| `priority`    | INTEGER                  | `5`         | NOT NULL | CHECK >= 1 AND <= 10                                   | Priority level                                                                |
| `last_fired`  | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                     | Last execution time                                                           |
| `next_fire`   | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                     | Scheduled next execution                                                      |
| `fire_count`  | INTEGER                  | `0`         | NOT NULL | --                                                     | Total times fired                                                             |
| `created_at`  | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                     | Creation time                                                                 |
| `updated_at`  | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                     | Last update time                                                              |

**Indexes:**

- `idx_triggers_user` on `(user_id)`
- `idx_triggers_type` on `(type)`
- `idx_triggers_enabled` on `(enabled)`
- `idx_triggers_next_fire` on `(next_fire)`

**Relationships:**

- Has many `trigger_history` (cascade delete).
- Referenced by `plans.trigger_id` (set null on delete).

**AI Tools (TRIGGER_TOOLS):**
Available via the gateway tools layer for creating, listing, enabling/disabling, and deleting triggers.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/triggers` | List triggers |
| `POST` | `/api/v1/triggers` | Create a trigger |
| `GET` | `/api/v1/triggers/:id` | Get trigger with history |
| `PATCH` | `/api/v1/triggers/:id` | Update a trigger |
| `DELETE` | `/api/v1/triggers/:id` | Delete a trigger |

---

### 5.5 `trigger_history`

Execution log for triggers. Each row records a single firing of a trigger and its outcome.

| Column        | Type                     | Default | Nullable | Constraint                                 | Description                        |
| ------------- | ------------------------ | ------- | -------- | ------------------------------------------ | ---------------------------------- |
| `id`          | TEXT                     | --      | PK       | --                                         | Unique identifier                  |
| `trigger_id`  | TEXT                     | --      | NOT NULL | FK -> `triggers(id)` ON DELETE CASCADE     | Parent trigger                     |
| `fired_at`    | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | --                                         | When the trigger fired             |
| `status`      | TEXT                     | --      | NOT NULL | CHECK IN (`success`, `failure`, `skipped`) | Outcome                            |
| `result`      | JSONB                    | --      | Yes      | --                                         | Result data                        |
| `error`       | TEXT                     | --      | Yes      | --                                         | Error message if failed            |
| `duration_ms` | INTEGER                  | --      | Yes      | --                                         | Execution duration in milliseconds |

**Indexes:**

- `idx_trigger_history_trigger` on `(trigger_id)`
- `idx_trigger_history_fired` on `(fired_at DESC)`

---

### 5.6 `plans`

Autonomous multi-step plan execution. Plans are sequences of steps the AI executes to achieve a goal, with retry logic, checkpoints, and configurable autonomy levels.

| Column           | Type                     | Default     | Nullable | Constraint                                                                    | Description                                              |
| ---------------- | ------------------------ | ----------- | -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `id`             | TEXT                     | --          | PK       | --                                                                            | Unique identifier                                        |
| `user_id`        | TEXT                     | `'default'` | NOT NULL | --                                                                            | Owner                                                    |
| `name`           | TEXT                     | --          | NOT NULL | --                                                                            | Plan name                                                |
| `description`    | TEXT                     | --          | Yes      | --                                                                            | Description                                              |
| `goal`           | TEXT                     | --          | NOT NULL | --                                                                            | Natural language goal statement                          |
| `status`         | TEXT                     | `'pending'` | NOT NULL | CHECK IN (`pending`, `running`, `paused`, `completed`, `failed`, `cancelled`) | Plan lifecycle state                                     |
| `current_step`   | INTEGER                  | `0`         | NOT NULL | --                                                                            | Index of the currently executing step                    |
| `total_steps`    | INTEGER                  | `0`         | NOT NULL | --                                                                            | Total number of steps                                    |
| `progress`       | REAL                     | `0`         | NOT NULL | CHECK >= 0 AND <= 100                                                         | Completion percentage                                    |
| `priority`       | INTEGER                  | `5`         | NOT NULL | CHECK >= 1 AND <= 10                                                          | Priority level                                           |
| `source`         | TEXT                     | --          | Yes      | --                                                                            | What created the plan (e.g., `user`, `trigger`, `goal`)  |
| `source_id`      | TEXT                     | --          | Yes      | --                                                                            | ID of the source entity                                  |
| `trigger_id`     | TEXT                     | --          | Yes      | FK -> `triggers(id)` ON DELETE SET NULL                                       | Trigger that created this plan                           |
| `goal_id`        | TEXT                     | --          | Yes      | FK -> `goals(id)` ON DELETE SET NULL                                          | Goal this plan works toward                              |
| `autonomy_level` | INTEGER                  | `1`         | NOT NULL | CHECK >= 0 AND <= 4                                                           | How independently the AI can act (0=manual, 4=full auto) |
| `max_retries`    | INTEGER                  | `3`         | NOT NULL | --                                                                            | Maximum retry attempts per step                          |
| `retry_count`    | INTEGER                  | `0`         | NOT NULL | --                                                                            | Current retry count for the plan                         |
| `timeout_ms`     | INTEGER                  | --          | Yes      | --                                                                            | Global timeout in milliseconds                           |
| `checkpoint`     | JSONB                    | --          | Yes      | --                                                                            | Serialized checkpoint for resuming                       |
| `error`          | TEXT                     | --          | Yes      | --                                                                            | Last error message                                       |
| `created_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                            | Creation time                                            |
| `updated_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                            | Last update time                                         |
| `started_at`     | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                            | When execution began                                     |
| `completed_at`   | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                            | When the plan finished                                   |
| `metadata`       | JSONB                    | `'{}'`      | Yes      | --                                                                            | Extensible metadata                                      |

**Autonomy levels:**
| Level | Name | Behavior |
|-------|------|----------|
| 0 | Manual | User must approve every step |
| 1 | Suggest | AI suggests actions, user approves |
| 2 | Act & Report | AI acts, reports results |
| 3 | Act & Flag | AI acts, flags issues only |
| 4 | Full Auto | AI executes without intervention |

**Indexes:**

- `idx_plans_user` on `(user_id)`
- `idx_plans_status` on `(status)`
- `idx_plans_priority` on `(priority DESC)`
- `idx_plans_goal` on `(goal_id)`
- `idx_plans_trigger` on `(trigger_id)`

**AI Tools (PLAN_TOOLS):**
Available via the gateway tools layer for creating, running, pausing, resuming, and cancelling plans.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/plans` | List plans |
| `POST` | `/api/v1/plans` | Create a plan |
| `GET` | `/api/v1/plans/:id` | Get plan with steps and history |
| `PATCH` | `/api/v1/plans/:id` | Update a plan |
| `DELETE` | `/api/v1/plans/:id` | Delete a plan |

---

### 5.7 `plan_steps`

Individual steps within a plan. Steps support multiple types including tool calls, LLM decisions, user input gates, conditions, parallel execution, loops, and sub-plans.

| Column         | Type                     | Default     | Nullable | Constraint                                                                                        | Description                            |
| -------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `id`           | TEXT                     | --          | PK       | --                                                                                                | Unique identifier                      |
| `plan_id`      | TEXT                     | --          | NOT NULL | FK -> `plans(id)` ON DELETE CASCADE                                                               | Parent plan                            |
| `order_num`    | INTEGER                  | --          | NOT NULL | --                                                                                                | Execution order                        |
| `type`         | TEXT                     | --          | NOT NULL | CHECK IN (`tool_call`, `llm_decision`, `user_input`, `condition`, `parallel`, `loop`, `sub_plan`) | Step type                              |
| `name`         | TEXT                     | --          | NOT NULL | --                                                                                                | Step name                              |
| `description`  | TEXT                     | --          | Yes      | --                                                                                                | Description                            |
| `config`       | JSONB                    | `'{}'`      | NOT NULL | --                                                                                                | Type-specific configuration            |
| `status`       | TEXT                     | `'pending'` | NOT NULL | CHECK IN (`pending`, `running`, `completed`, `failed`, `skipped`, `blocked`, `waiting`)           | Current state                          |
| `dependencies` | JSONB                    | `'[]'`      | Yes      | --                                                                                                | Array of step IDs this step depends on |
| `result`       | JSONB                    | --          | Yes      | --                                                                                                | Step execution result                  |
| `error`        | TEXT                     | --          | Yes      | --                                                                                                | Error message if failed                |
| `retry_count`  | INTEGER                  | `0`         | NOT NULL | --                                                                                                | Retries attempted                      |
| `max_retries`  | INTEGER                  | `3`         | NOT NULL | --                                                                                                | Maximum retries                        |
| `timeout_ms`   | INTEGER                  | --          | Yes      | --                                                                                                | Step-level timeout                     |
| `started_at`   | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                                                | Execution start                        |
| `completed_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                                                | Execution end                          |
| `duration_ms`  | INTEGER                  | --          | Yes      | --                                                                                                | Execution duration                     |
| `on_success`   | JSONB                    | --          | Yes      | --                                                                                                | Action to take on success              |
| `on_failure`   | JSONB                    | --          | Yes      | --                                                                                                | Action to take on failure              |
| `metadata`     | JSONB                    | `'{}'`      | Yes      | --                                                                                                | Extensible metadata                    |

**Indexes:**

- `idx_plan_steps_plan` on `(plan_id)`
- `idx_plan_steps_status` on `(status)`
- `idx_plan_steps_order` on `(plan_id, order_num)`

---

### 5.8 `plan_history`

Audit log of plan execution events.

| Column       | Type                     | Default | Nullable | Constraint                                                                                                                                   | Description                  |
| ------------ | ------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `id`         | TEXT                     | --      | PK       | --                                                                                                                                           | Unique identifier            |
| `plan_id`    | TEXT                     | --      | NOT NULL | FK -> `plans(id)` ON DELETE CASCADE                                                                                                          | Parent plan                  |
| `step_id`    | TEXT                     | --      | Yes      | FK -> `plan_steps(id)` ON DELETE SET NULL                                                                                                    | Related step (if applicable) |
| `event_type` | TEXT                     | --      | NOT NULL | CHECK IN (`started`, `step_started`, `step_completed`, `step_failed`, `paused`, `resumed`, `completed`, `failed`, `cancelled`, `checkpoint`) | Event type                   |
| `details`    | JSONB                    | `'{}'`  | Yes      | --                                                                                                                                           | Event details                |
| `created_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | --                                                                                                                                           | Event timestamp              |

**Indexes:**

- `idx_plan_history_plan` on `(plan_id)`
- `idx_plan_history_created` on `(created_at DESC)`

---

## 6. Custom Tools & Data

User-defined and AI-generated extensibility.

### 6.1 `custom_tools`

User-created or LLM-generated tools that extend the AI's capabilities at runtime.

| Column              | Type                     | Default     | Nullable | Constraint                                                      | Description                                  |
| ------------------- | ------------------------ | ----------- | -------- | --------------------------------------------------------------- | -------------------------------------------- |
| `id`                | TEXT                     | --          | PK       | --                                                              | Unique identifier                            |
| `user_id`           | TEXT                     | `'default'` | NOT NULL | UNIQUE(user_id, name)                                           | Owner                                        |
| `name`              | TEXT                     | --          | NOT NULL | --                                                              | Tool function name (must be unique per user) |
| `description`       | TEXT                     | --          | NOT NULL | --                                                              | Description shown to the AI                  |
| `parameters`        | JSONB                    | `'{}'`      | NOT NULL | --                                                              | JSON Schema for tool parameters              |
| `code`              | TEXT                     | --          | NOT NULL | --                                                              | JavaScript source code                       |
| `category`          | TEXT                     | --          | Yes      | --                                                              | Tool category                                |
| `status`            | TEXT                     | `'active'`  | NOT NULL | CHECK IN (`active`, `disabled`, `pending_approval`, `rejected`) | Tool status                                  |
| `permissions`       | JSONB                    | `'[]'`      | NOT NULL | --                                                              | Required permissions                         |
| `requires_approval` | BOOLEAN                  | `FALSE`     | NOT NULL | --                                                              | Whether execution needs user approval        |
| `created_by`        | TEXT                     | `'user'`    | NOT NULL | CHECK IN (`user`, `llm`)                                        | Who created the tool                         |
| `version`           | INTEGER                  | `1`         | NOT NULL | --                                                              | Version number                               |
| `metadata`          | JSONB                    | `'{}'`      | Yes      | --                                                              | Extensible metadata                          |
| `usage_count`       | INTEGER                  | `0`         | NOT NULL | --                                                              | Times executed                               |
| `last_used_at`      | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                              | Last execution time                          |
| `required_api_keys` | JSONB                    | `'[]'`      | Yes      | --                                                              | API keys needed for this tool                |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                              | Creation time                                |
| `updated_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                              | Last update time                             |

**Indexes:**

- `idx_custom_tools_user` on `(user_id)`
- `idx_custom_tools_name` on `(user_id, name)`
- `idx_custom_tools_status` on `(status)`
- `idx_custom_tools_created_by` on `(created_by)`
- `idx_custom_tools_category` on `(category)`

**API Routes:**
Managed through `/api/v1/custom-tools` endpoints.

---

### 6.2 `custom_data`

Generic key-value store for AI-created dynamic data. Allows the AI to persist arbitrary structured data.

| Column       | Type                     | Default     | Constraint                     | Description       |
| ------------ | ------------------------ | ----------- | ------------------------------ | ----------------- |
| `id`         | TEXT                     | --          | PK                             | Unique identifier |
| `user_id`    | TEXT                     | `'default'` | NOT NULL, UNIQUE(user_id, key) | Owner             |
| `key`        | TEXT                     | --          | NOT NULL                       | Data key          |
| `value`      | JSONB                    | --          | NOT NULL                       | Stored JSON value |
| `metadata`   | JSONB                    | `'{}'`      | --                             | Metadata          |
| `created_at` | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL                       | Creation time     |
| `updated_at` | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL                       | Last update time  |

**AI Tools (CUSTOM_DATA_TOOLS):**
| Tool Name | Description |
|-----------|-------------|
| `store_data` | Store a key-value pair |
| `retrieve_data` | Retrieve data by key |
| `list_data_keys` | List all stored keys |
| `delete_data` | Delete a key-value pair |

---

### 6.3 `custom_table_schemas` and `custom_data_records`

AI-managed dynamic schemas. The AI can create new "virtual tables" with custom column definitions and store records in them.

**`custom_table_schemas`:**
| Column | Type | Default | Constraint | Description |
|--------|------|---------|------------|-------------|
| `id` | TEXT | -- | PK | Unique identifier |
| `name` | TEXT | -- | NOT NULL, UNIQUE | Table name |
| `display_name` | TEXT | -- | NOT NULL | Human-readable name |
| `description` | TEXT | -- | Yes | Description |
| `columns` | JSONB | `'[]'` | NOT NULL | Array of column definitions |
| `created_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | Creation time |
| `updated_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | Last update time |

**`custom_data_records`:**
| Column | Type | Default | Constraint | Description |
|--------|------|---------|------------|-------------|
| `id` | TEXT | -- | PK | Unique identifier |
| `table_id` | TEXT | -- | NOT NULL, FK -> `custom_table_schemas(id)` ON DELETE CASCADE | Parent table |
| `data` | JSONB | `'{}'` | NOT NULL | Row data as JSON |
| `created_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | Creation time |
| `updated_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | Last update time |

---

## 7. Cost Tracking

### 7.1 `costs`

Tracks the monetary cost of every AI API call. Costs are computed using per-model pricing tables and linked back to conversations.

| Column            | Type                     | Default | Nullable | Description                                  |
| ----------------- | ------------------------ | ------- | -------- | -------------------------------------------- |
| `id`              | TEXT                     | --      | PK       | Unique identifier                            |
| `provider`        | TEXT                     | --      | NOT NULL | AI provider (e.g., `openai`, `anthropic`)    |
| `model`           | TEXT                     | --      | NOT NULL | Model identifier                             |
| `conversation_id` | TEXT                     | --      | Yes      | FK -> `conversations(id)` ON DELETE SET NULL |
| `input_tokens`    | INTEGER                  | `0`     | NOT NULL | Tokens in the prompt                         |
| `output_tokens`   | INTEGER                  | `0`     | NOT NULL | Tokens in the response                       |
| `total_tokens`    | INTEGER                  | `0`     | NOT NULL | Sum of input + output tokens                 |
| `input_cost`      | DOUBLE PRECISION         | `0`     | NOT NULL | Dollar cost of input tokens                  |
| `output_cost`     | DOUBLE PRECISION         | `0`     | NOT NULL | Dollar cost of output tokens                 |
| `total_cost`      | DOUBLE PRECISION         | `0`     | NOT NULL | Total dollar cost                            |
| `created_at`      | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | When the cost was recorded                   |

**Indexes:**

- `idx_costs_provider` on `(provider)`
- `idx_costs_created` on `(created_at)`
- `idx_costs_conversation` on `(conversation_id)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/costs` | Get cost data with period filters |
| `GET` | `/api/v1/costs/summary` | Cost summary by provider and model |
| `GET` | `/api/v1/costs/budget` | Budget status and remaining balance |

---

## 8. Request Logs

### 8.1 `request_logs`

Full request/response logging for debugging, auditing, and performance analysis.

| Column            | Type                     | Default     | Nullable | Constraint                                                             | Description                      |
| ----------------- | ------------------------ | ----------- | -------- | ---------------------------------------------------------------------- | -------------------------------- |
| `id`              | TEXT                     | --          | PK       | --                                                                     | Unique identifier                |
| `user_id`         | TEXT                     | `'default'` | NOT NULL | --                                                                     | User who made the request        |
| `conversation_id` | TEXT                     | --          | Yes      | FK -> `conversations(id)` ON DELETE SET NULL                           | Related conversation             |
| `type`            | TEXT                     | --          | NOT NULL | CHECK IN (`chat`, `completion`, `embedding`, `tool`, `agent`, `other`) | Request type                     |
| `provider`        | TEXT                     | --          | Yes      | --                                                                     | AI provider                      |
| `model`           | TEXT                     | --          | Yes      | --                                                                     | Model used                       |
| `endpoint`        | TEXT                     | --          | Yes      | --                                                                     | API endpoint called              |
| `method`          | TEXT                     | `'POST'`    | NOT NULL | --                                                                     | HTTP method                      |
| `request_body`    | JSONB                    | --          | Yes      | --                                                                     | Full request payload             |
| `response_body`   | JSONB                    | --          | Yes      | --                                                                     | Full response payload            |
| `status_code`     | INTEGER                  | --          | Yes      | --                                                                     | HTTP status code                 |
| `input_tokens`    | INTEGER                  | --          | Yes      | --                                                                     | Tokens consumed                  |
| `output_tokens`   | INTEGER                  | --          | Yes      | --                                                                     | Tokens generated                 |
| `total_tokens`    | INTEGER                  | --          | Yes      | --                                                                     | Total tokens                     |
| `duration_ms`     | INTEGER                  | --          | Yes      | --                                                                     | Request duration in milliseconds |
| `error`           | TEXT                     | --          | Yes      | --                                                                     | Error message                    |
| `error_stack`     | TEXT                     | --          | Yes      | --                                                                     | Error stack trace                |
| `ip_address`      | TEXT                     | --          | Yes      | --                                                                     | Client IP address                |
| `user_agent`      | TEXT                     | --          | Yes      | --                                                                     | Client user agent                |
| `created_at`      | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                     | Log timestamp                    |

**Indexes:**

- `idx_request_logs_user` on `(user_id)`
- `idx_request_logs_conversation` on `(conversation_id)`
- `idx_request_logs_type` on `(type)`
- `idx_request_logs_created` on `(created_at DESC)`
- `idx_request_logs_error` on `(error)`

**API Routes:**
Accessed through the debug routes for development and troubleshooting.

---

## 9. Channels

Multi-channel messaging infrastructure for integrating with external platforms.

### 9.1 `channels`

Registered messaging channels (Telegram).

| Column             | Type                     | Default          | Nullable | Description                     |
| ------------------ | ------------------------ | ---------------- | -------- | ------------------------------- |
| `id`               | TEXT                     | --               | PK       | Unique identifier               |
| `type`             | TEXT                     | --               | NOT NULL | Channel type (e.g., `telegram`) |
| `name`             | TEXT                     | --               | NOT NULL | Display name                    |
| `status`           | TEXT                     | `'disconnected'` | NOT NULL | Connection status               |
| `config`           | JSONB                    | `'{}'`           | NOT NULL | Channel-specific configuration  |
| `created_at`       | TIMESTAMP WITH TIME ZONE | `NOW()`          | NOT NULL | Registration time               |
| `connected_at`     | TIMESTAMP WITH TIME ZONE | --               | Yes      | Last successful connection      |
| `last_activity_at` | TIMESTAMP WITH TIME ZONE | --               | Yes      | Last message activity           |

**AI Tools (CHANNEL_TOOLS):**
Available for listing channels, sending messages, and managing channel state.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/channels` | List channels |
| `POST` | `/api/v1/channels` | Register a channel |
| `GET` | `/api/v1/channels/:id` | Get channel details |
| `DELETE` | `/api/v1/channels/:id` | Remove a channel |

---

### 9.2 `channel_messages`

Messages flowing through channels in both directions.

| Column         | Type                     | Default  | Nullable | Constraint                             | Description                         |
| -------------- | ------------------------ | -------- | -------- | -------------------------------------- | ----------------------------------- |
| `id`           | TEXT                     | --       | PK       | --                                     | Unique identifier                   |
| `channel_id`   | TEXT                     | --       | NOT NULL | FK -> `channels(id)` ON DELETE CASCADE | Parent channel                      |
| `external_id`  | TEXT                     | --       | Yes      | --                                     | Message ID in the external platform |
| `direction`    | TEXT                     | --       | NOT NULL | CHECK IN (`inbound`, `outbound`)       | Message direction                   |
| `sender_id`    | TEXT                     | --       | Yes      | --                                     | Sender identifier                   |
| `sender_name`  | TEXT                     | --       | Yes      | --                                     | Sender display name                 |
| `content`      | TEXT                     | --       | NOT NULL | --                                     | Message content                     |
| `content_type` | TEXT                     | `'text'` | NOT NULL | --                                     | Content type (text, image, etc.)    |
| `attachments`  | JSONB                    | --       | Yes      | --                                     | Array of attachment objects         |
| `reply_to_id`  | TEXT                     | --       | Yes      | --                                     | ID of the message being replied to  |
| `metadata`     | JSONB                    | `'{}'`   | Yes      | --                                     | Extensible metadata                 |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`  | NOT NULL | --                                     | Message timestamp                   |

**Indexes:**

- `idx_channel_messages_channel` on `(channel_id)`
- `idx_channel_messages_created` on `(created_at)`

---

## 10. Settings

### 10.1 `settings`

Simple key-value store for application configuration. Used for API keys, default provider/model selection, UI preferences, and more.

| Column       | Type                     | Default | Description                                                                |
| ------------ | ------------------------ | ------- | -------------------------------------------------------------------------- |
| `key`        | TEXT                     | --      | PK. Setting key (e.g., `api_key:openai`, `default_ai_provider`)            |
| `value`      | TEXT                     | --      | NOT NULL. Setting value (stored as string; encrypted for sensitive values) |
| `updated_at` | TIMESTAMP WITH TIME ZONE | `NOW()` | Last modification time                                                     |

**Key conventions:**

- `api_key:<provider>` -- API key for a provider (e.g., `api_key:openai`, `api_key:anthropic`).
- `default_ai_provider` -- Default AI provider ID.
- `default_ai_model` -- Default AI model ID.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/settings` | Get all settings (keys masked) |
| `POST` | `/api/v1/settings/api-keys/:provider` | Set an API key |
| `DELETE` | `/api/v1/settings/api-keys/:provider` | Remove an API key |

---

## 11. Agents

### 11.1 `agents`

Configured AI agent profiles with custom system prompts and model selection.

| Column          | Type                     | Default | Nullable         | Description                                              |
| --------------- | ------------------------ | ------- | ---------------- | -------------------------------------------------------- |
| `id`            | TEXT                     | --      | PK               | Unique identifier                                        |
| `name`          | TEXT                     | --      | NOT NULL, UNIQUE | Agent name                                               |
| `system_prompt` | TEXT                     | --      | Yes              | Custom system prompt                                     |
| `provider`      | TEXT                     | --      | NOT NULL         | AI provider                                              |
| `model`         | TEXT                     | --      | NOT NULL         | Model identifier                                         |
| `config`        | JSONB                    | `'{}'`  | NOT NULL         | Additional configuration (temperature, max_tokens, etc.) |
| `created_at`    | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL         | Creation time                                            |
| `updated_at`    | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL         | Last update time                                         |

**Relationships:**

- Referenced by `conversations.agent_id`.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/agents` | List agents |
| `POST` | `/api/v1/agents` | Create an agent |
| `GET` | `/api/v1/agents/:id` | Get agent details |
| `PATCH` | `/api/v1/agents/:id` | Update an agent |
| `DELETE` | `/api/v1/agents/:id` | Delete an agent |

---

## 12. Media & OAuth

### 12.1 `oauth_integrations`

OAuth2 tokens for external service integrations (Gmail, Google Calendar, Google Drive, etc.). Tokens are stored encrypted.

| Column                    | Type                     | Default     | Nullable | Constraint                                         | Description                                           |
| ------------------------- | ------------------------ | ----------- | -------- | -------------------------------------------------- | ----------------------------------------------------- |
| `id`                      | TEXT                     | --          | PK       | --                                                 | Unique identifier                                     |
| `user_id`                 | TEXT                     | `'default'` | NOT NULL | UNIQUE(user_id, provider, service)                 | Owner                                                 |
| `provider`                | TEXT                     | --          | NOT NULL | --                                                 | OAuth provider (e.g., `google`)                       |
| `service`                 | TEXT                     | --          | NOT NULL | --                                                 | Specific service (e.g., `gmail`, `calendar`, `drive`) |
| `access_token_encrypted`  | TEXT                     | --          | NOT NULL | --                                                 | AES-encrypted access token                            |
| `refresh_token_encrypted` | TEXT                     | --          | Yes      | --                                                 | AES-encrypted refresh token                           |
| `token_iv`                | TEXT                     | --          | NOT NULL | --                                                 | Initialization vector for decryption                  |
| `expires_at`              | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                 | Token expiration time                                 |
| `scopes`                  | JSONB                    | `'[]'`      | NOT NULL | --                                                 | Granted OAuth scopes                                  |
| `email`                   | TEXT                     | --          | Yes      | --                                                 | Associated email address                              |
| `status`                  | TEXT                     | `'active'`  | NOT NULL | CHECK IN (`active`, `expired`, `revoked`, `error`) | Integration status                                    |
| `last_sync_at`            | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                 | Last successful sync                                  |
| `error_message`           | TEXT                     | --          | Yes      | --                                                 | Last error message                                    |
| `created_at`              | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                 | Creation time                                         |
| `updated_at`              | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                 | Last update time                                      |

**Indexes:**

- `idx_oauth_integrations_user` on `(user_id)`
- `idx_oauth_integrations_provider` on `(user_id, provider)`
- `idx_oauth_integrations_service` on `(user_id, provider, service)`
- `idx_oauth_integrations_status` on `(status)`

**API Routes:**
Managed through `/api/v1/integrations` endpoints for connecting, disconnecting, and refreshing OAuth integrations.

---

### 12.2 `media_provider_settings`

Per-user, per-capability media provider selection. Allows different providers for image generation, vision, text-to-speech, speech-to-text, and weather.

| Column       | Type                     | Default     | Nullable | Constraint                                                       | Description                           |
| ------------ | ------------------------ | ----------- | -------- | ---------------------------------------------------------------- | ------------------------------------- |
| `id`         | TEXT                     | --          | PK       | --                                                               | Unique identifier                     |
| `user_id`    | TEXT                     | `'default'` | NOT NULL | UNIQUE(user_id, capability)                                      | Owner                                 |
| `capability` | TEXT                     | --          | NOT NULL | CHECK IN (`image_generation`, `vision`, `tts`, `stt`, `weather`) | Media capability                      |
| `provider`   | TEXT                     | --          | NOT NULL | --                                                               | Selected provider for this capability |
| `model`      | TEXT                     | --          | Yes      | --                                                               | Selected model (optional)             |
| `config`     | JSONB                    | `'{}'`      | Yes      | --                                                               | Additional configuration              |
| `created_at` | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                               | Creation time                         |
| `updated_at` | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                               | Last update time                      |

**Indexes:**

- `idx_media_provider_settings_user` on `(user_id)`
- `idx_media_provider_settings_capability` on `(user_id, capability)`

**API Routes:**
Managed through `/api/v1/media-settings` endpoints.

---

## 13. AI Models

Configuration layer for AI model and provider management. Overrides and extends the built-in model catalog.

### 13.1 `user_model_configs`

User-specific model configuration overrides. These survive data syncs from external model catalogs (models.dev).

| Column           | Type                     | Default     | Nullable | Constraint                             | Description                                                   |
| ---------------- | ------------------------ | ----------- | -------- | -------------------------------------- | ------------------------------------------------------------- |
| `id`             | TEXT                     | --          | PK       | --                                     | Unique identifier                                             |
| `user_id`        | TEXT                     | `'default'` | NOT NULL | UNIQUE(user_id, provider_id, model_id) | Owner                                                         |
| `provider_id`    | TEXT                     | --          | NOT NULL | --                                     | Provider identifier                                           |
| `model_id`       | TEXT                     | --          | NOT NULL | --                                     | Model identifier                                              |
| `display_name`   | TEXT                     | --          | Yes      | --                                     | Custom display name                                           |
| `capabilities`   | JSONB                    | `'[]'`      | NOT NULL | --                                     | Array of capability strings (e.g., `chat`, `vision`, `tools`) |
| `pricing_input`  | REAL                     | --          | Yes      | --                                     | Custom input token price per 1M tokens                        |
| `pricing_output` | REAL                     | --          | Yes      | --                                     | Custom output token price per 1M tokens                       |
| `context_window` | INTEGER                  | --          | Yes      | --                                     | Context window size override                                  |
| `max_output`     | INTEGER                  | --          | Yes      | --                                     | Max output tokens override                                    |
| `is_enabled`     | BOOLEAN                  | `TRUE`      | NOT NULL | --                                     | Whether the model is enabled                                  |
| `is_custom`      | BOOLEAN                  | `FALSE`     | NOT NULL | --                                     | Whether this is a user-added model (not in the catalog)       |
| `config`         | JSONB                    | `'{}'`      | Yes      | --                                     | Additional model config                                       |
| `created_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                     | Creation time                                                 |
| `updated_at`     | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                     | Last update time                                              |

**Indexes:**

- `idx_user_model_configs_user` on `(user_id)`
- `idx_user_model_configs_provider` on `(user_id, provider_id)`
- `idx_user_model_configs_enabled` on `(is_enabled)`

**API Routes:**
Managed through `/api/v1/model-configs` endpoints.

---

### 13.2 `custom_providers`

User-registered custom AI providers (aggregators like fal.ai, together.ai, or custom OpenAI-compatible endpoints).

| Column            | Type                     | Default               | Nullable | Constraint                               | Description                    |
| ----------------- | ------------------------ | --------------------- | -------- | ---------------------------------------- | ------------------------------ |
| `id`              | TEXT                     | --                    | PK       | --                                       | Unique identifier              |
| `user_id`         | TEXT                     | `'default'`           | NOT NULL | UNIQUE(user_id, provider_id)             | Owner                          |
| `provider_id`     | TEXT                     | --                    | NOT NULL | --                                       | Unique provider identifier     |
| `display_name`    | TEXT                     | --                    | NOT NULL | --                                       | Human-readable name            |
| `api_base_url`    | TEXT                     | --                    | Yes      | --                                       | Base URL for API calls         |
| `api_key_setting` | TEXT                     | --                    | Yes      | --                                       | Settings key for the API key   |
| `provider_type`   | TEXT                     | `'openai_compatible'` | NOT NULL | CHECK IN (`openai_compatible`, `custom`) | Provider compatibility type    |
| `is_enabled`      | BOOLEAN                  | `TRUE`                | NOT NULL | --                                       | Whether the provider is active |
| `config`          | JSONB                    | `'{}'`                | Yes      | --                                       | Additional config              |
| `created_at`      | TIMESTAMP WITH TIME ZONE | `NOW()`               | NOT NULL | --                                       | Creation time                  |
| `updated_at`      | TIMESTAMP WITH TIME ZONE | `NOW()`               | NOT NULL | --                                       | Last update time               |

**Indexes:**

- `idx_custom_providers_user` on `(user_id)`
- `idx_custom_providers_enabled` on `(is_enabled)`

---

### 13.3 `user_provider_configs`

User overrides for built-in providers. These let users change base URLs, add notes, or disable providers without affecting the default catalog.

| Column          | Type                     | Default     | Nullable | Constraint                   | Description                               |
| --------------- | ------------------------ | ----------- | -------- | ---------------------------- | ----------------------------------------- |
| `id`            | TEXT                     | --          | PK       | --                           | Unique identifier                         |
| `user_id`       | TEXT                     | `'default'` | NOT NULL | UNIQUE(user_id, provider_id) | Owner                                     |
| `provider_id`   | TEXT                     | --          | NOT NULL | --                           | Provider identifier                       |
| `base_url`      | TEXT                     | --          | Yes      | --                           | Custom base URL override                  |
| `provider_type` | TEXT                     | --          | Yes      | --                           | Provider type override                    |
| `is_enabled`    | BOOLEAN                  | `TRUE`      | NOT NULL | --                           | Whether the provider is enabled           |
| `api_key_env`   | TEXT                     | --          | Yes      | --                           | Environment variable name for the API key |
| `notes`         | TEXT                     | --          | Yes      | --                           | User notes                                |
| `config`        | JSONB                    | `'{}'`      | Yes      | --                           | Additional config                         |
| `created_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                           | Creation time                             |
| `updated_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                           | Last update time                          |

**Indexes:**

- `idx_user_provider_configs_user` on `(user_id)`
- `idx_user_provider_configs_provider` on `(user_id, provider_id)`
- `idx_user_provider_configs_enabled` on `(is_enabled)`

**API Routes:**
Model and provider configurations are managed through `/api/v1/model-configs` and `/api/v1/providers` endpoints.

---

## 14. Workspace Isolation

Sandboxed execution environments for running user code safely in Docker containers.

### 14.1 `user_workspaces`

Isolated workspace environments per user with Docker container management.

| Column             | Type                     | Default     | Nullable | Constraint                                                       | Description                    |
| ------------------ | ------------------------ | ----------- | -------- | ---------------------------------------------------------------- | ------------------------------ |
| `id`               | TEXT                     | --          | PK       | --                                                               | Unique identifier              |
| `user_id`          | TEXT                     | --          | NOT NULL | --                                                               | Owner                          |
| `name`             | TEXT                     | --          | NOT NULL | --                                                               | Workspace name                 |
| `description`      | TEXT                     | --          | Yes      | --                                                               | Description                    |
| `status`           | TEXT                     | `'active'`  | NOT NULL | CHECK IN (`active`, `suspended`, `deleted`)                      | Workspace status               |
| `storage_path`     | TEXT                     | --          | NOT NULL | --                                                               | Local filesystem storage path  |
| `container_config` | JSONB                    | `'{}'`      | NOT NULL | --                                                               | Docker container configuration |
| `container_id`     | TEXT                     | --          | Yes      | --                                                               | Active Docker container ID     |
| `container_status` | TEXT                     | `'stopped'` | NOT NULL | CHECK IN (`stopped`, `starting`, `running`, `stopping`, `error`) | Container lifecycle state      |
| `created_at`       | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                               | Creation time                  |
| `updated_at`       | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                               | Last update time               |
| `last_activity_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                               | Last activity timestamp        |

**Indexes:**

- `idx_user_workspaces_user` on `(user_id)`
- `idx_user_workspaces_status` on `(status)`

**Relationships:**

- Has many `user_containers` (cascade delete).
- Has many `code_executions` (cascade delete).

**API Routes:**
Managed through `/api/v1/workspaces` endpoints.

---

### 14.2 `user_containers`

Active Docker containers within workspaces. Tracks resource usage and network policy.

| Column              | Type                     | Default      | Nullable         | Constraint                                                       | Description             |
| ------------------- | ------------------------ | ------------ | ---------------- | ---------------------------------------------------------------- | ----------------------- |
| `id`                | TEXT                     | --           | PK               | --                                                               | Unique identifier       |
| `workspace_id`      | TEXT                     | --           | NOT NULL         | FK -> `user_workspaces(id)` ON DELETE CASCADE                    | Parent workspace        |
| `user_id`           | TEXT                     | --           | NOT NULL         | --                                                               | Owner                   |
| `container_id`      | TEXT                     | --           | NOT NULL, UNIQUE | --                                                               | Docker container ID     |
| `image`             | TEXT                     | --           | NOT NULL         | --                                                               | Docker image name       |
| `status`            | TEXT                     | `'starting'` | NOT NULL         | CHECK IN (`stopped`, `starting`, `running`, `stopping`, `error`) | Container state         |
| `memory_mb`         | INTEGER                  | `512`        | NOT NULL         | --                                                               | Memory limit in MB      |
| `cpu_cores`         | REAL                     | `0.5`        | NOT NULL         | --                                                               | CPU core allocation     |
| `network_policy`    | TEXT                     | `'none'`     | NOT NULL         | --                                                               | Network access policy   |
| `started_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`      | NOT NULL         | --                                                               | Container start time    |
| `last_activity_at`  | TIMESTAMP WITH TIME ZONE | --           | Yes              | --                                                               | Last activity           |
| `stopped_at`        | TIMESTAMP WITH TIME ZONE | --           | Yes              | --                                                               | Stop time               |
| `memory_peak_mb`    | INTEGER                  | `0`          | Yes              | --                                                               | Peak memory usage       |
| `cpu_time_ms`       | INTEGER                  | `0`          | Yes              | --                                                               | Total CPU time consumed |
| `network_bytes_in`  | INTEGER                  | `0`          | Yes              | --                                                               | Network bytes received  |
| `network_bytes_out` | INTEGER                  | `0`          | Yes              | --                                                               | Network bytes sent      |

**Indexes:**

- `idx_user_containers_workspace` on `(workspace_id)`
- `idx_user_containers_user` on `(user_id)`
- `idx_user_containers_status` on `(status)`

---

### 14.3 `code_executions`

History of code executions within workspaces.

| Column              | Type                     | Default     | Nullable | Constraint                                                                     | Description                        |
| ------------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| `id`                | TEXT                     | --          | PK       | --                                                                             | Unique identifier                  |
| `workspace_id`      | TEXT                     | --          | NOT NULL | FK -> `user_workspaces(id)` ON DELETE CASCADE                                  | Parent workspace                   |
| `user_id`           | TEXT                     | --          | NOT NULL | --                                                                             | Owner                              |
| `container_id`      | TEXT                     | --          | Yes      | --                                                                             | Docker container used              |
| `language`          | TEXT                     | --          | NOT NULL | CHECK IN (`python`, `javascript`, `shell`)                                     | Programming language               |
| `code_hash`         | TEXT                     | --          | Yes      | --                                                                             | Hash of the code for deduplication |
| `status`            | TEXT                     | `'pending'` | NOT NULL | CHECK IN (`pending`, `running`, `completed`, `failed`, `timeout`, `cancelled`) | Execution state                    |
| `stdout`            | TEXT                     | --          | Yes      | --                                                                             | Standard output                    |
| `stderr`            | TEXT                     | --          | Yes      | --                                                                             | Standard error                     |
| `exit_code`         | INTEGER                  | --          | Yes      | --                                                                             | Process exit code                  |
| `error`             | TEXT                     | --          | Yes      | --                                                                             | Error message                      |
| `execution_time_ms` | INTEGER                  | --          | Yes      | --                                                                             | Execution duration                 |
| `memory_used_mb`    | INTEGER                  | --          | Yes      | --                                                                             | Memory consumed                    |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                                             | Request time                       |
| `started_at`        | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                             | Execution start                    |
| `completed_at`      | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                                             | Execution end                      |

**Indexes:**

- `idx_code_executions_workspace` on `(workspace_id)`
- `idx_code_executions_user` on `(user_id)`
- `idx_code_executions_status` on `(status)`

---

### 14.4 `workspace_audit`

Security audit trail for all workspace operations.

| Column          | Type                     | Default | Nullable | Constraint                                                                 | Description                   |
| --------------- | ------------------------ | ------- | -------- | -------------------------------------------------------------------------- | ----------------------------- |
| `id`            | TEXT                     | --      | PK       | --                                                                         | Unique identifier             |
| `user_id`       | TEXT                     | --      | NOT NULL | --                                                                         | User who performed the action |
| `workspace_id`  | TEXT                     | --      | Yes      | --                                                                         | Affected workspace            |
| `action`        | TEXT                     | --      | NOT NULL | CHECK IN (`create`, `read`, `write`, `delete`, `execute`, `start`, `stop`) | Action type                   |
| `resource_type` | TEXT                     | --      | NOT NULL | CHECK IN (`workspace`, `file`, `container`, `execution`)                   | Resource type                 |
| `resource`      | TEXT                     | --      | Yes      | --                                                                         | Specific resource identifier  |
| `success`       | BOOLEAN                  | `TRUE`  | NOT NULL | --                                                                         | Whether the action succeeded  |
| `error`         | TEXT                     | --      | Yes      | --                                                                         | Error message if failed       |
| `ip_address`    | TEXT                     | --      | Yes      | --                                                                         | Client IP                     |
| `user_agent`    | TEXT                     | --      | Yes      | --                                                                         | Client user agent             |
| `created_at`    | TIMESTAMP WITH TIME ZONE | `NOW()` | NOT NULL | --                                                                         | Event timestamp               |

**Indexes:**

- `idx_workspace_audit_user` on `(user_id)`
- `idx_workspace_audit_workspace` on `(workspace_id)`
- `idx_workspace_audit_created` on `(created_at DESC)`

**API Routes:**
Workspace audit logs are accessible through `/api/v1/audit` endpoints.

---

## 15. Config Center

Centralized, schema-driven configuration management. Replaces the legacy `api_services` table with a more flexible system that supports multi-entry configurations and typed field schemas.

### 15.1 `config_services`

Service definitions with schema-driven configuration. Each service describes what configuration fields it needs (API keys, base URLs, custom options).

| Column          | Type                     | Default     | Nullable         | Constraint | Description                                                             |
| --------------- | ------------------------ | ----------- | ---------------- | ---------- | ----------------------------------------------------------------------- |
| `id`            | TEXT                     | --          | PK               | --         | Unique identifier                                                       |
| `name`          | TEXT                     | --          | NOT NULL, UNIQUE | --         | Service machine name (e.g., `openai`, `gmail`)                          |
| `display_name`  | TEXT                     | --          | NOT NULL         | --         | Human-readable service name                                             |
| `category`      | TEXT                     | `'general'` | NOT NULL         | --         | Service category (e.g., `ai`, `communication`, `storage`)               |
| `description`   | TEXT                     | --          | Yes              | --         | Service description                                                     |
| `docs_url`      | TEXT                     | --          | Yes              | --         | Link to documentation                                                   |
| `config_schema` | JSONB                    | `'[]'`      | NOT NULL         | --         | Array of field definitions (name, label, type, required, envVar, order) |
| `multi_entry`   | BOOLEAN                  | `FALSE`     | NOT NULL         | --         | Whether multiple config entries are allowed                             |
| `required_by`   | JSONB                    | `'[]'`      | Yes              | --         | Array of feature names that depend on this service                      |
| `is_active`     | BOOLEAN                  | `TRUE`      | NOT NULL         | --         | Whether the service is active                                           |
| `created_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL         | --         | Creation time                                                           |
| `updated_at`    | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL         | --         | Last update time                                                        |

**Config schema field types:** `string`, `secret`, `url`, `number`, `boolean`, `select`

**Indexes:**

- `idx_config_services_name` on `(name)`
- `idx_config_services_category` on `(category)`
- `idx_config_services_active` on `(is_active)`

**AI Tools (CONFIG_TOOLS):**
Available for querying and managing service configurations.

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/config-services` | List all config services |
| `POST` | `/api/v1/config-services` | Create a config service |
| `GET` | `/api/v1/config-services/:name` | Get service with entries |
| `PATCH` | `/api/v1/config-services/:name` | Update a service |
| `DELETE` | `/api/v1/config-services/:name` | Delete a service |

---

### 15.2 `config_entries`

Actual configuration values for services. Supports multiple entries per service (when `multi_entry` is true) with default selection.

| Column         | Type                     | Default     | Nullable | Constraint | Description                                                      |
| -------------- | ------------------------ | ----------- | -------- | ---------- | ---------------------------------------------------------------- |
| `id`           | TEXT                     | --          | PK       | --         | Unique identifier                                                |
| `service_name` | TEXT                     | --          | NOT NULL | --         | Service machine name                                             |
| `label`        | TEXT                     | `'Default'` | NOT NULL | --         | Entry label                                                      |
| `data`         | JSONB                    | `'{}'`      | NOT NULL | --         | Configuration data (key-value pairs matching the service schema) |
| `is_default`   | BOOLEAN                  | `FALSE`     | NOT NULL | --         | Whether this is the default entry                                |
| `is_active`    | BOOLEAN                  | `TRUE`      | NOT NULL | --         | Whether this entry is active                                     |
| `created_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --         | Creation time                                                    |
| `updated_at`   | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --         | Last update time                                                 |

**Indexes:**

- `idx_config_entries_service` on `(service_name)`
- `idx_config_entries_active` on `(is_active)`
- `idx_config_entries_default` UNIQUE on `(service_name)` WHERE `is_default = TRUE` -- enforces at most one default per service

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/config-services/:name/entries` | Create an entry |
| `PATCH` | `/api/v1/config-services/:name/entries/:id` | Update an entry |
| `DELETE` | `/api/v1/config-services/:name/entries/:id` | Delete an entry |

Secret values in responses are automatically masked (first 4 + `...` + last 4 characters shown).

---

## 16. Plugins

### 16.1 `plugins`

Plugin state persistence. Tracks installed plugins, their versions, status, settings, and granted permissions.

| Column                | Type                     | Default     | Nullable | Constraint                                | Description                                 |
| --------------------- | ------------------------ | ----------- | -------- | ----------------------------------------- | ------------------------------------------- |
| `id`                  | TEXT                     | --          | PK       | --                                        | Unique identifier                           |
| `name`                | TEXT                     | --          | NOT NULL | --                                        | Plugin name                                 |
| `version`             | TEXT                     | `'1.0.0'`   | NOT NULL | --                                        | Plugin version                              |
| `status`              | TEXT                     | `'enabled'` | NOT NULL | CHECK IN (`enabled`, `disabled`, `error`) | Plugin status                               |
| `settings`            | JSONB                    | `'{}'`      | NOT NULL | --                                        | Plugin-specific settings                    |
| `granted_permissions` | JSONB                    | `'[]'`      | NOT NULL | --                                        | Array of granted permission strings         |
| `error_message`       | TEXT                     | --          | Yes      | --                                        | Last error message (when status is `error`) |
| `installed_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                        | Installation time                           |
| `updated_at`          | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                        | Last update time                            |

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/plugins` | List plugins |
| `POST` | `/api/v1/plugins` | Install a plugin |
| `PATCH` | `/api/v1/plugins/:id` | Update plugin settings or status |
| `DELETE` | `/api/v1/plugins/:id` | Uninstall a plugin |

---

## 17. Local AI

Support for locally running AI providers (LM Studio, Ollama, LocalAI, vLLM, or custom OpenAI-compatible servers).

### 17.1 `local_providers`

Registered local AI provider instances.

| Column               | Type                     | Default     | Nullable | Constraint                                                   | Description                                     |
| -------------------- | ------------------------ | ----------- | -------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `id`                 | TEXT                     | --          | PK       | --                                                           | Unique identifier                               |
| `user_id`            | TEXT                     | `'default'` | NOT NULL | --                                                           | Owner                                           |
| `name`               | TEXT                     | --          | NOT NULL | --                                                           | Display name                                    |
| `provider_type`      | TEXT                     | --          | NOT NULL | CHECK IN (`lmstudio`, `ollama`, `localai`, `vllm`, `custom`) | Provider software type                          |
| `base_url`           | TEXT                     | --          | NOT NULL | --                                                           | API base URL (e.g., `http://localhost:1234/v1`) |
| `api_key`            | TEXT                     | --          | Yes      | --                                                           | API key (if required)                           |
| `is_enabled`         | BOOLEAN                  | `TRUE`      | NOT NULL | --                                                           | Whether the provider is active                  |
| `is_default`         | BOOLEAN                  | `FALSE`     | NOT NULL | --                                                           | Whether this is the default local provider      |
| `discovery_endpoint` | TEXT                     | --          | Yes      | --                                                           | Endpoint for auto-discovering available models  |
| `last_discovered_at` | TIMESTAMP WITH TIME ZONE | --          | Yes      | --                                                           | Last model discovery time                       |
| `metadata`           | JSONB                    | `'{}'`      | Yes      | --                                                           | Extensible metadata                             |
| `created_at`         | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                           | Registration time                               |
| `updated_at`         | TIMESTAMP WITH TIME ZONE | `NOW()`     | NOT NULL | --                                                           | Last update time                                |

**Indexes:**

- `idx_local_providers_user` on `(user_id)`
- `idx_local_providers_enabled` on `(is_enabled)`
- `idx_local_providers_default` on `(is_default)`

**API Routes:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/local-providers` | List local providers |
| `POST` | `/api/v1/local-providers` | Register a local provider |
| `PATCH` | `/api/v1/local-providers/:id` | Update provider config |
| `DELETE` | `/api/v1/local-providers/:id` | Remove a provider |
| `POST` | `/api/v1/local-providers/:id/discover` | Trigger model discovery |

---

### 17.2 `local_models`

Models available from local providers. Discovered automatically or added manually.

| Column              | Type                     | Default                   | Nullable | Constraint                                    | Description                                    |
| ------------------- | ------------------------ | ------------------------- | -------- | --------------------------------------------- | ---------------------------------------------- |
| `id`                | TEXT                     | --                        | PK       | --                                            | Unique identifier                              |
| `user_id`           | TEXT                     | `'default'`               | NOT NULL | UNIQUE(user_id, local_provider_id, model_id)  | Owner                                          |
| `local_provider_id` | TEXT                     | --                        | NOT NULL | FK -> `local_providers(id)` ON DELETE CASCADE | Parent local provider                          |
| `model_id`          | TEXT                     | --                        | NOT NULL | --                                            | Model identifier (as reported by the provider) |
| `display_name`      | TEXT                     | --                        | NOT NULL | --                                            | Human-readable name                            |
| `capabilities`      | JSONB                    | `'["chat", "streaming"]'` | NOT NULL | --                                            | Array of capabilities                          |
| `context_window`    | INTEGER                  | `32768`                   | Yes      | --                                            | Context window size                            |
| `max_output`        | INTEGER                  | `4096`                    | Yes      | --                                            | Max output tokens                              |
| `is_enabled`        | BOOLEAN                  | `TRUE`                    | NOT NULL | --                                            | Whether the model is selectable                |
| `metadata`          | JSONB                    | `'{}'`                    | Yes      | --                                            | Extensible metadata                            |
| `created_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`                   | NOT NULL | --                                            | Discovery/creation time                        |
| `updated_at`        | TIMESTAMP WITH TIME ZONE | `NOW()`                   | NOT NULL | --                                            | Last update time                               |

**Indexes:**

- `idx_local_models_provider` on `(local_provider_id)`
- `idx_local_models_enabled` on `(is_enabled)`

---

## Schema Source Files

The authoritative schema definitions live in:

- **SQL migration:** `packages/gateway/src/db/migrations/postgres/001_initial_schema.sql`
- **TypeScript schema + migrations:** `packages/gateway/src/db/schema.ts`

The `schema.ts` file contains three SQL blocks:

1. `SCHEMA_SQL` -- Table creation statements.
2. `MIGRATIONS_SQL` -- Idempotent ALTER TABLE statements for schema evolution.
3. `INDEXES_SQL` -- All index creation statements.

Schema initialization runs automatically at startup via the `initializeSchema()` function, which executes all three blocks in order.

---

## Common Patterns

### ID Generation

All IDs are TEXT primary keys generated as UUIDs or prefixed strings (e.g., `exp_<timestamp>_<random>` for expenses).

### Timestamps

All tables use `TIMESTAMP WITH TIME ZONE` (or `TIMESTAMP` in the TypeScript schema variant). The `created_at` and `updated_at` columns are present on virtually every table and default to `NOW()`.

### User Scoping

Almost all user-facing tables include a `user_id TEXT NOT NULL DEFAULT 'default'` column. In single-user deployments, this defaults to `'default'`. In multi-user deployments, it provides per-user data isolation.

### JSONB Columns

Arrays (tags, dependencies, scopes) use `JSONB DEFAULT '[]'`. Objects (config, metadata, social_links) use `JSONB DEFAULT '{}'`. This provides flexibility while keeping the schema simple.

### Soft State via CHECK Constraints

Enumerated states (status, type, role, priority) are enforced via `CHECK` constraints directly in the database, preventing invalid state transitions at the storage level.

### Cascade Behavior

- Child records (messages, goal_steps, plan_steps, etc.) use `ON DELETE CASCADE` to automatically clean up when the parent is deleted.
- Cross-reference columns (costs.conversation_id, request_logs.conversation_id) use `ON DELETE SET NULL` to preserve the child record while nullifying the broken reference.
