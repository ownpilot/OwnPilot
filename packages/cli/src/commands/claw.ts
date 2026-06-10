/**
 * Claw CLI commands — drive autonomous Claw runtimes from the terminal.
 *
 * These commands interact with the gateway REST API (/api/v1/claws). The
 * gateway must be running and reachable at OWNPILOT_GATEWAY_URL (default
 * http://localhost:8080).
 */

import { apiFetch, getBaseUrl } from './gateway-client.js';

/** Thin wrapper over the shared gateway client preserving the local call shape. */
async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const options: RequestInit = { method };
  if (body !== undefined) options.body = JSON.stringify(body);
  return apiFetch<unknown>(path, options);
}

interface ClawSummary {
  id: string;
  name: string;
  mode: string;
  depth: number;
  session?: {
    state: string;
    cyclesCompleted: number;
    totalCostUsd: number;
    consecutiveErrors?: number;
    nextIntent?: string;
    tasks?: Array<{ status: string; title: string; cyclesInProgress?: number }>;
  } | null;
}

function formatStateBadge(state: string | undefined): string {
  if (!state) return '   stopped';
  const map: Record<string, string> = {
    running: '▶ running',
    starting: '◌ starting',
    waiting: '⏸ waiting',
    paused: '∥ paused',
    completed: '✓ completed',
    failed: '✗ failed',
    stopped: '■ stopped',
    escalation_pending: '⚠ escalation',
  };
  return map[state] ?? `· ${state}`;
}

type ClawTaskSummary = { status: string; title: string; cyclesInProgress?: number };

function summarizeFocus(tasks: ClawTaskSummary[] | undefined): string {
  if (!tasks || tasks.length === 0) return '';
  const focus = tasks.find((t) => t.status === 'in_progress');
  if (!focus) return '';
  const stall = (focus.cyclesInProgress ?? 0) >= 5 ? ` ⚠${focus.cyclesInProgress}c` : '';
  return `  focus: ${focus.title}${stall}`;
}

// ─── Listing & detail ──────────────────────────────────────────────────

export async function clawList(): Promise<void> {
  const data = (await api('/claws?limit=200')) as { claws: ClawSummary[]; total: number };
  console.log(`\nClaws (${data.total}):`);
  console.log('─'.repeat(80));
  if (data.claws.length === 0) {
    console.log('  No claws configured.\n');
    return;
  }
  for (const c of data.claws) {
    const state = formatStateBadge(c.session?.state);
    const cycles = c.session?.cyclesCompleted ?? 0;
    const cost = (c.session?.totalCostUsd ?? 0).toFixed(4);
    const errs = c.session?.consecutiveErrors ?? 0;
    const errBadge = errs > 0 ? `  err×${errs}` : '';
    const depth = c.depth > 0 ? `  d${c.depth}` : '';
    console.log(
      `  ${c.name.padEnd(28)}  ${state.padEnd(14)}  ${c.mode.padEnd(11)}  ` +
        `cyc=${String(cycles).padStart(4)}  $${cost}${depth}${errBadge}`
    );
    console.log(`     ${c.id}${summarizeFocus(c.session?.tasks)}`);
    if (c.session?.nextIntent) {
      const isOp = c.session.nextIntent.startsWith('[OPERATOR] ');
      const body = isOp ? c.session.nextIntent.slice('[OPERATOR] '.length) : c.session.nextIntent;
      console.log(`     ${isOp ? '↳ op-queued' : '↻ next'}: ${body}`);
    }
  }
  console.log();
}

export async function clawGet(id: string): Promise<void> {
  if (!id) {
    console.error('Usage: ownpilot claw get <id>');
    return;
  }
  const claw = (await api(`/claws/${id}`)) as Record<string, unknown>;
  console.log(JSON.stringify(claw, null, 2));
}

