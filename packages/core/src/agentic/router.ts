/**
 * Agentic Task Router
 *
 * Analyzes natural language tasks and routes them to the optimal execution
 * strategy. Uses heuristics and pattern matching to determine:
 * - Which executor kind is best suited for the task
 * - Whether multi-step orchestration is needed
 * - What constraints apply
 * - Fallback strategies on failure
 *
 * The router does NOT execute tasks — it produces an ExecutionPlan that
 * the AgenticOrchestrator then executes.
 */

import { generateId } from '../services/id-utils.js';
import type {
  AgenticTask,
  ExecutionPlan,
  ExecutionStep,
  ExecutorKind,
  TaskAnalysis,
  TaskTriggerStrategy,
  IAgenticRouter,
} from './types.js';
import { getCapabilityRegistry, type CapabilityRegistry } from './capability-registry.js';

// ============================================================================
// Pattern Definitions for Task Analysis
// ============================================================================

interface RoutingPattern {
  readonly keywords: string[];
  readonly kind: ExecutorKind;
  readonly weight: number; // 0-1, higher = more confident
  readonly description: string;
}

const ROUTING_PATTERNS: RoutingPattern[] = [
  // ── Claw: Single-Shot ──
  {
    keywords: [
      'research',
      'investigate',
      'analyze',
      'report',
      'write a report',
      'deep dive',
      'explore',
      'examine',
      'study',
      'evaluate',
      'assess',
      'comprehensive analysis',
      'thorough investigation',
    ],
    kind: 'claw',
    weight: 0.85,
    description: 'Deep research/investigation tasks need full claw runtime',
  },
  {
    keywords: [
      'build',
      'create',
      'develop',
      'implement',
      'write code',
      'generate',
      'scaffold',
      'prototype',
      'refactor',
      'migrate',
      'port',
    ],
    kind: 'claw',
    weight: 0.8,
    description: 'Code generation/refactoring tasks need tool access',
  },
  {
    keywords: [
      'debug',
      'fix',
      'repair',
      'troubleshoot',
      'resolve',
      'diagnose',
      'root cause',
      'bug',
      'issue',
      'problem',
    ],
    kind: 'claw',
    weight: 0.75,
    description: 'Debugging tasks benefit from full tool access',
  },
  {
    keywords: [
      'complex',
      'multi-step',
      'in-depth',
      'thorough',
      'comprehensive',
      'end-to-end',
      'full',
    ],
    kind: 'claw',
    weight: 0.6,
    description: 'Complex tasks need multi-step LLM reasoning',
  },

  // ── Claw: Continuous ──
  {
    keywords: [
      'continuously',
      'constantly',
      'always',
      'monitor in background',
      'watch',
      'keep running',
      'long-running',
      'persistent',
    ],
    kind: 'claw',
    weight: 0.9,
    description: 'Long-running/persistent tasks suit continuous claw mode',
  },

  // ── Coding Agent ──
  {
    keywords: [
      'complex code',
      'large refactor',
      'codebase-wide',
      'multi-file edit',
      'rewrite module',
      'architecture change',
      'dependency update',
    ],
    kind: 'coding_agent',
    weight: 0.85,
    description: 'Large-scale code changes need a dedicated coding agent',
  },

  // ── Direct LLM ──
  {
    keywords: [
      'quick question',
      'explain',
      'summarize',
      'translate',
      'paraphrase',
      'rewrite this',
      'proofread',
      'grammar check',
      'spelling',
    ],
    kind: 'direct_llm',
    weight: 0.9,
    description: 'Simple text tasks need no tools — direct LLM is cheapest',
  },
  {
    keywords: [
      'brainstorm',
      'idea',
      'suggest',
      'recommend',
      'opinion',
      'think',
      'creative',
      'write a poem',
      'story',
    ],
    kind: 'direct_llm',
    weight: 0.8,
    description: 'Creative/ideation tasks need only LLM reasoning',
  },

  // ── Soul Heartbeat ──
  {
    keywords: [
      'every day',
      'daily',
      'every hour',
      'every week',
      'weekly',
      'on schedule',
      'periodically',
      'regularly',
      'recurring',
      'cron',
      'heartbeat',
      'routine check',
      'scheduled task',
    ],
    kind: 'soul_heartbeat',
    weight: 0.85,
    description: 'Recurring scheduled tasks need soul heartbeat',
  },

  // ── Workflow ──
  {
    keywords: [
      'workflow',
      'pipeline',
      'multi-stage',
      'sequential steps',
      'if this then',
      'conditional',
      'branch',
      'parallel',
      'foreach',
      'for each item',
      'batch process',
    ],
    kind: 'workflow',
    weight: 0.8,
    description: 'Multi-stage pipelines need workflow DAG execution',
  },

  // ── Trigger ──
  {
    keywords: [
      'when event',
      'on event',
      'whenever',
      'trigger',
      'webhook',
      'if condition',
      'when condition',
      'notify me when',
      'alert me when',
      'send notification',
      'fire when',
    ],
    kind: 'trigger',
    weight: 0.85,
    description: 'Event/condition/webhook triggers need trigger engine',
  },

  // ── Channel ──
  {
    keywords: [
      'send message',
      'send to telegram',
      'send to discord',
      'send to slack',
      'post to',
      'notify via',
      'message channel',
      'broadcast to',
    ],
    kind: 'channel',
    weight: 0.9,
    description: 'Outbound messaging needs channel service',
  },
];

