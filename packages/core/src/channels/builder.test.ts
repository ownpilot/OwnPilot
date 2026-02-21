import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelPluginAPI } from './types.js';
import type { ToolDefinition, ToolExecutor } from '../agent/types.js';

// ---------------------------------------------------------------------------
// Mock the heavy PluginBuilder parent (filesystem, event system, etc.)
// We replicate only the public surface used by ChannelPluginBuilder.
// ---------------------------------------------------------------------------
vi.mock('../plugins/index.js', () => {
  class MockPluginBuilder {
    _id = '';
    _name = '';
    _version = '';
    _description = '';
    _meta: Record<string, unknown> = {};
    _tools: Map<string, { definition: unknown; executor: unknown }> = new Map();
    _api: Record<string, unknown> = {};

    id(id: string) {
      this._id = id;
      return this;
    }
    name(name: string) {
      this._name = name;
      return this;
    }
    version(version: string) {
      this._version = version;
      return this;
    }
    description(desc: string) {
      this._description = desc;
      return this;
    }
    meta(meta: Record<string, unknown>) {
      Object.assign(this._meta, meta);
      return this;
    }
    tool(definition: { name: string }, executor: unknown) {
      this._tools.set(definition.name, { definition, executor });
      return this;
    }
    publicApi(api: Record<string, unknown>) {
      this._api = api;
      return this;
    }
    capabilities() {
      return this;
    }

    build() {
      if (!this._id || !this._name || !this._version) {
        throw new Error('Plugin must have id, name, and version');
      }
      return {
        manifest: {
          id: this._id,
          name: this._name,
          version: this._version,
          description: this._description,
          capabilities: [],
          permissions: [],
          main: 'index.js',
          ...this._meta,
        },
        implementation: {
          tools: this._tools,
          handlers: [],
          api: this._api,
          lifecycle: {},
        },
      };
    }
  }

  return { PluginBuilder: MockPluginBuilder };
});

// Dynamic import so the mock is in place before module evaluation
const { ChannelPluginBuilder, createChannelPlugin } = await import('./builder.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock ChannelPluginAPI. */
function makeMockChannelApi(): ChannelPluginAPI {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('msg-1'),
    getStatus: vi.fn().mockReturnValue('disconnected'),
    getPlatform: vi.fn().mockReturnValue('test'),
  };
}

/** Minimal ToolDefinition for testing. */
function makeToolDef(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
  } as ToolDefinition;
}

/** Minimal ToolExecutor stub. */
function makeToolExec(): ToolExecutor {
  return vi.fn().mockResolvedValue({ result: 'ok' }) as unknown as ToolExecutor;
}

/** Build a fully-configured builder with all required fields. */
function fullBuilder() {
  return createChannelPlugin()
    .id('channel.test')
    .name('Test Channel')
    .version('1.0.0')
    .platform('test-platform');
}

// ===========================================================================
// Tests
// ===========================================================================

