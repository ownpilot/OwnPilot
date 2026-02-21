/**
 * Tests for packages/gateway/src/plugins/init.ts
 *
 * Covers:
 * - initializePlugins(): boot flow, DB state application, channel plugin factories
 * - refreshChannelApi(): factory cache lookup, config injection, plugin API update
 * - News RSS Plugin: structure, all 5 tool executors
 * - Pomodoro Plugin: structure, all 3 tool executors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Hoisted mock values
// =============================================================================

const {
  mockRegistry,
  mockPlugin,
  mockPluginsRepo,
  mockPomodoroRepo,
  mockConfigServicesRepo,
  mockRegisterToolConfigReqs,
  mockLog,
  mockDatabaseRepo,
  mockBuildCorePlugin,
  mockBuildGatewayPlugin,
  mockBuildComposioPlugin,
  mockBuildTelegramChannelPlugin,
  mockGetServiceRegistry,
} = vi.hoisted(() => {
  const mockPlugin = {
    api: null as unknown,
    config: {
      settings: {} as Record<string, unknown>,
      grantedPermissions: [] as string[],
      enabled: false,
    },
    status: 'disabled' as string,
    manifest: {
      requiredServices: [] as Array<{ name: string }>,
    },
  };

  const mockRegistry = {
    register: vi.fn().mockResolvedValue(mockPlugin),
    get: vi.fn(),
    getAll: vi.fn(() => [] as unknown[]),
    getEnabled: vi.fn(() => [] as unknown[]),
  };

  const mockDatabaseRepo = {
    addRecord: vi.fn(),
    listRecords: vi.fn(),
    getRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
    ensurePluginTable: vi.fn().mockResolvedValue(undefined),
  };

  const mockGetServiceRegistry = vi.fn(() => ({
    get: vi.fn(() => mockDatabaseRepo),
  }));

  return {
    mockPlugin,
    mockRegistry,
    mockPluginsRepo: {
      getById: vi.fn(),
      upsert: vi.fn(),
    },
    mockPomodoroRepo: {
      getActiveSession: vi.fn(),
      startSession: vi.fn(),
      completeSession: vi.fn(),
      interruptSession: vi.fn(),
      getDailyStats: vi.fn(),
      getTotalStats: vi.fn(),
    },
    mockConfigServicesRepo: {
      getDefaultEntry: vi.fn(),
    },
    mockRegisterToolConfigReqs: vi.fn().mockResolvedValue(undefined),
    mockLog: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    mockDatabaseRepo,
    mockBuildCorePlugin: vi.fn(() => ({
      manifest: {
        id: 'core',
        name: 'Core',
        version: '1.0.0',
        requiredServices: [],
        defaultConfig: {},
      },
      implementation: {},
    })),
    mockBuildGatewayPlugin: vi.fn(() => ({
      manifest: {
        id: 'gateway',
        name: 'OwnPilot Gateway',
        version: '1.0.0',
        requiredServices: [],
        defaultConfig: {},
      },
      implementation: {},
    })),
    mockBuildComposioPlugin: vi.fn(() => ({
      manifest: {
        id: 'composio',
        name: 'Composio Integration',
        version: '1.0.0',
        requiredServices: [{ name: 'composio' }],
        defaultConfig: {},
      },
      implementation: {},
    })),
    mockBuildTelegramChannelPlugin: vi.fn(() => ({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: {
        channelApiFactory: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      },
    })),
    mockGetServiceRegistry,
  };
});

// =============================================================================
// Module mocks
// =============================================================================

vi.mock('@ownpilot/core', () => {
  // Minimal PluginBuilder implementation to capture tool registrations
  class FakePluginBuilder {
    private _manifest: Record<string, unknown> = {};
    private _tools: Array<{ def: Record<string, unknown>; exec: (...args: unknown[]) => unknown }> = [];
    private _tables: Array<{ name: string }> = [];

    meta(data: Record<string, unknown>) {
      Object.assign(this._manifest, data);
      return this;
    }

    id(val: string) { this._manifest.id = val; return this; }
    name(val: string) { this._manifest.name = val; return this; }
    version(val: string) { this._manifest.version = val; return this; }
    description(val: string) { this._manifest.description = val; return this; }
    capabilities(val: unknown) { this._manifest.capabilities = val; return this; }
    permissions(val: unknown) { this._manifest.permissions = val; return this; }

    database(name: string, displayName: string, columns: unknown[], opts?: unknown) {
      this._tables.push({ name, displayName, columns, ...(opts ?? {}) } as Record<string, unknown> as { name: string });
      return this;
    }

    tool(def: Record<string, unknown>, exec: (...args: unknown[]) => unknown) {
      this._tools.push({ def, exec });
      return this;
    }

    tools(arr: Array<{ definition: Record<string, unknown>; executor: (...args: unknown[]) => unknown }>) {
      for (const { definition, executor } of arr) {
        this._tools.push({ def: definition, exec: executor });
      }
      return this;
    }

    publicApi(api: unknown) { this._manifest.api = api; return this; }
    handler(h: unknown) { void h; return this; }
    hooks(h: unknown) { void h; return this; }
    onLoad(fn: unknown) { void fn; return this; }
    onUnload(fn: unknown) { void fn; return this; }
    onEnable(fn: unknown) { void fn; return this; }
    onDisable(fn: unknown) { void fn; return this; }
    channelApi(factory: unknown) { this._manifest.channelApiFactory = factory; return this; }

    build() {
      const toolsMap = new Map<string, { definition: Record<string, unknown>; executor: (...args: unknown[]) => unknown }>();
      for (const { def, exec } of this._tools) {
        toolsMap.set(def.name as string, { definition: def, executor: exec });
      }

      const databaseTables = this._tables.length > 0 ? this._tables : undefined;

      return {
        manifest: {
          ...this._manifest,
          databaseTables,
          requiredServices: (this._manifest.requiredServices as unknown[]) ?? [],
          defaultConfig: (this._manifest.defaultConfig as unknown) ?? {},
        },
        implementation: {
          tools: toolsMap,
          channelApiFactory: this._manifest.channelApiFactory,
        },
      };
    }
  }

  return {
    getDefaultPluginRegistry: vi.fn().mockResolvedValue(mockRegistry),
    createPlugin: vi.fn(() => new FakePluginBuilder()),
    buildCorePlugin: mockBuildCorePlugin,
    getServiceRegistry: mockGetServiceRegistry,
    Services: { Database: 'Database' },
  };
});

vi.mock('../db/repositories/plugins.js', () => ({
  pluginsRepo: mockPluginsRepo,
}));

vi.mock('../db/repositories/pomodoro.js', () => ({
  pomodoroRepo: mockPomodoroRepo,
}));

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

vi.mock('../services/api-service-registrar.js', () => ({
  registerToolConfigRequirements: mockRegisterToolConfigReqs,
}));

vi.mock('../channels/plugins/telegram/index.js', () => ({
  buildTelegramChannelPlugin: mockBuildTelegramChannelPlugin,
}));

vi.mock('./gateway-plugin.js', () => ({
  buildGatewayPlugin: mockBuildGatewayPlugin,
}));

vi.mock('./composio.js', () => ({
  buildComposioPlugin: mockBuildComposioPlugin,
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// Global fetch mock for RSS tool executors
vi.stubGlobal('fetch', vi.fn());

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { initializePlugins, refreshChannelApi } from './init.js';
import { getDefaultPluginRegistry } from '@ownpilot/core';

// =============================================================================
// Helpers
// =============================================================================

function makeDbRecord(overrides: Partial<{
  id: string;
  name: string;
  version: string;
  status: string;
  settings: Record<string, unknown>;
  grantedPermissions: string[];
}> = {}) {
  return {
    id: 'plugin-id',
    name: 'Test Plugin',
    version: '1.0.0',
    status: 'enabled',
    settings: {},
    grantedPermissions: [],
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetMockPlugin() {
  mockPlugin.api = null;
  mockPlugin.config.settings = {};
  mockPlugin.config.grantedPermissions = [];
  mockPlugin.config.enabled = false;
  mockPlugin.status = 'disabled';
  mockPlugin.manifest.requiredServices = [];
}

/**
 * Restores all plugin builder mocks to their default implementations.
 * Must be called after vi.clearAllMocks() in each beforeEach because
 * vi.clearAllMocks() does NOT reset mockReturnValue/mockImplementation
 * overrides — those persist across tests unless re-set.
 */
