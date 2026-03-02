# OwnPilot Mega Upgrade — Claude Code Implementation Guide

> **Bu dosya Claude Code'a verilecek bir implementation spec'dir.**
> Her section bağımsız çalışabilir. Öncelik sırasına göre sıralanmıştır.
> Her section'da: neden, ne, nasıl, dosya yapısı, tipler, testler ve acceptance criteria var.

---

## PROJECT CONTEXT

**Repo:** `ownpilot/OwnPilot` (GitHub)
**Language:** TypeScript 5.9 (strict, ES2023, NodeNext)
**Monorepo:** pnpm workspaces + Turborepo
**Packages:**

- `packages/core` — AI runtime, providers, tools, types, sandbox, crypto, audit, privacy, plugins, events, services
- `packages/gateway` — Hono API server, routes (37+), repositories (32+), channels, triggers, plans, middleware
- `packages/ui` — React 19 + Vite 6 + Tailwind CSS 4, 28+ pages
- `packages/channels` — Telegram, Discord, Slack adapters
- `packages/cli` — Commander.js CLI

**DB:** PostgreSQL 16+ (43+ tables)
**Key patterns:** Result<T,E>, Repository pattern, Strategy pattern, Registry pattern, EventBus/HookBus/ScopedBus, Meta-tool proxy (search_tools/get_tool_help/use_tool)
**Existing:** 170+ tools, 88+ providers, 29 agents, 5 autonomy levels, AES-256-GCM crypto, PII detection, sandboxed execution, MCP server + client (already integrated), background agents with workspace isolation, Anthropic prompt caching, context compaction, WhatsApp + Telegram + Discord + Slack channels, 43+ DB repositories, execution permissions, CLI tool auto-discovery, per-tool security policies

> **NOTE:** MCP integration (both client and server) already exists. Do NOT recreate it. The existing MCP client consumes external MCP servers and the MCP server exposes OwnPilot's 170+ tools to external clients (Claude Desktop, Cursor, etc.). Build on top of existing MCP infrastructure where needed.

---

## PHASE 1: UNIVERSAL CHANNEL PROTOCOL (UCP)

### WHY

OwnPilot has 3 channels (Telegram, Discord, Slack). Competitors have 14-17. But adding channels one by one = maintenance hell. UCP creates a protocol layer where new channels can be added in ~50-100 lines of adapter code, and cross-channel features (unified threads, bridging, capability negotiation) become possible.

### WHAT TO BUILD

#### 1.1 UCP Core Types

Create `packages/core/src/channels/ucp/types.ts`:

```typescript
// Universal Channel Protocol — message normalization layer

export type ChannelType =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'teams'
  | 'email'
  | 'sms'
  | 'web'
  | 'line'
  | 'wechat'
  | 'imessage'
  | 'custom';

export type ContentType =
  | 'text'
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'sticker'
  | 'card'
  | 'button_group'
  | 'form';

export type ChannelFeature =
  | 'rich_text'
  | 'markdown'
  | 'html'
  | 'images'
  | 'files'
  | 'audio'
  | 'video'
  | 'reactions'
  | 'threads'
  | 'editing'
  | 'deletion'
  | 'typing_indicator'
  | 'read_receipts'
  | 'buttons'
  | 'cards'
  | 'forms'
  | 'voice_messages'
  | 'stickers'
  | 'polls';

export interface UCPMessage {
  id: string;
  externalId: string; // original platform message ID
  channel: ChannelType;
  channelInstanceId: string; // which specific bot/account
  direction: 'inbound' | 'outbound';
  sender: UCPIdentity;
  recipient?: UCPIdentity;
  content: UCPContent[];
  threadId?: string; // cross-channel unified thread
  replyToId?: string;
  timestamp: Date;
  metadata: UCPMetadata;
}

export interface UCPIdentity {
  id: string; // platform-specific user ID
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  platform: ChannelType;
}

export interface UCPContent {
  type: ContentType;
  // Text
  text?: string;
  format?: 'plain' | 'markdown' | 'html';
  // Media
  url?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  thumbnailUrl?: string;
  // Location
  latitude?: number;
  longitude?: number;
  // Reaction
  emoji?: string;
  targetMessageId?: string;
  // Interactive
  buttons?: UCPButton[];
  fields?: UCPFormField[];
}

export interface UCPButton {
  id: string;
  label: string;
  action: 'callback' | 'url' | 'command';
  value: string;
}

export interface UCPFormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  required: boolean;
  options?: string[]; // for select
  defaultValue?: unknown;
}

export interface UCPMetadata {
  raw?: unknown; // original platform message object
  conversationId?: string; // OwnPilot conversation link
  workspaceId?: string;
  isEdited?: boolean;
  isForwarded?: boolean;
  forwardedFrom?: UCPIdentity;
  replyChain?: string[]; // message IDs in reply chain
}

export interface ChannelCapabilities {
  channel: ChannelType;
  features: Map<ChannelFeature, boolean>;
  limits: {
    maxTextLength?: number;
    maxFileSize?: number; // bytes
    maxImageSize?: number;
    maxButtons?: number;
    supportedMediaTypes?: string[];
  };
}
```

