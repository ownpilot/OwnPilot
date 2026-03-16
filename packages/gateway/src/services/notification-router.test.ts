/**
 * Notification Router Tests
 *
 * Tests for notification dispatch across channels with priority filtering,
 * quiet hours, and preference management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockChannelService = vi.hoisted(() => ({
  listChannels: vi.fn(() => []),
  send: vi.fn(),
}));

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ownpilot/core')>()),
  getChannelService: () => mockChannelService,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const settingsStore = new Map<string, string>();
vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: {
    get: (key: string) => settingsStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      settingsStore.set(key, value);
    },
  },
}));

// ============================================================================
// Import after mocks
// ============================================================================

import {
  NotificationRouter,
  createNotification,
  resetNotificationRouter,
} from './notification-router.js';

// ============================================================================
// Helpers
// ============================================================================

function makeNotification(overrides: Record<string, unknown> = {}) {
  return createNotification('Test Title', 'Test Body', {
    priority: 'normal',
    source: 'test',
    ...overrides,
  });
}

function makeChannel(pluginId: string, status = 'connected') {
  return { pluginId, status, platform: pluginId };
}

// ============================================================================
// Tests
// ============================================================================

describe('NotificationRouter', () => {
  let router: NotificationRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.clear();
    resetNotificationRouter();
    router = new NotificationRouter();
    mockChannelService.listChannels.mockReturnValue([]);
    mockChannelService.send.mockResolvedValue('msg-1');
  });

  // --------------------------------------------------------------------------
  // createNotification
  // --------------------------------------------------------------------------

  describe('createNotification()', () => {
    it('creates notification with defaults', () => {
      const n = createNotification('Hello', 'World');
      expect(n.id).toBeDefined();
      expect(n.title).toBe('Hello');
      expect(n.body).toBe('World');
      expect(n.priority).toBe('normal');
      expect(n.source).toBe('system');
      expect(n.createdAt).toBeInstanceOf(Date);
    });

    it('accepts custom priority and source', () => {
      const n = createNotification('Alert', 'Fire!', { priority: 'urgent', source: 'sensor' });
      expect(n.priority).toBe('urgent');
      expect(n.source).toBe('sensor');
    });

    it('accepts metadata', () => {
      const n = createNotification('Note', 'Detail', { metadata: { key: 'val' } });
      expect(n.metadata).toEqual({ key: 'val' });
    });
  });

  // --------------------------------------------------------------------------
  // notify (single user)
  // --------------------------------------------------------------------------

  describe('notify()', () => {
    it('returns empty result when no channels connected', async () => {
      const result = await router.notify('user-1', makeNotification());
      expect(result.attempted).toEqual([]);
      expect(result.delivered).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('delivers to first available connected channel', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram'),
        makeChannel('whatsapp'),
      ]);

      const result = await router.notify('user-1', makeNotification());

      expect(result.delivered).toEqual(['telegram']);
      expect(result.attempted).toEqual(['telegram']);
      expect(mockChannelService.send).toHaveBeenCalledTimes(1);
    });

    it('falls back to next channel on failure', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram'),
        makeChannel('whatsapp'),
      ]);
      mockChannelService.send
        .mockRejectedValueOnce(new Error('Telegram down'))
        .mockResolvedValueOnce('ok');

      const result = await router.notify('user-1', makeNotification());

      expect(result.attempted).toEqual(['telegram', 'whatsapp']);
      expect(result.delivered).toEqual(['whatsapp']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.channelId).toBe('telegram');
    });

    it('reports all failures when no channel succeeds', async () => {
      mockChannelService.listChannels.mockReturnValue([makeChannel('telegram')]);
      mockChannelService.send.mockRejectedValue(new Error('Down'));

      const result = await router.notify('user-1', makeNotification());

      expect(result.delivered).toEqual([]);
      expect(result.failed).toHaveLength(1);
    });

    it('skips disconnected channels', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram', 'disconnected'),
        makeChannel('whatsapp', 'connected'),
      ]);

      const result = await router.notify('user-1', makeNotification());

      expect(result.attempted).toEqual(['whatsapp']);
      expect(result.delivered).toEqual(['whatsapp']);
    });

    it('filters by minPriority preference', async () => {
      mockChannelService.listChannels.mockReturnValue([makeChannel('telegram')]);

      await router.setPreferences({
        userId: 'user-1',
        channelPriority: [],
        minPriority: 'high',
        quietHoursMinPriority: 'urgent',
      });

      // 'normal' < 'high' → filtered
      const result = await router.notify('user-1', makeNotification({ priority: 'normal' }));
      expect(result.attempted).toEqual([]);
      expect(mockChannelService.send).not.toHaveBeenCalled();
    });

    it('allows notifications above minPriority', async () => {
      mockChannelService.listChannels.mockReturnValue([makeChannel('telegram')]);

      await router.setPreferences({
        userId: 'user-1',
        channelPriority: [],
        minPriority: 'normal',
        quietHoursMinPriority: 'urgent',
      });

      const result = await router.notify('user-1', makeNotification({ priority: 'high' }));
      expect(result.delivered).toEqual(['telegram']);
    });

    it('respects channel priority order from preferences', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram'),
        makeChannel('whatsapp'),
        makeChannel('email'),
      ]);

      await router.setPreferences({
        userId: 'user-1',
        channelPriority: ['email', 'telegram'],
        minPriority: 'low',
        quietHoursMinPriority: 'high',
      });

      const result = await router.notify('user-1', makeNotification());

      // Should try email first (per preference), not telegram
      expect(result.attempted).toEqual(['email']);
      expect(result.delivered).toEqual(['email']);
    });

    it('formats message as title + body', async () => {
      mockChannelService.listChannels.mockReturnValue([makeChannel('telegram')]);

      const notification = createNotification('Alert', 'Something happened');
      await router.notify('user-1', notification);

      expect(mockChannelService.send).toHaveBeenCalledWith('telegram', {
        platformChatId: 'user-1',
        text: 'Alert\n\nSomething happened',
      });
    });
  });

  // --------------------------------------------------------------------------
  // notifyChannel (direct)
  // --------------------------------------------------------------------------

  describe('notifyChannel()', () => {
    it('sends notification to specific channel and chat', async () => {
      const notification = createNotification('Direct', 'Message');
      await router.notifyChannel('telegram', 'chat-123', notification);

      expect(mockChannelService.send).toHaveBeenCalledWith('telegram', {
        platformChatId: 'chat-123',
        text: 'Direct\n\nMessage',
      });
    });
  });

  // --------------------------------------------------------------------------
  // broadcast
  // --------------------------------------------------------------------------

  describe('broadcast()', () => {
    it('sends to all connected channels', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram'),
        makeChannel('whatsapp'),
        makeChannel('email', 'disconnected'),
      ]);

      const result = await router.broadcast(makeNotification());

      expect(result.attempted).toContain('telegram');
      expect(result.attempted).toContain('whatsapp');
      expect(result.attempted).not.toContain('email');
      expect(mockChannelService.send).toHaveBeenCalledTimes(2);
    });

    it('reports partial failures', async () => {
      mockChannelService.listChannels.mockReturnValue([
        makeChannel('telegram'),
        makeChannel('whatsapp'),
      ]);
      mockChannelService.send.mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('Fail'));

      const result = await router.broadcast(makeNotification());

      expect(result.delivered).toContain('telegram');
      expect(result.failed).toHaveLength(1);
    });

    it('returns empty result when no connected channels', async () => {
      const result = await router.broadcast(makeNotification());
      expect(result.attempted).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // preferences
  // --------------------------------------------------------------------------

  describe('preferences', () => {
    it('returns null for unknown user', async () => {
      expect(await router.getPreferences('unknown')).toBeNull();
    });

    it('stores and retrieves preferences', async () => {
      const prefs = {
        userId: 'user-1',
        channelPriority: ['telegram'],
        minPriority: 'high' as const,
        quietHoursMinPriority: 'urgent' as const,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      };

      await router.setPreferences(prefs);
      const stored = await router.getPreferences('user-1');

      expect(stored).toEqual(prefs);
    });
  });
});
