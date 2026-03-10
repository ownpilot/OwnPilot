/**
 * Channel Messaging Routes Tests
 *
 * Tests the send and reply endpoints for channel communication:
 * - POST /:id/send - Send message to a channel
 * - POST /:id/reply - Reply to a conversation from web UI
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock Channel Service
const mockSend = vi.fn();
const mockGetChannel = vi.fn();
const mockGetStatus = vi.fn();
const mockGetPlatform = vi.fn();

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ownpilot/core');
  return {
    ...actual,
    getChannelService: vi.fn().mockReturnValue({
      send: mockSend,
      getChannel: mockGetChannel,
    }),
    getDefaultPluginRegistry: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({
        manifest: {
          requiredServices: [{ name: 'telegram_bot' }],
        },
      }),
    }),
  };
});

// Mock ChannelMessagesRepository
const mockCreate = vi.fn();

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn().mockImplementation(function () {
    return {
      create: mockCreate,
    };
  }),
}));

// Mock config services repo
const mockGetFieldValue = vi.fn();

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: mockGetFieldValue,
  },
}));

// Mock WebSocket gateway
const mockBroadcast = vi.fn();

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

// Mock log
vi.mock('../services/log.js', () => ({
  getLog: vi.fn().mockReturnValue({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

// Import after mocks
const { channelMessagingRoutes } = await import('./channels-messaging.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', channelMessagingRoutes);
  app.onError(errorHandler);
  return app;
}

describe('channelMessagingRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChannel.mockReturnValue({
      getStatus: mockGetStatus.mockReturnValue('connected'),
      getPlatform: mockGetPlatform.mockReturnValue('telegram'),
    });
    mockSend.mockResolvedValue('msg_123');
  });

  describe('POST /:id/send', () => {
    it('sends message with text', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello world',
          chatId: '123456',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({
        messageId: 'msg_123',
        pluginId: 'telegram.bot1',
        chatId: '123456',
      });
      expect(mockSend).toHaveBeenCalledWith('telegram.bot1', {
        platformChatId: '123456',
        text: 'Hello world',
        replyToId: undefined,
      });
    });

    it('accepts content as alternative to text', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello via content',
          chatId: '123456',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledWith(
        'telegram.bot1',
        expect.objectContaining({
          text: 'Hello via content',
        })
      );
    });

    it('returns 400 when text is missing', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: '123456' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('text');
    });

    it('returns 404 when channel not found', async () => {
      mockGetChannel.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/unknown-channel/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', chatId: '123' }),
      });

      expect(res.status).toBe(404);
    });

    it('auto-resolves chatId from config my_phone', async () => {
      mockGetFieldValue.mockImplementation((service, field) => {
        if (field === 'my_phone') return '+1234567890';
        return null;
      });

      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      });

      expect(res.status).toBe(200);
      expect(mockGetFieldValue).toHaveBeenCalledWith('telegram_bot', 'my_phone');
      expect(mockSend).toHaveBeenCalledWith(
        'telegram.bot1',
        expect.objectContaining({
          platformChatId: '+1234567890',
        })
      );
    });

    it('falls back to allowed_users when my_phone not set', async () => {
      mockGetFieldValue.mockImplementation((service, field) => {
        if (field === 'my_phone') return null;
        if (field === 'allowed_users') return 'user1, user2, user3';
        return null;
      });

      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      });

      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledWith(
        'telegram.bot1',
        expect.objectContaining({
          platformChatId: 'user1',
        })
      );
    });

    it('returns 400 when chatId cannot be resolved', async () => {
      mockGetFieldValue.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('chatId is required');
    });

    it('supports replyToId for threaded messages', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Reply message',
          chatId: '123456',
          replyToId: 'msg_456',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledWith(
        'telegram.bot1',
        expect.objectContaining({
          replyToId: 'msg_456',
        })
      );
    });

    it('handles send errors', async () => {
      mockSend.mockRejectedValue(new Error('Network timeout'));

      const app = createApp();
      const res = await app.request('/telegram.bot1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', chatId: '123' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('SEND_FAILED');
    });
  });

  describe('POST /:id/reply', () => {
    it('sends reply and saves to database', async () => {
      mockSend.mockResolvedValue('platform_msg_123');
      mockCreate.mockResolvedValue({ id: 'telegram.bot1:reply:platform_msg_123' });

      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Reply from web UI',
          platformChatId: '123456',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({
        messageId: 'telegram.bot1:reply:platform_msg_123',
        platformMessageId: 'platform_msg_123',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'telegram.bot1:reply:platform_msg_123',
          channelId: 'telegram.bot1',
          direction: 'outbound',
          senderId: 'web-ui',
          senderName: 'You',
          content: 'Reply from web UI',
        })
      );

      expect(mockBroadcast).toHaveBeenCalledWith(
        'channel:message',
        expect.objectContaining({
          id: 'telegram.bot1:reply:platform_msg_123',
          channelId: 'telegram.bot1',
          sender: 'You',
          content: 'Reply from web UI',
          direction: 'outgoing',
        })
      );
    });

    it('returns 400 when channel not connected', async () => {
      mockGetStatus.mockReturnValue('disconnected');

      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          platformChatId: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('CONNECTION_FAILED');
    });

    it('returns 400 when text is empty', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '   ',
          platformChatId: '123456',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when text exceeds 4096 characters', async () => {
      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'a'.repeat(4097),
          platformChatId: '123456',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('4096');
    });

    it('returns 400 when platformChatId missing', async () => {
      mockGetFieldValue.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('platformChatId is required');
    });

    it('continues even if database save fails', async () => {
      mockSend.mockResolvedValue('platform_msg_123');
      mockCreate.mockRejectedValue(new Error('DB connection failed'));

      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test message',
          platformChatId: '123456',
        }),
      });

      // Should still succeed even if DB save failed
      expect(res.status).toBe(200);
    });

    it('supports replyToMessageId for threading', async () => {
      mockSend.mockResolvedValue('platform_msg_456');
      mockCreate.mockResolvedValue({ id: 'telegram.bot1:reply:platform_msg_456' });

      const app = createApp();
      await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Threaded reply',
          platformChatId: '123456',
          replyToMessageId: 'original_msg_123',
        }),
      });

      expect(mockSend).toHaveBeenCalledWith(
        'telegram.bot1',
        expect.objectContaining({
          replyToId: 'original_msg_123',
        })
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToId: 'original_msg_123',
        })
      );
    });

    it('handles send errors', async () => {
      mockSend.mockRejectedValue(new Error('Send failed'));

      const app = createApp();
      const res = await app.request('/telegram.bot1/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Test',
          platformChatId: '123456',
        }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('SEND_FAILED');
    });
  });
});
