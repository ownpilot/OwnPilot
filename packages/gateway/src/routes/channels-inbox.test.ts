/**
 * Channel Inbox Routes Tests
 *
 * Tests the DB-backed inbox endpoints:
 * - GET /messages/inbox - List all messages with pagination
 * - POST /messages/:messageId/read - Mark message as read
 * - DELETE /messages - Clear all messages
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock ChannelMessagesRepository
const mockGetAll = vi.fn();
const mockCount = vi.fn();
const mockDeleteByChannel = vi.fn();
const mockDeleteAll = vi.fn();

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn().mockImplementation(function() {
    return {
      getAll: mockGetAll,
      count: mockCount,
      deleteByChannel: mockDeleteByChannel,
      deleteAll: mockDeleteAll,
    };
  }),
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
const { channelInboxRoutes, addReadMessageId, readMessageIds } = await import(
  './channels-inbox.js'
);

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', channelInboxRoutes);
  app.onError(errorHandler);
  return app;
}

describe('channelInboxRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMessageIds.clear();
  });

  describe('GET /messages/inbox', () => {
    it('returns empty inbox when no messages', async () => {
      mockGetAll.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const app = createApp();
      const res = await app.request('/messages/inbox');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toEqual({
        messages: [],
        total: 0,
        unreadCount: 0,
      });
    });

    it('returns messages with correct formatting', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          channelId: 'telegram.bot1',
          senderId: 'user123',
          senderName: 'John',
          content: 'Hello',
          createdAt: new Date('2026-01-15T10:00:00Z'),
          direction: 'inbound',
          replyToId: null,
          metadata: { chatId: '12345' },
        },
        {
          id: 'msg-2',
          channelId: 'telegram.bot1',
          senderId: null,
          senderName: null,
          content: 'Hi there!',
          createdAt: new Date('2026-01-15T10:01:00Z'),
          direction: 'outbound',
          replyToId: 'msg-1',
          metadata: {},
        },
      ];

      mockGetAll.mockResolvedValue(mockMessages);
      mockCount.mockResolvedValue(2);

      const app = createApp();
      const res = await app.request('/messages/inbox');
      const body = await res.json();

      expect(body.data.messages).toHaveLength(2);

      // Inbound message
      expect(body.data.messages[0]).toMatchObject({
        id: 'msg-1',
        channelId: 'telegram.bot1',
        channelType: 'bot1',
        sender: { id: 'user123', name: 'John' },
        content: 'Hello',
        direction: 'incoming',
        read: false,
        replied: false,
        replyTo: null,
      });

      // Outbound message (always marked as read)
      expect(body.data.messages[1]).toMatchObject({
        id: 'msg-2',
        sender: { id: 'assistant', name: 'Assistant' },
        content: 'Hi there!',
        direction: 'outgoing',
        read: true, // outbound messages are always read
        replyTo: 'msg-1',
      });
    });

    it('filters by channelId when provided', async () => {
      mockGetAll.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const app = createApp();
      await app.request('/messages/inbox?channelId=telegram.bot1');

      expect(mockGetAll).toHaveBeenCalledWith({
        channelId: 'telegram.bot1',
        limit: 100,
        offset: 0,
      });
      expect(mockCount).toHaveBeenCalledWith('telegram.bot1');
    });

    it('marks read messages correctly', async () => {
      readMessageIds.add('msg-1');

      mockGetAll.mockResolvedValue([
        {
          id: 'msg-1',
          channelId: 'telegram.bot1',
          senderId: 'user123',
          senderName: 'John',
          content: 'Hello',
          createdAt: new Date(),
          direction: 'inbound',
          replyToId: null,
          metadata: {},
        },
        {
          id: 'msg-2',
          channelId: 'telegram.bot1',
          senderId: 'user456',
          senderName: 'Jane',
          content: 'Hi',
          createdAt: new Date(),
          direction: 'inbound',
          replyToId: null,
          metadata: {},
        },
      ]);
      mockCount.mockResolvedValue(2);

      const app = createApp();
      const res = await app.request('/messages/inbox');
      const body = await res.json();

      expect(body.data.messages[0].read).toBe(true);
      expect(body.data.messages[1].read).toBe(false);
      expect(body.data.unreadCount).toBe(1);
    });

    it('handles database errors', async () => {
      mockGetAll.mockRejectedValue(new Error('Database connection failed'));

      const app = createApp();
      const res = await app.request('/messages/inbox');
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error.code).toBe('FETCH_FAILED');
    });

    it('extracts channel type from channelId', async () => {
      mockGetAll.mockResolvedValue([
        {
          id: 'msg-1',
          channelId: 'whatsapp.bot2',
          senderId: 'user123',
          senderName: 'John',
          content: 'Test',
          createdAt: new Date(),
          direction: 'inbound',
          replyToId: null,
          metadata: {},
        },
      ]);
      mockCount.mockResolvedValue(1);

      const app = createApp();
      const res = await app.request('/messages/inbox');
      const body = await res.json();

      expect(body.data.messages[0].channelType).toBe('bot2');
    });

    it('defaults channel type when channelId has no dot', async () => {
      mockGetAll.mockResolvedValue([
        {
          id: 'msg-1',
          channelId: 'custom-channel',
          senderId: 'user123',
          senderName: 'John',
          content: 'Test',
          createdAt: new Date(),
          direction: 'inbound',
          replyToId: null,
          metadata: {},
        },
      ]);
      mockCount.mockResolvedValue(1);

      const app = createApp();
      const res = await app.request('/messages/inbox');
      const body = await res.json();

      expect(body.data.messages[0].channelType).toBe('telegram');
    });
  });

  describe('POST /messages/:messageId/read', () => {
    it('marks message as read', async () => {
      const app = createApp();
      const res = await app.request('/messages/msg-123/read', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toEqual({ messageId: 'msg-123', read: true });
      expect(readMessageIds.has('msg-123')).toBe(true);
    });

    it('adds multiple messages to read set', async () => {
      const app = createApp();
      await app.request('/messages/msg-1/read', { method: 'POST' });
      await app.request('/messages/msg-2/read', { method: 'POST' });
      await app.request('/messages/msg-3/read', { method: 'POST' });

      expect(readMessageIds.size).toBe(3);
      expect(readMessageIds.has('msg-1')).toBe(true);
      expect(readMessageIds.has('msg-2')).toBe(true);
      expect(readMessageIds.has('msg-3')).toBe(true);
    });
  });

  describe('DELETE /messages', () => {
    it('clears all messages', async () => {
      readMessageIds.add('msg-1');
      readMessageIds.add('msg-2');
      mockDeleteAll.mockResolvedValue(10);

      const app = createApp();
      const res = await app.request('/messages', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.deleted).toBe(10);
      expect(readMessageIds.size).toBe(0); // cleared
      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'channel',
        action: 'deleted',
      });
    });

    it('clears messages for specific channel', async () => {
      readMessageIds.add('msg-1');
      readMessageIds.add('msg-2');
      mockDeleteByChannel.mockResolvedValue({ count: 5, ids: ['msg-1'] });

      const app = createApp();
      const res = await app.request('/messages?channelId=telegram.bot1', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.deleted).toBe(5);
      expect(mockDeleteByChannel).toHaveBeenCalledWith('telegram.bot1');
      expect(readMessageIds.has('msg-1')).toBe(false); // evicted
      expect(readMessageIds.has('msg-2')).toBe(true); // preserved
    });

    it('handles database errors', async () => {
      mockDeleteAll.mockRejectedValue(new Error('Delete failed'));

      const app = createApp();
      const res = await app.request('/messages', { method: 'DELETE' });
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('addReadMessageId helper', () => {
    it('adds message ID to set', () => {
      readMessageIds.clear();
      addReadMessageId('test-msg-1');
      expect(readMessageIds.has('test-msg-1')).toBe(true);
    });

    it('evicts oldest IDs when exceeding MAX_READ_IDS', () => {
      readMessageIds.clear();

      // Add 2002 items (exceeds MAX_READ_IDS of 2000)
      for (let i = 0; i < 2002; i++) {
        addReadMessageId(`msg-${i}`);
      }

      expect(readMessageIds.size).toBe(2000);
      // Oldest items should be evicted
      expect(readMessageIds.has('msg-0')).toBe(false);
      expect(readMessageIds.has('msg-1')).toBe(false);
      // Newest items should remain
      expect(readMessageIds.has('msg-2000')).toBe(true);
      expect(readMessageIds.has('msg-2001')).toBe(true);
    });
  });
});