// Patterns that indicate the task needs code execution
const CODE_EXECUTION_PATTERNS = [
  'run code',
  'execute script',
  'run this',
  'execute',
  'shell command',
  'npm install',
  'pip install',
  'compile',
  'build',
  'run tests',
  'run command',
  'bash',
  'terminal',
  'cli',
];

// Patterns that indicate the task needs external data access
const EXTERNAL_DATA_PATTERNS = [
  'fetch',
  'download',
  'scrape',
  'crawl',
  'api call',
  'web search',
  'search the web',
  'look up',
  'find online',
  'get data from',
  'pull from',
  'import from',
  'connect to',
];

// ============================================================================
// Task Analysis
// ============================================================================

/** Default task constraints for different executor kinds. */
const DEFAULT_CONSTRAINTS: Record<
  ExecutorKind,
  {
    maxCostUsd?: number;
    timeoutMs: number;
    maxTurns: number;
    maxToolCalls: number;
    allowCodeExecution: boolean;
    allowNetwork: boolean;
  }
> = {
  claw: {
    maxCostUsd: 1.0,
    timeoutMs: 600_000,
    maxTurns: 50,
    maxToolCalls: 500,
    allowCodeExecution: true,
    allowNetwork: true,
  },
  soul_heartbeat: {
    maxCostUsd: 0.1,
    timeoutMs: 120_000,
    maxTurns: 10,
    maxToolCalls: 50,
    allowCodeExecution: false,
    allowNetwork: false,
  },
  crew: {
    maxCostUsd: 2.0,
    timeoutMs: 1_800_000,
    maxTurns: 100,
    maxToolCalls: 1000,
    allowCodeExecution: true,
    allowNetwork: true,
  },
  coding_agent: {
    maxCostUsd: 3.0,
    timeoutMs: 3_600_000,
    maxTurns: 200,
    maxToolCalls: 2000,
    allowCodeExecution: true,
    allowNetwork: true,
  },
  workflow: {
    maxCostUsd: 1.0,
    timeoutMs: 600_000,
    maxTurns: 10,
    maxToolCalls: 100,
    allowCodeExecution: true,
    allowNetwork: true,
  },
  trigger: {
    maxCostUsd: 0.05,
    timeoutMs: 30_000,
    maxTurns: 5,
    maxToolCalls: 20,
    allowCodeExecution: true,
    allowNetwork: true,
  },
  channel: {
    maxCostUsd: 0.01,
    timeoutMs: 10_000,
    maxTurns: 1,
    maxToolCalls: 0,
    allowCodeExecution: false,
    allowNetwork: true,
  },
  direct_llm: {
    maxCostUsd: 0.02,
    timeoutMs: 30_000,
    maxTurns: 1,
    maxToolCalls: 0,
    allowCodeExecution: false,
    allowNetwork: false,
  },
  sandbox_code: {
    maxCostUsd: 0.01,
    timeoutMs: 60_000,
    maxTurns: 1,
    maxToolCalls: 0,
    allowCodeExecution: true,
    allowNetwork: false,
  },
  tool_catalog: {
    maxCostUsd: 0.01,
    timeoutMs: 30_000,
    maxTurns: 1,
    maxToolCalls: 1,
    allowCodeExecution: false,
    allowNetwork: false,
  },
};