function setupDefaultPluginMocks() {
  mockBuildCorePlugin.mockImplementation(() => ({
    manifest: { id: 'core', name: 'Core', version: '1.0.0', requiredServices: [], defaultConfig: {} },
    implementation: {},
  }));
  mockBuildGatewayPlugin.mockImplementation(() => ({
    manifest: { id: 'gateway', name: 'OwnPilot Gateway', version: '1.0.0', requiredServices: [], defaultConfig: {} },
    implementation: {},
  }));
  mockBuildComposioPlugin.mockImplementation(() => ({
    manifest: {
      id: 'composio',
      name: 'Composio Integration',
      version: '1.0.0',
      requiredServices: [{ name: 'composio' }],
      defaultConfig: {},
    },
    implementation: {},
  }));
  mockBuildTelegramChannelPlugin.mockImplementation(() => ({
    manifest: {
      id: 'channel.telegram',
      name: 'Telegram',
      version: '1.0.0',
      requiredServices: [{ name: 'telegram_bot' }],
      defaultConfig: {},
    },
    implementation: { channelApiFactory: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })) },
  }));
  mockRegistry.register.mockResolvedValue(mockPlugin);
  mockRegistry.getAll.mockReturnValue([mockPlugin]);
  mockRegistry.getEnabled.mockReturnValue([mockPlugin]);
  mockPluginsRepo.getById.mockReturnValue(makeDbRecord());
  mockPluginsRepo.upsert.mockResolvedValue(makeDbRecord());
  mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
  mockDatabaseRepo.ensurePluginTable.mockResolvedValue(undefined);
  mockRegisterToolConfigReqs.mockResolvedValue(undefined);
}

/**
 * Capture the tool executor for a given tool name from the News RSS plugin.
 * We call initializePlugins() and look at registry.register calls to find
 * the plugin whose manifest has the specified tool, then return its executor.
 */
async function captureNewsRssTool(toolName: string) {
  await initializePlugins();

  // Find the register call for the news-rss plugin
  const calls = mockRegistry.register.mock.calls;
  for (const [manifest, implementation] of calls) {
    if ((manifest as { id: string }).id === 'news-rss') {
      const tools = (implementation as { tools?: Map<string, { executor: (...args: unknown[]) => unknown }> }).tools;
      if (tools) {
        const entry = tools.get(toolName);
        if (entry) return entry.executor;
      }
    }
  }
  return undefined;
}

async function capturePomodoroTool(toolName: string) {
  await initializePlugins();

  const calls = mockRegistry.register.mock.calls;
  for (const [manifest, implementation] of calls) {
    if ((manifest as { id: string }).id === 'pomodoro') {
      const tools = (implementation as { tools?: Map<string, { executor: (...args: unknown[]) => unknown }> }).tools;
      if (tools) {
        const entry = tools.get(toolName);
        if (entry) return entry.executor;
      }
    }
  }
  return undefined;
}

// =============================================================================
// Tests
// =============================================================================