#### 1.2 Channel Adapter SDK

Create `packages/core/src/channels/ucp/adapter.ts`:

```typescript
import { EventEmitter } from 'node:events';

export abstract class ChannelAdapter extends EventEmitter {
  abstract readonly name: ChannelType;
  abstract readonly capabilities: ChannelCapabilities;

  protected config: Record<string, unknown> = {};
  protected connected: boolean = false;

  // Lifecycle
  abstract connect(config: Record<string, unknown>): Promise<void>;
  abstract disconnect(): Promise<void>;
  isConnected(): boolean {
    return this.connected;
  }

  // REQUIRED: Implement these two methods to create a new channel adapter
  // Everything else is handled by the framework

  // Inbound: Convert platform-specific message → UCPMessage
  protected abstract normalize(raw: unknown): UCPMessage;

  // Outbound: Convert UCPMessage → platform-specific format and send
  protected abstract denormalize(msg: UCPMessage): Promise<void>;

  // Optional overrides for rich features
  protected async sendTypingIndicator?(recipientId: string): Promise<void>;
  protected async editMessage?(messageId: string, content: UCPContent[]): Promise<void>;
  protected async deleteMessage?(messageId: string): Promise<void>;
  protected async addReaction?(messageId: string, emoji: string): Promise<void>;

  // Framework methods (don't override)
  async sendMessage(msg: UCPMessage): Promise<void> {
    // Auto-adapt content to channel capabilities
    const adapted = this.adaptContent(msg);
    await this.denormalize(adapted);
  }

  // Auto-adapt content based on channel capabilities
  private adaptContent(msg: UCPMessage): UCPMessage {
    const adapted = { ...msg, content: [...msg.content] };

    for (let i = 0; i < adapted.content.length; i++) {
      const c = adapted.content[i];

      // If channel doesn't support buttons, convert to numbered text menu
      if (c.type === 'button_group' && !this.capabilities.features.get('buttons')) {
        adapted.content[i] = this.buttonsToText(c);
      }

      // If channel doesn't support markdown, strip formatting
      if (c.format === 'markdown' && !this.capabilities.features.get('markdown')) {
        adapted.content[i] = { ...c, text: this.stripMarkdown(c.text!), format: 'plain' };
      }

      // Truncate text to channel limit
      if (c.type === 'text' && this.capabilities.limits.maxTextLength) {
        const max = this.capabilities.limits.maxTextLength;
        if (c.text && c.text.length > max) {
          adapted.content[i] = { ...c, text: c.text.slice(0, max - 20) + '\n\n[truncated]' };
        }
      }
    }

    return adapted;
  }

  private buttonsToText(content: UCPContent): UCPContent {
    if (!content.buttons) return content;
    const lines = content.buttons.map((b, i) => `${i + 1}. ${b.label}`);
    return {
      type: 'text',
      text: (content.text ? content.text + '\n\n' : '') + lines.join('\n'),
      format: 'plain',
    };
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }
}
```

#### 1.3 MessageBus Pipeline

Create `packages/core/src/channels/ucp/message-bus.ts`:

```typescript
// MessageBus — processes all inbound/outbound messages through a pipeline

export type MessageMiddleware = (
  msg: UCPMessage,
  next: () => Promise<UCPMessage>
) => Promise<UCPMessage>;

export class MessageBus {
  private inboundMiddleware: MessageMiddleware[] = [];
  private outboundMiddleware: MessageMiddleware[] = [];

  // Register middleware
  useInbound(mw: MessageMiddleware): this;
  useOutbound(mw: MessageMiddleware): this;

  // Process messages
  async processInbound(msg: UCPMessage): Promise<UCPMessage>;
  async processOutbound(msg: UCPMessage): Promise<UCPMessage>;
}

// Built-in middleware:
// 1. PII Redaction (inbound) — redact sensitive data before logging
// 2. Rate Limiter (outbound) — per-channel rate limiting
// 3. Thread Tracker (inbound) — maintain unified thread IDs
// 4. Conversation Linker (inbound) — link to OwnPilot conversations
// 5. Audit Logger (both) — log all messages to audit trail
// 6. Language Detector (inbound) — auto-detect message language
```

#### 1.4 Channel Registry

Create `packages/core/src/channels/ucp/registry.ts`:

```typescript
// ChannelRegistry — manages all channel adapter instances

export class ChannelRegistry {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private messageBus: MessageBus;

  register(instanceId: string, adapter: ChannelAdapter): void;
  unregister(instanceId: string): void;
  get(instanceId: string): ChannelAdapter | undefined;
  listAll(): { instanceId: string; channel: ChannelType; connected: boolean }[];

  // Cross-channel operations
  async bridgeMessage(fromInstanceId: string, toInstanceId: string, msg: UCPMessage): Promise<void>;
  async broadcastMessage(msg: UCPMessage, instanceIds?: string[]): Promise<void>;
}
```

