/**
 * Tests for Tunnel Commands
 *
 * The main tunnelStart* functions block forever waiting for SIGINT/SIGTERM.
 * Tests that exercise those code paths let the promise float (not awaited)
 * and check side-effects via mocks. A short delay gives the async init time
 * to complete before assertions run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockListener = vi.hoisted(() => ({
  url: vi.fn(() => 'https://abc123.ngrok-free.app'),
  close: vi.fn(async () => undefined),
}));

const mockNgrok = vi.hoisted(() => ({
  authtoken: vi.fn(async () => undefined),
  forward: vi.fn(async () => mockListener),
  disconnect: vi.fn(async () => undefined),
}));

vi.mock('@ngrok/ngrok', () => mockNgrok);

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { tunnelStartNgrok, tunnelStartCloudflare, tunnelStop, tunnelStatus } from './tunnel.js';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tunnel commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  // Collect floating promises for cleanup
  const floatingPromises: Promise<unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Default: fetch returns OK for all gateway calls
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/config-services/telegram_bot') && !url.includes('/entries/')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              entries: [{ id: 'entry-1', isDefault: true, data: { bot_token: 'tok' } }],
            },
          }),
        };
      }
      if (url.includes('/entries/')) {
        return { ok: true, json: async () => ({ data: {} }) };
      }
      if (url.includes('/reconnect')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false };
    });
  });

  afterEach(async () => {
    // Clean up module state
    await tunnelStop();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    floatingPromises.length = 0;
  });

  // ==========================================================================
  // tunnelStatus
  // ==========================================================================

  describe('tunnelStatus()', () => {
    it('should show "No active tunnel" when no tunnel running', () => {
      tunnelStatus();
      expect(consoleSpy).toHaveBeenCalledWith('No active tunnel.');
    });
  });

  // ==========================================================================
  // tunnelStop
  // ==========================================================================

  describe('tunnelStop()', () => {
    it('should show "No active tunnel" when no tunnel running', async () => {
      await tunnelStop();
      expect(consoleSpy).toHaveBeenCalledWith('No active tunnel.');
    });
  });

  // ==========================================================================
  // tunnelStartNgrok
  // ==========================================================================

  describe('tunnelStartNgrok()', () => {
    it('should call ngrok.authtoken when token provided', async () => {
      // Start tunnel — do not await (it blocks forever on signal wait)
      const p = tunnelStartNgrok({ token: 'my-ngrok-token', port: '3000' });
      floatingPromises.push(p.catch(() => {}));

      // Wait for async init
      await vi.waitFor(() => {
        expect(mockNgrok.authtoken).toHaveBeenCalledWith('my-ngrok-token');
      });

      expect(mockNgrok.forward).toHaveBeenCalledWith({
        addr: 3000,
        authtoken_from_env: true,
      });
    });

    it('should use port 8080 by default', async () => {
      const p = tunnelStartNgrok({});
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(mockNgrok.forward).toHaveBeenCalled();
      });

      expect(mockNgrok.forward).toHaveBeenCalledWith({
        addr: 8080,
        authtoken_from_env: true,
      });
    });

    it('should register webhook URL with gateway', async () => {
      const p = tunnelStartNgrok({ port: '4000' });
      floatingPromises.push(p.catch(() => {}));

      // Wait for the full registerWebhookUrl flow to complete
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/channels/channel.telegram/reconnect'),
          expect.objectContaining({ method: 'POST' })
        );
      });

      // Verify gateway calls
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/config-services/telegram_bot')
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/entries/entry-1'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should exit(1) if tunnel already running', async () => {
      // Start first tunnel
      const p1 = tunnelStartNgrok({});
      floatingPromises.push(p1.catch(() => {}));

      await vi.waitFor(() => {
        expect(mockNgrok.forward).toHaveBeenCalled();
      });

      // Try to start second — this calls process.exit(1) synchronously
      tunnelStartNgrok({});

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('already running'));
    });

    it('should exit(1) if ngrok URL is null', async () => {
      mockListener.url.mockReturnValueOnce(undefined as unknown as string);

      // Don't await — function may block at signal wait if the error path is somehow
      // not taken; use vi.waitFor to assert side-effects instead.
      const p = tunnelStartNgrok({});
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ngrok tunnel failed'));
    });

    it('should warn when gateway is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const p = tunnelStartNgrok({ port: '9000' });
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not reach gateway')
        );
      });
    });
  });

  // ==========================================================================
  // tunnelStartCloudflare
  // ==========================================================================

  describe('tunnelStartCloudflare()', () => {
    function createMockChild(opts?: { emitUrl?: string; emitError?: Error }) {
      const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
      const child = {
        stdout: {
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[`stdout.${event}`] ??= [];
            handlers[`stdout.${event}`]!.push(handler);
          }),
        },
        stderr: {
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[`stderr.${event}`] ??= [];
            handlers[`stderr.${event}`]!.push(handler);
            if (event === 'data' && opts?.emitUrl) {
              setTimeout(() => handler(Buffer.from(opts.emitUrl!)), 10);
            }
          }),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] ??= [];
          handlers[event]!.push(handler);
          if (event === 'error' && opts?.emitError) {
            setTimeout(() => handler(opts.emitError!), 10);
          }
        }),
        kill: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(child as never);
      return child;
    }

    it('should spawn cloudflared with correct args', async () => {
      createMockChild({ emitUrl: 'https://test-tunnel-abc.trycloudflare.com' });

      const p = tunnelStartCloudflare({ port: '5000' });
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalled();
      });

      expect(spawn).toHaveBeenCalledWith(
        'cloudflared',
        ['tunnel', '--url', 'http://localhost:5000'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    });

    it('should include --hostname when domain provided', async () => {
      createMockChild({ emitUrl: 'https://my-tunnel-xyz.trycloudflare.com' });

      const p = tunnelStartCloudflare({ domain: 'my.tunnel.dev', port: '8080' });
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalled();
      });

      expect(spawn).toHaveBeenCalledWith(
        'cloudflared',
        ['tunnel', '--url', 'http://localhost:8080', '--hostname', 'my.tunnel.dev'],
        expect.any(Object)
      );
    });

    it('should exit(1) if cloudflared is not found', async () => {
      createMockChild({
        emitError: Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }),
      });

      await tunnelStartCloudflare({});

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('cloudflared binary not found')
      );
    });

    it('should use port 8080 by default', async () => {
      createMockChild({ emitUrl: 'https://xyz.trycloudflare.com' });

      const p = tunnelStartCloudflare({});
      floatingPromises.push(p.catch(() => {}));

      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalled();
      });

      expect(spawn).toHaveBeenCalledWith(
        'cloudflared',
        ['tunnel', '--url', 'http://localhost:8080'],
        expect.any(Object)
      );
    });
  });
});