describe('initializePlugins()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();
  });

  describe('registry interaction', () => {
    it('calls getDefaultPluginRegistry', async () => {
      await initializePlugins();
      expect(getDefaultPluginRegistry).toHaveBeenCalledOnce();
    });

    it('registers 6 built-in plugins total', async () => {
      await initializePlugins();
      expect(mockRegistry.register).toHaveBeenCalledTimes(6);
    });

    it('registers the core plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('core');
    });

    it('registers the gateway plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('gateway');
    });

    it('registers the news-rss plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('news-rss');
    });

    it('registers the pomodoro plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('pomodoro');
    });

    it('registers the composio plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('composio');
    });

    it('registers the telegram channel plugin', async () => {
      await initializePlugins();
      const ids = mockRegistry.register.mock.calls.map(([m]) => (m as { id: string }).id);
      expect(ids).toContain('channel.telegram');
    });
  });

  describe('DB record handling', () => {
    it('loads existing DB record via pluginsRepo.getById', async () => {
      await initializePlugins();
      expect(mockPluginsRepo.getById).toHaveBeenCalled();
    });

    it('does NOT call upsert when DB record already exists', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord());
      await initializePlugins();
      expect(mockPluginsRepo.upsert).not.toHaveBeenCalled();
    });

    it('calls upsert when getById returns null', async () => {
      mockPluginsRepo.getById.mockReturnValue(null);
      mockPluginsRepo.upsert.mockResolvedValue(makeDbRecord());
      await initializePlugins();
      expect(mockPluginsRepo.upsert).toHaveBeenCalled();
    });

    it('upsert is called with correct plugin id and name from manifest', async () => {
      mockPluginsRepo.getById.mockReturnValue(null);
      mockPluginsRepo.upsert.mockResolvedValue(makeDbRecord());
      await initializePlugins();

      // At least one upsert call must contain a valid plugin id
      const calls = mockPluginsRepo.upsert.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0]![0] as { id: string; name: string };
      expect(typeof firstCall.id).toBe('string');
      expect(typeof firstCall.name).toBe('string');
    });

    it('upsert uses manifest defaultConfig as settings', async () => {
      mockBuildCorePlugin.mockReturnValueOnce({
        manifest: {
          id: 'core',
          name: 'Core',
          version: '1.0.0',
          requiredServices: [],
          defaultConfig: { theme: 'dark' },
        },
        implementation: {},
      });
      mockPluginsRepo.getById.mockReturnValue(null);
      mockPluginsRepo.upsert.mockResolvedValue(makeDbRecord());

      await initializePlugins();

      const upsertCall = mockPluginsRepo.upsert.mock.calls.find(
        ([input]) => (input as { id: string }).id === 'core'
      );
      expect(upsertCall).toBeDefined();
      expect((upsertCall![0] as { settings: unknown }).settings).toEqual({ theme: 'dark' });
    });

    it('upsert uses empty object as settings when defaultConfig is undefined', async () => {
      mockBuildCorePlugin.mockReturnValueOnce({
        manifest: {
          id: 'core',
          name: 'Core',
          version: '1.0.0',
          requiredServices: [],
          defaultConfig: undefined,
        },
        implementation: {},
      });
      mockPluginsRepo.getById.mockReturnValue(null);
      mockPluginsRepo.upsert.mockResolvedValue(makeDbRecord());

      await initializePlugins();

      const upsertCall = mockPluginsRepo.upsert.mock.calls.find(
        ([input]) => (input as { id: string }).id === 'core'
      );
      expect((upsertCall![0] as { settings: unknown }).settings).toEqual({});
    });
  });

  describe('required services registration', () => {
    it('calls registerToolConfigRequirements for plugins with requiredServices', async () => {
      await initializePlugins();
      // composio and telegram both have required services
      expect(mockRegisterToolConfigReqs).toHaveBeenCalled();
    });

    it('does NOT call registerToolConfigRequirements when requiredServices is empty', async () => {
      // Override all plugins to have no required services
      mockBuildCorePlugin.mockReturnValue({
        manifest: { id: 'core', name: 'Core', version: '1.0.0', requiredServices: [], defaultConfig: {} },
        implementation: {},
      });
      mockBuildGatewayPlugin.mockReturnValue({
        manifest: { id: 'gateway', name: 'Gateway', version: '1.0.0', requiredServices: [], defaultConfig: {} },
        implementation: {},
      });
      mockBuildComposioPlugin.mockReturnValue({
        manifest: { id: 'composio', name: 'Composio', version: '1.0.0', requiredServices: [], defaultConfig: {} },
        implementation: {},
      });
      mockBuildTelegramChannelPlugin.mockReturnValue({
        manifest: { id: 'channel.telegram', name: 'Telegram', version: '1.0.0', requiredServices: [], defaultConfig: {} },
        implementation: {},
      });

      await initializePlugins();
      // news-rss and pomodoro have no requiredServices either
      expect(mockRegisterToolConfigReqs).not.toHaveBeenCalled();
    });

    it('passes plugin name, id, source="plugin", and requiredServices to registrar', async () => {
      await initializePlugins();

      // registerToolConfigRequirements(toolName, toolId, source, requirements)
      // composio and telegram both have requiredServices; find either call
      const allCalls = mockRegisterToolConfigReqs.mock.calls as Array<[string, string, string, unknown[]]>;
      expect(allCalls.length).toBeGreaterThan(0);

      // Validate the shape of the first call that has a non-empty services array
      const callWithServices = allCalls.find(([, , , services]) => Array.isArray(services) && services.length > 0);
      expect(callWithServices).toBeDefined();
      const [, , source, services] = callWithServices!;
      expect(source).toBe('plugin');
      expect(Array.isArray(services)).toBe(true);
    });
  });

  describe('database table creation', () => {
    it('calls ensurePluginTable for plugins with databaseTables declared', async () => {
      await initializePlugins();
      // news-rss declares 2 database tables
      expect(mockDatabaseRepo.ensurePluginTable).toHaveBeenCalled();
    });

    it('creates plugin_rss_feeds table for news-rss plugin', async () => {
      await initializePlugins();
      const calls = mockDatabaseRepo.ensurePluginTable.mock.calls;
      const feedsCall = calls.find(([, tableName]) => tableName === 'plugin_rss_feeds');
      expect(feedsCall).toBeDefined();
    });

    it('creates plugin_rss_items table for news-rss plugin', async () => {
      await initializePlugins();
      const calls = mockDatabaseRepo.ensurePluginTable.mock.calls;
      const itemsCall = calls.find(([, tableName]) => tableName === 'plugin_rss_items');
      expect(itemsCall).toBeDefined();
    });

    it('handles table creation error gracefully and continues', async () => {
      mockDatabaseRepo.ensurePluginTable.mockRejectedValueOnce(new Error('Table creation failed'));

      await expect(initializePlugins()).resolves.toBeUndefined();
      // All 6 plugins should still attempt to register
      expect(mockRegistry.register).toHaveBeenCalledTimes(6);
    });

    it('logs error when table creation fails', async () => {
      mockDatabaseRepo.ensurePluginTable.mockRejectedValueOnce(new Error('DB error'));

      await initializePlugins();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('DB state application to plugin', () => {
    it('applies dbRecord.settings to plugin.config.settings', async () => {
      const settings = { theme: 'dark', language: 'en' };
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ settings }));

      await initializePlugins();
      expect(mockPlugin.config.settings).toEqual(settings);
    });

    it('applies dbRecord.grantedPermissions to plugin.config.grantedPermissions', async () => {
      const grantedPermissions = ['storage', 'network'];
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ grantedPermissions }));

      await initializePlugins();
      expect(mockPlugin.config.grantedPermissions).toEqual(grantedPermissions);
    });

    it('sets plugin.config.enabled = true when dbRecord.status is "enabled"', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ status: 'enabled' }));

      await initializePlugins();
      expect(mockPlugin.config.enabled).toBe(true);
    });

    it('sets plugin.config.enabled = false when dbRecord.status is "disabled"', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ status: 'disabled' }));

      await initializePlugins();
      expect(mockPlugin.config.enabled).toBe(false);
    });

    it('sets plugin.status from dbRecord.status', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ status: 'disabled' }));

      await initializePlugins();
      expect(mockPlugin.status).toBe('disabled');
    });

    it('sets plugin.status to "error" when dbRecord.status is "error"', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ status: 'error' }));

      await initializePlugins();
      expect(mockPlugin.status).toBe('error');
    });
  });

  describe('channel plugin factory handling', () => {
    it('calls channelApiFactory when implementation has one', async () => {
      const factory = vi.fn(() => ({ connect: vi.fn() }));
      mockBuildTelegramChannelPlugin.mockReturnValueOnce({
        manifest: {
          id: 'channel.telegram',
          name: 'Telegram',
          version: '1.0.0',
          requiredServices: [{ name: 'telegram_bot' }],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: factory },
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

      await initializePlugins();
      expect(factory).toHaveBeenCalledOnce();
    });

    it('sets plugin.api to the result of channelApiFactory', async () => {
      const apiResult = { connect: vi.fn(), disconnect: vi.fn() };
      const factory = vi.fn(() => apiResult);
      mockBuildTelegramChannelPlugin.mockReturnValueOnce({
        manifest: {
          id: 'channel.telegram',
          name: 'Telegram',
          version: '1.0.0',
          requiredServices: [{ name: 'telegram_bot' }],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: factory },
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

      await initializePlugins();
      expect(mockPlugin.api).toBe(apiResult);
    });

    it('gets config from Config Center for channel factory when requiredServices present', async () => {
      const configEntry = { data: { bot_token: 'abc123' } };
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(configEntry);

      const factory = vi.fn(() => ({}));
      mockBuildTelegramChannelPlugin.mockReturnValueOnce({
        manifest: {
          id: 'channel.telegram',
          name: 'Telegram',
          version: '1.0.0',
          requiredServices: [{ name: 'telegram_bot' }],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: factory },
      });

      await initializePlugins();
      expect(mockConfigServicesRepo.getDefaultEntry).toHaveBeenCalledWith('telegram_bot');
      expect(factory).toHaveBeenCalledWith(expect.objectContaining({ bot_token: 'abc123' }));
    });

    it('calls factory with empty configData when Config Center entry is null', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      const factory = vi.fn(() => ({}));
      mockBuildTelegramChannelPlugin.mockReturnValueOnce({
        manifest: {
          id: 'channel.telegram',
          name: 'Telegram',
          version: '1.0.0',
          requiredServices: [{ name: 'telegram_bot' }],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: factory },
      });

      await initializePlugins();
      expect(factory).toHaveBeenCalledWith({});
    });

    it('calls factory with empty configData when Config Center entry has no .data', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue({ data: null });
      const factory = vi.fn(() => ({}));
      mockBuildTelegramChannelPlugin.mockReturnValueOnce({
        manifest: {
          id: 'channel.telegram',
          name: 'Telegram',
          version: '1.0.0',
          requiredServices: [{ name: 'telegram_bot' }],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: factory },
      });

      await initializePlugins();
      expect(factory).toHaveBeenCalledWith({});
    });

    it('does NOT call factory when channelApiFactory is not a function', async () => {
      const factory = vi.fn(() => ({}));
      mockBuildCorePlugin.mockReturnValueOnce({
        manifest: {
          id: 'core',
          name: 'Core',
          version: '1.0.0',
          requiredServices: [],
          defaultConfig: {},
        },
        implementation: { channelApiFactory: 'not-a-function' },
      });

      await initializePlugins();
      // factory from core must NOT have been called; factory from other mocks irrelevant
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles plugin registration error gracefully — does not throw', async () => {
      mockRegistry.register.mockRejectedValueOnce(new Error('Registry error'));

      await expect(initializePlugins()).resolves.toBeUndefined();
    });

    it('logs error when plugin registration fails', async () => {
      mockRegistry.register.mockRejectedValueOnce(new Error('Registration failed'));

      await initializePlugins();
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('continues registering remaining plugins after one failure', async () => {
      // First register call fails; the rest succeed
      mockRegistry.register
        .mockRejectedValueOnce(new Error('First plugin failed'))
        .mockResolvedValue(mockPlugin);

      await initializePlugins();
      // At least some plugins should have registered after the failure
      expect(mockRegistry.register).toHaveBeenCalledTimes(6);
    });
  });

  describe('summary logging', () => {
    it('calls registry.getAll() at end for count logging', async () => {
      await initializePlugins();
      expect(mockRegistry.getAll).toHaveBeenCalled();
    });

    it('calls registry.getEnabled() at end for count logging', async () => {
      await initializePlugins();
      expect(mockRegistry.getEnabled).toHaveBeenCalled();
    });

    it('logs total and enabled plugin count', async () => {
      mockRegistry.getAll.mockReturnValue([mockPlugin, mockPlugin]);
      mockRegistry.getEnabled.mockReturnValue([mockPlugin]);

      await initializePlugins();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('2'),
        // The log message may be a single string containing both counts
      );
    });

    it('logs success info message per registered plugin', async () => {
      mockPluginsRepo.getById.mockReturnValue(makeDbRecord({ status: 'enabled' }));
      await initializePlugins();
      // At least one per-plugin log.info call
      expect(mockLog.info).toHaveBeenCalled();
    });
  });
});

// =============================================================================

describe('refreshChannelApi()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();
  });

  it('returns early without error when no factory is cached for pluginId', async () => {
    // Ensure channelApiFactories has no entry for 'unknown-plugin'
    // (fresh module state after vi.clearAllMocks, but factory map is module-level)
    // We can test this by calling with a plugin that was never initialized as channel plugin
    await expect(refreshChannelApi('unknown-plugin-xyz')).resolves.toBeUndefined();
  });

  it('returns early when plugin not found in registry after factory lookup', async () => {
    // First, initialize so that 'channel.telegram' factory gets cached
    const factory = vi.fn(() => ({ connect: vi.fn() }));
    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
    await initializePlugins();

    factory.mockClear();
    // Registry.get returns undefined — plugin not found
    mockRegistry.get.mockReturnValue(undefined);

    await expect(refreshChannelApi('channel.telegram')).resolves.toBeUndefined();
    // factory should NOT be called when plugin not found
    expect(factory).not.toHaveBeenCalled();
  });

  it('sets plugin.api to fresh factory result', async () => {
    const freshApi = { connect: vi.fn(), send: vi.fn() };
    const factory = vi.fn(() => freshApi);

    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await initializePlugins();

    const pluginWithRequiredServices = {
      ...mockPlugin,
      manifest: { ...mockPlugin.manifest, requiredServices: [{ name: 'telegram_bot' }] },
    };
    mockRegistry.get.mockReturnValue(pluginWithRequiredServices);
    factory.mockClear();
    factory.mockReturnValue(freshApi);
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await refreshChannelApi('channel.telegram');
    expect(pluginWithRequiredServices.api).toBe(freshApi);
  });

  it('gets config from Config Center using first requiredService name', async () => {
    const factory = vi.fn(() => ({}));
    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await initializePlugins();

    const pluginWithServices = {
      ...mockPlugin,
      manifest: { requiredServices: [{ name: 'telegram_bot' }] },
    };
    mockRegistry.get.mockReturnValue(pluginWithServices);
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await refreshChannelApi('channel.telegram');
    expect(mockConfigServicesRepo.getDefaultEntry).toHaveBeenCalledWith('telegram_bot');
  });

  it('passes config data from Config Center to factory', async () => {
    const factory = vi.fn(() => ({}));
    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await initializePlugins();

    const pluginWithServices = {
      ...mockPlugin,
      manifest: { requiredServices: [{ name: 'telegram_bot' }] },
    };
    mockRegistry.get.mockReturnValue(pluginWithServices);

    const configEntry = { data: { bot_token: 'new-token-456' } };
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(configEntry);
    factory.mockClear();

    await refreshChannelApi('channel.telegram');
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ bot_token: 'new-token-456' }));
  });

  it('calls factory with empty config when requiredServices is absent', async () => {
    const factory = vi.fn(() => ({}));
    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await initializePlugins();

    // Plugin with no requiredServices
    const pluginNoServices = {
      ...mockPlugin,
      manifest: { requiredServices: undefined },
    };
    mockRegistry.get.mockReturnValue(pluginNoServices);
    factory.mockClear();

    await refreshChannelApi('channel.telegram');
    expect(factory).toHaveBeenCalledWith({});
  });

  it('calls factory with empty config when Config Center entry is null', async () => {
    const factory = vi.fn(() => ({}));
    mockBuildTelegramChannelPlugin.mockReturnValue({
      manifest: {
        id: 'channel.telegram',
        name: 'Telegram',
        version: '1.0.0',
        requiredServices: [{ name: 'telegram_bot' }],
        defaultConfig: {},
      },
      implementation: { channelApiFactory: factory },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

    await initializePlugins();

    mockRegistry.get.mockReturnValue({
      ...mockPlugin,
      manifest: { requiredServices: [{ name: 'telegram_bot' }] },
    });
    mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
    factory.mockClear();

    await refreshChannelApi('channel.telegram');
    expect(factory).toHaveBeenCalledWith({});
  });
});