/** Parse a trigger strategy from task text. */
function inferTriggerStrategy(description: string): TaskTriggerStrategy | undefined {
  const lower = description.toLowerCase();

  // Continuous
  if (
    lower.includes('continuously') ||
    lower.includes('constantly') ||
    lower.includes('always run')
  ) {
    return { type: 'continuous' };
  }

  // Interval
  const intervalMatch = lower.match(/every\s+(\d+)\s*(second|minute|hour|s|m|h)/);
  if (intervalMatch) {
    const num = parseInt(intervalMatch[1]!, 10);
    const unit = intervalMatch[2]!;
    const ms = unit.startsWith('s')
      ? num * 1000
      : unit.startsWith('m')
        ? num * 60_000
        : num * 3_600_000;
    return { type: 'interval', intervalMs: ms };
  }

  // Cron-like
  if (lower.includes('daily') || lower.includes('every day') || lower.includes('each day')) {
    return { type: 'scheduled', cron: '0 9 * * *', timezone: 'UTC' };
  }
  if (lower.includes('hourly') || lower.includes('every hour')) {
    return { type: 'scheduled', cron: '0 * * * *', timezone: 'UTC' };
  }
  if (lower.includes('weekly') || lower.includes('every week')) {
    return { type: 'scheduled', cron: '0 9 * * 1', timezone: 'UTC' };
  }

  // Event-driven
  if (lower.includes('when') || lower.includes('on event') || lower.includes('whenever')) {
    return { type: 'event', eventType: 'custom', filters: undefined };
  }

  return undefined;
}

// ============================================================================
// Router Implementation
// ============================================================================

export class AgenticRouter implements IAgenticRouter {
  private readonly registry: CapabilityRegistry;

  constructor(registry?: CapabilityRegistry) {
    this.registry = registry ?? getCapabilityRegistry();
  }

  /**
   * Analyze a task and determine the optimal execution strategy.
   */
  async analyze(task: Omit<AgenticTask, 'id'>): Promise<TaskAnalysis> {
    const lowerDesc = task.description.toLowerCase();

    // Score each executor kind based on pattern matches
    const scores = new Map<ExecutorKind, { score: number; reasons: string[] }>();
    for (const kind of [...new Set(ROUTING_PATTERNS.map((p) => p.kind))]) {
      scores.set(kind, { score: 0, reasons: [] });
    }

    for (const pattern of ROUTING_PATTERNS) {
      const matched = pattern.keywords.some((kw) => lowerDesc.includes(kw));
      if (matched) {
        const current = scores.get(pattern.kind)!;
        current.score = Math.max(current.score, pattern.weight);
        current.reasons.push(pattern.description);
      }
    }

    // If task mentions a trigger strategy, weight toward claw/soul/heartbeat
    const hasTrigger = !!inferTriggerStrategy(task.description);
    if (hasTrigger) {
      scores.get('claw')!.score += 0.2;
      scores.get('soul_heartbeat')!.score += 0.3;
      scores.get('trigger')!.score += 0.3;
    }

    // If task mentions code execution, weight toward claw/coding_agent
    const likelyNeedsCodeExecution = CODE_EXECUTION_PATTERNS.some((p) => lowerDesc.includes(p));
    if (likelyNeedsCodeExecution) {
      scores.get('claw')!.score += 0.3;
      scores.get('coding_agent')!.score += 0.4;
    }

    // If task mentions external data, weight toward claw
    const likelyNeedsExternalData = EXTERNAL_DATA_PATTERNS.some((p) => lowerDesc.includes(p));
    if (likelyNeedsExternalData) {
      scores.get('claw')!.score += 0.3;
    }

    // Sort by score descending
    const sorted = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);

