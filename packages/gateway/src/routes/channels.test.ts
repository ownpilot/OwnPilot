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
const telegram2Api = mockChannelApi('telegram');

const mockService = {
  listChannels: vi.fn(() => [
    {
      pluginId: 'channel.telegram',
      platform: 'telegram',
      name: 'Telegram',
      status: 'connected',
      icon: 'telegram',
    },
    {
      pluginId: 'channel.telegram-2',
      platform: 'telegram',
      name: 'Telegram 2',
      status: 'connected',
      icon: 'telegram',
    },
  ]),
  getChannel: vi.fn((id: string) => {
    if (id === 'channel.telegram') return telegramApi;
    if (id === 'channel.telegram-2') return telegram2Api;
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

const mockPlugin = {
  manifest: {
    id: 'channel.telegram',
    name: 'Telegram',
    category: 'channel',
    requiredServices: [{ name: 'telegram_bot' }],
  },
  status: 'enabled',
  api: telegramApi,
};

const mockRegistry = {
  get: vi.fn((id: string) => (id === 'channel.telegram' ? mockPlugin : undefined)),
  getAll: vi.fn(() => [mockPlugin]),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getChannelService: () => mockService,
    getDefaultPluginRegistry: async () => mockRegistry,
  };
});

const mockChannelMessagesRepo = {
  getByChannel: vi.fn(async () => []),
  getAll: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  deleteAll: vi.fn(async () => 5),
  deleteByChannel: vi.fn(async () => 3),
};

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn(function () {
    return mockChannelMessagesRepo;
  }),
}));

const mockConfigServicesRepo = {
  getDefaultEntry: vi.fn(),
  updateEntry: vi.fn(),
  createEntry: vi.fn(),
  getFieldValue: vi.fn(),
};

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

const mockRefreshChannelApi = vi.fn();

vi.mock('../plugins/init.js', () => ({
  refreshChannelApi: (...args: unknown[]) => mockRefreshChannelApi(...args),
}));

const mockWsGateway = { broadcast: vi.fn() };

vi.mock('../ws/server.js', () => ({
  wsGateway: mockWsGateway,
}));

