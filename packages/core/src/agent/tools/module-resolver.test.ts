import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setModuleResolver, tryImport } from './module-resolver.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Reset the module-level _resolver to null between tests.
 * The public API only accepts a function, so we cast null to bypass the type.
 */
function resetResolver(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModuleResolver(null as any);
}

// =============================================================================
// setModuleResolver
// =============================================================================

describe('setModuleResolver', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('registers a resolver that tryImport can use', async () => {
    const resolver = vi.fn().mockResolvedValue({ hello: 'world' });
    setModuleResolver(resolver);

    const result = await tryImport('nonexistent-package-xyz');
    expect(resolver).toHaveBeenCalledWith('nonexistent-package-xyz');
    expect(result).toEqual({ hello: 'world' });
  });

  it('overwrites the previous resolver when called again', async () => {
    const first = vi.fn().mockResolvedValue('first');
    const second = vi.fn().mockResolvedValue('second');

    setModuleResolver(first);
    setModuleResolver(second);

    const result = await tryImport('nonexistent-package-xyz');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(result).toBe('second');
  });

  it('accepts any function matching the signature', () => {
    // Synchronous-looking but returns a Promise — should work fine
    const resolver = (name: string) => Promise.resolve({ name });
    expect(() => setModuleResolver(resolver)).not.toThrow();
  });
});

// =============================================================================
// tryImport — built-in / native modules
// =============================================================================

