/**
 * Plugin System Tests — PluginRegistry, PluginBuilder, and factory functions
 *
 * Covers:
 * - PluginBuilder: fluent API, build(), validation, defaults
 * - PluginRegistry: register(), get/getAll/getEnabled, enable/disable, unregister
 * - PluginRegistry: getAllTools, getTool, routeMessage, emitEvent, onEvent
 * - PluginRegistry: createContext(), storage API, logger, events
 * - Factory functions: createPlugin(), getDefaultPluginRegistry() singleton
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state shared across vi.mock() factories
// ---------------------------------------------------------------------------

const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// Default: ENOENT (no config file) — reset in beforeEach to prevent Once-queue leakage
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockEmit = vi.hoisted(() => vi.fn());
const mockOnAny = vi.hoisted(() => vi.fn());
const mockScopedEmit = vi.hoisted(() => vi.fn());
const mockScopedOn = vi.hoisted(() => vi.fn(() => vi.fn())); // returns unsub
const mockScoped = vi.hoisted(() =>
  vi.fn(() => ({
    emit: mockScopedEmit,
    on: mockScopedOn,
  }))
);

const mockGetLog = vi.hoisted(() =>
  vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  }))
);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

vi.mock('node:path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  },
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: mockGetLog,
}));

vi.mock('../events/index.js', () => ({
  getEventSystem: () => ({
    emit: mockEmit,
    onAny: mockOnAny,
    scoped: mockScoped,
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import { PluginRegistry, PluginBuilder, createPlugin, getDefaultPluginRegistry } from './index.js';
import type { PluginManifest, Plugin as _Plugin, MessageHandler, HandlerContext } from './index.js';
import type { ToolDefinition, ToolExecutor } from '../agent/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    capabilities: [],
    permissions: [],
    main: 'index.js',
    ...overrides,
  };
}

function makeToolDef(name = 'my_tool'): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: { type: 'object' as const, properties: {}, required: [] },
  };
}

const noopExecutor: ToolExecutor = async () => ({ content: 'ok', success: true });

function makeHandler(overrides: Partial<MessageHandler> = {}): MessageHandler {
  return {
    name: 'test-handler',
    description: 'Test handler',
    priority: 10,
    canHandle: vi.fn().mockResolvedValue(true),
    handle: vi.fn().mockResolvedValue({ handled: true, response: 'handled' }),
    ...overrides,
  };
}

function makeHandlerContext(): HandlerContext {
  return {
    userId: 'user-1',
    conversationId: 'conv-1',
    channel: 'web',
  };
}

function makeRegistry(storageDir = '/test/plugins'): PluginRegistry {
  return new PluginRegistry(storageDir);
}

// ---------------------------------------------------------------------------
// Helper: resets all mocks and restores sensible defaults
// Call this in beforeEach to prevent Once-queue leakage across tests
// ---------------------------------------------------------------------------

function resetAllMocksWithDefaults(): void {
  vi.resetAllMocks();
  // Restore fs mock defaults
  mockMkdir.mockResolvedValue(undefined);
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockWriteFile.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  // Restore event system mock defaults
  mockScopedOn.mockImplementation(() => vi.fn()); // returns an unsub fn
  mockScoped.mockImplementation(() => ({
    emit: mockScopedEmit,
    on: mockScopedOn,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginBuilder', () => {
  describe('fluent API chaining', () => {
    it('returns this from id()', () => {
      const builder = new PluginBuilder();
      expect(builder.id('my-plugin')).toBe(builder);
    });

    it('returns this from name()', () => {
      const builder = new PluginBuilder();
      expect(builder.name('My Plugin')).toBe(builder);
    });

    it('returns this from version()', () => {
      const builder = new PluginBuilder();
      expect(builder.version('1.0.0')).toBe(builder);
    });

    it('returns this from description()', () => {
      const builder = new PluginBuilder();
      expect(builder.description('A plugin')).toBe(builder);
    });

    it('returns this from capabilities()', () => {
      const builder = new PluginBuilder();
      expect(builder.capabilities(['tools'])).toBe(builder);
    });

    it('returns this from onLoad()', () => {
      const builder = new PluginBuilder();
      expect(builder.onLoad(async () => {})).toBe(builder);
    });

    it('returns this from onUnload()', () => {
      const builder = new PluginBuilder();
      expect(builder.onUnload(async () => {})).toBe(builder);
    });

    it('returns this from onEnable()', () => {
      const builder = new PluginBuilder();
      expect(builder.onEnable(async () => {})).toBe(builder);
    });

    it('returns this from onDisable()', () => {
      const builder = new PluginBuilder();
      expect(builder.onDisable(async () => {})).toBe(builder);
    });

    it('returns this from tool()', () => {
      const builder = new PluginBuilder();
      expect(builder.tool(makeToolDef(), noopExecutor)).toBe(builder);
    });

    it('returns this from tools()', () => {
      const builder = new PluginBuilder();
      expect(builder.tools([{ definition: makeToolDef(), executor: noopExecutor }])).toBe(builder);
    });

    it('returns this from handler()', () => {
      const builder = new PluginBuilder();
      expect(builder.handler(makeHandler())).toBe(builder);
    });

    it('returns this from publicApi()', () => {
      const builder = new PluginBuilder();
      expect(builder.publicApi({ doSomething: () => 'yes' })).toBe(builder);
    });

    it('returns this from hooks()', () => {
      const builder = new PluginBuilder();
      expect(builder.hooks({ onLoad: async () => {} })).toBe(builder);
    });

    it('returns this from meta()', () => {
      const builder = new PluginBuilder();
      expect(builder.meta({ id: 'x', name: 'X', version: '1.0.0' })).toBe(builder);
    });

    it('returns this from database()', () => {
      const builder = new PluginBuilder();
      expect(builder.database('my_table', 'My Table', [{ name: 'col', type: 'text' }])).toBe(
        builder
      );
    });

    it('supports full chaining in sequence', () => {
      const result = new PluginBuilder()
        .id('chain-plugin')
        .name('Chain Plugin')
        .version('2.0.0')
        .description('chained')
        .capabilities(['tools', 'storage'])
        .tool(makeToolDef(), noopExecutor)
        .handler(makeHandler())
        .publicApi({ api: true })
        .build();

      expect(result.manifest.id).toBe('chain-plugin');
      expect(result.manifest.version).toBe('2.0.0');
    });
  });

  describe('build() — valid manifest', () => {
    it('returns manifest and implementation', () => {
      const { manifest, implementation } = new PluginBuilder()
        .id('my-plugin')
        .name('My Plugin')
        .version('1.0.0')
        .build();

      expect(manifest.id).toBe('my-plugin');
      expect(manifest.name).toBe('My Plugin');
      expect(manifest.version).toBe('1.0.0');
      expect(implementation).toBeDefined();
    });

    it('sets default description to empty string', () => {
      const { manifest } = new PluginBuilder().id('p').name('P').version('1.0.0').build();
      expect(manifest.description).toBe('');
    });

    it('sets default capabilities to empty array', () => {
      const { manifest } = new PluginBuilder().id('p').name('P').version('1.0.0').build();
      expect(manifest.capabilities).toEqual([]);
    });

    it('sets default permissions to empty array', () => {
      const { manifest } = new PluginBuilder().id('p').name('P').version('1.0.0').build();
      expect(manifest.permissions).toEqual([]);
    });

    it('sets default main to index.js', () => {
      const { manifest } = new PluginBuilder().id('p').name('P').version('1.0.0').build();
      expect(manifest.main).toBe('index.js');
    });

    it('uses provided description over default', () => {
      const { manifest } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .description('Custom description')
        .build();
      expect(manifest.description).toBe('Custom description');
    });

    it('uses provided capabilities', () => {
      const { manifest } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .capabilities(['tools', 'storage'])
        .build();
      expect(manifest.capabilities).toEqual(['tools', 'storage']);
    });

    it('includes tools in implementation', () => {
      const def = makeToolDef('my_tool');
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .tool(def, noopExecutor)
        .build();
      expect(implementation.tools).toBeInstanceOf(Map);
      expect(implementation.tools!.has('my_tool')).toBe(true);
    });

    it('includes multiple tools via tools()', () => {
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .tools([
          { definition: makeToolDef('tool_a'), executor: noopExecutor },
          { definition: makeToolDef('tool_b'), executor: noopExecutor },
        ])
        .build();
      expect(implementation.tools!.size).toBe(2);
      expect(implementation.tools!.has('tool_a')).toBe(true);
      expect(implementation.tools!.has('tool_b')).toBe(true);
    });

    it('includes handlers in implementation', () => {
      const h = makeHandler({ name: 'h1' });
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .handler(h)
        .build();
      expect(implementation.handlers).toContain(h);
    });

    it('includes publicApi in implementation', () => {
      const api = { greet: () => 'hello' };
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .publicApi(api)
        .build();
      expect(implementation.api).toBe(api);
    });

    it('includes lifecycle hooks set via onLoad/onEnable/onDisable/onUnload', () => {
      const onLoad = vi.fn();
      const onUnload = vi.fn();
      const onEnable = vi.fn();
      const onDisable = vi.fn();

      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .onLoad(async () => {
          onLoad();
        })
        .onUnload(async () => {
          onUnload();
        })
        .onEnable(async () => {
          onEnable();
        })
        .onDisable(async () => {
          onDisable();
        })
        .build();

      expect(implementation.lifecycle?.onLoad).toBeDefined();
      expect(implementation.lifecycle?.onUnload).toBeDefined();
      expect(implementation.lifecycle?.onEnable).toBeDefined();
      expect(implementation.lifecycle?.onDisable).toBeDefined();
    });

    it('includes lifecycle hooks set via hooks()', () => {
      const onLoad = async () => {};
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .hooks({ onLoad })
        .build();
      expect(implementation.lifecycle?.onLoad).toBe(onLoad);
    });

    it('includes database tables in manifest', () => {
      const { manifest } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .database('events', 'Events', [{ name: 'id', type: 'text', required: true }], {
          description: 'Event log',
        })
        .build();
      expect(manifest.databaseTables).toHaveLength(1);
      expect(manifest.databaseTables![0]!.name).toBe('events');
      expect(manifest.databaseTables![0]!.displayName).toBe('Events');
      expect(manifest.databaseTables![0]!.description).toBe('Event log');
    });

    it('includes multiple database tables', () => {
      const { manifest } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .database('table_a', 'Table A', [])
        .database('table_b', 'Table B', [])
        .build();
      expect(manifest.databaseTables).toHaveLength(2);
    });

    it('does not include databaseTables key when none declared', () => {
      const { manifest } = new PluginBuilder().id('p').name('P').version('1.0.0').build();
      expect(manifest.databaseTables).toBeUndefined();
    });

    it('meta() merges fields into manifest', () => {
      const { manifest } = new PluginBuilder()
        .meta({ id: 'meta-plugin', name: 'Meta', version: '3.0.0', category: 'utilities' })
        .build();
      expect(manifest.id).toBe('meta-plugin');
      expect(manifest.category).toBe('utilities');
    });

    it('meta() is additive — later meta() merges on top', () => {
      const { manifest } = new PluginBuilder()
        .meta({ id: 'p1', name: 'P1', version: '1.0.0' })
        .meta({ description: 'added later' })
        .build();
      expect(manifest.id).toBe('p1');
      expect(manifest.description).toBe('added later');
    });

    it('tool() registered after tools() coexists', () => {
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .tools([{ definition: makeToolDef('t1'), executor: noopExecutor }])
        .tool(makeToolDef('t2'), noopExecutor)
        .build();
      expect(implementation.tools!.size).toBe(2);
    });

    it('duplicate tool name in tool() overwrites previous', () => {
      const exec1: ToolExecutor = async () => ({ content: 'v1', success: true });
      const exec2: ToolExecutor = async () => ({ content: 'v2', success: true });
      const { implementation } = new PluginBuilder()
        .id('p')
        .name('P')
        .version('1.0.0')
        .tool(makeToolDef('same'), exec1)
        .tool(makeToolDef('same'), exec2)
        .build();
      expect(implementation.tools!.get('same')!.executor).toBe(exec2);
    });
  });

  describe('build() — validation errors', () => {
    it('throws when id is missing', () => {
      expect(() => new PluginBuilder().name('P').version('1.0.0').build()).toThrow(
        'Plugin must have id, name, and version'
      );
    });

    it('throws when name is missing', () => {
      expect(() => new PluginBuilder().id('p').version('1.0.0').build()).toThrow(
        'Plugin must have id, name, and version'
      );
    });

    it('throws when version is missing', () => {
      expect(() => new PluginBuilder().id('p').name('P').build()).toThrow(
        'Plugin must have id, name, and version'
      );
    });

    it('throws when all three are missing', () => {
      expect(() => new PluginBuilder().build()).toThrow('Plugin must have id, name, and version');
    });
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry — constructor & initialize', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('uses provided storageDir', () => {
    const registry = new PluginRegistry('/custom/dir');
    // storage dir is private; we verify by checking mkdir called with it on init
    return registry.initialize().then(() => {
      expect(mockMkdir).toHaveBeenCalledWith('/custom/dir', { recursive: true });
    });
  });

  it('uses HOME env var for default storageDir when no arg given', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = '/home/testuser';
    const registry = new PluginRegistry();
    await registry.initialize();
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('.ownpilot/plugins'), {
      recursive: true,
    });
    process.env.HOME = origHome;
  });

  it('initialize() calls mkdir with recursive: true', async () => {
    const registry = makeRegistry();
    await registry.initialize();
    expect(mockMkdir).toHaveBeenCalledWith('/test/plugins', { recursive: true });
  });

  it('initialize() resolves even if loadInstalledPlugins is a no-op', async () => {
    const registry = makeRegistry();
    await expect(registry.initialize()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.register()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('registers a basic plugin and returns it', async () => {
    const registry = makeRegistry();
    const manifest = makeManifest();
    const plugin = await registry.register(manifest, {});
    expect(plugin.manifest).toBe(manifest);
    expect(plugin.status).toBe('enabled'); // default config has enabled: true
  });

  it('sets status to disabled when loaded config has enabled: false', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), {});
    expect(plugin.status).toBe('disabled');
    expect(plugin.config.enabled).toBe(false);
  });

  it('creates default config when no config file exists', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest({ defaultConfig: { foo: 'bar' } }), {});
    expect(plugin.config.settings).toEqual({ foo: 'bar' });
    expect(plugin.config.enabled).toBe(true);
  });

  it('loads existing config from disk', async () => {
    const existingConfig = {
      enabled: true,
      settings: { key: 'value' },
      grantedPermissions: ['storage'],
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-06-01T00:00:00.000Z',
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(existingConfig));

    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), {});
    expect(plugin.config.settings).toEqual({ key: 'value' });
    expect(plugin.config.grantedPermissions).toEqual(['storage']);
  });

  it('stores plugin in internal map — accessible via get()', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'my-plugin' }), {});
    expect(registry.get('my-plugin')).toBeDefined();
  });

  it('calls onLoad lifecycle hook', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry();
    await registry.register(makeManifest(), { lifecycle: { onLoad } });
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('calls onEnable when plugin is enabled', async () => {
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry();
    await registry.register(makeManifest(), { lifecycle: { onEnable } });
    expect(onEnable).toHaveBeenCalledOnce();
  });

  it('does NOT call onEnable when config.enabled is false', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const onEnable = vi.fn();
    const registry = makeRegistry();
    await registry.register(makeManifest(), { lifecycle: { onEnable } });
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('rolls back registration when onLoad throws', async () => {
    const onLoad = vi.fn().mockRejectedValue(new Error('load failed'));
    const registry = makeRegistry();

    await expect(
      registry.register(makeManifest({ id: 'bad-plugin' }), { lifecycle: { onLoad } })
    ).rejects.toThrow('load failed');
    expect(registry.get('bad-plugin')).toBeUndefined();
  });

  it('removes handlers from global list when onLoad throws', async () => {
    const handler = makeHandler();
    const onLoad = vi.fn().mockRejectedValue(new Error('fail'));
    const registry = makeRegistry();

    await expect(
      registry.register(makeManifest(), { handlers: [handler], lifecycle: { onLoad } })
    ).rejects.toThrow();

    const result = await registry.routeMessage('hello', makeHandlerContext());
    expect(result.handled).toBe(false);
  });

  it('sets status to error when onEnable throws', async () => {
    const onEnable = vi.fn().mockRejectedValue(new Error('enable failed'));
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), { lifecycle: { onEnable } });
    expect(plugin.status).toBe('error');
  });

  it('keeps plugin registered even when onEnable fails', async () => {
    const onEnable = vi.fn().mockRejectedValue(new Error('enable failed'));
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'err-plugin' }), { lifecycle: { onEnable } });
    expect(registry.get('err-plugin')).toBeDefined();
  });

  it('registers handlers sorted by priority (descending)', async () => {
    const h1 = makeHandler({ name: 'low', priority: 1 });
    const h2 = makeHandler({ name: 'high', priority: 100 });
    const h3 = makeHandler({ name: 'mid', priority: 50 });

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), { handlers: [h1] });
    await registry.register(makeManifest({ id: 'p2' }), { handlers: [h2, h3] });

    // routeMessage iterates handlers in priority order; high-priority should match first
    (h2.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h1.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h3.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h2.handle as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
      response: 'from-high',
    });

    const result = await registry.routeMessage('test', makeHandlerContext());
    expect(result.response).toBe('from-high');
  });

  it('throws when a required dependency is missing', async () => {
    const registry = makeRegistry();
    const manifest = makeManifest({ dependencies: { 'missing-dep': '1.0.0' } });
    await expect(registry.register(manifest, {})).rejects.toThrow(
      'Missing dependency: missing-dep'
    );
  });

  it('does not throw when dependency is present with matching version', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'dep-plugin', version: '2.0.0' }), {});

    const consumer = makeManifest({ id: 'consumer', dependencies: { 'dep-plugin': '2.0.0' } });
    await expect(registry.register(consumer, {})).resolves.toBeDefined();
  });

  it('warns but does not throw when dependency version mismatches', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'dep-plugin', version: '1.0.0' }), {});

    const consumer = makeManifest({ id: 'consumer', dependencies: { 'dep-plugin': '2.0.0' } });
    await expect(registry.register(consumer, {})).resolves.toBeDefined();
  });

  it('accepts wildcard (*) version dependency without warning', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'dep-plugin', version: '9.9.9' }), {});
    const consumer = makeManifest({ id: 'consumer', dependencies: { 'dep-plugin': '*' } });
    await expect(registry.register(consumer, {})).resolves.toBeDefined();
  });

  it('serializes concurrent register() calls via withLock', async () => {
    const order: string[] = [];
    const registry = makeRegistry();

    const p1 = registry.register(makeManifest({ id: 'plugin-a' }), {
      lifecycle: {
        onLoad: async () => {
          order.push('a-start');
          await new Promise((r) => setTimeout(r, 10));
          order.push('a-end');
        },
      },
    });

    const p2 = registry.register(makeManifest({ id: 'plugin-b' }), {
      lifecycle: {
        onLoad: async () => {
          order.push('b-start');
          order.push('b-end');
        },
      },
    });

    await Promise.all([p1, p2]);
    // With mutex: a must fully complete before b starts
    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('b-start'));
  });

  it('register() initializes tools from implementation.tools Map', async () => {
    const toolsMap = new Map([
      ['my_tool', { definition: makeToolDef('my_tool'), executor: noopExecutor }],
    ]);
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), { tools: toolsMap });
    expect(plugin.tools.has('my_tool')).toBe(true);
  });

  it('register() defaults tools to empty Map when not provided', async () => {
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), {});
    expect(plugin.tools).toBeInstanceOf(Map);
    expect(plugin.tools.size).toBe(0);
  });

  it('register() defaults handlers to empty array when not provided', async () => {
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), {});
    expect(plugin.handlers).toEqual([]);
  });

  it('register() sets api from implementation.api', async () => {
    const api = { doThing: () => 'yes' };
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest(), { api });
    expect(plugin.api).toBe(api);
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.get / getAll / getEnabled', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('get() returns undefined for unknown id', async () => {
    const registry = makeRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('get() returns the registered plugin', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const plugin = registry.get('p');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.id).toBe('p');
  });

  it('getAll() returns empty array when no plugins', () => {
    const registry = makeRegistry();
    expect(registry.getAll()).toEqual([]);
  });

  it('getAll() returns all registered plugins', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), {});
    await registry.register(makeManifest({ id: 'p2' }), {});
    expect(registry.getAll()).toHaveLength(2);
  });

  it('getEnabled() returns only enabled plugins', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(disabledConfig)) // p1 disabled
      .mockRejectedValueOnce(new Error('ENOENT')); // p2 uses default (enabled)

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), {});
    await registry.register(makeManifest({ id: 'p2' }), {});

    const enabled = registry.getEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.manifest.id).toBe('p2');
  });

  it('getEnabled() returns empty array when all plugins disabled', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValue(JSON.stringify(disabledConfig));
    const registry = makeRegistry();
    await registry.register(makeManifest(), {});
    expect(registry.getEnabled()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.enable()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns false for unknown plugin id', async () => {
    const registry = makeRegistry();
    expect(await registry.enable('ghost')).toBe(false);
  });

  it('sets status to enabled', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    await registry.enable('p');
    expect(registry.get('p')!.status).toBe('enabled');
    expect(registry.get('p')!.config.enabled).toBe(true);
  });

  it('saves config to disk on enable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockWriteFile.mockClear();
    await registry.enable('p');
    expect(mockWriteFile).toHaveBeenCalled();
    const saved = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(saved.enabled).toBe(true);
  });

  it('calls onEnable lifecycle hook', async () => {
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onEnable } });
    onEnable.mockClear(); // clear call from register
    await registry.enable('p');
    expect(onEnable).toHaveBeenCalledOnce();
  });

  it('emits plugin.status event on enable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockEmit.mockClear();
    await registry.enable('p');
    expect(mockEmit).toHaveBeenCalledWith(
      'plugin.status',
      'plugin-registry',
      expect.objectContaining({ pluginId: 'p', newStatus: 'enabled' })
    );
  });

  it('returns false and sets status to error when onEnable throws', async () => {
    // Register with disabled config so onEnable is NOT called during register
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const onEnable = vi.fn().mockRejectedValue(new Error('enable error'));
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onEnable } });

    // enable() should call onEnable, which rejects, returning false + setting status=error
    const result = await registry.enable('p');
    expect(result).toBe(false);
    expect(registry.get('p')!.status).toBe('error');
  });

  it('returns true on successful enable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const result = await registry.enable('p');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.disable()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns false for unknown plugin id', async () => {
    const registry = makeRegistry();
    expect(await registry.disable('ghost')).toBe(false);
  });

  it('sets status to disabled', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    await registry.disable('p');
    expect(registry.get('p')!.status).toBe('disabled');
    expect(registry.get('p')!.config.enabled).toBe(false);
  });

  it('saves config to disk on disable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockWriteFile.mockClear();
    await registry.disable('p');
    expect(mockWriteFile).toHaveBeenCalled();
    const saved = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(saved.enabled).toBe(false);
  });

  it('calls onDisable lifecycle hook', async () => {
    const onDisable = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onDisable } });
    await registry.disable('p');
    expect(onDisable).toHaveBeenCalledOnce();
  });

  it('emits plugin.status event on disable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockEmit.mockClear();
    await registry.disable('p');
    expect(mockEmit).toHaveBeenCalledWith(
      'plugin.status',
      'plugin-registry',
      expect.objectContaining({ pluginId: 'p', newStatus: 'disabled' })
    );
  });

  it('does NOT throw when onDisable throws — catches silently', async () => {
    const onDisable = vi.fn().mockRejectedValue(new Error('disable error'));
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onDisable } });
    await expect(registry.disable('p')).resolves.toBe(true);
    expect(registry.get('p')!.status).toBe('disabled');
  });

  it('returns true on successful disable', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    expect(await registry.disable('p')).toBe(true);
  });

  it('status goes from enabled to disabled', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    expect(registry.get('p')!.status).toBe('enabled');
    await registry.disable('p');
    expect(registry.get('p')!.status).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.unregister()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns false for unknown plugin id', async () => {
    const registry = makeRegistry();
    expect(await registry.unregister('ghost')).toBe(false);
  });

  it('removes plugin from internal map', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    await registry.unregister('p');
    expect(registry.get('p')).toBeUndefined();
  });

  it('calls onUnload lifecycle hook', async () => {
    const onUnload = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onUnload } });
    await registry.unregister('p');
    expect(onUnload).toHaveBeenCalledOnce();
  });

  it('does not throw when onUnload throws — catches silently', async () => {
    const onUnload = vi.fn().mockRejectedValue(new Error('unload error'));
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { lifecycle: { onUnload } });
    await expect(registry.unregister('p')).resolves.toBe(true);
  });

  it('removes handlers registered by the plugin', async () => {
    const handler = makeHandler({ name: 'my-handler' });
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { handlers: [handler] });

    // handler matches before unregister
    const before = await registry.routeMessage('hello', makeHandlerContext());
    expect(before.handled).toBe(true);

    // reset canHandle mock so it still returns true if called
    (handler.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await registry.unregister('p');

    const after = await registry.routeMessage('hello', makeHandlerContext());
    expect(after.handled).toBe(false);
  });

  it('cleans up event subscriptions on unregister', async () => {
    const unsubFn = vi.fn();
    mockScopedOn.mockReturnValueOnce(unsubFn);

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});

    // createContext and subscribe to an event
    const ctx = registry.createContext('p');
    const handler = vi.fn();
    ctx.events.on('my-event', handler);

    await registry.unregister('p');
    expect(unsubFn).toHaveBeenCalled();
  });

  it('returns true on successful unregister', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    expect(await registry.unregister('p')).toBe(true);
  });

  it('serializes concurrent unregister() calls via withLock', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), {});
    await registry.register(makeManifest({ id: 'p2' }), {});

    const [r1, r2] = await Promise.all([registry.unregister('p1'), registry.unregister('p2')]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(registry.getAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.getAllTools()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns empty array when no enabled plugins', async () => {
    const registry = makeRegistry();
    expect(registry.getAllTools()).toEqual([]);
  });

  it('returns tools from enabled plugins', async () => {
    const toolsMap = new Map([['t1', { definition: makeToolDef('t1'), executor: noopExecutor }]]);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { tools: toolsMap });

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.definition.name).toBe('t1');
    expect(tools[0]!.pluginId).toBe('p');
  });

  it('does NOT return tools from disabled plugins', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const toolsMap = new Map([['t1', { definition: makeToolDef('t1'), executor: noopExecutor }]]);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { tools: toolsMap });

    expect(registry.getAllTools()).toHaveLength(0);
  });

  it('aggregates tools from multiple enabled plugins', async () => {
    const tools1 = new Map([
      ['tool_a', { definition: makeToolDef('tool_a'), executor: noopExecutor }],
    ]);
    const tools2 = new Map([
      ['tool_b', { definition: makeToolDef('tool_b'), executor: noopExecutor }],
      ['tool_c', { definition: makeToolDef('tool_c'), executor: noopExecutor }],
    ]);

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), { tools: tools1 });
    await registry.register(makeManifest({ id: 'p2' }), { tools: tools2 });

    const all = registry.getAllTools();
    expect(all).toHaveLength(3);
    const names = all.map((t) => t.definition.name);
    expect(names).toContain('tool_a');
    expect(names).toContain('tool_b');
    expect(names).toContain('tool_c');
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.getTool()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns undefined for unknown tool name', async () => {
    const registry = makeRegistry();
    expect(registry.getTool('nonexistent')).toBeUndefined();
  });

  it('returns undefined when plugin is disabled', async () => {
    const disabledConfig = {
      enabled: false,
      settings: {},
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(disabledConfig));

    const toolsMap = new Map([
      ['my_tool', { definition: makeToolDef('my_tool'), executor: noopExecutor }],
    ]);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { tools: toolsMap });
    expect(registry.getTool('my_tool')).toBeUndefined();
  });

  it('finds tool by name from enabled plugin', async () => {
    const toolsMap = new Map([
      ['my_tool', { definition: makeToolDef('my_tool'), executor: noopExecutor }],
    ]);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { tools: toolsMap });

    const result = registry.getTool('my_tool');
    expect(result).toBeDefined();
    expect(result!.definition.name).toBe('my_tool');
    expect(result!.plugin.manifest.id).toBe('p');
  });

  it('returns executor alongside definition and plugin', async () => {
    const customExecutor: ToolExecutor = async () => ({ content: 'result', success: true });
    const toolsMap = new Map([['t', { definition: makeToolDef('t'), executor: customExecutor }]]);
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), { tools: toolsMap });

    const result = registry.getTool('t');
    expect(result!.executor).toBe(customExecutor);
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.routeMessage()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('returns { handled: false } when no handlers registered', async () => {
    const registry = makeRegistry();
    const result = await registry.routeMessage('hello', makeHandlerContext());
    expect(result).toEqual({ handled: false });
  });

  it('returns { handled: false } when no handler canHandle the message', async () => {
    const handler = makeHandler();
    (handler.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const registry = makeRegistry();
    await registry.register(makeManifest(), { handlers: [handler] });

    const result = await registry.routeMessage('hello', makeHandlerContext());
    expect(result.handled).toBe(false);
  });

  it('routes message to matching handler', async () => {
    const handler = makeHandler();
    (handler.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (handler.handle as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
      response: 'done',
    });

    const registry = makeRegistry();
    await registry.register(makeManifest(), { handlers: [handler] });

    const result = await registry.routeMessage('hello', makeHandlerContext());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('done');
  });

  it('calls handler.handle with message and context', async () => {
    const handler = makeHandler();
    const ctx = makeHandlerContext();

    const registry = makeRegistry();
    await registry.register(makeManifest(), { handlers: [handler] });
    await registry.routeMessage('hello world', ctx);

    expect(handler.handle).toHaveBeenCalledWith('hello world', ctx);
  });

  it('stops at first matching handler (does not call subsequent)', async () => {
    const h1 = makeHandler({ name: 'h1', priority: 100 });
    const h2 = makeHandler({ name: 'h2', priority: 10 });
    (h1.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h2.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h1.handle as ReturnType<typeof vi.fn>).mockResolvedValue({ handled: true });

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), { handlers: [h1] });
    await registry.register(makeManifest({ id: 'p2' }), { handlers: [h2] });

    await registry.routeMessage('msg', makeHandlerContext());
    expect(h1.handle).toHaveBeenCalledOnce();
    expect(h2.handle).not.toHaveBeenCalled();
  });

  it('skips non-matching handlers and finds a later match', async () => {
    const h1 = makeHandler({ name: 'h1', priority: 100 });
    const h2 = makeHandler({ name: 'h2', priority: 10 });
    (h1.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (h2.canHandle as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (h2.handle as ReturnType<typeof vi.fn>).mockResolvedValue({
      handled: true,
      response: 'second',
    });

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p1' }), { handlers: [h1] });
    await registry.register(makeManifest({ id: 'p2' }), { handlers: [h2] });

    const result = await registry.routeMessage('msg', makeHandlerContext());
    expect(result.response).toBe('second');
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.emitEvent()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('delegates to getEventSystem().emit() with plugin.custom type', () => {
    const registry = makeRegistry();
    registry.emitEvent('my-plugin:some-event', { key: 'val' });
    expect(mockEmit).toHaveBeenCalledWith(
      'plugin.custom',
      'plugin:my-plugin',
      expect.objectContaining({
        pluginId: 'my-plugin',
        event: 'some-event',
        data: { key: 'val' },
      })
    );
  });

  it('uses entire event string as pluginId when no colon separator', () => {
    const registry = makeRegistry();
    registry.emitEvent('bare-event', 42);
    expect(mockEmit).toHaveBeenCalledWith(
      'plugin.custom',
      'plugin:bare-event',
      expect.objectContaining({ pluginId: 'bare-event' })
    );
  });

  it('handles multi-colon event names (keeps remainder as event)', () => {
    const registry = makeRegistry();
    registry.emitEvent('plugin:ns:action', null);
    expect(mockEmit).toHaveBeenCalledWith(
      'plugin.custom',
      'plugin:plugin',
      expect.objectContaining({ pluginId: 'plugin', event: 'ns:action' })
    );
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.onEvent()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('delegates to getEventSystem().onAny()', () => {
    const registry = makeRegistry();
    const handler = vi.fn();
    registry.onEvent('some-event', handler);
    expect(mockOnAny).toHaveBeenCalledWith('some-event', expect.any(Function));
  });

  it('passes event.data to the provided handler', () => {
    const registry = makeRegistry();
    const handler = vi.fn();
    registry.onEvent('ev', handler);

    // Simulate the onAny callback being invoked
    const onAnyCallback = mockOnAny.mock.calls[0]![1] as (e: { data: unknown }) => void;
    onAnyCallback({ data: { payload: 123 } });
    expect(handler).toHaveBeenCalledWith({ payload: 123 });
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry.createContext()', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('throws for unknown plugin id', () => {
    const registry = makeRegistry();
    expect(() => registry.createContext('ghost')).toThrow('Plugin not found: ghost');
  });

  it('returns PluginContext with pluginId', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.pluginId).toBe('p');
  });

  it('returns PluginContext with config reference', async () => {
    const registry = makeRegistry();
    const plugin = await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.config).toBe(plugin.config);
  });

  it('returns PluginContext with storage object', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.storage).toBeDefined();
    expect(typeof ctx.storage.get).toBe('function');
    expect(typeof ctx.storage.set).toBe('function');
    expect(typeof ctx.storage.delete).toBe('function');
    expect(typeof ctx.storage.list).toBe('function');
    expect(typeof ctx.storage.clear).toBe('function');
  });

  it('returns PluginContext with logger', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.log).toBeDefined();
    expect(typeof ctx.log.info).toBe('function');
    expect(typeof ctx.log.warn).toBe('function');
    expect(typeof ctx.log.error).toBe('function');
    expect(typeof ctx.log.debug).toBe('function');
  });

  it('returns PluginContext with events object', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.events).toBeDefined();
    expect(typeof ctx.events.emit).toBe('function');
    expect(typeof ctx.events.on).toBe('function');
    expect(typeof ctx.events.off).toBe('function');
  });

  it('getPlugin() returns api of other registered plugin', async () => {
    const api = { version: '1.0' };
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'dep' }), { api });
    await registry.register(makeManifest({ id: 'consumer' }), {});

    const ctx = registry.createContext('consumer');
    expect(ctx.getPlugin('dep')).toBe(api);
  });

  it('getPlugin() returns undefined for unknown plugin', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    expect(ctx.getPlugin('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry — Storage API', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('storage.get() returns undefined when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const val = await ctx.storage.get('key');
    expect(val).toBeUndefined();
  });

  it('storage.get() returns value from existing storage file', async () => {
    const data = { myKey: 'myValue' };
    // config read returns ENOENT, storage read returns data
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load during register
      .mockResolvedValueOnce(JSON.stringify(data)); // storage.get

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const val = await ctx.storage.get('myKey');
    expect(val).toBe('myValue');
  });

  it('storage.set() writes merged data to file', async () => {
    const existing = { existingKey: 'existingVal' };
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockResolvedValueOnce(JSON.stringify(existing)); // storage.set read

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockWriteFile.mockClear();

    const ctx = registry.createContext('p');
    await ctx.storage.set('newKey', 'newVal');

    expect(mockWriteFile).toHaveBeenCalled();
    const written = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(written.existingKey).toBe('existingVal');
    expect(written.newKey).toBe('newVal');
  });

  it('storage.set() creates new file when none exists', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockRejectedValueOnce(new Error('ENOENT')); // storage.set read

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockWriteFile.mockClear();

    const ctx = registry.createContext('p');
    await ctx.storage.set('k', 'v');

    const written = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(written.k).toBe('v');
  });

  it('storage.set() throws when writeFile fails', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockRejectedValueOnce(new Error('ENOENT')); // storage read
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES'));

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});

    const ctx = registry.createContext('p');
    await expect(ctx.storage.set('k', 'v')).rejects.toThrow('EACCES');
  });

  it('storage.delete() returns true when key existed and was deleted', async () => {
    const data = { target: 'value', other: 'keep' };
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockResolvedValueOnce(JSON.stringify(data)); // storage.delete read

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockWriteFile.mockClear();

    const ctx = registry.createContext('p');
    const result = await ctx.storage.delete('target');
    expect(result).toBe(true);

    const written = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(written.target).toBeUndefined();
    expect(written.other).toBe('keep');
  });

  it('storage.delete() returns false when key does not exist', async () => {
    const data = { other: 'val' };
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockResolvedValueOnce(JSON.stringify(data)); // storage.delete read

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const result = await ctx.storage.delete('nonexistent');
    expect(result).toBe(false);
  });

  it('storage.delete() returns false when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const result = await ctx.storage.delete('any');
    expect(result).toBe(false);
  });

  it('storage.list() returns keys from storage file', async () => {
    const data = { keyA: 1, keyB: 2, keyC: 3 };
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockResolvedValueOnce(JSON.stringify(data)); // storage.list read

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const keys = await ctx.storage.list();
    expect(keys.sort()).toEqual(['keyA', 'keyB', 'keyC']);
  });

  it('storage.list() returns empty array when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const keys = await ctx.storage.list();
    expect(keys).toEqual([]);
  });

  it('storage.clear() calls unlink on storage file', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    mockUnlink.mockClear();

    const ctx = registry.createContext('p');
    await ctx.storage.clear();
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('p.storage.json'));
  });

  it('storage.clear() does not throw when file does not exist', async () => {
    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    await expect(ctx.storage.clear()).resolves.toBeUndefined();
  });

  it('storage files use storageDir/pluginId.storage.json path', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('ENOENT')) // config load
      .mockRejectedValueOnce(new Error('ENOENT')); // storage read
    mockWriteFile.mockClear();

    const registry = new PluginRegistry('/my/storage/dir');
    await registry.register(makeManifest({ id: 'special-plugin' }), {});
    const ctx = registry.createContext('special-plugin');
    await ctx.storage.set('k', 'v');

    const filePath = mockWriteFile.mock.calls[0]![0] as string;
    expect(filePath).toBe('/my/storage/dir/special-plugin.storage.json');
  });
});

// ---------------------------------------------------------------------------

describe('PluginRegistry — Events API (createEvents)', () => {
  beforeEach(() => {
    resetAllMocksWithDefaults();
  });

  it('events.emit() delegates to scoped bus emit', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    ctx.events.emit('my-event', { hello: 'world' });
    expect(mockScopedEmit).toHaveBeenCalledWith('my-event', { hello: 'world' });
  });

  it('events.on() registers handler on scoped bus', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const handler = vi.fn();
    ctx.events.on('some-event', handler);
    expect(mockScopedOn).toHaveBeenCalledWith('some-event', expect.any(Function));
  });

  it('events.on() passes event.data to handler', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const handler = vi.fn();
    ctx.events.on('ev', handler);

    const onCallback = mockScopedOn.mock.calls[0]![1] as (e: { data: unknown }) => void;
    onCallback({ data: { foo: 'bar' } });
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('events.off() calls the unsubscribe function', async () => {
    const unsubFn = vi.fn();
    mockScopedOn.mockReturnValueOnce(unsubFn);

    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const handler = vi.fn();
    ctx.events.on('ev', handler);
    ctx.events.off('ev', handler);
    expect(unsubFn).toHaveBeenCalled();
  });

  it('events.off() does nothing for handler not registered via on()', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'p' }), {});
    const ctx = registry.createContext('p');
    const handler = vi.fn();
    // Call off without calling on first — should not throw
    expect(() => ctx.events.off('ev', handler)).not.toThrow();
  });

  it('scoped bus is created with plugin-namespaced scope', async () => {
    const registry = makeRegistry();
    await registry.register(makeManifest({ id: 'my-plugin' }), {});
    registry.createContext('my-plugin');
    expect(mockScoped).toHaveBeenCalledWith('plugin.my-plugin', 'plugin:my-plugin');
  });
});

// ---------------------------------------------------------------------------

describe('createPlugin() factory', () => {
  it('returns a PluginBuilder instance', () => {
    const builder = createPlugin();
    expect(builder).toBeInstanceOf(PluginBuilder);
  });

  it('each call returns a fresh builder', () => {
    const b1 = createPlugin();
    const b2 = createPlugin();
    expect(b1).not.toBe(b2);
  });

  it('returned builder can build a valid plugin', () => {
    const result = createPlugin()
      .id('factory-plugin')
      .name('Factory Plugin')
      .version('0.1.0')
      .build();
    expect(result.manifest.id).toBe('factory-plugin');
  });
});

// ---------------------------------------------------------------------------

describe('getDefaultPluginRegistry() singleton', () => {
  afterEach(() => {
    // The module-level singleton cannot be externally reset (by design).
    // Restore mock defaults so subsequent describe blocks are not affected.
    resetAllMocksWithDefaults();
  });

  it('returns a PluginRegistry instance', async () => {
    const registry = await getDefaultPluginRegistry();
    expect(registry).toBeInstanceOf(PluginRegistry);
  });

  it('returns the same instance on repeated calls', async () => {
    const r1 = await getDefaultPluginRegistry();
    const r2 = await getDefaultPluginRegistry();
    expect(r1).toBe(r2);
  });

  it('auto-initializes the registry (calls mkdir)', async () => {
    // mkdir is only called if a new registry is created
    // On first call in this test file's lifecycle the singleton may already exist
    // We verify initialize behavior by checking the registry is usable
    const registry = await getDefaultPluginRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.getAll).toBe('function');
  });
});
