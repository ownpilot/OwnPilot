import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const CREATE_NOTE = `POST /api/v1/notes
Content-Type: application/json

{
  "title": "Meeting notes",
  "content": "Discussed Q1 roadmap...",
  "tags": ["work", "planning"],
  "pinned": false
}`;

const CREATE_TASK = `POST /api/v1/tasks
Content-Type: application/json

{
  "title": "Review pull request #42",
  "priority": "high",
  "dueDate": "2026-03-20T17:00:00Z",
  "tags": ["dev"],
  "recurrence": "none"
}`;

const CREATE_GOAL = `POST /api/v1/goals
Content-Type: application/json

{
  "title": "Run a 5K",
  "description": "Train and complete a 5K race",
  "category": "health",
  "targetDate": "2026-06-01",
  "milestones": [
    { "title": "Run 1K without stopping", "targetDate": "2026-04-01" },
    { "title": "Complete a 3K", "targetDate": "2026-05-01" }
  ]
}`;

const CREATE_CONTACT = `POST /api/v1/contacts
Content-Type: application/json

{
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "phone": "+1-555-0100",
  "company": "Acme Corp",
  "tags": ["work", "client"],
  "notes": "Met at PyCon 2025"
}`;

const CREATE_CALENDAR = `POST /api/v1/calendar
Content-Type: application/json

{
  "title": "Team standup",
  "startTime": "2026-03-17T09:00:00Z",
  "endTime": "2026-03-17T09:30:00Z",
  "recurrence": "weekly",
  "location": "Video call",
  "description": "Daily sync"
}`;

const CREATE_MEMORY = `POST /api/v1/memories
Content-Type: application/json

{
  "content": "Alice prefers email over Slack for async communication",
  "category": "preferences",
  "tags": ["alice", "communication"],
  "importance": 0.8
}`;

const CREATE_EXPENSE = `POST /api/v1/expenses
Content-Type: application/json

{
  "amount": 42.50,
  "currency": "USD",
  "category": "food",
  "description": "Lunch with team",
  "date": "2026-03-16",
  "tags": ["business"]
}`;

const CREATE_BOOKMARK = `POST /api/v1/bookmarks
Content-Type: application/json

{
  "url": "https://hono.dev/",
  "title": "Hono - Fast, Lightweight, Web-Standards",
  "description": "Ultrafast web framework for the Edges",
  "tags": ["dev", "web", "framework"],
  "folder": "Libraries"
}`;

const TOOL_EXAMPLES = `# Notes
core.create_note      — Create a note with title, content, tags
core.search_notes     — Semantic + keyword search
core.list_notes       — List with filter/sort
core.update_note      — Update existing note
core.delete_note      — Delete note

# Tasks
core.create_task      — Create task with priority, due date, recurrence
core.list_tasks       — Filter by status, priority, tags
core.complete_task    — Mark as done
core.update_task      — Edit task fields

# Goals
core.create_goal      — Goal with milestones and target date
core.list_goals       — List active/completed goals
core.update_goal      — Update progress
core.add_milestone    — Add milestone to goal

# Memories
core.remember         — Store a memory with importance score
core.recall           — Semantic recall (vector similarity)
core.search_memories  — Keyword + semantic search

# Calendar
core.create_event     — Create calendar event
core.list_events      — List in date range
core.get_upcoming     — Next N events

# Contacts
core.create_contact   — Add contact
core.search_contacts  — Search by name/email/company
core.list_contacts    — Paginated list with filters

# Bookmarks
core.create_bookmark  — Save URL with metadata
core.search_bookmarks — Semantic + tag search

# Expenses
core.log_expense      — Record expense
core.get_expenses     — Filter by date/category
core.expense_summary  — Category totals, monthly rollup

# Habits
core.log_habit        — Log habit completion
core.get_habit_stats  — Streak, completion rate

# Pomodoro
core.start_pomodoro   — Start a 25-minute focus session
core.get_pomodoro_stats — Daily/weekly session counts

# Custom Data
core.store_data       — Store arbitrary JSON under a key
core.retrieve_data    — Retrieve by key
core.list_data_keys   — List all stored keys`;