describe('tryImport — native modules', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('resolves a Node.js built-in module (node:path)', async () => {
    const mod = await tryImport('node:path');
    expect(mod).toBeDefined();
    expect(mod).toHaveProperty('join');
    expect(mod).toHaveProperty('resolve');
  });

  it('resolves a Node.js built-in module (node:fs)', async () => {
    const mod = await tryImport('node:fs');
    expect(mod).toBeDefined();
    expect(mod).toHaveProperty('readFileSync');
  });

  it('resolves a Node.js built-in module (node:url)', async () => {
    const mod = await tryImport('node:url');
    expect(mod).toBeDefined();
    expect(mod).toHaveProperty('URL');
  });

  it('does not call resolver when native import succeeds', async () => {
    const resolver = vi.fn().mockResolvedValue('should not be called');
    setModuleResolver(resolver);

    await tryImport('node:path');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('does not call resolver even if resolver is registered, for built-in modules', async () => {
    const resolver = vi.fn().mockResolvedValue({});
    setModuleResolver(resolver);

    await tryImport('node:os');
    await tryImport('node:crypto');
    expect(resolver).not.toHaveBeenCalled();
  });
});

// =============================================================================
// tryImport — no resolver registered
// =============================================================================

describe('tryImport — no resolver', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('throws when module does not exist and no resolver is set', async () => {
    await expect(tryImport('totally-fake-module-abc123')).rejects.toThrow(
      /Module 'totally-fake-module-abc123' not found/
    );
  });

  it('error message includes the module name', async () => {
    await expect(tryImport('my-missing-pkg')).rejects.toThrow("Module 'my-missing-pkg' not found");
  });

  it('error message includes setup instructions', async () => {
    await expect(tryImport('fake-pkg')).rejects.toThrow(
      'Ensure it is installed in the gateway package and setModuleResolver() was called during startup.'
    );
  });

  it('error message contains the full expected text', async () => {
    await expect(tryImport('sharp')).rejects.toThrow(
      `Module 'sharp' not found. Ensure it is installed in the gateway package and setModuleResolver() was called during startup.`
    );
  });

  it('throws an Error instance', async () => {
    try {
      await tryImport('nonexistent-xyz');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

// =============================================================================
// tryImport — with resolver
// =============================================================================

describe('tryImport — with resolver', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('calls resolver when native import fails', async () => {
    const resolver = vi.fn().mockResolvedValue({ default: 'resolved' });
    setModuleResolver(resolver);

    const result = await tryImport('nonexistent-package-xyz');
    expect(resolver).toHaveBeenCalledWith('nonexistent-package-xyz');
    expect(result).toEqual({ default: 'resolved' });
  });

  it('passes the exact module name string to the resolver', async () => {
    const resolver = vi.fn().mockResolvedValue({});
    setModuleResolver(resolver);

    await tryImport('@scope/some-package');
    expect(resolver).toHaveBeenCalledWith('@scope/some-package');
  });

  it('returns whatever the resolver returns', async () => {
    const fakeModule = { version: '1.0.0', doStuff: () => 42 };
    setModuleResolver(vi.fn().mockResolvedValue(fakeModule));

    const result = await tryImport('fake-module');
    expect(result).toBe(fakeModule);
  });

  it('returns undefined if resolver resolves with undefined', async () => {
    setModuleResolver(vi.fn().mockResolvedValue(undefined));

    const result = await tryImport('fake-module');
    expect(result).toBeUndefined();
  });

  it('returns null if resolver resolves with null', async () => {
    setModuleResolver(vi.fn().mockResolvedValue(null));

    const result = await tryImport('fake-module');
    expect(result).toBeNull();
  });

  it('returns a string if resolver resolves with a string', async () => {
    setModuleResolver(vi.fn().mockResolvedValue('string-module'));

    const result = await tryImport('fake-module');
    expect(result).toBe('string-module');
  });

  it('resolver is called only once per tryImport call', async () => {
    const resolver = vi.fn().mockResolvedValue({});
    setModuleResolver(resolver);

    await tryImport('fake-a');
    await tryImport('fake-b');

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(1, 'fake-a');
    expect(resolver).toHaveBeenNthCalledWith(2, 'fake-b');
  });
});

// =============================================================================
// tryImport — resolver errors
// =============================================================================

describe('tryImport — resolver errors', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('propagates errors thrown by the resolver', async () => {
    const resolver = vi.fn().mockRejectedValue(new Error('resolver failed'));
    setModuleResolver(resolver);

    await expect(tryImport('some-module')).rejects.toThrow('resolver failed');
  });

  it('propagates non-Error rejections from the resolver', async () => {
    const resolver = vi.fn().mockRejectedValue('string error');
    setModuleResolver(resolver);

    await expect(tryImport('some-module')).rejects.toBe('string error');
  });

  it('does not fall through to the "not found" error when resolver throws', async () => {
    const resolver = vi.fn().mockRejectedValue(new Error('custom error'));
    setModuleResolver(resolver);

    await expect(tryImport('some-module')).rejects.toThrow('custom error');
    // Should NOT contain the "not found" message
    try {
      await tryImport('some-module');
    } catch (err) {
      expect((err as Error).message).not.toContain('not found');
    }
  });

  it('propagates TypeError from resolver', async () => {
    const resolver = vi.fn().mockRejectedValue(new TypeError('cannot read property'));
    setModuleResolver(resolver);

    await expect(tryImport('some-module')).rejects.toThrow(TypeError);
    await expect(tryImport('some-module')).rejects.toThrow('cannot read property');
  });
});

// =============================================================================
// tryImport — fallback chain ordering
// =============================================================================

describe('tryImport — fallback chain', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('prefers native import over resolver for available modules', async () => {
    const resolver = vi.fn().mockResolvedValue({ fake: true });
    setModuleResolver(resolver);

    const mod = await tryImport('node:path');
    // Native import should have succeeded
    expect(mod).toHaveProperty('join');
    // Resolver should not have been invoked
    expect(resolver).not.toHaveBeenCalled();
  });

  it('falls through to resolver only when native import throws', async () => {
    const resolver = vi.fn().mockResolvedValue({ resolved: true });
    setModuleResolver(resolver);

    const result = await tryImport('nonexistent-pkg-fallback-test');
    expect(result).toEqual({ resolved: true });
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('throws "not found" only when both native import and resolver are unavailable', async () => {
    // No resolver set (resetResolver ran in beforeEach)
    await expect(tryImport('no-such-module-xyz')).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// tryImport — module-level state isolation
// =============================================================================

describe('tryImport — state isolation', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('resolver is null after reset', async () => {
    // With no resolver, nonexistent modules should throw "not found"
    await expect(tryImport('state-test-module')).rejects.toThrow(/not found/);
  });

  it('resolver set in one test does not leak to the next', async () => {
    // This test sets a resolver
    setModuleResolver(vi.fn().mockResolvedValue('leaked'));

    const result = await tryImport('leaky-module');
    expect(result).toBe('leaked');
  });

  it('confirms the previous resolver was cleaned up', async () => {
    // beforeEach calls resetResolver(), so the resolver from the previous test is gone
    await expect(tryImport('leaky-module')).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// tryImport — concurrent calls
// =============================================================================

describe('tryImport — concurrent calls', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('handles multiple concurrent tryImport calls with resolver', async () => {
    const resolver = vi.fn().mockImplementation((name: string) =>
      Promise.resolve({ name })
    );
    setModuleResolver(resolver);

    const [a, b, c] = await Promise.all([
      tryImport('mod-a'),
      tryImport('mod-b'),
      tryImport('mod-c'),
    ]);

    expect(a).toEqual({ name: 'mod-a' });
    expect(b).toEqual({ name: 'mod-b' });
    expect(c).toEqual({ name: 'mod-c' });
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it('handles mixed success and failure in concurrent calls', async () => {
    const resolver = vi.fn().mockImplementation((name: string) => {
      if (name === 'fail-me') return Promise.reject(new Error('deliberate fail'));
      return Promise.resolve({ name });
    });
    setModuleResolver(resolver);

    const results = await Promise.allSettled([
      tryImport('mod-ok'),
      tryImport('fail-me'),
      tryImport('node:path'),
    ]);

    expect(results[0]).toEqual({ status: 'fulfilled', value: { name: 'mod-ok' } });
    expect(results[1]).toEqual({ status: 'rejected', reason: new Error('deliberate fail') });
    expect(results[2]).toHaveProperty('status', 'fulfilled');
  });
});

// =============================================================================
// tryImport — edge cases
// =============================================================================

describe('tryImport — edge cases', () => {
  beforeEach(() => {
    resetResolver();
  });

  it('handles empty string module name with no resolver', async () => {
    await expect(tryImport('')).rejects.toThrow();
  });

  it('handles empty string module name with resolver', async () => {
    const resolver = vi.fn().mockResolvedValue({ empty: true });
    setModuleResolver(resolver);

    // Native import('') will fail, so it should fall through to resolver
    const result = await tryImport('');
    expect(resolver).toHaveBeenCalledWith('');
    expect(result).toEqual({ empty: true });
  });

  it('resolver returning a function is passed through', async () => {
    const fn = () => 'I am a function';
    setModuleResolver(vi.fn().mockResolvedValue(fn));

    const result = await tryImport('fn-module');
    expect(result).toBe(fn);
    expect((result as () => string)()).toBe('I am a function');
  });

  it('resolver returning a class instance is passed through', async () => {
    class FakeModule {
      name = 'fake';
    }
    const instance = new FakeModule();
    setModuleResolver(vi.fn().mockResolvedValue(instance));

    const result = await tryImport('class-module');
    expect(result).toBe(instance);
    expect(result).toBeInstanceOf(FakeModule);
  });

  it('resolver that returns a Promise (double-wrapped) unwraps correctly', async () => {
    // The resolver returns Promise<Promise<value>>, but await unwraps both layers
    setModuleResolver(vi.fn().mockResolvedValue(Promise.resolve('double-wrapped')));

    const result = await tryImport('double-module');
    expect(result).toBe('double-wrapped');
  });

  it('handles scoped package names', async () => {
    const resolver = vi.fn().mockResolvedValue({ scoped: true });
    setModuleResolver(resolver);

    await tryImport('@ownpilot/some-internal');
    expect(resolver).toHaveBeenCalledWith('@ownpilot/some-internal');
  });

  it('handles module names with subpaths', async () => {
    const resolver = vi.fn().mockResolvedValue({ subpath: true });
    setModuleResolver(resolver);

    await tryImport('some-package/dist/utils');
    expect(resolver).toHaveBeenCalledWith('some-package/dist/utils');
  });
});