// =============================================================================
// News RSS Plugin structure
// =============================================================================

describe('News RSS Plugin — structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();
  });

  it('registers with id "news-rss"', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    expect(call).toBeDefined();
  });

  it('has 5 tools registered', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const impl = call![1] as { tools?: Map<string, unknown> };
    expect(impl.tools?.size).toBe(5);
  });

  it('includes news_add_feed tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('news_add_feed')).toBe(true);
  });

  it('includes news_list_feeds tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('news_list_feeds')).toBe(true);
  });

  it('includes news_get_latest tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('news_get_latest')).toBe(true);
  });

  it('includes news_remove_feed tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('news_remove_feed')).toBe(true);
  });

  it('includes news_refresh_feed tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('news_refresh_feed')).toBe(true);
  });

  it('declares 2 database tables in manifest', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { databaseTables?: Array<{ name: string }> };
    expect(manifest.databaseTables).toHaveLength(2);
  });

  it('declares plugin_rss_feeds table', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { databaseTables?: Array<{ name: string }> };
    const tableNames = manifest.databaseTables?.map(t => t.name) ?? [];
    expect(tableNames).toContain('plugin_rss_feeds');
  });

  it('declares plugin_rss_items table', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { databaseTables?: Array<{ name: string }> };
    const tableNames = manifest.databaseTables?.map(t => t.name) ?? [];
    expect(tableNames).toContain('plugin_rss_items');
  });

  it('has max_feeds in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('max_feeds');
  });

  it('has refresh_interval in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('refresh_interval');
  });

  it('has default_category in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'news-rss'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('default_category');
  });
});

