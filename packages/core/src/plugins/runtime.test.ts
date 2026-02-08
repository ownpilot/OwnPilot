/**
 * Secure Plugin Runtime Tests
 *
 * Comprehensive tests for:
 * - PluginSecurityBarrier: access control, audit logging, absolute barriers
 * - SecurePluginRuntime: plugin lifecycle, worker management, events, calls
 * - Factory functions: createPluginRuntime, getDefaultRuntime, resetDefaultRuntime
 * - Type exports: PluginState, PluginInstance, LoadOptions, RuntimeConfig, etc.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks - these must be available inside vi.mock() factories
// ---------------------------------------------------------------------------

const mockWorkerInstance = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        const idx = eventHandlers.indexOf(handler);
        if (idx !== -1) eventHandlers.splice(idx, 1);
      }
    }),
    postMessage: vi.fn(),
    terminate: vi.fn(),
    _handlers: handlers,
    _emit(event: string, ...args: unknown[]) {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const h of [...eventHandlers]) h(...args);
      }
    },
    _reset() {
      handlers.clear();
      this.on.mockClear();
      this.once.mockClear();
      this.off.mockClear();
      this.postMessage.mockClear();
      this.terminate.mockClear();
    },
  };
});

const mockRandomUUID = vi.hoisted(() => vi.fn(() => 'mock-uuid-1234'));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(() => mockWorkerInstance),
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  PluginSecurityBarrier,
  SecurePluginRuntime,
  createPluginRuntime,
  getDefaultRuntime,
  resetDefaultRuntime,
} from './runtime.js';
import type {
  PluginState,
  PluginInstance as _PluginInstance,
  LoadOptions as _LoadOptions,
  RuntimeConfig,
  RuntimeEvents as _RuntimeEvents,
} from './runtime.js';
import {
  IsolationEnforcer,
  PluginIsolationManager,
  STORAGE_QUOTAS,
} from './isolation.js';
import type { MarketplaceManifest } from './marketplace.js';
import { createMinimalSecurityDeclaration } from './marketplace.js';
import { unsafePluginId } from '../types/branded.js';

// =============================================================================
// Helpers
// =============================================================================

function makeManifest(overrides: Partial<MarketplaceManifest> = {}): MarketplaceManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    publisher: {
      id: 'pub-1',
      name: 'Test Publisher',
      email: 'test@example.com',
      verified: false,
    },
    category: 'utilities' as const,
    tags: ['test'],
    security: createMinimalSecurityDeclaration(),
    capabilities: ['storage:read' as const],
    main: 'index.js',
    files: ['index.js'],
    compatibility: { minGatewayVersion: '1.0.0' },
    ...overrides,
  };
}

function makeRuntime(config: Partial<RuntimeConfig> = {}): SecurePluginRuntime {
  return new SecurePluginRuntime({
    maxPlugins: 50,
    maxErrors: 5,
    debug: false,
    pluginDir: './plugins',
    minTrustLevel: 'unverified',
    ...config,
  });
}

/**
 * Load a plugin (no start). Returns the loaded plugin instance.
 */
async function loadPlugin(
  rt: SecurePluginRuntime,
  manifest: MarketplaceManifest,
): Promise<void> {
  const result = await rt.load(manifest, { skipVerification: true });
  if (!result.ok) throw new Error(`Load failed: ${result.error}`);
}

/**
 * Load and start a plugin by simulating the Worker 'ready' message.
 * After this, the plugin is in 'running' state with worker event
 * handlers registered on mockWorkerInstance.
 */
async function loadAndStartPlugin(
  rt: SecurePluginRuntime,
  manifest: MarketplaceManifest,
): Promise<void> {
  await loadPlugin(rt, manifest);

  const startPromise = rt.start(manifest.id);
  // Wait for worker handlers to be registered
  await vi.waitFor(() => {
    expect(mockWorkerInstance._handlers.has('message')).toBe(true);
  });
  mockWorkerInstance._emit('message', { type: 'ready' });
  const result = await startPromise;
  if (!result.ok) throw new Error(`Start failed: ${result.error}`);
}

// =============================================================================
// PluginSecurityBarrier
// =============================================================================