export async function clawStats(): Promise<void> {
  const data = (await api('/claws/stats')) as {
    total: number;
    running: number;
    totalCost: number;
    totalCycles: number;
    totalToolCalls: number;
    byMode: Record<string, number>;
    byState: Record<string, number>;
    byHealth: Record<string, number>;
    needsAttention: number;
    llmConcurrency: { max: number; active: number; queued: number };
  };
  console.log('\nClaw Runtime Stats');
  console.log('─'.repeat(60));
  console.log(`  Total:           ${data.total}`);
  console.log(`  Running:         ${data.running}`);
  console.log(`  Needs Attention: ${data.needsAttention}`);
  console.log(`  Total Cycles:    ${data.totalCycles}`);
  console.log(`  Total Tool Calls:${data.totalToolCalls}`);
  console.log(`  Total Cost:      $${data.totalCost.toFixed(4)}`);
  console.log();
  const showBucket = (label: string, bucket: Record<string, number>): void => {
    const entries = Object.entries(bucket).filter(([, n]) => n > 0);
    if (entries.length === 0) return;
    console.log(`  By ${label}:`);
    for (const [k, n] of entries) console.log(`    ${k.padEnd(20)} ${n}`);
  };
  showBucket('mode', data.byMode);
  showBucket('state', data.byState);
  showBucket('health', data.byHealth);
  console.log(
    `\n  LLM concurrency: ${data.llmConcurrency.active}/${data.llmConcurrency.max} active, ` +
      `${data.llmConcurrency.queued} queued\n`
  );
}

export async function clawPresets(): Promise<void> {
  const data = (await api('/claws/presets')) as {
    presets: Array<{ id: string; name: string; icon: string; description: string }>;
  };
  console.log(`\nClaw Presets (${data.presets.length}):`);
  console.log('─'.repeat(70));
  for (const p of data.presets) {
    console.log(`  ${p.icon} ${p.name.padEnd(28)} (${p.id})`);
    console.log(`     ${p.description}`);
  }
  console.log();
}

// ─── Lifecycle ──────────────────────────────────────────────────────────

export async function clawStart(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw start <id>');
  const result = (await api(`/claws/${id}/start`, 'POST')) as { state: string };
  console.log(`Started ${id} → ${result.state}`);
}

export async function clawPause(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw pause <id>');
  await api(`/claws/${id}/pause`, 'POST');
  console.log(`Paused ${id}`);
}

export async function clawResume(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw resume <id>');
  await api(`/claws/${id}/resume`, 'POST');
  console.log(`Resumed ${id}`);
}

export async function clawStop(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw stop <id>');
  await api(`/claws/${id}/stop`, 'POST');
  console.log(`Stopped ${id}`);
}

export async function clawDelete(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw delete <id>');
  await api(`/claws/${id}`, 'DELETE');
  console.log(`Deleted ${id}`);
}

// ─── Operator interventions ─────────────────────────────────────────────

export async function clawSendMessage(id: string, ...messageParts: string[]): Promise<void> {
  const message = messageParts.join(' ').trim();
  if (!id || !message) {
    return console.error('Usage: ownpilot claw send-message <id> <message...>');
  }
  await api(`/claws/${id}/message`, 'POST', { message });
  console.log(`Queued inbox message for ${id} (read on next cycle).`);
}

export async function clawNextIntent(id: string, ...intentParts: string[]): Promise<void> {
  const intent = intentParts.join(' ').trim();
  if (!id || !intent) {
    return console.error('Usage: ownpilot claw next-intent <id> <directive...>');
  }
  await api(`/claws/${id}/next-intent`, 'POST', { intent });
  console.log(`Queued [OPERATOR] directive for next cycle of ${id}.`);
}

export async function clawSteer(id: string, ...messageParts: string[]): Promise<void> {
  const message = messageParts.join(' ').trim();
  if (!id || !message) {
    return console.error('Usage: ownpilot claw steer <id> <directive...>');
  }
  await api(`/claws/${id}/steer`, 'POST', { message });
  console.log(`Steered ${id} — current cycle interrupted, new one starts now.`);
}

export async function clawResetFailures(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw reset-failures <id>');
  await api(`/claws/${id}/reset-failures`, 'POST');
  console.log(`Cleared consecutiveErrors + recentFailures for ${id}.`);
}

export async function clawApproveEscalation(id: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw approve-escalation <id>');
  await api(`/claws/${id}/approve-escalation`, 'POST');
  console.log(`Approved pending escalation for ${id}.`);
}

export async function clawDenyEscalation(id: string, ...reasonParts: string[]): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw deny-escalation <id> [reason...]');
  const reason = reasonParts.join(' ').trim();
  await api(`/claws/${id}/deny-escalation`, 'POST', reason ? { reason } : {});
  console.log(`Denied pending escalation for ${id}.`);
}