// Import after mocks
const { channelRoutes } = await import('./channels.js');

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
      {
        pluginId: 'channel.telegram',
        platform: 'telegram',
        name: 'Telegram',
        status: 'connected',
        icon: 'telegram',
      },
      {
        pluginId: 'channel.telegram-2',
        platform: 'telegram',
        name: 'Telegram 2',
        status: 'connected',
        icon: 'telegram',
      },
    ]);
    mockService.getChannel.mockImplementation((id: string) => {
      if (id === 'channel.telegram') return telegramApi;
      if (id === 'channel.telegram-2') return telegram2Api;
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
      expect(json.data.byPlatform.telegram).toBe(2);
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
      expect(json.data.channels[0].type).toBe('telegram');
      expect(json.data.channels[1].id).toBe('channel.telegram-2');
      expect(json.data.summary).toBeDefined();
      expect(json.data.summary.total).toBe(2);
      expect(json.data.summary.connected).toBe(2);
      expect(json.data.summary.disconnected).toBe(0);
      expect(json.data.availableTypes).toContain('telegram');
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
      expect(json.data.type).toBe('telegram');
      expect(json.data.name).toBe('Telegram');
      expect(json.data.status).toBe('connected');
      expect(json.data.icon).toBe('telegram');
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

  describe('message inbox (DB-backed)', () => {
    it('returns inbox with messages structure', async () => {
      mockChannelMessagesRepo.getAll.mockResolvedValue([]);

      const res = await app.request('/channels/messages/inbox');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.messages).toBeDefined();
      expect(Array.isArray(json.data.messages)).toBe(true);
      expect(typeof json.data.total).toBe('number');
    });

    it('returns incoming messages from DB', async () => {
      mockChannelMessagesRepo.getAll.mockResolvedValue([
        {
          id: 'inbox-msg-1',
          channelId: 'channel.telegram',
          direction: 'inbound',
          senderId: 'user-1',
          senderName: 'Alice',
          content: 'Hello from Telegram!',
          contentType: 'text',
          metadata: {},
          createdAt: new Date('2026-01-31T10:00:00Z'),
        },
      ]);

      const res = await app.request('/channels/messages/inbox');
      const json = await res.json();

      const msg = json.data.messages.find((m: { id: string }) => m.id === 'inbox-msg-1');
      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello from Telegram!');
      expect(msg.direction).toBe('incoming');
      expect(msg.sender.id).toBe('user-1');
      expect(msg.sender.name).toBe('Alice');
    });

    it('returns outgoing messages from DB', async () => {
      mockChannelMessagesRepo.getAll.mockResolvedValue([
        {
          id: 'outbox-msg-1',
          channelId: 'channel.telegram',
          direction: 'outbound',
          senderId: 'assistant',
          senderName: 'Assistant',
          content: 'Hello from Assistant!',
          contentType: 'text',
          replyToId: 'inbox-msg-1',
          metadata: {},
          createdAt: new Date('2026-01-31T10:00:01Z'),
        },
      ]);

      const res = await app.request('/channels/messages/inbox');
      const json = await res.json();

      const msg = json.data.messages.find((m: { id: string }) => m.id === 'outbox-msg-1');
      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello from Assistant!');
      expect(msg.direction).toBe('outgoing');
      expect(msg.sender.id).toBe('assistant');
      expect(msg.read).toBe(true);
    });

    it('passes channelId filter to repository', async () => {
      mockChannelMessagesRepo.getAll.mockResolvedValue([]);

      await app.request('/channels/messages/inbox?channelId=channel.telegram');

      expect(mockChannelMessagesRepo.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'channel.telegram' })
      );
    });

    it('marks a message as read', async () => {
      const res = await app.request('/channels/messages/inbox-msg-read/read', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.read).toBe(true);
      expect(json.data.messageId).toBe('inbox-msg-read');
    });

    it('marked messages appear as read in subsequent inbox fetch', async () => {
      // Mark a message as read
      await app.request('/channels/messages/msg-to-read/read', { method: 'POST' });

      // Fetch inbox — the marked message should have read: true
      mockChannelMessagesRepo.getAll.mockResolvedValueOnce([
        {
          id: 'msg-to-read',
          channelId: 'channel.telegram',
          direction: 'inbound',
          content: 'test',
          senderId: 'user-1',
          senderName: 'User',
          replyToId: null,
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      const inboxRes = await app.request('/channels/messages/inbox');
      const inbox = await inboxRes.json();
      const msg = inbox.data.messages.find((m: { id: string }) => m.id === 'msg-to-read');
      expect(msg).toBeDefined();
      expect(msg.read).toBe(true);
    });

    it('returns 500 on DB failure', async () => {
      mockChannelMessagesRepo.getAll.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/channels/messages/inbox');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });
  });

  // ========================================================================
  // POST /channels/:id/setup
  // ========================================================================

  describe('POST /channels/:id/setup', () => {
    it('creates config entry and connects when no existing entry', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: '123:ABC' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pluginId).toBe('channel.telegram');
      expect(json.data.status).toBe('connected');

      // Should create entry
      expect(mockConfigServicesRepo.createEntry).toHaveBeenCalledWith('telegram_bot', {
        label: 'Default',
        data: { bot_token: '123:ABC' },
      });
      expect(mockConfigServicesRepo.updateEntry).not.toHaveBeenCalled();

      // Should refresh API and connect
      expect(mockRefreshChannelApi).toHaveBeenCalledWith('channel.telegram');
      expect(mockService.connect).toHaveBeenCalledWith('channel.telegram');

      // Should broadcast config change
      expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({
          entity: 'config_service',
          action: 'created',
          id: 'telegram_bot',
        })
      );
    });

    it('updates existing config entry', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
        id: 'entry-1',
        data: { bot_token: 'old-token' },
      });

      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: 'new-token' } }),
      });

      expect(res.status).toBe(200);
      expect(mockConfigServicesRepo.updateEntry).toHaveBeenCalledWith('entry-1', {
        data: { bot_token: 'new-token' },
      });
      expect(mockConfigServicesRepo.createEntry).not.toHaveBeenCalled();

      expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({
          action: 'updated',
        })
      );
    });

    it('returns 404 for unknown pluginId', async () => {
      const res = await app.request('/channels/channel.unknown/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: '123:ABC' } }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when config is missing', async () => {
      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when config is not an object', async () => {
      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'not-an-object' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 on connection failure', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      mockService.connect.mockRejectedValueOnce(new Error('Bot token invalid'));

      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: 'bad-token' } }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CONNECTION_FAILED');
      expect(json.error.message).toContain('Bot token invalid');
    });

    it('includes botInfo when available', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      // Make getChannel return an API with getBotInfo
      const apiWithBot = {
        ...telegramApi,
        getBotInfo: vi.fn(() => ({ username: 'mybot', firstName: 'My Bot' })),
      };
      mockService.getChannel.mockReturnValue(apiWithBot);

      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: '123:ABC' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.botInfo).toEqual({ username: 'mybot', firstName: 'My Bot' });
    });

    it('disconnects before connecting (best-effort)', async () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      mockService.disconnect.mockRejectedValueOnce(new Error('already disconnected'));

      const res = await app.request('/channels/channel.telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { bot_token: '123:ABC' } }),
      });

      // Should still succeed — disconnect error is swallowed
      expect(res.status).toBe(200);
      expect(mockService.disconnect).toHaveBeenCalledWith('channel.telegram');
      expect(mockService.connect).toHaveBeenCalledWith('channel.telegram');
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

      expect(mockChannelMessagesRepo.getByChannel).toHaveBeenCalledWith('channel.telegram', 10, 5);
    });

    it('returns 500 on fetch failure', async () => {
      mockChannelMessagesRepo.getByChannel.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/channels/channel.telegram/messages');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /channels/messages — Clear messages
  // ---------------------------------------------------------------------------

  describe('DELETE /channels/messages', () => {
    it('clears all messages when no channelId is given', async () => {
      mockChannelMessagesRepo.deleteAll.mockResolvedValue(5);

      const res = await app.request('/channels/messages', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(5);
      expect(mockChannelMessagesRepo.deleteAll).toHaveBeenCalled();
      expect(mockChannelMessagesRepo.deleteByChannel).not.toHaveBeenCalled();
    });

    it('clears messages for specific channel when channelId is given', async () => {
      mockChannelMessagesRepo.deleteByChannel.mockResolvedValue(3);

      const res = await app.request('/channels/messages?channelId=channel.telegram', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(3);
      expect(mockChannelMessagesRepo.deleteByChannel).toHaveBeenCalledWith('channel.telegram');
      expect(mockChannelMessagesRepo.deleteAll).not.toHaveBeenCalled();
    });

    it('broadcasts WebSocket event on clear', async () => {
      const res = await app.request('/channels/messages', { method: 'DELETE' });

      expect(res.status).toBe(200);
      expect(mockWsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'channel',
        action: 'deleted',
      });
    });

    it('returns 500 on DB error', async () => {
      mockChannelMessagesRepo.deleteAll.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/channels/messages', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