describe('PluginSecurityBarrier', () => {
  let enforcer: IsolationEnforcer;
  let barrier: PluginSecurityBarrier;
  const pluginId = unsafePluginId('barrier-plugin');

  beforeEach(() => {
    vi.clearAllMocks();
    enforcer = new IsolationEnforcer({ maxViolations: 10 });
    barrier = new PluginSecurityBarrier(pluginId, enforcer);
  });

  describe('checkAccess', () => {
    it('should allow access to non-sensitive resources', () => {
      const allowed = barrier.checkAccess('some:resource', 'read');
      expect(allowed).toBe(true);
    });

    it('should deny access to memory resources', () => {
      const allowed = barrier.checkAccess('memory:user-data', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to credentials resources', () => {
      const allowed = barrier.checkAccess('credentials:api-key', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to credential (singular) resources', () => {
      const allowed = barrier.checkAccess('credential:token', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to userMemory resources', () => {
      const allowed = barrier.checkAccess('userMemory', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to userCredential resources', () => {
      const allowed = barrier.checkAccess('userCredential', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to SecureMemoryStore', () => {
      const allowed = barrier.checkAccess('SecureMemoryStore', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to UserCredentialStore', () => {
      const allowed = barrier.checkAccess('UserCredentialStore', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to masterKey resources', () => {
      const allowed = barrier.checkAccess('masterKey', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to encryptionKey resources', () => {
      const allowed = barrier.checkAccess('encryptionKey', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to privateKey resources', () => {
      const allowed = barrier.checkAccess('privateKey', 'read');
      expect(allowed).toBe(false);
    });

    it('should deny access to audit resources', () => {
      const allowed = barrier.checkAccess('audit:logs', 'read');
      expect(allowed).toBe(false);
    });

    it('should be case-insensitive for absolute barrier matching', () => {
      expect(barrier.checkAccess('MEMORY:USER', 'read')).toBe(false);
      expect(barrier.checkAccess('Credentials:Token', 'read')).toBe(false);
      expect(barrier.checkAccess('MASTERKEY', 'read')).toBe(false);
    });

    it('should record a violation when access to a barrier resource is denied', () => {
      barrier.checkAccess('memory:user', 'read');
      const violations = enforcer.getViolations(pluginId);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations[0].attemptedResource).toBe('memory:user');
    });

    it('should log denied access in the audit log', () => {
      barrier.checkAccess('credentials:secret', 'write');
      const log = barrier.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].allowed).toBe(false);
      expect(log[0].resource).toBe('credentials:secret');
      expect(log[0].action).toBe('write');
    });

    it('should log allowed access in the audit log', () => {
      barrier.checkAccess('safe:resource', 'read');
      const log = barrier.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].allowed).toBe(true);
    });

    it('should deny all access when the enforcer blocks the plugin', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let i = 0; i < 10; i++) {
        enforcer.recordViolation({
          pluginId,
          timestamp: new Date(),
          attemptedResource: 'memory:user',
          action: 'read',
        });
      }
      vi.restoreAllMocks();

      const allowed = barrier.checkAccess('safe:resource', 'read');
      expect(allowed).toBe(false);
    });
  });

  describe('getAuditLog', () => {
    it('should return empty array initially', () => {
      expect(barrier.getAuditLog()).toEqual([]);
    });

    it('should return a copy of the audit log', () => {
      barrier.checkAccess('some:resource', 'read');
      const log1 = barrier.getAuditLog();
      const log2 = barrier.getAuditLog();
      expect(log1).toEqual(log2);
      expect(log1).not.toBe(log2);
    });

    it('should contain correct timestamp, action, resource, and allowed fields', () => {
      barrier.checkAccess('my:resource', 'write');
      const log = barrier.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].timestamp).toBeInstanceOf(Date);
      expect(log[0].action).toBe('write');
      expect(log[0].resource).toBe('my:resource');
      expect(typeof log[0].allowed).toBe('boolean');
    });

    it('should accumulate entries for multiple access checks', () => {
      barrier.checkAccess('resource1', 'read');
      barrier.checkAccess('resource2', 'write');
      barrier.checkAccess('memory:data', 'read');
      expect(barrier.getAuditLog()).toHaveLength(3);
    });

    it('should truncate audit log to 1000 entries', () => {
      for (let i = 0; i < 1005; i++) {
        barrier.checkAccess('resource', 'read');
      }
      const log = barrier.getAuditLog();
      expect(log).toHaveLength(1000);
    });
  });
});

// =============================================================================
// SecurePluginRuntime
// =============================================================================

