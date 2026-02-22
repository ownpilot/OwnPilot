import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_API_MAP,
  ALWAYS_AVAILABLE_API,
  canAccessAPI,
  FORBIDDEN_PATTERNS,
  containsForbiddenPatterns,
  createPluginAPIProxy,
} from './api-boundary.js';
import type { PluginCapability } from './isolation.js';

// ---------------------------------------------------------------------------
// CAPABILITY_API_MAP
// ---------------------------------------------------------------------------
describe('CAPABILITY_API_MAP', () => {
  it('maps storage:read to storage getters', () => {
    const apis = CAPABILITY_API_MAP['storage:read'];
    expect(apis).toContain('storage.get');
    expect(apis).toContain('storage.keys');
    expect(apis).toContain('storage.usage');
  });

  it('maps storage:write to storage setters', () => {
    const apis = CAPABILITY_API_MAP['storage:write'];
    expect(apis).toContain('storage.set');
    expect(apis).toContain('storage.delete');
  });

  it('maps network:fetch to network APIs', () => {
    const apis = CAPABILITY_API_MAP['network:fetch'];
    expect(apis).toContain('network.fetch');
    expect(apis).toContain('network.isDomainAllowed');
  });

  it('maps tools:register to tools.register', () => {
    expect(CAPABILITY_API_MAP['tools:register']).toContain('tools.register');
  });

  it('maps events:subscribe to events.on', () => {
    expect(CAPABILITY_API_MAP['events:subscribe']).toContain('events.on');
  });

  it('maps events:emit to events.emit', () => {
    expect(CAPABILITY_API_MAP['events:emit']).toContain('events.emit');
  });

  it('maps plugins:communicate to plugins APIs', () => {
    const apis = CAPABILITY_API_MAP['plugins:communicate'];
    expect(apis).toContain('plugins.getPublicAPI');
    expect(apis).toContain('plugins.sendMessage');
    expect(apis).toContain('plugins.list');
  });
});

// ---------------------------------------------------------------------------
// ALWAYS_AVAILABLE_API
// ---------------------------------------------------------------------------
describe('ALWAYS_AVAILABLE_API', () => {
  it('includes log methods', () => {
    expect(ALWAYS_AVAILABLE_API).toContain('log.debug');
    expect(ALWAYS_AVAILABLE_API).toContain('log.info');
    expect(ALWAYS_AVAILABLE_API).toContain('log.warn');
    expect(ALWAYS_AVAILABLE_API).toContain('log.error');
  });

  it('includes utility methods', () => {
    expect(ALWAYS_AVAILABLE_API).toContain('utils.uuid');
    expect(ALWAYS_AVAILABLE_API).toContain('utils.now');
    expect(ALWAYS_AVAILABLE_API).toContain('utils.hash');
    expect(ALWAYS_AVAILABLE_API).toContain('utils.parseJSON');
    expect(ALWAYS_AVAILABLE_API).toContain('utils.stringify');
  });
});