// ─── Inspection ─────────────────────────────────────────────────────────

// ─── Live event watch ───────────────────────────────────────────────────

/**
 * Derive the WebSocket URL from the shared gateway base URL
 * (`OWNPILOT_GATEWAY_URL`, e.g. `http://localhost:8080`). The gateway's WS
 * endpoint lives at `/ws` on the server root.
 */
function deriveWsUrl(): string {
  const explicit = process.env.OWNPILOT_WS_URL;
  if (explicit) return explicit;
  const url = new URL(getBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  return url.toString();
}

interface WatchOptions {
  /** Filter to events for a specific claw id (omit for all). */
  id?: string;
  /** Verbose mode: print full JSON payload instead of summary line. */
  verbose?: boolean;
  /** Optional max number of events before exiting (omit = forever). */
  limit?: number;
  /** Auth token override; falls back to OWNPILOT_API_KEY env. */
  token?: string;
  /**
   * Open factory — exposed so tests can inject a fake WebSocket implementation
   * without standing up a real server. Production passes `undefined` and the
   * function falls back to the Node 22+ built-in global WebSocket.
   */
  openWebSocket?: (url: string) => WebSocketLike;
}

/**
 * Minimal WebSocket shape we depend on — keeps the test seam tight without
 * pulling in DOM lib types.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    handler: (evt: { data?: unknown; code?: number; message?: string }) => void
  ): void;
}

/**
 * Pretty-print a single claw event. Pulled out so tests can call it
 * directly with synthetic payloads.
 */
export function formatClawEvent(type: string, payload: Record<string, unknown>): string {
  const ts = new Date().toISOString().slice(11, 19);
  const cid = typeof payload.clawId === 'string' ? payload.clawId : '?';
  const shortCid = cid.length > 12 ? `${cid.slice(0, 8)}…${cid.slice(-3)}` : cid;
  switch (type) {
    case 'claw:started':
      return `${ts}  ▶ start    ${shortCid}  ${String(payload.name ?? '')}`;
    case 'claw:stopped':
      return `${ts}  ■ stop     ${shortCid}  reason=${String(payload.reason ?? '')}`;
    case 'claw:paused':
      return `${ts}  ∥ pause    ${shortCid}`;
    case 'claw:resumed':
      return `${ts}  ▶ resume   ${shortCid}`;
    case 'claw:update':
      return `${ts}  · state    ${shortCid}  → ${String(payload.state ?? '')}`;
    case 'claw:cycle:start':
      return `${ts}  → cyc-st   ${shortCid}  #${String(payload.cycleNumber ?? '')}`;
    case 'claw:cycle:complete': {
      const ok = payload.success !== false;
      const cost =
        typeof payload.totalCostUsd === 'number'
          ? ` $${(payload.totalCostUsd as number).toFixed(4)}`
          : '';
      return `${ts}  ${ok ? '✓' : '✗'} cyc-end  ${shortCid}  #${String(payload.cycleNumber ?? '')}${cost}`;
    }
    case 'claw:cycle:skipped':
      return `${ts}  ⏭ cyc-skp  ${shortCid}  reason=${String(payload.reason ?? '')}`;
    case 'claw:progress':
      return `${ts}  · progress ${shortCid}  ${String(payload.message ?? '')}`;
    case 'claw:escalation':
      return `${ts}  ⚠ escal    ${shortCid}  ${String(payload.type ?? '')}: ${String(payload.reason ?? '')}`;
    case 'claw:error':
      return `${ts}  ✗ error    ${shortCid}  ${String(payload.error ?? '')}`;
    case 'claw:plan:updated': {
      const src = String(payload.source ?? 'agent');
      const counts =
        typeof payload.counts === 'object' && payload.counts !== null
          ? Object.entries(payload.counts as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')
          : '';
      return `${ts}  ⊞ plan     ${shortCid}  by=${src}  ${counts}`;
    }
    case 'claw:output':
      return `${ts}  ◌ output   ${shortCid}  ${String(payload.message ?? '').slice(0, 80)}`;
    default:
      return `${ts}  ? ${type.padEnd(8)} ${shortCid}`;
  }
}

const CLAW_WS_TOPICS = [
  'claw:started',
  'claw:stopped',
  'claw:paused',
  'claw:resumed',
  'claw:update',
  'claw:cycle:start',
  'claw:cycle:complete',
  'claw:cycle:skipped',
  'claw:progress',
  'claw:escalation',
  'claw:error',
  'claw:plan:updated',
  'claw:output',
];

/**
 * Live-tail claw events from the gateway. Designed for `wait until something
 * interesting happens` workflows from a terminal — operator runs `ownpilot
 * claw watch <id>` and sees state transitions, cycle starts/ends, plan
 * mutations, and errors as they happen.
 *
 * Returns a Promise so callers (and tests) can await completion. In normal
 * use it never resolves until the user hits Ctrl-C.
 */
export async function clawWatch(idOrAll?: string, options: WatchOptions = {}): Promise<void> {
  const id = idOrAll && idOrAll !== 'all' ? idOrAll : undefined;
  const token = options.token ?? process.env.OWNPILOT_API_KEY;
  const baseUrl = deriveWsUrl();
  const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;

  const openWebSocket =
    options.openWebSocket ??
    ((u: string): WebSocketLike => {
      // Node 22+ exposes WebSocket as a global. We treat it as a WebSocketLike
      // shape to avoid pulling DOM lib types into this package.
      const Ctor = (globalThis as { WebSocket?: new (u: string) => WebSocketLike }).WebSocket;
      if (!Ctor) {
        throw new Error('Global WebSocket not available — requires Node 22+');
      }
      return new Ctor(u);
    });

  const ws = openWebSocket(url);
  let count = 0;

  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const finish = (err?: Error): void => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve();
    };

    ws.addEventListener('open', () => {
      console.log(
        `Connected to ${baseUrl} — watching ${id ? `claw ${id}` : 'all claws'}` +
          ` (${CLAW_WS_TOPICS.length} topics).`
      );
      console.log('Press Ctrl-C to stop.\n');
      // Subscribe to every claw topic — gateway honors event:subscribe
      // per-topic, so we send one message per topic.
      for (const topic of CLAW_WS_TOPICS) {
        ws.send(JSON.stringify({ type: 'event:subscribe', event: topic }));
      }
    });

    ws.addEventListener('message', (evt) => {
      if (resolved) return;
      let msg: { type?: string; event?: string; data?: unknown; payload?: unknown };
      try {
        msg = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      const type = (msg.event ?? msg.type) as string | undefined;
      if (!type || !type.startsWith('claw:')) return;
      const payload = (msg.payload ?? msg.data ?? {}) as Record<string, unknown>;
      // Filter by id when requested.
      if (id && payload.clawId !== id) return;

      if (options.verbose) {
        console.log(`[${type}]`, JSON.stringify(payload, null, 2));
      } else {
        console.log(formatClawEvent(type, payload));
      }

      count++;
      if (typeof options.limit === 'number' && count >= options.limit) {
        finish();
      }
    });

    ws.addEventListener('close', () => finish());
    ws.addEventListener('error', (evt) => {
      finish(new Error(`WebSocket error: ${String(evt.message ?? 'unknown')}`));
    });
  });
}