#### 1.5 Refactor Existing Adapters

Refactor `packages/channels/src/telegram/` to extend `ChannelAdapter`:

```typescript
// packages/channels/src/telegram/adapter.ts
import { ChannelAdapter, UCPMessage, ChannelCapabilities } from '@ownpilot/core';

export class TelegramAdapter extends ChannelAdapter {
  readonly name = 'telegram' as const;
  readonly capabilities: ChannelCapabilities = {
    channel: 'telegram',
    features: new Map([
      ['rich_text', true],
      ['markdown', true],
      ['images', true],
      ['files', true],
      ['audio', true],
      ['video', true],
      ['reactions', true],
      ['threads', true],
      ['editing', true],
      ['deletion', true],
      ['typing_indicator', true],
      ['buttons', true],
      ['stickers', true],
      ['voice_messages', true],
      ['polls', true],
    ]),
    limits: {
      maxTextLength: 4096,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      maxButtons: 100,
      supportedMediaTypes: ['image/*', 'video/*', 'audio/*', 'application/*'],
    },
  };

  async connect(config: { token: string; allowedUsers?: string[]; allowedChats?: string[] }) {
    /* ... */
  }
  async disconnect() {
    /* ... */
  }
  protected normalize(raw: TelegramUpdate): UCPMessage {
    /* ... */
  }
  protected async denormalize(msg: UCPMessage): Promise<void> {
    /* ... */
  }
}
```

Do the same for Discord and Slack adapters.

#### 1.6 New Channel Adapters

After UCP is in place, add these built-in adapters. Each should be ~100-200 lines:

**WhatsApp** — `packages/channels/src/whatsapp/adapter.ts`

- Use `whatsapp-web.js` or WhatsApp Business API
- Features: text, images, files, audio, video, reactions, buttons, location

**Email** — `packages/channels/src/email/adapter.ts`

- IMAP (inbound) + SMTP (outbound) via `nodemailer` + `imapflow`
- Features: text (html), files (attachments), threads (In-Reply-To)
- Inbound: poll IMAP inbox for new messages → normalize → agent
- Outbound: agent response → format as email → SMTP send

**Matrix** — `packages/channels/src/matrix/adapter.ts`

- Use `matrix-js-sdk`
- Features: rich_text, images, files, reactions, threads, editing, deletion, read_receipts

**SMS** — `packages/channels/src/sms/adapter.ts`

- Use Twilio API (`twilio` package)
- Features: text only, very limited (160 chars SMS, or MMS for media)
- Auto-split long messages

**Webhook** — `packages/channels/src/webhook/adapter.ts`

- Generic HTTP webhook (inbound POST + outbound POST)
- For custom integrations without a dedicated adapter
- User configures inbound URL pattern and outbound URL

#### 1.7 Database

```sql
-- Migration: unified channel messages with UCP
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS ucp_thread_id VARCHAR(100);
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS ucp_content JSONB;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS channel_type VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_channel_messages_ucp_thread ON channel_messages(ucp_thread_id);

-- Migration: channel bridge configuration
CREATE TABLE IF NOT EXISTS channel_bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel_id UUID REFERENCES channels(id),
  target_channel_id UUID REFERENCES channels(id),
  direction VARCHAR(20) DEFAULT 'both' CHECK (direction IN ('source_to_target', 'target_to_source', 'both')),
  filter_pattern TEXT,              -- regex to match messages to bridge
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 1.8 UI

- Expand existing Channels page to show all adapter types
- Add "Bridge" configuration between channels
- Show unified thread view (messages from multiple channels in one view)
- Channel health dashboard with per-channel metrics

### FILES TO CREATE/MODIFY

```
packages/core/src/channels/ucp/
├── index.ts
├── types.ts                   # UCPMessage, UCPIdentity, UCPContent, etc.
├── adapter.ts                 # Abstract ChannelAdapter base class
├── message-bus.ts             # MessageBus pipeline
├── registry.ts                # ChannelRegistry
├── middleware/
│   ├── pii-redaction.ts
│   ├── rate-limiter.ts
│   ├── thread-tracker.ts
│   ├── conversation-linker.ts
│   ├── audit-logger.ts
│   └── language-detector.ts
└── __tests__/
    ├── adapter.test.ts
    ├── message-bus.test.ts
    └── capability-negotiation.test.ts

packages/channels/src/
├── telegram/adapter.ts        # REFACTOR to extend ChannelAdapter
├── discord/adapter.ts         # REFACTOR
├── slack/adapter.ts           # REFACTOR
├── whatsapp/adapter.ts        # NEW
├── email/adapter.ts           # NEW
├── matrix/adapter.ts          # NEW
├── sms/adapter.ts             # NEW
├── webhook/adapter.ts         # NEW
└── index.ts                   # re-exports all adapters

