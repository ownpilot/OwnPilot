/**
 * Start CLI Command Tests
 *
 * Tests for start.ts — starts both server and bot together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockLoadApiKeysToEnvironment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetDefaultProvider = vi.hoisted(() => vi.fn().mockResolvedValue('openai'));
const mockIsDemoModeFromSettings = vi.hoisted(() => vi.fn().mockResolvedValue(false));

const mockServe = vi.hoisted(() => vi.fn());

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
  getDefaultProvider: mockGetDefaultProvider,
  isDemoModeFromSettings: mockIsDemoModeFromSettings,
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { startAll } from './start.js';

describe('Start CLI Command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Mock serve to immediately call the callback
    mockServe.mockImplementation((options, callback) => {
      callback({ address: '0.0.0.0', port: 3000 });
      return { close: vi.fn() };
    });
  });

  describe('startAll', () => {
    it('starts server with default configuration', async () => {
      await startAll({ port: '3000' });

      expect(mockLoadApiKeysToEnvironment).toHaveBeenCalled();
      expect(mockGetDefaultProvider).toHaveBeenCalled();
      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3000,
          host: '0.0.0.0',
          auth: { type: 'none' },
        })
      );
      expect(mockServe).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server running at'));
    });

    it('exits when invalid port provided', async () => {
      await startAll({ port: 'invalid' });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid port'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when port is out of range', async () => {
      await startAll({ port: '70000' });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid port'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('shows warning in demo mode', async () => {
      mockIsDemoModeFromSettings.mockResolvedValue(true);
      mockGetDefaultProvider.mockResolvedValue(null);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await startAll({ port: '3000' });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: No AI provider'));
    });

    it('shows provider in non-demo mode', async () => {
      mockIsDemoModeFromSettings.mockResolvedValue(false);
      mockGetDefaultProvider.mockResolvedValue('anthropic');

      await startAll({ port: '3000' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Default provider: anthropic'));
    });

    it('configures API key auth when API_KEYS env var set', async () => {
      const originalApiKeys = process.env.API_KEYS;
      process.env.API_KEYS = 'key1,key2';

      await startAll({ port: '3000' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'api-key', apiKeys: ['key1', 'key2'] },
        })
      );

      process.env.API_KEYS = originalApiKeys;
    });

    it('uses default CORS origins when env var not set', async () => {
      await startAll({ port: '3000' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          corsOrigins: ['http://localhost:5173'],
        })
      );
    });

    it('uses custom CORS origins from env var', async () => {
      const originalCors = process.env.CORS_ORIGINS;
      process.env.CORS_ORIGINS = 'http://localhost:3000,http://example.com';

      await startAll({ port: '3000' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          corsOrigins: ['http://localhost:3000', 'http://example.com'],
        })
      );

      process.env.CORS_ORIGINS = originalCors;
    });

    it('parses port as integer', async () => {
      await startAll({ port: '8080' });

      expect(mockCreateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 8080,
        })
      );
    });

    // ========================================================================
    // Shutdown handler (lines 90-95)
    // ========================================================================

    describe('shutdown signal handlers', () => {
      it('registers SIGINT and SIGTERM handlers after server starts', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startAll({ port: '3000' });

        expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

        processOnSpy.mockRestore();
      });

      it('calls process.exit(0) when SIGINT fires', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startAll({ port: '3000' });

        // Find the SIGINT handler
        const sigintCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT');
        expect(sigintCall).toBeDefined();

        const shutdownFn = sigintCall![1] as () => void;
        shutdownFn();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Shutting down'));
        expect(exitSpy).toHaveBeenCalledWith(0);

        processOnSpy.mockRestore();
      });

      it('calls process.exit(0) when SIGTERM fires', async () => {
        const processOnSpy = vi.spyOn(process, 'on');

        await startAll({ port: '3000' });

        // Find the SIGTERM handler
        const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
        expect(sigtermCall).toBeDefined();

        const shutdownFn = sigtermCall![1] as () => void;
        shutdownFn();

        expect(exitSpy).toHaveBeenCalledWith(0);

        processOnSpy.mockRestore();
      });
    });
  });
});
