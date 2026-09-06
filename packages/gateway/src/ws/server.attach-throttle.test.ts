/**
 * Round 45 — real-handshake regression for WS login-throttle accounting.
 *
 * server.test.ts stubs the WebSocketServer (`mockWss.emit = vi.fn()`), so
 * `this.wss.emit('connection', ...)` in the attachToServer upgrade handler never
 * reaches handleConnection. That blind spot is exactly why the defect hid: the
 * upgrade handler gated the request (:389) and handleConnection gated it AGAIN
 * (:486), spending 2 of wsLoginThrottle's 10 attempts per connection — so a
 * client got 5 connections/minute, not 10.
 *
 * This file is the real-collaborator counterpart (same pattern as
 * routes/ui-auth.throttle.test.ts): a real http.Server and a real ws handshake.
 * Only the throttle COLLABORATOR is instrumented, because the property under
 * test is how many times production code calls it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';

const checkCalls: string[] = [];

vi.mock('../utils/login-throttle.js', () => ({
  createLoginThrottle: () => ({
    check: (ip: string) => {
      checkCalls.push(ip);
      return { allowed: true };
    },
    isLockedOut: () => false,
    recordFailure: () => {},
    recordSuccess: () => {},
    cleanup: () => {},
    reset: () => {},
  }),
}));

// DEFAULT_LOCALHOST_WS_ORIGINS allows this; isOriginAllowed() rejects a MISSING
// origin before the gates run, so the header is required for the test to be
// meaningful rather than a false pass.
const ALLOWED_ORIGIN = 'http://localhost:4173';

describe('WS gateway attachToServer throttle accounting (real handshake)', () => {
  it('spends exactly one login-throttle attempt per connection', async () => {
    const { WSGateway, setWsAuthConfig, resetWsAuthConfig } = await import('./server.js');

    let httpServer: Server | null = null;
    let gw: InstanceType<typeof WSGateway> | null = null;
    let client: WebSocket | null = null;

    try {
      setWsAuthConfig({ type: 'none', apiKeys: [] });
      httpServer = createServer();
      gw = new WSGateway({ path: '/ws' });
      gw.attachToServer(httpServer);
      await new Promise<void>((r) => httpServer!.listen(0, '127.0.0.1', r));

      const port = (httpServer!.address() as { port: number }).port;
      checkCalls.length = 0;

      client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ALLOWED_ORIGIN });
      await new Promise<void>((resolve, reject) => {
        client!.once('open', resolve);
        client!.once('error', reject);
      });

      // The upgrade handler is the accept-path gate in this mode; handleConnection
      // must not run a second one for the same request.
      expect(checkCalls).toEqual(['127.0.0.1']);
    } finally {
      client?.terminate();
      gw?.stop();
      resetWsAuthConfig();
      await new Promise<void>((r) => httpServer?.close(() => r()));
    }
  }, 30_000);

  it('charges ten sequential connections with ten attempts, not twenty', async () => {
    const { WSGateway, setWsAuthConfig, resetWsAuthConfig } = await import('./server.js');

    let httpServer: Server | null = null;
    let gw: InstanceType<typeof WSGateway> | null = null;
    const clients: WebSocket[] = [];

    try {
      setWsAuthConfig({ type: 'none', apiKeys: [] });
      httpServer = createServer();
      gw = new WSGateway({ path: '/ws' });
      gw.attachToServer(httpServer);
      await new Promise<void>((r) => httpServer!.listen(0, '127.0.0.1', r));
      const port = (httpServer!.address() as { port: number }).port;

      checkCalls.length = 0;
      const outcomes: string[] = [];

      // maxAttempts is 10, so 10 sequential connections must be admitted.
      for (let i = 0; i < 10; i++) {
        const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ALLOWED_ORIGIN });
        clients.push(client);
        outcomes.push(
          await new Promise<string>((resolve) => {
            client.once('open', () => resolve('open'));
            client.once('error', () => resolve('error'));
            client.once('close', (code) => {
              if (code === 1008) resolve('rate-limited');
            });
          })
        );
      }

      expect(outcomes).toEqual(Array(10).fill('open'));
      expect(checkCalls).toHaveLength(10);
    } finally {
      for (const c of clients) c.terminate();
      gw?.stop();
      resetWsAuthConfig();
      await new Promise<void>((r) => httpServer?.close(() => r()));
    }
  }, 30_000);
});