export function PersonalDataPage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Personal Data
      </Badge>
      <h1>Personal Data</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot provides a complete personal data management system — notes, tasks, goals,
        calendar, contacts, memories, bookmarks, expenses, habits, and custom data — all stored
        locally in your PostgreSQL database and accessible via REST API and 50+ LLM tools.
      </p>

      <Callout type="tip" title="Privacy guarantee">
        All personal data lives exclusively in your self-hosted PostgreSQL instance. No personal
        data is ever sent to third-party services. Sensitive fields use AES-256-GCM encryption.
      </Callout>

      <h2>Data types overview</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>API Route</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Notes</td>
            <td>
              <code>/api/v1/notes</code>
            </td>
            <td>Rich text notes with tags and pinning</td>
          </tr>
          <tr>
            <td>Tasks</td>
            <td>
              <code>/api/v1/tasks</code>
            </td>
            <td>Tasks with priority, due dates, recurrence</td>
          </tr>
          <tr>
            <td>Goals</td>
            <td>
              <code>/api/v1/goals</code>
            </td>
            <td>Long-term goals with milestones</td>
          </tr>
          <tr>
            <td>Calendar</td>
            <td>
              <code>/api/v1/calendar</code>
            </td>
            <td>Events with recurrence rules</td>
          </tr>
          <tr>
            <td>Contacts</td>
            <td>
              <code>/api/v1/contacts</code>
            </td>
            <td>People with email, phone, company</td>
          </tr>
          <tr>
            <td>Memories</td>
            <td>
              <code>/api/v1/memories</code>
            </td>
            <td>AI memories with vector similarity search</td>
          </tr>
          <tr>
            <td>Bookmarks</td>
            <td>
              <code>/api/v1/bookmarks</code>
            </td>
            <td>URLs with metadata and folders</td>
          </tr>
          <tr>
            <td>Expenses</td>
            <td>
              <code>/api/v1/expenses</code>
            </td>
            <td>Expense tracking with categories</td>
          </tr>
          <tr>
            <td>Habits</td>
            <td>
              <code>/api/v1/habits</code>
            </td>
            <td>Habit tracking with streak calculation</td>
          </tr>
          <tr>
            <td>Custom Data</td>
            <td>
              <code>/api/v1/data</code>
            </td>
            <td>Arbitrary JSON key-value store</td>
          </tr>
          <tr>
            <td>Personal Data</td>
            <td>
              <code>/api/v1/personal-data</code>
            </td>
            <td>Profile, preferences, health data</td>
          </tr>
        </tbody>
      </table>

      <h2>Notes</h2>
      <p>
        Notes support rich text content, tags, pinning, and semantic full-text search powered by
        PostgreSQL full-text search and pgvector embeddings.
      </p>
      <CodeBlock code={CREATE_NOTE} language="http" filename="create-note.http" />

      <h3>Notes API endpoints</h3>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Endpoint</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/notes</code>
            </td>
            <td>List notes (paginated, filterable)</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/notes</code>
            </td>
            <td>Create note</td>
          </tr>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/notes/:id</code>
            </td>
            <td>Get single note</td>
          </tr>
          <tr>
            <td>
              <code>PUT</code>
            </td>
            <td>
              <code>/api/v1/notes/:id</code>
            </td>
            <td>Update note</td>
          </tr>
          <tr>
            <td>
              <code>DELETE</code>
            </td>
            <td>
              <code>/api/v1/notes/:id</code>
            </td>
            <td>Delete note</td>
          </tr>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/notes/search?q=</code>
            </td>
            <td>Semantic search</td>
          </tr>
        </tbody>
      </table>

      <h2>Tasks</h2>
      <p>
        Tasks support priorities (low/medium/high/urgent), due dates, recurrence rules, status
        tracking, and sub-task relationships.
      </p>
      <CodeBlock code={CREATE_TASK} language="http" filename="create-task.http" />

      <h3>Task status values</h3>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pending</code>
            </td>
            <td>Not yet started</td>
          </tr>
          <tr>
            <td>
              <code>in_progress</code>
            </td>
            <td>Currently being worked on</td>
          </tr>
          <tr>
            <td>
              <code>completed</code>
            </td>
            <td>Done</td>
          </tr>
          <tr>
            <td>
              <code>cancelled</code>
            </td>
            <td>Will not be done</td>
          </tr>
        </tbody>
      </table>

      <h2>Goals</h2>
      <p>
        Goals support milestone tracking, categories, target dates, and progress updates. The agent
        can automatically track progress and send reminders.
      </p>
      <CodeBlock code={CREATE_GOAL} language="http" filename="create-goal.http" />

      <h2>Calendar</h2>
      <p>
        Calendar events support recurrence rules, location, attendees, and reminders. Recurrence
        values: <code>none</code>, <code>daily</code>, <code>weekly</code>,<code>monthly</code>,{' '}
        <code>yearly</code>.
      </p>
      <CodeBlock code={CREATE_CALENDAR} language="http" filename="create-event.http" />

      <h2>Contacts</h2>
      <p>
        Contacts store people with name, email, phone, company, social links, notes, and custom
        tags. Full-text search across all fields.
      </p>
      <CodeBlock code={CREATE_CONTACT} language="http" filename="create-contact.http" />

      <h2>Memory System</h2>
      <p>
        The memory system uses pgvector for semantic similarity search. When the agent encounters
        new information it should remember, it stores it with an embedding. Future queries
        semantically recall relevant memories.
      </p>
      <CodeBlock code={CREATE_MEMORY} language="http" filename="create-memory.http" />

      <Callout type="info" title="Vector similarity search">
        Memories are retrieved using cosine similarity on 1536-dimension embeddings. The agent
        automatically injects the top-K most relevant memories into its context at the start of each
        conversation.
      </Callout>

      <h2>Bookmarks</h2>
      <p>
        Save URLs with AI-generated summaries, tags, and folder organization. Full-text and semantic
        search across titles, descriptions, and content.
      </p>
      <CodeBlock code={CREATE_BOOKMARK} language="http" filename="create-bookmark.http" />

      <h2>Expenses</h2>
      <p>
        Track personal and business expenses with categories, currencies, and tags. The agent can
        generate expense summaries, category breakdowns, and monthly reports.
      </p>
      <CodeBlock code={CREATE_EXPENSE} language="http" filename="create-expense.http" />

      <h3>Expense categories</h3>
      <p>
        Predefined categories: <code>food</code>, <code>transport</code>, <code>housing</code>,
        <code>health</code>, <code>entertainment</code>, <code>shopping</code>,
        <code>utilities</code>, <code>education</code>, <code>business</code>, <code>other</code>.
      </p>

      <h2>Habits</h2>
      <p>
        Track daily, weekly, or custom-schedule habits. The system calculates streaks, completion
        rates, and best periods. The agent can send habit reminders and celebrate milestones.
      </p>

      <h2>Pomodoro Timer</h2>
      <p>
        Built-in Pomodoro technique support with 25-minute focus sessions, 5-minute breaks, and long
        break intervals. Session data is stored and statistics are available to the agent.
      </p>

      <h2>Custom Data</h2>
      <p>
        The custom data store allows you (or the agent) to persist arbitrary JSON data under named
        keys. Useful for storing structured personal data that doesn't fit other categories.
      </p>
      <CodeBlock
        code={`# Store custom data via API
POST /api/v1/data
{
  "key": "fitness_goals_2026",
  "value": {
    "weightTarget": 75,
    "currentWeight": 82,
    "weeksRemaining": 24
  }
}

# Retrieve
GET /api/v1/data/fitness_goals_2026`}
        language="http"
      />

      <h2>All LLM tool names</h2>
      <p>
        The agent accesses personal data through these built-in tool names (all prefixed with{' '}
        <code>core.</code> in the namespace system):
      </p>
      <CodeBlock code={TOOL_EXAMPLES} language="text" filename="personal-data-tools" />

      <Callout type="note" title="Tool access via meta-proxy">
        In conversations, the agent discovers and calls these tools through the meta-tool proxy (
        <code>search_tools</code> → <code>get_tool_help</code> → <code>use_tool</code>). You can
        also call any tool directly via <code>POST /api/v1/tools/execute</code>.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/tools"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Tool System
        </Link>
        <Link
          to="/docs/channels"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Channels
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
