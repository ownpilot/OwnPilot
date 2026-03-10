/**
 * Channel Groups Routes Tests
 *
 * Tests WhatsApp group management endpoints:
 * - GET /:id/groups - List groups
 * - GET /:id/groups/:groupJid - Get group details
 * - GET /:id/groups/:groupJid/messages - Get group messages
 * - POST /:id/groups/:groupJid/sync - Trigger history sync
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock Channel Service
const mockGetChannel = vi.fn();
const mockGetStatus = vi.fn();
const mockListGroups = vi.fn();
const mockGetGroup = vi.fn();
const mockFetchGroupHistory = vi.fn();

vi.mock('@ownpilot/core', () => ({
  getChannelService: vi.fn().mockReturnValue({
    getChannel: mockGetChannel,
  }),
}));

// Mock ChannelMessagesRepository
const mockGetByChat = vi.fn();
const mockCountByChat = vi.fn();

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn().mockImplementation(function () {
    return {
      getByChat: mockGetByChat,
      countByChat: mockCountByChat,
    };
  }),
}));

// Mock pagination middleware
vi.mock('../middleware/pagination.js', () => ({
  pagination: vi.fn(() => async (c: unknown, next: () => Promise<unknown>) => {
    (c as { set: (key: string, val: unknown) => void }).set('pagination', { limit: 50, offset: 0 });
    return next();
  }),
}));

// Import after mocks
const { channelGroupsRoutes } = await import('./channels-groups.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', channelGroupsRoutes);
  app.onError(errorHandler);
  return app;
}

describe('channelGroupsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockConnectedChannel() {
    mockGetStatus.mockReturnValue('connected');
    mockGetChannel.mockReturnValue({
      getStatus: mockGetStatus,
      listGroups: mockListGroups,
      getGroup: mockGetGroup,
      fetchGroupHistory: mockFetchGroupHistory,
    });
  }

  describe('GET /:id/groups', () => {
    it('lists groups when channel supports groups', async () => {
      mockConnectedChannel();
      mockListGroups.mockResolvedValue([
        { jid: '123@g.us', name: 'Test Group', participants: [] },
        { jid: '456@g.us', name: 'Another Group', participants: [] },
      ]);

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.groups).toHaveLength(2);
      expect(body.data.count).toBe(2);
      expect(mockListGroups).toHaveBeenCalledWith(false);
    });

    it('includes participants when requested', async () => {
      mockConnectedChannel();
      mockListGroups.mockResolvedValue([]);

      const app = createApp();
      await app.request('/whatsapp.bot1/groups?includeParticipants=true');

      expect(mockListGroups).toHaveBeenCalledWith(true);
    });

    it('returns 404 when channel not found', async () => {
      mockGetChannel.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/unknown/groups');

      expect(res.status).toBe(404);
    });

    it('returns 503 when channel not connected', async () => {
      mockGetStatus.mockReturnValue('disconnected');
      mockGetChannel.mockReturnValue({
        getStatus: mockGetStatus,
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('returns 400 when channel does not support groups', async () => {
      mockGetStatus.mockReturnValue('connected');
      mockGetChannel.mockReturnValue({
        getStatus: mockGetStatus,
        // No listGroups method
      });

      const app = createApp();
      const res = await app.request('/telegram.bot1/groups');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('does not support group');
    });

    it('handles listGroups errors', async () => {
      mockConnectedChannel();
      mockListGroups.mockRejectedValue(new Error('Network error'));

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('FETCH_FAILED');
    });
  });

  describe('GET /:id/groups/:groupJid', () => {
    it('returns group details', async () => {
      mockConnectedChannel();
      mockGetGroup.mockResolvedValue({
        jid: '123456789@g.us',
        name: 'Test Group',
        description: 'A test group',
        participants: [{ id: 'user1@s.whatsapp.net', admin: true }],
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123456789@g.us');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe('Test Group');
    });

    it('normalizes group JID without @g.us', async () => {
      mockConnectedChannel();
      mockGetGroup.mockResolvedValue({ jid: '123456789@g.us', name: 'Test' });

      const app = createApp();
      await app.request('/whatsapp.bot1/groups/123456789');

      expect(mockGetGroup).toHaveBeenCalledWith('123456789@g.us');
    });

    it('returns 400 for invalid JID format', async () => {
      mockConnectedChannel();

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/invalid-jid');

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('Invalid group JID');
    });

    it('returns 404 when group not found', async () => {
      mockConnectedChannel();
      mockGetGroup.mockRejectedValue(new Error('item-not-found'));

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123456789@g.us');

      expect(res.status).toBe(404);
    });

    it('returns 404 when not authorized', async () => {
      mockConnectedChannel();
      mockGetGroup.mockRejectedValue(new Error('not-authorized'));

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123456789@g.us');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /:id/groups/:groupJid/messages', () => {
    it('returns messages from database', async () => {
      mockGetByChat.mockResolvedValue({
        messages: [
          { id: 'msg-1', content: 'Hello', senderName: 'John' },
          { id: 'msg-2', content: 'Hi', senderName: 'Jane' },
        ],
        total: 2,
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123456789@g.us/messages');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.messages).toHaveLength(2);
      expect(body.data.total).toBe(2);
      expect(mockGetByChat).toHaveBeenCalledWith('whatsapp.bot1', '123456789@g.us', 50, 0);
    });

    it('returns 400 for invalid JID format', async () => {
      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/invalid/messages');

      expect(res.status).toBe(400);
    });

    it('handles database errors', async () => {
      mockGetByChat.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123@g.us/messages');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('FETCH_FAILED');
    });
  });

  describe('POST /:id/groups/:groupJid/sync', () => {
    it('triggers history sync', async () => {
      mockGetChannel.mockReturnValue({
        fetchGroupHistory: mockFetchGroupHistory.mockResolvedValue('sync-session-123'),
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123456789@g.us/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.data.status).toBe('accepted');
      expect(body.data.sessionId).toBe('sync-session-123');
      expect(mockFetchGroupHistory).toHaveBeenCalledWith('123456789@g.us', 50);
    });

    it('uses custom count parameter', async () => {
      mockGetChannel.mockReturnValue({
        fetchGroupHistory: mockFetchGroupHistory.mockResolvedValue('sync-123'),
      });

      const app = createApp();
      await app.request('/whatsapp.bot1/groups/123@g.us/sync?count=25', {
        method: 'POST',
      });

      expect(mockFetchGroupHistory).toHaveBeenCalledWith('123@g.us', 25);
    });

    it('returns 400 for invalid JID', async () => {
      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/invalid/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
    });

    it('returns 501 when channel does not support history fetch', async () => {
      mockGetChannel.mockReturnValue({
        // No fetchGroupHistory method
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123@g.us/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.error.message).toContain('does not support history fetch');
    });

    it('handles rate limiting', async () => {
      mockGetChannel.mockReturnValue({
        fetchGroupHistory: vi.fn().mockRejectedValue(new Error('Rate limited')),
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123@g.us/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(429);
    });

    it('handles other errors', async () => {
      mockGetChannel.mockReturnValue({
        fetchGroupHistory: vi.fn().mockRejectedValue(new Error('Some error')),
      });

      const app = createApp();
      const res = await app.request('/whatsapp.bot1/groups/123@g.us/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
    });
  });
});