packages/gateway/src/db/migrations/xxx-ucp.ts
packages/ui/src/pages/ChannelsPage.tsx          # EXPAND
packages/ui/src/components/ChannelBridge.tsx     # NEW
packages/ui/src/components/UnifiedThread.tsx     # NEW
```

### ACCEPTANCE CRITERIA

- [ ] Existing Telegram/Discord/Slack work unchanged after refactor
- [ ] New WhatsApp adapter connects and sends/receives messages
- [ ] Email adapter polls IMAP and sends via SMTP
- [ ] Messages bridged between two channels appear in both
- [ ] UCPMessage with buttons auto-degrades to text menu on SMS
- [ ] Unified thread view shows messages from multiple channels
- [ ] All channel messages logged with UCP format
- [ ] All tests pass

---

## PHASE 2: AGENT ORCHESTRA (Multi-Agent Collaboration)

### WHY

OwnPilot has 29 agents but they work in isolation. The Orchestrator agent exists but doesn't delegate to other agents programmatically. Adding agent-to-agent communication enables complex multi-step workflows where each agent uses its optimal provider/model.

### WHAT TO BUILD

#### 2.1 Agent Orchestra Engine

Create `packages/core/src/agent/orchestra.ts`:

```typescript
export interface AgentTask {
  id: string;
  agentId: string; // which agent to delegate to
  input: string; // task description
  context?: Record<string, unknown>; // shared context from previous agents
  dependsOn?: string[]; // task IDs that must complete first
  timeout?: number; // ms
  optional?: boolean; // if true, failure doesn't block pipeline
}

export interface OrchestraResult {
  taskId: string;
  agentId: string;
  output: string;
  toolsUsed: string[];
  tokenUsage: { input: number; output: number };
  cost: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface OrchestraPlan {
  id: string;
  description: string;
  tasks: AgentTask[]; // dependency graph
  strategy: 'sequential' | 'parallel' | 'dag'; // dag = directed acyclic graph
  maxCost?: number; // budget limit
  maxDuration?: number; // total timeout
}

export class AgentOrchestra {
  constructor(
    private agentEngine: AgentEngine,
    private providerRouter: ProviderRouter,
    private memoryService: MemoryService
  ) {}

  // Plan generation — Orchestrator agent creates the plan
  async createPlan(userRequest: string, availableAgents: Agent[]): Promise<OrchestraPlan>;

  // Plan execution
  async executePlan(plan: OrchestraPlan): AsyncGenerator<OrchestraResult>;

  // Context sharing between agents
  private buildSharedContext(completedTasks: OrchestraResult[]): Record<string, unknown>;