export async function clawHistory(id: string, limitArg?: string): Promise<void> {
  if (!id) return console.error('Usage: ownpilot claw history <id> [limit]');
  const limit = limitArg ? Number(limitArg) : 20;
  const data = (await api(`/claws/${id}/history?limit=${limit}&offset=0`)) as {
    entries: Array<{
      cycleNumber: number;
      entryType: string;
      success: boolean;
      outputMessage: string;
      durationMs: number;
      costUsd?: number;
      executedAt: string;
      error?: string;
    }>;
    total: number;
  };
  console.log(`\nHistory for ${id} (showing ${data.entries.length} of ${data.total}):`);
  console.log('─'.repeat(80));
  for (const e of data.entries) {
    const tag = e.success ? '✓' : '✗';
    const cost = e.costUsd ? ` $${e.costUsd.toFixed(4)}` : '';
    console.log(
      `  ${tag} cyc${e.cycleNumber} ${e.entryType} ${e.executedAt}  ${e.durationMs}ms${cost}`
    );
    if (e.outputMessage) {
      const short = e.outputMessage.replace(/\s+/g, ' ').slice(0, 100);
      console.log(`     ${short}${e.outputMessage.length > 100 ? '…' : ''}`);
    }
    if (e.error) console.log(`     error: ${e.error}`);
  }
  console.log();
}
