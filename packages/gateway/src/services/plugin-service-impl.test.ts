/**
 * PluginServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginServiceImpl } from './plugin-service-impl.js';
import type { Plugin, PluginManifest, PluginRegistry } from '@ownpilot/core';

function createMockPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      capabilities: ['tools'],
      permissions: [],
      main: 'index.js',
      category: 'utilities',
    },
    status: 'enabled',
    config: {},
    tools: new Map(),
    handlers: [],
    lifecycle: {},
    ...overrides,
  } as Plugin;
}

function createMockRegistry(): PluginRegistry {
  const plugins = new Map<string, Plugin>();

  return {
    register: vi.fn(async (manifest: PluginManifest, impl: Partial<Plugin>) => {
      const plugin = createMockPlugin({
        manifest,
        ...impl,
      });
      plugins.set(manifest.id, plugin);
      return plugin;
    }),
    unregister: vi.fn(async (id: string) => {
      return plugins.delete(id);
    }),
    get: vi.fn((id: string) => plugins.get(id)),
    getAll: vi.fn(() => Array.from(plugins.values())),
    getEnabled: vi.fn(() => Array.from(plugins.values()).filter((p) => p.status === 'enabled')),
    enable: vi.fn(async (id: string) => {
      const p = plugins.get(id);
      if (p) {
        p.status = 'enabled';
        return true;
      }
      return false;
    }),
    disable: vi.fn(async (id: string) => {
      const p = plugins.get(id);
      if (p) {
        p.status = 'disabled';
        return true;
      }
      return false;
    }),
    getAllTools: vi.fn(() => []),
    getTool: vi.fn(() => undefined),
    routeMessage: vi.fn(),
    emitEvent: vi.fn(),
    onEvent: vi.fn(),
    createContext: vi.fn(),
    initialize: vi.fn(),
  } as unknown as PluginRegistry;
}

describe('PluginServiceImpl', () => {
  let service: PluginServiceImpl;
  let mockRegistry: PluginRegistry;

  beforeEach(() => {
    mockRegistry = createMockRegistry();
    service = new PluginServiceImpl(mockRegistry);
  });

  describe('register', () => {
    it('registers a plugin through the registry', async () => {
      const manifest: PluginManifest = {
        id: 'new-plugin',
        name: 'New Plugin',
        version: '1.0.0',
        description: 'test',
        capabilities: ['tools'],
        permissions: [],
        main: 'index.js',
      };

      const result = await service.register(manifest, {});
      expect(result.manifest.id).toBe('new-plugin');
      expect(mockRegistry.register).toHaveBeenCalledWith(manifest, {});
    });
  });

  describe('unregister', () => {
    it('unregisters a plugin', async () => {
      const manifest: PluginManifest = {
        id: 'to-remove',
        name: 'Remove Me',
        version: '1.0.0',
        description: 'test',
        capabilities: [],
        permissions: [],
        main: 'index.js',
      };
      await service.register(manifest, {});

      const result = await service.unregister('to-remove');
      expect(result).toBe(true);
    });

    it('returns false for unknown plugin', async () => {
      const result = await service.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('returns plugin by ID', async () => {
      const manifest: PluginManifest = {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'test',
        capabilities: [],
        permissions: [],
        main: 'index.js',
      };
      await service.register(manifest, {});

      const plugin = service.get('my-plugin');
      expect(plugin).toBeDefined();
      expect(plugin!.manifest.id).toBe('my-plugin');
    });

    it('returns undefined for unknown ID', () => {
      expect(service.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all plugins', async () => {
      await service.register(
        { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      await service.register(
        { id: 'p2', name: 'P2', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );

      expect(service.getAll()).toHaveLength(2);
    });
  });

  describe('getEnabled', () => {
    it('returns only enabled plugins', async () => {
      await service.register(
        { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      await service.register(
        { id: 'p2', name: 'P2', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      await service.disable('p2');

      const enabled = service.getEnabled();
      expect(enabled.every((p) => p.status === 'enabled')).toBe(true);
    });
  });

  describe('enable / disable', () => {
    it('enables a disabled plugin', async () => {
      await service.register(
        { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      await service.disable('p1');
      const result = await service.enable('p1');
      expect(result).toBe(true);
    });

    it('disables an enabled plugin', async () => {
      await service.register(
        { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      const result = await service.disable('p1');
      expect(result).toBe(true);
    });
  });

  describe('getAllTools', () => {
    it('delegates to registry.getAllTools', () => {
      const mockTool = {
        pluginId: 'p1',
        definition: { name: 'tool1', description: 'test', parameters: { type: 'object' as const, properties: {} } },
        executor: vi.fn(),
      };
      vi.mocked(mockRegistry.getAllTools).mockReturnValue([mockTool]);

      const tools = service.getAllTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].pluginId).toBe('p1');
      expect(tools[0].definition.name).toBe('tool1');
    });
  });

  describe('getTool', () => {
    it('returns tool entry with pluginId', () => {
      const plugin = createMockPlugin({ manifest: { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' } as PluginManifest });
      const def = { name: 'tool1', description: 'test', parameters: { type: 'object' as const, properties: {} } };
      const exec = vi.fn();

      vi.mocked(mockRegistry.getTool).mockReturnValue({ plugin, definition: def, executor: exec });

      const result = service.getTool('tool1');
      expect(result).toBeDefined();
      expect(result!.pluginId).toBe('p1');
      expect(result!.definition.name).toBe('tool1');
    });

    it('returns undefined for unknown tool', () => {
      expect(service.getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns lightweight PluginInfo DTOs', async () => {
      await service.register(
        { id: 'p1', name: 'Plugin One', version: '2.0.0', description: 'First', capabilities: ['tools'], permissions: [], main: 'index.js', category: 'utilities' },
        {},
      );

      const list = service.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        id: 'p1',
        name: 'Plugin One',
        version: '2.0.0',
        status: 'enabled',
        description: 'First',
        category: 'utilities',
        toolCount: 0,
      });
    });
  });

  describe('getCount', () => {
    it('returns total number of plugins', async () => {
      expect(service.getCount()).toBe(0);

      await service.register(
        { id: 'p1', name: 'P1', version: '1.0.0', description: '', capabilities: [], permissions: [], main: 'index.js' },
        {},
      );
      expect(service.getCount()).toBe(1);
    });
  });
});
