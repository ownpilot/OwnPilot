import { motion } from 'framer-motion';
import { DocsLayout } from '@/components/layout/DocsLayout';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface ChangelogEntry {
  version: string;
  date: string;
  highlight?: boolean;
  added?: string[];
  fixed?: string[];
  changed?: string[];
  security?: string[];
  testing?: string[];
  performance?: string[];
}

const changelog: ChangelogEntry[] = [
  {
    version: '0.2.9',
    date: '2026-03-16',
    highlight: true,
    added: [
      'Mini Pomodoro Timer — Compact countdown widget in the global header bar, visible on all pages when a Pomodoro session is active. Shows progress ring, session type icon, and countdown. Click to navigate to Pomodoro page.',
      'MiniPomodoro component (packages/ui/src/components/MiniPomodoro.tsx) — Self-contained component with WebSocket updates and independent countdown',
    ],
    fixed: [
      'Pomodoro Timer Broken on Non-UTC Machines — Root cause: PostgreSQL TIMESTAMP columns + pg driver interprets stored values as local time. On non-UTC machines, startedAt was shifted backward. Fix: pg.types.setTypeParser(1114) forces UTC interpretation.',
      'Pomodoro Timer Effect — Removed timeLeft from the timer useEffect dependency array, which was needlessly recreating the interval every second',
      'CI: notification-router.test.ts — Test was hitting real PostgreSQL instead of mocks after preferences were migrated to DB-backed storage',
      'Code Formatting — Fixed 88 files with Prettier formatting issues failing format:check in CI',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-03-14',
    added: [
      '6 Workflow Node UI Components — DataStore (cyan), SchemaValidator (orange), Filter (emerald), Map (sky), Aggregate (amber), WebhookResponse (rose) with color-coded canvas nodes',
      '6 Node Config Panels — Full right-panel editors for each new node type with field editors, template validation, output alias, retry/timeout',
      'LLM Conversation Context Editor — Add/edit/remove multi-turn messages with role selector',
      'LLM Response Format UI — Text/JSON selector with JSON badge on canvas node',
      'Execution Progress Bar — Real-time toolbar showing running node name, completed/total count, retry counter',
      'Execution Timeline Labels — Node labels instead of raw IDs in both live and historical log views',
      '9 Workflow Integration Tests — Template resolution, condition branching, ForEach body, error propagation, filter/map/aggregate, DataStore persistence',
    ],
    fixed: [
      "Workflow Execution — node_complete event now includes retryAttempts; cancelled workflows logged as 'cancelled' instead of 'failed'",
      'Circular Dependencies (core) — Broke fragile tool-validation ↔ tools cycle with lazy import',
      'Circular Dependencies (gateway) — Broke 45+ cycles across 4 root causes: agents↔ws/server, tool-providers↔routes, webchat-handler↔server, normalizers barrel',
    ],
    changed: [
      'ToolPalette sidebar now shows all 23 node types',
      'NodeSearchPalette includes 6 new node types',
      'Node config router dispatches to 23 panel types',
    ],
  },
  {
    version: '0.1.9',
    date: '2026-03-14',
    added: [
      '6 New Workflow Nodes — DataStore (key-value persistence), SchemaValidator (JSON schema validation), Filter (array filtering), Map (array transformation), Aggregate (sum/count/avg/min/max/groupBy), WebhookResponse (HTTP response for webhook triggers)',
      "LLM Node Improvements — responseFormat: 'json' for auto-parsed JSON output, conversationMessages for multi-turn context",
      '5 Workflow Templates — GitHub Issue Triage, Data Pipeline, Scheduled Report, Multi-Source Merge, Approval Workflow',
      'Webhook Trigger Integration — POST /webhooks/workflow/:path with HMAC-SHA256 signature validation',
      'Approval Recovery — resumeFromApproval() auto-resumes paused workflows when approval is decided',
      'Fleet Command Tests — 68 comprehensive tests covering lifecycle, scheduling, task execution, budgets, concurrency',
      'Fleet Event-Driven Scheduling — Fleets can now trigger cycles on EventBus events',
    ],
    fixed: [
      'Cost Tracking (all systems) — calculateExecutionCost() shared utility now populates costUsd in BackgroundAgentRunner, SubagentRunner, FleetWorker, SoulHeartbeatService',
      'Fleet Dependency Cascade — Failed tasks now propagate failure to all dependent tasks',
      'Fleet Shared Context Mutation — structuredClone() prevents cross-worker context corruption',
      'Workflow DataStore Memory Leak — Added 10K entry limit with LRU eviction',
      'Workflow Node Limit — Max 500 nodes per workflow (DoS prevention)',
      'Agent Concurrent Guard — cycleInProgress flag prevents double cycle execution',
    ],
    security: [
      'Bump hono 4.12.3 → 4.12.8 (arbitrary file access, prototype pollution, cookie/SSE injection)',
      'Bump @hono/node-server 1.19.9 → 1.19.11 (authorization bypass via encoded slashes)',
      'Bump undici >=6.23.0 → >=6.24.1 (WebSocket DoS, CRLF injection, request smuggling)',
    ],
    testing: [
      '26,650+ tests total (core: 9,832; gateway: 16,236; ui: 141; cli: 293; channels: 148)',
    ],
  },
  {
    version: '0.1.8',
    date: '2026-03-14',
    added: [
      'Unified Channel System — Extensible channel SDK with UnifiedBus event router and UCP adapters; channels register via builder pattern',
      'Web Chat Channel Plugin — Embeddable floating chat widget for websites with real-time WebSocket messaging',
      'SMS Channel Plugin — SMS messaging via Twilio integration',
      'Fleet System — Multi-worker fleet management with worker assignment, budget configuration, and full admin UI',
      'Claw Mode (Autonomy L5) — Enhanced crew orchestration mode with elevated autonomy capabilities',
      'ACP for Coding Agents — Agent Communication Protocol enabled for all coding agent providers',
    ],
    fixed: [
      'Fleet Boot/Lifecycle — Fixed critical bugs preventing fleet system from starting: snake_case→camelCase mapping, race condition guard',
      'Autonomous Agent Scheduling — Fixed provider fallback, duration calculation, and scheduling bugs',
      'Production Hardening — Fixed shutdown ordering, memory leaks in timers, security edge cases',
    ],
  },
  {
    version: '0.1.6',
    date: '2026-03-06',
    added: [
      'Conversation Sidebar — Persistent conversation sidebar with ID-based session persistence and inline rename',
      'WhatsApp Group Support — Group message storage, group messages API, passive history sync',
      'WhatsApp Anti-Ban Hardening — P0 anti-ban safety filters, auto-reply protection',
      'Crew Orchestration Engine — Runtime crew orchestration with Plans tab integration',
      'Debug System Prompt Breakdown — Full system prompt section breakdown with DebugDrawer UI',
    ],
    fixed: [
      'Anthropic Prompt Caching — Moved orchestrator to static cache block; round time context to hour boundary',
      'Chat Double-Persistence — Extracted ConversationService, fixed messages being persisted twice',
    ],
    security: [
      'SSRF / DNS Rebinding Protection — isBlockedUrl() sync hostname check + isPrivateUrlAsync() with DNS rebinding detection',
      'Rate Limiter TTL Cleanup — Fixed memory leak in sliding window rate limiter',
    ],
  },
  {
    version: '0.1.5',
    date: '2026-03-02',
    added: [
      'Soul Agent System — Rich agent identity framework with personality, mission, role, heartbeat lifecycle, evolution tracking, and boot sequences',
      'Autonomous Hub — Unified command center consolidating soul agents, background agents, crews, messaging, and activity',
      'AI Agent Creator — Conversational agent creation via SSE streaming chat with a dedicated designer agent',
      'Crew System — Multi-agent crews with role assignments, delegation protocols, and crew templates',
      'Agent Communication — Inter-agent messaging with inbox, compose, and message history',
      'Activity Feed — Unified timeline with aggregate stats (total runs, success rate, avg duration, total cost)',
      '16+ Agent Templates — Pre-built configurations (Morning Briefer, News Monitor, Code Reviewer, Budget Tracker, etc.)',
      '77 new AI providers — Updated provider model data',
    ],
    fixed: [
      'AI Creator chatbot behavior — Fixed AI Agent Creator acting like a regular chatbot instead of designing agent configs',
      'Type safety — Removed unsafe as any and as unknown type assertions across all autonomous hub components',
      '12 bugs from BUGS.md — Resolved P0 through P3 priority bugs plus SEC-001 security finding',
    ],
  },
  {
    version: '0.1.4',
    date: '2026-02-28',
    added: [
      'Background Agents — Persistent autonomous agents with interval, continuous, or event-driven schedules',
      'Background Agent Full Tool Access — All 170+ tools, extensions, skills, MCP tools, memory injection',
      'Background Agent Workspace Isolation — Each agent gets an isolated file workspace',
      'WhatsApp Baileys Integration — Replaced Meta Cloud API with Baileys; QR code authentication (no Meta Business account needed)',
      'Channel User Approval System — Multi-step verification with approval code flow and manual admin approval',
      'EventBus Deep Integration — Unified event backbone; EventBusBridge translates dot-notation events to WebSocket colon-notation',
      'Extension SDK — Extensions can call 150+ built-in tools via utils.callTool()',
      '6 Default Extensions — Daily Briefing, Knowledge Base, Project Tracker, Smart Search, Automation Builder, Contact Enricher',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-02-26',
    added: [
      'CLI Tools Platform — 40+ discoverable CLI tools with automatic PATH-based detection',
      'Per-Tool Security Policies — allowed (auto-execute), prompt (require approval), blocked (reject) per user per tool',
      'Dynamic Risk Scoring — Catalog-based risk levels (low/medium/high/critical) feed into the autonomy risk engine',
      'Coding Agents — Orchestrate Claude Code, Codex, Gemini CLI with real-time terminal output streaming',
      'Dual Execution Modes — Auto mode (headless child_process.spawn) and interactive mode (PTY terminal)',
      'Model Routing — Per-process model selection with fallback chains',
      'Extended Thinking — Anthropic extended thinking support',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-02-23',
    added: [
      'Pulse System — Autonomous AI-driven engine that proactively gathers context, evaluates signals, and executes actions on adaptive 5-15 min timer',
      'Pulse Directives — Configurable evaluation rules, action cooldowns, blocked actions, and 4 preset templates',
      "Pulse Activity Monitor — Live activity banner with stage progression and 'Run Now' button",
      'Pulse History & Stats — Paginated pulse log with signal IDs, urgency scores, and expandable details',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-02-22',
    added: [
      'Multi-Provider AI — 4 native providers + 8 aggregators + any OpenAI-compatible endpoint',
      'Local AI Support — Ollama, LM Studio, LocalAI, and vLLM auto-discovery',
      '170+ Built-in Tools across 28 categories',
      'Meta-tool Proxy — Only 4 meta-tools sent to the LLM',
      'MCP Integration — Client and Server',
      'Personal Data — Notes, Tasks, Bookmarks, Contacts, Calendar, Expenses',
      '5 Autonomy Levels — Manual, Assisted, Supervised, Autonomous, Full',
      'Workflows — Visual multi-step automation with drag-and-drop builder',
      'Telegram Bot — Grammy-based bot',
      'Sandboxed Code Execution — Docker isolation, VM, Worker threads',
      'AES-256-GCM encryption + PBKDF2 — zero dependency',
      'PII Detection & Redaction — 15+ categories',
      'Tamper-Evident Audit — Hash chain verification',
    ],
  },
];

const sectionColors: Record<string, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  fixed: 'text-blue-600 dark:text-blue-400',
  changed: 'text-orange-600 dark:text-orange-400',
  security: 'text-red-600 dark:text-red-400',
  testing: 'text-purple-600 dark:text-purple-400',
  performance: 'text-yellow-600 dark:text-yellow-500',
};

const sectionLabels: Record<string, string> = {
  added: 'Added',
  fixed: 'Fixed',
  changed: 'Changed',
  security: 'Security',
  testing: 'Testing',
  performance: 'Performance',
};

export function ChangelogPage() {
  return (
    <DocsLayout>
      <div className="mb-8">
        <Badge variant="purple" className="mb-3">
          Changelog
        </Badge>
        <h1>Changelog</h1>
        <p>
          All notable changes to OwnPilot are documented here. The format follows{' '}
          <a href="https://keepachangelog.com/en/1.1.0/" target="_blank" rel="noopener noreferrer">
            Keep a Changelog
          </a>{' '}
          and adheres to{' '}
          <a href="https://semver.org/" target="_blank" rel="noopener noreferrer">
            Semantic Versioning
          </a>
          .
        </p>
      </div>

      <div className="space-y-12">
        {changelog.map((entry, i) => (
          <motion.div
            key={entry.version}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              'relative pl-8 border-l-2',
              entry.highlight ? 'border-[hsl(var(--primary))]' : 'border-[var(--color-border)]'
            )}
          >
            {/* Dot */}
            <div
              className={cn(
                'absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-[var(--color-bg)]',
                entry.highlight ? 'border-[hsl(var(--primary))]' : 'border-[var(--color-border)]'
              )}
            />

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <a
                href={`https://github.com/ownpilot/ownpilot/releases/tag/v${entry.version}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xl font-bold text-[var(--color-text)] hover:text-[hsl(var(--primary))] transition-colors no-underline"
              >
                v{entry.version}
              </a>
              {entry.highlight && <Badge variant="purple">Latest</Badge>}
              <time className="text-sm text-[var(--color-text-subtle)]">{entry.date}</time>
            </div>

            {(['added', 'fixed', 'changed', 'security', 'testing', 'performance'] as const).map(
              (section) => {
                const items = entry[section];
                if (!items || items.length === 0) return null;
                return (
                  <div key={section} className="mb-4">
                    <h4
                      className={cn(
                        'text-sm font-semibold uppercase tracking-wider mb-2',
                        sectionColors[section]
                      )}
                    >
                      {sectionLabels[section]}
                    </h4>
                    <ul className="space-y-1">
                      {items.map((item, j) => (
                        <li
                          key={j}
                          className="text-sm text-[var(--color-text-muted)] leading-relaxed pl-4 relative"
                        >
                          <span className="absolute left-0 text-[var(--color-text-subtle)]">—</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
            )}
          </motion.div>
        ))}
      </div>
    </DocsLayout>
  );
}
