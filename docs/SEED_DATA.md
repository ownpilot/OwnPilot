# Seed Data Guide

Populate a fresh OwnPilot instance with demo data so every major UI section has
something to explore.

## Quick Start

```bash
# Prerequisites: dev environment running
docker compose -f docker-compose.dev.yml --profile postgres up -d

# Run the seed script
./tests/seed-demo.sh

# Custom API URL
API_URL=http://localhost:9090 ./tests/seed-demo.sh
```

The script is idempotent for memories (deduped by content) but will create
duplicate agents, workflows, goals, etc. on repeated runs. Reset the database
if you need a clean slate:

```bash
docker compose -f docker-compose.dev.yml down -v   # destroys volumes
docker compose -f docker-compose.dev.yml --profile postgres up -d
# Wait for migrations, then:
./tests/seed-demo.sh
```

## What Gets Created

| Entity | Count | UI Location | Description |
|--------|-------|-------------|-------------|
| Agents | 3 | **System** > Agents | Research Agent, Code Assistant, Creative Writer — each with a distinct system prompt and tool set |
| Goals | 3 | **AI & Automation** > Goals | Hierarchical goals with priorities and due dates |
| Memories | 5 | **AI & Automation** > Memories | Facts, preferences, skills, and events the assistant remembers |
| Triggers | 3 | **AI & Automation** > Triggers | Schedule (morning summary, weekly digest) and condition (error watchdog) |
| Plans | 2 | **AI & Automation** > Plans | Multi-phase project plans with deadlines |
| Workflows | 3 | **AI & Automation** > Workflows | Visual DAG workflows you can open in the editor |
| HITL Requests | 3 | **AI & Automation** > Approvals | Pending human-in-the-loop approval requests |
| Knowledge Graph | 3 ingestions + 2 collections | **Experimental** > Knowledge Graph | Entities extracted from text, grouped into collections |
| Workflow Hooks | 3 | Workflow Editor > **Hooks** tab | Logging, webhook, and metrics hooks attached to the first workflow |

### Sidebar Navigation Map

```
Chat                          ← Start chatting (model selected in header dropdown)
Dashboard
Analytics
Channels
Conversations

Personal Data >
  Tasks, Notes, Calendar, Contacts, Bookmarks, Expenses, Habits, Pomodoro

AI & Automation >
  Memories ✓, Goals ✓, Plans ✓, Triggers ✓, Workflows ✓,
  Autonomous Agents, Artifacts, Approvals ✓, Autonomy

Tools & Extensions >
  Tools, Custom Tools, Skills Hub, Plugins

System >
  Agents ✓, Models, Wizards, Workspaces, Custom Data, Data Browser,
  Costs, Logs, Event Monitor

Experimental >
  Claws, Fleet Command, Edge Devices, Coding Agents, Orchestration

Settings                      ← AI Models, Model Routing, Local Providers
```

Items marked with **✓** contain seed data.

## Entity Details

### Agents

| Name | Purpose | Tools |
|------|---------|-------|
| Research Agent | Web research and summarization | `core.web_search`, `core.web_fetch` |
| Code Assistant | Code generation and review | `core.code_execute`, `core.file_read`, `core.file_write` |
| Creative Writer | Blog posts, stories, marketing copy | (none — pure LLM) |

To chat with an agent, go to **Chat** and select the agent and model in the
header dropdowns. Make sure you have a working model selected — the model in
the Chat header takes priority over Model Routing settings.

To configure default models: **Settings > AI Models > Model Routing**.

### Goals

Three goals with a parent-child relationship:

1. **Master OwnPilot platform** (priority 8, due May 1) — top-level goal
2. **Build content automation pipeline** (priority 6, due Apr 20) — child of #1
3. **Set up system monitoring** (priority 5, due Apr 15) — independent

### Memories

| Type | Content |
|------|---------|
| `preference` | User prefers concise responses with code examples |
| `fact` | Project tech stack (TypeScript, Hono, React, PostgreSQL) |
| `fact` | Team workflow (Docker, GitHub Actions, Turborepo) |
| `skill` | Docker networking debugging steps |
| `event` | Project kickoff date and initial deliverables |

Memories influence how the assistant responds. The `importance` field (0–1)
determines recall priority.

### Triggers

| Name | Type | Schedule | Enabled |
|------|------|----------|---------|
| Daily Morning Summary | `schedule` | `0 8 * * *` (8 AM daily) | Yes |
| Weekly Knowledge Digest | `schedule` | `0 9 * * 1` (Monday 9 AM) | Yes |
| Error Watchdog | `condition` | Checks every 5 min | No (enable manually) |

Triggers run automatically. The Error Watchdog is disabled by default — toggle
it on to test condition-based triggers.

### Plans

| Name | Deadline | Phases |
|------|----------|--------|
| Content Automation Pipeline | May 15 | RSS fetch → LLM summarization → Graph RAG → HITL digest |
| System Health Monitoring | Apr 30 | Health checks → Error conditions → HITL gates → Hooks |

### Workflows

All three workflows use a **manual trigger** — open the workflow in the editor
and click "Run" to execute.

#### 1. Web Research Pipeline

```
[Manual Start] → [Web Search] → [LLM: Summarize] → [Output]
```

Searches the web, then summarizes results with an LLM node.

#### 2. Content Review with Human Approval

