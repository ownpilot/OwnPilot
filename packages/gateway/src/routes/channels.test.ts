/**
 * Channels Routes Tests
 *
 * Integration tests for the channels API endpoints.
 * Mocks channelManager, channelsRepo, and ChannelMessagesRepository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleAdapter = {
  id: 'telegram-123',
  type: 'telegram',
  name: 'My Telegram Bot',
  status: 'connected',
};

const sampleAdapter2 = {
  id: 'discord-456',
  type: 'discord',
  name: 'My Discord Bot',
  status: 'connected',
};

const mockChannelManager = {
  getStatus: vi.fn(() => ({
    totalChannels: 2,
    connectedChannels: 2,
    channels: { 'telegram-123': 'connected', 'discord-456': 'connected' },
  })),
  getAll: vi.fn(() => [sampleAdapter, sampleAdapter2]),
  get: vi.fn((id: string) => {
    if (id === 'telegram-123') return sampleAdapter;
    if (id === 'discord-456') return sampleAdapter2;
    return null;
  }),
  has: vi.fn((id: string) => id === 'telegram-123' || id === 'discord-456'),
  connect: vi.fn(async (config: Record<string, unknown>) => ({
    id: config.id,
    type: config.type,
    name: config.name,
    status: 'connected',
  })),
  disconnect: vi.fn(async () => undefined),
  send: vi.fn(async () => 'msg-sent-001'),
};

const mockChannelsRepo = {
  getById: vi.fn(async () => null),
  create: vi.fn(async () => undefined),
  updateStatus: vi.fn(() => undefined),
  delete: vi.fn(() => undefined),
};

const mockChannelMessagesRepo = {
  getByChannel: vi.fn(async () => []),
};

vi.mock('../channels/index.js', () => ({
  channelManager: mockChannelManager,
}));

vi.mock('../db/repositories/channels.js', () => ({
  channelsRepo: mockChannelsRepo,
}));

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
    mockChannelManager.getAll.mockReturnValue([sampleAdapter, sampleAdapter2]);
    mockChannelManager.get.mockImplementation((id: string) => {
      if (id === 'telegram-123') return sampleAdapter;
      if (id === 'discord-456') return sampleAdapter2;
      return null;
    });
    mockChannelManager.has.mockImplementation(
      (id: string) => id === 'telegram-123' || id === 'discord-456'
    );
    mockChannelsRepo.getById.mockResolvedValue(null);
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
      expect(json.data.totalChannels).toBe(2);
      expect(json.data.connectedChannels).toBe(2);
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
      expect(json.data.channels[0].id).toBe('telegram-123');
      expect(json.data.channels[1].id).toBe('discord-456');
      expect(json.data.summary).toBeDefined();
      expect(json.data.availableTypes).toContain('telegram');
      expect(json.data.availableTypes).toContain('discord');
    });
  });

  // ========================================================================
  // POST /channels
  // ========================================================================

  describe('POST /channels', () => {
    it('connects a new channel', async () => {
      mockChannelManager.has.mockImplementation((id: string) => {
        if (id === 'webchat-new') return false;
        return id === 'telegram-123' || id === 'discord-456';
      });

      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'webchat-new',
          type: 'webchat',
          name: 'New Webchat',
          config: {},
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('webchat-new');
      expect(json.data.status).toBe('connected');
      expect(mockChannelsRepo.create).toHaveBeenCalled();
    });

    it('returns 400 when type is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Type', config: {} }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'webchat', config: {} }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 when channel exists in memory', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'telegram-123',
          type: 'telegram',
          name: 'Duplicate',
          config: {},
        }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('CHANNEL_EXISTS');
    });

    it('returns 409 when channel exists in database', async () => {
      mockChannelManager.has.mockReturnValue(false);
      mockChannelsRepo.getById.mockResolvedValue({ id: 'db-channel', type: 'telegram' });

      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'db-channel',
          type: 'telegram',
          name: 'DB Duplicate',
          config: {},
        }),
      });

      expect(res.status).toBe(409);
    });

    it('returns 500 on connection failure', async () => {
      mockChannelManager.has.mockReturnValue(false);
      mockChannelsRepo.getById.mockResolvedValue(null);
      mockChannelManager.connect.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'fail-channel',
          type: 'telegram',
          name: 'Fail Channel',
          config: {},
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CONNECTION_FAILED');
    });
  });

  // ========================================================================
  // GET /channels/:id
  // ========================================================================

  describe('GET /channels/:id', () => {
    it('returns channel details', async () => {
      const res = await app.request('/channels/telegram-123');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('telegram-123');
      expect(json.data.type).toBe('telegram');
      expect(json.data.name).toBe('My Telegram Bot');
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
  // DELETE /channels/:id
  // ========================================================================

  describe('DELETE /channels/:id', () => {
    it('disconnects and removes a channel', async () => {
      const res = await app.request('/channels/telegram-123', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.disconnected).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(mockChannelManager.disconnect).toHaveBeenCalledWith('telegram-123');
      expect(mockChannelsRepo.delete).toHaveBeenCalledWith('telegram-123');
    });

    it('returns 404 for unknown channel', async () => {
      mockChannelManager.has.mockReturnValue(false);
      // Return null synchronously since source does not await getById
      mockChannelsRepo.getById.mockReturnValue(null);

      const res = await app.request('/channels/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /channels/:id/send
  // ========================================================================

  describe('POST /channels/:id/send', () => {
    it('sends a message to a channel', async () => {
      const res = await app.request('/channels/telegram-123/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello from API!' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.sent).toBe(true);
      expect(json.data.messageId).toBe('msg-sent-001');
      expect(json.data.channelId).toBe('telegram-123');
    });

    it('sends with chatId', async () => {
      const res = await app.request('/channels/telegram-123/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!', chatId: '12345' }),
      });

      expect(res.status).toBe(200);
      // Verify send was called with the composite channelId
      expect(mockChannelManager.send).toHaveBeenCalledWith(
        'telegram-123',
        expect.objectContaining({
          channelId: 'telegram-123:12345',
          content: 'Hello!',
        })
      );
    });

    it('returns 404 for unknown channel', async () => {
      const res = await app.request('/channels/nonexistent/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.request('/channels/telegram-123/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 on send failure', async () => {
      mockChannelManager.send.mockRejectedValueOnce(new Error('Send failed'));

      const res = await app.request('/channels/telegram-123/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Will fail' }),
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
      addIncomingMessage('telegram-123', 'telegram' as never, {
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

    it('filters messages by channelType', async () => {
      addIncomingMessage('discord-456', 'discord' as never, {
        id: 'inbox-msg-d1',
        sender: { id: 'user-2', name: 'Bob' },
        content: 'Discord message',
        timestamp: '2026-01-31T10:00:05Z',
      });

      const res = await app.request('/channels/messages/inbox?channelType=discord');
      const json = await res.json();

      expect(
        json.data.messages.every((m: { channelType: string }) => m.channelType === 'discord')
      ).toBe(true);
    });

    it('marks a message as read', async () => {
      addIncomingMessage('telegram-123', 'telegram' as never, {
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
});
