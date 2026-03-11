/**
 * Tests for SSE event id: field emission and replay buffer population.
 * Task 3 of Phase 08-01.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import { registerRoutes } from '../src/api/routes.ts';
import { eventBus } from '../src/event-bus.ts';
import { replayBuffer } from '../src/event-replay-buffer.ts';
import { config } from '../src/config.ts';

/**
 * Extended SSE helper that also captures the `id:` field from SSE frames.
 */
function connectSSEWithIds(
  port: number,
  timeoutMs = 1500,
  options?: { headers?: Record<string, string>; projectDir?: string },
): Promise<{ events: Array<{ event: string; data: string; id?: string }>; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string; id?: string }> = [];
    let buffer = '';

    const url = options?.projectDir
      ? `http://127.0.0.1:${port}/v1/notifications/stream?project_dir=${encodeURIComponent(options.projectDir)}`
      : `http://127.0.0.1:${port}/v1/notifications/stream`;

    const reqHeaders: Record<string, string> = {
      authorization: `Bearer ${config.bridgeApiKey}`,
      ...options?.headers,
    };

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

describe('SSE id: field emission (Task 3 — 08-01)', () => {
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

  it('SSE event frames include id: field for bridge events', async () => {
    const ssePromise = connectSSEWithIds(port, 1200);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.output', {
      type: 'session.output',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      text: 'hello',
      timestamp: new Date().toISOString(),
    });

    const { events } = await ssePromise;
    const outputEvent = events.find(e => e.event === 'session.output');
    expect(outputEvent).toBeDefined();
    expect(outputEvent!.id).toBeDefined();
    expect(Number(outputEvent!.id)).toBeGreaterThan(0);
  });

  it('SSE event id: values are strictly increasing across events', async () => {
    const ssePromise = connectSSEWithIds(port, 1200);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'first', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'second', timestamp: '',
    });
    eventBus.emit('session.output', {
      type: 'session.output', conversationId: 'c', sessionId: 's', text: 'third', timestamp: '',
    });

    const { events } = await ssePromise;
    const outputEvents = events.filter(e => e.event === 'session.output');
    expect(outputEvents).toHaveLength(3);

    const ids = outputEvents.map(e => Number(e.id));
    expect(ids[0]).toBeGreaterThan(0);
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });

  it('emitted events are stored in the replay buffer', async () => {
    const initialSize = replayBuffer.size;
    const ssePromise = connectSSEWithIds(port, 1200);
    await new Promise((r) => setTimeout(r, 200));

    eventBus.emit('session.done', {
      type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '',
    });

    await ssePromise;
    expect(replayBuffer.size).toBeGreaterThan(initialSize);
  });
});
