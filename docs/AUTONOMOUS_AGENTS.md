# Autonomous Agents (Soul Agents) - Comprehensive Documentation

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [What is a Soul?](#what-is-a-soul)
3. [Heartbeat System](#heartbeat-system)
4. [Crew System](#crew-system)
5. [Communication & Messaging](#communication--messaging)
6. [Budget & Limits](#budget--limits)
7. [Evolution System](#evolution-system)
8. [Database Schema](#database-schema)
9. [Lifecycle](#lifecycle)
10. [FAQ](#faq)

---

## Core Concepts

### Why "Autonomous"?

The key difference from regular agents: **They can work automatically at scheduled intervals without user prompts.**

| Feature                         | Regular Agent      | Soul Agent (Autonomous)                        |
| ------------------------------- | ------------------ | ---------------------------------------------- |
| Trigger                         | User sends message | Automatic based on schedule                    |
| Schedule                        | None               | Cron schedule (hourly, daily, etc.)            |
| Identity                        | Just a name        | Detailed personality (emoji, boundaries, role) |
| Budget Control                  | None               | Daily/monthly spending limits                  |
| Communication with other agents | None               | Inbox/broadcast system                         |

---

## What is a Soul?

**Soul = Persistent identity and configuration of an agent**

A soul contains:

### 1. Identity

```typescript
{
  name: "Radar",           // Display name
  emoji: "📡",            // Visual identifier
  role: "Market Researcher", // Role description
  personality: "Systematic, curious...", // Personality traits
  voice: {
    tone: "analytical",   // Communication tone
    language: "en",       // Preferred language
    quirks: ["Uses radar metaphors"] // Unique characteristics
  },
  boundaries: [           // Hard limits
    "Do not invest based on findings",
    "Clearly label speculation vs facts"
  ]
}
```

**Why important?** This info is injected into EVERY prompt. The agent always behaves with this identity.

### 2. Purpose

```typescript
{
  mission: "Scan Product Hunt for emerging products",
  goals: [
    "Daily scan of Product Hunt",
    "Weekly brief on market opportunities"
  ],
  expertise: ["market research", "tech trends"],
  toolPreferences: ["search_web", "read_url"]
}
```

**Why important?** Tells the agent what to do. Tool preferences affect search_tools results.

### 3. Autonomy

```typescript
{
  level: 3,  // 0-4 scale
  allowedActions: ["search_web", "create_note"],
  blockedActions: ["delete_data", "execute_code"],
  requiresApproval: ["send_message_to_user"],
  maxCostPerDay: 5.0,      // Daily $5 limit
  maxCostPerMonth: 100.0,  // Monthly $100 limit
  pauseOnConsecutiveErrors: 5  // Pause after 5 errors
}
```

**Why important?** Security and budget control. Works with restricted permissions.

### 4. Heartbeat

```typescript
{
  enabled: true,
  interval: "0 8,13,18 * * *",  // 3 times daily (8:00, 13:00, 18:00)
  checklist: [  // Tasks to run on each wake
    {
      id: "radar-scan",
      name: "Market scan",
      description: "Scan Product Hunt...",
      schedule: "every",  // Run every time
      tools: ["search_web"],
      outputTo: { type: "inbox", agentId: "Spark" },
      priority: "high",
      stalenessHours: 8  // Force run if older than 8 hours
    }
  ],
  quietHours: {  // No work during these hours
    start: "23:00",
    end: "07:00",
    timezone: "Europe/Istanbul"
  }
}
```

**Why important?** Determines when the agent wakes up and what it does.

### 5. Relationships

```typescript
{
  reportsTo: "user",      // Who to report to
  delegates: [],          // Who to delegate tasks to
  peers: ["Spark"],       // Peer-level agents
  channels: ["telegram"], // Active channels
  crewId: "crew-123"      // Crew membership
}
```

**Why important?** Defines communication and hierarchy within a crew.

### 6. Evolution

```typescript
{
  version: 1,                    // Soul version
  evolutionMode: "supervised",   // manual | supervised | autonomous
  coreTraits: ["analytical"],    // Immutable traits
  mutableTraits: [],             // Learnable traits
  learnings: [],                 // Experience-based insights
  feedbackLog: []                // User feedback history
}
```

**Why important?** Can evolve over time based on user feedback.

### 7. Boot Sequence

```typescript
{
  onStart: [],           // On first start
  onHeartbeat: ["read_inbox"],  // Every wake
  onMessage: []          // When message received
}
```

---

## Heartbeat System

### What is a Heartbeat?

**An agent "waking up" at scheduled intervals to perform tasks.**

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    HEARTBEAT FLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. CRON TRIGGER (Scheduler)                                │
│     └── "0 8,13,18 * * *" (Daily at 8, 13, 18:00)          │
│                                                             │
│  2. TRIGGER FIRES                                           │
│     └── action: { type: "run_heartbeat", agentId: "..." }   │
│                                                             │
│  3. HEARTBEAT RUNNER EXECUTES                               │
│     ├── Check quiet hours (skip if 23:00-07:00)            │
│     ├── Check budget (skip if daily limit exceeded)        │
│     └── Filter tasks (which should run now?)               │
│                                                             │
│  4. FOR EACH TASK:                                          │
│     ├── Run Agent Engine (LLM prompt)                      │
│     ├── Allow tool usage                                    │
│     └── Route output to outputTo destination               │
│                                                             │
│  5. SAVE RESULTS                                            │
│     ├── Write to heartbeat_log table                       │
│     ├── Record cost in budget_tracker                      │
│     └── Emit "heartbeat.completed" event                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Task Schedule Types

| Schedule    | Description                   | Example              |
| ----------- | ----------------------------- | -------------------- |
| `every`     | Run every heartbeat           | Every 4 hours        |
| `daily`     | Once per day at specific time | dailyAt: "09:00"     |
| `weekly`    | Once per week on specific day | weeklyOn: 1 (Monday) |
| `condition` | When condition is met         | Future feature       |

### Staleness Check

If a task is older than X hours, it's **forced to run** regardless of schedule.

```typescript
stalenessHours: 8; // Force run if older than 8 hours
```

**Example:** Radar wakes every 4 hours but "weekly brief" runs once a week. If it's stale (>8h), it runs on next wake.

---

## Crew System

### What is a Crew?

**A group of agents that work together and communicate with each other.**

### Why Use Crews?

| Single Agent            | Crew (Multiple Agents)        |
| ----------------------- | ----------------------------- |
| Single task focused     | Complex workflows             |
| Unaware of other agents | Can use each other's findings |
| One-person orchestra    | Specialized roles             |

### Coordination Patterns

#### 1. Hub-Spoke

```
    [Chief]
    /   |   \
[Agent1] [Agent2] [Agent3]

// Chief coordinates, others report
// Example: Personal Operations Crew
```

#### 2. Peer-to-Peer

```
[Radar] <---> [Spark]

// Direct messaging between peers
// Example: Research Crew (Radar sends findings, Spark analyzes)
```

#### 3. Pipeline

```
[Scout] -> [Ghost] -> [Publisher]

// Data flow chain
// Example: Content Crew (Research -> Write -> Publish)
```

#### 4. Hierarchical

```
    [Manager]
    /       \
[Lead1]   [Lead2]
  / \        / \
[W1][W2]  [W3][W4]

// Chain of command
// Example: DevOps Crew
```

### Crew Creation Flow

```
1. User selects template (e.g., "research")
   ↓
2. Crew record created (agent_crews table)
   ↓
3. For each agent:
   a. Create agent record (agents table)
   b. Create soul record (agent_souls table)
   c. Create crew member record (agent_crew_members)
   d. Create heartbeat trigger (triggers table)
   ↓
4. Relationships resolved (names -> IDs)
```

---

## Communication & Messaging

### Communication Types

#### 1. Inbox (Direct Message)

```typescript
// Radar -> Spark message
{
  from: "agent-radar-123",
  to: "agent-spark-456",
  type: "task_result",
  subject: "[Heartbeat] Market scan",
  content: "Found 3 new AI products on Product Hunt...",
  priority: "normal",
  requiresResponse: false
}
```

**When to use?** When one agent needs to send information to a specific other agent.

#### 2. Broadcast (Announcement)

```typescript
// Announce to entire crew
{
  from: "agent-chief-789",
  type: "knowledge_share",
  subject: "[Chief] Morning briefing",
  content: "3 tasks completed today...",
  priority: "normal",
  requiresResponse: false
}
```

**When to use?** When sharing information with the whole team at once.

#### 3. Memory (Shared Knowledge)

```typescript
// Save research result
await agentEngine.saveMemory(agentId, output, 'heartbeat');
```

**When to use?** For permanent information that other agents can access later.

### outputTo Destinations

| Destination | Description              | Use Case          |
| ----------- | ------------------------ | ----------------- |
| `memory`    | Save to permanent memory | Research findings |
| `inbox`     | Message another agent    | Radar -> Spark    |
| `channel`   | Send to Telegram, etc.   | User notification |
| `note`      | Save to notes system     | Generate report   |
| `broadcast` | Announce to entire crew  | Team update       |
| `task`      | Add to task list         | Create new task   |
| `artifact`  | Add to dashboard         | Visual report     |

---

## Budget & Limits

### Cost Tracking

Every heartbeat's cost is calculated:

```typescript
{
  inputTokens: 1500,   // Tokens in prompt
  outputTokens: 800,   // Tokens in response
  cost: 0.023          // Calculated cost ($)
}
```

### Budget Exceeded Scenario

```
1. Agent reaches daily $5 limit
   ↓
2. Subsequent tasks marked "skipped"
   ↓
3. If pauseOnBudgetExceeded: true:
   └── Heartbeat disabled
   ↓
4. If notifyUserOnPause: true:
   └── Telegram notification sent:
       "Radar 📡 paused — daily budget ($5) exceeded."
   ↓
5. User must manually resume
```

### Error Handling

```typescript
pauseOnConsecutiveErrors: 5

// After 5 consecutive errors:
1. Heartbeat automatically paused
2. User notification sent
3. Manual intervention required
```

---

## Evolution System

### Soul Versioning

Version increments on each change:

```typescript
// Version 1 (Initial)
evolution: { version: 1, ... }

// After user feedback
// Version 2 (Updated)
evolution: { version: 2, ... }
```

Versions stored in `agent_soul_versions` table.

### Evolution Modes

| Mode         | Description                  |
| ------------ | ---------------------------- |
| `manual`     | Only user updates manually   |
| `supervised` | AI suggests, user approves   |
| `autonomous` | AI updates itself (careful!) |

### Learnings

Agent learns from experience:

```typescript
learnings: [
  'User prefers concise summaries over detailed reports',
  "Web searches for 'AI trends' often return irrelevant results",
  'Morning heartbeats get better engagement than evening',
];
```

These learnings are added to prompts.

### Feedback Log

User feedback history:

```typescript
feedbackLog: [
  {
    type: 'praise', // praise | correction | directive | personality_tweak
    content: 'Great analysis! Include more competitor data next time.',
    appliedToVersion: 1,
  },
];
```

---

## Database Schema

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATABASE RELATIONSHIPS                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐         ┌──────────────────────┐              │
│  │  agent_crews    │◄────────┤ agent_crew_members   │────────┐     │
│  │  - id (PK)      │    1:M  │  - crew_id (FK)      │        │     │
│  │  - name         │         │  - agent_id (FK)     │        │     │
│  │  - template_id  │         │  - role              │        │     │
│  │  - status       │         └──────────────────────┘        │     │
│  └─────────────────┘                                         │     │
│                                                              │     │
│  ┌─────────────────┐         ┌──────────────────────┐       │     │
│  │     agents      │◄────────┤   agent_souls       │       │     │
│  │  - id (PK)      │    1:1  │  - id (PK)           │       │     │
│  │  - name         │         │  - agent_id (FK)     │       │     │
│  │  - provider     │         │  - identity (JSON)   │       │     │
│  │  - model        │         │  - purpose (JSON)    │       │     │
│  └─────────────────┘         │  - autonomy (JSON)   │       │     │
│                              │  - heartbeat (JSON)  │       │     │
│  ┌─────────────────┐         │  - relationships     │       │     │
│  │    triggers     │         │  - evolution (JSON)  │       │     │
│  │  - id (PK)      │         └──────────────────────┘       │     │
│  │  - name         │                                        │     │
│  │  - type         │         ┌──────────────────────┐       │     │
│  │  - config       │         │ agent_soul_versions  │       │     │
│  │  - action       │         │  - soul_id (FK)      │       │     │
│  │    (agentId)    │────────►│  - version           │       │     │
│  └─────────────────┘         │  - snapshot          │       │     │
│                              └──────────────────────┘       │     │
│                                                             │     │
│  ┌─────────────────┐         ┌──────────────────────┐      │     │
│  │ heartbeat_logs  │         │   agent_messages     │      │     │
│  │  - agent_id     │         │  (inbox/broadcast)   │◄─────┘     │
│  │  - tasks_run    │         │                      │            │
│  │  - cost         │         └──────────────────────┘            │
│  └─────────────────┘                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Lifecycle

### Full Soul Agent Lifecycle

```
┌──────────────────────────────────────────────────────────────────────┐
│                      1. DEPLOY (Creation)                            │
├──────────────────────────────────────────────────────────────────────┤
│  • Select template (research, content, personal-ops, devops)         │
│  • Create crew record                                                │
│  • For each agent:                                                   │
│    - Create agent record (agents table)                              │
│    - Create soul record (agent_souls table)                          │
│    - Create heartbeat trigger (triggers table)                       │
│  • Establish crew member relationships                               │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        2. ACTIVE (Running)                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Cron Trigger ───► Heartbeat Runner ───► Agent Engine               │
│        │                   │                  │                      │
│        │                   │                  ▼                      │
│        │                   │            LLM Prompt                   │
│        │                   │                  │                      │
│        │                   │                  ▼                      │
│        │                   │            Tool Execution               │
│        │                   │                  │                      │
│        │                   │                  ▼                      │
│        │                   │            Output Routing               │
│        │                   │            (memory/inbox/channel)       │
│        │                   │                                         │
│        │                   ▼                                         │
│        │            Log & Budget Track                               │
│        │                                                            │
│        └──► Wait for next schedule                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│     3. PAUSE (Paused)        │    │   4. DISBAND (Disbanded)     │
├──────────────────────────────┤    ├──────────────────────────────┤
│  • Heartbeat triggers        │    │  • All triggers disabled     │
│    disabled                  │    │  • Agents deactivated        │
│  • Agents remain passive     │    │  • Records preserved         │
│  • Data preserved            │    │  • Status: disbanded         │
│  • Can be resumed            │    │                              │
└──────────────────────────────┘    └──────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      5. DELETE (Permanent)                           │
├──────────────────────────────────────────────────────────────────────┤
│  • All triggers deleted                                              │
│  • Soul record deleted                                               │
│  • Agent record deleted                                              │
│  • Crew member records deleted                                       │
│  • Crew record deleted                                               │
│  ⚠️ IRREVERSIBLE!                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## FAQ

### Q: What's the difference between regular and soul agents?

**A:** Regular agents only work when users message them. Soul agents wake up automatically at scheduled intervals.

### Q: How do agents in a crew communicate?

**A:** Via the inbox system. Agent A sends a message to Agent B's inbox. Agent B reads it on next wake.

### Q: What happens when budget limit is exceeded?

**A:** Agent automatically pauses and notifies the user. Must be manually resumed.

### Q: What are quiet hours?

**A:** Hours when the agent should not work (e.g., 23:00-07:00). Heartbeats are skipped during these times.

### Q: What happens when I delete a crew?

**A:**

- **Disband**: Triggers disabled, agents remain passive, data preserved
- **Delete**: Everything permanently removed (irreversible)

### Q: Can I change an agent's personality?

**A:** Yes. Update the soul's `identity` field. Changes take effect on next heartbeat.

### Q: How many crews can I create?

**A:** No technical limit, but each crew consumes budget. Plan according to your resources.

### Q: Do agents actually "learn"?

**A:** Currently limited. `learnings` array stores notes but automatic learning is not fully implemented.

### Q: Can I change the heartbeat interval?

**A:** Yes, update the soul's `heartbeat.interval` field. Example: `"0 */6 * * *"` (every 6 hours).

### Q: Can two crews communicate with each other?

**A:** Not currently. Crews communicate internally, no inter-crew communication.

---

## Summary Table

| Concept         | Purpose                       | Example                       |
| --------------- | ----------------------------- | ----------------------------- |
| **Soul**        | Agent's identity and settings | Radar's personality, tasks    |
| **Heartbeat**   | Scheduled automatic work      | Waking every 4 hours          |
| **Crew**        | Team of agents                | Research Crew (Radar + Spark) |
| **Template**    | Pre-configured crew setup     | "research", "content"         |
| **Inbox**       | Inter-agent messaging         | Radar -> Spark findings       |
| **Budget**      | Cost control                  | Daily $5 limit                |
| **Evolution**   | Gradual improvement           | Versioning, learning          |
| **Quiet Hours** | Rest periods                  | No work 23:00-07:00           |
