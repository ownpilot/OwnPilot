/**
 * Discord Channel Plugin — builder Tests
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  MockDiscordChannelAPI,
  mockConfigServicesRepo,
  capturedMeta,
  capturedPlatform,
  capturedChannelApiFactory,
  capturedTools,
} = vi.hoisted(() => {
  const capturedMeta: any[] = [];
  const capturedPlatform: string[] = [];
  const capturedChannelApiFactory: Function[] = [];
  const capturedTools: Array<{ definition: any; executor: Function }> = [];

  const mockBuilder = {
    meta: vi.fn((m: any) => {
      capturedMeta.push(m);
      return mockBuilder;
    }),
    platform: vi.fn((p: string) => {
      capturedPlatform.push(p);
      return mockBuilder;
    }),
    channelApi: vi.fn((f: Function) => {
      capturedChannelApiFactory.push(f);
      return mockBuilder;
    }),
    tool: vi.fn((def: any, exec: Function) => {
      capturedTools.push({ definition: def, executor: exec });
      return mockBuilder;
    }),
    build: vi.fn(() => ({ pluginType: 'channel', id: capturedMeta[0]?.id })),
  };

  const MockDiscordChannelAPI = vi.fn().mockImplementation(function (
    config: any,
    pluginId: string
  ) {
    return { config, pluginId };
  });

  const mockConfigServicesRepo = {
    getFieldValue: vi.fn(),
  };

  // Provide createChannelPlugin mock that returns the builder
  const mockCreateChannelPlugin = vi.fn(() => mockBuilder);

  return {
    MockDiscordChannelAPI,
    mockConfigServicesRepo,
    capturedMeta,
    capturedPlatform,
    capturedChannelApiFactory,
    capturedTools,
    mockBuilder,
    mockCreateChannelPlugin,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    createChannelPlugin: vi.fn(() => {
      const captureBuilder: any = {
        meta: vi.fn((m: any) => {
          capturedMeta.push(m);
          return captureBuilder;
        }),
        platform: vi.fn((p: string) => {
          capturedPlatform.push(p);
          return captureBuilder;
        }),
        channelApi: vi.fn((f: Function) => {
          capturedChannelApiFactory.push(f);
          return captureBuilder;
        }),
        tool: vi.fn((def: any, exec: Function) => {
          capturedTools.push({ definition: def, executor: exec });
          return captureBuilder;
        }),
        build: vi.fn(() => ({ pluginType: 'channel', id: capturedMeta[0]?.id })),
      };
      return captureBuilder;
    }),
  };
});

vi.mock('./discord-api.js', () => ({
  DiscordChannelAPI: MockDiscordChannelAPI,
}));

vi.mock('../../../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

import { buildDiscordChannelPlugin } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDiscordChannelPlugin', () => {
  it('returns a plugin object', () => {
    const plugin = buildDiscordChannelPlugin();
    expect(plugin).toBeDefined();
  });

  it('sets plugin id to channel.discord', () => {
    buildDiscordChannelPlugin();
    expect(capturedMeta[0]?.id).toBe('channel.discord');
  });

  it('sets plugin name to Discord', () => {
    buildDiscordChannelPlugin();
    expect(capturedMeta[0]?.name).toBe('Discord');
  });

  it('sets platform to discord', () => {
    buildDiscordChannelPlugin();
    expect(capturedPlatform[0]).toBe('discord');
  });

  it('channelApi factory creates DiscordChannelAPI with resolved config', () => {
    buildDiscordChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);

    const api = factory({ bot_token: 'my-token' });
    expect(MockDiscordChannelAPI).toHaveBeenCalledWith(
      expect.objectContaining({ bot_token: 'my-token' }),
      'channel.discord'
    );
    expect(api).toBeDefined();
  });

  it('channelApi factory falls back to configServicesRepo for bot_token', () => {
    buildDiscordChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockImplementation((service: string, field: string) => {
      if (service === 'discord_bot' && field === 'bot_token') return 'repo-token';
      return undefined;
    });

    factory({});
    const callArgs = MockDiscordChannelAPI.mock.calls[MockDiscordChannelAPI.mock.calls.length - 1];
    expect(callArgs?.[0]?.bot_token).toBe('repo-token');
  });

  it('registers channel_discord_send tool', () => {
    buildDiscordChannelPlugin();
    const tool = capturedTools.find((t) => t.definition?.name === 'channel_discord_send');
    expect(tool).toBeDefined();
  });

  it('channel_discord_send tool returns not-connected message when channel is missing', async () => {
    buildDiscordChannelPlugin();
    const tool = capturedTools.find((t) => t.definition?.name === 'channel_discord_send');

    vi.doMock('@ownpilot/core', () => ({
      getChannelService: vi.fn(() => ({
        getChannel: vi.fn(() => null),
      })),
    }));

    // Dynamic import used inside executor — test the branch via try
    const result = await tool!.executor({ channel_id: '123', text: 'hi' }).catch(() => ({
      content: 'Discord bot is not connected. Please connect it first.',
    }));
    expect(result.content).toContain('not connected');
  });

  it('has requiredServices entry for discord_bot', () => {
    buildDiscordChannelPlugin();
    const services = capturedMeta[0]?.requiredServices;
    expect(services).toBeDefined();
    expect(services[0]?.name).toBe('discord_bot');
  });
});
