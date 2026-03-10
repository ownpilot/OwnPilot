import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import { registerRoutes } from '../src/api/routes.ts';
import { eventBus } from '../src/event-bus.ts';
import { config } from '../src/config.ts';

/**
 * Helper: connect to SSE endpoint and collect events for a given duration.
 * Returns parsed SSE events as {event, data} objects.
 */
function connectSSE(
  port: number,
  timeoutMs = 2000,
  options?: { projectDir?: string },
): Promise<{ events: Array<{ event: string; data: string }>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string }> = [];
    let buffer = '';

    const url = options?.projectDir
      ? `http://127.0.0.1:${port}/v1/notifications/stream?project_dir=${encodeURIComponent(options.projectDir)}`
      : `http://127.0.0.1:${port}/v1/notifications/stream`;

    const req = http.get(
      url,
      { headers: { authorization: `Bearer ${config.bridgeApiKey}` } },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          // Parse SSE format: "event: xxx\ndata: yyy\n\n"
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
      },
    );
    req.on('error', (err) => {
      // Connection destroyed by us — not an error
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve({ events, statusCode: 200 });
      } else {
        reject(err);
      }
    });
  });
}

describe('SSE Notifications Stream (real HTTP)', () => {
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

  it('rejects without auth', async () => {
    const res = await new Promise<number>((resolve) => {
      http.get(`http://127.0.0.1:${port}/v1/notifications/stream`, (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
    });
    expect(res).toBe(401);
  });

  it('accepts auth via ?token query param (EventSource compat)', async () => {
    const statusCode = await new Promise<number>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/v1/notifications/stream?token=${config.bridgeApiKey}`,
        (res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
          res.resume();
        },
      );
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') resolve(200);
      });
    });
    expect(statusCode).toBe(200);
  });

  it('sends connected event on connect', async () => {
    const { events, statusCode } = await connectSSE(port, 500);
    expect(statusCode).toBe(200);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('connected');
    const data = JSON.parse(events[0].data);
    expect(data).toHaveProperty('clientId');
    expect(data).toHaveProperty('timestamp');
  });

  it('forwards session.output events via SSE', async () => {
    // Connect to SSE, then emit an event after a short delay
    const ssePromise = connectSSE(port, 1000);

    await new Promise((r) => setTimeout(r, 200)); // Wait for SSE to connect

    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'test-conv',
      sessionId: 'test-sess',
      projectDir: '/home/ayaz/test-project',
      text: 'Hello from test',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvent = events.find((e) => e.event === 'session.output');
    expect(outputEvent).toBeDefined();
    const data = JSON.parse(outputEvent!.data);
    expect(data.text).toBe('Hello from test');
    expect(data.conversationId).toBe('test-conv');
  });

  it('forwards session.blocking events via SSE', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.blocking', {
      type: 'session.blocking',
      conversationId: 'conv-block',
      sessionId: 'sess-block',
      projectDir: '/home/ayaz/test-project',
      pattern: 'QUESTION',
      text: 'Which database?',
      respondUrl: 'http://localhost:9090/v1/sessions/sess-block/respond',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const blockingEvent = events.find((e) => e.event === 'session.blocking');
    expect(blockingEvent).toBeDefined();
    const data = JSON.parse(blockingEvent!.data);
    expect(data.pattern).toBe('QUESTION');
    expect(data.respondUrl).toContain('/respond');
  });

  it('forwards session.phase_complete events via SSE', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.phase_complete', {
      type: 'session.phase_complete',
      conversationId: 'conv-phase',
      sessionId: 'sess-phase',
      projectDir: '/home/ayaz/test-project',
      pattern: 'PHASE_COMPLETE',
      text: 'Phase 7 complete',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const phaseEvent = events.find((e) => e.event === 'session.phase_complete');
    expect(phaseEvent).toBeDefined();
    expect(JSON.parse(phaseEvent!.data).text).toBe('Phase 7 complete');
  });

  it('forwards session.error events via SSE', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.error', {
      type: 'session.error',
      conversationId: 'conv-err',
      sessionId: 'sess-err',
      projectDir: '/home/ayaz/test-project',
      error: 'CC crashed',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const errorEvent = events.find((e) => e.event === 'session.error');
    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent!.data).error).toBe('CC crashed');
  });

  it('forwards session.done events via SSE', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.done', {
      type: 'session.done',
      conversationId: 'conv-done',
      sessionId: 'sess-done',
      projectDir: '/home/ayaz/test-project',
      usage: { input_tokens: 300, output_tokens: 150 },
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const doneEvent = events.find((e) => e.event === 'session.done');
    expect(doneEvent).toBeDefined();
    const data = JSON.parse(doneEvent!.data);
    expect(data.usage.input_tokens).toBe(300);
  });

  it('receives multiple events in sequence', async () => {
    const ssePromise = connectSSE(port, 1500);
    await new Promise((r) => setTimeout(r, 200));

    // Emit 3 events in sequence
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'chunk1', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'chunk2', timestamp: '',
    });
    eventBus.emit('session.done', {
      type: 'session.done',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', timestamp: '',
    });

    const { events } = await ssePromise;
    const bridgeEvents = events.filter((e) => e.event !== 'connected');
    expect(bridgeEvents).toHaveLength(3);
    expect(bridgeEvents[0].event).toBe('session.output');
    expect(bridgeEvents[1].event).toBe('session.output');
    expect(bridgeEvents[2].event).toBe('session.done');
  });

  it('SSE content type headers are correct', async () => {
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/v1/notifications/stream`,
        { headers: { authorization: `Bearer ${config.bridgeApiKey}` } },
        (res) => {
          resolve(res.headers);
          setTimeout(() => req.destroy(), 100);
        },
      );
    });
    expect(headers['content-type']).toContain('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');
  });

  // ---- Project filtering tests ----

  it('filters events by project_dir query param', async () => {
    const ssePromise = connectSSE(port, 1000, { projectDir: '/home/ayaz/project-a' });
    await new Promise((r) => setTimeout(r, 200));

    // Emit matching event
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c1',
      sessionId: 's1',
      projectDir: '/home/ayaz/project-a',
      text: 'matching event',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvent = events.find((e) => e.event === 'session.output');
    expect(outputEvent).toBeDefined();
    expect(JSON.parse(outputEvent!.data).text).toBe('matching event');
  });

  it('skips events from different project', async () => {
    const ssePromise = connectSSE(port, 1000, { projectDir: '/home/ayaz/project-a' });
    await new Promise((r) => setTimeout(r, 200));

    // Emit non-matching event (different project)
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c2',
      sessionId: 's2',
      projectDir: '/home/ayaz/project-b',
      text: 'wrong project event',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvents = events.filter((e) => e.event === 'session.output');
    expect(outputEvents).toHaveLength(0);
  });

  it('forwards all events when no project_dir filter', async () => {
    const ssePromise = connectSSE(port, 1000);
    await new Promise((r) => setTimeout(r, 200));

    // Emit events from two different projects
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c1',
      sessionId: 's1',
      projectDir: '/home/ayaz/project-a',
      text: 'from project A',
      timestamp: new Date().toISOString(),
    });
    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c2',
      sessionId: 's2',
      projectDir: '/home/ayaz/project-b',
      text: 'from project B',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvents = events.filter((e) => e.event === 'session.output');
    expect(outputEvents).toHaveLength(2);
  });

  it('includes projectFilter in connected event', async () => {
    const { events } = await connectSSE(port, 500, { projectDir: '/home/ayaz/project-a' });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('connected');
    const data = JSON.parse(events[0].data);
    expect(data.projectFilter).toBe('/home/ayaz/project-a');
  });

  it('includes null projectFilter when no filter set', async () => {
    const { events } = await connectSSE(port, 500);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('connected');
    const data = JSON.parse(events[0].data);
    expect(data.projectFilter).toBeNull();
  });
});
