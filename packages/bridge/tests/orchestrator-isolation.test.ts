import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import { registerRoutes } from '../src/api/routes.ts';
import { eventBus } from '../src/event-bus.ts';
import { config } from '../src/config.ts';

/**
 * Helper: connect to SSE endpoint with optional orchestratorId filter.
 * Returns parsed SSE events as {event, data} objects.
 */
function connectSSE(
  port: number,
  timeoutMs = 1500,
  options?: { projectDir?: string; orchestratorId?: string },
): Promise<{ events: Array<{ event: string; data: string }>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string }> = [];
    let buffer = '';
    const params = new URLSearchParams();
    if (options?.projectDir) params.set('project_dir', options.projectDir);
    if (options?.orchestratorId) params.set('orchestrator_id', options.orchestratorId);
    const qs = params.toString();
    const url = `http://127.0.0.1:${port}/v1/notifications/stream${qs ? '?' + qs : ''}`;

    const req = http.get(url, { headers: { authorization: `Bearer ${config.bridgeApiKey}` } }, (res) => {
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
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (eventType) events.push({ event: eventType, data });
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

describe('Orchestrator SSE Isolation (real HTTP)', () => {
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

  it('Test 1: two orchestrators each receive only their own events (core isolation)', async () => {
    // Start 3 SSE clients simultaneously
    const sseA = connectSSE(port, 1500, { orchestratorId: 'orch-abc' });
    const sseB = connectSSE(port, 1500, { orchestratorId: 'orch-xyz' });
    const sseAll = connectSSE(port, 1500);
    // Wait for all clients to connect
    await new Promise((r) => setTimeout(r, 200));

    // Emit 3 events: one tagged abc, one tagged xyz, one untagged
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c1',
      sessionId: 's1',
      projectDir: '/p',
      text: 'from-abc',
      timestamp: '',
      orchestratorId: 'orch-abc',
    });
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c2',
      sessionId: 's2',
      projectDir: '/p',
      text: 'from-xyz',
      timestamp: '',
      orchestratorId: 'orch-xyz',
    });
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c3',
      sessionId: 's3',
      projectDir: '/p',
      text: 'untagged',
      timestamp: '',
    });

    const [resA, resB, resAll] = await Promise.all([sseA, sseB, sseAll]);
    const outputA = resA.events.filter((e) => e.event === 'session.output');
    const outputB = resB.events.filter((e) => e.event === 'session.output');
    const outputAll = resAll.events.filter((e) => e.event === 'session.output');

    // A should get: from-abc + untagged (2), NOT from-xyz
    expect(outputA).toHaveLength(2);
    expect(outputA.map((e) => JSON.parse(e.data).text)).toContain('from-abc');
    expect(outputA.map((e) => JSON.parse(e.data).text)).toContain('untagged');
    expect(outputA.map((e) => JSON.parse(e.data).text)).not.toContain('from-xyz');

    // B should get: from-xyz + untagged (2), NOT from-abc
    expect(outputB).toHaveLength(2);
    expect(outputB.map((e) => JSON.parse(e.data).text)).toContain('from-xyz');
    expect(outputB.map((e) => JSON.parse(e.data).text)).toContain('untagged');
    expect(outputB.map((e) => JSON.parse(e.data).text)).not.toContain('from-abc');

    // All (no filter) should get all 3
    expect(outputAll).toHaveLength(3);
  });

  it('Test 2: untagged events always delivered to filtered SSE client', async () => {
    const sseA = connectSSE(port, 1000, { orchestratorId: 'orch-abc' });
    await new Promise((r) => setTimeout(r, 200));

    // Emit untagged event (no orchestratorId)
    eventBus.emit('session.done', {
      type: 'session.done',
      conversationId: 'c1',
      sessionId: 's1',
      projectDir: '/p',
      timestamp: '',
    });

    const { events } = await sseA;
    expect(events.find((e) => e.event === 'session.done')).toBeDefined();
  });

  it('Test 3: SSE without filter receives ALL events', async () => {
    const sseAll = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c1',
      sessionId: 's1',
      projectDir: '/p',
      text: 'a',
      timestamp: '',
      orchestratorId: 'orch-abc',
    });
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c2',
      sessionId: 's2',
      projectDir: '/p',
      text: 'b',
      timestamp: '',
      orchestratorId: 'orch-xyz',
    });

    const { events } = await sseAll;
    expect(events.filter((e) => e.event === 'session.output')).toHaveLength(2);
  });

  it('Test 4: connected event includes orchestratorFilter when param is set', async () => {
    const { events } = await connectSSE(port, 500, { orchestratorId: 'orch-abc' });
    expect(events[0].event).toBe('connected');
    expect(JSON.parse(events[0].data).orchestratorFilter).toBe('orch-abc');
  });

  it('Test 5: connected event has null orchestratorFilter when no param', async () => {
    const { events } = await connectSSE(port, 500);
    expect(events[0].event).toBe('connected');
    expect(JSON.parse(events[0].data).orchestratorFilter).toBeNull();
  });
});