    const topKinds = sorted
      .filter(([, s]) => s.score > 0)
      .slice(0, 3)
      .map(([kind]) => kind);

    // If nothing matched, default to claw (most capable)
    if (topKinds.length === 0) {
      topKinds.push('claw');
    }

    // Find matching capabilities
    const allCaps = this.registry.getAll();
    const requiredCapabilities = allCaps
      .filter((c) => topKinds.includes(c.executorKind) && !c.requiresApproval)
      .slice(0, 5);

    // Determine if orchestration is needed (multiple steps with dependencies)
    const requiresOrchestration = topKinds.length > 1 || hasTrigger || likelyNeedsCodeExecution;

    const confidence = sorted.length > 0 ? sorted[0]![1].score : 0.5;
    const reasoningParts = sorted
      .filter(([, s]) => s.score > 0)
      .slice(0, 2)
      .map(([kind, s]) => `${kind}: ${s.reasons.join('; ')} (score: ${s.score.toFixed(2)})`);

    return {
      task: task as AgenticTask,
      suggestedKinds: topKinds,
      requiredCapabilities,
      requiresOrchestration,
      likelyNeedsCodeExecution,
      likelyNeedsExternalData,
      confidence,
      reasoning: reasoningParts.join('\n') || 'Default routing to claw (most capable executor)',
    };
  }

  /**
   * Generate an execution plan for a task.
   */
  async plan(task: AgenticTask): Promise<ExecutionPlan> {
    const analysis = await this.analyze(task);
    const steps: ExecutionStep[] = [];
    const kinds = analysis.suggestedKinds;
    const defaults = DEFAULT_CONSTRAINTS[kinds[0]!] ?? DEFAULT_CONSTRAINTS.claw;
    const trigger = task.trigger ?? inferTriggerStrategy(task.description);

    // Build steps based on analysis
    // Trigger-based plans take priority over orchestration — if a trigger
    // strategy is defined and it's not immediate, always route through the
    // trigger engine regardless of what the task analysis suggests.

    // Extra params shared across all step types
    const extraParams: Record<string, unknown> = {};
    if (task.providerPreference?.providerId)
      extraParams.provider = task.providerPreference.providerId;
    if (task.providerPreference?.modelId) extraParams.model = task.providerPreference.modelId;
    if (task.prompt) extraParams.prompt = task.prompt;

    if (trigger && trigger.type !== 'immediate') {
      // Trigger-based plan: set up trigger, then execute
      steps.push({
        index: 1,
        executorKind: 'trigger',
        capabilityId: `trigger:${trigger.type}`,
        providerId: 'ownpilot:trigger',
        params: {
          trigger,
          taskName: task.name,
          action: {
            type: 'chat',
            payload: {
              task: task.description,
              expectedOutput: task.expectedOutput,
            },
          },
        },
        dependsOn: [],
        timeoutMs: 10_000,
        retryOnFailure: false,
      });

      steps.push({
        index: 2,
        executorKind: kinds[0]!,
        capabilityId: kinds[0]! === 'claw' ? 'claw:single-shot' : 'direct-llm:chat',
        providerId: kinds[0]! === 'claw' ? 'ownpilot:claw' : 'ownpilot:llm',
        params: {
          task: task.description,
          expectedOutput: task.expectedOutput,
          ...extraParams,
        },
        dependsOn: [1],
        timeoutMs: task.constraints?.timeoutMs ?? defaults.timeoutMs,
        retryOnFailure: true,
      });
    } else if (analysis.requiresOrchestration && kinds.length > 1) {
      // Multi-step plan: first analyze, then execute
      const primaryKind = kinds[0]!;
      const supportKind = kinds.length > 1 ? kinds[1] : undefined;

      steps.push({
        index: 1,
        executorKind: primaryKind,
        capabilityId: `claw:single-shot`,
        providerId: 'ownpilot:claw',
        params: {
          task: task.description,
          expectedOutput: task.expectedOutput,
          constraints: task.constraints,
          trigger: trigger ? { trigger } : undefined,
          ...extraParams,
        },
        dependsOn: [],
        timeoutMs: task.constraints?.timeoutMs ?? defaults.timeoutMs,
        retryOnFailure: true,
      });

      if (supportKind && analysis.likelyNeedsCodeExecution) {
        steps.push({
          index: 2,
          executorKind: supportKind,
          capabilityId: 'coding-agent:claude-code',
          providerId: 'ownpilot:coding-agent',
          params: {
            task: `Execute code/commands for: ${task.description}`,
            context: { parentTaskId: task.id },
          },
          dependsOn: [1],
          timeoutMs: defaults.timeoutMs,
          retryOnFailure: true,
        });
      }
    } else {
      // Single-step plan
      const capId =
        kinds[0]! === 'claw'
          ? 'claw:single-shot'
          : kinds[0]! === 'direct_llm'
            ? 'direct-llm:chat'
            : kinds[0]! === 'soul_heartbeat'
              ? 'soul:heartbeat'
              : kinds[0]! === 'coding_agent'
                ? 'coding-agent:claude-code'
                : kinds[0]! === 'workflow'
                  ? 'workflow:dag'
                  : 'claw:single-shot';

      steps.push({
        index: 1,
        executorKind: kinds[0]!,
        capabilityId: capId,
        providerId: capId.startsWith('claw')
          ? 'ownpilot:claw'
          : capId.startsWith('direct')
            ? 'ownpilot:llm'
            : capId.startsWith('coding')
              ? 'ownpilot:coding-agent'
              : 'ownpilot:claw',
        params: {
          task: task.description,
          expectedOutput: task.expectedOutput,
          constraints: task.constraints,
          trigger: trigger && trigger.type !== 'immediate' ? { trigger } : undefined,
          ...extraParams,
        },
        dependsOn: [],
        timeoutMs: task.constraints?.timeoutMs ?? defaults.timeoutMs,
        retryOnFailure: true,
      });
    }

    return {
      task,
      steps,
      estimatedCostUsd: steps.reduce((sum, s) => {
        const kind = s.executorKind;
        const costMap: Record<string, number> = {
          claw: 0.05,
          soul_heartbeat: 0.01,
          crew: 0.1,
          coding_agent: 0.2,
          workflow: 0.05,
          trigger: 0.001,
          channel: 0.001,
          direct_llm: 0.005,
          sandbox_code: 0.001,
          tool_catalog: 0.001,
        };
        return sum + (costMap[kind] ?? 0.01);
      }, 0),
      estimatedDurationMs: steps.reduce((sum, s) => sum + (s.timeoutMs ?? 30_000), 0),
      requiresApproval: analysis.requiredCapabilities.some((c) => c.requiresApproval),
      fallbackStrategy: 'escalate',
      createdAt: new Date(),
    };
  }

  /**
   * Route a task: analyze it, then generate an execution plan.
   */
  async route(
    task: Omit<AgenticTask, 'id'>
  ): Promise<{ analysis: TaskAnalysis; plan: ExecutionPlan }> {
    const taskWithId: AgenticTask = { ...task, id: generateId('agentic') };
    const analysis = await this.analyze(taskWithId);
    const plan = await this.plan(taskWithId);
    return { analysis, plan };
  }
}