  // Cost tracking
  private checkBudget(plan: OrchestraPlan, spent: number): boolean;
}
```

#### 2.2 Orchestrator Agent Enhancement

Modify the existing Orchestrator agent's system prompt to include delegation capabilities. Add a new tool:

```typescript
// New tool: delegate_to_agent
{
  name: 'delegate_to_agent',
  description: 'Delegate a subtask to a specialized agent. Use when a task requires specific expertise.',
  parameters: {
    agentName: { type: 'string', description: 'Agent to delegate to (e.g., "Code Assistant", "Research Assistant")' },
    task: { type: 'string', description: 'Clear description of what the agent should do' },
    context: { type: 'string', description: 'Relevant context from current conversation', optional: true },
    waitForResult: { type: 'boolean', description: 'If true, wait for result before continuing', default: true },
  }
}
```

#### 2.3 Per-Agent Provider Routing

Enhance the provider router to support per-agent model preferences:

```typescript
// Agent config enhancement
interface AgentConfig {
  // ... existing fields ...
  preferredProvider?: string; // "anthropic" for coding agents
  preferredModel?: string; // "claude-sonnet-4-5" for coding
  routingStrategy?: RoutingStrategy; // override global strategy
  costBudgetPerCall?: number; // max cost for single agent call
}

// Provider routing per-agent:
// Research Agent → Perplexity Sonar (built-in web search)
// Code Assistant → Claude Sonnet (best for coding)
// Creative Writer → GPT-5 (creative writing)
// Data Analyst → DeepSeek V3 (cheapest for reasoning)
// Summarizer → Gemini Flash (fast + cheap)
```

#### 2.4 Parallel Execution

```typescript
// In AgentOrchestra.executePlan():
// For 'parallel' strategy:
// - Group tasks by dependency level
// - Execute same-level tasks concurrently with Promise.allSettled()
// - Pass results to next level

// For 'dag' strategy:
// - Topological sort of task dependency graph
// - Execute tasks as soon as their dependencies complete
// - Maximum parallelism while respecting dependencies
```

### FILES TO CREATE/MODIFY

```
packages/core/src/agent/orchestra.ts                # NEW: main orchestra engine
packages/core/src/agent/orchestra-planner.ts         # NEW: plan generation
packages/core/src/agent/tools/delegation-tools.ts    # NEW: delegate_to_agent tool
packages/core/src/agent/__tests__/orchestra.test.ts  # NEW: tests

# MODIFY:
packages/core/src/agent/types.ts                     # Add AgentTask, OrchestraResult types
packages/core/src/agent/engine.ts                    # Support per-agent provider routing
packages/gateway/src/data/seeds/default-agents.json  # Update Orchestrator system prompt
packages/gateway/src/routes/agents.ts                # Add orchestra endpoints
packages/ui/src/pages/AgentsPage.tsx                 # Show delegation flow visualization
```

### ACCEPTANCE CRITERIA

- [ ] Orchestrator agent can delegate to Code Assistant and get results
- [ ] Parallel delegation works (Research + Code simultaneously)
- [ ] Per-agent provider routing works (coding tasks → Claude, research → Perplexity)
- [ ] Cost budget respected — stops if exceeded
- [ ] Delegation chain visible in UI trace view
- [ ] Results from delegated agents merged into final response

---

## PHASE 3: ARTIFACTS SYSTEM WITH DATA BINDING

### WHY

Neither OpenClaw's Canvas nor Claude's Artifacts persist beyond the session or bind to live data. OwnPilot already has a full personal data layer (tasks, expenses, goals, calendar) — binding artifacts to this data creates persistent, auto-updating dashboards that no competitor can match.

### WHAT TO BUILD

#### 3.1 Artifact Types & Storage

```typescript
// packages/core/src/artifacts/types.ts

export type ArtifactType = 'react' | 'html' | 'svg' | 'markdown' | 'chart' | 'form' | 'pdf';

export interface Artifact {
  id: string;
  conversationId: string; // which conversation created it
  type: ArtifactType;
  title: string;
  content: string; // source code (React/HTML/SVG/MD)
  dataBindings?: DataBinding[]; // live data connections
  pinned: boolean; // pinned to dashboard
  version: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DataBinding {
  id: string;
  variableName: string; // e.g., "tasks", "expenses_monthly"
  source: DataBindingSource;
  refreshInterval?: number; // ms, 0 = on-demand only
  lastValue?: unknown;
  lastRefreshed?: Date;
}

export type DataBindingSource =
  | { type: 'query'; entity: string; filter: Record<string, unknown> }
  | {
      type: 'aggregate';
      entity: string;
      operation: 'count' | 'sum' | 'avg';
      field?: string;
      filter?: Record<string, unknown>;
    }
  | { type: 'goal'; goalId: string }
  | { type: 'memory'; query: string; limit?: number }
  | { type: 'custom'; toolName: string; params: Record<string, unknown> };
```

#### 3.2 Artifact Renderer (UI)

Create `packages/ui/src/components/ArtifactRenderer.tsx`:

- Sandboxed iframe for React/HTML artifacts
- Data injection via postMessage
- Auto-refresh on data change (WebSocket subscription)
- Pin/unpin to dashboard
- Version history
- Export (PNG screenshot, PDF)
- Share link (read-only, expiring token)

#### 3.3 Agent Tool for Creating Artifacts

```typescript
// New tool: create_artifact
{
  name: 'create_artifact',
  description: 'Create an interactive artifact (chart, dashboard, form, visualization) that can be pinned to the user dashboard.',
  parameters: {
    title: { type: 'string' },
    type: { type: 'string', enum: ['react', 'html', 'svg', 'markdown', 'chart', 'form'] },
    content: { type: 'string', description: 'Source code for the artifact' },
    dataBindings: {
      type: 'array',
      items: {
        variableName: { type: 'string' },
        source: { type: 'object' },
        refreshInterval: { type: 'number', optional: true },
      },
      optional: true,
    },
    pinToDashboard: { type: 'boolean', default: false },
  }
}

// New tool: update_artifact
{
  name: 'update_artifact',
  description: 'Update an existing artifact content or data bindings.',
  parameters: {
    artifactId: { type: 'string' },
    content: { type: 'string', optional: true },
    dataBindings: { type: 'array', optional: true },
    title: { type: 'string', optional: true },
  }
}

// New tool: list_artifacts
{
  name: 'list_artifacts',
  description: 'List user artifacts, optionally filtered by type or pinned status.',
  parameters: {
    type: { type: 'string', optional: true },
    pinned: { type: 'boolean', optional: true },
    limit: { type: 'number', default: 20 },
  }
}
```

#### 3.4 Dashboard Integration

Enhance `packages/ui/src/pages/DashboardPage.tsx`:

- Grid layout for pinned artifacts (drag-and-drop reorder)
- Each pinned artifact renders in a card with auto-refresh
- Add/remove artifacts from dashboard
- Artifact data refreshes via WebSocket events

#### 3.5 Database

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  type VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB DEFAULT '[]',
  pinned BOOLEAN DEFAULT false,
  dashboard_position INTEGER,
  dashboard_size VARCHAR(10) DEFAULT 'medium',
  version INTEGER DEFAULT 1,
  tags TEXT[] DEFAULT '{}',
  workspace_id UUID REFERENCES workspaces(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### FILES TO CREATE/MODIFY

```
packages/core/src/artifacts/
├── index.ts
├── types.ts
├── renderer.ts
├── data-resolver.ts
└── __tests__/

packages/gateway/src/routes/artifacts.ts
packages/gateway/src/db/repositories/artifacts.ts
packages/gateway/src/db/migrations/xxx-artifacts.ts

packages/ui/src/components/
├── ArtifactRenderer.tsx
├── ArtifactCard.tsx
├── ArtifactGrid.tsx
└── ArtifactEditor.tsx

packages/ui/src/pages/ArtifactsPage.tsx
packages/ui/src/pages/DashboardPage.tsx

packages/core/src/agent/tools/artifact-tools.ts
```

### ACCEPTANCE CRITERIA

- [ ] Agent creates HTML artifact with expense chart
- [ ] Artifact displays correctly in sandboxed iframe
- [ ] Data binding `{{expenses.monthly}}` auto-refreshes when new expense added
- [ ] Artifact pinned to dashboard persists across sessions
- [ ] Dashboard shows grid of pinned artifacts with live data
- [ ] Artifact version history accessible
- [ ] Form artifact collects user input and passes to agent

---

## PHASE 4: VOICE PIPELINE

### WHY

Voice is the most natural interface for a personal assistant. OwnPilot already has TTS/STT tools but they're not integrated into the conversation flow. A voice pipeline that works across all channels (Telegram voice messages, Discord voice, web microphone) creates a unified voice experience.

### WHAT TO BUILD

#### 4.1 Voice Pipeline Engine

Create `packages/core/src/voice/`:

```typescript
// packages/core/src/voice/types.ts

export type VoiceProvider =
  | 'openai'
  | 'elevenlabs'
  | 'google'
  | 'azure'
  | 'deepgram'
  | 'local-whisper';

export interface VoiceConfig {
  sttProvider: VoiceProvider;
  ttsProvider: VoiceProvider;
  sttModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  language?: string;
  speed?: number;
  enableVAD?: boolean;
}

export interface STTResult {
  text: string;
  language: string;
  confidence: number;
  duration: number;
  segments?: { text: string; start: number; end: number }[];
}

export interface TTSResult {
  audio: Buffer;
  format: 'mp3' | 'opus' | 'wav' | 'pcm';
  duration: number;
  sampleRate: number;
}
```

```typescript
// packages/core/src/voice/pipeline.ts

export class VoicePipeline {
  constructor(
    private config: VoiceConfig,
    private agentEngine: AgentEngine
  ) {}