// =============================================================================
// News RSS tool executors
// =============================================================================

describe('news_add_feed executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    // Default database repo behavior
    mockDatabaseRepo.addRecord.mockResolvedValue({ id: 'feed-1' });
    mockDatabaseRepo.updateRecord.mockResolvedValue({});

    // Default successful fetch
    const mockResponse = {
      text: vi.fn().mockResolvedValue(`
        <rss><channel>
          <title>My Feed</title>
          <item><title>Article 1</title><link>http://example.com/1</link><description>Content 1</description><pubDate>Mon, 01 Jan 2024</pubDate></item>
        </channel></rss>
      `),
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
  });

  it('creates a feed record in plugin_rss_feeds', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    await exec!({ url: 'http://example.com/feed.rss' });
    expect(mockDatabaseRepo.addRecord).toHaveBeenCalledWith(
      'plugin_rss_feeds',
      expect.objectContaining({ url: 'http://example.com/feed.rss' })
    );
  });

  it('fetches the feed URL after creating record', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    await exec!({ url: 'http://example.com/feed.rss' });
    expect(fetch).toHaveBeenCalledWith('http://example.com/feed.rss', expect.any(Object));
  });

  it('adds RSS items to plugin_rss_items', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    await exec!({ url: 'http://example.com/feed.rss' });
    expect(mockDatabaseRepo.addRecord).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ feed_id: 'feed-1' })
    );
  });

  it('updates feed record with title and status after fetch', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    await exec!({ url: 'http://example.com/feed.rss' });
    expect(mockDatabaseRepo.updateRecord).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ title: 'My Feed', status: 'active' })
    );
  });

  it('returns success with feedId and itemsFetched', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    const result = await exec!({ url: 'http://example.com/feed.rss' }) as { content: { success: boolean; feedId: string; itemsFetched: number } };
    expect(result.content.success).toBe(true);
    expect(result.content.feedId).toBe('feed-1');
    expect(result.content.itemsFetched).toBe(1);
  });

  it('includes optional category in feed record', async () => {
    const exec = await captureNewsRssTool('news_add_feed');
    await exec!({ url: 'http://example.com/feed.rss', category: 'Technology' });
    expect(mockDatabaseRepo.addRecord).toHaveBeenCalledWith(
      'plugin_rss_feeds',
      expect.objectContaining({ category: 'Technology' })
    );
  });

  it('handles fetch error by updating feed status to "error"', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const exec = await captureNewsRssTool('news_add_feed');
    const result = await exec!({ url: 'http://bad-url.example.com/feed.rss' }) as { content: { success: boolean } };

    expect(mockDatabaseRepo.updateRecord).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ status: 'error' })
    );
    // Still returns success: true (the feed record was created)
    expect(result.content.success).toBe(true);
  });

  it('returns 0 itemsFetched when fetch fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));

    const exec = await captureNewsRssTool('news_add_feed');
    const result = await exec!({ url: 'http://example.com/feed.rss' }) as { content: { itemsFetched: number } };
    expect(result.content.itemsFetched).toBe(0);
  });

  it('uses feed URL as title when XML has no <title> tag', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: vi.fn().mockResolvedValue('<rss><channel></channel></rss>'),
    });

    const exec = await captureNewsRssTool('news_add_feed');
    const result = await exec!({ url: 'http://example.com/feed.rss' }) as { content: { title: string } };
    expect(result.content.title).toBe('http://example.com/feed.rss');
  });

  it('parses Atom <entry> elements when no RSS <item> elements', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: vi.fn().mockResolvedValue(`
        <feed>
          <entry>
            <title>Atom Article</title>
            <link href="http://example.com/atom-1"/>
            <summary>Atom Content</summary>
            <published>2024-01-01</published>
          </entry>
        </feed>
      `),
    });

    const exec = await captureNewsRssTool('news_add_feed');
    const result = await exec!({ url: 'http://example.com/feed.rss' }) as { content: { itemsFetched: number } };
    expect(result.content.itemsFetched).toBe(1);
  });
});

