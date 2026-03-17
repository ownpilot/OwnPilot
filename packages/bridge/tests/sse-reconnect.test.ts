/**
 * SSE Reconnect Integration Tests — Phase 08-02
 *
 * Covers the full reconnect scenario:
 * 1. SSE emits id: field
 * 2. SSE emits retry: field (3000ms default)
 * 3. Last-Event-ID replay (full flow)
 * 4. Replay respects orchestrator_id filter
 * 5. Replay respects project_dir filter
 * 6. Empty replay when no missed events
 * 7. Ring buffer capacity (oldest dropped)
 * 8. Ring buffer TTL (expired events pruned)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import { registerRoutes } from '../src/api/routes.ts';
import { eventBus } from '../src/event-bus.ts';
import { EventReplayBuffer } from '../src/event-replay-buffer.ts';
import { replayBuffer } from '../src/event-replay-buffer.ts';
import { config } from '../src/config.ts';
import type { BufferedEvent } from '../src/event-bus.ts';

// ---------------------------------------------------------------------------
// SSE helper — captures events AND retry: directive from raw SSE stream
// ---------------------------------------------------------------------------
interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

interface SseResult {
  events: SseEvent[];
  /** Value from `retry: N` SSE directive, if present */
  retryMs?: number;
  statusCode: number;
}