  async processVoiceMessage(
    audioBuffer: Buffer,
    format: string,
    context: { conversationId: string; channelType: ChannelType; userId: string }
  ): Promise<{ text: string; audio: Buffer; audioFormat: string }>;

  async speechToText(audio: Buffer, format: string): Promise<STTResult>;
  async textToSpeech(text: string): Promise<TTSResult>;

  async streamSTT(audioStream: ReadableStream): AsyncGenerator<STTResult>;
  async streamTTS(textStream: ReadableStream): AsyncGenerator<TTSResult>;
}
```

#### 4.2 UCP Integration

In MessageBus, add voice middleware:

```typescript
// packages/core/src/channels/ucp/middleware/voice-processor.ts
export function voiceProcessor(voicePipeline: VoicePipeline): MessageMiddleware {
  return async (msg, next) => {
    if (msg.direction === 'inbound') {
      for (const content of msg.content) {
        if (content.type === 'audio' && content.url) {
          const audio = await downloadAudio(content.url);
          const result = await voicePipeline.speechToText(audio, content.mimeType || 'audio/ogg');
          msg.content.push({ type: 'text', text: result.text, format: 'plain' });
        }
      }
    }

    const result = await next();

    if (result.direction === 'outbound' && isVoiceModeEnabled(result)) {
      for (const content of result.content) {
        if (content.type === 'text' && content.text) {
          const tts = await voicePipeline.textToSpeech(content.text);
          result.content.push({
            type: 'audio',
            url: await uploadTempAudio(tts.audio, tts.format),
            mimeType: `audio/${tts.format}`,
          });
        }
      }
    }

    return result;
  };
}
```

### FILES TO CREATE/MODIFY

```
packages/core/src/voice/
├── index.ts
├── types.ts
├── pipeline.ts
├── providers/
│   ├── openai.ts
│   ├── elevenlabs.ts
│   ├── deepgram.ts
│   ├── google.ts
│   └── local-whisper.ts
└── __tests__/

packages/core/src/channels/ucp/middleware/voice-processor.ts
packages/core/src/agent/tools/voice-tools.ts

packages/gateway/src/routes/voice.ts
packages/gateway/src/ws/voice-handler.ts

packages/ui/src/components/VoiceInput.tsx
packages/ui/src/components/VoicePlayer.tsx
packages/ui/src/hooks/useVoice.ts
```

### ACCEPTANCE CRITERIA

- [ ] Send voice message on Telegram → agent responds with text + voice
- [ ] Web UI microphone records, transcribes, agent responds, TTS plays
- [ ] Voice mode toggle in UI settings
- [ ] voice_memo tool creates structured notes from voice input
- [ ] Language auto-detection works
- [ ] Local Whisper option works without external API

---

## PHASE 5: BROWSER AGENT

### WHY

OpenClaw has Chrome CDP control. Adding headless browser capabilities to OwnPilot enables web automation, form filling, page monitoring — all protected by OwnPilot's security layer (PII detection, autonomy levels, sandbox).

### WHAT TO BUILD

#### 5.1 Browser Service

Create `packages/core/src/browser/`:

```typescript
export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'wait' | 'scroll' | 'select';
  selector?: string;
  url?: string;
  text?: string;
  value?: string;
  timeout?: number;
}

export interface BrowserResult {
  success: boolean;
  screenshot?: Buffer;
  extractedText?: string;
  extractedData?: Record<string, unknown>;
  url: string;
  title: string;
  error?: string;
}

export interface BrowserWorkflow {
  id: string;
  name: string;
  description: string;
  steps: BrowserAction[];
  parameters: { name: string; type: string; description: string }[];
  schedule?: string;
  triggerId?: string;
}
```

### FILES TO CREATE/MODIFY

```
packages/core/src/browser/
├── index.ts
├── types.ts
├── service.ts
├── workflow.ts
├── security.ts
└── __tests__/

packages/core/src/agent/tools/browser-tools.ts
packages/gateway/src/routes/browser.ts
packages/gateway/src/db/repositories/browser.ts
packages/gateway/src/db/migrations/xxx-browser.ts
packages/ui/src/pages/BrowserPage.tsx
Dockerfile
```

### ACCEPTANCE CRITERIA

- [ ] `browse_web("https://example.com")` returns page text
- [ ] `fill_form` detects PII fields and warns at autonomy level 0-1
- [ ] `take_screenshot` returns a viewable screenshot
- [ ] Workflow recorded and replayed with parameters
- [ ] Workflow linked to trigger fires on schedule
- [ ] URL allowlist blocks navigation to blocked domains
- [ ] Browser runs in Docker isolation

---

## PHASE 6: SKILLS PLATFORM

### WHY

A skills platform enables community contributions. Instead of OwnPilot maintaining everything, community developers create channel adapters, tools, agent profiles, artifact templates — distributed via npm.

### WHAT TO BUILD

#### 6.1 Skill Format

```typescript
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  homepage?: string;
  repository?: string;

