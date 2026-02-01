/**
 * Channel Tools Tests
 *
 * Tests the channel tool executors (sendChannelMessage, listChannels)
 * using the unified IChannelService from @ownpilot/core.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock IChannelService via @ownpilot/core
// ---------------------------------------------------------------------------

const mockService = {
  send: vi.fn(async () => 'msg-123'),
  listChannels: vi.fn(() => [
    { pluginId: 'channel.telegram', platform: 'telegram', name: 'Telegram', status: 'connected', icon: 'telegram' },
    { pluginId: 'channel.discord', platform: 'discord', name: 'Discord', status: 'disconnected', icon: 'discord' },
  ]),
  getByPlatform: vi.fn((platform: string) => {
    if (platform === 'telegram') return [{ getStatus: () => 'connected', getPlatform: () => 'telegram' }];
    if (platform === 'discord') return [{ getStatus: () => 'disconnected', getPlatform: () => 'discord' }];
    return [];
  }),
  getChannel: vi.fn(() => undefined),
  broadcast: vi.fn(),
  broadcastAll: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  resolveUser: vi.fn(),
};

let serviceInitialized = true;

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getChannelService: () => {
      if (!serviceInitialized) {
        throw new Error('ChannelService not initialized. Call setChannelService() during gateway startup.');
      }
      return mockService;
    },
  };
});

// Import after mocks
const {
  setChannelManager,
  sendChannelMessageExecutor,
  listChannelsExecutor,
  CHANNEL_TOOLS,
  CHANNEL_TOOL_NAMES,
} = await import('./channel-tools.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Channel Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceInitialized = true;
    // Reset mock return values
    mockService.listChannels.mockReturnValue([
      { pluginId: 'channel.telegram', platform: 'telegram', name: 'Telegram', status: 'connected', icon: 'telegram' },
      { pluginId: 'channel.discord', platform: 'discord', name: 'Discord', status: 'disconnected', icon: 'discord' },
    ]);
    mockService.getByPlatform.mockImplementation((platform: string) => {
      if (platform === 'telegram') return [{ getStatus: () => 'connected', getPlatform: () => 'telegram' }];
      if (platform === 'discord') return [{ getStatus: () => 'disconnected', getPlatform: () => 'discord' }];
      return [];
    });
    mockService.send.mockResolvedValue('msg-123');
  });

  // ========================================================================
  // CHANNEL_TOOLS definitions
  // ========================================================================

  describe('CHANNEL_TOOLS', () => {
    it('exports 2 tool definitions', () => {
      expect(CHANNEL_TOOLS).toHaveLength(2);
    });

    it('has expected tool names', () => {
      expect(CHANNEL_TOOL_NAMES).toContain('send_channel_message');
      expect(CHANNEL_TOOL_NAMES).toContain('list_channels');
    });

    it('all tools have definition and executor', () => {
      for (const tool of CHANNEL_TOOLS) {
        expect(tool.definition.name).toBeTruthy();
        expect(tool.definition.description).toBeTruthy();
        expect(tool.definition.parameters).toBeDefined();
        expect(typeof tool.executor).toBe('function');
      }
    });
  });

  // ========================================================================
  // sendChannelMessageExecutor
  // ========================================================================

  describe('sendChannelMessageExecutor', () => {
    it('returns error when channel service not initialized', async () => {
      serviceInitialized = false;

      const result = await sendChannelMessageExecutor({ message: 'hello', chatId: '123' }, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('ChannelService not initialized');
    });

    it('sends message to specified channelId', async () => {
      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelId: 'channel.telegram', chatId: '111' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.success).toBe(true);
      expect(content.messageId).toBe('msg-123');
      expect(content.channelId).toBe('channel.telegram');
      expect(mockService.send).toHaveBeenCalledWith('channel.telegram', {
        platformChatId: '111',
        text: 'Hello!',
        replyToId: undefined,
      });
    });

    it('resolves channel by platform when no channelId', async () => {
      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', platform: 'telegram', chatId: '111' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('channel.telegram');
    });

    it('falls back to any connected channel', async () => {
      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', chatId: '111' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('channel.telegram');
    });

    it('returns error when no connected channels available', async () => {
      mockService.listChannels.mockReturnValue([
        { pluginId: 'channel.discord', platform: 'discord', name: 'Discord', status: 'disconnected' },
      ]);
      mockService.getByPlatform.mockReturnValue([]);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', platform: 'slack', chatId: '111' },
        {} as any,
      );

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).error).toContain('No connected channels');
    });

    it('returns error when chatId is missing', async () => {
      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelId: 'channel.telegram' },
        {} as any,
      );

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).error).toContain('chatId is required');
    });

    it('passes replyToId when provided', async () => {
      await sendChannelMessageExecutor(
        { message: 'Reply', channelId: 'channel.telegram', chatId: '111', replyToId: 'orig-msg' },
        {} as any,
      );

      expect(mockService.send).toHaveBeenCalledWith('channel.telegram', {
        platformChatId: '111',
        text: 'Reply',
        replyToId: 'orig-msg',
      });
    });

    it('handles send error gracefully', async () => {
      mockService.send.mockRejectedValue(new Error('Network timeout'));

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelId: 'channel.telegram', chatId: '111' },
        {} as any,
      );

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('Network timeout');
    });

    it('skips disconnected channels when resolving by platform', async () => {
      mockService.getByPlatform.mockReturnValue([
        { getStatus: () => 'disconnected', getPlatform: () => 'discord' },
      ]);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', platform: 'discord', chatId: '111' },
        {} as any,
      );

      // Should fall back to any connected channel
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('channel.telegram');
    });
  });

  // ========================================================================
  // listChannelsExecutor
  // ========================================================================

  describe('listChannelsExecutor', () => {
    it('returns error when channel service not initialized', async () => {
      serviceInitialized = false;

      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('ChannelService not initialized');
    });

    it('lists all channels', async () => {
      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.count).toBe(2);
      expect(content.channels).toHaveLength(2);
      expect(mockService.listChannels).toHaveBeenCalled();
    });

    it('filters by platform', async () => {
      const result = await listChannelsExecutor({ platform: 'telegram' }, {} as any);

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.count).toBe(1);
      expect(content.channels[0].platform).toBe('telegram');
    });

    it('handles list error gracefully', async () => {
      mockService.listChannels.mockImplementation(() => { throw new Error('DB error'); });

      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('DB error');
    });
  });

  // ========================================================================
  // setChannelManager (deprecated no-op)
  // ========================================================================

  describe('setChannelManager', () => {
    it('is a no-op function for backward compatibility', () => {
      expect(() => setChannelManager(null)).not.toThrow();
      expect(() => setChannelManager({})).not.toThrow();
    });
  });
});
