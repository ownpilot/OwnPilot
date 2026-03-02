# OwnPilot — Agent Souls & Autonomous Crews

> **Bu dosya Claude Code'a verilecek bağımsız bir implementation spec'dir.**
> Mega upgrade spec'inden ayrıdır. Tek konusu: agent'lara ruh vermek, otonom crew'ler kurmak.
> Mevcut OwnPilot altyapısı üzerine inşa eder — sıfırdan bir şey yazmaz.

---

## PROJE BAĞLAMI

**Repo:** `ownpilot/OwnPilot` (GitHub)
**Dil:** TypeScript 5.9 (strict, ES2023, NodeNext)
**Monorepo:** pnpm workspaces + Turborepo
**Paketler:**

- `packages/core` — AI runtime, providers, tools, types, sandbox, crypto, audit, privacy, plugins, events, services, MCP
- `packages/gateway` — Hono API server, routes (37+), repositories (43+), channels, triggers, plans, middleware
- `packages/ui` — React 19 + Vite 7 + Tailwind CSS 4, 28+ pages, 60+ components
- `packages/channels` — Telegram, Discord, Slack, WhatsApp adapters
- `packages/cli` — Commander.js CLI

**DB:** PostgreSQL 16+ (43+ tables)

**Mevcut altyapı (bunları KULLAN, yeniden YAZMA):**

- **29 pre-configured agent** — `packages/core/src/agent/default-agents.json`
- **Background agents** — workspace isolation, heartbeat, inbox messaging, rate limiting, budget tracking
- **Agent Engine** — `packages/core/src/agent/engine.ts` (system prompt builder, tool executor, conversation manager)
- **5 autonomy level** (0=disabled → 4=full auto)
- **Memory system** — importance scoring, vector search, RRF ranking, `packages/core/src/memory/`
- **170+ tools** via meta-tool proxy (`search_tools` / `get_tool_help` / `use_tool`)
- **Trigger system** — cron, webhook, event-based triggers, `packages/gateway/src/routes/triggers.ts`
- **Goals system** — personal goals with progress tracking
- **EventBus / HookBus / ScopedBus** — `packages/core/src/events/`
- **Service registry** (DI container) — `packages/core/src/services/`
- **Per-tool security policies** — allowed / prompt / blocked
- **Channels** — Telegram, Discord, Slack, WhatsApp
- **MCP server + client** (already integrated)
- **AES-256-GCM crypto, PII detection, sandboxed execution**

**Key patterns:** `Result<T,E>`, Repository pattern, Strategy pattern, Registry pattern, Meta-tool proxy

---

## PROBLEM

OwnPilot'un agent'ları güçlü ama **ruhsuz**. Hepsi aynı generic system prompt'la çalışıyor, kişilikleri yok, kendi başlarına bir şey yapmıyorlar, birbirleriyle anlamlı şekilde konuşmuyorlar.

OpenClaw bunu SOUL.md + HEARTBEAT.md + IDENTITY.md dosyalarıyla çözdü — agent'lara persistent identity verdi, 30 dk'da bir heartbeat ile otonom çalıştırdı, filesystem üzerinden birbirleriyle haberleştirdi. 160K+ GitHub yıldız topladı. Ama yaklaşımları primitif:

| Problem         | OpenClaw                           | OwnPilot Çözümü                                 |
| --------------- | ---------------------------------- | ----------------------------------------------- |
| Depolama        | Düz .md dosyaları (disk)           | Yapısal JSONB (PostgreSQL)                      |
| Arama           | `grep`                             | Vector search + full-text + SQL                 |
| Güvenlik        | Plaintext, prompt injection'a açık | DB, autonomy levels, PII detection              |
| Versiyon        | Manuel git commit                  | Otomatik versiyonlama, diff, rollback           |
| Evrim           | Kullanıcı elle düzenler            | Feedback → otomatik evrim + self-reflection     |
| Agent iletişimi | Dosya yaz/oku (filesystem)         | Typed message bus (DB-backed, real-time)        |
| Koordinasyon    | Yok (tek agent)                    | Crew templates, coordination patterns           |
| Budget          | Yok (faturalar patlar)             | Per-agent + per-crew + daily limit + auto-pause |
| Audit           | Heartbeat arası karanlık           | heartbeat_log — her çalışma kaydedilir          |
| Ölçeklenme      | Tek makine, tek workspace          | Multi-workspace, server-side                    |

**Hedef:** OpenClaw'ın soul/heartbeat kavramını al, OwnPilot'un mevcut altyapısı üzerine 10x daha iyi şekilde inşa et.

---

## MİMARİ GENEL BAKIŞ

```
┌─────────────────────────────────────────────────────┐
│                    USER (Telegram, Web, etc.)        │
│                         │                           │
│                    ┌────▼─────┐                     │
│                    │ Gateway  │                     │
│                    │  (Hono)  │                     │
│                    └────┬─────┘                     │
│                         │                           │
│              ┌──────────▼──────────┐                │
│              │    Crew Manager     │                │
│              │  (deploy/pause/     │                │
│              │   resume/disband)   │                │
│              └──────────┬──────────┘                │
│                         │                           │
│         ┌───────────────┼───────────────┐           │
│         │               │               │           │
│   ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐     │
│   │  Agent A   │  │  Agent B   │  │  Agent C   │     │
│   │ ┌───────┐  │  │ ┌───────┐  │  │ ┌───────┐  │     │
│   │ │ SOUL  │  │  │ │ SOUL  │  │  │ │ SOUL  │  │     │
│   │ │identity│  │  │ │identity│  │  │ │identity│  │     │
│   │ │purpose │  │  │ │purpose │  │  │ │purpose │  │     │
│   │ │autonomy│  │  │ │autonomy│  │  │ │autonomy│  │     │
│   │ │heartbt │  │  │ │heartbt │  │  │ │heartbt │  │     │
│   │ └───────┘  │  │ └───────┘  │  │ └───────┘  │     │
│   │     │      │  │     │      │  │     │      │     │
│   │  Heartbeat │  │  Heartbeat │  │  Heartbeat │     │
│   │  (cron)    │  │  (cron)    │  │  (cron)    │     │
│   └─────┬──────┘  └─────┬──────┘  └─────┬──────┘     │
│         │               │               │           │
│         └───────────────┼───────────────┘           │
│                         │                           │
│              ┌──────────▼──────────┐                │
│              │ Communication Bus   │                │
│              │ (typed messages,    │                │
│              │  threads, inbox)    │                │
│              └──────────┬──────────┘                │
│                         │                           │
│              ┌──────────▼──────────┐                │
│              │   PostgreSQL DB     │                │
│              │ agent_souls         │                │
│              │ agent_soul_versions │                │
│              │ agent_messages      │                │
│              │ agent_crews         │                │
│              │ heartbeat_log       │                │
│              └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

---

## BÖLÜM 1: AGENT SOUL SİSTEMİ

### 1.1 Soul Tipleri

```typescript
// packages/core/src/agent/soul/types.ts

// ============================================================
// AGENT SOUL — persistent identity, injected into every prompt
// ============================================================

export interface AgentSoul {
  id: string;
  agentId: string; // foreign key → agents table (mevcut)