describe('ChannelPluginBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // createChannelPlugin factory
  // -------------------------------------------------------------------------
  describe('createChannelPlugin()', () => {
    it('returns a ChannelPluginBuilder instance', () => {
      const builder = createChannelPlugin();
      expect(builder).toBeInstanceOf(ChannelPluginBuilder);
    });

    it('returned builder has platform method', () => {
      const builder = createChannelPlugin();
      expect(typeof builder.platform).toBe('function');
    });

    it('returned builder has channelApi method', () => {
      const builder = createChannelPlugin();
      expect(typeof builder.channelApi).toBe('function');
    });

    it('returned builder has build method', () => {
      const builder = createChannelPlugin();
      expect(typeof builder.build).toBe('function');
    });

    it('returns a new instance on each call', () => {
      const a = createChannelPlugin();
      const b = createChannelPlugin();
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // platform()
  // -------------------------------------------------------------------------
  describe('platform()', () => {
    it('sets platform value retrievable via getChannelPlatform()', () => {
      const builder = createChannelPlugin();
      builder.platform('telegram');
      expect(builder.getChannelPlatform()).toBe('telegram');
    });

    it('returns this for chaining', () => {
      const builder = createChannelPlugin();
      const ret = builder.platform('telegram');
      expect(ret).toBe(builder);
    });

    it('overrides previous platform value', () => {
      const builder = createChannelPlugin();
      builder.platform('slack');
      builder.platform('telegram');
      expect(builder.getChannelPlatform()).toBe('telegram');
    });

    it('getChannelPlatform() returns empty string initially', () => {
      const builder = createChannelPlugin();
      expect(builder.getChannelPlatform()).toBe('');
    });

    it('accepts any string as platform (open ChannelPlatform type)', () => {
      const builder = createChannelPlugin();
      builder.platform('custom-platform-xyz');
      expect(builder.getChannelPlatform()).toBe('custom-platform-xyz');
    });

    it('platform value persists through chaining with other methods', () => {
      const builder = createChannelPlugin()
        .id('x')
        .platform('telegram')
        .name('X')
        .version('1.0.0');
      expect(builder.getChannelPlatform()).toBe('telegram');
    });
  });

  // -------------------------------------------------------------------------
  // channelApi()
  // -------------------------------------------------------------------------
  describe('channelApi()', () => {
    it('sets the factory function', () => {
      const factory = () => makeMockChannelApi();
      const builder = createChannelPlugin();
      builder.channelApi(factory);
      expect(builder.getChannelApiFactory()).toBe(factory);
    });

    it('returns this for chaining', () => {
      const builder = createChannelPlugin();
      const ret = builder.channelApi(() => makeMockChannelApi());
      expect(ret).toBe(builder);
    });

    it('getChannelApiFactory() returns undefined before setting', () => {
      const builder = createChannelPlugin();
      expect(builder.getChannelApiFactory()).toBeUndefined();
    });

    it('overrides previous factory', () => {
      const factory1 = () => makeMockChannelApi();
      const factory2 = () => makeMockChannelApi();
      const builder = createChannelPlugin();
      builder.channelApi(factory1);
      builder.channelApi(factory2);
      expect(builder.getChannelApiFactory()).toBe(factory2);
      expect(builder.getChannelApiFactory()).not.toBe(factory1);
    });

    it('factory persists through chaining with other methods', () => {
      const factory = () => makeMockChannelApi();
      const builder = createChannelPlugin()
        .id('x')
        .channelApi(factory)
        .name('X')
        .version('1.0.0')
        .platform('test');
      expect(builder.getChannelApiFactory()).toBe(factory);
    });

    it('accepts a factory that takes a config argument', () => {
      const factory = (config: Record<string, unknown>) => {
        const api = makeMockChannelApi();
        (api as Record<string, unknown>)['config'] = config;
        return api;
      };
      const builder = createChannelPlugin();
      builder.channelApi(factory);
      const retrieved = builder.getChannelApiFactory();
      expect(retrieved).toBe(factory);
    });
  });

  // -------------------------------------------------------------------------
  // getChannelApiFactory()
  // -------------------------------------------------------------------------
  describe('getChannelApiFactory()', () => {
    it('returns undefined initially on a fresh builder', () => {
      expect(new ChannelPluginBuilder().getChannelApiFactory()).toBeUndefined();
    });

    it('returns the factory after it has been set', () => {
      const factory = () => makeMockChannelApi();
      const builder = new ChannelPluginBuilder();
      builder.channelApi(factory);
      expect(builder.getChannelApiFactory()).toBe(factory);
    });

    it('returns the latest factory after override', () => {
      const first = () => makeMockChannelApi();
      const second = () => makeMockChannelApi();
      const builder = new ChannelPluginBuilder();
      builder.channelApi(first);
      builder.channelApi(second);
      expect(builder.getChannelApiFactory()).toBe(second);
    });

    it('returns undefined on a new createChannelPlugin() builder', () => {
      expect(createChannelPlugin().getChannelApiFactory()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getChannelPlatform()
  // -------------------------------------------------------------------------
  describe('getChannelPlatform()', () => {
    it('returns empty string initially on a fresh builder', () => {
      expect(new ChannelPluginBuilder().getChannelPlatform()).toBe('');
    });

    it('returns the set platform', () => {
      const builder = new ChannelPluginBuilder();
      builder.platform('discord');
      expect(builder.getChannelPlatform()).toBe('discord');
    });

    it('returns latest platform after override', () => {
      const builder = new ChannelPluginBuilder();
      builder.platform('discord');
      builder.platform('telegram');
      expect(builder.getChannelPlatform()).toBe('telegram');
    });

    it('returns empty string on a new createChannelPlugin() builder', () => {
      expect(createChannelPlugin().getChannelPlatform()).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Fluent chaining
  // -------------------------------------------------------------------------
  describe('fluent chaining', () => {
    it('supports full chain: id → name → version → platform → channelApi → build', () => {
      const factory = () => makeMockChannelApi();
      const result = createChannelPlugin()
        .id('channel.telegram')
        .name('Telegram')
        .version('1.0.0')
        .platform('telegram')
        .channelApi(factory)
        .build();

      expect(result.manifest.id).toBe('channel.telegram');
      expect(result.manifest.name).toBe('Telegram');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.manifest.platform).toBe('telegram');
      expect(result.implementation.channelApiFactory).toBe(factory);
    });

    it('supports partial chain without channelApi (factory is undefined)', () => {
      const result = createChannelPlugin()
        .id('channel.test')
        .name('Test')
        .version('1.0.0')
        .platform('test')
        .build();

      expect(result.implementation.channelApiFactory).toBeUndefined();
    });

    it('can chain methods in any order', () => {
      const factory = () => makeMockChannelApi();
      const result = createChannelPlugin()
        .platform('telegram')
        .channelApi(factory)
        .version('2.0.0')
        .name('TG')
        .id('tg')
        .build();

      expect(result.manifest.platform).toBe('telegram');
      expect(result.manifest.id).toBe('tg');
      expect(result.manifest.name).toBe('TG');
      expect(result.manifest.version).toBe('2.0.0');
      expect(result.implementation.channelApiFactory).toBe(factory);
    });

    it('parent builder methods (id, name, version, meta, tool) are available on ChannelPluginBuilder', () => {
      const builder = createChannelPlugin();
      expect(typeof builder.id).toBe('function');
      expect(typeof builder.name).toBe('function');
      expect(typeof builder.version).toBe('function');
      expect(typeof builder.meta).toBe('function');
      expect(typeof builder.tool).toBe('function');
    });

    it('each method returns the same builder instance', () => {
      const builder = createChannelPlugin();
      const factory = () => makeMockChannelApi();

      expect(builder.id('x')).toBe(builder);
      expect(builder.name('X')).toBe(builder);
      expect(builder.version('1.0.0')).toBe(builder);
      expect(builder.platform('test')).toBe(builder);
      expect(builder.channelApi(factory)).toBe(builder);
      expect(builder.meta({ foo: 'bar' })).toBe(builder);
    });
  });

  // -------------------------------------------------------------------------
  // build()
  // -------------------------------------------------------------------------
  describe('build()', () => {
    it('throws when platform is not set (empty string)', () => {
      const builder = createChannelPlugin()
        .id('channel.test')
        .name('Test')
        .version('1.0.0');

      expect(() => builder.build()).toThrow();
    });

    it('error message contains "platform"', () => {
      const builder = createChannelPlugin()
        .id('channel.test')
        .name('Test')
        .version('1.0.0');

      expect(() => builder.build()).toThrow(/platform/i);
    });

    it('error message references .platform() method', () => {
      const builder = createChannelPlugin()
        .id('test')
        .name('Test')
        .version('1.0.0');

      expect(() => builder.build()).toThrow('.platform()');
    });

    it('does NOT throw when platform is set', () => {
      const builder = fullBuilder();
      expect(() => builder.build()).not.toThrow();
    });

    it('sets category to "channel" in meta before building', () => {
      const result = fullBuilder().build();
      expect(result.manifest.category).toBe('channel');
    });

    it('category "channel" overrides previously set category', () => {
      const result = fullBuilder()
        .meta({ category: 'utilities' })
        .build();
      // The build() method calls this.meta({ category: 'channel' }) which
      // Object.assign merges, so category ends up as 'channel'.
      expect(result.manifest.category).toBe('channel');
    });

    it('returns manifest with platform field', () => {
      const result = fullBuilder().build();
      expect(result.manifest).toHaveProperty('platform');
    });

    it('manifest.platform matches the set value', () => {
      const result = createChannelPlugin()
        .id('ch.tg')
        .name('TG')
        .version('1.0.0')
        .platform('telegram')
        .build();

      expect(result.manifest.platform).toBe('telegram');
    });

    it('implementation includes channelApiFactory', () => {
      const factory = () => makeMockChannelApi();
      const result = fullBuilder().channelApi(factory).build();
      expect(result.implementation).toHaveProperty('channelApiFactory');
      expect(result.implementation.channelApiFactory).toBe(factory);
    });

    it('channelApiFactory is undefined in implementation when not set', () => {
      const result = fullBuilder().build();
      expect(result.implementation.channelApiFactory).toBeUndefined();
    });

    it('manifest includes fields from parent (id, name, version)', () => {
      const result = createChannelPlugin()
        .id('ch.x')
        .name('My Channel')
        .version('3.2.1')
        .platform('x')
        .build();

      expect(result.manifest.id).toBe('ch.x');
      expect(result.manifest.name).toBe('My Channel');
      expect(result.manifest.version).toBe('3.2.1');
    });

    it('manifest includes additional meta fields set via meta()', () => {
      const result = fullBuilder()
        .meta({ requiredServices: [{ name: 'telegram', displayName: 'Telegram Bot Token' }] })
        .build();

      expect(result.manifest.requiredServices).toEqual([
        { name: 'telegram', displayName: 'Telegram Bot Token' },
      ]);
    });

    it('factory function in the result is callable and receives config', () => {
      const factory = vi.fn((_config: Record<string, unknown>) => makeMockChannelApi());
      const result = fullBuilder().channelApi(factory).build();

      const config = { bot_token: 'abc123' };
      const api = result.implementation.channelApiFactory!(config);

      expect(factory).toHaveBeenCalledWith(config);
      expect(api).toBeDefined();
      expect(typeof api.connect).toBe('function');
    });

    it('implementation preserves tools from parent build', () => {
      const toolDef = makeToolDef('send_message');
      const toolExec = makeToolExec();

      const result = fullBuilder()
        .tool(toolDef, toolExec)
        .build();

      expect(result.implementation.tools).toBeDefined();
      expect(result.implementation.tools.has('send_message')).toBe(true);
    });

    it('implementation preserves api from parent build', () => {
      const result = fullBuilder().build();
      expect(result.implementation).toHaveProperty('api');
    });

    it('throws if parent build validation fails (missing id/name/version)', () => {
      // Missing id
      expect(() =>
        createChannelPlugin()
          .name('Test')
          .version('1.0.0')
          .platform('test')
          .build()
      ).toThrow();

      // Missing name
      expect(() =>
        createChannelPlugin()
          .id('test')
          .version('1.0.0')
          .platform('test')
          .build()
      ).toThrow();

      // Missing version
      expect(() =>
        createChannelPlugin()
          .id('test')
          .name('Test')
          .platform('test')
          .build()
      ).toThrow();
    });

    it('platform validation runs before parent build', () => {
      // Neither platform nor id/name/version set: platform check should come first
      const builder = createChannelPlugin();
      expect(() => builder.build()).toThrow(/platform/i);
    });
  });

  // -------------------------------------------------------------------------
  // Integration scenarios
  // -------------------------------------------------------------------------
  describe('integration scenarios', () => {
    it('builds a realistic Telegram plugin', () => {
      const telegramApi = makeMockChannelApi();
      const factory = vi.fn((_config: Record<string, unknown>) => telegramApi);

      const result = createChannelPlugin()
        .id('channel.telegram')
        .name('Telegram')
        .version('1.0.0')
        .platform('telegram')
        .meta({
          description: 'Official Telegram channel plugin',
          requiredServices: [
            {
              name: 'telegram',
              displayName: 'Telegram Bot Token',
              category: 'messaging',
            },
          ],
        })
        .channelApi(factory)
        .build();

      // Manifest assertions
      expect(result.manifest.id).toBe('channel.telegram');
      expect(result.manifest.name).toBe('Telegram');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.manifest.platform).toBe('telegram');
      expect(result.manifest.category).toBe('channel');
      expect(result.manifest.description).toBe('Official Telegram channel plugin');
      expect(result.manifest.requiredServices).toHaveLength(1);

      // Implementation assertions
      expect(result.implementation.channelApiFactory).toBe(factory);
    });

    it('factory function receives config and returns a usable ChannelPluginAPI', () => {
      const factory = (config: Record<string, unknown>) => {
        const api = makeMockChannelApi();
        (api.getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(config['platform']);
        return api;
      };

      const result = fullBuilder().channelApi(factory).build();
      const api = result.implementation.channelApiFactory!({ platform: 'custom' });

      expect(api.getPlatform()).toBe('custom');
      expect(typeof api.connect).toBe('function');
      expect(typeof api.disconnect).toBe('function');
      expect(typeof api.sendMessage).toBe('function');
      expect(typeof api.getStatus).toBe('function');
    });

    it('builds a channel plugin with tools', () => {
      const toolDef = makeToolDef('channel_send');
      const toolExec = makeToolExec();

      const result = fullBuilder()
        .tool(toolDef, toolExec)
        .channelApi(() => makeMockChannelApi())
        .build();

      expect(result.implementation.tools.has('channel_send')).toBe(true);
      const tool = result.implementation.tools.get('channel_send');
      expect(tool?.definition).toBe(toolDef);
      expect(tool?.executor).toBe(toolExec);
      expect(result.implementation.channelApiFactory).toBeDefined();
    });

    it('builds a channel plugin with multiple tools', () => {
      const sendDef = makeToolDef('channel_send');
      const sendExec = makeToolExec();
      const recvDef = makeToolDef('channel_receive');
      const recvExec = makeToolExec();

      const result = fullBuilder()
        .tool(sendDef, sendExec)
        .tool(recvDef, recvExec)
        .channelApi(() => makeMockChannelApi())
        .build();

      expect(result.implementation.tools.size).toBe(2);
      expect(result.implementation.tools.has('channel_send')).toBe(true);
      expect(result.implementation.tools.has('channel_receive')).toBe(true);
    });

    it('multiple builders are independent', () => {
      const factory1 = () => makeMockChannelApi();
      const factory2 = () => makeMockChannelApi();

      const builder1 = createChannelPlugin()
        .id('ch.a')
        .name('A')
        .version('1.0.0')
        .platform('platform-a')
        .channelApi(factory1);

      const builder2 = createChannelPlugin()
        .id('ch.b')
        .name('B')
        .version('2.0.0')
        .platform('platform-b')
        .channelApi(factory2);

      const r1 = builder1.build();
      const r2 = builder2.build();

      expect(r1.manifest.id).toBe('ch.a');
      expect(r2.manifest.id).toBe('ch.b');
      expect(r1.manifest.platform).toBe('platform-a');
      expect(r2.manifest.platform).toBe('platform-b');
      expect(r1.implementation.channelApiFactory).toBe(factory1);
      expect(r2.implementation.channelApiFactory).toBe(factory2);
    });

    it('custom metadata is preserved alongside channel metadata', () => {
      const result = fullBuilder()
        .meta({ icon: 'telegram.svg', docs: 'https://docs.example.com' })
        .build();

      expect(result.manifest.category).toBe('channel');
      expect(result.manifest.icon).toBe('telegram.svg');
      expect(result.manifest.docs).toBe('https://docs.example.com');
    });

    it('build result manifest conforms to ChannelPluginManifest shape', () => {
      const result = fullBuilder().channelApi(() => makeMockChannelApi()).build();

      // ChannelPluginManifest extends PluginManifest with platform field
      expect(result.manifest).toHaveProperty('id');
      expect(result.manifest).toHaveProperty('name');
      expect(result.manifest).toHaveProperty('version');
      expect(result.manifest).toHaveProperty('platform');
      expect(typeof result.manifest.platform).toBe('string');
      expect(result.manifest.platform.length).toBeGreaterThan(0);
    });

    it('build result implementation has both parent and channel fields', () => {
      const factory = () => makeMockChannelApi();
      const result = fullBuilder()
        .channelApi(factory)
        .tool(makeToolDef('test_tool'), makeToolExec())
        .build();

      // Parent fields
      expect(result.implementation).toHaveProperty('tools');
      expect(result.implementation).toHaveProperty('handlers');
      expect(result.implementation).toHaveProperty('api');
      expect(result.implementation).toHaveProperty('lifecycle');

      // Channel-specific field
      expect(result.implementation).toHaveProperty('channelApiFactory');
      expect(result.implementation.channelApiFactory).toBe(factory);
    });
  });

  // -------------------------------------------------------------------------
  // ChannelPluginBuilder extends PluginBuilder
  // -------------------------------------------------------------------------
  describe('inheritance', () => {
    it('ChannelPluginBuilder is a subclass that extends PluginBuilder', () => {
      const builder = new ChannelPluginBuilder();
      // It should have all parent methods
      expect(typeof builder.id).toBe('function');
      expect(typeof builder.name).toBe('function');
      expect(typeof builder.version).toBe('function');
      expect(typeof builder.meta).toBe('function');
      expect(typeof builder.tool).toBe('function');
      expect(typeof builder.publicApi).toBe('function');
      expect(typeof builder.build).toBe('function');
    });

    it('description() from parent is available and works', () => {
      const result = fullBuilder()
        .description('A test channel plugin')
        .build();

      expect(result.manifest.description).toBe('A test channel plugin');
    });

    it('meta() merges multiple calls', () => {
      const result = fullBuilder()
        .meta({ icon: 'icon.png' })
        .meta({ docs: 'https://docs.test.com' })
        .build();

      // category is set by build() itself
      expect(result.manifest.category).toBe('channel');
      expect(result.manifest.icon).toBe('icon.png');
      expect(result.manifest.docs).toBe('https://docs.test.com');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('platform set to whitespace-only string passes the truthy check', () => {
      // ' ' is truthy in JS, so it should NOT throw
      const builder = createChannelPlugin()
        .id('ch.ws')
        .name('WS')
        .version('1.0.0')
        .platform(' ');

      expect(() => builder.build()).not.toThrow();
      expect(builder.build().manifest.platform).toBe(' ');
    });

    it('channelApiFactory can return different APIs for different configs', () => {
      const factory = (config: Record<string, unknown>) => {
        const api = makeMockChannelApi();
        (api.getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
          config['platform'] ?? 'default'
        );
        return api;
      };

      const result = fullBuilder().channelApi(factory).build();
      const api1 = result.implementation.channelApiFactory!({ platform: 'a' });
      const api2 = result.implementation.channelApiFactory!({ platform: 'b' });

      expect(api1.getPlatform()).toBe('a');
      expect(api2.getPlatform()).toBe('b');
    });

    it('building twice from the same builder produces consistent results', () => {
      const builder = fullBuilder().channelApi(() => makeMockChannelApi());

      const r1 = builder.build();
      const r2 = builder.build();

      expect(r1.manifest.id).toBe(r2.manifest.id);
      expect(r1.manifest.platform).toBe(r2.manifest.platform);
      expect(r1.manifest.category).toBe(r2.manifest.category);
    });

    it('empty config passed to factory does not throw', () => {
      const factory = vi.fn((_config: Record<string, unknown>) => makeMockChannelApi());
      const result = fullBuilder().channelApi(factory).build();

      expect(() => result.implementation.channelApiFactory!({})).not.toThrow();
      expect(factory).toHaveBeenCalledWith({});
    });

    it('factory that throws propagates the error', () => {
      const factory = (_config: Record<string, unknown>) => {
        throw new Error('Config missing bot_token');
      };

      const result = fullBuilder().channelApi(factory).build();
      expect(() => result.implementation.channelApiFactory!({})).toThrow('Config missing bot_token');
    });

    it('channelApi set to a factory that returns different implementations', () => {
      let callCount = 0;
      const factory = (_config: Record<string, unknown>) => {
        callCount++;
        const api = makeMockChannelApi();
        (api as Record<string, unknown>)['instanceId'] = callCount;
        return api;
      };

      const result = fullBuilder().channelApi(factory).build();
      const api1 = result.implementation.channelApiFactory!({});
      const api2 = result.implementation.channelApiFactory!({});

      expect(api1).not.toBe(api2);
      expect((api1 as Record<string, unknown>)['instanceId']).toBe(1);
      expect((api2 as Record<string, unknown>)['instanceId']).toBe(2);
    });
  });
});
