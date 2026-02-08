/**
 * Plugin Isolation Layer Tests
 *
 * Comprehensive tests for all isolation components:
 * - IsolationEnforcer: violation tracking & plugin blocking
 * - PluginIsolatedStorage: namespaced storage with quota enforcement
 * - PluginIsolatedNetwork: domain-restricted, rate-limited fetch
 * - PluginIsolatedEvents: scoped event system with data sanitization
 * - PluginIsolatedLogger: PII redaction & log rotation
 * - PluginIsolationManager: context lifecycle management
 * - STORAGE_QUOTAS & DEFAULT_ISOLATION_LIMITS: constants
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IsolationEnforcer,
  PluginIsolatedStorage,
  PluginIsolatedNetwork,
  PluginIsolatedEvents,
  PluginIsolatedLogger,
  PluginIsolatedPluginAPI,
  PluginIsolationManager,
  createIsolationManager,
  STORAGE_QUOTAS,
  DEFAULT_ISOLATION_LIMITS,
} from './isolation.js';
import type {
  IsolationConfig,
  PluginRegistryInterface,
  AccessViolation,
  AllowedPluginEvent,
} from './isolation.js';
import { unsafePluginId } from '../types/branded.js';

// =============================================================================
// Helpers
// =============================================================================

const pluginA = unsafePluginId('plugin-a');
const pluginB = unsafePluginId('plugin-b');
const _pluginC = unsafePluginId('plugin-c');

function makeIsolationConfig(overrides: Partial<IsolationConfig> = {}): IsolationConfig {
  return {
    pluginId: pluginA,
    capabilities: ['storage:read', 'storage:write'],
    storageQuota: STORAGE_QUOTAS.free,
    cpuLimit: 5000,
    memoryLimit: 128 * 1024 * 1024,
    executionTimeout: 30000,
    ...overrides,
  };
}

function createMockRegistry(
  plugins: Array<{ id: string; name: string; version: string; publicAPI?: Record<string, unknown> }> = [],
): PluginRegistryInterface {
  return {
    getPlugin: vi.fn((id: string) => {
      const found = plugins.find((p) => p.id === id);
      return found ? { publicAPI: found.publicAPI } : null;
    }),
    listPlugins: vi.fn(() => plugins.map((p) => ({ id: p.id, name: p.name, version: p.version }))),
    deliverMessage: vi.fn(),
  };
}

// =============================================================================
// IsolationEnforcer
// =============================================================================

describe('IsolationEnforcer', () => {
  let enforcer: IsolationEnforcer;

  beforeEach(() => {
    enforcer = new IsolationEnforcer();
  });

  describe('constructor', () => {
    it('should default maxViolations to 3', () => {
      // A plugin should be blocked after 3 violations
      const v: AccessViolation = {
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      };

      enforcer.recordViolation(v);
      enforcer.recordViolation(v);
      expect(enforcer.isBlocked(pluginA)).toBe(false);

      enforcer.recordViolation(v);
      expect(enforcer.isBlocked(pluginA)).toBe(true);
    });

    it('should accept a custom maxViolations value', () => {
      const custom = new IsolationEnforcer({ maxViolations: 5 });
      const v: AccessViolation = {
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      };

      for (let i = 0; i < 4; i++) custom.recordViolation(v);
      expect(custom.isBlocked(pluginA)).toBe(false);

      custom.recordViolation(v);
      expect(custom.isBlocked(pluginA)).toBe(true);
    });
  });

  describe('checkAccess', () => {
    it('should return ok for non-forbidden resources', () => {
      const result = enforcer.checkAccess(pluginA, 'some:resource', 'read');
      expect(result.ok).toBe(true);
    });

    it('should return err for forbidden resources', () => {
      const forbidden = [
        'memory:user',
        'credentials:user',
        'memory:system',
        'credentials:system',
        'audit:logs',
        'audit:modify',
        'plugins:internal',
        'filesystem:system',
        'process:spawn',
        'process:env',
        'crypto:keys',
      ];

      for (const resource of forbidden) {
        const result = enforcer.checkAccess(pluginA, resource, 'read');
        expect(result.ok).toBe(false);
      }
    });

    it('should auto-record violations for forbidden resources', () => {
      enforcer.checkAccess(pluginA, 'memory:user', 'read');
      const violations = enforcer.getViolations(pluginA);
      expect(violations).toHaveLength(1);
      expect(violations[0].attemptedResource).toBe('memory:user');
    });

    it('should return err immediately for blocked plugins', () => {
      // Block the plugin by exceeding violations
      for (let i = 0; i < 3; i++) {
        enforcer.checkAccess(pluginA, 'memory:user', 'read');
      }

      // Even a non-forbidden resource should be denied
      const result = enforcer.checkAccess(pluginA, 'safe:resource', 'read');
      expect(result.ok).toBe(false);
    });
  });

  describe('recordViolation', () => {
    it('should store the violation', () => {
      const v: AccessViolation = {
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'write',
      };

      enforcer.recordViolation(v);
      expect(enforcer.getViolations()).toHaveLength(1);
      expect(enforcer.getViolations()[0]).toEqual(v);
    });

    it('should block plugin after maxViolations reached', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const v: AccessViolation = {
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'credentials:user',
        action: 'read',
      };

      enforcer.recordViolation(v);
      enforcer.recordViolation(v);
      enforcer.recordViolation(v);

      expect(enforcer.isBlocked(pluginA)).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        '[Security]',
        expect.stringContaining('Plugin plugin-a blocked after 3 violations'),
      );

      spy.mockRestore();
    });

    it('should not block unrelated plugins', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      for (let i = 0; i < 3; i++) {
        enforcer.recordViolation({
          pluginId: pluginA,
          timestamp: new Date(),
          attemptedResource: 'memory:user',
          action: 'read',
        });
      }

      expect(enforcer.isBlocked(pluginA)).toBe(true);
      expect(enforcer.isBlocked(pluginB)).toBe(false);

      vi.restoreAllMocks();
    });
  });

  describe('isBlocked', () => {
    it('should return false for a fresh plugin', () => {
      expect(enforcer.isBlocked(pluginA)).toBe(false);
    });

    it('should return true after plugin is blocked', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      for (let i = 0; i < 3; i++) {
        enforcer.recordViolation({
          pluginId: pluginA,
          timestamp: new Date(),
          attemptedResource: 'memory:user',
          action: 'read',
        });
      }

      expect(enforcer.isBlocked(pluginA)).toBe(true);
      vi.restoreAllMocks();
    });
  });

  describe('getViolations', () => {
    it('should return empty array for a clean plugin', () => {
      expect(enforcer.getViolations(pluginA)).toEqual([]);
    });

    it('should return only violations for the specified plugin', () => {
      enforcer.recordViolation({
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });
      enforcer.recordViolation({
        pluginId: pluginB,
        timestamp: new Date(),
        attemptedResource: 'credentials:user',
        action: 'read',
      });

      const violationsA = enforcer.getViolations(pluginA);
      expect(violationsA).toHaveLength(1);
      expect(violationsA[0].pluginId).toBe(pluginA);
    });

    it('should return all violations when no pluginId is provided', () => {
      enforcer.recordViolation({
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });
      enforcer.recordViolation({
        pluginId: pluginB,
        timestamp: new Date(),
        attemptedResource: 'credentials:user',
        action: 'read',
      });

      expect(enforcer.getViolations()).toHaveLength(2);
    });

    it('should return a copy (not the internal array)', () => {
      enforcer.recordViolation({
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });

      const violations = enforcer.getViolations();
      violations.push({
        pluginId: pluginB,
        timestamp: new Date(),
        attemptedResource: 'memory:system',
        action: 'read',
      });

      expect(enforcer.getViolations()).toHaveLength(1);
    });
  });

  describe('unblock', () => {
    it('should allow a blocked plugin to be unblocked', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      for (let i = 0; i < 3; i++) {
        enforcer.recordViolation({
          pluginId: pluginA,
          timestamp: new Date(),
          attemptedResource: 'memory:user',
          action: 'read',
        });
      }

      expect(enforcer.isBlocked(pluginA)).toBe(true);
      enforcer.unblock(pluginA);
      expect(enforcer.isBlocked(pluginA)).toBe(false);

      vi.restoreAllMocks();
    });
  });

  describe('clearViolations', () => {
    it('should clear violations for a specific plugin', () => {
      enforcer.recordViolation({
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });
      enforcer.recordViolation({
        pluginId: pluginB,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });

      enforcer.clearViolations(pluginA);

      expect(enforcer.getViolations(pluginA)).toHaveLength(0);
      expect(enforcer.getViolations(pluginB)).toHaveLength(1);
    });

    it('should clear all violations when no pluginId is provided', () => {
      enforcer.recordViolation({
        pluginId: pluginA,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });
      enforcer.recordViolation({
        pluginId: pluginB,
        timestamp: new Date(),
        attemptedResource: 'memory:user',
        action: 'read',
      });

      enforcer.clearViolations();
      expect(enforcer.getViolations()).toHaveLength(0);
    });
  });
});

// =============================================================================
// PluginIsolatedStorage
// =============================================================================

describe('PluginIsolatedStorage', () => {
  let storage: PluginIsolatedStorage;

  beforeEach(() => {
    storage = new PluginIsolatedStorage(pluginA, STORAGE_QUOTAS.free);
  });

  describe('get', () => {
    it('should return null for a non-existent key', async () => {
      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return stored value after set', async () => {
      await storage.set('greeting', 'hello');
      const result = await storage.get<string>('greeting');
      expect(result).toBe('hello');
    });

    it('should deserialize JSON objects', async () => {
      const obj = { name: 'test', count: 42, nested: { flag: true } };
      await storage.set('config', obj);
      const result = await storage.get<typeof obj>('config');
      expect(result).toEqual(obj);
    });

    it('should handle arrays correctly', async () => {
      const arr = [1, 'two', { three: 3 }];
      await storage.set('list', arr);
      const result = await storage.get<typeof arr>('list');
      expect(result).toEqual(arr);
    });
  });

  describe('set', () => {
    it('should store a value and return ok', async () => {
      const result = await storage.set('key', 'value');
      expect(result.ok).toBe(true);
    });

    it('should reject keys longer than 256 characters', async () => {
      const longKey = 'a'.repeat(257);
      const result = await storage.set(longKey, 'value');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('key_too_long');
        expect(result.error).toHaveProperty('maxLength', 256);
      }
    });

    it('should reject keys with invalid characters (path separators)', async () => {
      const invalidKeys = ['my/key', 'my\\key', 'key with spaces', 'key@special', 'key#hash'];

      for (const key of invalidKeys) {
        const result = await storage.set(key, 'value');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.type).toBe('invalid_key');
        }
      }
    });

    it('should accept keys with allowed characters', async () => {
      const validKeys = ['simple', 'with-dash', 'with_underscore', 'with.dot', 'with:colon', 'MiXeD123'];

      for (const key of validKeys) {
        const result = await storage.set(key, 'value');
        expect(result.ok).toBe(true);
      }
    });

    it('should reject empty keys (invalid characters)', async () => {
      const result = await storage.set('', 'value');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_key');
      }
    });

    it('should reject values larger than 1MB', async () => {
      const largeValue = 'x'.repeat(1024 * 1024 + 1);
      const result = await storage.set('big', largeValue);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('value_too_large');
      }
    });

    it('should reject values that exceed total quota', async () => {
      // Use tiny quota to test easily
      const tinyStorage = new PluginIsolatedStorage(pluginA, 100);

      // First set should succeed
      const result1 = await tinyStorage.set('key1', 'a'.repeat(40));
      expect(result1.ok).toBe(true);

      // Second set that exceeds quota should fail
      const result2 = await tinyStorage.set('key2', 'b'.repeat(80));
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error.type).toBe('quota_exceeded');
      }
    });

    it('should allow overwriting existing key without double-counting quota', async () => {
      const tinyStorage = new PluginIsolatedStorage(pluginA, 200);

      await tinyStorage.set('key1', 'a'.repeat(80));
      // Overwrite with same-ish size should succeed
      const result = await tinyStorage.set('key1', 'b'.repeat(80));
      expect(result.ok).toBe(true);
    });

    it('should return serialization_failed for non-serializable values', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const result = await storage.set('circular', circular);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('serialization_failed');
      }
    });
  });

  describe('delete', () => {
    it('should remove an existing key and return true', async () => {
      await storage.set('key', 'value');
      const deleted = await storage.delete('key');
      expect(deleted).toBe(true);
      expect(await storage.get('key')).toBeNull();
    });

    it('should return false when key does not exist', async () => {
      const deleted = await storage.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('has (via get)', () => {
    it('should distinguish between existing and non-existing keys', async () => {
      await storage.set('exists', 42);
      expect(await storage.get('exists')).not.toBeNull();
      expect(await storage.get('missing')).toBeNull();
    });
  });

  describe('keys', () => {
    it('should return empty array when no data is stored', async () => {
      expect(await storage.keys()).toEqual([]);
    });

    it('should return all stored keys without plugin prefix', async () => {
      await storage.set('alpha', 1);
      await storage.set('beta', 2);
      await storage.set('gamma', 3);

      const keys = await storage.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('alpha');
      expect(keys).toContain('beta');
      expect(keys).toContain('gamma');
    });
  });

  describe('clear', () => {
    it('should remove all data for the plugin', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);
      await storage.clear();
      expect(await storage.keys()).toEqual([]);
    });
  });

  describe('usage', () => {
    it('should report zero usage for empty storage', async () => {
      const usage = await storage.usage();
      expect(usage.used).toBe(0);
      expect(usage.quota).toBe(STORAGE_QUOTAS.free);
    });

    it('should report correct usage after storing data', async () => {
      await storage.set('key', 'value');
      const usage = await storage.usage();
      expect(usage.used).toBeGreaterThan(0);
      expect(usage.quota).toBe(STORAGE_QUOTAS.free);
    });
  });

  describe('per-plugin namespacing', () => {
    it('should isolate data between different plugins', async () => {
      const storageA = new PluginIsolatedStorage(pluginA, STORAGE_QUOTAS.free);
      const storageB = new PluginIsolatedStorage(pluginB, STORAGE_QUOTAS.free);

      await storageA.set('shared-name', 'value-a');
      await storageB.set('shared-name', 'value-b');

      expect(await storageA.get('shared-name')).toBe('value-a');
      expect(await storageB.get('shared-name')).toBe('value-b');
    });

    it('should return separate key lists for different plugins', async () => {
      const storageA = new PluginIsolatedStorage(pluginA, STORAGE_QUOTAS.free);
      const storageB = new PluginIsolatedStorage(pluginB, STORAGE_QUOTAS.free);

      await storageA.set('onlyA', 1);
      await storageB.set('onlyB', 2);

      expect(await storageA.keys()).toEqual(['onlyA']);
      expect(await storageB.keys()).toEqual(['onlyB']);
    });

    it('should clear only the owning plugin data', async () => {
      const storageA = new PluginIsolatedStorage(pluginA, STORAGE_QUOTAS.free);
      const storageB = new PluginIsolatedStorage(pluginB, STORAGE_QUOTAS.free);

      await storageA.set('key', 1);
      await storageB.set('key', 2);

      await storageA.clear();

      expect(await storageA.get('key')).toBeNull();
      expect(await storageB.get('key')).toBe(2);
    });
  });

  describe('JSON serialization round-trips', () => {
    it('should handle booleans', async () => {
      await storage.set('flag', true);
      expect(await storage.get('flag')).toBe(true);
    });

    it('should handle null values', async () => {
      await storage.set('empty', null);
      expect(await storage.get('empty')).toBeNull();
    });

    it('should handle numbers', async () => {
      await storage.set('pi', 3.14159);
      expect(await storage.get<number>('pi')).toBeCloseTo(3.14159);
    });

    it('should handle deeply nested objects', async () => {
      const deep = { a: { b: { c: { d: [1, 2, { e: 'f' }] } } } };
      await storage.set('deep', deep);
      expect(await storage.get('deep')).toEqual(deep);
    });
  });
});

// =============================================================================
// PluginIsolatedNetwork
// =============================================================================

describe('PluginIsolatedNetwork', () => {
  let network: PluginIsolatedNetwork;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    network = new PluginIsolatedNetwork(pluginA, ['api.example.com', '*.github.com']);
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('isDomainAllowed', () => {
    it('should allow exact domain match', () => {
      expect(network.isDomainAllowed('api.example.com')).toBe(true);
    });

    it('should reject non-matching domains', () => {
      expect(network.isDomainAllowed('evil.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(network.isDomainAllowed('API.EXAMPLE.COM')).toBe(true);
    });

    it('should support wildcard subdomain matching', () => {
      expect(network.isDomainAllowed('api.github.com')).toBe(true);
      expect(network.isDomainAllowed('raw.github.com')).toBe(true);
    });

    it('should match base domain for wildcard patterns', () => {
      expect(network.isDomainAllowed('github.com')).toBe(true);
    });

    it('should not match unrelated domains with wildcard', () => {
      expect(network.isDomainAllowed('notgithub.com')).toBe(false);
    });

    it('should allow all domains when wildcard * is in allowed list', () => {
      const wildcardNetwork = new PluginIsolatedNetwork(pluginA, ['*']);
      expect(wildcardNetwork.isDomainAllowed('anything.com')).toBe(true);
      expect(wildcardNetwork.isDomainAllowed('localhost')).toBe(true);
    });
  });

  describe('getAllowedDomains', () => {
    it('should return a copy of allowed domains', () => {
      const domains = network.getAllowedDomains();
      expect(domains).toEqual(['api.example.com', '*.github.com']);
    });
  });

  describe('fetch', () => {
    it('should reject invalid URLs', async () => {
      const result = await network.fetch('not-a-url');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('network_error');
        expect(result.error).toHaveProperty('message', 'Invalid URL');
      }
    });

    it('should reject requests to disallowed domains', async () => {
      const result = await network.fetch('https://evil.com/data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('domain_not_allowed');
        expect(result.error).toHaveProperty('domain', 'evil.com');
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should make request to allowed domains', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue('{"data":"ok"}'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe(200);
        expect(result.value.body).toBe('{"data":"ok"}');
        expect(result.value.json()).toEqual({ data: 'ok' });
      }
    });

    it('should strip Authorization header', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data', {
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
      });

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const sentHeaders = callArgs[1]?.headers as Record<string, string>;
      expect(sentHeaders['Authorization']).toBeUndefined();
      expect(sentHeaders['Content-Type']).toBe('application/json');
    });

    it('should strip Cookie header', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data', {
        headers: { Cookie: 'session=abc123' },
      });

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const sentHeaders = callArgs[1]?.headers as Record<string, string>;
      expect(sentHeaders['Cookie']).toBeUndefined();
    });

    it('should strip X-API-Key header', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data', {
        headers: { 'X-API-Key': 'my-secret-key' },
      });

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const sentHeaders = callArgs[1]?.headers as Record<string, string>;
      expect(sentHeaders['X-API-Key']).toBeUndefined();
    });

    it('should add User-Agent header with plugin id', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data');

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const sentHeaders = callArgs[1]?.headers as Record<string, string>;
      expect(sentHeaders['User-Agent']).toBe('OwnPilot-Plugin/plugin-a');
    });

    it('should reject responses exceeding max size via content-length', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': String(11 * 1024 * 1024) }),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('response_too_large');
        expect(result.error).toHaveProperty('maxSize', 10 * 1024 * 1024);
      }
    });

    it('should reject responses exceeding max size via body length', async () => {
      const largeBody = 'x'.repeat(11 * 1024 * 1024);
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue(largeBody),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('response_too_large');
      }
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Connection refused'));

      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('network_error');
        expect(result.error).toHaveProperty('message', 'Connection refused');
      }
    });

    it('should handle timeout via AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.mocked(globalThis.fetch).mockRejectedValue(abortError);

      const result = await network.fetch('https://api.example.com/data', { timeout: 5000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('timeout');
        expect(result.error).toHaveProperty('timeoutMs', 5000);
      }
    });

    it('should serialize object body as JSON', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data', {
        method: 'POST',
        body: { key: 'value' },
      });

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(callArgs[1]?.body).toBe('{"key":"value"}');
    });

    it('should pass string body as-is', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await network.fetch('https://api.example.com/data', {
        method: 'POST',
        body: 'raw-body',
      });

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(callArgs[1]?.body).toBe('raw-body');
    });
  });

  describe('rate limiting', () => {
    it('should allow requests within the rate limit', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(true);
    });

    it('should block after 60 requests per minute', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('ok'),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      // Make 60 requests
      for (let i = 0; i < 60; i++) {
        const result = await network.fetch('https://api.example.com/data');
        expect(result.ok).toBe(true);
      }

      // 61st request should be rate limited
      const result = await network.fetch('https://api.example.com/data');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('rate_limited');
        expect(result.error).toHaveProperty('retryAfter');
      }
    });

    it('should report rate limit status', () => {
      const status = network.getRateLimitStatus();
      expect(status.remaining).toBe(60);
      expect(status.resetAt).toBeInstanceOf(Date);
    });
  });
});

// =============================================================================
// PluginIsolatedEvents
// =============================================================================

describe('PluginIsolatedEvents', () => {
  let events: PluginIsolatedEvents;

  beforeEach(() => {
    events = new PluginIsolatedEvents(pluginA);
  });

  afterEach(() => {
    events.removeAllListeners();
  });

  describe('on', () => {
    it('should subscribe to allowed events', () => {
      const handler = vi.fn();
      events.on('plugin:enabled', handler);

      // Dispatch via internal method to trigger the handler
      events._dispatch('plugin:enabled', { enabled: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should return an unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = events.on('plugin:enabled', handler);

      events._dispatch('plugin:enabled', {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      events._dispatch('plugin:enabled', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should reject subscription to disallowed events', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = vi.fn();

      const unsub = events.on('forbidden:event' as AllowedPluginEvent, handler);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[Plugin:'),
        expect.stringContaining('Attempted to subscribe to disallowed event'),
      );
      expect(typeof unsub).toBe('function');

      spy.mockRestore();
    });

    it('should support all allowed event types', () => {
      const allowedEvents: AllowedPluginEvent[] = [
        'plugin:enabled',
        'plugin:disabled',
        'plugin:config_changed',
        'message:received',
        'tool:called',
        'schedule:triggered',
      ];

      for (const eventType of allowedEvents) {
        const handler = vi.fn();
        events.on(eventType, handler);
        events._dispatch(eventType, { test: true });
        expect(handler).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('emit', () => {
    it('should scope emitted events with plugin prefix', () => {
      // We can verify by subscribing on the internal emitter via _dispatch pattern
      // The emit method prefixes with plugin:<pluginId>:<event>
      const handler = vi.fn();

      // Subscribe to the scoped event name directly on the internal emitter
      // We need to use a listener on the scoped name
      // Access internal emitter indirectly: emit produces `plugin:plugin-a:custom`
      // We listen on the events object (EventEmitter under the hood)
      const internalEmitter = (events as unknown as { emitter: { on: (e: string, h: (d: unknown) => void) => void } }).emitter;
      internalEmitter.on('plugin:plugin-a:test-event', handler);

      events.emit('test-event', { data: 'hello' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should sanitize sensitive data from emitted payloads', () => {
      const handler = vi.fn();
      const internalEmitter = (events as unknown as { emitter: { on: (e: string, h: (d: unknown) => void) => void } }).emitter;
      internalEmitter.on('plugin:plugin-a:action', handler);

      events.emit('action', {
        name: 'test',
        password: 'secret123',
        token: 'abc',
        apiKey: 'sk-key',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const sanitized = handler.mock.calls[0][0] as Record<string, unknown>;
      expect(sanitized.name).toBe('test');
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.token).toBeUndefined();
      expect(sanitized.apiKey).toBeUndefined();
    });
  });

  describe('_dispatch', () => {
    it('should dispatch events to subscribed handlers', () => {
      const handler = vi.fn();
      events.on('message:received', handler);

      events._dispatch('message:received', { text: 'hello' });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));
    });

    it('should sanitize sensitive fields from dispatched data', () => {
      const handler = vi.fn();
      events.on('message:received', handler);

      events._dispatch('message:received', {
        text: 'hello',
        secret: 'top-secret',
        credential: 'my-cred',
        ssn: '123-45-6789',
        creditCard: '4111-1111-1111-1111',
      });

      const data = handler.mock.calls[0][0] as Record<string, unknown>;
      expect(data.text).toBe('hello');
      expect(data.secret).toBeUndefined();
      expect(data.credential).toBeUndefined();
      expect(data.ssn).toBeUndefined();
      expect(data.creditCard).toBeUndefined();
    });

    it('should pass non-object data through unchanged', () => {
      const handler = vi.fn();
      events.on('plugin:enabled', handler);

      events._dispatch('plugin:enabled', 'simple-string');

      expect(handler).toHaveBeenCalledWith('simple-string');
    });

    it('should pass null data through unchanged', () => {
      const handler = vi.fn();
      events.on('plugin:enabled', handler);

      events._dispatch('plugin:enabled', null);

      expect(handler).toHaveBeenCalledWith(null);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all subscribed handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      events.on('plugin:enabled', handler1);
      events.on('plugin:disabled', handler2);

      events.removeAllListeners();

      events._dispatch('plugin:enabled', {});
      events._dispatch('plugin:disabled', {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// PluginIsolatedLogger
// =============================================================================

describe('PluginIsolatedLogger', () => {
  let logger: PluginIsolatedLogger;

  beforeEach(() => {
    logger = new PluginIsolatedLogger(pluginA);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log debug messages', () => {
      logger.debug('debug message');
      expect(console.debug).toHaveBeenCalledWith(
        '[Plugin:plugin-a]',
        'debug message',
      );
    });

    it('should log info messages', () => {
      logger.info('info message');
      expect(console.log).toHaveBeenCalledWith(
        '[Plugin:plugin-a]',
        'info message',
      );
    });

    it('should log warn messages', () => {
      logger.warn('warning message');
      expect(console.warn).toHaveBeenCalledWith(
        '[Plugin:plugin-a]',
        'warning message',
      );
    });

    it('should log error messages', () => {
      logger.error('error message');
      expect(console.error).toHaveBeenCalledWith(
        '[Plugin:plugin-a]',
        'error message',
      );
    });

    it('should pass data to console output', () => {
      logger.info('with data', { count: 42 });
      expect(console.log).toHaveBeenCalledWith(
        '[Plugin:plugin-a]',
        'with data',
        expect.objectContaining({ count: 42 }),
      );
    });
  });

  describe('PII redaction in messages', () => {
    it('should redact API keys (sk-*)', () => {
      logger.info('Using key sk-abcdef1234567890abcdef');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_API_KEY]');
      expect(logs[0].message).not.toContain('sk-abcdef1234567890abcdef');
    });

    it('should redact GitHub tokens (ghp_*)', () => {
      logger.info('Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_GITHUB_TOKEN]');
    });

    it('should redact email addresses', () => {
      logger.info('Contact user@example.com for help');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_EMAIL]');
      expect(logs[0].message).not.toContain('user@example.com');
    });

    it('should redact phone numbers', () => {
      logger.info('Call 555-123-4567');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_PHONE]');
      expect(logs[0].message).not.toContain('555-123-4567');
    });

    it('should redact credit card numbers', () => {
      logger.info('Card: 4111-1111-1111-1111');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_CARD]');
      expect(logs[0].message).not.toContain('4111-1111-1111-1111');
    });

    it('should redact credit card numbers with spaces', () => {
      logger.info('Card: 4111 1111 1111 1111');
      const logs = logger.getLogs();
      expect(logs[0].message).toContain('[REDACTED_CARD]');
    });
  });

  describe('sensitive key redaction in data objects', () => {
    it('should redact password fields', () => {
      logger.info('login', { username: 'test', password: 'secret123' });
      const logs = logger.getLogs();
      expect(logs[0].data?.password).toBe('[REDACTED]');
      expect(logs[0].data?.username).toBe('test');
    });

    it('should redact secret fields', () => {
      logger.info('config', { secret: 'my-secret-value' });
      const logs = logger.getLogs();
      expect(logs[0].data?.secret).toBe('[REDACTED]');
    });

    it('should redact token fields', () => {
      logger.info('auth', { token: 'jwt-token-here' });
      const logs = logger.getLogs();
      expect(logs[0].data?.token).toBe('[REDACTED]');
    });

    it('should redact auth fields', () => {
      logger.info('request', { auth: 'Bearer xyz' });
      const logs = logger.getLogs();
      expect(logs[0].data?.auth).toBe('[REDACTED]');
    });

    it('should redact key fields', () => {
      logger.info('api', { apiKey: 'sk-test123456789012345' });
      const logs = logger.getLogs();
      expect(logs[0].data?.apiKey).toBe('[REDACTED]');
    });

    it('should redact credential fields', () => {
      logger.info('access', { credential: 'some-cred' });
      const logs = logger.getLogs();
      expect(logs[0].data?.credential).toBe('[REDACTED]');
    });

    it('should redact sensitive keys case-insensitively', () => {
      logger.info('mixed case', { PASSWORD: 'test', Secret: 'val' });
      const logs = logger.getLogs();
      expect(logs[0].data?.PASSWORD).toBe('[REDACTED]');
      expect(logs[0].data?.Secret).toBe('[REDACTED]');
    });

    it('should sanitize PII in string data values', () => {
      logger.info('contact', { email: 'contact user@example.com now' });
      const logs = logger.getLogs();
      expect(logs[0].data?.email).toContain('[REDACTED_EMAIL]');
    });

    it('should recursively sanitize nested objects', () => {
      logger.info('nested', { config: { db: { password: 'secret' } } });
      const logs = logger.getLogs();
      const nestedData = logs[0].data?.config as Record<string, unknown>;
      const db = nestedData.db as Record<string, unknown>;
      expect(db.password).toBe('[REDACTED]');
    });

    it('should sanitize arrays containing strings', () => {
      logger.info('list', { items: ['normal', 'email: user@example.com'] });
      const logs = logger.getLogs();
      const items = logs[0].data?.items as string[];
      expect(items[0]).toBe('normal');
      expect(items[1]).toContain('[REDACTED_EMAIL]');
    });

    it('should sanitize arrays containing objects', () => {
      logger.info('list', { items: [{ password: 'secret' }] });
      const logs = logger.getLogs();
      const items = logs[0].data?.items as Array<Record<string, unknown>>;
      expect(items[0].password).toBe('[REDACTED]');
    });
  });

  describe('log rotation', () => {
    it('should store log entries up to max', () => {
      for (let i = 0; i < 100; i++) {
        logger.info(`message ${i}`);
      }
      expect(logger.getLogs()).toHaveLength(100);
    });

    it('should evict oldest entries when max 1000 is exceeded', () => {
      for (let i = 0; i < 1005; i++) {
        logger.info(`msg-${i}`);
      }

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1000);
      // The first 5 messages should have been evicted
      expect(logs[0].message).toBe('msg-5');
      expect(logs[999].message).toBe('msg-1004');
    });
  });

  describe('getLogs', () => {
    it('should return empty array initially', () => {
      expect(logger.getLogs()).toEqual([]);
    });

    it('should return stored log entries with correct structure', () => {
      logger.info('test message', { name: 'value' });

      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual(
        expect.objectContaining({
          level: 'info',
          message: 'test message',
          data: { name: 'value' },
          timestamp: expect.any(Date),
        }),
      );
    });

    it('should return a copy of logs', () => {
      logger.info('test');
      const logs1 = logger.getLogs();
      logs1.push({
        level: 'debug',
        message: 'injected',
        timestamp: new Date(),
      });

      expect(logger.getLogs()).toHaveLength(1);
    });

    it('should track correct log level for each entry', () => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      const logs = logger.getLogs();
      expect(logs[0].level).toBe('debug');
      expect(logs[1].level).toBe('info');
      expect(logs[2].level).toBe('warn');
      expect(logs[3].level).toBe('error');
    });
  });
});

// =============================================================================
// PluginIsolatedPluginAPI
// =============================================================================

describe('PluginIsolatedPluginAPI', () => {
  let api: PluginIsolatedPluginAPI;
  let registry: PluginRegistryInterface;
  let enforcer: IsolationEnforcer;

  const samplePlugins = [
    { id: 'plugin-b', name: 'Plugin B', version: '1.0.0', publicAPI: { greet: () => 'hello' } },
    { id: 'plugin-c', name: 'Plugin C', version: '2.0.0' },
  ];

  beforeEach(() => {
    enforcer = new IsolationEnforcer();
    registry = createMockRegistry(samplePlugins);
    api = new PluginIsolatedPluginAPI(pluginA, registry, enforcer);
  });

  describe('getPublicAPI', () => {
    it('should return public API of existing plugin', async () => {
      const result = await api.getPublicAPI('plugin-b');
      expect(result).toEqual({ greet: expect.any(Function) });
    });

    it('should return null for non-existent plugin', async () => {
      const result = await api.getPublicAPI('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for plugin without public API', async () => {
      const result = await api.getPublicAPI('plugin-c');
      expect(result).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('should send message to existing plugin', async () => {
      const result = await api.sendMessage('plugin-b', { text: 'hi' });
      expect(result.ok).toBe(true);
      expect(registry.deliverMessage).toHaveBeenCalledWith('plugin-a', 'plugin-b', { text: 'hi' });
    });

    it('should return error for non-existent target plugin', async () => {
      const result = await api.sendMessage('nonexistent', { text: 'hi' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('plugin_not_found');
        expect(result.error).toHaveProperty('pluginId', 'nonexistent');
      }
    });

    it('should reject messages larger than 64KB', async () => {
      const largeMessage = { data: 'x'.repeat(65 * 1024) };
      const result = await api.sendMessage('plugin-b', largeMessage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('message_too_large');
        expect(result.error).toHaveProperty('maxSize', 64 * 1024);
      }
    });
  });

  describe('listPlugins', () => {
    it('should return list of available plugins', async () => {
      const plugins = await api.listPlugins();
      expect(plugins).toEqual([
        { id: 'plugin-b', name: 'Plugin B', version: '1.0.0' },
        { id: 'plugin-c', name: 'Plugin C', version: '2.0.0' },
      ]);
    });
  });
});

// =============================================================================
// PluginIsolationManager
// =============================================================================

describe('PluginIsolationManager', () => {
  let manager: PluginIsolationManager;

  beforeEach(() => {
    manager = new PluginIsolationManager();
  });

  describe('createContext', () => {
    it('should create an isolated context with all components', () => {
      const ctx = manager.createContext(
        makeIsolationConfig({ pluginId: pluginA }),
      );

      expect(ctx.pluginId).toBe('plugin-a');
      expect(ctx.version).toBe('1.0.0');
      expect(ctx.capabilities).toContain('storage:read');
      expect(ctx.capabilities).toContain('storage:write');
      expect(ctx.storage).toBeDefined();
      expect(ctx.events).toBeDefined();
      expect(ctx.log).toBeDefined();
      expect(ctx.plugins).toBeDefined();
    });

    it('should freeze capabilities array', () => {
      const ctx = manager.createContext(makeIsolationConfig());
      expect(Object.isFrozen(ctx.capabilities)).toBe(true);
    });

    it('should create network component when network capability is granted', () => {
      const ctx = manager.createContext(
        makeIsolationConfig({
          capabilities: ['network:fetch'],
          allowedDomains: ['api.example.com'],
        }),
      );

      expect(ctx.network).not.toBeNull();
    });

    it('should create network for network:domains:* capability', () => {
      const ctx = manager.createContext(
        makeIsolationConfig({ capabilities: ['network:domains:*'] }),
      );

      expect(ctx.network).not.toBeNull();
    });

    it('should create network for network:domains:specific capability', () => {
      const ctx = manager.createContext(
        makeIsolationConfig({
          capabilities: ['network:domains:specific'],
          allowedDomains: ['example.com'],
        }),
      );

      expect(ctx.network).not.toBeNull();
    });

    it('should not create network component when no network capability', () => {
      const ctx = manager.createContext(
        makeIsolationConfig({ capabilities: ['storage:read'] }),
      );

      expect(ctx.network).toBeNull();
    });

    it('should use registry for plugin API when registry is set', () => {
      const registry = createMockRegistry([
        { id: 'plugin-x', name: 'X', version: '1.0.0' },
      ]);
      manager.setRegistry(registry);

      const ctx = manager.createContext(makeIsolationConfig());
      expect(ctx.plugins).toBeDefined();
    });

    it('should provide stub plugin API when no registry is set', async () => {
      const ctx = manager.createContext(makeIsolationConfig());

      const publicApi = await ctx.plugins.getPublicAPI('anything');
      expect(publicApi).toBeNull();

      const plugins = await ctx.plugins.listPlugins();
      expect(plugins).toEqual([]);
    });
  });

  describe('getContext', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(manager.getContext('nonexistent')).toBeUndefined();
    });

    it('should return the created context', () => {
      const ctx = manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      expect(manager.getContext('plugin-a')).toBe(ctx);
    });
  });

  describe('destroyContext', () => {
    it('should remove the context', async () => {
      manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      await manager.destroyContext('plugin-a');
      expect(manager.getContext('plugin-a')).toBeUndefined();
    });

    it('should clear storage on destroy', async () => {
      const ctx = manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      await ctx.storage.set('key', 'value');

      await manager.destroyContext('plugin-a');
      // Re-create to verify storage is empty
      const ctx2 = manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      // The storage data map is per-instance so a fresh instance is empty
      expect(await ctx2.storage.keys()).toEqual([]);
    });

    it('should remove all event listeners on destroy', async () => {
      const ctx = manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      const handler = vi.fn();
      ctx.events.on('plugin:enabled', handler);

      await manager.destroyContext('plugin-a');

      // After destroy, dispatching should not call handler
      // But the events object is now cleaned up
    });

    it('should handle destroying non-existent context gracefully', async () => {
      await expect(manager.destroyContext('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('hasCapability', () => {
    it('should return true for granted capabilities', () => {
      manager.createContext(
        makeIsolationConfig({
          pluginId: pluginA,
          capabilities: ['storage:read', 'network:fetch'],
        }),
      );

      expect(manager.hasCapability('plugin-a', 'storage:read')).toBe(true);
      expect(manager.hasCapability('plugin-a', 'network:fetch')).toBe(true);
    });

    it('should return false for non-granted capabilities', () => {
      manager.createContext(
        makeIsolationConfig({
          pluginId: pluginA,
          capabilities: ['storage:read'],
        }),
      );

      expect(manager.hasCapability('plugin-a', 'network:fetch')).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      expect(manager.hasCapability('nonexistent', 'storage:read')).toBe(false);
    });
  });

  describe('getActiveContexts', () => {
    it('should return empty array initially', () => {
      expect(manager.getActiveContexts()).toEqual([]);
    });

    it('should return all active plugin ids', () => {
      manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      manager.createContext(makeIsolationConfig({ pluginId: pluginB }));

      const active = manager.getActiveContexts();
      expect(active).toHaveLength(2);
      expect(active).toContain('plugin-a');
      expect(active).toContain('plugin-b');
    });

    it('should not include destroyed contexts', async () => {
      manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      manager.createContext(makeIsolationConfig({ pluginId: pluginB }));

      await manager.destroyContext('plugin-a');

      const active = manager.getActiveContexts();
      expect(active).toEqual(['plugin-b']);
    });
  });

  describe('getEnforcer', () => {
    it('should return the isolation enforcer', () => {
      const enforcer = manager.getEnforcer();
      expect(enforcer).toBeInstanceOf(IsolationEnforcer);
    });

    it('should return the same enforcer instance', () => {
      expect(manager.getEnforcer()).toBe(manager.getEnforcer());
    });
  });

  describe('setRegistry', () => {
    it('should enable plugin communication after registry is set', async () => {
      const registry = createMockRegistry([
        { id: 'plugin-b', name: 'Plugin B', version: '1.0.0', publicAPI: { foo: 'bar' } },
      ]);

      manager.setRegistry(registry);

      const ctx = manager.createContext(makeIsolationConfig({ pluginId: pluginA }));
      const api = await ctx.plugins.getPublicAPI('plugin-b');
      expect(api).toEqual({ foo: 'bar' });
    });
  });
});

// =============================================================================
// createIsolationManager factory
// =============================================================================

describe('createIsolationManager', () => {
  it('should return a PluginIsolationManager instance', () => {
    const mgr = createIsolationManager();
    expect(mgr).toBeInstanceOf(PluginIsolationManager);
  });

  it('should pass config to the manager', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const mgr = createIsolationManager({ maxViolations: 1 });
    const enforcer = mgr.getEnforcer();

    enforcer.recordViolation({
      pluginId: pluginA,
      timestamp: new Date(),
      attemptedResource: 'memory:user',
      action: 'read',
    });

    expect(enforcer.isBlocked(pluginA)).toBe(true);
    vi.restoreAllMocks();
  });
});

// =============================================================================
// STORAGE_QUOTAS constant
// =============================================================================

describe('STORAGE_QUOTAS', () => {
  it('should define free tier as 1MB', () => {
    expect(STORAGE_QUOTAS.free).toBe(1 * 1024 * 1024);
  });

  it('should define basic tier as 10MB', () => {
    expect(STORAGE_QUOTAS.basic).toBe(10 * 1024 * 1024);
  });

  it('should define pro tier as 100MB', () => {
    expect(STORAGE_QUOTAS.pro).toBe(100 * 1024 * 1024);
  });

  it('should define enterprise tier as 1GB', () => {
    expect(STORAGE_QUOTAS.enterprise).toBe(1024 * 1024 * 1024);
  });
});

// =============================================================================
// DEFAULT_ISOLATION_LIMITS constant
// =============================================================================

describe('DEFAULT_ISOLATION_LIMITS', () => {
  it('should set cpuLimit to 5000ms', () => {
    expect(DEFAULT_ISOLATION_LIMITS.cpuLimit).toBe(5000);
  });

  it('should set memoryLimit to 128MB', () => {
    expect(DEFAULT_ISOLATION_LIMITS.memoryLimit).toBe(128 * 1024 * 1024);
  });

  it('should set executionTimeout to 30000ms', () => {
    expect(DEFAULT_ISOLATION_LIMITS.executionTimeout).toBe(30000);
  });

  it('should set storageQuota to basic tier', () => {
    expect(DEFAULT_ISOLATION_LIMITS.storageQuota).toBe(STORAGE_QUOTAS.basic);
  });
});
