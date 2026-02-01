/**
 * Channels Routes Tests
 *
 * Integration tests for the channels API endpoints.
 * Mocks getChannelService() from @ownpilot/core and ChannelMessagesRepository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock IChannelService
// ---------------------------------------------------------------------------

const mockChannelApi = (platform: string, status = 'connected') => ({
  getPlatform: vi.fn(() => platform),
  getStatus: vi.fn(() => status),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendMessage: vi.fn(async () => 'msg-sent-001'),
});

const telegramApi = mockChannelApi('telegram');
const discordApi = mockChannelApi('discord');

const mockService = {
  listChannels: vi.fn(() => [
    { pluginId: 'channel.telegram', platform: 'telegram', name: 'Telegram', status: 'connected', icon: 'telegram' },
    { pluginId: 'channel.discord', platform: 'discord', name: 'Discord', status: 'connected', icon: 'discord' },
  ]),
  getChannel: vi.fn((id: string) => {
    if (id === 'channel.telegram') return telegramApi;
    if (id === 'channel.discord') return discordApi;
    return undefined;
  }),
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(async () => 'msg-sent-001'),
  broadcast: vi.fn(),
  broadcastAll: vi.fn(),
  getByPlatform: vi.fn(() => []),
  resolveUser: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getChannelService: () => mockService,
  };
});

const mockChannelMessagesRepo = {
  getByChannel: vi.fn(async () => []),
};

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn().mockImplementation(() => mockChannelMessagesRepo),
}));

// Import after mocks
const { channelRoutes, addIncomingMessage } = await import('./channels.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/channels', channelRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Channels Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.listChannels.mockReturnValue([
      { pluginId: 'channel.telegram', platform: 'telegram', name: 'Telegram', status: 'connected', icon: 'telegram' },
      { pluginId: 'channel.discord', platform: 'discord', name: 'Discord', status: 'connected', icon: 'discord' },
    ]);
    mockService.getChannel.mockImplementation((id: string) => {
      if (id === 'channel.telegram') return telegramApi;
      if (id === 'channel.discord') return discordApi;
      return undefined;
    });
    mockService.send.mockResolvedValue('msg-sent-001');
    app = createApp();
  });

  // ========================================================================
  // GET /channels/status
  // ========================================================================

  describe('GET /channels/status', () => {
    it('returns channel status summary', async () => {
      const res = await app.request('/channels/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(2);
      expect(json.data.connected).toBe(2);
      expect(json.data.byPlatform).toBeDefined();
      expect(json.data.byPlatform.telegram).toBe(1);
      expect(json.data.byPlatform.discord).toBe(1);
    });
  });

  // ========================================================================
  // GET /channels
  // ========================================================================

  describe('GET /channels', () => {
    it('returns list of channels with summary', async () => {
      const res = await app.request('/channels');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.channels).toHaveLength(2);
      expect(json.data.channels[0].id).toBe('channel.telegram');
      expect(json.data.channels[0].platform).toBe('telegram');
      expect(json.data.channels[1].id).toBe('channel.discord');
      expect(json.data.summary).toBeDefined();
      expect(json.data.summary.total).toBe(2);
      expect(json.data.summary.connected).toBe(2);
      expect(json.data.availablePlatforms).toContain('telegram');
      expect(json.data.availablePlatforms).toContain('discord');
    });
  });

  // ========================================================================
  // POST /channels/:id/connect
  // ========================================================================

  describe('POST /channels/:id/connect', () => {
    it('connects a channel plugin', async () => {
      const res = await app.request('/channels/channel.telegram/connect', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.pluginId).toBe('channel.telegram');
      expect(json.data.status).toBe('connected');
      expect(mockService.connect).toHaveBeenCalledWith('channel.telegram');
    });

    it('returns 500 on connection failure', async () => {
      mockService.connect.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await app.request('/channels/channel.telegram/connect', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CONNECTION_FAILED');
      expect(json.error.message).toContain('Connection refused');
    });
  });

  // ========================================================================
  // POST /channels/:id/disconnect
  // ========================================================================

  describe('POST /channels/:id/disconnect', () => {
    it('disconnects a channel plugin', async () => {
      const res = await app.request('/channels/channel.telegram/disconnect', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.pluginId).toBe('channel.telegram');
      expect(json.data.status).toBe('disconnected');
      expect(mockService.disconnect).toHaveBeenCalledWith('channel.telegram');
    });

    it('returns 500 on disconnect failure', async () => {
      mockService.disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

      const res = await app.request('/channels/channel.telegram/disconnect', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DISCONNECT_FAILED');
    });
  });

  // ========================================================================
  // GET /channels/:id
  // ========================================================================

  describe('GET /channels/:id', () => {
    it('returns channel details', async () => {
      const res = await app.request('/channels/channel.telegram');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('channel.telegram');
      expect(json.data.platform).toBe('telegram');
      expect(json.data.status).toBe('connected');
    });

    it('returns 404 for unknown channel', async () => {
      const res = await app.request('/channels/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /channels/:id/send
  // ========================================================================

  describe('POST /channels/:id/send', () => {
    it('sends a message to a channel', async () => {
      const res = await app.request('/channels/channel.telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello from API!', chatId: '12345' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.messageId).toBe('msg-sent-001');
      expect(json.data.pluginId).toBe('channel.telegram');
      expect(json.data.chatId).toBe('12345');
      expect(mockService.send).toHaveBeenCalledWith('channel.telegram', {
        platformChatId: '12345',
        text: 'Hello from API!',
        replyToId: undefined,
      });
    });

    it('sends with replyToId', async () => {
      const res = await app.request('/channels/channel.telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Reply!', chatId: '12345', replyToId: 'orig-msg' }),
      });

      expect(res.status).toBe(200);
      expect(mockService.send).toHaveBeenCalledWith('channel.telegram', {
        platformChatId: '12345',
        text: 'Reply!',
        replyToId: 'orig-msg',
      });
    });

    it('returns 404 for unknown channel', async () => {
      const res = await app.request('/channels/nonexistent/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello!', chatId: '123' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when text is missing', async () => {
      const res = await app.request('/channels/channel.telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: '123' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when chatId is missing', async () => {
      const res = await app.request('/channels/channel.telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello!' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 on send failure', async () => {
      mockService.send.mockRejectedValueOnce(new Error('Send failed'));

      const res = await app.request('/channels/channel.telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Will fail', chatId: '123' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('SEND_FAILED');
    });
  });

  // ========================================================================
  // GET /channels/messages/inbox & POST /channels/messages/:messageId/read
  // ========================================================================

  describe('message inbox', () => {
    it('returns inbox with messages structure', async () => {
      const res = await app.request('/channels/messages/inbox');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.messages).toBeDefined();
      expect(Array.isArray(json.data.messages)).toBe(true);
      expect(typeof json.data.total).toBe('number');
    });

    it('includes messages added via addIncomingMessage', async () => {
      addIncomingMessage('channel.telegram', 'telegram', {
        id: 'inbox-msg-1',
        sender: { id: 'user-1', name: 'Alice' },
        content: 'Hello from Telegram!',
        timestamp: '2026-01-31T10:00:00Z',
      });

      const res = await app.request('/channels/messages/inbox');
      const json = await res.json();

      const msg = json.data.messages.find((m: { id: string }) => m.id === 'inbox-msg-1');
      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello from Telegram!');
      expect(msg.read).toBe(false);
      expect(msg.replied).toBe(false);
    });

    it('filters messages by platform', async () => {
      addIncomingMessage('channel.discord', 'discord', {
        id: 'inbox-msg-d1',
        sender: { id: 'user-2', name: 'Bob' },
        content: 'Discord message',
        timestamp: '2026-01-31T10:00:05Z',
      });

      const res = await app.request('/channels/messages/inbox?platform=discord');
      const json = await res.json();

      expect(
        json.data.messages.every((m: { platform: string }) => m.platform === 'discord')
      ).toBe(true);
    });

    it('marks a message as read', async () => {
      addIncomingMessage('channel.telegram', 'telegram', {
        id: 'inbox-msg-read',
        sender: { id: 'user-1', name: 'Alice' },
        content: 'Read me',
        timestamp: '2026-01-31T10:00:10Z',
      });

      const res = await app.request('/channels/messages/inbox-msg-read/read', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.read).toBe(true);
      expect(json.data.messageId).toBe('inbox-msg-read');
    });

    it('returns 404 when marking unknown message as read', async () => {
      const res = await app.request('/channels/messages/unknown-msg/read', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /channels/:id/messages
  // ========================================================================

  describe('GET /channels/:id/messages', () => {
    it('returns messages for a channel', async () => {
      mockChannelMessagesRepo.getByChannel.mockResolvedValue([
        { id: 'msg-1', content: 'Hello', timestamp: '2026-01-31T10:00:00Z' },
      ]);

      const res = await app.request('/channels/channel.telegram/messages');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.messages).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('supports limit and offset', async () => {
      mockChannelMessagesRepo.getByChannel.mockResolvedValue([]);

      await app.request('/channels/channel.telegram/messages?limit=10&offset=5');

      expect(mockChannelMessagesRepo.getByChannel).toHaveBeenCalledWith(
        'channel.telegram',
        10,
        5,
      );
    });

    it('returns 500 on fetch failure', async () => {
      mockChannelMessagesRepo.getByChannel.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/channels/channel.telegram/messages');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });
  });
});