// ---------------------------------------------------------------------------
// canAccessAPI
// ---------------------------------------------------------------------------
describe('canAccessAPI', () => {
  it('allows always-available APIs with no capabilities', () => {
    expect(canAccessAPI('log.info', []).allowed).toBe(true);
    expect(canAccessAPI('utils.uuid', []).allowed).toBe(true);
  });

  it('allows API when capability is granted', () => {
    expect(canAccessAPI('storage.get', ['storage:read']).allowed).toBe(true);
    expect(canAccessAPI('network.fetch', ['network:fetch']).allowed).toBe(true);
    expect(canAccessAPI('events.on', ['events:subscribe']).allowed).toBe(true);
  });

  it('denies API when capability is not granted', () => {
    const result = canAccessAPI('storage.set', ['storage:read']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('denies forbidden APIs', () => {
    const result = canAccessAPI('memory.get', []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('forbidden');
  });

  it('denies credential access', () => {
    expect(canAccessAPI('credential.get', []).allowed).toBe(false);
  });

  it('denies process access', () => {
    expect(canAccessAPI('process.exit', []).allowed).toBe(false);
  });

  it('denies vault access', () => {
    expect(canAccessAPI('vault.open', []).allowed).toBe(false);
  });

  it('denies unknown APIs without capability', () => {
    const result = canAccessAPI('custom.api', []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No capability');
  });
});

// ---------------------------------------------------------------------------
// FORBIDDEN_PATTERNS
// ---------------------------------------------------------------------------
describe('FORBIDDEN_PATTERNS', () => {
  it('blocks memory access patterns', () => {
    const memoryPatterns = FORBIDDEN_PATTERNS.filter(
      (p) => p.test('SecureMemoryStore') || p.test('memoryStore')
    );
    expect(memoryPatterns.length).toBeGreaterThan(0);
  });

  it('blocks credential patterns', () => {
    const credPatterns = FORBIDDEN_PATTERNS.filter(
      (p) => p.test('UserCredentialStore') || p.test('credentialStore')
    );
    expect(credPatterns.length).toBeGreaterThan(0);
  });

  it('blocks process patterns', () => {
    const processPatterns = FORBIDDEN_PATTERNS.filter(
      (p) => p.test('child_process') || p.test('spawn')
    );
    expect(processPatterns.length).toBeGreaterThan(0);
  });

  it('blocks eval/Function patterns', () => {
    const dangerousPatterns = FORBIDDEN_PATTERNS.filter(
      (p) => p.test('eval(') || p.test('Function(')
    );
    expect(dangerousPatterns.length).toBeGreaterThan(0);
  });

  it('blocks import() pattern', () => {
    const importPattern = FORBIDDEN_PATTERNS.filter((p) => p.test('import('));
    expect(importPattern.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// containsForbiddenPatterns
// ---------------------------------------------------------------------------
describe('containsForbiddenPatterns', () => {
  it('returns safe for clean code', () => {
    const result = containsForbiddenPatterns('const x = 1 + 2;');
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects memory access', () => {
    const result = containsForbiddenPatterns('const store = new SecureMemoryStore()');
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('detects credential access', () => {
    const result = containsForbiddenPatterns('credentialStore.get("key")');
    expect(result.safe).toBe(false);
  });

  it('detects process.env access', () => {
    const result = containsForbiddenPatterns('const key = process.env.SECRET');
    expect(result.safe).toBe(false);
  });

  it('detects eval usage', () => {
    const result = containsForbiddenPatterns('eval("dangerous code")');
    expect(result.safe).toBe(false);
  });

  it('detects import() usage', () => {
    const result = containsForbiddenPatterns('const mod = await import("fs")');
    expect(result.safe).toBe(false);
  });

  it('detects require("fs")', () => {
    const result = containsForbiddenPatterns("require('fs')");
    expect(result.safe).toBe(false);
  });

  it('detects spawn/exec', () => {
    const result = containsForbiddenPatterns('spawn("rm", ["-rf", "/"])');
    expect(result.safe).toBe(false);
  });

  it('detects globalThis', () => {
    const result = containsForbiddenPatterns('globalThis.process');
    expect(result.safe).toBe(false);
  });

  it('returns multiple violations', () => {
    const code = 'eval("x"); spawn("ls"); process.env.KEY';
    const result = containsForbiddenPatterns(code);
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// createPluginAPIProxy
// ---------------------------------------------------------------------------
describe('createPluginAPIProxy', () => {
  const mockStorage = {
    get: async (_k: string) => null,
    set: async (_k: string, _v: unknown) => {},
    delete: async (_k: string) => true,
    keys: async () => [] as string[],
    usage: async () => ({ used: 0, quota: 1000 }),
  };

  const mockLog = {
    debug: (_msg: string) => {},
    info: (_msg: string) => {},
    warn: (_msg: string) => {},
    error: (_msg: string) => {},
  };

  const mockUtils = {
    uuid: () => '123',
    now: () => Date.now(),
    hash: (_d: string) => 'abc',
    parseJSON: <T>(_t: string) => null as T | null,
    stringify: (_d: unknown) => '{}',
  };

  const mockEvents = {
    on: (_e: string, _h: (d: unknown) => void) => (() => {}) as () => void,
    emit: (_e: string, _d: unknown) => {},
  };

  const mockNetwork = {
    fetch: async (_u: string) => ({ status: 200, body: '', headers: {} }),
    isDomainAllowed: (_d: string) => true,
  };

  const mockTools = {
    register: (
      _def: { name: string; description: string; parameters: Record<string, unknown> },
      _handler: (args: Record<string, unknown>) => Promise<unknown>
    ) => {},
    list: () => [] as Array<{ name: string; description: string }>,
  };

  const mockUi = {
    notify: (_title: string, _body: string) => {},
    showDialog: async (_opts: { title: string; body: string; buttons: string[] }) => 0,
  };

  const mockPlugins = {
    getPublicAPI: async (_id: string) => null as Record<string, unknown> | null,
    sendMessage: async (_id: string, _msg: unknown) => {},
    list: async () => [] as Array<{ id: string; name: string }>,
  };

  it('always includes log and utils', () => {
    const proxy = createPluginAPIProxy([], { log: mockLog, utils: mockUtils });
    expect(proxy.log).toBeDefined();
    expect(proxy.utils).toBeDefined();
  });

  it('freezes log and utils', () => {
    const proxy = createPluginAPIProxy([], { log: mockLog, utils: mockUtils });
    expect(Object.isFrozen(proxy.log)).toBe(true);
    expect(Object.isFrozen(proxy.utils)).toBe(true);
  });

  it('includes storage.get with storage:read', () => {
    const caps: PluginCapability[] = ['storage:read'];
    const proxy = createPluginAPIProxy(caps, { storage: mockStorage });
    expect(proxy.storage).toBeDefined();
    expect(proxy.storage!.get).toBeDefined();
    expect(proxy.storage!.keys).toBeDefined();
  });

  it('excludes storage.set with only storage:read', () => {
    const caps: PluginCapability[] = ['storage:read'];
    const proxy = createPluginAPIProxy(caps, { storage: mockStorage });
    expect((proxy.storage as Record<string, unknown>)?.set).toBeUndefined();
  });

  it('includes storage.set with storage:write', () => {
    const caps: PluginCapability[] = ['storage:write'];
    const proxy = createPluginAPIProxy(caps, { storage: mockStorage });
    expect(proxy.storage).toBeDefined();
    expect((proxy.storage as Record<string, unknown>)?.set).toBeDefined();
    expect((proxy.storage as Record<string, unknown>)?.delete).toBeDefined();
  });

  it('includes both read and write with both capabilities', () => {
    const caps: PluginCapability[] = ['storage:read', 'storage:write'];
    const proxy = createPluginAPIProxy(caps, { storage: mockStorage });
    expect(proxy.storage!.get).toBeDefined();
    expect((proxy.storage as Record<string, unknown>)?.set).toBeDefined();
  });

  it('includes network with network:fetch', () => {
    const caps: PluginCapability[] = ['network:fetch'];
    const proxy = createPluginAPIProxy(caps, { network: mockNetwork });
    expect(proxy.network).toBeDefined();
    expect(proxy.network!.fetch).toBeDefined();
  });

  it('includes tools.register with tools:register', () => {
    const caps: PluginCapability[] = ['tools:register'];
    const proxy = createPluginAPIProxy(caps, { tools: mockTools });
    expect(proxy.tools).toBeDefined();
    expect((proxy.tools as Record<string, unknown>)?.register).toBeDefined();
  });

  it('includes tools.list with tools:invoke', () => {
    const caps: PluginCapability[] = ['tools:invoke'];
    const proxy = createPluginAPIProxy(caps, { tools: mockTools });
    expect(proxy.tools).toBeDefined();
    expect((proxy.tools as Record<string, unknown>)?.list).toBeDefined();
  });

  it('includes events.on with events:subscribe', () => {
    const caps: PluginCapability[] = ['events:subscribe'];
    const proxy = createPluginAPIProxy(caps, { events: mockEvents });
    expect(proxy.events).toBeDefined();
    expect((proxy.events as Record<string, unknown>)?.on).toBeDefined();
  });

  it('includes events.emit with events:emit', () => {
    const caps: PluginCapability[] = ['events:emit'];
    const proxy = createPluginAPIProxy(caps, { events: mockEvents });
    expect(proxy.events).toBeDefined();
    expect((proxy.events as Record<string, unknown>)?.emit).toBeDefined();
  });

  it('includes ui.notify with ui:notifications', () => {
    const caps: PluginCapability[] = ['ui:notifications'];
    const proxy = createPluginAPIProxy(caps, { ui: mockUi });
    expect(proxy.ui).toBeDefined();
    expect((proxy.ui as Record<string, unknown>)?.notify).toBeDefined();
  });

  it('includes ui.showDialog with ui:dialogs', () => {
    const caps: PluginCapability[] = ['ui:dialogs'];
    const proxy = createPluginAPIProxy(caps, { ui: mockUi });
    expect(proxy.ui).toBeDefined();
    expect((proxy.ui as Record<string, unknown>)?.showDialog).toBeDefined();
  });

  it('includes plugins with plugins:communicate', () => {
    const caps: PluginCapability[] = ['plugins:communicate'];
    const proxy = createPluginAPIProxy(caps, { plugins: mockPlugins });
    expect(proxy.plugins).toBeDefined();
    expect(proxy.plugins!.getPublicAPI).toBeDefined();
  });

  it('returns frozen proxy', () => {
    const proxy = createPluginAPIProxy([], { log: mockLog });
    expect(Object.isFrozen(proxy)).toBe(true);
  });

  it('freezes each sub-object', () => {
    const caps: PluginCapability[] = ['storage:read', 'network:fetch'];
    const proxy = createPluginAPIProxy(caps, {
      storage: mockStorage,
      network: mockNetwork,
    });
    expect(Object.isFrozen(proxy.storage)).toBe(true);
    expect(Object.isFrozen(proxy.network)).toBe(true);
  });

  it('omits implementations that are not provided', () => {
    const caps: PluginCapability[] = ['storage:read'];
    const proxy = createPluginAPIProxy(caps, {});
    expect(proxy.storage).toBeUndefined();
  });
});