  identity: SoulIdentity;
  purpose: SoulPurpose;
  autonomy: SoulAutonomy;
  heartbeat: SoulHeartbeat;
  relationships: SoulRelationships;
  evolution: SoulEvolution;
  bootSequence: SoulBootSequence;

  workspaceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Identity ────────────────────────────────────────

export interface SoulIdentity {
  name: string; // "Scout", "Ghost", "Forge", "Radar"
  emoji: string; // "🔍", "✍️", "⚒️", "📡"
  role: string; // "X/Twitter Trend Researcher"
  personality: string; // "Curious, thorough, always digging deeper.
  //  Obsessed with finding signal in noise.
  //  Never uses corporate buzzwords."
  voice: {
    tone: string; // "casual-professional" | "analytical" | "creative"
    language: 'tr' | 'en' | 'both';
    quirks?: string[]; // "Uses cooking analogies", "Ends reports with haiku"
  };
  boundaries: string[]; // "Never post without approval", "Don't access financial data"
  backstory?: string; // optional: agent'ın kendi hikayesi
}

// ── Purpose ─────────────────────────────────────────

export interface SoulPurpose {
  mission: string; // Tek cümle: bu agent neden var?
  goals: string[]; // Aktif hedefler (Goals sistemiyle linklenebilir)
  expertise: string[]; // "TypeScript", "developer marketing", "trend analysis"
  toolPreferences: string[]; // search_tools sonuçlarında ağırlık verilecek tool'lar
  knowledgeDomains?: string[]; // memory search'te kullanılacak domain'ler
}

// ── Autonomy ────────────────────────────────────────

export interface SoulAutonomy {
  level: 0 | 1 | 2 | 3 | 4; // mevcut 5-level sisteme map'lenir
  // 0 = disabled, 1 = ask everything, 2 = ask risky, 3 = act + notify, 4 = full auto

  allowedActions: string[]; // "draft_post", "search_web", "read_email"
  blockedActions: string[]; // "send_email", "delete_data", "execute_code"
  requiresApproval: string[]; // "publish_post", "send_message_to_user"

  maxCostPerCycle: number; // $ budget per heartbeat cycle
  maxCostPerDay: number; // $ daily budget
  maxCostPerMonth: number; // $ monthly budget

  pauseOnConsecutiveErrors: number; // N ardışık hata → auto-pause (default: 5)
  pauseOnBudgetExceeded: boolean; // budget aşılınca auto-pause? (default: true)
  notifyUserOnPause: boolean; // pause olunca kullanıcıya bildir? (default: true)
}

// ── Heartbeat ───────────────────────────────────────

export interface SoulHeartbeat {
  enabled: boolean;
  interval: string; // cron expression: "*/30 * * * *", "0 9,17 * * *"
  checklist: HeartbeatTask[];
  quietHours?: {
    start: string; // "23:00"
    end: string; // "07:00"
    timezone: string; // "Europe/Istanbul"
  };
  selfHealingEnabled: boolean; // başarısız task'ları sonraki beat'te tekrar dene
  maxDurationMs: number; // heartbeat timeout (default: 120000 = 2 min)
}

export interface HeartbeatTask {
  id: string;
  name: string; // "Check X mentions"
  description: string; // "Search X for @ownpilot mentions, draft responses"

  schedule: 'every' | 'daily' | 'weekly' | 'condition';
  dailyAt?: string; // schedule='daily' → "09:00"
  weeklyOn?: number; // schedule='weekly' → 0=Sun, 1=Mon, ...
  condition?: string; // schedule='condition' → "inbox.unread > 0"

  tools: string[]; // hangi tool'ları kullanabilir
  prompt?: string; // agent'a verilecek talimat
  outputTo?: HeartbeatOutput;

  priority: 'low' | 'medium' | 'high' | 'critical';
  stalenessHours: number; // X saatten eski ise force re-run

  // Runtime state (DB'de)
  lastRunAt?: Date;
  lastResult?: 'success' | 'failure' | 'skipped';
  lastError?: string;
  consecutiveFailures?: number;
}

export type HeartbeatOutput =
  | { type: 'memory' }
  | { type: 'inbox'; agentId: string }
  | { type: 'channel'; channel: string; chatId?: string }
  | { type: 'note'; category?: string }
  | { type: 'task'; listId?: string }
  | { type: 'artifact'; dashboardPin?: boolean }
  | { type: 'broadcast'; crewId: string };

// ── Relationships ───────────────────────────────────

export interface SoulRelationships {
  reportsTo?: string; // üst agent ID
  delegates: string[]; // görev atabileceği agent'lar
  peers: string[]; // eşit seviye iletişim
  channels: string[]; // hangi communication channel'ları kullanır
  crewId?: string;
}

// ── Evolution ───────────────────────────────────────

export interface SoulEvolution {
  version: number;
  evolutionMode: 'manual' | 'supervised' | 'autonomous';
  // manual: sadece kullanıcı değiştirir
  // supervised: agent önerir, kullanıcı onaylar
  // autonomous: agent kendi kendine evrilir (coreTraits hariç)

  coreTraits: string[]; // DEĞİŞMEZ — agent'ın DNA'sı
  mutableTraits: string[]; // deneyimle evrilir

  learnings: string[]; // deneyimlerden çıkarılan dersler (son 50)
  feedbackLog: SoulFeedback[]; // kullanıcı geri bildirim geçmişi (son 100)