  provides: {
    tools?: SkillToolDefinition[];
    agents?: SkillAgentDefinition[];
    triggers?: SkillTriggerTemplate[];
    artifacts?: SkillArtifactTemplate[];
    channels?: SkillChannelAdapter[];
    dataTables?: SkillDataTable[];
    middleware?: SkillMiddleware[];
  };

  permissions: {
    required: SkillPermission[];
    optional: SkillPermission[];
  };

  runtime: {
    sandbox: 'worker-thread' | 'vm' | 'docker';
    network: boolean;
    filesystem: 'none' | 'scoped' | 'full';
    maxMemory?: number;
  };

  dependencies?: Record<string, string>;
}

export type SkillPermission =
  | 'tasks'
  | 'notes'
  | 'calendar'
  | 'contacts'
  | 'expenses'
  | 'memories'
  | 'goals'
  | 'conversations'
  | 'custom-data'
  | 'network'
  | 'filesystem'
  | 'browser'
  | 'email'
  | 'channels'
  | 'triggers'
  | 'plans';
```

### FILES TO CREATE/MODIFY

```
packages/core/src/skills/
├── index.ts
├── types.ts
├── loader.ts
├── registry.ts
├── sandbox.ts
├── validator.ts
└── __tests__/

packages/gateway/src/routes/skills.ts
packages/gateway/src/db/repositories/skills.ts
packages/gateway/src/db/migrations/xxx-skills.ts

packages/ui/src/pages/SkillsPage.tsx
packages/ui/src/components/SkillCard.tsx
packages/ui/src/components/PermissionReview.tsx

packages/cli/src/commands/skill.ts
```

### ACCEPTANCE CRITERIA

- [ ] `ownpilot skill install @ownpilot/skill-example` works
- [ ] Installed skill's tools appear in `search_tools` results
- [ ] Permission review shown before installation
- [ ] Skill runs in worker-thread sandbox
- [ ] UI shows installed skills with enable/disable toggle
- [ ] Skill uninstall cleanly removes all components

---

## PHASE 7: EDGE DELEGATION PROTOCOL

### WHY

Instead of running a full LLM on cheap hardware (bad quality), OwnPilot becomes the brain and edge devices become the hands. $2 ESP32 with thin agent → MQTT → OwnPilot server → intelligent decisions.

### WHAT TO BUILD

#### 7.1 Edge Device Manager

Create `packages/core/src/edge/`:

```typescript
export interface EdgeDevice {
  id: string;
  name: string;
  type: 'raspberry-pi' | 'esp32' | 'arduino' | 'custom';
  protocol: 'mqtt' | 'websocket' | 'http-poll';
  sensors: EdgeSensor[];
  actuators: EdgeActuator[];
  status: 'online' | 'offline' | 'error';
  lastSeen: Date;
  firmwareVersion?: string;
  metadata: Record<string, unknown>;
}