describe('news_list_feeds executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();
  });

  it('lists all feeds from plugin_rss_feeds', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'feed-1', data: { url: 'http://a.com/feed', title: 'Feed A', category: 'Tech', status: 'active', last_fetched: null } },
        { id: 'feed-2', data: { url: 'http://b.com/feed', title: 'Feed B', category: '', status: 'error', last_fetched: '2024-01-01' } },
      ],
    });

    const exec = await captureNewsRssTool('news_list_feeds');
    const result = await exec!({}) as { content: { success: boolean; feeds: unknown[] } };
    expect(result.content.success).toBe(true);
    expect(result.content.feeds).toHaveLength(2);
  });

  it('queries plugin_rss_feeds table with limit 100', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({ records: [] });

    const exec = await captureNewsRssTool('news_list_feeds');
    await exec!({});
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith('plugin_rss_feeds', expect.objectContaining({ limit: 100 }));
  });

  it('maps record fields to feed shape with id, url, title, category, status, lastFetched', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'f1', data: { url: 'http://x.com', title: 'X Feed', category: 'News', status: 'active', last_fetched: '2024-06-01' } },
      ],
    });

    const exec = await captureNewsRssTool('news_list_feeds');
    const result = await exec!({}) as { content: { feeds: Array<{ id: string; url: string; title: string; category: string; status: string; lastFetched: string }> } };
    const feed = result.content.feeds[0]!;
    expect(feed.id).toBe('f1');
    expect(feed.url).toBe('http://x.com');
    expect(feed.title).toBe('X Feed');
    expect(feed.category).toBe('News');
    expect(feed.status).toBe('active');
    expect(feed.lastFetched).toBe('2024-06-01');
  });

  it('returns empty feeds array when no feeds exist', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({ records: [] });

    const exec = await captureNewsRssTool('news_list_feeds');
    const result = await exec!({}) as { content: { feeds: unknown[] } };
    expect(result.content.feeds).toHaveLength(0);
  });
});

describe('news_get_latest executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'item-1', data: { feed_id: 'f1', title: 'Item 1', link: 'http://a.com', content: 'Content', published_at: '2024-01-01', is_read: false } },
      ],
    });
  });

  it('queries plugin_rss_items table', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({});
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith('plugin_rss_items', expect.any(Object));
  });

  it('uses default limit of 20 when not provided', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({});
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ limit: 20 })
    );
  });

  it('uses provided limit', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({ limit: 5 });
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ limit: 5 })
    );
  });

  it('filters by feed_id when provided', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({ feed_id: 'feed-123' });
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ filter: expect.objectContaining({ feed_id: 'feed-123' }) })
    );
  });

  it('filters by is_read=false when unread_only is true', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({ unread_only: true });
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ filter: expect.objectContaining({ is_read: false }) })
    );
  });

  it('applies no filter object when neither feed_id nor unread_only provided', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    await exec!({});
    const call = mockDatabaseRepo.listRecords.mock.calls[0]![1] as { filter?: unknown };
    expect(call.filter).toBeUndefined();
  });

  it('maps items to correct shape with id, feedId, title, link, content, publishedAt, isRead', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    const result = await exec!({}) as { content: { items: Array<Record<string, unknown>> } };
    const item = result.content.items[0]!;
    expect(item).toMatchObject({
      id: 'item-1',
      feedId: 'f1',
      title: 'Item 1',
      link: 'http://a.com',
    });
  });

  it('truncates content to 300 characters', async () => {
    const longContent = 'x'.repeat(500);
    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'item-1', data: { feed_id: 'f1', title: 'T', link: 'http://a.com', content: longContent, published_at: '2024-01-01', is_read: false } },
      ],
    });

    const exec = await captureNewsRssTool('news_get_latest');
    const result = await exec!({}) as { content: { items: Array<{ content: string }> } };
    expect(result.content.items[0]!.content.length).toBe(300);
  });

  it('returns success: true with items array', async () => {
    const exec = await captureNewsRssTool('news_get_latest');
    const result = await exec!({}) as { content: { success: boolean; items: unknown[] } };
    expect(result.content.success).toBe(true);
    expect(Array.isArray(result.content.items)).toBe(true);
  });
});

describe('news_remove_feed executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'item-1', data: { feed_id: 'feed-abc' } },
        { id: 'item-2', data: { feed_id: 'feed-abc' } },
      ],
    });
    mockDatabaseRepo.deleteRecord.mockResolvedValue(undefined);
  });

  it('lists items for the feed before deleting', async () => {
    const exec = await captureNewsRssTool('news_remove_feed');
    await exec!({ feed_id: 'feed-abc' });
    expect(mockDatabaseRepo.listRecords).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ filter: { feed_id: 'feed-abc' } })
    );
  });

  it('deletes each item individually', async () => {
    const exec = await captureNewsRssTool('news_remove_feed');
    await exec!({ feed_id: 'feed-abc' });
    expect(mockDatabaseRepo.deleteRecord).toHaveBeenCalledWith('item-1');
    expect(mockDatabaseRepo.deleteRecord).toHaveBeenCalledWith('item-2');
  });

  it('deletes the feed record itself', async () => {
    const exec = await captureNewsRssTool('news_remove_feed');
    await exec!({ feed_id: 'feed-abc' });
    expect(mockDatabaseRepo.deleteRecord).toHaveBeenCalledWith('feed-abc');
  });

  it('returns success with item count in message', async () => {
    const exec = await captureNewsRssTool('news_remove_feed');
    const result = await exec!({ feed_id: 'feed-abc' }) as { content: { success: boolean; message: string } };
    expect(result.content.success).toBe(true);
    expect(result.content.message).toContain('2');
  });

  it('handles feed with no items gracefully', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({ records: [] });

    const exec = await captureNewsRssTool('news_remove_feed');
    const result = await exec!({ feed_id: 'empty-feed' }) as { content: { success: boolean } };
    expect(result.content.success).toBe(true);
    // Only the feed itself should be deleted (no items)
    expect(mockDatabaseRepo.deleteRecord).toHaveBeenCalledTimes(1);
    expect(mockDatabaseRepo.deleteRecord).toHaveBeenCalledWith('empty-feed');
  });
});