describe('SecurePluginRuntime', () => {
  let runtime: SecurePluginRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstance._reset();
    runtime = makeRuntime();
  });

  afterEach(async () => {
    await resetDefaultRuntime();
  });

  describe('constructor', () => {
    it('should create runtime with default config when no options provided', () => {
      const rt = new SecurePluginRuntime();
      expect(rt).toBeInstanceOf(SecurePluginRuntime);
      expect(rt.getIsolationManager()).toBeInstanceOf(PluginIsolationManager);
    });

    it('should accept partial config and apply defaults', () => {
      const rt = new SecurePluginRuntime({ maxPlugins: 10 });
      expect(rt).toBeInstanceOf(SecurePluginRuntime);
    });

    it('should accept full custom config', () => {
      const rt = new SecurePluginRuntime({
        maxPlugins: 5,
        maxErrors: 3,
        debug: true,
        pluginDir: '/custom/plugins',
        defaultLimits: {
          cpuLimit: 1000,
          memoryLimit: 64 * 1024 * 1024,
          executionTimeout: 10000,
          storageQuota: STORAGE_QUOTAS.free,
        },
        minTrustLevel: 'verified',
      });
      expect(rt).toBeInstanceOf(SecurePluginRuntime);
    });

    it('should initialize with no plugins', () => {
      expect(runtime.getAll()).toEqual([]);
    });

    it('should provide an isolation manager', () => {
      expect(runtime.getIsolationManager()).toBeDefined();
    });

    it('should provide a verifier', () => {
      expect(runtime.getVerifier()).toBeDefined();
    });
  });

  // ===========================================================================
  // load
  // ===========================================================================

  describe('load', () => {
    it('should load a plugin successfully with skipVerification', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.state).toBe('loaded');
        expect(result.value.manifest.id).toBe('test-plugin');
        expect(result.value.errorCount).toBe(0);
      }
    });

    it('should set state to loaded after successful load', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('loaded');
      }
    });

    it('should reject loading a duplicate plugin', async () => {
      const manifest = makeManifest();
      await runtime.load(manifest, { skipVerification: true });
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('already loaded');
      }
    });

    it('should reject loading when max plugins reached', async () => {
      const rt = makeRuntime({ maxPlugins: 1 });
      await rt.load(makeManifest({ id: 'plugin-a' }), { skipVerification: true });
      const result = await rt.load(makeManifest({ id: 'plugin-b' }), {
        skipVerification: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Maximum number of plugins');
      }
    });

    it('should emit plugin:loaded event on successful load', async () => {
      const handler = vi.fn();
      runtime.on('plugin:loaded', handler);
      const manifest = makeManifest();
      await runtime.load(manifest, { skipVerification: true });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          manifest,
        }),
      );
    });

    it('should create a security barrier for the loaded plugin', async () => {
      const manifest = makeManifest();
      await runtime.load(manifest, { skipVerification: true });
      const barrier = runtime.getBarrier('test-plugin');
      expect(barrier).toBeDefined();
      expect(barrier).toBeInstanceOf(PluginSecurityBarrier);
    });

    it('should use custom capabilities from load options', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, {
        skipVerification: true,
        customCapabilities: ['storage:read', 'storage:write', 'network:fetch'],
      });
      expect(result.ok).toBe(true);
    });

    it('should use custom domains from load options', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, {
        skipVerification: true,
        customDomains: ['api.example.com'],
      });
      expect(result.ok).toBe(true);
    });

    it('should handle storage quota capabilities', async () => {
      const manifest = makeManifest({ capabilities: ['storage:quota:100mb'] });
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
    });

    it('should handle storage:quota:10mb capability', async () => {
      const manifest = makeManifest({ capabilities: ['storage:quota:10mb'] });
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
    });

    it('should handle storage:quota:1mb capability', async () => {
      const manifest = makeManifest({ capabilities: ['storage:quota:1mb'] });
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
    });

    it('should use custom quota from load options', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, {
        skipVerification: true,
        customQuota: 999,
      });
      expect(result.ok).toBe(true);
    });

    it('should populate verification as skipped when skipVerification is true', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.verification.valid).toBe(true);
        expect(result.value.verification.trustLevel).toBe('unverified');
        expect(result.value.verification.warnings).toContain('Verification skipped');
      }
    });

    it('should verify plugin when skipVerification is false', async () => {
      const manifest = makeManifest();
      const result = await runtime.load(manifest, { skipVerification: false });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.verification.valid).toBe(true);
      }
    });

    it('should reject plugin that fails verification', async () => {
      const verifier = runtime.getVerifier();
      verifier.addRevocation({
        pluginId: 'test-plugin',
        revokedAt: new Date().toISOString(),
        reason: 'Malware',
        severity: 'critical',
        publisherNotified: true,
      });
      const manifest = makeManifest();
      const result = await runtime.load(manifest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('verification failed');
      }
    });

    it('should reject plugin with trust level below minimum', async () => {
      const rt = makeRuntime({ minTrustLevel: 'verified' });
      const manifest = makeManifest();
      const result = await rt.load(manifest, { skipVerification: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('trust level');
      }
    });

    it('should auto-start plugin when autoStart option is set', async () => {
      const manifest = makeManifest();

      const loadPromise = runtime.load(manifest, {
        skipVerification: true,
        autoStart: true,
      });

      await vi.waitFor(() => {
        expect(mockWorkerInstance._handlers.has('message')).toBe(true);
      });

      mockWorkerInstance._emit('message', { type: 'ready' });

      const result = await loadPromise;
      expect(result).toBeDefined();
      if (result.ok) {
        expect(runtime.get('test-plugin')?.state).toBe('running');
      }
    });
  });

  // ===========================================================================
  // start
  // ===========================================================================

  describe('start', () => {
    it('should return error when plugin not found', async () => {
      const result = await runtime.start('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should return ok if plugin is already running', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);
      // Plugin is already running from loadAndStartPlugin
      const result = await runtime.start('test-plugin');
      expect(result.ok).toBe(true);
    });

    it('should return error when plugin is blocked', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);
      const instance = runtime.get('test-plugin')!;
      instance.state = 'blocked';

      const result = await runtime.start('test-plugin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('blocked');
      }
    });

    it('should create a worker and transition to running on success', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const startPromise = runtime.start('test-plugin');
      await vi.waitFor(() => {
        expect(mockWorkerInstance._handlers.has('message')).toBe(true);
      });
      mockWorkerInstance._emit('message', { type: 'ready' });

      const result = await startPromise;
      expect(result.ok).toBe(true);
      expect(runtime.get('test-plugin')?.state).toBe('running');
    });

    it('should emit plugin:started event on success', async () => {
      const handler = vi.fn();
      runtime.on('plugin:started', handler);

      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ pluginId: 'test-plugin' }),
      );
    });

    it('should set startedAt on success', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      const instance = runtime.get('test-plugin');
      expect(instance?.startedAt).toBeInstanceOf(Date);
    });

    it('should handle worker initialization timeout as error', async () => {
      vi.useFakeTimers();
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const startPromise = runtime.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);

      const result = await startPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to start plugin');
      }

      vi.useRealTimers();
    });

    it('should increment errorCount and set error state on failure', async () => {
      vi.useFakeTimers();
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const startPromise = runtime.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);
      await startPromise;

      const instance = runtime.get('test-plugin');
      expect(instance?.state).toBe('error');
      expect(instance?.errorCount).toBe(1);
      expect(instance?.lastError).toBeDefined();

      vi.useRealTimers();
    });

    it('should block plugin after maxErrors failures', async () => {
      vi.useFakeTimers();
      const rt = makeRuntime({ maxErrors: 2 });
      const manifest = makeManifest();
      await loadPlugin(rt, manifest);

      // First failure
      const start1 = rt.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);
      await start1;

      const inst = rt.get('test-plugin')!;
      inst.state = 'loaded';
      mockWorkerInstance._reset();

      // Second failure - should block
      const start2 = rt.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);
      await start2;

      expect(rt.get('test-plugin')?.state).toBe('blocked');

      vi.useRealTimers();
    });

    it('should emit plugin:error on failure', async () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      runtime.on('plugin:error', handler);

      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const startPromise = runtime.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);
      await startPromise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ pluginId: 'test-plugin' }),
      );

      vi.useRealTimers();
    });

    it('should emit plugin:blocked when maxErrors reached', async () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      const rt = makeRuntime({ maxErrors: 1 });
      rt.on('plugin:blocked', handler);

      const manifest = makeManifest();
      await loadPlugin(rt, manifest);

      const startPromise = rt.start('test-plugin');
      await vi.advanceTimersByTimeAsync(11000);
      await startPromise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          reason: expect.stringContaining('Too many errors'),
        }),
      );

      vi.useRealTimers();
    });
  });

  // ===========================================================================
  // stop
  // ===========================================================================

  describe('stop', () => {
    it('should return error when plugin not found', async () => {
      const result = await runtime.stop('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should return ok if plugin is not running', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);
      const result = await runtime.stop('test-plugin');
      expect(result.ok).toBe(true);
    });

    it('should stop a running plugin', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      const instance = runtime.get('test-plugin')!;
      expect(instance.state).toBe('running');

      const stopPromise = runtime.stop('test-plugin');

      // Wait for the 'once exit' handler to be registered by stop()
      await vi.waitFor(() => {
        expect(mockWorkerInstance.once).toHaveBeenCalledWith('exit', expect.any(Function));
      });
      mockWorkerInstance._emit('exit', 0);

      const result = await stopPromise;
      expect(result.ok).toBe(true);
      expect(instance.state).toBe('stopped');
      expect(instance.stoppedAt).toBeInstanceOf(Date);
    });

    it('should send shutdown message to the worker', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      mockWorkerInstance.postMessage.mockClear();

      const stopPromise = runtime.stop('test-plugin');
      mockWorkerInstance._emit('exit', 0);
      await stopPromise;

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    });

    it('should emit plugin:stopped event', async () => {
      const handler = vi.fn();
      runtime.on('plugin:stopped', handler);

      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      const stopPromise = runtime.stop('test-plugin', 'manual');
      mockWorkerInstance._emit('exit', 0);
      await stopPromise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          reason: 'manual',
        }),
      );
    });

    it('should terminate worker after timeout if it does not exit gracefully', async () => {
      const manifest = makeManifest();
      // Start the plugin with real timers first
      await loadAndStartPlugin(runtime, manifest);

      mockWorkerInstance.terminate.mockClear();

      // Now switch to fake timers for the stop timeout
      vi.useFakeTimers();

      const stopPromise = runtime.stop('test-plugin');
      // Don't emit 'exit' - let the 5s timeout fire
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      expect(mockWorkerInstance.terminate).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should clear the worker reference after stopping', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      const instance = runtime.get('test-plugin')!;

      const stopPromise = runtime.stop('test-plugin');
      mockWorkerInstance._emit('exit', 0);
      await stopPromise;

      expect(instance.worker).toBeUndefined();
    });
  });

  // ===========================================================================
  // unload
  // ===========================================================================

  describe('unload', () => {
    it('should return error when plugin not found', async () => {
      const result = await runtime.unload('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should unload a loaded plugin', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const result = await runtime.unload('test-plugin');
      expect(result.ok).toBe(true);
      expect(runtime.get('test-plugin')).toBeUndefined();
    });

    it('should stop a running plugin before unloading', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      const unloadPromise = runtime.unload('test-plugin');
      mockWorkerInstance._emit('exit', 0);

      const result = await unloadPromise;
      expect(result.ok).toBe(true);
      expect(runtime.get('test-plugin')).toBeUndefined();
    });

    it('should remove the security barrier', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      expect(runtime.getBarrier('test-plugin')).toBeDefined();
      await runtime.unload('test-plugin');
      expect(runtime.getBarrier('test-plugin')).toBeUndefined();
    });

    it('should remove the plugin from the plugins map', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      expect(runtime.getAll()).toHaveLength(1);
      await runtime.unload('test-plugin');
      expect(runtime.getAll()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // call
  // ===========================================================================

  describe('call', () => {
    it('should return error when plugin not found', async () => {
      const result = await runtime.call('nonexistent', 'method');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should return error when plugin is not running', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const result = await runtime.call('test-plugin', 'method');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not running');
      }
    });

    it('should send call message to worker and resolve on result', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWorkerInstance.postMessage.mockImplementation((msg: any) => {
        if (msg.type === 'call') {
          // Simulate worker returning a result through the 'message' handler
          mockWorkerInstance._emit('message', {
            type: 'result',
            id: msg.id,
            result: 'hello world',
          });
        }
      });

      const result = await runtime.call<string>('test-plugin', 'greet', ['world']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('hello world');
      }
    });

    it('should resolve with error on worker error message', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWorkerInstance.postMessage.mockImplementation((msg: any) => {
        if (msg.type === 'call') {
          mockWorkerInstance._emit('message', {
            type: 'error',
            id: msg.id,
            error: 'Method not found',
          });
        }
      });

      const result = await runtime.call('test-plugin', 'missing');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Method not found');
      }
    });

    it('should timeout after specified duration', async () => {
      const manifest = makeManifest();
      // Start the plugin with real timers
      await loadAndStartPlugin(runtime, manifest);

      // Reset postMessage so it does NOT respond to the call
      // (previous tests may have set up an implementation that responds)
      mockWorkerInstance.postMessage.mockReset();

      // Now switch to fake timers for the call timeout
      vi.useFakeTimers();

      const callPromise = runtime.call('test-plugin', 'slow', [], 1000);
      await vi.advanceTimersByTimeAsync(1500);

      const result = await callPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('timed out');
      }

      vi.useRealTimers();
    });

    it('should deny call when security barrier blocks access', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      // method:memory:user-data should be caught by the barrier's absolute
      // check because it contains 'memory:' in the resource string
      const result = await runtime.call('test-plugin', 'memory:user-data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Access denied');
      }
    });
  });

  // ===========================================================================
  // sendEvent
  // ===========================================================================

  describe('sendEvent', () => {
    it('should return error when plugin not found', () => {
      const result = runtime.sendEvent('nonexistent', 'test', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    it('should return error when plugin is not running', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);
      const result = runtime.sendEvent('test-plugin', 'test', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not running');
      }
    });

    it('should send event to running plugin worker', async () => {
      const manifest = makeManifest();
      await loadAndStartPlugin(runtime, manifest);

      mockWorkerInstance.postMessage.mockClear();

      const result = runtime.sendEvent('test-plugin', 'my-event', { data: 123 });
      expect(result.ok).toBe(true);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'event',
        event: 'my-event',
        data: { data: 123 },
      });
    });

    it('should return error when running plugin has no worker', async () => {
      const manifest = makeManifest();
      await loadPlugin(runtime, manifest);

      const instance = runtime.get('test-plugin')!;
      instance.state = 'running';
      // No worker set

      const result = runtime.sendEvent('test-plugin', 'event', {});
      expect(result.ok).toBe(false);
    });
  });

  // ===========================================================================
  // broadcast
  // ===========================================================================

  describe('broadcast', () => {
    it('should send event to all running plugins', async () => {
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      // Reset for second plugin
      mockWorkerInstance._reset();
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-b' }));

      mockWorkerInstance.postMessage.mockClear();

      runtime.broadcast('global-event', { msg: 'hello' });

      // Both plugins share the same mockWorkerInstance, so postMessage
      // is called twice (once per running plugin)
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'event',
        event: 'global-event',
        data: { msg: 'hello' },
      });
    });

    it('should skip non-running plugins', async () => {
      await loadPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-b' }));

      mockWorkerInstance.postMessage.mockClear();
      runtime.broadcast('event', { data: true });

      // Only plugin-b is running, so one call
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle empty plugins map without error', () => {
      expect(() => runtime.broadcast('event', {})).not.toThrow();
    });
  });

  // ===========================================================================
  // get / getAll / getRunning
  // ===========================================================================

  describe('get', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(runtime.get('nonexistent')).toBeUndefined();
    });

    it('should return the plugin instance', async () => {
      await loadPlugin(runtime, makeManifest());
      const instance = runtime.get('test-plugin');
      expect(instance).toBeDefined();
      expect(instance?.manifest.id).toBe('test-plugin');
    });

    it('should return the same reference for subsequent calls', async () => {
      await loadPlugin(runtime, makeManifest());
      expect(runtime.get('test-plugin')).toBe(runtime.get('test-plugin'));
    });
  });

  describe('getAll', () => {
    it('should return empty array with no plugins', () => {
      expect(runtime.getAll()).toEqual([]);
    });

    it('should return all loaded plugins', async () => {
      await loadPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      await loadPlugin(runtime, makeManifest({ id: 'plugin-b' }));
      const all = runtime.getAll();
      expect(all).toHaveLength(2);
    });

    it('should include plugins in all states', async () => {
      await loadPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      await loadPlugin(runtime, makeManifest({ id: 'plugin-b' }));
      runtime.get('plugin-b')!.state = 'error';
      const all = runtime.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getRunning', () => {
    it('should return empty array when no plugins are running', async () => {
      await loadPlugin(runtime, makeManifest());
      expect(runtime.getRunning()).toEqual([]);
    });

    it('should return only running plugins', async () => {
      await loadPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-b' }));

      const running = runtime.getRunning();
      expect(running).toHaveLength(1);
      expect(running[0].manifest.id).toBe('plugin-b');
    });

    it('should exclude stopped and loaded plugins', async () => {
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      mockWorkerInstance._reset();
      await loadPlugin(runtime, makeManifest({ id: 'plugin-b' }));
      await loadPlugin(runtime, makeManifest({ id: 'plugin-c' }));
      runtime.get('plugin-b')!.state = 'stopped';

      const running = runtime.getRunning();
      expect(running).toHaveLength(1);
      expect(running[0].manifest.id).toBe('plugin-a');
    });
  });

  // ===========================================================================
  // getBarrier / getIsolationManager / getVerifier
  // ===========================================================================

  describe('getBarrier', () => {
    it('should return undefined for unknown plugin', () => {
      expect(runtime.getBarrier('nonexistent')).toBeUndefined();
    });

    it('should return the barrier for a loaded plugin', async () => {
      await loadPlugin(runtime, makeManifest());
      expect(runtime.getBarrier('test-plugin')).toBeInstanceOf(PluginSecurityBarrier);
    });
  });

  describe('getIsolationManager', () => {
    it('should return a PluginIsolationManager instance', () => {
      expect(runtime.getIsolationManager()).toBeInstanceOf(PluginIsolationManager);
    });

    it('should return the same instance on multiple calls', () => {
      expect(runtime.getIsolationManager()).toBe(runtime.getIsolationManager());
    });
  });

  describe('getVerifier', () => {
    it('should return a verifier instance', () => {
      expect(runtime.getVerifier()).toBeDefined();
    });

    it('should return the same instance on multiple calls', () => {
      expect(runtime.getVerifier()).toBe(runtime.getVerifier());
    });
  });

  // ===========================================================================
  // shutdown
  // ===========================================================================

  describe('shutdown', () => {
    it('should stop all running plugins', async () => {
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-a' }));
      mockWorkerInstance._reset();
      await loadAndStartPlugin(runtime, makeManifest({ id: 'plugin-b' }));

      const shutdownPromise = runtime.shutdown();
      mockWorkerInstance._emit('exit', 0);
      await shutdownPromise;

      expect(runtime.get('plugin-a')?.state).toBe('stopped');
      expect(runtime.get('plugin-b')?.state).toBe('stopped');
    });

    it('should handle shutdown with no plugins', async () => {
      await expect(runtime.shutdown()).resolves.not.toThrow();
    });

    it('should handle shutdown when plugins are already stopped', async () => {
      await loadPlugin(runtime, makeManifest());
      await expect(runtime.shutdown()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Worker message handling (handlers registered by createWorker in start())
  // ===========================================================================

  describe('worker message handling', () => {
    it('should emit plugin:message for worker event messages', async () => {
      const handler = vi.fn();
      runtime.on('plugin:message', handler);

      await loadAndStartPlugin(runtime, makeManifest());

      // Fire event via mock worker message handler
      mockWorkerInstance._emit('message', {
        type: 'event',
        event: 'custom-event',
        data: { key: 'value' },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          message: { key: 'value' },
        }),
      );
    });

    it('should emit security:violation for worker security violation messages', async () => {
      const handler = vi.fn();
      runtime.on('security:violation', handler);

      await loadAndStartPlugin(runtime, makeManifest());

      mockWorkerInstance._emit('message', {
        type: 'security_violation',
        resource: 'memory:user',
        action: 'read',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedResource: 'memory:user',
          action: 'read',
        }),
      );
    });

    it('should log debug messages when debug mode is enabled', async () => {
      const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const rt = makeRuntime({ debug: true });

      await loadAndStartPlugin(rt, makeManifest());

      mockWorkerInstance._emit('message', {
        type: 'log',
        level: 'info',
        message: 'hello from plugin',
      });

      // getLog('Plugin:test-plugin').info('info: hello from plugin', '') → console.log('[Plugin:test-plugin]', 'info: hello from plugin')
      // Note: empty string data is falsy, so fallback logger omits it
      expect(debugSpy).toHaveBeenCalledWith(
        '[Plugin:test-plugin]',
        'info: hello from plugin',
      );

      debugSpy.mockRestore();
    });

    it('should not log debug messages when debug mode is disabled', async () => {
      const debugSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const rt = makeRuntime({ debug: false });

      await loadAndStartPlugin(rt, makeManifest());

      mockWorkerInstance._emit('message', {
        type: 'log',
        level: 'info',
        message: 'hello from plugin',
      });

      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
    });

    it('should resolve pending call on result message', async () => {
      await loadAndStartPlugin(runtime, makeManifest());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockWorkerInstance.postMessage.mockImplementation((msg: any) => {
        if (msg.type === 'call') {
          mockWorkerInstance._emit('message', {
            type: 'result',
            id: msg.id,
            result: 42,
          });
        }
      });

      const result = await runtime.call<number>('test-plugin', 'compute');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });
  });

  // ===========================================================================
  // Worker error and exit handling
  // ===========================================================================

  describe('worker error handling', () => {
    it('should increment error count on worker error event', async () => {
      await loadAndStartPlugin(runtime, makeManifest());

      const instance = runtime.get('test-plugin')!;
      mockWorkerInstance._emit('error', new Error('Worker crashed'));

      expect(instance.errorCount).toBe(1);
      expect(instance.lastError).toBe('Worker crashed');
    });

    it('should emit plugin:error on worker error event', async () => {
      const handler = vi.fn();
      runtime.on('plugin:error', handler);

      await loadAndStartPlugin(runtime, makeManifest());

      mockWorkerInstance._emit('error', new Error('crash'));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          error: 'crash',
        }),
      );
    });

    it('should block plugin after maxErrors on worker error events', async () => {
      const handler = vi.fn();
      const rt = makeRuntime({ maxErrors: 2 });
      rt.on('plugin:blocked', handler);

      await loadAndStartPlugin(rt, makeManifest());

      const instance = rt.get('test-plugin')!;
      mockWorkerInstance._emit('error', new Error('error 1'));
      mockWorkerInstance._emit('error', new Error('error 2'));

      expect(instance.state).toBe('blocked');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          reason: expect.stringContaining('Too many errors'),
        }),
      );
    });

    it('should handle non-Error objects in worker error event', async () => {
      await loadAndStartPlugin(runtime, makeManifest());

      const instance = runtime.get('test-plugin')!;
      mockWorkerInstance._emit('error', 'string error');

      expect(instance.errorCount).toBe(1);
      expect(instance.lastError).toBe('string error');
    });
  });

  describe('worker exit handling', () => {
    it('should set state to stopped when running worker exits', async () => {
      await loadAndStartPlugin(runtime, makeManifest());

      const instance = runtime.get('test-plugin')!;
      expect(instance.state).toBe('running');

      mockWorkerInstance._emit('exit', 1);
      expect(instance.state).toBe('stopped');
    });

    it('should emit plugin:stopped with exit code when running worker exits', async () => {
      const handler = vi.fn();
      runtime.on('plugin:stopped', handler);

      await loadAndStartPlugin(runtime, makeManifest());

      mockWorkerInstance._emit('exit', 42);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          reason: 'Worker exited with code 42',
        }),
      );
    });

    it('should not change state when non-running worker exits', async () => {
      await loadPlugin(runtime, makeManifest());

      const instance = runtime.get('test-plugin')!;
      expect(instance.state).toBe('loaded');

      // Directly emit exit on mock worker - but since start() wasn't called,
      // no exit handler was registered, so state should remain 'loaded'
      mockWorkerInstance._emit('exit', 0);
      expect(instance.state).toBe('loaded');
    });
  });
});

