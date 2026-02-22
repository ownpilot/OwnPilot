/**
 * SessionService Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionService } from './session-service-impl.js';

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
  });

  afterEach(() => {
    service.dispose();
  });

  describe('create', () => {
    it('creates a session with correct fields', () => {
      const session = service.create({
        userId: 'user-1',
        source: 'web',
      });

      expect(session.id).toBeTruthy();
      expect(session.userId).toBe('user-1');
      expect(session.source).toBe('web');
      expect(session.conversationId).toBeNull();
      expect(session.isActive).toBe(true);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it('creates channel session with plugin/chat IDs', () => {
      const session = service.create({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      expect(session.channelPluginId).toBe('channel.telegram');
      expect(session.platformChatId).toBe('12345');
    });

    it('copies metadata', () => {
      const session = service.create({
        userId: 'user-1',
        source: 'api',
        metadata: { key: 'value' },
      });

      expect(session.metadata.key).toBe('value');
    });
  });

  describe('get', () => {
    it('returns session by ID', () => {
      const created = service.create({ userId: 'user-1', source: 'web' });
      const found = service.get(created.id);
      expect(found).toBe(created);
    });

    it('returns null for unknown ID', () => {
      expect(service.get('nonexistent')).toBeNull();
    });

    it('returns null for closed session', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.close(session.id);
      expect(service.get(session.id)).toBeNull();
    });
  });

  describe('getOrCreate', () => {
    it('creates new session for web source', () => {
      const s1 = service.getOrCreate({ userId: 'user-1', source: 'web' });
      const s2 = service.getOrCreate({ userId: 'user-1', source: 'web' });
      expect(s1.id).not.toBe(s2.id);
    });

    it('returns existing active channel session', () => {
      const s1 = service.getOrCreate({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      const s2 = service.getOrCreate({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      expect(s1.id).toBe(s2.id);
    });

    it('creates new channel session after previous is closed', () => {
      const s1 = service.getOrCreate({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      service.close(s1.id);

      const s2 = service.getOrCreate({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      expect(s2.id).not.toBe(s1.id);
    });
  });

  describe('touch', () => {
    it('updates lastActivityAt', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      const before = session.lastActivityAt;

      // Advance time slightly
      const originalNow = Date.now;
      Date.now = () => originalNow() + 1000;
      service.touch(session.id);
      Date.now = originalNow;

      expect(session.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('linkConversation', () => {
    it('links a conversation to a session', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      expect(session.conversationId).toBeNull();

      service.linkConversation(session.id, 'conv-123');
      expect(session.conversationId).toBe('conv-123');
    });
  });

  describe('setMetadata', () => {
    it('sets metadata on a session', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.setMetadata(session.id, 'agent', 'gpt-4o');
      expect(session.metadata.agent).toBe('gpt-4o');
    });
  });

  describe('close', () => {
    it('marks session as inactive', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.close(session.id);

      // Direct internal check
      expect(session.isActive).toBe(false);
    });

    it('removes channel index', () => {
      const session = service.create({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      service.close(session.id);
      expect(service.getByChannel('channel.telegram', '12345')).toBeNull();
    });
  });

  describe('getByUser', () => {
    it('returns active sessions for a user', () => {
      service.create({ userId: 'user-1', source: 'web' });
      service.create({ userId: 'user-1', source: 'channel', channelPluginId: 'ch', platformChatId: '1' });
      service.create({ userId: 'user-2', source: 'web' });

      const sessions = service.getByUser('user-1');
      expect(sessions).toHaveLength(2);
      expect(sessions.every(s => s.userId === 'user-1')).toBe(true);
    });

    it('excludes closed sessions', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.close(session.id);

      expect(service.getByUser('user-1')).toHaveLength(0);
    });
  });

  describe('getByChannel', () => {
    it('finds channel session by plugin + chatId', () => {
      const session = service.create({
        userId: 'user-1',
        source: 'channel',
        channelPluginId: 'channel.telegram',
        platformChatId: '12345',
      });

      const found = service.getByChannel('channel.telegram', '12345');
      expect(found?.id).toBe(session.id);
    });

    it('returns null for unknown channel', () => {
      expect(service.getByChannel('nonexistent', '999')).toBeNull();
    });
  });

  describe('getActiveSessions', () => {
    it('returns all active sessions', () => {
      service.create({ userId: 'user-1', source: 'web' });
      const closed = service.create({ userId: 'user-2', source: 'api' });
      service.create({ userId: 'user-3', source: 'channel', channelPluginId: 'ch', platformChatId: '1' });
      service.close(closed.id);

      expect(service.getActiveSessions()).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('returns session count by source', () => {
      service.create({ userId: 'u1', source: 'web' });
      service.create({ userId: 'u2', source: 'web' });
      service.create({ userId: 'u3', source: 'channel', channelPluginId: 'ch', platformChatId: '1' });
      service.create({ userId: 'u4', source: 'api' });

      const stats = service.getStats();
      expect(stats.web).toBe(2);
      expect(stats.channel).toBe(1);
      expect(stats.api).toBe(1);
      expect(stats.scheduler).toBe(0);
      expect(stats.system).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('removes old inactive sessions', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.close(session.id);

      // Set lastActivityAt to the past
      (session as { lastActivityAt: Date }).lastActivityAt = new Date(Date.now() - 1000 * 60 * 60);

      const removed = service.cleanup(1000 * 60 * 30); // 30 min max age
      expect(removed).toBe(1);
    });

    it('keeps recent inactive sessions', () => {
      const session = service.create({ userId: 'user-1', source: 'web' });
      service.close(session.id);

      const removed = service.cleanup(1000 * 60 * 60); // 1 hour max age
      expect(removed).toBe(0);
    });
  });
});