  lastReflectionAt?: Date;
  reflectionInterval?: string; // ne sıklıkla reflection (cron)
}

export interface SoulFeedback {
  id: string;
  timestamp: Date;
  type: 'praise' | 'correction' | 'directive' | 'personality_tweak';
  content: string;
  appliedToVersion: number;
  source: 'user' | 'self_reflection' | 'peer_feedback';
}

// ── Boot Sequence ───────────────────────────────────

export interface SoulBootSequence {
  onStart: string[];
  onHeartbeat: string[]; // her heartbeat öncesi rutin
  onMessage: string[]; // her mesaj öncesi rutin
  contextFiles?: string[];
  warmupPrompt?: string;
}
```

### 1.2 Soul Prompt Builder

Soul'u agent'ın system prompt'una inject eden modül. Mevcut `engine.ts`'deki system prompt builder'ı extend eder.

```typescript
// packages/core/src/agent/soul/builder.ts

import type { AgentSoul, HeartbeatTask } from './types.js';
import type { Memory } from '../../memory/types.js';

/**
 * Soul'u system prompt string'e dönüştürür.
 * Mevcut AgentEngine.buildSystemPrompt() içinden çağrılır.
 * Soul yoksa boş string döner — geriye uyumlu.
 */
export function buildSoulPrompt(
  soul: AgentSoul,
  recentMemories: Memory[],
  pendingInbox: number,
  currentHeartbeatTask?: HeartbeatTask
): string {
  const sections: string[] = [];

  // ── Identity
  sections.push(`## Who You Are
You are **${soul.identity.name}** ${soul.identity.emoji}
**Role:** ${soul.identity.role}
**Personality:** ${soul.identity.personality}
**Tone:** ${soul.identity.voice.tone} | **Language:** ${soul.identity.voice.language}
${soul.identity.voice.quirks?.map((q) => `- Quirk: ${q}`).join('\n') || ''}
${soul.identity.backstory ? `**Backstory:** ${soul.identity.backstory}` : ''}`);

  // ── Mission & Goals
  sections.push(`## Your Mission
${soul.purpose.mission}

### Active Goals
${soul.purpose.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

### Your Expertise
${soul.purpose.expertise.join(', ')}`);

  // ── Boundaries (CRITICAL — always prominent)
  sections.push(`## Boundaries — ALWAYS RESPECT
${soul.identity.boundaries.map((b) => `⛔ ${b}`).join('\n')}`);

  // ── Autonomy
  sections.push(`## Autonomy Level: ${soul.autonomy.level}
- **Allowed:** ${soul.autonomy.allowedActions.join(', ')}
- **Requires Approval:** ${soul.autonomy.requiresApproval.join(', ')}
- **Blocked:** ${soul.autonomy.blockedActions.join(', ')}
- **Budget:** $${soul.autonomy.maxCostPerDay}/day`);

  // ── Relationships
  if (
    soul.relationships.reportsTo ||
    soul.relationships.peers.length ||
    soul.relationships.delegates.length
  ) {
    sections.push(`## Your Team
${soul.relationships.reportsTo ? `- **Reports to:** ${soul.relationships.reportsTo}` : ''}
${soul.relationships.peers.length ? `- **Peers:** ${soul.relationships.peers.join(', ')}` : ''}
${soul.relationships.delegates.length ? `- **Can delegate to:** ${soul.relationships.delegates.join(', ')}` : ''}`);
  }

  // ── Current context
  if (pendingInbox > 0) {
    sections.push(`## Inbox
You have **${pendingInbox}** unread messages from other agents. Check your inbox.`);
  }

  if (currentHeartbeatTask) {
    sections.push(`## Current Heartbeat Task
**${currentHeartbeatTask.name}:** ${currentHeartbeatTask.description}
Tools available: ${currentHeartbeatTask.tools.join(', ') || 'any'}
Output to: ${JSON.stringify(currentHeartbeatTask.outputTo || 'memory')}
Priority: ${currentHeartbeatTask.priority}`);
  }

  // ── Learnings (last 10)
  if (soul.evolution.learnings.length > 0) {
    sections.push(`## Learnings from Experience
${soul.evolution.learnings
  .slice(-10)
  .map((l) => `- ${l}`)
  .join('\n')}`);
  }

  // ── Recent memories (last 5)
  if (recentMemories.length > 0) {
    sections.push(`## Recent Memories
${recentMemories
  .slice(0, 5)
  .map((m) => `- [${m.importance}] ${m.content}`)
  .join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Soul prompt'un tahmini token sayısını döner.
 */
export function estimateSoulTokens(soul: AgentSoul): number {
  const prompt = buildSoulPrompt(soul, [], 0);
  return Math.ceil(prompt.length / 4);
}
```

### 1.3 Agent Engine Entegrasyonu

Mevcut `packages/core/src/agent/engine.ts` dosyasını MİNİMAL şekilde modifiye et:

```typescript
// 1. Import ekle (dosya başı)
import { SoulRepository } from './soul/repository.js';
import { buildSoulPrompt } from './soul/builder.js';

// 2. Constructor'a soulRepo ekle
// this.soulRepo = serviceRegistry.get<SoulRepository>('soulRepository');

// 3. buildSystemPrompt() metodunda, mevcut prompt'un BAŞINA soul inject et:
//
// async buildSystemPrompt(agentId: string, context: AgentContext): Promise<string> {
//   const basePrompt = ... // MEVCUT KOD — dokunma
//
//   // Soul injection — yoksa mevcut davranış
//   const soul = await this.soulRepo.getByAgentId(agentId);
//   if (soul) {
//     const memories = await this.memoryService.getRecent(agentId, 5);
//     const inboxCount = await this.communicationBus?.getUnreadCount(agentId) ?? 0;
//     const heartbeatTask = context.isHeartbeat ? context.currentTask : undefined;
//     const soulPrompt = buildSoulPrompt(soul, memories, inboxCount, heartbeatTask);
//     return soulPrompt + '\n\n---\n\n' + basePrompt;
//   }
//
//   return basePrompt;
// }
```

**KRİTİK:** Mevcut engine.ts'yi bozma. Soul yoksa her şey eskisi gibi çalışmalı.

---

## BÖLÜM 2: HEARTBEAT MOTORU

Mevcut trigger sistemi ve background agents altyapısı üzerine inşa et.

### 2.1 Heartbeat Runner

```typescript
// packages/core/src/agent/soul/heartbeat-runner.ts

import type { AgentSoul, HeartbeatTask, HeartbeatOutput } from './types.js';
import type { AgentEngine } from '../engine.js';
import type { Result } from '../../types/result.js';

export interface HeartbeatResult {
  agentId: string;
  soulVersion: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  tasks: HeartbeatTaskResult[];
  totalTokens: { input: number; output: number };
  totalCost: number;
}

export interface HeartbeatTaskResult {
  taskId: string;
  taskName: string;
  status: 'success' | 'failure' | 'skipped';
  output?: string;
  error?: string;
  tokenUsage: { input: number; output: number };
  cost: number;
  durationMs: number;
}

export class HeartbeatRunner {
  constructor(
    private agentEngine: AgentEngine,
    private soulRepo: SoulRepository,
    private communicationBus: AgentCommunicationBus,
    private heartbeatLogRepo: HeartbeatLogRepository,
    private budgetTracker: BudgetTracker
  ) {}

  /**
   * Bir agent'ın heartbeat cycle'ını çalıştır.
   * Mevcut trigger sistemi tarafından cron ile tetiklenir.
   */
  async runHeartbeat(agentId: string): Promise<Result<HeartbeatResult, Error>> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul || !soul.heartbeat.enabled) {
      return { ok: false, error: new Error('Soul not found or heartbeat disabled') };
    }

    // Quiet hours kontrolü
    if (this.isQuietHours(soul)) {
      return { ok: true, value: this.createSkippedResult(agentId, soul, 'quiet_hours') };
    }

    // Budget kontrolü
    const budgetOk = await this.budgetTracker.checkBudget(agentId, soul.autonomy);
    if (!budgetOk) {
      await this.handleBudgetExceeded(agentId, soul);
      return { ok: false, error: new Error('Daily budget exceeded') };
    }

    const result: HeartbeatResult = {
      agentId,
      soulVersion: soul.evolution.version,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      tasks: [],
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };

    // Hangi task'lar çalışmalı?
    const tasksToRun = this.filterTasksToRun(soul.heartbeat.checklist);

    for (const task of tasksToRun) {
      // Per-cycle budget check
      if (result.totalCost >= soul.autonomy.maxCostPerCycle) {
        result.tasks.push({
          taskId: task.id,
          taskName: task.name,
          status: 'skipped',
          error: 'Cycle budget exceeded',
          tokenUsage: { input: 0, output: 0 },
          cost: 0,
          durationMs: 0,
        });
        continue;
      }

      const taskResult = await this.executeTask(agentId, soul, task);
      result.tasks.push(taskResult);
      result.totalTokens.input += taskResult.tokenUsage.input;
      result.totalTokens.output += taskResult.tokenUsage.output;
      result.totalCost += taskResult.cost;

      // Output routing
      if (taskResult.status === 'success' && task.outputTo) {
        await this.routeOutput(agentId, soul, task, taskResult.output || '');
      }

      // Task state update
      await this.soulRepo.updateTaskStatus(agentId, task.id, {
        lastRunAt: new Date(),
        lastResult: taskResult.status,
        lastError: taskResult.error,
        consecutiveFailures:
          taskResult.status === 'failure' ? (task.consecutiveFailures || 0) + 1 : 0,
      });
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - result.startedAt.getTime();

    // Log to DB
    await this.heartbeatLogRepo.create({
      agentId,
      soulVersion: soul.evolution.version,
      tasksRun: result.tasks
        .filter((t) => t.status === 'success')
        .map((t) => ({ id: t.taskId, name: t.taskName })),
      tasksSkipped: result.tasks
        .filter((t) => t.status === 'skipped')
        .map((t) => ({ id: t.taskId, reason: t.error })),
      tasksFailed: result.tasks
        .filter((t) => t.status === 'failure')
        .map((t) => ({ id: t.taskId, error: t.error })),
      durationMs: result.durationMs,
      tokenUsage: result.totalTokens,
      cost: result.totalCost,
    });

    await this.budgetTracker.recordSpend(agentId, result.totalCost);

    // Emit event
    this.agentEngine.eventBus.emit('heartbeat:completed', {
      agentId,
      soulVersion: soul.evolution.version,
      tasksRun: result.tasks.length,
      tasksFailed: result.tasks.filter((t) => t.status === 'failure').length,
      cost: result.totalCost,
    });

    return { ok: true, value: result };
  }

  /**
   * Tek bir heartbeat task'ını çalıştır.
   */
  private async executeTask(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask
  ): Promise<HeartbeatTaskResult> {
    const startTime = Date.now();
    try {
      const taskPrompt =
        task.prompt ||
        `
Execute the following heartbeat task:
**${task.name}**: ${task.description}
${task.tools.length ? `Available tools: ${task.tools.join(', ')}` : ''}
Be concise and focused. Report your findings clearly.
      `.trim();

      // Mevcut agent engine — soul prompt otomatik inject edilecek
      const response = await this.agentEngine.processMessage({
        agentId,
        message: taskPrompt,
        context: {
          isHeartbeat: true,
          heartbeatTaskId: task.id,
          allowedTools: task.tools.length > 0 ? task.tools : undefined,
        },
      });

      return {
        taskId: task.id,
        taskName: task.name,
        status: 'success',
        output: response.content,
        tokenUsage: response.tokenUsage || { input: 0, output: 0 },
        cost: response.cost || 0,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        taskId: task.id,
        taskName: task.name,
        status: 'failure',
        error: error instanceof Error ? error.message : String(error),
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Hangi task'lar çalışmalı? Schedule + staleness kontrolü.
   */
  private filterTasksToRun(checklist: HeartbeatTask[]): HeartbeatTask[] {
    const now = new Date();
    return checklist.filter((task) => {
      if (task.schedule === 'every') return true;

      if (task.schedule === 'daily' && task.dailyAt) {
        const [h, m] = task.dailyAt.split(':').map(Number);
        const todayTarget = new Date(now);
        todayTarget.setHours(h, m, 0, 0);
        if (!task.lastRunAt || task.lastRunAt < todayTarget) {
          if (now.getHours() >= h) return true;
        }
        return false;
      }

      if (task.schedule === 'weekly' && task.weeklyOn !== undefined) {
        if (now.getDay() === task.weeklyOn) {
          if (!task.lastRunAt || this.daysSince(task.lastRunAt) >= 6) return true;
        }
        return false;
      }

      // Staleness — force re-run if stale
      if (task.lastRunAt && task.stalenessHours > 0) {
        const hoursSince = (now.getTime() - task.lastRunAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince > task.stalenessHours) return true;
      }

      return false;
    });
  }

  /**
   * Task output'unu hedefine yönlendir.
   */
  private async routeOutput(
    agentId: string,
    soul: AgentSoul,
    task: HeartbeatTask,
    output: string
  ): Promise<void> {
    if (!task.outputTo) return;

    switch (task.outputTo.type) {
      case 'memory':
        await this.agentEngine.saveMemory(agentId, output, 'heartbeat');
        break;
      case 'inbox':
        await this.communicationBus.send({
          from: agentId,
          to: task.outputTo.agentId,
          type: 'task_result',
          subject: `[Heartbeat] ${task.name}`,
          content: output,
          priority: task.priority === 'critical' ? 'urgent' : 'normal',
          requiresResponse: false,
        });
        break;
      case 'channel':
        await this.agentEngine.sendToChannel(task.outputTo.channel, output, task.outputTo.chatId);
        break;
      case 'note':
        await this.agentEngine.createNote({
          content: output,
          category: task.outputTo.category || 'heartbeat',
          source: `${soul.identity.name} heartbeat`,
        });
        break;
      case 'broadcast':
        await this.communicationBus.broadcast(task.outputTo.crewId, {
          from: agentId,
          type: 'knowledge_share',
          subject: `[${soul.identity.name}] ${task.name}`,
          content: output,
          priority: 'normal',
          requiresResponse: false,
        });
        break;
    }
  }

  private isQuietHours(soul: AgentSoul): boolean {
    if (!soul.heartbeat.quietHours) return false;
    const currentHour = new Date().getHours();
    const startHour = parseInt(soul.heartbeat.quietHours.start.split(':')[0], 10);
    const endHour = parseInt(soul.heartbeat.quietHours.end.split(':')[0], 10);
    if (startHour > endHour) return currentHour >= startHour || currentHour < endHour;
    return currentHour >= startHour && currentHour < endHour;
  }

  private daysSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  }

  private createSkippedResult(agentId: string, soul: AgentSoul, reason: string): HeartbeatResult {
    return {
      agentId,
      soulVersion: soul.evolution.version,
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      tasks: [
        {
          taskId: 'all',
          taskName: 'all',
          status: 'skipped',
          error: reason,
          tokenUsage: { input: 0, output: 0 },
          cost: 0,
          durationMs: 0,
        },
      ],
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };
  }

  private async handleBudgetExceeded(agentId: string, soul: AgentSoul): Promise<void> {
    if (soul.autonomy.pauseOnBudgetExceeded) {
      await this.soulRepo.setHeartbeatEnabled(agentId, false);
    }
    if (soul.autonomy.notifyUserOnPause) {
      await this.agentEngine.sendToChannel(
        'telegram',
        `⚠️ ${soul.identity.name} ${soul.identity.emoji} paused — daily budget ($${soul.autonomy.maxCostPerDay}) exceeded.`
      );
    }
  }
}
```

### 2.2 Budget Tracker

```typescript
// packages/core/src/agent/soul/budget-tracker.ts

export class BudgetTracker {
  constructor(private db: DatabasePool) {}

  async checkBudget(agentId: string, autonomy: SoulAutonomy): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.db.query(
      `SELECT COALESCE(SUM(cost), 0) as total FROM heartbeat_log WHERE agent_id = $1 AND created_at::date = $2`,
      [agentId, today]
    );
    return parseFloat(result.rows[0].total) < autonomy.maxCostPerDay;
  }

  async recordSpend(agentId: string, amount: number): Promise<void> {
    // heartbeat_log'a zaten yazılıyor — ek Redis cache istersen burada
  }

  async getDailySpend(agentId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const r = await this.db.query(
      `SELECT COALESCE(SUM(cost), 0) as t FROM heartbeat_log WHERE agent_id = $1 AND created_at::date = $2`,
      [agentId, today]
    );
    return parseFloat(r.rows[0].t);
  }

  async getMonthlySpend(agentId: string): Promise<number> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(cost), 0) as t FROM heartbeat_log WHERE agent_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [agentId]
    );
    return parseFloat(r.rows[0].t);
  }
}
```

### 2.3 Trigger Entegrasyonu

Mevcut trigger sistemine heartbeat'leri bağla. **Yeni trigger type eklenmeyecek** — mevcut `cron` type kullanılacak.

```typescript
// Crew deploy edildiğinde, her agent için mevcut trigger sistemiyle cron oluştur:
//
// await triggerRepo.create({
//   name: `${soul.identity.name} Heartbeat`,
//   type: 'cron',
//   config: { expression: soul.heartbeat.interval },
//   action: { type: 'run_heartbeat', agentId: soul.agentId },
//   enabled: soul.heartbeat.enabled,
// });
//
// Mevcut trigger engine'de yeni action type ekle:
// case 'run_heartbeat':
//   await heartbeatRunner.runHeartbeat(action.agentId);
//   break;
```

---

## BÖLÜM 3: AGENT İLETİŞİM SİSTEMİ

### 3.1 Communication Types

```typescript
// packages/core/src/agent/soul/communication.ts

export type AgentMessageType =
  | 'task_delegation' // "Scout, research trending topics about AI"
  | 'task_result' // "Here's what I found: ..."
  | 'status_update' // "Heartbeat complete, 3 items processed"
  | 'question' // "Should I cover this topic?"
  | 'feedback' // "Your last draft was too long"
  | 'alert' // "CI build failed!"
  | 'coordination' // "I'll handle X posts, you focus on LinkedIn"
  | 'knowledge_share'; // "FYI: New competitor launched today"

export interface AgentMessage {
  id: string;
  from: string; // agent ID or 'user'
  to: string; // agent ID or 'user' or 'broadcast'
  type: AgentMessageType;
  subject: string;
  content: string;
  attachments?: AgentAttachment[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  threadId?: string;
  requiresResponse: boolean;
  deadline?: Date;
  status: 'sent' | 'delivered' | 'read' | 'replied';
  crewId?: string;
  createdAt: Date;
  readAt?: Date;
}

export interface AgentAttachment {
  type: 'note' | 'task' | 'memory' | 'data' | 'artifact';
  id: string;
  title?: string;
}
```

### 3.2 Communication Bus

```typescript
// packages/core/src/agent/soul/communication-bus.ts

export class AgentCommunicationBus {
  constructor(
    private messageRepo: AgentMessageRepository,
    private eventBus: EventBus
  ) {}

  async send(msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const message: AgentMessage = {
      ...msg,
      id: crypto.randomUUID(),
      status: 'sent',
      createdAt: new Date(),
    };
    await this.messageRepo.create(message);
    this.eventBus.emit('agent:message:sent', {
      messageId: message.id,
      from: message.from,
      to: message.to,
      type: message.type,
      subject: message.subject,
    });
    return message.id;
  }

  async readInbox(
    agentId: string,
    options?: { unreadOnly?: boolean; limit?: number; types?: AgentMessageType[] }
  ): Promise<AgentMessage[]> {
    const messages = await this.messageRepo.findForAgent(agentId, {
      unreadOnly: options?.unreadOnly ?? true,
      limit: options?.limit ?? 20,
      types: options?.types,
    });
    if (messages.length > 0) {
      await this.messageRepo.markAsRead(messages.map((m) => m.id));
    }
    return messages;
  }

  async broadcast(
    crewId: string,
    msg: Omit<AgentMessage, 'id' | 'status' | 'createdAt' | 'to'>
  ): Promise<void> {
    const members = await this.messageRepo.getCrewMembers(crewId);
    for (const memberId of members) {
      if (memberId !== msg.from) {
        await this.send({ ...msg, to: memberId, crewId });
      }
    }
  }

  async getConversation(a1: string, a2: string, limit = 50): Promise<AgentMessage[]> {
    return this.messageRepo.findConversation(a1, a2, limit);
  }

  async getThread(threadId: string): Promise<AgentMessage[]> {
    return this.messageRepo.findByThread(threadId);
  }

  async getUnreadCount(agentId: string): Promise<number> {
    return this.messageRepo.countUnread(agentId);
  }
}
```

### 3.3 Agent Communication Tools

Meta-tool proxy üzerinden çalışan agent-to-agent messaging tool'ları:

```typescript
// packages/core/src/agent/tools/soul-communication-tools.ts

export const soulCommunicationTools = [
  {
    name: 'send_agent_message',
    description: 'Send a message to another agent in your crew.',
    category: 'agent_communication',
    parameters: {
      to_agent: { type: 'string', description: 'Name or ID of the target agent' },
      type: {
        type: 'string',
        enum: [
          'task_delegation',
          'task_result',
          'question',
          'feedback',
          'alert',
          'coordination',
          'knowledge_share',
        ],
      },
      subject: { type: 'string' },
      content: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
      requires_response: { type: 'boolean', default: false },
    },
  },
  {
    name: 'read_agent_inbox',
    description: 'Check your inbox for messages from other agents.',
    category: 'agent_communication',
    parameters: {
      unread_only: { type: 'boolean', default: true },
      from_agent: { type: 'string', description: 'Filter by sender (optional)' },
    },
  },
  {
    name: 'reply_to_agent',
    description: 'Reply to a message in an existing thread.',
    category: 'agent_communication',
    parameters: {
      thread_id: { type: 'string' },
      content: { type: 'string' },
    },
  },
];
```

---

## BÖLÜM 4: SOUL EVRİMİ

```typescript
// packages/core/src/agent/soul/evolution.ts

export class SoulEvolutionEngine {
  constructor(
    private soulRepo: SoulRepository,
    private memoryService: MemoryService,
    private agentEngine: AgentEngine,
    private heartbeatLogRepo: HeartbeatLogRepository
  ) {}

  /**
   * Kullanıcı feedback → soul evrilir.
   */
  async applyFeedback(agentId: string, feedback: SoulFeedback): Promise<AgentSoul> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul) throw new Error('Soul not found');

    // Snapshot BEFORE change
    await this.soulRepo.createVersion(soul, feedback.content, feedback.source);

    switch (feedback.type) {
      case 'praise':
        soul.evolution.learnings.push(`✅ ${feedback.content}`);
        break;
      case 'correction':
        soul.identity.boundaries.push(feedback.content);
        soul.evolution.learnings.push(`⚠️ Correction: ${feedback.content}`);
        break;
      case 'directive':
        soul.purpose.goals.push(feedback.content);
        break;
      case 'personality_tweak':
        soul.evolution.mutableTraits.push(feedback.content);
        soul.evolution.learnings.push(`🔧 Personality: ${feedback.content}`);
        break;
    }

    // Sınırla
    if (soul.evolution.learnings.length > 50)
      soul.evolution.learnings = soul.evolution.learnings.slice(-50);
    soul.evolution.feedbackLog.push(feedback);
    if (soul.evolution.feedbackLog.length > 100)
      soul.evolution.feedbackLog = soul.evolution.feedbackLog.slice(-100);

    soul.evolution.version++;
    soul.evolution.lastReflectionAt = new Date();
    soul.updatedAt = new Date();

    await this.soulRepo.update(soul);
    return soul;
  }

  /**
   * Self-reflection — agent kendi performansını değerlendirir.
   *
   * manual → çalışmaz
   * supervised → öneriler döner, user onaylar
   * autonomous → direkt uygulanır (coreTraits hariç)
   */
  async selfReflect(agentId: string): Promise<{ suggestions: string[]; applied: boolean }> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul || soul.evolution.evolutionMode === 'manual') {
      return { suggestions: [], applied: false };
    }

    const recentLogs = await this.heartbeatLogRepo.getRecent(agentId, 20);
    const recentFeedback = soul.evolution.feedbackLog.slice(-10);

    const reflectionPrompt = `
You are ${soul.identity.name}, reflecting on your recent performance.

Recent heartbeat results:
${recentLogs.map((l) => `- ${l.createdAt}: ${l.tasksRun.length} done, ${l.tasksFailed.length} failed, $${l.cost}`).join('\n')}

Recent feedback from user:
${recentFeedback.map((f) => `- [${f.type}] ${f.content}`).join('\n')}

Your current learnings:
${soul.evolution.learnings.slice(-5).join('\n')}

Suggest 1-3 specific, actionable improvements. Each starts with "I should..."
Return ONLY the suggestions, one per line.
    `.trim();

    const response = await this.agentEngine.processMessage({
      agentId,
      message: reflectionPrompt,
      context: { isReflection: true, maxTokens: 200 },
    });

    const suggestions = response.content
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.startsWith('I should'));

    if (soul.evolution.evolutionMode === 'autonomous') {
      for (const s of suggestions) soul.evolution.learnings.push(`🤔 Self: ${s}`);
      soul.evolution.version++;
      soul.evolution.lastReflectionAt = new Date();
      await this.soulRepo.createVersion(soul, 'Self-reflection', 'self_reflection');
      await this.soulRepo.update(soul);
      return { suggestions, applied: true };
    }

    return { suggestions, applied: false };
  }
}
```

---

## BÖLÜM 5: CREW SİSTEMİ

### 5.1 Crew Manager

```typescript
// packages/core/src/agent/soul/crew-manager.ts

export class CrewManager {
  constructor(
    private crewRepo: CrewRepository,
    private soulRepo: SoulRepository,
    private agentRepo: AgentRepository,
    private triggerRepo: TriggerRepository,
    private communicationBus: AgentCommunicationBus,
    private budgetTracker: BudgetTracker,
    private heartbeatLogRepo: HeartbeatLogRepository,
    private messageRepo: AgentMessageRepository
  ) {}

  /**
   * Template'den crew deploy et.
   */
  async deployCrew(
    templateId: string,
    customizations?: Record<string, Partial<AgentSoul>>
  ): Promise<Result<{ crewId: string; agents: string[] }, Error>> {
    const template = getCrewTemplate(templateId);
    if (!template) return { ok: false, error: new Error(`Template not found: ${templateId}`) };

    // 1. Crew kaydı
    const crew = await this.crewRepo.create({
      name: template.name,
      description: template.description,
      templateId,
      coordinationPattern: template.coordinationPattern,
      status: 'active',
    });

    const agentIds: string[] = [];

    // 2. Her agent: config → soul → trigger
    for (const tmpl of template.agents) {
      const custom = customizations?.[tmpl.identity.name];

      // Agent config (mevcut agents tablosu)
      const agent = await this.agentRepo.create({
        name: tmpl.identity.name,
        type: 'background',
        description: tmpl.purpose.mission,
        systemPrompt: '',
        isActive: true,
      });

      // Soul
      const soul: Omit<AgentSoul, 'id' | 'createdAt' | 'updatedAt'> = {
        agentId: agent.id,
        identity: { ...tmpl.identity, ...custom?.identity },
        purpose: { ...tmpl.purpose, ...custom?.purpose },
        autonomy: {
          level: 3,
          allowedActions: ['search_web', 'create_note', 'read_url', 'search_memories'],
          blockedActions: ['delete_data', 'execute_code'],
          requiresApproval: ['send_message_to_user', 'publish_post'],
          maxCostPerCycle: 0.5,
          maxCostPerDay: 5.0,
          maxCostPerMonth: 100.0,
          pauseOnConsecutiveErrors: 5,
          pauseOnBudgetExceeded: true,
          notifyUserOnPause: true,
          ...custom?.autonomy,
        },
        heartbeat: {
          ...tmpl.heartbeat,
          maxDurationMs: 120000,
          selfHealingEnabled: true,
          ...custom?.heartbeat,
        },
        relationships: { ...tmpl.relationships, crewId: crew.id },
        evolution: {
          version: 1,
          evolutionMode: 'supervised',
          coreTraits: [tmpl.identity.personality],
          mutableTraits: [],
          learnings: [],
          feedbackLog: [],
        },
        bootSequence: { onStart: [], onHeartbeat: ['read_inbox'], onMessage: [] },
      };

      await this.soulRepo.create(soul);
      await this.crewRepo.addMember(crew.id, agent.id, 'member');

      // Heartbeat trigger (mevcut cron sistemi)
      if (soul.heartbeat.enabled) {
        await this.triggerRepo.create({
          name: `${soul.identity.name} Heartbeat`,
          type: 'cron',
          config: { expression: soul.heartbeat.interval },
          action: { type: 'run_heartbeat', agentId: agent.id },
          enabled: true,
        });
      }

      agentIds.push(agent.id);
    }

    // 3. İlişkileri resolve et (name → ID)
    await this.resolveRelationships(crew.id);

    return { ok: true, value: { crewId: crew.id, agents: agentIds } };
  }

  async pauseCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.soulRepo.setHeartbeatEnabled(m.agentId, false);
      await this.triggerRepo.disableByAgent(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'paused');
  }

  async resumeCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.soulRepo.setHeartbeatEnabled(m.agentId, true);
      await this.triggerRepo.enableByAgent(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'active');
  }

  async disbandCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.triggerRepo.deleteByAgent(m.agentId);
      await this.agentRepo.deactivate(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'disbanded');
  }

  async getCrewStatus(crewId: string): Promise<CrewStatus> {
    const crew = await this.crewRepo.getById(crewId);
    const members = await this.crewRepo.getMembers(crewId);

    const agentStatuses = await Promise.all(
      members.map(async (m) => {
        const soul = await this.soulRepo.getByAgentId(m.agentId);
        const lastHB = await this.heartbeatLogRepo.getLatest(m.agentId);
        const dailyCost = await this.budgetTracker.getDailySpend(m.agentId);
        const unread = await this.communicationBus.getUnreadCount(m.agentId);
        return {
          agentId: m.agentId,
          name: soul?.identity.name || 'Unknown',
          emoji: soul?.identity.emoji || '❓',
          role: soul?.identity.role || '',
          status: soul?.heartbeat.enabled ? 'active' : 'paused',
          lastHeartbeat: lastHB?.createdAt || null,
          lastHeartbeatStatus: lastHB
            ? lastHB.tasksFailed.length > 0
              ? 'has_errors'
              : 'healthy'
            : 'never_run',
          errorCount: lastHB?.tasksFailed.length || 0,
          costToday: dailyCost,
          unreadMessages: unread,
          soulVersion: soul?.evolution.version || 0,
        };
      })
    );

    const messagesToday = await this.messageRepo.countToday(crewId);

    return {
      crew: {
        id: crew.id,
        name: crew.name,
        status: crew.status,
        coordinationPattern: crew.coordinationPattern,
        createdAt: crew.createdAt,
      },
      agents: agentStatuses,
      messagesToday,
      totalCostToday: agentStatuses.reduce((s, a) => s + a.costToday, 0),
      totalCostMonth: await this.getCrewMonthlyCost(crewId),
    };
  }

  private async getCrewMonthlyCost(crewId: string): Promise<number> {
    const members = await this.crewRepo.getMembers(crewId);
    let total = 0;
    for (const m of members) total += await this.budgetTracker.getMonthlySpend(m.agentId);
    return total;
  }

  private async resolveRelationships(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    const nameToId = new Map<string, string>();
    for (const m of members) {
      const soul = await this.soulRepo.getByAgentId(m.agentId);
      if (soul) nameToId.set(soul.identity.name.toLowerCase(), m.agentId);
    }
    for (const m of members) {
      const soul = await this.soulRepo.getByAgentId(m.agentId);
      if (!soul) continue;
      soul.relationships.peers = soul.relationships.peers
        .map((n) => nameToId.get(n.toLowerCase()) || n)
        .filter(Boolean);
      soul.relationships.delegates = soul.relationships.delegates
        .map((n) => nameToId.get(n.toLowerCase()) || n)
        .filter(Boolean);
      if (soul.relationships.reportsTo)
        soul.relationships.reportsTo =
          nameToId.get(soul.relationships.reportsTo.toLowerCase()) || soul.relationships.reportsTo;
      await this.soulRepo.update(soul);
    }
  }
}

export interface CrewStatus {
  crew: { id: string; name: string; status: string; coordinationPattern: string; createdAt: Date };
  agents: {
    agentId: string;
    name: string;
    emoji: string;
    role: string;
    status: string;
    lastHeartbeat: Date | null;
    lastHeartbeatStatus: 'healthy' | 'has_errors' | 'never_run';
    errorCount: number;
    costToday: number;
    unreadMessages: number;
    soulVersion: number;
  }[];
  messagesToday: number;
  totalCostToday: number;
  totalCostMonth: number;
}
```

### 5.2 Crew Templates

4 hazır template. Her biri kendi dosyasında:

```
packages/core/src/agent/soul/templates/
├── index.ts              → getCrewTemplate(), listCrewTemplates()
├── types.ts              → CrewTemplate, AgentSoulTemplate interfaces
├── content-crew.ts       → 📝 Content Creator (Scout 🔍 + Ghost ✍️)
├── devops-crew.ts        → ⚒️ Developer Ops (Forge ⚒️ + Scribe 📝)
├── research-crew.ts      → 💡 Research & Innovation (Radar 📡 + Spark 💡)
└── personal-ops-crew.ts  → 📋 Personal Operations (Chief 📋)
```

**Content Creator Crew** — `Scout` 4 saatte bir X/HN/Reddit tarar, `Ghost` günde 2 kez draft post yazar, Telegram'dan gönderir.

**Developer Ops Crew** — `Forge` 2 saatte bir PR/CI kontrol eder, `Scribe`'a docs görevi yazar. `Scribe` günlük docs günceller, Forge'a raporlar.

**Research & Innovation Crew** — `Radar` günde 3 kez Product Hunt/GitHub/YC tarar, haftalık brief yazar. `Spark` haftada 3 kez ürün konsepti geliştirir, haftalık innovation raporu gönderir.

**Personal Operations Crew** — `Chief` günde 3 kez: sabah briefing, öğlen check-in, akşam özet. Task yönetimi.

Detaylı template kodları bu spec'in önceki versiyonunda mevcut. Her template'te şunlar tanımlı: identity (name, emoji, role, personality, voice, quirks, boundaries), purpose (mission, goals, expertise, toolPreferences), heartbeat (interval, checklist with tasks, quiet hours), relationships (peers, delegates, reportsTo, channels).

---

## BÖLÜM 6: DATABASE MİGRASYONLARI

```sql
-- ── Agent Souls ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_souls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  identity JSONB NOT NULL,
  purpose JSONB NOT NULL,
  autonomy JSONB NOT NULL,
  heartbeat JSONB NOT NULL,
  relationships JSONB DEFAULT '{}',
  evolution JSONB NOT NULL,
  boot_sequence JSONB DEFAULT '{}',
  workspace_id UUID REFERENCES workspaces(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

CREATE INDEX idx_agent_souls_crew ON agent_souls USING GIN ((relationships->'crewId'));
CREATE INDEX idx_agent_souls_heartbeat ON agent_souls USING GIN ((heartbeat->'enabled'));

-- ── Soul Version History ────────────────────────────
CREATE TABLE IF NOT EXISTS agent_soul_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_id UUID NOT NULL REFERENCES agent_souls(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_reason TEXT,
  changed_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_soul_versions_soul ON agent_soul_versions(soul_id, version DESC);

-- ── Agent Messages ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL,
  subject VARCHAR(200),
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  priority VARCHAR(10) DEFAULT 'normal',
  thread_id UUID,
  requires_response BOOLEAN DEFAULT false,
  deadline TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'sent',
  crew_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_agent_messages_to ON agent_messages(to_agent_id, status);
CREATE INDEX idx_agent_messages_thread ON agent_messages(thread_id);
CREATE INDEX idx_agent_messages_crew ON agent_messages(crew_id, created_at DESC);
CREATE INDEX idx_agent_messages_from ON agent_messages(from_agent_id, created_at DESC);

-- ── Crews ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  template_id VARCHAR(50),
  coordination_pattern VARCHAR(20),
  status VARCHAR(20) DEFAULT 'active',
  workspace_id UUID REFERENCES workspaces(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Crew Membership ─────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_crew_members (
  crew_id UUID NOT NULL REFERENCES agent_crews(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (crew_id, agent_id)
);

-- ── Heartbeat Log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  soul_version INTEGER,
  tasks_run JSONB DEFAULT '[]',
  tasks_skipped JSONB DEFAULT '[]',
  tasks_failed JSONB DEFAULT '[]',
  duration_ms INTEGER,
  token_usage JSONB DEFAULT '{"input":0,"output":0}',
  cost DECIMAL(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_heartbeat_log_agent ON heartbeat_log(agent_id, created_at DESC);
CREATE INDEX idx_heartbeat_log_cost ON heartbeat_log(agent_id, created_at) WHERE cost > 0;
```

---

## BÖLÜM 7: GATEWAY ROUTE'LARI

```
Soul CRUD:
  GET    /api/v1/souls                        → list all
  GET    /api/v1/souls/:agentId               → get soul
  POST   /api/v1/souls                        → create
  PUT    /api/v1/souls/:agentId               → update
  DELETE /api/v1/souls/:agentId               → delete

Soul Evolution:
  GET    /api/v1/souls/:agentId/versions      → version history
  GET    /api/v1/souls/:agentId/versions/:v   → specific version
  POST   /api/v1/souls/:agentId/feedback      → give feedback
  POST   /api/v1/souls/:agentId/reflect       → trigger self-reflection
  GET    /api/v1/souls/:agentId/diff/:v1/:v2  → diff between versions

Crews:
  GET    /api/v1/crews                        → list all
  POST   /api/v1/crews                        → deploy new crew
  GET    /api/v1/crews/:id                    → details + status
  PUT    /api/v1/crews/:id                    → update config
  POST   /api/v1/crews/:id/pause              → pause
  POST   /api/v1/crews/:id/resume             → resume
  DELETE /api/v1/crews/:id                    → disband

Templates:
  GET    /api/v1/crew-templates               → list
  GET    /api/v1/crew-templates/:id           → details

Agent Messages:
  GET    /api/v1/agent-messages               → all (paginated)
  GET    /api/v1/agent-messages/agent/:id     → per agent
  GET    /api/v1/agent-messages/thread/:id    → thread
  GET    /api/v1/agent-messages/crew/:id      → crew messages
  POST   /api/v1/agent-messages               → user → agent message

Heartbeat Logs:
  GET    /api/v1/heartbeat-logs               → paginated
  GET    /api/v1/heartbeat-logs/agent/:id     → per agent
  GET    /api/v1/heartbeat-logs/crew/:id      → crew-wide
  GET    /api/v1/heartbeat-logs/stats         → aggregate stats
```

---

## BÖLÜM 8: UI SAYFALARI

**CrewDashboardPage** — Tüm crew'ler, per-agent health, maliyet, pause/resume/disband, deploy butonu
**SoulEditorPage** — Tabs: Identity | Purpose | Autonomy | Heartbeat | Relationships | Evolution
**AgentCommsPage** — Chat-like agent-to-agent messaging, threads, user inject
**HeartbeatLogPage** — Audit trail, task detayları, cost chart (Recharts)
**CrewTemplateCatalog** — Grid view, preview, customize & deploy

---

## BÖLÜM 9: CLI KOMUTLARI

```bash
ownpilot soul list | show | edit | feedback | reflect | history | diff | export | import
ownpilot crew list | templates | deploy | status | pause | resume | disband
ownpilot msg list | send | threads
ownpilot heartbeat run | log | cost
```

---

## BÖLÜM 10: DOSYA YAPISI

```
YENİ DOSYALAR:

packages/core/src/agent/soul/
├── index.ts
├── types.ts
├── builder.ts
├── heartbeat-runner.ts
├── budget-tracker.ts
├── evolution.ts
├── communication-bus.ts
├── crew-manager.ts
├── templates/
│   ├── index.ts, types.ts
│   ├── content-crew.ts
│   ├── devops-crew.ts
│   ├── research-crew.ts
│   └── personal-ops-crew.ts
└── __tests__/ (6 test files)

packages/core/src/agent/tools/soul-communication-tools.ts

packages/gateway/src/routes/{souls,crews,agent-messages,heartbeat-logs}.ts
packages/gateway/src/db/repositories/{soul,crew,agent-messages,heartbeat-log}.ts
packages/gateway/src/db/migrations/{souls,crews,messages,heartbeat-log}.ts

packages/ui/src/pages/{CrewDashboardPage,SoulEditorPage,AgentCommsPage,HeartbeatLogPage}.tsx
packages/ui/src/components/{CrewTemplateCatalog,SoulCard,AgentRelationshipGraph,HeartbeatTimeline,CostChart}.tsx

packages/cli/src/commands/{soul,crew,msg,heartbeat}.ts

MEVCUT DOSYA DEĞİŞİKLİKLERİ (MİNİMAL):

packages/core/src/agent/engine.ts         → soul prompt injection (5-10 satır)
packages/core/src/agent/tools/index.ts    → communication tools register
packages/gateway/src/routes/index.ts      → yeni route'ları ekle
packages/gateway/src/db/index.ts          → migration'ları ekle
packages/ui/src/App.tsx                   → yeni sayfa route'ları
packages/ui/src/components/Layout.tsx     → sidebar menü öğeleri
packages/cli/src/index.ts                → komut registration
```

---

## BÖLÜM 11: ACCEPTANCE CRITERIA

### Zorunlu

- [ ] Agent soul oluşturulabilir (UI + API + CLI)
- [ ] Soul, system prompt'a inject ediliyor — agent kişiliğine uygun cevap veriyor
- [ ] Soul version history çalışıyor
- [ ] "Content Creator Crew" deploy edilebiliyor → Scout + Ghost oluşuyor
- [ ] Scout heartbeat çalışıyor → web search → memory'ye kayıt
- [ ] Scout → Ghost inbox'ına mesaj gönderiyor
- [ ] Ghost inbox'ını okuyor → draft yazar → Telegram'a gönderir
- [ ] Agent-to-agent mesajlar UI'da görünüyor
- [ ] Kullanıcı feedback → soul evrilir, version artar
- [ ] Budget aşımında auto-pause + kullanıcıya bildirim
- [ ] Heartbeat log her çalışmayı kaydediyor
- [ ] Crew pause/resume çalışıyor
- [ ] Crew disband agent'ları deaktive ediyor

### Önemli

- [ ] DevOps + Research crew'leri deploy edilebiliyor
- [ ] Self-reflection çalışıyor (supervised: öneriler dönüyor)
- [ ] Soul diff iki versiyon arası farkı gösteriyor
- [ ] Quiet hours çalışıyor
- [ ] Staleness check force re-run yapıyor
- [ ] Cost chart UI'da render ediliyor
- [ ] CLI tüm komutlar çalışıyor

### Bonus

- [ ] Autonomous evolution mode
- [ ] Threaded agent conversations
- [ ] Custom crew builder wizard
- [ ] Soul export/import
- [ ] Broadcast mesajlar

---

## GENEL KURALLAR

- TypeScript strict, `any` yasak, JSDoc tüm public metotlarda
- Mevcut pattern'ları kullan: `Result<T,E>`, Repository, EventBus, Meta-tool proxy
- Vitest ile test, %80 coverage
- Idempotent migration'lar (IF NOT EXISTS), rollback dahil
- Boundaries ALWAYS system prompt'ta — agent geçemez
- Budget limitleri kesin — aşımda auto-pause
- PII detection aktif tüm agent mesajlarında
- Tailwind CSS 4, dark mode, responsive, Lucide React
- Hono route pattern'ları, consistent error format
- Yeni tool'lar meta-tool proxy üzerinden (search_tools/use_tool)

**Uygulama sırası:**

1. Types → 2. Builder → 3. Heartbeat Runner → 4. Communication Bus →
2. Evolution → 6. Crew Manager → 7. Templates → 8. Communication Tools →
3. DB Migrations → 10. Repositories → 11. Gateway Routes →
4. Engine soul injection → 13. UI pages → 14. CLI commands →
5. typecheck → 16. test → 17. build → 18. manual test