// =============================================================================
// PluginState type
// =============================================================================

describe('PluginState type', () => {
  it('should accept all valid states', () => {
    const states: PluginState[] = [
      'unloaded',
      'loading',
      'loaded',
      'starting',
      'running',
      'stopping',
      'stopped',
      'error',
      'blocked',
    ];
    expect(states).toHaveLength(9);
    for (const state of states) {
      expect(typeof state).toBe('string');
    }
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('createPluginRuntime', () => {
  afterEach(async () => {
    await resetDefaultRuntime();
  });

  it('should return a SecurePluginRuntime instance', () => {
    const rt = createPluginRuntime();
    expect(rt).toBeInstanceOf(SecurePluginRuntime);
  });

  it('should accept custom configuration', () => {
    const rt = createPluginRuntime({ maxPlugins: 10, debug: true });
    expect(rt).toBeInstanceOf(SecurePluginRuntime);
  });

  it('should create independent runtime instances', () => {
    const rt1 = createPluginRuntime();
    const rt2 = createPluginRuntime();
    expect(rt1).not.toBe(rt2);
  });
});

describe('getDefaultRuntime', () => {
  afterEach(async () => {
    await resetDefaultRuntime();
  });

  it('should return a SecurePluginRuntime instance', () => {
    const rt = getDefaultRuntime();
    expect(rt).toBeInstanceOf(SecurePluginRuntime);
  });

  it('should return the same singleton on subsequent calls', () => {
    const rt1 = getDefaultRuntime();
    const rt2 = getDefaultRuntime();
    expect(rt1).toBe(rt2);
  });

  it('should return a new instance after reset', async () => {
    const rt1 = getDefaultRuntime();
    await resetDefaultRuntime();
    const rt2 = getDefaultRuntime();
    expect(rt1).not.toBe(rt2);
  });
});

describe('resetDefaultRuntime', () => {
  it('should not throw when no default runtime exists', async () => {
    await expect(resetDefaultRuntime()).resolves.not.toThrow();
  });

  it('should clear the singleton so getDefaultRuntime creates a new one', async () => {
    const rt1 = getDefaultRuntime();
    await resetDefaultRuntime();
    const rt2 = getDefaultRuntime();
    expect(rt1).not.toBe(rt2);
  });

  it('should shutdown existing runtime during reset', async () => {
    const rt = getDefaultRuntime();
    const shutdownSpy = vi.spyOn(rt, 'shutdown').mockResolvedValue();
    await resetDefaultRuntime();
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});