```
[Manual Start] → [LLM: Draft Content] → [Code: Format as Markdown] → [Output]
```

Generates a blog post draft, formats it, and outputs the result.

#### 3. Data ETL: Fetch → Transform → Store

```
[Manual Start] → [Fetch API] → [Code: Transform] → [LLM: Report] → [Output]
```

Fetches data from JSONPlaceholder, transforms it with a code node, then
generates a data quality report.

> **Note:** LLM nodes reference `openai` / `gpt-4o` by default. If you use a
> local provider (LMStudio, Ollama), edit the workflow nodes to point to your
> configured provider and model.

### Knowledge Graph

Three text ingestions create entities and relations:

- **AI companies**: OpenAI, Anthropic, Google DeepMind, Meta, Mistral AI and
  their products (GPT-4, Claude, Gemini, LLaMA, Mixtral)
- **Project context**: OwnPilot architecture, packages, database, AI providers
- **DevOps**: Docker, Vite, tsx watch, GitHub Actions, Turborepo

Two collections organize the entities:

- **AI Research** — companies, models, technologies
- **Project Documentation** — architecture and tooling knowledge

Use the search bar in the Knowledge Graph view to query entities. Supports
three modes: `hybrid` (default), `keyword`, and `vector`.

### HITL Requests

Three pending approval requests, each simulating a different workflow scenario:

| Title | Type | Context |
|-------|------|---------|
| Production Deployment v0.3.3 | `approve_reject` | 43 tests passed, 4 new endpoints, 2 bug fixes |
| Blog Post Review | `approve_reject` | 850-word auto-generated post |
| API Budget Alert | `approve_reject` | $45 of $50 monthly budget used |

Open **Approvals** in the sidebar, click a request, and approve or reject it.

### Workflow Hooks

Three hooks attached to the first seeded workflow:

| Hook Type | Event | Purpose |
|-----------|-------|---------|
| `logging` | `on_complete` | Log execution output and timings |
| `webhook` | `on_error` | POST to external URL on failure |
| `metrics` | `on_complete` | Track duration and token usage |

Open a workflow in the editor and switch to the **Hooks** tab to view them.

## Customization

### Adding More Seed Data

Edit `tests/seed-demo.sh` directly. The `post` helper function handles
requests:

```bash
post "Label for output" "/api/v1/endpoint" '{"json":"body"}'
```

It expects HTTP 201 by default. Pass a fourth argument to accept a different
status code:

```bash
post "Ingest text" "/api/v1/knowledge-graph/ingest-text" '{"text":"..."}' 200
```

### API Reference for Seeded Entities

| Entity | Create | List | Detail |
|--------|--------|------|--------|
| Agents | `POST /api/v1/agents` | `GET /api/v1/agents` | `GET /api/v1/agents/:id` |
| Goals | `POST /api/v1/goals` | `GET /api/v1/goals` | `GET /api/v1/goals/:id` |
| Memories | `POST /api/v1/memories` | `GET /api/v1/memories` | `GET /api/v1/memories/:id` |
| Triggers | `POST /api/v1/triggers` | `GET /api/v1/triggers` | `GET /api/v1/triggers/:id` |
| Plans | `POST /api/v1/plans` | `GET /api/v1/plans` | `GET /api/v1/plans/:id` |
| Workflows | `POST /api/v1/workflows` | `GET /api/v1/workflows` | `GET /api/v1/workflows/:id` |
| KG Ingest | `POST /api/v1/knowledge-graph/ingest-text` | — | — |
| KG Entities | — | `GET /api/v1/knowledge-graph/entities` | `GET /api/v1/knowledge-graph/entities/:id` |
| KG Collections | `POST /api/v1/knowledge-graph/collections` | `GET /api/v1/knowledge-graph/collections` | — |
| KG Search | — | `GET /api/v1/knowledge-graph/search?q=...` | — |
| HITL Requests | `POST /api/v1/hitl/requests` | `GET /api/v1/hitl/requests/pending` | `GET /api/v1/hitl/requests/:id` |
| Workflow Hooks | `POST /api/v1/workflow-hooks/:wfId` | `GET /api/v1/workflow-hooks/:wfId` | — |

### Required Fields Quick Reference

**Agent:** `name`, `systemPrompt`

**Goal:** `title`; optional: `description`, `status`, `priority` (0–10), `dueDate`

**Memory:** `type` (`fact` | `preference` | `skill` | `event` | `conversation`), `content`; optional: `importance` (0–1)

**Trigger:** `name`, `type` (`schedule` | `event` | `condition` | `webhook`), `config`, `action`

**Plan:** `name`, `goal`; optional: `description`, `deadline`

**Workflow:** `name`, `nodes[]`, `edges[]`
- LLM node `data` requires: `provider`, `model`, `userMessage`
- Condition node `data` requires: `expression`
- Tool node `data` requires: `toolName`

**HITL Request:** `workflowLogId`, `nodeId`, `interactionType` (`approve_reject` | `approve_modify_reject`), `mode` (`blocking` | `non_blocking`)

**Workflow Hook:** `hookType` (`logging` | `webhook` | `metrics` | `notification` | `custom`), `event`, `enabled`, `config`

**KG Ingest:** `text`; optional: `agentId`, `sourceId`

**KG Collection:** `name`; optional: `description`, `agentId`
