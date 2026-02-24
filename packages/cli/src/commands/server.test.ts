/**
 * Server CLI Command Tests
 *
 * Tests for server.ts — starts the HTTP API server with database configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockLoadApiKeysToEnvironment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSettingsRepo = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
}));
const mockInitializePlugins = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockInitializeScheduler = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockServe = vi.hoisted(() => vi.fn());
const mockServerClose = vi.hoisted(() => vi.fn());

const mockCreateApp = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    fetch: vi.fn(),
  })
);

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@hono/node-server', () => ({
  serve: mockServe,
}));

vi.mock('@ownpilot/gateway', () => ({
  createApp: mockCreateApp,
  loadApiKeysToEnvironment: mockLoadApiKeysToEnvironment,
  settingsRepo: mockSettingsRepo,
  initializePlugins: mockInitializePlugins,
  initializeScheduler: mockInitializeScheduler,
  RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { startServer } from './server.js';

describe('Server CLI Command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Mock serve to immediately call the callback
    mockServe.mockImplementation((options, callback) => {
      callback({ address: '0.0.0.0', port: 3000 });
      return { close: mockServerClose };
    });
  });

  describe('startServer', () => {
    it('starts server with default configuration', async () => {
      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockLoadApiKeysToEnvironment).toHaveBeenCalled();
      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3000,
          host: '0.0.0.0',
        })
      );
      expect(mockInitializePlugins).toHaveBeenCalled();
      expect(mockInitializeScheduler).toHaveBeenCalled();
      expect(mockServe).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server running at'));
    });

    it('exits when invalid port provided', async () => {
      await startServer({ port: 'invalid', host: '0.0.0.0' });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid port'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when port is out of range', async () => {
      await startServer({ port: '99999', host: '0.0.0.0' });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid port'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('configures auth with API keys from database', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'gateway_api_keys') return Promise.resolve('key1,key2,key3');
        return Promise.resolve(null);
      });

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'api-key', apiKeys: ['key1', 'key2', 'key3'] },
        })
      );
    });

    it('configures auth with JWT from database', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'gateway_jwt_secret') return Promise.resolve('my-secret-key');
        return Promise.resolve(null);
      });

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'jwt', jwtSecret: 'my-secret-key' },
        })
      );
    });

    it('disables auth when auth option is false', async () => {
      await startServer({ port: '3000', host: '0.0.0.0', auth: false });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'none' },
        })
      );
    });

    it('configures rate limiting from database', async () => {
      mockSettingsRepo.get.mockImplementation((key: string) => {
        if (key === 'gateway_rate_limit_max') return Promise.resolve(200);
        if (key === 'gateway_rate_limit_window_ms') return Promise.resolve(120000);
        return Promise.resolve(null);
      });

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          rateLimit: {
            windowMs: 120000,
            maxRequests: 200,
          },
        })
      );
    });

    it('uses default rate limits when not in database', async () => {
      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          rateLimit: expect.objectContaining({
            maxRequests: expect.any(Number),
            windowMs: expect.any(Number),
          }),
        })
      );
    });

    it('falls back to env vars for auth when database empty', async () => {
      const originalApiKeys = process.env.API_KEYS;
      const originalJwtSecret = process.env.JWT_SECRET;
      process.env.API_KEYS = 'env-key1,env-key2';
      process.env.JWT_SECRET = '';

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'api-key', apiKeys: ['env-key1', 'env-key2'] },
        })
      );

      process.env.API_KEYS = originalApiKeys;
      process.env.JWT_SECRET = originalJwtSecret;
    });

    it('continues even when plugin initialization fails', async () => {
      mockInitializePlugins.mockRejectedValue(new Error('Plugin error'));

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Plugin initialization failed'),
        expect.anything()
      );
      expect(mockServe).toHaveBeenCalled();
    });

    it('continues even when scheduler initialization fails', async () => {
      mockInitializeScheduler.mockRejectedValue(new Error('Scheduler error'));

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scheduler initialization failed'),
        expect.anything()
      );
      expect(mockServe).toHaveBeenCalled();
    });

    it('uses custom CORS origins from env var', async () => {
      const originalCors = process.env.CORS_ORIGINS;
      process.env.CORS_ORIGINS = 'https://example.com,https://app.example.com';

      await startServer({ port: '3000', host: '0.0.0.0' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          corsOrigins: ['https://example.com', 'https://app.example.com'],
        })
      );

      process.env.CORS_ORIGINS = originalCors;
    });

    // ========================================================================
    // Shutdown handler (lines 138-146)
    // ========================================================================

    describe('shutdown signal handlers', () => {
      it('registers SIGINT and SIGTERM handlers after server starts', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startServer({ port: '3000', host: '0.0.0.0' });

        expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

        processOnSpy.mockRestore();
      });

      it('calls server.close() when SIGINT fires', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startServer({ port: '3000', host: '0.0.0.0' });

        // Find the SIGINT handler
        const sigintCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT');
        expect(sigintCall).toBeDefined();

        const shutdownFn = sigintCall![1] as () => void;

        // Mock setTimeout to capture the unref call
        const mockUnref = vi.fn();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({ unref: mockUnref } as unknown as ReturnType<typeof setTimeout>);

        shutdownFn();

        expect(mockServerClose).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Shutting down'));
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
        expect(mockUnref).toHaveBeenCalled();

        setTimeoutSpy.mockRestore();
        processOnSpy.mockRestore();
      });

      it('only shuts down once even when SIGINT fires twice', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startServer({ port: '3000', host: '0.0.0.0' });

        const sigintCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT');
        const shutdownFn = sigintCall![1] as () => void;

        const mockUnref = vi.fn();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({ unref: mockUnref } as unknown as ReturnType<typeof setTimeout>);

        shutdownFn();
        shutdownFn(); // second call should be a no-op

        // server.close should only be called once
        expect(mockServerClose).toHaveBeenCalledTimes(1);

        setTimeoutSpy.mockRestore();
        processOnSpy.mockRestore();
      });

      it('calls server.close() when SIGTERM fires', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startServer({ port: '3000', host: '0.0.0.0' });

        const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
        expect(sigtermCall).toBeDefined();

        const shutdownFn = sigtermCall![1] as () => void;

        const mockUnref = vi.fn();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({ unref: mockUnref } as unknown as ReturnType<typeof setTimeout>);

        shutdownFn();

        expect(mockServerClose).toHaveBeenCalled();

        setTimeoutSpy.mockRestore();
        processOnSpy.mockRestore();
      });

      it('schedules process.exit(0) after 3 seconds on shutdown', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startServer({ port: '3000', host: '0.0.0.0' });

        const sigintCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT');
        const shutdownFn = sigintCall![1] as () => void;

        let capturedCallback: (() => void) | undefined;
        const mockUnref = vi.fn();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void, _ms?: number) => {
          capturedCallback = cb;
          return { unref: mockUnref } as unknown as ReturnType<typeof setTimeout>;
        });

        shutdownFn();

        // Execute the captured timeout callback to trigger process.exit(0)
        expect(capturedCallback).toBeDefined();
        capturedCallback!();
        expect(exitSpy).toHaveBeenCalledWith(0);

        setTimeoutSpy.mockRestore();
        processOnSpy.mockRestore();
      });
    });
  });
});
