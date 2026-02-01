/**
 * ServiceRegistry Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ServiceToken,
  ServiceRegistry,
  initServiceRegistry,
  getServiceRegistry,
  hasServiceRegistry,
  resetServiceRegistry,
} from './registry.js';

describe('ServiceToken', () => {
  it('stores name', () => {
    const token = new ServiceToken<string>('test');
    expect(token.name).toBe('test');
  });

  it('toString includes name', () => {
    const token = new ServiceToken<number>('count');
    expect(token.toString()).toBe('ServiceToken(count)');
  });
});

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  describe('register / get', () => {
    it('registers and retrieves a service', () => {
      const token = new ServiceToken<string>('greeting');
      registry.register(token, 'hello');
      expect(registry.get(token)).toBe('hello');
    });

    it('throws on get for unregistered service', () => {
      const token = new ServiceToken<string>('missing');
      expect(() => registry.get(token)).toThrow("Service 'missing' not registered");
    });

    it('overwrites existing registration', () => {
      const token = new ServiceToken<number>('counter');
      registry.register(token, 1);
      registry.register(token, 2);
      expect(registry.get(token)).toBe(2);
    });
  });

  describe('registerFactory', () => {
    it('creates instance lazily on first get', () => {
      const factory = vi.fn(() => ({ value: 42 }));
      const token = new ServiceToken<{ value: number }>('lazy');

      registry.registerFactory(token, factory);
      expect(factory).not.toHaveBeenCalled();

      const result = registry.get(token);
      expect(factory).toHaveBeenCalledOnce();
      expect(result.value).toBe(42);
    });

    it('caches factory result on subsequent gets', () => {
      const factory = vi.fn(() => ({ value: 42 }));
      const token = new ServiceToken<{ value: number }>('lazy');

      registry.registerFactory(token, factory);
      const first = registry.get(token);
      const second = registry.get(token);

      expect(factory).toHaveBeenCalledOnce();
      expect(first).toBe(second);
    });
  });

  describe('tryGet', () => {
    it('returns instance if registered', () => {
      const token = new ServiceToken<string>('exists');
      registry.register(token, 'here');
      expect(registry.tryGet(token)).toBe('here');
    });

    it('returns null if not registered', () => {
      const token = new ServiceToken<string>('missing');
      expect(registry.tryGet(token)).toBeNull();
    });
  });

  describe('has', () => {
    it('returns true for registered instance', () => {
      const token = new ServiceToken<string>('check');
      registry.register(token, 'yes');
      expect(registry.has(token)).toBe(true);
    });

    it('returns true for registered factory', () => {
      const token = new ServiceToken<string>('factory');
      registry.registerFactory(token, () => 'value');
      expect(registry.has(token)).toBe(true);
    });

    it('returns false for unregistered', () => {
      const token = new ServiceToken<string>('nope');
      expect(registry.has(token)).toBe(false);
    });
  });

  describe('list', () => {
    it('lists all registered service names', () => {
      const a = new ServiceToken<string>('alpha');
      const b = new ServiceToken<number>('beta');
      registry.register(a, 'a');
      registry.registerFactory(b, () => 1);
      expect(registry.list()).toEqual(expect.arrayContaining(['alpha', 'beta']));
    });
  });

  describe('dispose', () => {
    it('calls dispose on disposable services in reverse order', async () => {
      const order: string[] = [];
      const tokenA = new ServiceToken<{ dispose(): void }>('a');
      const tokenB = new ServiceToken<{ dispose(): void }>('b');

      registry.register(tokenA, { dispose: () => { order.push('a'); } });
      registry.register(tokenB, { dispose: () => { order.push('b'); } });

      await registry.dispose();
      expect(order).toEqual(['b', 'a']);
    });

    it('clears all services after dispose', async () => {
      const token = new ServiceToken<string>('ephemeral');
      registry.register(token, 'value');

      await registry.dispose();
      expect(registry.has(token)).toBe(false);
    });

    it('handles dispose errors gracefully', async () => {
      const token = new ServiceToken<{ dispose(): void }>('broken');
      registry.register(token, {
        dispose: () => { throw new Error('cleanup failed'); },
      });

      // Should not throw
      await expect(registry.dispose()).resolves.toBeUndefined();
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(async () => {
    await resetServiceRegistry();
  });

  it('hasServiceRegistry returns false before init', () => {
    expect(hasServiceRegistry()).toBe(false);
  });

  it('getServiceRegistry throws before init', () => {
    expect(() => getServiceRegistry()).toThrow('ServiceRegistry not initialized');
  });

  it('initServiceRegistry creates and returns registry', () => {
    const registry = initServiceRegistry();
    expect(registry).toBeInstanceOf(ServiceRegistry);
    expect(hasServiceRegistry()).toBe(true);
  });

  it('getServiceRegistry returns initialized registry', () => {
    const created = initServiceRegistry();
    const fetched = getServiceRegistry();
    expect(fetched).toBe(created);
  });

  it('initServiceRegistry throws if already initialized', () => {
    initServiceRegistry();
    expect(() => initServiceRegistry()).toThrow('already initialized');
  });

  it('resetServiceRegistry allows re-initialization', async () => {
    initServiceRegistry();
    await resetServiceRegistry();
    expect(hasServiceRegistry()).toBe(false);

    const fresh = initServiceRegistry();
    expect(fresh).toBeInstanceOf(ServiceRegistry);
  });
});
