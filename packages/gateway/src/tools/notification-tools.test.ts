/**
 * Tests for Notification Tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const mockChannelService = {
  send: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    getServiceRegistry: () => ({
      get: (token: { name: string }) => {
        if (token.name === 'channel') return mockChannelService;
        return {};
      },
    }),
    Services: { Channel: { name: 'channel' } },
  };
});

const mockChannelUsersRepo = {
  findByOwnpilotUser: vi.fn().mockResolvedValue([]),
};
vi.mock('../db/repositories/channel-users.js', () => ({
  createChannelUsersRepository: () => mockChannelUsersRepo,
}));

const mockSessionsRepo = {
  listByUser: vi.fn().mockResolvedValue([]),
};
vi.mock('../db/repositories/channel-sessions.js', () => ({
  createChannelSessionsRepository: () => mockSessionsRepo,
}));

const {
  NOTIFICATION_TOOLS,
  executeNotificationTool,
  sendTelegramMessage,
  setNotificationBroadcaster,
} = await import('./notification-tools.js');

// ============================================================================
// Tests
// ============================================================================

describe('notification-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset broadcaster between tests
    setNotificationBroadcaster(undefined as any);
  });

  // ==========================================================================
  // Tool definitions
  // ==========================================================================

  describe('NOTIFICATION_TOOLS', () => {
    it('exports one tool definition', () => {
      expect(NOTIFICATION_TOOLS).toHaveLength(1);
    });

    it('defines send_user_notification with correct schema', () => {
      const tool = NOTIFICATION_TOOLS[0]!;
      expect(tool.name).toBe('send_user_notification');
      expect(tool.category).toBe('Automation');
      expect(tool.parameters.required).toContain('message');
      expect(tool.parameters.properties).toHaveProperty('message');
      expect(tool.parameters.properties).toHaveProperty('urgency');
    });

    it('marks tool as not workflow-usable', () => {
      expect(NOTIFICATION_TOOLS[0]!.workflowUsable).toBe(false);
    });
  });

  // ==========================================================================
  // sendTelegramMessage
  // ==========================================================================

  describe('sendTelegramMessage', () => {
    it('returns false when no Telegram user is linked', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([]);

      const result = await sendTelegramMessage('user-1', 'Hello');

      expect(result).toBe(false);
      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('returns false when no active session exists', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: false, platformChatId: 'chat-1' },
      ]);

      const result = await sendTelegramMessage('user-1', 'Hello');

      expect(result).toBe(false);
      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('sends via channel service when Telegram user and session exist', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: true, platformChatId: 'chat-42' },
      ]);

      const result = await sendTelegramMessage('user-1', 'Good morning!');

      expect(result).toBe(true);
      expect(mockChannelService.send).toHaveBeenCalledWith('channel.telegram', {
        platformChatId: 'chat-42',
        text: 'Good morning!',
      });
    });

    it('picks the first active session', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: false, platformChatId: 'chat-old' },
        { isActive: true, platformChatId: 'chat-new' },
      ]);

      await sendTelegramMessage('user-1', 'Test');

      expect(mockChannelService.send).toHaveBeenCalledWith(
        'channel.telegram',
        expect.objectContaining({ platformChatId: 'chat-new' })
      );
    });

    it('ignores non-telegram channel users', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'discord' },
        { id: 'cu-2', platform: 'slack' },
      ]);

      const result = await sendTelegramMessage('user-1', 'Hello');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockRejectedValueOnce(new Error('DB down'));

      const result = await sendTelegramMessage('user-1', 'Hello');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // executeNotificationTool
  // ==========================================================================

  describe('executeNotificationTool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeNotificationTool('unknown_tool', { message: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown notification tool');
    });

    it('returns error when message is empty', async () => {
      const result = await executeNotificationTool('send_user_notification', { message: '' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Message is required');
    });

    it('returns error when message is whitespace', async () => {
      const result = await executeNotificationTool('send_user_notification', { message: '   ' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Message is required');
    });

    it('returns error when message is missing', async () => {
      const result = await executeNotificationTool('send_user_notification', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Message is required');
    });

    it('sends via Telegram with low urgency emoji by default', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: true, platformChatId: 'chat-1' },
      ]);

      const result = await executeNotificationTool(
        'send_user_notification',
        { message: 'All quiet today' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockChannelService.send).toHaveBeenCalledWith(
        'channel.telegram',
        expect.objectContaining({ text: expect.stringContaining('All quiet today') })
      );
      // Low urgency uses speech bubble emoji
      const sentText = mockChannelService.send.mock.calls[0][1].text;
      expect(sentText).toMatch(/^💬/);
    });

    it('uses warning emoji for high urgency', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: true, platformChatId: 'chat-1' },
      ]);

      await executeNotificationTool(
        'send_user_notification',
        { message: 'Deadline approaching!', urgency: 'high' },
        'user-1'
      );

      const sentText = mockChannelService.send.mock.calls[0][1].text;
      expect(sentText).toMatch(/^⚠️/);
    });

    it('uses info emoji for medium urgency', async () => {
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: true, platformChatId: 'chat-1' },
      ]);

      await executeNotificationTool(
        'send_user_notification',
        { message: 'Habit reminder', urgency: 'medium' },
        'user-1'
      );

      const sentText = mockChannelService.send.mock.calls[0][1].text;
      expect(sentText).toMatch(/^ℹ️/);
    });

    it('broadcasts via WebSocket when broadcaster is set', async () => {
      const broadcaster = vi.fn();
      setNotificationBroadcaster(broadcaster);

      const result = await executeNotificationTool(
        'send_user_notification',
        { message: 'Hello from pulse' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(broadcaster).toHaveBeenCalledWith('system:notification', {
        type: 'info',
        message: 'Hello from pulse',
        action: 'pulse_notification',
        data: { urgency: 'low' },
      });
      expect((result.result as any).delivered).toContain('websocket');
    });

    it('uses warning type for high urgency WS broadcast', async () => {
      const broadcaster = vi.fn();
      setNotificationBroadcaster(broadcaster);

      await executeNotificationTool(
        'send_user_notification',
        { message: 'Alert!', urgency: 'high' },
        'user-1'
      );

      expect(broadcaster).toHaveBeenCalledWith(
        'system:notification',
        expect.objectContaining({ type: 'warning' })
      );
    });

    it('reports both telegram and websocket deliveries', async () => {
      const broadcaster = vi.fn();
      setNotificationBroadcaster(broadcaster);
      mockChannelUsersRepo.findByOwnpilotUser.mockResolvedValueOnce([
        { id: 'cu-1', platform: 'telegram' },
      ]);
      mockSessionsRepo.listByUser.mockResolvedValueOnce([
        { isActive: true, platformChatId: 'chat-1' },
      ]);

      const result = await executeNotificationTool(
        'send_user_notification',
        { message: 'Both channels' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const delivered = (result.result as any).delivered;
      expect(delivered).toContain('telegram');
      expect(delivered).toContain('websocket');
      expect((result.result as any).message).toContain('telegram, websocket');
    });

    it('succeeds with no delivery channels', async () => {
      // No Telegram, no broadcaster
      const result = await executeNotificationTool(
        'send_user_notification',
        { message: 'No channels' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as any).delivered).toEqual([]);
      expect((result.result as any).message).toContain('No delivery channels');
    });

    it('handles WS broadcaster failure gracefully', async () => {
      const broadcaster = vi.fn().mockImplementation(() => {
        throw new Error('WS failed');
      });
      setNotificationBroadcaster(broadcaster);

      const result = await executeNotificationTool(
        'send_user_notification',
        { message: 'Should not crash' },
        'user-1'
      );

      expect(result.success).toBe(true);
      // WS failed but Telegram also not set up — only empty deliveries
      expect((result.result as any).delivered).toEqual([]);
    });

    it('defaults userId to "default" when not provided', async () => {
      await executeNotificationTool('send_user_notification', { message: 'test' });

      expect(mockChannelUsersRepo.findByOwnpilotUser).toHaveBeenCalledWith('default');
    });
  });

  // ==========================================================================
  // setNotificationBroadcaster
  // ==========================================================================

  describe('setNotificationBroadcaster', () => {
    it('sets broadcaster used by executeNotificationTool', async () => {
      const broadcaster = vi.fn();
      setNotificationBroadcaster(broadcaster);

      await executeNotificationTool(
        'send_user_notification',
        { message: 'test broadcast' },
        'user-1'
      );

      expect(broadcaster).toHaveBeenCalledTimes(1);
    });
  });
});