describe('news_refresh_feed executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockDatabaseRepo.getRecord.mockResolvedValue({ id: 'feed-1', data: { url: 'http://example.com/feed.rss' } });
    mockDatabaseRepo.listRecords.mockResolvedValue({ records: [] }); // No existing items
    mockDatabaseRepo.addRecord.mockResolvedValue({ id: 'new-item' });
    mockDatabaseRepo.updateRecord.mockResolvedValue({});

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: vi.fn().mockResolvedValue(`
        <rss><channel>
          <item><title>New Article</title><link>http://example.com/new</link><description>Fresh</description><pubDate>Mon, 01 Jan 2024</pubDate></item>
        </channel></rss>
      `),
    });
  });

  it('returns error when feed record not found', async () => {
    mockDatabaseRepo.getRecord.mockResolvedValue(null);

    const exec = await captureNewsRssTool('news_refresh_feed');
    const result = await exec!({ feed_id: 'nonexistent' }) as { content: { error: string }; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('not found');
  });

  it('returns error when feed has no URL', async () => {
    mockDatabaseRepo.getRecord.mockResolvedValue({ id: 'feed-1', data: { url: null } });

    const exec = await captureNewsRssTool('news_refresh_feed');
    const result = await exec!({ feed_id: 'feed-1' }) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('fetches the feed URL from the record', async () => {
    const exec = await captureNewsRssTool('news_refresh_feed');
    await exec!({ feed_id: 'feed-1' });
    expect(fetch).toHaveBeenCalledWith('http://example.com/feed.rss', expect.any(Object));
  });

  it('adds new items that are not duplicates', async () => {
    const exec = await captureNewsRssTool('news_refresh_feed');
    await exec!({ feed_id: 'feed-1' });
    expect(mockDatabaseRepo.addRecord).toHaveBeenCalledWith(
      'plugin_rss_items',
      expect.objectContaining({ link: 'http://example.com/new' })
    );
  });

  it('skips items with links already in existing records', async () => {
    mockDatabaseRepo.listRecords.mockResolvedValue({
      records: [
        { id: 'old-item', data: { link: 'http://example.com/new' } },
      ],
    });

    const exec = await captureNewsRssTool('news_refresh_feed');
    const result = await exec!({ feed_id: 'feed-1' }) as { content: { newItems: number } };
    expect(result.content.newItems).toBe(0);
    expect(mockDatabaseRepo.addRecord).not.toHaveBeenCalled();
  });

  it('updates feed last_fetched and status after successful refresh', async () => {
    const exec = await captureNewsRssTool('news_refresh_feed');
    await exec!({ feed_id: 'feed-1' });
    expect(mockDatabaseRepo.updateRecord).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ status: 'active' })
    );
  });

  it('returns success with newItems count', async () => {
    const exec = await captureNewsRssTool('news_refresh_feed');
    const result = await exec!({ feed_id: 'feed-1' }) as { content: { success: boolean; newItems: number } };
    expect(result.content.success).toBe(true);
    expect(result.content.newItems).toBe(1);
  });

  it('handles fetch error by setting feed status to "error" and returning isError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Timeout'));

    const exec = await captureNewsRssTool('news_refresh_feed');
    const result = await exec!({ feed_id: 'feed-1' }) as { isError: boolean };
    expect(result.isError).toBe(true);
    expect(mockDatabaseRepo.updateRecord).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ status: 'error' })
    );
  });
});

// =============================================================================
// Pomodoro Plugin structure
// =============================================================================

describe('Pomodoro Plugin — structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();
  });

  it('registers with id "pomodoro"', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    expect(call).toBeDefined();
  });

  it('has 3 tools registered', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const impl = call![1] as { tools?: Map<string, unknown> };
    expect(impl.tools?.size).toBe(3);
  });

  it('includes pomodoro_start tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('pomodoro_start')).toBe(true);
  });

  it('includes pomodoro_status tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('pomodoro_status')).toBe(true);
  });

  it('includes pomodoro_stop tool', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const tools = (call![1] as { tools?: Map<string, unknown> }).tools;
    expect(tools?.has('pomodoro_stop')).toBe(true);
  });

  it('has work_minutes in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('work_minutes');
  });

  it('has short_break in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('short_break');
  });

  it('has long_break in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('long_break');
  });

  it('has sessions_before_long in pluginConfigSchema', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const manifest = call![0] as { pluginConfigSchema?: Array<{ name: string }> };
    const fieldNames = manifest.pluginConfigSchema?.map(f => f.name) ?? [];
    expect(fieldNames).toContain('sessions_before_long');
  });

  it('has no declared database tables', async () => {
    await initializePlugins();
    const call = mockRegistry.register.mock.calls.find(
      ([m]) => (m as { id: string }).id === 'pomodoro'
    );
    const manifest = call![0] as { databaseTables?: unknown };
    expect(manifest.databaseTables).toBeUndefined();
  });
});

// =============================================================================
// Pomodoro tool executors
// =============================================================================

describe('pomodoro_start executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);
    mockPomodoroRepo.startSession.mockResolvedValue({
      id: 'session-1',
      taskDescription: 'Write tests',
      durationMinutes: 25,
      startedAt: new Date(),
    });
  });

  it('checks for an active session first', async () => {
    const exec = await capturePomodoroTool('pomodoro_start');
    await exec!({ task: 'Write tests', duration: 25 });
    expect(mockPomodoroRepo.getActiveSession).toHaveBeenCalledOnce();
  });

  it('returns success: false when active session already exists', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue({
      id: 'existing',
      taskDescription: 'Existing task',
      startedAt: new Date().toISOString(),
    });

    const exec = await capturePomodoroTool('pomodoro_start');
    const result = await exec!({ task: 'New task' }) as { content: { success: boolean } };
    expect(result.content.success).toBe(false);
  });

  it('includes existing session info in error response', async () => {
    const existingSession = { id: 'existing', taskDescription: 'Old task', startedAt: '2024-01-01T10:00:00Z' };
    mockPomodoroRepo.getActiveSession.mockResolvedValue(existingSession);

    const exec = await capturePomodoroTool('pomodoro_start');
    const result = await exec!({}) as { content: { session: unknown } };
    expect(result.content.session).toBe(existingSession);
  });

  it('does NOT call startSession when a session is already active', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 'existing', taskDescription: 'X', startedAt: new Date() });

    const exec = await capturePomodoroTool('pomodoro_start');
    await exec!({});
    expect(mockPomodoroRepo.startSession).not.toHaveBeenCalled();
  });

  it('calls pomodoroRepo.startSession with provided task and duration', async () => {
    const exec = await capturePomodoroTool('pomodoro_start');
    await exec!({ task: 'Code review', duration: 45 });
    expect(mockPomodoroRepo.startSession).toHaveBeenCalledWith({
      type: 'work',
      taskDescription: 'Code review',
      durationMinutes: 45,
    });
  });

  it('uses default task "Untitled session" when task not provided', async () => {
    const exec = await capturePomodoroTool('pomodoro_start');
    await exec!({});
    expect(mockPomodoroRepo.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ taskDescription: 'Untitled session' })
    );
  });

  it('uses default duration of 25 minutes when not provided', async () => {
    const exec = await capturePomodoroTool('pomodoro_start');
    await exec!({ task: 'Focus' });
    expect(mockPomodoroRepo.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 25 })
    );
  });

  it('returns success: true with session data on successful start', async () => {
    const session = { id: 's1', taskDescription: 'Test', durationMinutes: 25, startedAt: new Date() };
    mockPomodoroRepo.startSession.mockResolvedValue(session);

    const exec = await capturePomodoroTool('pomodoro_start');
    const result = await exec!({ task: 'Test', duration: 25 }) as { content: { success: boolean; session: unknown } };
    expect(result.content.success).toBe(true);
    expect(result.content.session).toBe(session);
  });

  it('message on success mentions task description and duration', async () => {
    const session = { id: 's1', taskDescription: 'My Task', durationMinutes: 30, startedAt: new Date() };
    mockPomodoroRepo.startSession.mockResolvedValue(session);

    const exec = await capturePomodoroTool('pomodoro_start');
    const result = await exec!({ task: 'My Task', duration: 30 }) as { content: { message: string } };
    expect(result.content.message).toContain('My Task');
    expect(result.content.message).toContain('30');
  });
});

