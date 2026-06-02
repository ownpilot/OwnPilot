/**
 * Channel Bridge Runtime Tests
 *
 * Exercises the real UCPBridgeManager (not mocked) through the runtime wiring:
 * config loading, the owner-chat send function, and the inbound forward hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelIncomingMessage, IChannelService, UCPBridgeConfig } from '@ownpilot/core';

const mockGetAll = vi.hoisted(() => vi.fn<() => Promise<UCPBridgeConfig[]>>());
const mockGetOwnerChatId = vi.hoisted(() => vi.fn<(platform: string) => Promise<string | null>>());

vi.mock('../db/repositories/channels/bridges.js', () => ({
  ChannelBridgesRepository: vi.fn(function () {
    return { getAll: mockGetAll };
  }),
}));

vi.mock('../services/pairing-service.js', () => ({
  getOwnerChatId: (platform: string) => mockGetOwnerChatId(platform),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  initChannelBridges,
  reloadChannelBridges,
  bridgeIncomingMessage,
  getChannelBridgeManager,
  resetChannelBridges,
} from './bridge-runtime.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLATFORM_OF: Record<string, string> = {
  'channel.telegram': 'telegram',
  'channel.discord': 'discord',
};

const mockSend = vi.fn().mockResolvedValue('target-msg-1');

const channelService = {
  getChannel: (id: string) =>
    PLATFORM_OF[id] ? { getPlatform: () => PLATFORM_OF[id] } : undefined,
  send: mockSend,
} as unknown as IChannelService;

function bridge(overrides: Partial<UCPBridgeConfig> = {}): UCPBridgeConfig {
  return {
    id: 'bridge-1',
    sourceChannelId: 'channel.telegram',
    targetChannelId: 'channel.discord',
    direction: 'source_to_target',
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function incoming(overrides: Partial<ChannelIncomingMessage> = {}): ChannelIncomingMessage {
  return {
    id: 'msg-1',
    channelPluginId: 'channel.telegram',
    platform: 'telegram',
    platformChatId: 'chat-1',
    sender: { platformUserId: 'u1', platform: 'telegram', displayName: 'Alice' },
    text: 'hello world',
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bridge-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChannelBridges();
    mockSend.mockResolvedValue('target-msg-1');
    mockGetOwnerChatId.mockResolvedValue('discord-owner-chat');
    mockGetAll.mockResolvedValue([]);
  });

  it('no-ops before init', async () => {
    await bridgeIncomingMessage(incoming());
    expect(mockSend).not.toHaveBeenCalled();
    expect(getChannelBridgeManager()).toBeNull();
  });

  it('forwards an inbound message to the owner chat on the target channel', async () => {
    mockGetAll.mockResolvedValue([bridge()]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming());

    expect(mockGetOwnerChatId).toHaveBeenCalledWith('discord');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [targetId, payload] = mockSend.mock.calls[0];
    expect(targetId).toBe('channel.discord');
    expect(payload.platformChatId).toBe('discord-owner-chat');
    expect(payload.text).toContain('hello world');
    expect(payload.text).toContain('channel.telegram'); // bridgedFrom marker
  });

  it('does not forward when the bridge is disabled', async () => {
    mockGetAll.mockResolvedValue([bridge({ enabled: false })]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming());

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('respects direction (target_to_source does not forward a source message)', async () => {
    mockGetAll.mockResolvedValue([bridge({ direction: 'target_to_source' })]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming());

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('applies the filter pattern', async () => {
    mockGetAll.mockResolvedValue([bridge({ filterPattern: '^urgent:' })]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming({ text: 'just chatting' }));
    expect(mockSend).not.toHaveBeenCalled();

    await bridgeIncomingMessage(incoming({ text: 'urgent: ping' }));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('drops the forward when the target platform has no claimed owner', async () => {
    mockGetOwnerChatId.mockResolvedValue(null);
    mockGetAll.mockResolvedValue([bridge()]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming());

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not forward messages from an unbridged channel', async () => {
    mockGetAll.mockResolvedValue([bridge()]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming({ channelPluginId: 'channel.slack', platform: 'slack' }));

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('reload picks up newly added bridges', async () => {
    mockGetAll.mockResolvedValue([]);
    await initChannelBridges(channelService);

    await bridgeIncomingMessage(incoming());
    expect(mockSend).not.toHaveBeenCalled();

    mockGetAll.mockResolvedValue([bridge()]);
    await reloadChannelBridges();

    await bridgeIncomingMessage(incoming());
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