function connectSSE(
  port: number,
  timeoutMs = 1200,
  options?: {
    lastEventId?: number;
    projectDir?: string;
    orchestratorId?: string;
  },
): Promise<SseResult> {
  return new Promise((resolve, reject) => {
    const events: SseEvent[] = [];
    let retryMs: number | undefined;
    let buffer = '';

    let url = `http://127.0.0.1:${port}/v1/notifications/stream`;
    const params: string[] = [];
    if (options?.projectDir) params.push(`project_dir=${encodeURIComponent(options.projectDir)}`);
    if (options?.orchestratorId) params.push(`orchestrator_id=${encodeURIComponent(options.orchestratorId)}`);
    if (params.length) url += `?${params.join('&')}`;

    const reqHeaders: Record<string, string> = {
      authorization: `Bearer ${config.bridgeApiKey}`,
    };
    if (options?.lastEventId !== undefined) {
      reqHeaders['last-event-id'] = String(options.lastEventId);
    }

    const req = http.get(url, { headers: reqHeaders }, (res) => {
      const statusCode = res.statusCode ?? 0;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const lines = part.split('\n');
          let eventType = '';
          let data = '';
          let id: string | undefined;
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
            else if (line.startsWith('id: ')) id = line.slice(4);
            else if (line.startsWith('retry: ')) retryMs = parseInt(line.slice(7), 10);
          }
          if (eventType) events.push({ event: eventType, data, id });
        }
      });

      setTimeout(() => {
        req.destroy();
        resolve({ events, retryMs, statusCode });
      }, timeoutMs);
    });

    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve({ events, retryMs, statusCode: 200 });
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers for ring buffer tests
// ---------------------------------------------------------------------------
function makeEvent(id: number): BufferedEvent {
  return {
    type: 'session.done',
    conversationId: 'c',
    sessionId: 's',
    timestamp: new Date().toISOString(),
    id,
  } as BufferedEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SSE Reconnect Integration (Phase 08-02)', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeEach(async () => {
    app = Fastify();
    await registerRoutes(app);
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(addr).port);
    eventBus.removeAllListeners();
  });

  afterEach(async () => {
    eventBus.removeAllListeners();
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. SSE emits id: field
  // -------------------------------------------------------------------------
  it('SSE emits id: field for bridge events', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 150));

    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      text: 'hello',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvent = events.find((e) => e.event === 'session.output');
    expect(outputEvent).toBeDefined();
    expect(outputEvent!.id).toBeDefined();
    expect(Number(outputEvent!.id)).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2. SSE emits retry: field (3000ms default)
  // -------------------------------------------------------------------------
  it('SSE emits retry: 3000 hint on initial connection', async () => {
    const { retryMs } = await connectSSE(port, 800);
    expect(retryMs).toBe(3000);
  });

  // -------------------------------------------------------------------------
  // 3. Last-Event-ID replay — full flow
  // -------------------------------------------------------------------------
  it('reconnecting with Last-Event-ID replays missed events', async () => {
    // First connection: collect 3 events
    const first = connectSSE(port, 600);
    await new Promise((r) => setTimeout(r, 150));

    eventBus.emit('session.output', { type: 'session.output', conversationId: 'c', sessionId: 's', text: 'A', timestamp: '' });
    eventBus.emit('session.output', { type: 'session.output', conversationId: 'c', sessionId: 's', text: 'B', timestamp: '' });
    eventBus.emit('session.output', { type: 'session.output', conversationId: 'c', sessionId: 's', text: 'C', timestamp: '' });

    const { events: firstEvents } = await first;
    const outputs = firstEvents.filter((e) => e.event === 'session.output');
    expect(outputs).toHaveLength(3);

    const firstId = Number(outputs[0].id);
    expect(firstId).toBeGreaterThan(0);

    // Reconnect with Last-Event-ID = firstId → should replay B and C
    const { events: replayed } = await connectSSE(port, 600, { lastEventId: firstId });
    const replayedOutputs = replayed.filter((e) => e.event === 'session.output');
    expect(replayedOutputs.length).toBeGreaterThanOrEqual(2);
    expect(replayedOutputs.some((e) => JSON.parse(e.data).text === 'B')).toBe(true);
    expect(replayedOutputs.some((e) => JSON.parse(e.data).text === 'C')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Replay respects orchestrator_id filter
  // -------------------------------------------------------------------------
  it('replay respects orchestrator_id filter', async () => {
    // Emit events for two orchestrators
    const first = connectSSE(port, 500);
    await new Promise((r) => setTimeout(r, 100));

    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      orchestratorId: 'orch-A', text: 'orch-A event', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      orchestratorId: 'orch-B', text: 'orch-B event', timestamp: '',
    });

    const { events: firstEvents } = await first;
    const minId = Math.min(
      ...firstEvents.filter((e) => e.event === 'session.output').map((e) => Number(e.id)),
    );

    // Reconnect for orch-A only
    const { events } = await connectSSE(port, 500, {
      lastEventId: minId - 1,
      orchestratorId: 'orch-A',
    });

    const replayed = events.filter((e) => e.event === 'session.output');
    for (const e of replayed) {
      const data = JSON.parse(e.data);
      // Either untagged or matching orch-A
      expect(data.orchestratorId === undefined || data.orchestratorId === 'orch-A').toBe(true);
    }
    // At least the orch-A event was replayed
    expect(replayed.some((e) => JSON.parse(e.data).text === 'orch-A event')).toBe(true);
    expect(replayed.every((e) => JSON.parse(e.data).text !== 'orch-B event')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Replay respects project_dir filter
  // -------------------------------------------------------------------------
  it('replay respects project_dir filter', async () => {
    const first = connectSSE(port, 500);
    await new Promise((r) => setTimeout(r, 100));

    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      projectDir: '/project-A', text: 'proj-A event', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      projectDir: '/project-B', text: 'proj-B event', timestamp: '',
    });

    const { events: firstEvents } = await first;
    const minId = Math.min(
      ...firstEvents.filter((e) => e.event === 'session.output').map((e) => Number(e.id)),
    );

    const { events } = await connectSSE(port, 500, {
      lastEventId: minId - 1,
      projectDir: '/project-A',
    });

    const replayed = events.filter((e) => e.event === 'session.output');
    for (const e of replayed) {
      expect(JSON.parse(e.data).projectDir).toBe('/project-A');
    }
  });

  // -------------------------------------------------------------------------
  // 6. Empty replay when Last-Event-ID >= latest event id
  // -------------------------------------------------------------------------
  it('no replay when Last-Event-ID matches latest event', async () => {
    // Emit one event and capture its id
    const first = connectSSE(port, 500);
    await new Promise((r) => setTimeout(r, 100));

    eventBus.emit('session.done', {
      type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '',
    });

    const { events: firstEvents } = await first;
    const doneEvent = firstEvents.find((e) => e.event === 'session.done');
    const latestId = Number(doneEvent?.id ?? 0);
    expect(latestId).toBeGreaterThan(0);

    // Reconnect with Last-Event-ID = latestId → 0 events replayed
    const { events } = await connectSSE(port, 400, { lastEventId: latestId });
    const connectedData = JSON.parse(events.find((e) => e.event === 'connected')!.data);
    expect(connectedData.replayedCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7. Ring buffer capacity — oldest events dropped
  // -------------------------------------------------------------------------
  it('ring buffer drops oldest events when capacity exceeded', () => {
    const buf = new EventReplayBuffer({ maxSize: 3, ttlMs: 60_000 });
    buf.push(makeEvent(1));
    buf.push(makeEvent(2));
    buf.push(makeEvent(3));
    buf.push(makeEvent(4)); // should evict id=1

    expect(buf.size).toBe(3);
    expect(buf.since(0).map((e) => e.id)).toEqual([2, 3, 4]);
  });

  // -------------------------------------------------------------------------
  // 8. Ring buffer TTL — expired events pruned
  // -------------------------------------------------------------------------
  it('ring buffer prunes expired events after TTL', () => {
    vi.useFakeTimers();
    const buf = new EventReplayBuffer({ maxSize: 10, ttlMs: 1_000 });

    buf.push(makeEvent(1));
    buf.push(makeEvent(2));

    vi.advanceTimersByTime(1_001); // past TTL

    buf.push(makeEvent(3)); // triggers prune internally

    expect(buf.size).toBe(1);
    expect(buf.since(0).map((e) => e.id)).toEqual([3]);

    vi.useRealTimers();
  });
});
