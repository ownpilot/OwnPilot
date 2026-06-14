/**
 * Channel Tools Tests
 *
 * Surface contract: tool defs are well-formed, executor dispatches to the
 * right handler, and each handler delegates to the channel service / repo
 * with the expected shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSend = vi.fn();
const mockBroadcast = vi.fn();
const mockBroadcastAll = vi.fn();
const mockListChannels = vi.fn();
const mockHasChannelService = vi.fn(() => true);
const mockGetByChannel = vi.fn();
const mockGetInbox = vi.fn();
const mockSearchConversations = vi.fn();

vi.mock('@ownpilot/core/channels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    hasChannelService: () => mockHasChannelService(),
    getChannelService: () => ({
      send: mockSend,
      broadcast: mockBroadcast,
      broadcastAll: mockBroadcastAll,
      listChannels: mockListChannels,
    }),
  };
});

vi.mock('../db/repositories/channels/messages.js', () => ({
  channelMessagesRepo: {
    getByChannel: mockGetByChannel,
    getInbox: mockGetInbox,
  },
}));

vi.mock('../db/repositories/chat/index.js', () => ({
  ChatRepository: vi.fn().mockImplementation(function () {
    return { searchConversations: mockSearchConversations };
  }),
}));

const { CHANNEL_TOOLS, CHANNEL_TOOL_NAMES, executeChannelTool } =
  await import('./channel-tools.js');

describe('channel-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('definitions', () => {
    it('exports four channel tools', () => {
      expect(CHANNEL_TOOLS).toHaveLength(5);
      expect(CHANNEL_TOOL_NAMES).toEqual([
        'send_channel_message',
        'broadcast_channel_message',
        'list_channels',
        'get_channel_inbox',
        'search_conversations',
      ]);
    });

    it('every tool has a description and parameter schema', () => {
      for (const tool of CHANNEL_TOOLS) {
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.parameters.type).toBe('object');
        expect(tool.category).toBe('channels');
      }
    });
  });

  describe('send_channel_message', () => {
    it('calls channelService.send with the outgoing-message shape', async () => {
      mockSend.mockResolvedValueOnce('platform-msg-42');

      const result = await executeChannelTool(
        'send_channel_message',
        { channel: 'telegram', chat_id: '12345', text: 'hello' },
        'user_a'
      );

      expect(mockSend).toHaveBeenCalledWith('telegram', {
        platformChatId: '12345',
        text: 'hello',
      });
      expect(result).toEqual({
        success: true,
        result: {
          channel: 'telegram',
          chatId: '12345',
          platformMessageId: 'platform-msg-42',
          sentBy: 'user_a',
        },
      });
    });

    it('forwards reply_to_id when provided', async () => {
      mockSend.mockResolvedValueOnce('msg-99');
      await executeChannelTool(
        'send_channel_message',
        { channel: 'telegram', chat_id: '1', text: 'reply', reply_to_id: 'parent-msg' },
        'user_a'
      );

      expect(mockSend).toHaveBeenCalledWith('telegram', {
        platformChatId: '1',
        text: 'reply',
        replyToId: 'parent-msg',
      });
    });

    it('rejects missing required fields', async () => {
      const result = await executeChannelTool(
        'send_channel_message',
        { channel: 'telegram', chat_id: '' },
        'user_a'
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/i);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('surfaces channel-service errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Channel plugin not found: telegram'));
      const result = await executeChannelTool(
        'send_channel_message',
        { channel: 'telegram', chat_id: '1', text: 'hi' },
        'user_a'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('broadcast_channel_message', () => {
    it('uses broadcast(platform) when platform is provided', async () => {
      mockBroadcast.mockResolvedValueOnce(new Map([['telegram', 'm1']]));
      const result = await executeChannelTool(
        'broadcast_channel_message',
        { platform: 'telegram', chat_id: '999', text: 'fanout' },
        'user_a'
      );

      expect(mockBroadcast).toHaveBeenCalledWith('telegram', {
        platformChatId: '999',
        text: 'fanout',
      });
      expect(mockBroadcastAll).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      const payload = result.result as { deliveredCount: number };
      expect(payload.deliveredCount).toBe(1);
    });

    it('uses broadcastAll when platform is omitted', async () => {
      mockBroadcastAll.mockResolvedValueOnce(
        new Map([
          ['telegram', 'a'],
          ['discord', 'b'],
        ])
      );
      const result = await executeChannelTool(
        'broadcast_channel_message',
        { chat_id: '1', text: 'all' },
        'user_a'
      );

      expect(mockBroadcastAll).toHaveBeenCalled();
      expect(mockBroadcast).not.toHaveBeenCalled();
      const payload = result.result as { deliveredCount: number };
      expect(payload.deliveredCount).toBe(2);
    });
  });

  describe('list_channels', () => {
    it('returns the channel info shape', async () => {
      mockListChannels.mockReturnValueOnce([
        { pluginId: 'telegram', platform: 'telegram', name: 'My Bot', status: 'connected' },
        { pluginId: 'discord', platform: 'discord', name: 'D', status: 'disconnected' },
      ]);

      const result = await executeChannelTool('list_channels', {}, 'user_a');
      const payload = result.result as { count: number; channels: Array<{ id: string }> };
      expect(payload.count).toBe(2);
      expect(payload.channels[0].id).toBe('telegram');
    });

    it('filters to connected channels when connected_only=true', async () => {
      mockListChannels.mockReturnValueOnce([
        { pluginId: 'telegram', platform: 'telegram', name: 'A', status: 'connected' },
        { pluginId: 'discord', platform: 'discord', name: 'B', status: 'disconnected' },
      ]);

      const result = await executeChannelTool('list_channels', { connected_only: true }, 'user_a');
      const payload = result.result as { count: number; channels: Array<{ id: string }> };
      expect(payload.count).toBe(1);
      expect(payload.channels[0].id).toBe('telegram');
    });
  });

  describe('get_channel_inbox', () => {
    it('returns only inbound messages', async () => {
      mockGetInbox.mockResolvedValueOnce([
        {
          id: 'm1',
          channelId: 'telegram',
          direction: 'inbound',
          senderId: 'u1',
          senderName: 'Alice',
          content: 'hello',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'm2',
          channelId: 'telegram',
          direction: 'outbound',
          content: 'reply',
          createdAt: new Date('2026-01-01T00:01:00Z'),
        },
      ]);

      const result = await executeChannelTool('get_channel_inbox', {}, 'user_a');
      const payload = result.result as { count: number; messages: Array<{ id: string }> };
      expect(payload.messages).toHaveLength(1);
      expect(payload.messages[0].id).toBe('m1');
    });

    it('scopes by channel when provided and clamps limit', async () => {
      mockGetByChannel.mockResolvedValueOnce([]);
      await executeChannelTool('get_channel_inbox', { channel: 'telegram', limit: 500 }, 'user_a');
      expect(mockGetByChannel).toHaveBeenCalledWith('telegram', 100);
    });
  });

  describe('search_conversations', () => {
    it('calls ChatRepository.searchConversations and returns formatted results', async () => {
      mockSearchConversations.mockResolvedValueOnce([
        {
          id: 'conv-1',
          title: 'Project Discussion',
          agentName: 'Soul',
          provider: 'openai',
          model: 'gpt-4o',
          messageCount: 42,
          isArchived: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-15T00:00:00Z'),
          ftsRank: 0.9,
        },
      ]);

      const result = await executeChannelTool(
        'search_conversations',
        { query: 'project', limit: 20 },
        'user_a'
      );
      expect(mockSearchConversations).toHaveBeenCalledWith('project', { limit: 20 });
      const payload = result.result as { count: number; conversations: Array<{ id: string }> };
      expect(payload.count).toBe(1);
      expect(payload.conversations[0].id).toBe('conv-1');
    });

    it('rejects missing query', async () => {
      const result = await executeChannelTool('search_conversations', {}, 'user_a');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/i);
    });
  });

  describe('unknown tool', () => {
    it('returns an error', async () => {
      const result = await executeChannelTool('nope', {}, 'user_a');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown channel tool');
    });
  });
});