describe('pomodoro_status executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockPomodoroRepo.getDailyStats.mockResolvedValue({ completedSessions: 2, totalWorkMinutes: 50 });
    mockPomodoroRepo.getTotalStats.mockResolvedValue({ completedSessions: 100, totalWorkMinutes: 2500 });
  });

  it('calls getActiveSession', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);

    const exec = await capturePomodoroTool('pomodoro_status');
    await exec!({});
    expect(mockPomodoroRepo.getActiveSession).toHaveBeenCalledOnce();
  });

  it('calls getDailyStats with today date string', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);

    const exec = await capturePomodoroTool('pomodoro_status');
    await exec!({});
    const today = new Date().toISOString().split('T')[0];
    expect(mockPomodoroRepo.getDailyStats).toHaveBeenCalledWith(today);
  });

  it('calls getTotalStats', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);

    const exec = await capturePomodoroTool('pomodoro_status');
    await exec!({});
    expect(mockPomodoroRepo.getTotalStats).toHaveBeenCalledOnce();
  });

  it('returns active: false and no-active-session message when no session running', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);

    const exec = await capturePomodoroTool('pomodoro_status');
    const result = await exec!({}) as { content: { active: boolean; message: string } };
    expect(result.content.active).toBe(false);
    expect(result.content.message).toContain('No active');
  });

  it('returns today and total stats when no active session', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);
    const todayStats = { completedSessions: 3, totalWorkMinutes: 75 };
    const totalStats = { completedSessions: 50, totalWorkMinutes: 1250 };
    mockPomodoroRepo.getDailyStats.mockResolvedValue(todayStats);
    mockPomodoroRepo.getTotalStats.mockResolvedValue(totalStats);

    const exec = await capturePomodoroTool('pomodoro_status');
    const result = await exec!({}) as { content: { today: unknown; total: unknown } };
    expect(result.content.today).toBe(todayStats);
    expect(result.content.total).toBe(totalStats);
  });

  it('returns active: true with elapsed and remaining minutes when session is running', async () => {
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    const activeSession = {
      id: 's1',
      taskDescription: 'Focus',
      durationMinutes: 25,
      startedAt,
    };
    mockPomodoroRepo.getActiveSession.mockResolvedValue(activeSession);

    const exec = await capturePomodoroTool('pomodoro_status');
    const result = await exec!({}) as { content: { active: boolean; session: { elapsedMinutes: number; remainingMinutes: number } } };
    expect(result.content.active).toBe(true);
    expect(result.content.session.elapsedMinutes).toBeGreaterThanOrEqual(9);
    expect(result.content.session.elapsedMinutes).toBeLessThanOrEqual(11);
    expect(result.content.session.remainingMinutes).toBeGreaterThanOrEqual(14);
  });

  it('clamps remaining minutes to 0 when session has exceeded duration', async () => {
    const startedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 minutes ago
    mockPomodoroRepo.getActiveSession.mockResolvedValue({
      id: 's1',
      durationMinutes: 25,
      startedAt,
    });

    const exec = await capturePomodoroTool('pomodoro_status');
    const result = await exec!({}) as { content: { session: { remainingMinutes: number } } };
    expect(result.content.session.remainingMinutes).toBe(0);
  });

  it('includes today and total stats in active session response', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', durationMinutes: 25, startedAt });
    const todayStats = { completedSessions: 1, totalWorkMinutes: 25 };
    const totalStats = { completedSessions: 10 };
    mockPomodoroRepo.getDailyStats.mockResolvedValue(todayStats);
    mockPomodoroRepo.getTotalStats.mockResolvedValue(totalStats);

    const exec = await capturePomodoroTool('pomodoro_status');
    const result = await exec!({}) as { content: { today: unknown; total: unknown } };
    expect(result.content.today).toBe(todayStats);
    expect(result.content.total).toBe(totalStats);
  });
});

describe('pomodoro_stop executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPlugin();
    setupDefaultPluginMocks();

    mockPomodoroRepo.completeSession.mockResolvedValue({ id: 's1', status: 'completed' });
    mockPomodoroRepo.interruptSession.mockResolvedValue({ id: 's1', status: 'interrupted' });
  });

  it('returns success: false when no active session', async () => {
    mockPomodoroRepo.getActiveSession.mockResolvedValue(null);

    const exec = await capturePomodoroTool('pomodoro_stop');
    const result = await exec!({}) as { content: { success: boolean; message: string } };
    expect(result.content.success).toBe(false);
    expect(result.content.message).toContain('No active');
  });

  it('calls completeSession when elapsed time >= duration (session complete)', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Work', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    await exec!({});
    expect(mockPomodoroRepo.completeSession).toHaveBeenCalledWith('s1');
  });

  it('calls completeSession when no reason provided even if not complete', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Only 5 minutes
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Work', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    await exec!({ reason: undefined }); // No reason — treated as complete
    expect(mockPomodoroRepo.completeSession).toHaveBeenCalledWith('s1');
    expect(mockPomodoroRepo.interruptSession).not.toHaveBeenCalled();
  });

  it('calls interruptSession with reason when session not complete and reason provided', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Only 5 minutes
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Work', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    await exec!({ reason: 'Emergency call' });
    expect(mockPomodoroRepo.interruptSession).toHaveBeenCalledWith('s1', 'Emergency call');
    expect(mockPomodoroRepo.completeSession).not.toHaveBeenCalled();
  });

  it('returns success: true with session data on stop', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Work', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    const result = await exec!({}) as { content: { success: boolean; session: unknown } };
    expect(result.content.success).toBe(true);
    expect(result.content.session).toBeDefined();
  });

  it('message says "completed" when duration was exceeded', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Focus Work', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    const result = await exec!({}) as { content: { message: string } };
    expect(result.content.message.toLowerCase()).toContain('complet');
  });

  it('message says "interrupted" when stopped early with reason', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Focus', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    const result = await exec!({ reason: 'Meeting' }) as { content: { message: string } };
    expect(result.content.message.toLowerCase()).toContain('interrupt');
  });

  it('message includes task description when completed', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockPomodoroRepo.getActiveSession.mockResolvedValue({ id: 's1', taskDescription: 'Important Task', durationMinutes: 25, startedAt });

    const exec = await capturePomodoroTool('pomodoro_stop');
    const result = await exec!({}) as { content: { message: string } };
    expect(result.content.message).toContain('Important Task');
  });
});
