/**
 * Slack Channel Plugin — builder Tests
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  MockSlackChannelAPI,
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
  const MockSlackChannelAPI = vi.fn().mockImplementation(function (config: any, pluginId: string) {
    return { config, pluginId };
  });
  const mockConfigServicesRepo = { getFieldValue: vi.fn() };
  return {
    MockSlackChannelAPI,
    mockConfigServicesRepo,
    capturedMeta,
    capturedPlatform,
    capturedChannelApiFactory,
    capturedTools,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    createChannelPlugin: vi.fn(() => {
      const b: any = {
        meta: vi.fn((m: any) => {
          capturedMeta.push(m);
          return b;
        }),
        platform: vi.fn((p: string) => {
          capturedPlatform.push(p);
          return b;
        }),
        channelApi: vi.fn((f: Function) => {
          capturedChannelApiFactory.push(f);
          return b;
        }),
        tool: vi.fn((def: any, exec: Function) => {
          capturedTools.push({ definition: def, executor: exec });
          return b;
        }),
        build: vi.fn(() => ({ id: capturedMeta[0]?.id })),
      };
      return b;
    }),
  };
});

vi.mock('./slack-api.js', () => ({ SlackChannelAPI: MockSlackChannelAPI }));
vi.mock('../../../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

import { buildSlackChannelPlugin } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSlackChannelPlugin', () => {
  it('returns a plugin object', () => {
    expect(buildSlackChannelPlugin()).toBeDefined();
  });

  it('sets plugin id to channel.slack', () => {
    buildSlackChannelPlugin();
    expect(capturedMeta[0]?.id).toBe('channel.slack');
  });

  it('sets platform to slack', () => {
    buildSlackChannelPlugin();
    expect(capturedPlatform[0]).toBe('slack');
  });

  it('channelApi factory creates SlackChannelAPI with config', () => {
    buildSlackChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);
    factory({ bot_token: 'xoxb-token', signing_secret: 'secret' });
    expect(MockSlackChannelAPI).toHaveBeenCalledWith(
      expect.objectContaining({ bot_token: 'xoxb-token' }),
      'channel.slack'
    );
  });

  it('channelApi factory falls back to configServicesRepo for bot_token', () => {
    buildSlackChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockImplementation((service: string, field: string) => {
      if (service === 'slack_bot' && field === 'bot_token') return 'repo-xoxb';
      return undefined;
    });
    factory({});
    const last = MockSlackChannelAPI.mock.calls[MockSlackChannelAPI.mock.calls.length - 1];
    expect(last?.[0]?.bot_token).toBe('repo-xoxb');
  });

  it('registers channel_slack_send tool', () => {
    buildSlackChannelPlugin();
    const tool = capturedTools.find((t) => t.definition?.name === 'channel_slack_send');
    expect(tool).toBeDefined();
  });

  it('has requiredServices entry for slack_bot', () => {
    buildSlackChannelPlugin();
    expect(capturedMeta[0]?.requiredServices?.[0]?.name).toBe('slack_bot');
  });
});
