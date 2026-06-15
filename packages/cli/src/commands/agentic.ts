/**
 * Agentic CLI commands — execute and manage autonomous agentic tasks
 * from the terminal.
 *
 * These commands interact with the gateway REST API (/api/v1/agentic). The
 * gateway must be running and reachable at OWNPILOT_GATEWAY_URL (default
 * http://localhost:8080).
 *
 * Usage:
 *   ownpilot agentic run "Research the latest AI trends"
 *   ownpilot agentic list
 *   ownpilot agentic status <id>
 *   ownpilot agentic cancel <id>
 *   ownpilot agentic plan "What capabilities are available?"
 *   ownpilot agentic capabilities
 *   ownpilot agentic stats
 */

import { apiFetch, getBaseUrl, ensureGatewayError } from './gateway-client.js';

/** Thin wrapper over the shared gateway client preserving the local call shape. */
async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const options: RequestInit = { method };
  if (body !== undefined) options.body = JSON.stringify(body);
  return apiFetch<unknown>(path, options);
}

// ============================================================================
// Types for CLI display
// ============================================================================

interface CapabilitySummary {
  id: string;
  name: string;
  description: string;
  executorKind: string;
  providerId: string;
  costTier?: string;
  latencyTier?: string;
  tags: string[];
  requiresApproval: boolean;
}

interface ExecutionSummary {
  id: string;
  taskName: string;
  status: string;
  summary: string;
  totalCostUsd: number;
  totalDurationMs: number;
  stepCount: number;
  startedAt: string;
  completedAt: string | null;
}

// ============================================================================
// ─── RUN ───
// ============================================================================

