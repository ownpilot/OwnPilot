/**
 * Channel Tools Tests
 *
 * Tests the channel tool executors (sendChannelMessage, listChannels)
 * and the channel manager injection mechanism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setChannelManager,
  sendChannelMessageExecutor,
  listChannelsExecutor,
  CHANNEL_TOOLS,
  CHANNEL_TOOL_NAMES,
} from './channel-tools.js';

// ---------------------------------------------------------------------------
// Mock channel manager
// ---------------------------------------------------------------------------

function createMockChannelManager() {
  return {
    send: vi.fn(async () => 'msg-123'),
    getAll: vi.fn(() => [
      { id: 'telegram:111', type: 'telegram', status: 'connected' },
      { id: 'discord:222', type: 'discord', status: 'disconnected' },
    ]),
    getByType: vi.fn((type: string) => {
      if (type === 'telegram') return [{ id: 'telegram:111', type: 'telegram', status: 'connected' }];
      if (type === 'discord') return [{ id: 'discord:222', type: 'discord', status: 'disconnected' }];
      return [];
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Channel Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset channel manager to null
    setChannelManager(null);
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
    it('returns error when channel manager not configured', async () => {
      const result = await sendChannelMessageExecutor({ message: 'hello' }, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).error).toContain('Channel manager not configured');
    });

    it('sends message to specified channelId', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelId: 'telegram:111' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.success).toBe(true);
      expect(content.messageId).toBe('msg-123');
      expect(manager.send).toHaveBeenCalledWith('telegram:111', {
        content: 'Hello!',
        channelId: 'telegram:111',
        replyToId: undefined,
      });
    });

    it('resolves channel by type when no channelId', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelType: 'telegram' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('telegram:111');
    });

    it('falls back to any connected channel', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!' },
        {} as any,
      );

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('telegram:111');
    });

    it('returns error when no connected channels available', async () => {
      const manager = createMockChannelManager();
      manager.getAll.mockReturnValue([
        { id: 'discord:222', type: 'discord', status: 'disconnected' },
      ]);
      manager.getByType.mockReturnValue([]);
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelType: 'slack' },
        {} as any,
      );

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).error).toContain('No connected channels');
    });

    it('passes replyToId when provided', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      await sendChannelMessageExecutor(
        { message: 'Reply', channelId: 'telegram:111', replyToId: 'orig-msg' },
        {} as any,
      );

      expect(manager.send).toHaveBeenCalledWith('telegram:111', {
        content: 'Reply',
        channelId: 'telegram:111',
        replyToId: 'orig-msg',
      });
    });

    it('handles send error gracefully', async () => {
      const manager = createMockChannelManager();
      manager.send.mockRejectedValue(new Error('Network timeout'));
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelId: 'telegram:111' },
        {} as any,
      );

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('Network timeout');
    });

    it('skips disconnected channels when resolving by type', async () => {
      const manager = createMockChannelManager();
      manager.getByType.mockReturnValue([
        { id: 'discord:222', type: 'discord', status: 'disconnected' },
      ]);
      manager.getAll.mockReturnValue([
        { id: 'telegram:111', type: 'telegram', status: 'connected' },
      ]);
      setChannelManager(manager);

      const result = await sendChannelMessageExecutor(
        { message: 'Hello!', channelType: 'discord' },
        {} as any,
      );

      // Should fall back to any connected channel
      const content = JSON.parse(result.content as string);
      expect(content.channelId).toBe('telegram:111');
    });
  });

  // ========================================================================
  // listChannelsExecutor
  // ========================================================================

  describe('listChannelsExecutor', () => {
    it('returns error when channel manager not configured', async () => {
      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).error).toContain('Channel manager not configured');
    });

    it('lists all channels', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.count).toBe(2);
      expect(content.channels).toHaveLength(2);
      expect(manager.getAll).toHaveBeenCalled();
    });

    it('filters by channel type', async () => {
      const manager = createMockChannelManager();
      setChannelManager(manager);

      const result = await listChannelsExecutor({ type: 'telegram' }, {} as any);

      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content as string);
      expect(content.count).toBe(1);
      expect(manager.getByType).toHaveBeenCalledWith('telegram');
    });

    it('handles list error gracefully', async () => {
      const manager = createMockChannelManager();
      manager.getAll.mockImplementation(() => { throw new Error('DB error'); });
      setChannelManager(manager);

      const result = await listChannelsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content as string).details).toContain('DB error');
    });
  });
});
