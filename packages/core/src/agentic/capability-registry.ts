/**
 * Agentic Capability Registry
 *
 * A centralized registry where all agent types (claws, souls, coding agents,
 * crews, workflows, channels, triggers) register their capabilities for
 * dynamic discovery and routing.
 *
 * This is the "DNS for agent skills" — any component can query what
 * capabilities exist, search by keyword, and subscribe to changes.
 *
 * Usage:
 *   const registry = createCapabilityRegistry();
 *   registry.register({ id: 'claw:research', name: 'Web Research', ... });
 *   const results = registry.search(['research', 'web']);
 */

import type {
  CapabilityEntry,
  CapabilityQuery,
  CapabilityLookupResult,
  ICapabilityRegistry,
  ExecutorKind,
} from './types.js';

// ============================================================================
// Built-in Capability Definitions
// ============================================================================

/**
 * Default capabilities that are always available in OwnPilot.
 * Registered automatically when the registry is created.
 */
export function getBuiltInCapabilities(): CapabilityEntry[] {
  return [
    // ── Claw Capabilities ──
    {
      id: 'claw:continuous-autonomy',
      name: 'Continuous Autonomous Execution',
      description:
        'Runs an autonomous claw agent in a continuous loop with adaptive delays. ' +
        'The agent maintains persistent state across cycles, manages a task plan, ' +
        'and can use all 250+ tools. Supports operator intervention via inbox messages.',
      executorKind: 'claw',
      providerId: 'ownpilot:claw',
      tags: ['autonomous', 'continuous', 'background', 'persistent', 'agent'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'claw:single-shot',
      name: 'Single-Shot Task Execution',
      description:
        'Executes a single task using the full claw agent runtime with LLM reasoning, ' +
        'all 250+ tools, workspace access, and coding agent support. Auto-stops on completion.',
      executorKind: 'claw',
      providerId: 'ownpilot:claw',
      tags: ['autonomous', 'single-shot', 'task', 'research', 'code'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },
    {
      id: 'claw:interval-autonomy',
      name: 'Interval-Based Periodic Execution',
      description:
        'Runs an autonomous claw agent on a fixed interval. Useful for periodic monitoring, ' +
        'health checks, content generation, and recurring data processing.',
      executorKind: 'claw',
      providerId: 'ownpilot:claw',
      tags: ['autonomous', 'interval', 'periodic', 'monitoring', 'scheduled'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'claw:event-driven',
      name: 'Event-Driven Autonomous Agent',
      description:
        'An autonomous claw agent that activates in response to specific events ' +
        '(system events, webhook calls, channel messages, agent messages). ' +
        'Idle between events — zero cost when not firing.',
      executorKind: 'claw',
      providerId: 'ownpilot:claw',
      tags: ['autonomous', 'event-driven', 'reactive', 'webhook', 'listener'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },

    // ── Soul Heartbeat Capabilities ──
    {
      id: 'soul:heartbeat',
      name: 'Soul Heartbeat Automation',
      description:
        'A soul identity with scheduled heartbeat tasks. Runs autonomously on ' +
        'a cron schedule, executing a checklist of tasks each cycle. Supports ' +
        'quiet hours, self-healing, budget tracking, and evolution.',
      executorKind: 'soul_heartbeat',
      providerId: 'ownpilot:soul',
      tags: ['soul', 'heartbeat', 'scheduled', 'identity', 'automation', 'cron'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'soul:crew-leader',
      name: 'Crew Leadership & Coordination',
      description:
        'An agent soul acting as a crew leader — coordinating multiple sub-agents, ' +
        'delegating tasks via the communication bus, aggregating results, and ' +
        'reporting status. Supports hub-and-spoke, peer-to-peer, pipeline, ' +
        'and hierarchical coordination patterns.',
      executorKind: 'crew',
      providerId: 'ownpilot:soul',
      tags: ['crew', 'coordination', 'multi-agent', 'delegation', 'leadership'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },

    // ── Coding Agent Capabilities ──
    {
      id: 'coding-agent:claude-code',
      name: 'Claude Code CLI Integration',
      description:
        'External Claude Code CLI agent for deep code analysis, refactoring, ' +
        'testing, and code generation. Operates in the workspace directory with ' +
        'full filesystem access.',
      executorKind: 'coding_agent',
      providerId: 'ownpilot:coding-agent',
      tags: ['code', 'claude', 'cli', 'refactoring', 'analysis'],
      requiresApproval: false,
      costTier: 'expensive',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'coding-agent:codex',
      name: 'Codex CLI Integration',
      description:
        'OpenAI Codex CLI agent for code generation, debugging, and ' +
        'software engineering tasks. Runs in sandboxed workspace.',
      executorKind: 'coding_agent',
      providerId: 'ownpilot:coding-agent',
      tags: ['code', 'codex', 'openai', 'cli', 'generation'],
      requiresApproval: false,
      costTier: 'expensive',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },

    // ── Workflow Capabilities ──
    {
      id: 'workflow:dag',
      name: 'Visual DAG Workflow Execution',
      description:
        'Executes a visual Directed Acyclic Graph workflow with LLM nodes, ' +
        'code nodes, tool nodes, conditional branching, parallel execution, ' +
        'foreach loops, and data transformation steps.',
      executorKind: 'workflow',
      providerId: 'ownpilot:workflow',
      tags: ['workflow', 'dag', 'pipeline', 'visual', 'automation'],
      requiresApproval: false,
      costTier: 'moderate',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },

    // ── Trigger Capabilities ──
    {
      id: 'trigger:schedule',
      name: 'Cron-Scheduled Triggers',
      description:
        'Proactive triggers that fire on a cron schedule. Each trigger can ' +
        'execute a chat, tool call, notification, goal check, memory summary, ' +
        'or workflow action. Supports pre-run gating scripts.',
      executorKind: 'trigger',
      providerId: 'ownpilot:trigger',
      tags: ['trigger', 'cron', 'schedule', 'automation', 'scheduled'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'trigger:event',
      name: 'Event-Driven Triggers',
      description:
        'Triggers that fire in response to system events. Supports filtering ' +
        'by event type and payload content. Zero cost when idle.',
      executorKind: 'trigger',
      providerId: 'ownpilot:trigger',
      tags: ['trigger', 'event', 'reactive', 'listener'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'instant',
      registeredAt: new Date(),
    },
    {
      id: 'trigger:condition',
      name: 'Condition-Evaluated Triggers',
      description:
        'Triggers that periodically evaluate a JavaScript condition expression ' +
        'and fire when it returns true. Useful for threshold-based automation.',
      executorKind: 'trigger',
      providerId: 'ownpilot:trigger',
      tags: ['trigger', 'condition', 'threshold', 'monitoring'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'slow',
      registeredAt: new Date(),
    },
    {
      id: 'trigger:webhook',
      name: 'Webhook Receiver Triggers',
      description:
        'Triggers that receive external webhook calls with optional secret ' +
        'verification and allowed-source filtering. Fires the action on each call.',
      executorKind: 'trigger',
      providerId: 'ownpilot:trigger',
      tags: ['trigger', 'webhook', 'external', 'integration'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'instant',
      registeredAt: new Date(),
    },

    // ── Channel Capabilities ──
    {
      id: 'channel:telegram',
      name: 'Telegram Messaging Channel',
      description:
        'Two-way communication via Telegram. Agents can send messages, ' +
        'receive user input, handle file uploads, and render rich output ' +
        '(markdown, images, documents).',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'telegram', 'messaging', 'communication', 'social'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },
    {
      id: 'channel:discord',
      name: 'Discord Messaging Channel',
      description:
        'Two-way communication via Discord. Supports slash commands, ' +
        'threads, embeds, file attachments, and role-based access.',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'discord', 'messaging', 'communication', 'social'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },
    {
      id: 'channel:slack',
      name: 'Slack Messaging Channel',
      description:
        'Two-way communication via Slack. Supports slash commands, ' +
        'thread replies, rich message blocks, and file sharing.',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'slack', 'messaging', 'communication', 'business'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },
    {
      id: 'channel:email',
      name: 'Email Communication Channel',
      description:
        'Two-way communication via Email (IMAP/SMTP). Agents can send ' +
        'and receive emails, process attachments, and handle threading.',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'email', 'communication', 'async'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },
    {
      id: 'channel:whatsapp',
      name: 'WhatsApp Messaging Channel',
      description:
        'Two-way communication via WhatsApp Business API. Supports ' +
        'text, images, documents, and interactive messages.',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'whatsapp', 'messaging', 'communication', 'social'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },
    {
      id: 'channel:webchat',
      name: 'Web Chat Widget Channel',
      description:
        'Embeddable web chat widget for websites. Provides real-time ' +
        'conversational AI to end users via a customizable chat bubble.',
      executorKind: 'channel',
      providerId: 'ownpilot:channel',
      tags: ['channel', 'webchat', 'widget', 'customer-support', 'conversation'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },

    // ── Direct LLM ──
    {
      id: 'direct-llm:chat',
      name: 'Direct LLM Conversation',
      description:
        'Direct LLM chat without tool orchestration. Simple question answering, ' +
        "content generation, analysis, and creative tasks that don't need " +
        'external tool access.',
      executorKind: 'direct_llm',
      providerId: 'ownpilot:llm',
      tags: ['llm', 'chat', 'conversation', 'generation', 'analysis'],
      requiresApproval: false,
      costTier: 'cheap',
      latencyTier: 'fast',
      registeredAt: new Date(),
    },

    // ── Sandbox Code Execution ──
    {
      id: 'sandbox:javascript',
      name: 'JavaScript Sandbox Execution',
      description:
        'Isolated JavaScript sandbox for safe code execution. Supports ' +
        'Node.js APIs with configurable permissions (no network, no filesystem ' +
        'by default).',
      executorKind: 'sandbox_code',
      providerId: 'ownpilot:sandbox',
      tags: ['sandbox', 'javascript', 'code', 'execution', 'safe'],
      requiresApproval: true,
      costTier: 'free',
      latencyTier: 'instant',
      registeredAt: new Date(),
    },
    {
      id: 'sandbox:python',
      name: 'Python Sandbox Execution',
      description:
        'Isolated Python sandbox for safe code execution. Optionally runs ' +
        'in Docker for full isolation. Supports pip packages and data processing.',
      executorKind: 'sandbox_code',
      providerId: 'ownpilot:sandbox',
      tags: ['sandbox', 'python', 'code', 'execution', 'safe', 'docker'],
      requiresApproval: true,
      costTier: 'free',
      latencyTier: 'medium',
      registeredAt: new Date(),
    },

    // ── Tool Catalog ──
    {
      id: 'tools:all',
      name: 'Complete Tool Catalog (250+ Tools)',
      description:
        'Access to the full OwnPilot tool registry: filesystem operations, ' +
        'web fetch, git, memory management, goals, personal data, custom data, ' +
        'code execution, audio processing, image processing, PDF tools, ' +
        'weather, email, utility tools, and more.',
      executorKind: 'tool_catalog',
      providerId: 'ownpilot:tools',
      tags: ['tools', 'catalog', 'filesystem', 'web', 'git', 'memory', 'utility'],
      requiresApproval: false,
      costTier: 'free',
      latencyTier: 'instant',
      registeredAt: new Date(),
    },
  ];
}

// ============================================================================
// Capability Registry Implementation
// ============================================================================

type RegistryEventListener = (entry: CapabilityEntry) => void;

export class CapabilityRegistry implements ICapabilityRegistry {
  private readonly entries = new Map<string, CapabilityEntry>();
  private readonly listeners = new Map<'register' | 'unregister', Set<RegistryEventListener>>();

  constructor(registerBuiltIns = true) {
    if (registerBuiltIns) {
      for (const cap of getBuiltInCapabilities()) {
        this.entries.set(cap.id, cap);
      }
    }
  }

  register(entry: CapabilityEntry): void {
    this.entries.set(entry.id, { ...entry, registeredAt: new Date() });
    this.listeners.get('register')?.forEach((fn) => fn(entry));
  }

  unregister(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.listeners.get('unregister')?.forEach((fn) => fn(entry));
    return true;
  }

  query(query: CapabilityQuery): CapabilityLookupResult {
    let results = Array.from(this.entries.values());

    if (query.keywords && query.keywords.length > 0) {
      const lowerKeywords = query.keywords.map((k) => k.toLowerCase());
      results = results.filter((e) => {
        const searchText = `${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase();
        return lowerKeywords.some((kw) => searchText.includes(kw));
      });
    }

    if (query.executorKind) {
      const kinds = Array.isArray(query.executorKind) ? query.executorKind : [query.executorKind];
      results = results.filter((e) => kinds.includes(e.executorKind));
    }

    if (query.providerId) {
      results = results.filter((e) => e.providerId === query.providerId);
    }

    if (query.unattendedOnly) {
      results = results.filter((e) => !e.requiresApproval);
    }

    if (query.maxCostTier) {
      const tiers = ['free', 'cheap', 'moderate', 'expensive'];
      const maxIdx = tiers.indexOf(query.maxCostTier);
      if (maxIdx >= 0) {
        results = results.filter((e) => {
          const idx = tiers.indexOf(e.costTier ?? 'moderate');
          return idx >= 0 && idx <= maxIdx;
        });
      }
    }

    const total = results.length;
    const limit = query.limit ?? 20;
    const entries = results.slice(0, limit);

    return { entries, total, query };
  }

  get(id: string): CapabilityEntry | undefined {
    return this.entries.get(id);
  }

  getAll(): CapabilityEntry[] {
    return Array.from(this.entries.values());
  }

  getByProvider(providerId: string): CapabilityEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.providerId === providerId);
  }

  getByKind(kind: ExecutorKind): CapabilityEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.executorKind === kind);
  }

  search(keywords: string[], limit = 10): CapabilityEntry[] {
    return this.query({ keywords, limit }).entries;
  }

  get size(): number {
    return this.entries.size;
  }

  on(event: 'register' | 'unregister', listener: RegistryEventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

let _globalRegistry: CapabilityRegistry | null = null;

/**
 * Get the global capability registry singleton.
 * Created on first call with built-in capabilities pre-registered.
 */
export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new CapabilityRegistry(true);
  }
  return _globalRegistry;
}

/**
 * Replace the global registry (for testing or custom configurations).
 * Returns the previous registry.
 */
export function setCapabilityRegistry(registry: CapabilityRegistry): CapabilityRegistry | null {
  const prev = _globalRegistry;
  _globalRegistry = registry;
  return prev;
}

/**
 * Reset the global registry to a fresh state (for testing).
 */
export function resetCapabilityRegistry(): void {
  _globalRegistry = null;
}