export interface EdgeSensor {
  id: string;
  name: string;
  type: 'temperature' | 'humidity' | 'motion' | 'light' | 'pressure' | 'camera' | 'door' | 'custom';
  unit?: string;
  lastValue?: number | string | boolean;
  lastUpdated?: Date;
}

export interface EdgeActuator {
  id: string;
  name: string;
  type: 'relay' | 'servo' | 'led' | 'buzzer' | 'display' | 'motor' | 'custom';
  state?: unknown;
}
```

### FILES TO CREATE/MODIFY

```
packages/core/src/edge/
├── index.ts
├── types.ts
├── manager.ts
├── mqtt.ts
├── command-queue.ts
└── __tests__/

packages/core/src/agent/tools/edge-tools.ts
packages/gateway/src/routes/edge.ts
packages/gateway/src/db/repositories/edge.ts
packages/gateway/src/db/migrations/xxx-edge.ts
packages/ui/src/pages/EdgeDevicesPage.tsx
packages/ui/src/components/DeviceCard.tsx
packages/ui/src/components/SensorChart.tsx
docker-compose.yml
```

---

## GENERAL RULES FOR ALL PHASES

### Code Quality

- TypeScript strict mode, no `any`
- All functions have JSDoc comments
- All public APIs have full type definitions
- Use existing patterns: Result<T,E>, Repository, EventBus
- Follow existing code style (check .prettierrc, eslint config)

### Testing

- Unit tests for every new module (Vitest)
- Integration tests for API routes
- Minimum 80% coverage for new code
- Test command: `pnpm test`

### Database

- All migrations are idempotent (IF NOT EXISTS)
- Include rollback in every migration
- Seed data for new features where applicable
- Repository pattern for all DB access

### Security

- Autonomy levels respected for ALL new tool executions
- PII detection applied to all new data flows
- Audit trail for all new operations
- Sandbox isolation for all code execution
- No secrets in code or logs

### UI

- Follow existing Tailwind CSS 4 patterns
- Dark mode support for all new pages/components
- Responsive design (mobile-friendly)
- Lucide React for icons
- Use existing Layout, ConfirmDialog patterns

### API

- Follow existing Hono route patterns
- Consistent error responses: `{ error: string, details?: unknown }`
- Rate limiting applied to new routes
- Auth middleware applied to new routes
- WebSocket for real-time features (use existing ws/ pattern)

### Dependencies

- Minimize new dependencies
- Use `pnpm --filter <package> add <dep>` for package-scoped installs
- No native/binary dependencies except for browser (playwright) and MQTT
- Check license compatibility (MIT preferred)

### Documentation

- Update README.md feature list for each phase
- Add JSDoc to all public APIs
- Update API Reference section for new routes
- Add to Tool Categories table for new tools

---

## EXECUTION ORDER

```
Phase 1: Universal Channel Protocol  ← START HERE
Phase 2: Agent Orchestra
Phase 3: Artifacts + Data Binding
Phase 4: Voice Pipeline
Phase 5: Browser Agent
Phase 6: Skills Platform
Phase 7: Edge Delegation
```

Each phase is independent and can be implemented, tested, and deployed separately. Do NOT attempt all phases in a single session. Complete one phase, ensure all tests pass and the app runs correctly, then move to the next.

**For each phase, follow this workflow:**

1. Create new files (types first, then implementation, then tests)
2. Modify existing files (minimal changes, use existing patterns)
3. Add database migration
4. Add API routes
5. Add UI page/components
6. Add CLI commands (if applicable)
7. Run `pnpm typecheck` — fix any type errors
8. Run `pnpm test` — fix any test failures
9. Run `pnpm build` — ensure clean build
10. Test manually via UI and API

---

## IMPORTANT NOTES

- This is a pnpm monorepo with Turborepo. Always use `pnpm --filter <package>` for package-specific commands.
- The project uses Hono (not Express) for HTTP server.
- The project uses React 19 (not 18). Use the new React 19 APIs where appropriate.
- The project uses Tailwind CSS 4 (not 3). Use the v4 configuration format.
- The meta-tool proxy pattern (search_tools/get_tool_help/use_tool) is CORE to how tools work. All new tools MUST integrate through this pattern — never add tools directly to the LLM's tool list.
- The EventBus/HookBus pattern exists in `packages/core/src/events/`. Use it for inter-module communication.
- The service registry (DI container) exists in `packages/core/src/services/`. Register new services there.
- Check `packages/core/src/agent/tools/` for examples of how existing tools are defined and registered.
