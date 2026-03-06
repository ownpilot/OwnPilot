/**
 * Channels Routes — Extended Tests
 *
 * Covers routes not tested in channels.test.ts:
 * - GET /pairing, GET /:id/qr, GET /:id/users, GET /:id/stats,
 *   GET /:id/groups, GET /:id/groups/:groupJid,
 *   GET /:id/groups/:groupJid/messages, POST /:id/groups/:groupJid/sync,
 *   GET /:id/chats, POST /:id/logout, POST /:id/revoke-owner
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const whatsAppApi = {
  getPlatform: vi.fn(() => 'whatsapp'),
  getStatus: vi.fn(() => 'connected'),
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendMessage: vi.fn(async () => 'msg-wa-001'),
  getQrCode: vi.fn(() => 'data:image/png;base64,FAKEQR'),
  getBotInfo: vi.fn(() => ({ username: 'ownpilotbot', firstName: 'OwnPilot' })),
  listGroups: vi.fn(async () => [{ id: '120363001@g.us', name: 'Test Group' }]),
  getGroup: vi.fn(async () => ({ id: '120363001@g.us', name: 'Test Group', participants: [] })),
  fetchGroupHistory: vi.fn(async () => 'session-abc'),
  logout: vi.fn(async () => undefined),
};

const mockService = {
  listChannels: vi.fn(() => [
    {
      pluginId: 'channel.whatsapp',
      platform: 'whatsapp',
      name: 'WhatsApp',
      status: 'connected',
      icon: 'whatsapp',
    },
  ]),
  getChannel: vi.fn((id: string) => (id === 'channel.whatsapp' ? whatsAppApi : undefined)),
  connect: vi.fn(),
  disconnect: vi.fn(),
  logout: vi.fn(async () => undefined),
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
    getDefaultPluginRegistry: async () => ({
      get: vi.fn(),
      getAll: vi.fn(() => []),
    }),
  };
});

const mockChannelMessagesRepo = {
  getByChannel: vi.fn(async () => []),
  getAll: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  countSince: vi.fn(async () => 0),
  lastMessageAt: vi.fn(async () => null),
  deleteAll: vi.fn(async () => 0),
  create: vi.fn(async () => undefined),
  deleteByChannel: vi.fn(async () => ({ count: 0, ids: [] })),
  getDistinctChats: vi.fn(async () => ({ chats: [], total: 0 })),
  getByChat: vi.fn(async () => ({ messages: [], total: 0 })),
};

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: vi.fn(function () {
    return mockChannelMessagesRepo;
  }),
}));

const mockChannelUsersRepo = {
  list: vi.fn(async () => []),
};

vi.mock('../db/repositories/channel-users.js', () => ({
  channelUsersRepo: mockChannelUsersRepo,
}));

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getDefaultEntry: vi.fn(),
    updateEntry: vi.fn(),
    createEntry: vi.fn(),
    getFieldValue: vi.fn(),
  },
}));

vi.mock('../plugins/init.js', () => ({
  refreshChannelApi: vi.fn(),
}));

const mockWsGateway = { broadcast: vi.fn() };
vi.mock('../ws/server.js', () => ({ wsGateway: mockWsGateway }));

const { mockGetPairingKey, mockGetOwnerUserId, mockRevokeOwnership } = vi.hoisted(() => ({
  mockGetPairingKey: vi.fn(async () => 'PAIRING-KEY-123'),
  mockGetOwnerUserId: vi.fn(async () => null),
  mockRevokeOwnership: vi.fn(async () => undefined),
}));

vi.mock('../services/pairing-service.js', () => ({
  getPairingKey: mockGetPairingKey,
  getOwnerUserId: mockGetOwnerUserId,
  revokeOwnership: mockRevokeOwnership,
}));

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

let app: Hono;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Channels Routes — Extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whatsAppApi.getStatus.mockReturnValue('connected');
    whatsAppApi.getGroup.mockResolvedValue({
      id: '120363001@g.us',
      name: 'Test Group',
      participants: [],
    });
    whatsAppApi.listGroups.mockResolvedValue([{ id: '120363001@g.us', name: 'Test Group' }]);
    whatsAppApi.fetchGroupHistory.mockResolvedValue('session-abc');
    whatsAppApi.getQrCode.mockReturnValue('data:image/png;base64,FAKEQR');
    mockService.listChannels.mockReturnValue([
      {
        pluginId: 'channel.whatsapp',
        platform: 'whatsapp',
        name: 'WhatsApp',
        status: 'connected',
        icon: 'whatsapp',
      },
    ]);
    mockService.getChannel.mockImplementation((id: string) =>
      id === 'channel.whatsapp' ? whatsAppApi : undefined
    );
    mockChannelMessagesRepo.count.mockResolvedValue(100);
    mockChannelMessagesRepo.countSince.mockResolvedValue(5);
    mockChannelMessagesRepo.lastMessageAt.mockResolvedValue(new Date('2024-06-01T12:00:00Z'));
    mockGetPairingKey.mockResolvedValue('PAIRING-KEY-123');
    mockGetOwnerUserId.mockResolvedValue(null);
    app = createApp();
  });

  // ---- GET /channels/pairing ----

  describe('GET /channels/pairing', () => {
    it('returns pairing info for each channel', async () => {
      const res = await app.request('/channels/pairing');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.channels).toHaveLength(1);
      expect(json.data.channels[0].pluginId).toBe('channel.whatsapp');
      expect(json.data.channels[0].key).toBe('PAIRING-KEY-123');
      expect(json.data.channels[0].claimed).toBe(false);
      expect(json.data.hasAnyOwner).toBe(false);
    });

    it('marks channel as claimed when ownerUserId exists', async () => {
      mockGetOwnerUserId.mockResolvedValue('user-123');
      const res = await app.request('/channels/pairing');
      const json = await res.json();
      expect(json.data.channels[0].claimed).toBe(true);
      expect(json.data.channels[0].ownerUserId).toBe('user-123');
      expect(json.data.hasAnyOwner).toBe(true);
    });
  });

  // ---- GET /channels/:id/qr ----

  describe('GET /channels/:id/qr', () => {
    it('returns QR code and status when channel has QR support', async () => {
      const res = await app.request('/channels/channel.whatsapp/qr');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.qr).toBe('data:image/png;base64,FAKEQR');
      expect(json.data.status).toBe('connected');
    });

    it('returns null QR when QR code is null', async () => {
      whatsAppApi.getQrCode.mockReturnValue(null);
      const res = await app.request('/channels/channel.whatsapp/qr');
      const json = await res.json();
      expect(json.data.qr).toBeNull();
    });

    it('returns botInfo when api has getBotInfo', async () => {
      whatsAppApi.getBotInfo.mockReturnValue({ username: 'mybot', firstName: 'MyBot' });
      const res = await app.request('/channels/channel.whatsapp/qr');
      const json = await res.json();
      expect(json.data.botInfo?.username).toBe('mybot');
    });

    it('returns 404 when channel not found', async () => {
      const res = await app.request('/channels/channel.unknown/qr');
      expect(res.status).toBe(404);
    });
  });

  // ---- GET /channels/:id/users ----

  describe('GET /channels/:id/users', () => {
    it('returns users list for a channel', async () => {
      const now = new Date('2024-06-01T12:00:00Z');
      mockChannelUsersRepo.list.mockResolvedValue([
        {
          id: 'u-1',
          platform: 'whatsapp',
          platformUserId: '+9051234567',
          platformUsername: 'testuser',
          displayName: 'Test User',
          isVerified: false,
          isBlocked: false,
          lastSeenAt: now,
        },
      ]);

      const res = await app.request('/channels/channel.whatsapp/users');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.users).toHaveLength(1);
      expect(json.data.users[0].id).toBe('u-1');
      expect(json.data.users[0].platform).toBe('whatsapp');
      expect(json.data.count).toBe(1);
    });

    it('returns empty users list when no users', async () => {
      mockChannelUsersRepo.list.mockResolvedValue([]);
      const res = await app.request('/channels/channel.whatsapp/users');
      const json = await res.json();
      expect(json.data.count).toBe(0);
      expect(json.data.users).toHaveLength(0);
    });

    it('returns 500 when repo throws', async () => {
      mockChannelUsersRepo.list.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/channels/channel.whatsapp/users');
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /channels/:id/stats ----

  describe('GET /channels/:id/stats', () => {
    it('returns message statistics', async () => {
      mockChannelMessagesRepo.count.mockResolvedValue(200);
      mockChannelMessagesRepo.countSince.mockResolvedValueOnce(10).mockResolvedValueOnce(50);
      mockChannelMessagesRepo.lastMessageAt.mockResolvedValue(new Date('2024-06-01T12:00:00Z'));

      const res = await app.request('/channels/channel.whatsapp/stats');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.totalMessages).toBe(200);
      expect(json.data.todayMessages).toBe(10);
      expect(json.data.weekMessages).toBe(50);
      expect(json.data.lastActivityAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('returns null lastActivityAt when no messages', async () => {
      mockChannelMessagesRepo.count.mockResolvedValue(0);
      mockChannelMessagesRepo.countSince.mockResolvedValue(0);
      mockChannelMessagesRepo.lastMessageAt.mockResolvedValue(null);

      const res = await app.request('/channels/channel.whatsapp/stats');
      const json = await res.json();
      expect(json.data.lastActivityAt).toBeNull();
    });

    it('returns 500 when stats query fails', async () => {
      mockChannelMessagesRepo.count.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/channels/channel.whatsapp/stats');
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /channels/:id/groups ----

  describe('GET /channels/:id/groups', () => {
    it('returns groups for a connected WhatsApp channel', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.groups).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('returns 404 when channel not found', async () => {
      const res = await app.request('/channels/channel.missing/groups');
      expect(res.status).toBe(404);
    });

    it('returns 503 when channel is not connected', async () => {
      whatsAppApi.getStatus.mockReturnValue('disconnected');
      const res = await app.request('/channels/channel.whatsapp/groups');
      expect(res.status).toBe(503);
    });

    it('returns 400 when channel does not support groups', async () => {
      const noGroupsApi = {
        getPlatform: vi.fn(() => 'telegram'),
        getStatus: vi.fn(() => 'connected'),
      };
      mockService.getChannel.mockReturnValue(noGroupsApi);
      const res = await app.request('/channels/channel.whatsapp/groups');
      expect(res.status).toBe(400);
    });

    it('returns 500 when listGroups throws', async () => {
      whatsAppApi.listGroups.mockRejectedValue(new Error('API error'));
      const res = await app.request('/channels/channel.whatsapp/groups');
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /channels/:id/groups/:groupJid ----

  describe('GET /channels/:id/groups/:groupJid', () => {
    it('returns group details for a valid JID', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/120363001%40g.us');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.id).toBe('120363001@g.us');
    });

    it('auto-appends @g.us when JID has no @', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/120363001');
      expect(res.status).toBe(200);
      expect(whatsAppApi.getGroup).toHaveBeenCalledWith('120363001@g.us');
    });

    it('returns 400 for invalid JID format', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/invalid%40g.us');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid group JID format');
    });

    it('returns 404 when group not found', async () => {
      whatsAppApi.getGroup.mockRejectedValue(new Error('item-not-found'));
      const res = await app.request('/channels/channel.whatsapp/groups/120363001');
      expect(res.status).toBe(404);
    });

    it('returns 503 when channel not connected', async () => {
      whatsAppApi.getStatus.mockReturnValue('disconnected');
      const res = await app.request('/channels/channel.whatsapp/groups/120363001');
      expect(res.status).toBe(503);
    });

    it('returns 404 when channel not found', async () => {
      const res = await app.request('/channels/channel.missing/groups/120363001');
      expect(res.status).toBe(404);
    });

    it('returns 500 for other errors from getGroup', async () => {
      whatsAppApi.getGroup.mockRejectedValue(new Error('network error'));
      const res = await app.request('/channels/channel.whatsapp/groups/120363001');
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /channels/:id/groups/:groupJid/messages ----

  describe('GET /channels/:id/groups/:groupJid/messages', () => {
    it('returns messages for a valid group JID', async () => {
      mockChannelMessagesRepo.getByChat.mockResolvedValue({
        messages: [{ id: 'msg-1', content: 'Hello' }],
        total: 1,
      });

      const res = await app.request('/channels/channel.whatsapp/groups/120363001/messages');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.messages).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.count).toBe(1);
    });

    it('returns 400 for invalid JID format', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/invalid%40g.us/messages');
      expect(res.status).toBe(400);
    });

    it('auto-appends @g.us when JID has no @', async () => {
      mockChannelMessagesRepo.getByChat.mockResolvedValue({ messages: [], total: 0 });
      await app.request('/channels/channel.whatsapp/groups/120363001/messages');
      expect(mockChannelMessagesRepo.getByChat).toHaveBeenCalledWith(
        'channel.whatsapp',
        '120363001@g.us',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('returns 500 when getByChat throws', async () => {
      mockChannelMessagesRepo.getByChat.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/channels/channel.whatsapp/groups/120363001/messages');
      expect(res.status).toBe(500);
    });
  });

  // ---- POST /channels/:id/groups/:groupJid/sync ----

  describe('POST /channels/:id/groups/:groupJid/sync', () => {
    it('triggers history sync and returns 202', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/120363001/sync', {
        method: 'POST',
      });
      const json = await res.json();
      expect(res.status).toBe(202);
      expect(json.data.status).toBe('accepted');
      expect(json.data.sessionId).toBe('session-abc');
    });

    it('returns 400 for invalid JID format', async () => {
      const res = await app.request('/channels/channel.whatsapp/groups/invalid%40g.us/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(400);
    });

    it('returns 501 when channel does not support history fetch', async () => {
      const noHistoryApi = {
        getPlatform: vi.fn(() => 'whatsapp'),
        getStatus: vi.fn(() => 'connected'),
      };
      mockService.getChannel.mockReturnValue(noHistoryApi);
      const res = await app.request('/channels/channel.whatsapp/groups/120363001/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(501);
    });

    it('returns 429 when rate limited', async () => {
      whatsAppApi.fetchGroupHistory.mockRejectedValue(new Error('Rate limited — please wait'));
      const res = await app.request('/channels/channel.whatsapp/groups/120363001/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(429);
    });

    it('returns 500 for other errors', async () => {
      whatsAppApi.fetchGroupHistory.mockRejectedValue(new Error('network failure'));
      const res = await app.request('/channels/channel.whatsapp/groups/120363001/sync', {
        method: 'POST',
      });
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /channels/:id/chats ----

  describe('GET /channels/:id/chats', () => {
    it('returns distinct chats for a channel', async () => {
      mockChannelMessagesRepo.getDistinctChats.mockResolvedValue({
        chats: [
          {
            id: '123@s.whatsapp.net',
            displayName: 'Alice',
            platform: 'whatsapp',
            messageCount: 5,
            lastMessageAt: '2024-06-01T12:00:00Z',
            isGroup: false,
          },
        ],
        total: 1,
      });

      const res = await app.request('/channels/channel.whatsapp/chats');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.chats).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('returns 404 when channel not found', async () => {
      const res = await app.request('/channels/channel.missing/chats');
      expect(res.status).toBe(404);
    });

    it('returns 500 when getDistinctChats throws', async () => {
      mockChannelMessagesRepo.getDistinctChats.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/channels/channel.whatsapp/chats');
      expect(res.status).toBe(500);
    });
  });

  // ---- POST /channels/:id/logout ----

  describe('POST /channels/:id/logout', () => {
    it('logs out a channel and returns logged_out status', async () => {
      const res = await app.request('/channels/channel.whatsapp/logout', { method: 'POST' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.status).toBe('logged_out');
      expect(json.data.pluginId).toBe('channel.whatsapp');
      expect(mockService.logout).toHaveBeenCalledWith('channel.whatsapp');
    });

    it('returns 500 when logout throws', async () => {
      mockService.logout.mockRejectedValue(new Error('Logout failed'));
      const res = await app.request('/channels/channel.whatsapp/logout', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  // ---- POST /channels/:id/revoke-owner ----

  describe('POST /channels/:id/revoke-owner', () => {
    it('revokes ownership and returns new pairing key', async () => {
      mockGetPairingKey.mockResolvedValue('NEW-PAIRING-KEY');

      const res = await app.request('/channels/channel.whatsapp/revoke-owner', { method: 'POST' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.newKey).toBe('NEW-PAIRING-KEY');
      expect(json.data.pluginId).toBe('channel.whatsapp');
      expect(mockRevokeOwnership).toHaveBeenCalledWith('channel.whatsapp', 'whatsapp');
    });

    it('returns 404 when channel not found in listChannels', async () => {
      mockService.listChannels.mockReturnValue([]);
      const res = await app.request('/channels/channel.whatsapp/revoke-owner', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });
});