export async function agenticRun(taskDescription: string[], options: {
  name?: string;
  priority?: string;
  trigger?: string;
  interval?: string;
  timeout?: number;
  output?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  json?: boolean;
}): Promise<void> {
  const description = taskDescription.join(' ').trim();
  if (!description) {
    console.error('Usage: ownpilot agentic run [options] <task description...>');
    console.error('\nOptions:');
    console.error('  --name <name>          Task name (default: auto-generated from description)');
    console.error('  --priority <level>     Priority: low, normal, high, critical (default: normal)');
    console.error('  --trigger <type>       Trigger: immediate, interval, continuous (default: immediate)');
    console.error('  --interval <ms>        Interval in ms for interval trigger (default: 300000)');
    console.error('  --timeout <ms>         Step timeout in ms (default: 60000)');
    console.error('  --output <path>        Save results to file');
    process.exit(1);
  }

  // Build task name from description
  const name = options.name ?? (description.length > 60 ? description.slice(0, 57) + '...' : description);

  // Build request body
  const body: Record<string, unknown> = {
    name,
    description,
    priority: options.priority ?? 'normal',
  };
  if (options.provider) body.provider = options.provider;
  if (options.model) body.model = options.model;
  if (options.prompt) body.prompt = options.prompt;

  // Add trigger config
  const triggerType = options.trigger ?? 'immediate';
  if (triggerType === 'interval') {
    body.trigger = { type: 'interval', intervalMs: parseInt(options.interval ?? '300000', 10) };
  } else if (triggerType === 'continuous') {
    body.trigger = { type: 'continuous' };
  } else {
    body.trigger = { type: 'immediate' };
  }

  // Add constraints if timeout specified
  if (options.timeout) {
    body.constraints = { timeoutMs: parseInt(String(options.timeout), 10) || 60000 };
  }

  console.log(`\n  ▶ Executing task: ${name}`);
  console.log(`  ▷ Trigger: ${triggerType}`);
  console.log(`  ▷ Priority: ${options.priority ?? 'normal'}`);
  console.log('');

  try {
    const result = (await api('/agentic/execute', 'POST', body)) as Record<string, unknown>;

    const id = result.id as string;
    const status = result.status as string;
    const summary = result.summary as string;
    const cost = result.totalCostUsd as number;
    const duration = result.totalDurationMs as number;
    const steps = result.steps as Array<Record<string, unknown>> | undefined;
    const error = result.error as string | undefined;

    // JSON output mode
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Print results
    const icon = status === 'completed' ? '✓' : status === 'failed' ? '✗' : '◌';
    console.log(`\n  ${icon}  ${name}`);
    console.log('  ' + '─'.repeat(50));
    console.log(`  ID:       ${id}`);
    console.log(`  Status:   ${status}`);
    console.log(`  Result:   ${summary ?? '—'}`);
    if (error) console.log(`  Error:    ${error}`);
    console.log(`  Cost:     ${(cost ?? 0).toFixed(4)}`);
    const durStr = (duration ?? 0) >= 1000 ? `${((duration ?? 0) / 1000).toFixed(1)}s` : `${(duration ?? 0)}ms`;
    console.log(`  Time:     ${durStr}`);

    if (steps && steps.length > 0) {
      console.log('');
      console.log('  Steps:');
      for (const step of steps) {
        const stepIcon = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '◌';
        const stepCost = step.costUsd ? ` $${(step.costUsd as number).toFixed(4)}` : '';
        const stepDuration = step.durationMs ? ` ${(step.durationMs as number).toLocaleString()}ms` : '';
        console.log(`    ${stepIcon} #${String(step.index).padEnd(3)} ${String(step.executorKind).padEnd(16)} ${String(step.status).padEnd(12)}${stepDuration}${stepCost}`);
        if (step.error) console.log(`       error: ${step.error}`);
      }
    }

    // Save to file if requested
    if (options.output) {
      try {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.output, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`\n  Saved to: ${options.output}`);
      } catch {
        console.error(`\n  Warning: Could not write to ${options.output}`);
      }
    }

    console.log('');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── LIST ───
// ============================================================================

export async function agenticList(options: { limit?: number; offset?: number }): Promise<void> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  try {
    const data = (await api(`/agentic/executions?limit=${limit}&offset=${offset}`)) as {
      executions: ExecutionSummary[];
      total: number;
    };

    const { executions, total } = data;

    console.log(`\nAgentic Executions (${total} total, showing ${executions.length}):`);
    console.log('─'.repeat(90));

    if (executions.length === 0) {
      console.log('  No executions yet. Run `ownpilot agentic run <task>` to start one.\n');
      return;
    }

    for (const e of executions) {
      const statusIcon = e.status === 'completed' ? '✓' : e.status === 'failed' ? '✗' : e.status === 'running' ? '▶' : '◌';
      const cost = e.totalCostUsd ? ` $${e.totalCostUsd.toFixed(4)}` : '';
      const duration = e.totalDurationMs ? ` ${e.totalDurationMs.toLocaleString()}ms` : '';

      console.log(`  ${statusIcon} ${e.taskName.padEnd(50)}  ${e.status.padEnd(18)}${duration}${cost}`);
      const shortTime = new Date(e.startedAt).toLocaleString();
      console.log(`     ${e.id}`);
      console.log(`     ${shortTime}  ${e.summary.slice(0, 90)}`);
    }
    console.log('');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── STATUS ───
// ============================================================================

export async function agenticStatus(id: string, options: { json?: boolean }): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot agentic status <id>');
    process.exit(1);
  }

  try {
    const result = (await api(`/agentic/executions/${id}`)) as Record<string, unknown>;

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const task = result.task as Record<string, unknown> | undefined;
    const status = result.status as string;
    const summary = result.summary as string;
    const cost = result.totalCostUsd as number;
    const duration = result.totalDurationMs as number;
    const error = result.error as string | undefined;
    const steps = result.steps as Array<Record<string, unknown>> | undefined;
    const startedAt = result.startedAt as string;
    const completedAt = result.completedAt as string | null;

    const icon = status === 'completed' ? '✓' : status === 'failed' ? '✗' : status === 'running' ? '▶' : '◌';
    const taskName = (task?.name as string) ?? 'Unknown';

    console.log(`\n  ${icon} ${taskName}`);
    console.log('─'.repeat(60));
    console.log(`  ID:        ${id}`);
    console.log(`  Status:    ${status}`);
    console.log(`  Result:    ${summary}`);
    console.log(`  Cost:      $${(cost ?? 0).toFixed(4)}`);
    console.log(`  Duration:  ${(duration ?? 0).toLocaleString()}ms`);
    console.log(`  Started:   ${new Date(startedAt).toLocaleString()}`);
    if (completedAt) console.log(`  Completed: ${new Date(completedAt).toLocaleString()}`);
    if (error) console.log(`  Error:     ${error}`);

    if (steps && steps.length > 0) {
      console.log('');
      console.log('  Steps:');
      for (const step of steps) {
        const stepIcon = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '▶' : '◌';
        const stepDuration = step.durationMs ? ` ${(step.durationMs as number).toLocaleString()}ms` : '';
        const stepCost = step.costUsd ? ` $${(step.costUsd as number).toFixed(4)}` : '';
        console.log(`    ${stepIcon} #${String(step.index).padEnd(3)} ${String(step.executorKind).padEnd(16)} ${String(step.status).padEnd(12)}${stepDuration}${stepCost}`);
        if (step.error) console.log(`       error: ${step.error}`);
      }
    }
    console.log('');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── CANCEL ───
// ============================================================================

export async function agenticCancel(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot agentic cancel <id>');
    process.exit(1);
  }

  try {
    await api(`/agentic/executions/${id}/cancel`, 'POST');
    console.log(`\n  ✓ Cancelled execution: ${id}\n`);
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── PLAN ───
// ============================================================================

export async function agenticPlan(taskDescription: string[], options: { name?: string; trigger?: string; interval?: string }): Promise<void> {
  const description = taskDescription.join(' ').trim();
  if (!description) {
    console.error('Usage: ownpilot agentic plan [options] <task description...>');
    console.error('\nOptions:');
    console.error('  --name <name>          Task name');
    console.error('  --trigger <type>       Trigger: immediate, interval, continuous');
    console.error('  --interval <ms>        Interval in ms for interval trigger');
    process.exit(1);
  }

  const name = options.name ?? (description.length > 60 ? description.slice(0, 57) + '...' : description);
  const body: Record<string, unknown> = { name, description };

  const triggerType = options.trigger ?? 'immediate';
  if (triggerType === 'interval') {
    body.trigger = { type: 'interval', intervalMs: parseInt(options.interval ?? '300000', 10) };
  } else if (triggerType === 'continuous') {
    body.trigger = { type: 'continuous' };
  } else {
    body.trigger = { type: 'immediate' };
  }

  try {
    const result = (await api('/agentic/plan', 'POST', body)) as Record<string, unknown>;

    const analysis = result.analysis as Record<string, unknown>;
    const plan = result.plan as Record<string, unknown>;
    const steps = plan?.steps as Array<Record<string, unknown>> | undefined;

    console.log(`\n  ⊞ Plan for: ${name}`);
    console.log('─'.repeat(60));

    // Analysis section
    console.log('\n  Analysis:');
    console.log(`    Suggested executor: ${(analysis.suggestedKinds as string[] ?? []).join(', ')}`);
    console.log(`    Needs orchestration: ${String(analysis.requiresOrchestration)}`);
    console.log(`    Requires code execution: ${String(analysis.likelyNeedsCodeExecution)}`);
    console.log(`    Confidence: ${((analysis.confidence as number ?? 0) * 100).toFixed(0)}%`);
    console.log(`    Reasoning: ${(analysis.reasoning as string ?? '').slice(0, 200)}`);

    // Steps section
    if (steps && steps.length > 0) {
      console.log('\n  Execution Steps:');
      for (const step of steps) {
        const deps = (step.dependsOn as number[] ?? []).length > 0
          ? `  (after step ${(step.dependsOn as number[]).join(', ')})`
          : '';
        const retry = step.retryOnFailure ? '  retry' : '';
        const timeout = step.timeoutMs ? `  ${(step.timeoutMs as number).toLocaleString()}ms` : '';
        console.log(`    #${String(step.index).padEnd(3)} ${String(step.executorKind).padEnd(16)} ${String(step.capabilityId).padEnd(25)}${timeout}${retry}${deps}`);
      }
    }

    // Estimate section
    const estCost = plan.estimatedCostUsd as number;
    const estDuration = plan.estimatedDurationMs as number;
    console.log(`\n  Estimated cost:    $${(estCost ?? 0).toFixed(4)}`);
    console.log(`  Estimated time:    ${(estDuration ?? 0).toLocaleString()}ms`);
    console.log(`  Needs approval:    ${String(plan.requiresApproval)}`);
    console.log(`  Fallback strategy: ${plan.fallbackStrategy as string}`);

    console.log('\n  To execute: ownpilot agentic run "' + description + '"\n');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── CAPABILITIES ───
// ============================================================================

export async function agenticCapabilities(options: { kind?: string; search?: string; provider?: string }): Promise<void> {
  try {
    const params = new URLSearchParams();
    if (options.kind) params.set('kind', options.kind);
    if (options.search) params.set('search', options.search);
    if (options.provider) params.set('provider', options.provider);
    const qs = params.toString();

    const data = (await api(`/agentic/capabilities${qs ? `?${qs}` : ''}`)) as {
      capabilities: CapabilitySummary[];
      total: number;
    };

    const { capabilities } = data;

    if (options.kind) {
      console.log(`\nCapabilities (filtered by kind="${options.kind}", ${capabilities.length}):`);
    } else if (options.search) {
      console.log(`\nCapabilities (matching "${options.search}", ${capabilities.length}):`);
    } else {
      console.log(`\nCapabilities (${capabilities.length} total):`);
    }
    console.log('─'.repeat(90));

    if (capabilities.length === 0) {
      console.log('  No capabilities found matching your criteria.\n');
      return;
    }

    // Group by executor kind for better display
    const byKind = new Map<string, CapabilitySummary[]>();
    for (const cap of capabilities) {
      const list = byKind.get(cap.executorKind) ?? [];
      list.push(cap);
      byKind.set(cap.executorKind, list);
    }

    for (const [kind, caps] of byKind) {
      console.log(`\n  ${kind}:`);
      for (const cap of caps) {
        const costTag = cap.costTier ? `  cost:${cap.costTier}` : '';
        const latencyTag = cap.latencyTier ? `  latency:${cap.latencyTier}` : '';
        const approvalTag = cap.requiresApproval ? '  ⚠ requires approval' : '';
        console.log(`    ${cap.id.padEnd(30)} ${cap.name.slice(0, 40)}`);
        console.log(`    ${' '.repeat(30)} ${cap.description.slice(0, 80)}`);
        console.log(`    ${' '.repeat(30)} tags: ${cap.tags.slice(0, 6).join(', ')}${costTag}${latencyTag}${approvalTag}`);
      }
    }
    console.log('');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── STATS ───
// ============================================================================

export async function agenticStats(): Promise<void> {
  try {
    const data = (await api('/agentic/stats')) as Record<string, unknown>;

    console.log('\nAgentic Runtime Stats');
    console.log('─'.repeat(50));
    console.log(`  Total executions:    ${String(data.totalExecutions)}`);
    console.log(`  Active executions:   ${String(data.activeExecutions)}`);
    console.log(`  Total cost:          $${(data.totalCostUsd as number ?? 0).toFixed(4)}`);
    console.log(`  Success rate:        ${((data.successRate as number ?? 0) * 100).toFixed(1)}%`);

    const byKind = data.byExecutorKind as Record<string, number> | undefined;
    if (byKind && Object.keys(byKind).length > 0) {
      console.log('');
      console.log('  By executor kind:');
      for (const [kind, count] of Object.entries(byKind)) {
        console.log(`    ${kind.padEnd(20)} ${count}`);
      }
    }
    console.log('');
  } catch (err) {
    ensureGatewayError(err);
  }
}

// ============================================================================
// ─── HELP ───
// ============================================================================

export function agenticHelp(): void {
  console.log(`
Agentic Commands — unified task execution across all agent types

USAGE
  ownpilot agentic <command> [options] [arguments]

COMMANDS
  run          Execute an autonomous agentic task
    ownpilot agentic run "Research topic X"
    ownpilot agentic run --priority high --timeout 120000 "Implement feature Y"
    ownpilot agentic run --trigger interval --interval 300000 "Monitor API health"
    ownpilot agentic run --output result.json "Complex task"

  list         List recent executions
    ownpilot agentic list
    ownpilot agentic list --limit 50

  status       Show detailed execution report
    ownpilot agentic status <execution-id>
    ownpilot agentic status <execution-id> --json

  cancel       Cancel a running execution
    ownpilot agentic cancel <execution-id>

  plan         Analyze a task and show execution plan (no execution)
    ownpilot agentic plan "Research topic X"
    ownpilot agentic plan --trigger interval "Monitor API endpoint"

  capabilities List registered agent capabilities
    ownpilot agentic capabilities
    ownpilot agentic capabilities --kind claw
    ownpilot agentic capabilities --search research,web

  stats        Show aggregated execution statistics
    ownpilot agentic stats

  watch        Live-tail execution events via WebSocket
    ownpilot agentic watch
    ownpilot agentic watch --verbose
    ownpilot agentic watch --limit 10

OPTIONS
  --name       Task name (auto-generated from description if not set)
  --priority   Priority level: low, normal, high, critical
  --trigger    Trigger type: immediate, interval, continuous
  --interval   Interval in ms (for interval trigger, default: 300000)
  --timeout    Step timeout in ms (default: 60000)
  --provider   AI provider (e.g. anthropic, openai — uses system default if not set)
  --model      Model name (e.g. claude-sonnet-4-20250514 — uses system default if not set)
  --prompt     Custom system prompt for the agent (default: generic assistant)
  --json       Output as JSON (for run/status commands)
  --output     Save execution result to file
  --limit      Max results (default: 20)
  --kind       Filter capabilities by executor kind
  --search     Search capabilities by keyword
  --provider   Filter capabilities by provider

EXAMPLES
  # Quick research task
  ownpilot agentic run "Research the latest AI trends"

  # High-priority coding task with longer timeout
  ownpilot agentic run --priority high --timeout 300000 "Fix the login bug"

  # Scheduled monitoring
  ownpilot agentic run --trigger interval --interval 60000 "Check API health"

  # Use specific provider/model
  ownpilot agentic run --provider anthropic --model claude-sonnet-4-20250514 "Research task"

  # Custom system prompt
  ownpilot agentic run --prompt "You are a senior software engineer. Write production-grade code." "Build a REST API"

  # Plan without executing
  ownpilot agentic plan "Refactor the authentication module"

  # List capabilities for coding agents
  ownpilot agentic capabilities --kind coding_agent

  # Show execution stats
  ownpilot agentic stats

  # Watch live execution events
  ownpilot agentic watch
  ownpilot agentic watch --verbose
`);
}

// ============================================================================
// ─── WATCH (WebSocket live events) ───
// ============================================================================

const AGENTIC_WS_TOPICS = [
  'agentic.step.start',
  'agentic.step.complete',
  'agentic.step.fail',
];

function agenticDeriveWsUrl(): string {
  const explicit = process.env.OWNPILOT_WS_URL;
  if (explicit) return explicit;
  const url = new URL(getBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}

interface AgenticWatchOptions {
  verbose?: boolean;
  limit?: number;
  token?: string;
  openWebSocket?: (url: string, protocols?: string[]) => WebSocketLike;
}

/** Minimal WebSocket shape — same as claw's WebSocketLike. */
interface WebSocketLike {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    handler: (evt: { data?: unknown; code?: number; message?: string }) => void
  ): void;
}

/** Pretty-print a single agentic event. */
function formatAgenticEvent(type: string, payload: Record<string, unknown>): string {
  const ts = new Date().toISOString().slice(11, 19);
  switch (type) {
    case 'agentic.step.start':
      return `${ts}  → start    ${String(payload.executorKind ?? '').padEnd(16)}  step #${String(payload.stepIndex ?? '')}  ${String(payload.capabilityId ?? '')}`;
    case 'agentic.step.complete': {
      const dur = typeof payload.durationMs === 'number' ? ` ${payload.durationMs}ms` : '';
      const cost = typeof payload.costUsd === 'number' ? ` ${(payload.costUsd as number).toFixed(4)}` : '';
      return `${ts}  ✓ done     ${String(payload.executorKind ?? '').padEnd(16)}  step #${String(payload.stepIndex ?? '')}${dur}${cost}`;
    }
    case 'agentic.step.fail':
      return `${ts}  ✗ fail     ${String(payload.executorKind ?? '').padEnd(16)}  step #${String(payload.stepIndex ?? '')}  ${String(payload.error ?? '').slice(0, 60)}`;
    default:
      return `${ts}  ? ${type.padEnd(16)}  ${JSON.stringify(payload).slice(0, 80)}`;
  }
}

/**
 * Live-tail agentic execution events from the gateway via WebSocket.
 * Shows step start, complete, and failure events in real time.
 */
export async function agenticWatch(options: AgenticWatchOptions = {}): Promise<void> {
  const token = options.token ?? process.env.OWNPILOT_API_KEY;
  const baseUrl = agenticDeriveWsUrl();
  const protocols = token
    ? ['ownpilot', `ownpilot.auth.${Buffer.from(token, 'utf-8').toString('base64url')}`]
    : undefined;

  const openWebSocket =
    options.openWebSocket ??
    ((u: string, p?: string[]): WebSocketLike => {
      const Ctor = (globalThis as { WebSocket?: new (u: string, p?: string[]) => WebSocketLike }).WebSocket;
      if (!Ctor) throw new Error('Global WebSocket not available — requires Node 22+');
      return new Ctor(u, p);
    });

  const ws = openWebSocket(baseUrl, protocols);
  let count = 0;

  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const finish = (err?: Error): void => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve();
    };

    ws.addEventListener('open', () => {
      console.log(
        `Connected to ${baseUrl} — watching agentic execution events` +
        ` (${AGENTIC_WS_TOPICS.length} topics).`
      );
      console.log('Press Ctrl-C to stop.\n');
      for (const topic of AGENTIC_WS_TOPICS) {
        ws.send(JSON.stringify({ type: 'event:subscribe', event: topic }));
      }
    });

    ws.addEventListener('message', (evt) => {
      if (resolved) return;
      let msg: { type?: string; event?: string; data?: unknown; payload?: unknown };
      try {
        msg = JSON.parse(String(evt.data));
      } catch { return; }
      const type = (msg.event ?? msg.type) as string | undefined;
      if (!type || !type.startsWith('agentic.step')) return;
      const payload = (msg.payload ?? msg.data ?? {}) as Record<string, unknown>;

      if (options.verbose) {
        console.log(`[${type}]`, JSON.stringify(payload, null, 2));
      } else {
        console.log(formatAgenticEvent(type, payload));
      }

      count++;
      if (typeof options.limit === 'number' && count >= options.limit) finish();
    });

    ws.addEventListener('close', () => finish());
    ws.addEventListener('error', (evt) => {
      finish(new Error(`WebSocket error: ${String(evt.message ?? 'unknown')}`));
    });
  });
}
