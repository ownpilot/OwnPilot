/**
 * Tests for Last-Event-ID header parsing and missed event replay.
 * Task 4 of Phase 08-01.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import { registerRoutes } from '../src/api/routes.ts';
import { eventBus } from '../src/event-bus.ts';
import { replayBuffer } from '../src/event-replay-buffer.ts';
import { config } from '../src/config.ts';

/**
 * Connect to SSE and collect events, supporting Last-Event-ID header.
 * Returns parsed events with event, data, and id fields.
 */
function connectSSEWithReplay(
  port: number,
  timeoutMs = 1500,
  options?: {
    lastEventId?: number;
    projectDir?: string;
    orchestratorId?: string;
  },
): Promise<{ events: Array<{ event: string; data: string; id?: string }>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string; id?: string }> = [];
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
          }
          if (eventType) events.push({ event: eventType, data, id });
        }
      });

      setTimeout(() => {
        req.destroy();
        resolve({ events, statusCode });
      }, timeoutMs);
    });

    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve({ events, statusCode: 200 });
      } else {
        reject(err);
      }
    });
  });
}

describe('Last-Event-ID replay (Task 4 — 08-01)', () => {
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

  it('reconnecting with Last-Event-ID replays missed events', async () => {
    // Phase 1: emit some events (simulating a first connection that then disconnects)
    // We emit events so the replayBuffer captures them
    const firstConnect = connectSSEWithReplay(port, 600);
    await new Promise((r) => setTimeout(r, 150));

    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'event-A', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'event-B', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'event-C', timestamp: '',
    });

    const firstResult = await firstConnect;
    const firstEvents = firstResult.events.filter(e => e.event === 'session.output');
    expect(firstEvents).toHaveLength(3);

    // Get the ID of the first event received
    const firstId = Number(firstEvents[0].id);
    expect(firstId).toBeGreaterThan(0);

    // Phase 2: reconnect with Last-Event-ID = firstId (so we expect event-B and event-C to be replayed)
    const { events: replayedEvents } = await connectSSEWithReplay(port, 600, {
      lastEventId: firstId,
    });

    // Should receive replayed events before any live events
    const replayed = replayedEvents.filter(e => e.event === 'session.output');
    expect(replayed.length).toBeGreaterThanOrEqual(2); // event-B and event-C
    expect(replayed.some(e => JSON.parse(e.data).text === 'event-B')).toBe(true);
    expect(replayed.some(e => JSON.parse(e.data).text === 'event-C')).toBe(true);
  });

  it('connected event includes replayedCount field', async () => {
    // Emit events first
    const firstConnect = connectSSEWithReplay(port, 500);
    await new Promise((r) => setTimeout(r, 100));
    eventBus.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });
    const firstResult = await firstConnect;
    const firstDone = firstResult.events.find(e => e.event === 'session.done');
    const lastId = Number(firstDone?.id ?? 0);

    // Reconnect with Last-Event-ID = 0 to trigger replay of all events
    const { events } = await connectSSEWithReplay(port, 500, { lastEventId: 0 });
    const connectedEvent = events.find(e => e.event === 'connected');
    expect(connectedEvent).toBeDefined();
    const connectedData = JSON.parse(connectedEvent!.data);
    expect(connectedData).toHaveProperty('replayedCount');
    expect(typeof connectedData.replayedCount).toBe('number');
    expect(connectedData.replayedCount).toBeGreaterThanOrEqual(0);
  });

  it('no Last-Event-ID means no replay (replayedCount: 0)', async () => {
    // Emit some events into the replay buffer
    const firstConnect = connectSSEWithReplay(port, 300);
    await new Promise((r) => setTimeout(r, 100));
    eventBus.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });
    await firstConnect;

    // Connect WITHOUT Last-Event-ID
    const { events } = await connectSSEWithReplay(port, 300);
    const connectedEvent = events.find(e => e.event === 'connected');
    expect(connectedEvent).toBeDefined();
    const connectedData = JSON.parse(connectedEvent!.data);
    // No Last-Event-ID → replayedCount = 0 (or property absent if not set)
    expect(connectedData.replayedCount ?? 0).toBe(0);
  });

  it('replay respects project_dir filter — only replays matching events', async () => {
    // Emit events for two different projects
    const firstConnect = connectSSEWithReplay(port, 500);
    await new Promise((r) => setTimeout(r, 100));

    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      projectDir: '/project-A', text: 'proj-A event', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's',
      projectDir: '/project-B', text: 'proj-B event', timestamp: '',
    });

    const firstResult = await firstConnect;
    const lastId = Math.min(
      ...firstResult.events
        .filter(e => e.event === 'session.output')
        .map(e => Number(e.id))
    );

    // Reconnect for project-A only, replaying from before its events
    const { events } = await connectSSEWithReplay(port, 500, {
      lastEventId: lastId - 1,
      projectDir: '/project-A',
    });

    const replayed = events.filter(e => e.event === 'session.output');
    // All replayed events should be for project-A
    for (const e of replayed) {
      expect(JSON.parse(e.data).projectDir).toBe('/project-A');
    }
  });
});
