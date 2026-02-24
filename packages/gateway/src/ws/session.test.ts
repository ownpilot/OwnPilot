import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { SessionManager } from './session.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hasServiceRegistry: () => false,
    getServiceRegistry: vi.fn(),
    Services: { Session: 'session' },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket(readyState = 1): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  // =========================================================================
  // 1. Session creation
  // =========================================================================
  describe('create', () => {
    it('should create a session with a unique ID', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);

      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
    });

    it('should return unique IDs for each session', () => {
      const s1 = manager.create(createMockSocket());
      const s2 = manager.create(createMockSocket());

      expect(s1.id).not.toBe(s2.id);
    });

    it('should return a public session without socket reference', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);

      // The public session should not expose the socket
      expect((session as Record<string, unknown>).socket).toBeUndefined();
      expect((session as Record<string, unknown>).rateLimitBucket).toBeUndefined();
    });

    it('should store session retrievable by ID', () => {
      const socket = createMockSocket();
      const created = manager.create(socket);
      const retrieved = manager.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should handle optional userId', () => {
      const socket = createMockSocket();
      const sessionWithUser = manager.create(socket, 'user-42');

      expect(sessionWithUser.userId).toBe('user-42');
    });

    it('should leave userId undefined when not provided', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);

      expect(session.userId).toBeUndefined();
    });

    it('should set connectedAt and lastActivityAt timestamps', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);

      expect(session.connectedAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should initialize with empty channels and metadata', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);

      expect(session.channels).toBeInstanceOf(Set);
      expect(session.channels.size).toBe(0);
      expect(session.metadata).toEqual({});
    });
  });

  // =========================================================================
  // 2. Session retrieval
  // =========================================================================
  describe('get', () => {
    it('should return session by ID', () => {
      const socket = createMockSocket();
      const created = manager.create(socket);
      const retrieved = manager.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.connectedAt).toEqual(created.connectedAt);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.get('nonexistent-id')).toBeUndefined();
    });
  });

  describe('getBySocket', () => {
    it('should return session by WebSocket reference', () => {
      const socket = createMockSocket();
      const created = manager.create(socket);
      const retrieved = manager.getBySocket(socket);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return undefined for unknown socket', () => {
      const unknownSocket = createMockSocket();
      expect(manager.getBySocket(unknownSocket)).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all sessions', () => {
      manager.create(createMockSocket());
      manager.create(createMockSocket());
      manager.create(createMockSocket());

      const all = manager.getAll();
      expect(all).toHaveLength(3);
    });

    it('should return empty array when no sessions', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('should return public sessions without socket references', () => {
      manager.create(createMockSocket());
      const all = manager.getAll();

      for (const session of all) {
        expect((session as Record<string, unknown>).socket).toBeUndefined();
        expect((session as Record<string, unknown>).rateLimitBucket).toBeUndefined();
      }
    });
  });

  describe('count', () => {
    it('should return 0 when no sessions exist', () => {
      expect(manager.count).toBe(0);
    });

    it('should reflect the number of active sessions', () => {
      manager.create(createMockSocket());
      expect(manager.count).toBe(1);

      manager.create(createMockSocket());
      expect(manager.count).toBe(2);
    });

    it('should decrease when sessions are removed', () => {
      const session = manager.create(createMockSocket());
      expect(manager.count).toBe(1);

      manager.remove(session.id);
      expect(manager.count).toBe(0);
    });
  });

  // =========================================================================
  // 3. Session removal
  // =========================================================================
  describe('remove', () => {
    it('should delete session by ID', () => {
      const session = manager.create(createMockSocket());
      const result = manager.remove(session.id);

      expect(result).toBe(true);
      expect(manager.get(session.id)).toBeUndefined();
      expect(manager.count).toBe(0);
    });

    it('should return false for unknown ID', () => {
      expect(manager.remove('nonexistent')).toBe(false);
    });

    it('should make getBySocket return undefined after removal', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);
      manager.remove(session.id);

      expect(manager.getBySocket(socket)).toBeUndefined();
    });
  });

  describe('removeBySocket', () => {
    it('should delete session by socket reference', () => {
      const socket = createMockSocket();
      const session = manager.create(socket);
      const result = manager.removeBySocket(socket);

      expect(result).toBe(true);
      expect(manager.get(session.id)).toBeUndefined();
      expect(manager.count).toBe(0);
    });

    it('should return false for unknown socket', () => {
      const unknownSocket = createMockSocket();
      expect(manager.removeBySocket(unknownSocket)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Touch
  // =========================================================================
  describe('touch', () => {
    it('should update lastActivityAt timestamp', () => {
      vi.useFakeTimers();
      try {
        const socket = createMockSocket();
        const session = manager.create(socket);
        const originalTime = session.lastActivityAt.getTime();

        vi.advanceTimersByTime(5000);
        manager.touch(session.id);

        const updated = manager.get(session.id)!;
        expect(updated.lastActivityAt.getTime()).toBeGreaterThan(originalTime);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not throw for unknown session ID', () => {
      expect(() => manager.touch('nonexistent')).not.toThrow();
    });
  });

  // =========================================================================
  // 5. Rate limiting
  // =========================================================================
  describe('consumeRateLimit', () => {
    // WS_RATE_LIMIT_BURST = 50, WS_RATE_LIMIT_MESSAGES_PER_SEC = 30

    it('should allow messages within burst limit', () => {
      const session = manager.create(createMockSocket());

      for (let i = 0; i < 50; i++) {
        expect(manager.consumeRateLimit(session.id)).toBe(true);
      }
    });

    it('should return false when tokens are exhausted', () => {
      vi.useFakeTimers();
      try {
        const session = manager.create(createMockSocket());

        // Exhaust all 50 tokens
        for (let i = 0; i < 50; i++) {
          manager.consumeRateLimit(session.id);
        }

        // Next message should be rejected
        expect(manager.consumeRateLimit(session.id)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should refill tokens over time', () => {
      vi.useFakeTimers();
      try {
        const session = manager.create(createMockSocket());

        // Exhaust all tokens
        for (let i = 0; i < 50; i++) {
          manager.consumeRateLimit(session.id);
        }
        expect(manager.consumeRateLimit(session.id)).toBe(false);

        // Advance 1 second: should refill 30 tokens (rate = 30/sec)
        vi.advanceTimersByTime(1000);

        // Should now be allowed
        expect(manager.consumeRateLimit(session.id)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return false for unknown session', () => {
      expect(manager.consumeRateLimit('nonexistent')).toBe(false);
    });

    it('should not exceed burst cap after long idle period', () => {
      vi.useFakeTimers();
      try {
        const session = manager.create(createMockSocket());

        // Consume a few tokens
        for (let i = 0; i < 10; i++) {
          manager.consumeRateLimit(session.id);
        }

        // Wait a very long time (10 minutes)
        vi.advanceTimersByTime(600_000);

        // Tokens should be capped at WS_RATE_LIMIT_BURST (50), not higher
        // Consume exactly 50 -- they should all succeed
        for (let i = 0; i < 50; i++) {
          expect(manager.consumeRateLimit(session.id)).toBe(true);
        }

        // The 51st should fail (no time has passed within the loop since timers are fake)
        expect(manager.consumeRateLimit(session.id)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // 6. Channel subscriptions
  // =========================================================================
  describe('subscribeToChannel', () => {
    it('should add channel to session', () => {
      const session = manager.create(createMockSocket());
      const result = manager.subscribeToChannel(session.id, 'general');

      expect(result).toBe(true);

      const retrieved = manager.get(session.id)!;
      expect(retrieved.channels.has('general')).toBe(true);
    });

    it('should return false for unknown session', () => {
      expect(manager.subscribeToChannel('nonexistent', 'general')).toBe(false);
    });

    it('should prevent exceeding 50 channel limit', () => {
      const session = manager.create(createMockSocket());

      // Subscribe to 50 channels
      for (let i = 0; i < 50; i++) {
        const result = manager.subscribeToChannel(session.id, `channel-${i}`);
        expect(result).toBe(true);
      }

      // The 51st should be rejected
      const result = manager.subscribeToChannel(session.id, 'channel-overflow');
      expect(result).toBe(false);
    });

    it('should allow re-subscribing to an existing channel without counting toward limit', () => {
      const session = manager.create(createMockSocket());

      // Fill up to 50 channels
      for (let i = 0; i < 50; i++) {
        manager.subscribeToChannel(session.id, `channel-${i}`);
      }

      // Re-subscribing to an already-subscribed channel should succeed
      const result = manager.subscribeToChannel(session.id, 'channel-0');
      expect(result).toBe(true);
    });
  });

  describe('unsubscribeFromChannel', () => {
    it('should remove channel from session', () => {
      const session = manager.create(createMockSocket());
      manager.subscribeToChannel(session.id, 'general');
      const result = manager.unsubscribeFromChannel(session.id, 'general');

      expect(result).toBe(true);
      expect(manager.get(session.id)!.channels.has('general')).toBe(false);
    });

    it('should return false when channel was not subscribed', () => {
      const session = manager.create(createMockSocket());
      expect(manager.unsubscribeFromChannel(session.id, 'never-subscribed')).toBe(false);
    });

    it('should return false for unknown session', () => {
      expect(manager.unsubscribeFromChannel('nonexistent', 'general')).toBe(false);
    });
  });

  describe('getChannelSubscribers', () => {
    it('should return sessions subscribed to a channel', () => {
      const s1 = manager.create(createMockSocket());
      const s2 = manager.create(createMockSocket());
      const s3 = manager.create(createMockSocket());

      manager.subscribeToChannel(s1.id, 'general');
      manager.subscribeToChannel(s2.id, 'general');
      manager.subscribeToChannel(s3.id, 'private');

      const subscribers = manager.getChannelSubscribers('general');
      const subscriberIds = subscribers.map((s) => s.id);

      expect(subscribers).toHaveLength(2);
      expect(subscriberIds).toContain(s1.id);
      expect(subscriberIds).toContain(s2.id);
      expect(subscriberIds).not.toContain(s3.id);
    });

    it('should return empty array when no subscribers', () => {
      expect(manager.getChannelSubscribers('empty-channel')).toEqual([]);
    });

    it('should return public sessions without socket references', () => {
      const session = manager.create(createMockSocket());
      manager.subscribeToChannel(session.id, 'general');

      const subscribers = manager.getChannelSubscribers('general');
      for (const sub of subscribers) {
        expect((sub as Record<string, unknown>).socket).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 7. Metadata
  // =========================================================================
  describe('setMetadata', () => {
    it('should set key-value metadata on a session', () => {
      const session = manager.create(createMockSocket());
      manager.setMetadata(session.id, 'theme', 'dark');

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata).toEqual({ theme: 'dark' });
    });

    it('should overwrite existing key', () => {
      const session = manager.create(createMockSocket());
      manager.setMetadata(session.id, 'theme', 'dark');
      manager.setMetadata(session.id, 'theme', 'light');

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata).toEqual({ theme: 'light' });
    });

    it('should reject key longer than 100 characters', () => {
      const session = manager.create(createMockSocket());
      const longKey = 'k'.repeat(101);
      manager.setMetadata(session.id, longKey, 'value');

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata).toEqual({});
    });

    it('should accept key exactly 100 characters long', () => {
      const session = manager.create(createMockSocket());
      const key100 = 'k'.repeat(100);
      manager.setMetadata(session.id, key100, 'value');

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata[key100]).toBe('value');
    });

    it('should reject value larger than 1024 bytes when serialized', () => {
      const session = manager.create(createMockSocket());
      // A string that serializes to more than 1024 bytes (JSON adds quotes)
      const bigValue = 'x'.repeat(1024);
      manager.setMetadata(session.id, 'big', bigValue);

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata).toEqual({});
    });

    it('should accept value exactly at 1024 bytes serialized', () => {
      const session = manager.create(createMockSocket());
      // JSON.stringify("x...x") adds 2 quote chars, so string of 1022 => serialized = 1024
      const exactValue = 'x'.repeat(1022);
      manager.setMetadata(session.id, 'exact', exactValue);

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata['exact']).toBe(exactValue);
    });

    it('should reject non-serializable values (circular references)', () => {
      const session = manager.create(createMockSocket());
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      manager.setMetadata(session.id, 'circular', circular);

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata).toEqual({});
    });

    it('should limit to 50 metadata keys', () => {
      const session = manager.create(createMockSocket());

      // Set 50 keys
      for (let i = 0; i < 50; i++) {
        manager.setMetadata(session.id, `key-${i}`, `value-${i}`);
      }

      // The 51st new key should be silently rejected
      manager.setMetadata(session.id, 'overflow-key', 'overflow-value');

      const retrieved = manager.get(session.id)!;
      expect(Object.keys(retrieved.metadata)).toHaveLength(50);
      expect(retrieved.metadata['overflow-key']).toBeUndefined();
    });

    it('should allow updating existing key even when at max key count', () => {
      const session = manager.create(createMockSocket());

      // Set 50 keys
      for (let i = 0; i < 50; i++) {
        manager.setMetadata(session.id, `key-${i}`, `value-${i}`);
      }

      // Update an existing key -- should succeed
      manager.setMetadata(session.id, 'key-0', 'updated-value');

      const retrieved = manager.get(session.id)!;
      expect(Object.keys(retrieved.metadata)).toHaveLength(50);
      expect(retrieved.metadata['key-0']).toBe('updated-value');
    });

    it('should silently ignore unknown session', () => {
      expect(() => manager.setMetadata('nonexistent', 'k', 'v')).not.toThrow();
    });

    it('should accept complex serializable values', () => {
      const session = manager.create(createMockSocket());
      const value = { nested: { array: [1, 2, 3], flag: true } };
      manager.setMetadata(session.id, 'complex', value);

      const retrieved = manager.get(session.id)!;
      expect(retrieved.metadata['complex']).toEqual(value);
    });
  });

  // =========================================================================
  // 8. Send
  // =========================================================================
  describe('send', () => {
    it('should send JSON message to open socket', () => {
      const socket = createMockSocket(1);
      const session = manager.create(socket);

      const result = manager.send(session.id, 'connection:ready', {
        sessionId: session.id,
      });

      expect(result).toBe(true);
      expect(socket.send).toHaveBeenCalledTimes(1);

      const sentData = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sentData.type).toBe('connection:ready');
      expect(sentData.payload).toEqual({ sessionId: session.id });
      expect(sentData.timestamp).toBeDefined();
    });

    it('should return false for closed socket (readyState !== 1)', () => {
      const socket = createMockSocket(3); // CLOSED
      const session = manager.create(socket);

      const result = manager.send(session.id, 'connection:ready', {
        sessionId: session.id,
      });

      expect(result).toBe(false);
      expect(socket.send).not.toHaveBeenCalled();
    });

    it('should return false for unknown session', () => {
      const result = manager.send('nonexistent', 'connection:ready', {
        sessionId: 'nonexistent',
      });

      expect(result).toBe(false);
    });

    it('should remove stale session on send error', () => {
      const socket = createMockSocket(1);
      (socket.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection reset');
      });

      const session = manager.create(socket);
      const result = manager.send(session.id, 'connection:ready', {
        sessionId: session.id,
      });

      expect(result).toBe(false);
      expect(manager.get(session.id)).toBeUndefined();
      expect(manager.count).toBe(0);
    });
  });

  // =========================================================================
  // 9. Broadcast
  // =========================================================================
  describe('broadcast', () => {
    it('should send to all open sessions', () => {
      const s1 = createMockSocket(1);
      const s2 = createMockSocket(1);
      const s3 = createMockSocket(1);

      manager.create(s1);
      manager.create(s2);
      manager.create(s3);

      const count = manager.broadcast('system:notification', {
        type: 'info',
        message: 'Hello everyone',
      });

      expect(count).toBe(3);
      expect(s1.send).toHaveBeenCalledTimes(1);
      expect(s2.send).toHaveBeenCalledTimes(1);
      expect(s3.send).toHaveBeenCalledTimes(1);
    });

    it('should skip closed sockets', () => {
      const open = createMockSocket(1);
      const closed = createMockSocket(3);

      manager.create(open);
      manager.create(closed);

      const count = manager.broadcast('system:notification', {
        type: 'info',
        message: 'Hello',
      });

      expect(count).toBe(1);
      expect(open.send).toHaveBeenCalledTimes(1);
      expect(closed.send).not.toHaveBeenCalled();
    });

    it('should clean up stale sessions on send error', () => {
      const goodSocket = createMockSocket(1);
      const badSocket = createMockSocket(1);
      (badSocket.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection reset');
      });

      manager.create(goodSocket);
      const badSession = manager.create(badSocket);

      const count = manager.broadcast('system:notification', {
        type: 'info',
        message: 'Hello',
      });

      expect(count).toBe(1);
      expect(manager.get(badSession.id)).toBeUndefined();
      expect(manager.count).toBe(1);
    });

    it('should return 0 when no sessions exist', () => {
      const count = manager.broadcast('system:notification', {
        type: 'info',
        message: 'Hello empty room',
      });

      expect(count).toBe(0);
    });

    it('should send consistent JSON to each session', () => {
      const s1 = createMockSocket(1);
      const s2 = createMockSocket(1);

      manager.create(s1);
      manager.create(s2);

      manager.broadcast('system:notification', {
        type: 'info',
        message: 'broadcast test',
      });

      // Both sockets receive the same serialized data
      const data1 = (s1.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const data2 = (s2.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(data1).toBe(data2);

      const parsed = JSON.parse(data1);
      expect(parsed.type).toBe('system:notification');
      expect(parsed.payload).toEqual({ type: 'info', message: 'broadcast test' });
    });
  });

  describe('broadcastToChannel', () => {
    it('should only send to sessions subscribed to the channel', () => {
      const s1 = createMockSocket(1);
      const s2 = createMockSocket(1);
      const s3 = createMockSocket(1);

      const session1 = manager.create(s1);
      const session2 = manager.create(s2);
      manager.create(s3); // Not subscribed

      manager.subscribeToChannel(session1.id, 'general');
      manager.subscribeToChannel(session2.id, 'general');

      const count = manager.broadcastToChannel('general', 'system:notification', {
        type: 'info',
        message: 'Channel message',
      });

      expect(count).toBe(2);
      expect(s1.send).toHaveBeenCalledTimes(1);
      expect(s2.send).toHaveBeenCalledTimes(1);
      expect(s3.send).not.toHaveBeenCalled();
    });

    it('should skip closed sockets in channel', () => {
      const openSocket = createMockSocket(1);
      const closedSocket = createMockSocket(3);

      const openSession = manager.create(openSocket);
      const closedSession = manager.create(closedSocket);

      manager.subscribeToChannel(openSession.id, 'general');
      manager.subscribeToChannel(closedSession.id, 'general');

      const count = manager.broadcastToChannel('general', 'system:notification', {
        type: 'info',
        message: 'Channel message',
      });

      expect(count).toBe(1);
      expect(openSocket.send).toHaveBeenCalledTimes(1);
      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it('should clean up stale sessions in channel broadcast', () => {
      const goodSocket = createMockSocket(1);
      const badSocket = createMockSocket(1);
      (badSocket.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Connection reset');
      });

      const goodSession = manager.create(goodSocket);
      const badSession = manager.create(badSocket);

      manager.subscribeToChannel(goodSession.id, 'general');
      manager.subscribeToChannel(badSession.id, 'general');

      const count = manager.broadcastToChannel('general', 'system:notification', {
        type: 'info',
        message: 'Channel message',
      });

      expect(count).toBe(1);
      expect(manager.get(badSession.id)).toBeUndefined();
    });

    it('should return 0 when no subscribers', () => {
      manager.create(createMockSocket(1));

      const count = manager.broadcastToChannel('empty-channel', 'system:notification', {
        type: 'info',
        message: 'Nobody here',
      });

      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // 10. Cleanup
  // =========================================================================
  describe('cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should remove sessions idle longer than maxIdleMs', () => {
      const socket = createMockSocket(1);
      manager.create(socket);

      expect(manager.count).toBe(1);

      // Advance time beyond idle threshold
      vi.advanceTimersByTime(60_000);

      const removed = manager.cleanup(30_000); // 30s idle max

      expect(removed).toBe(1);
      expect(manager.count).toBe(0);
    });

    it('should close socket with code 4000', () => {
      const socket = createMockSocket(1);
      manager.create(socket);

      vi.advanceTimersByTime(60_000);
      manager.cleanup(30_000);

      expect(socket.close).toHaveBeenCalledWith(4000, 'Session timeout');
    });

    it('should keep active sessions', () => {
      const activeSocket = createMockSocket(1);
      const idleSocket = createMockSocket(1);

      const activeSession = manager.create(activeSocket);
      manager.create(idleSocket);

      // Advance 20 seconds
      vi.advanceTimersByTime(20_000);

      // Touch the active session to refresh its timestamp
      manager.touch(activeSession.id);

      // Advance another 20 seconds (total 40s, but active was touched at 20s)
      vi.advanceTimersByTime(20_000);

      const removed = manager.cleanup(30_000);

      expect(removed).toBe(1); // Only the idle session
      expect(manager.count).toBe(1);
      expect(manager.get(activeSession.id)).toBeDefined();
    });

    it('should return 0 when no sessions are stale', () => {
      manager.create(createMockSocket(1));
      manager.create(createMockSocket(1));

      // No time passes
      const removed = manager.cleanup(30_000);

      expect(removed).toBe(0);
      expect(manager.count).toBe(2);
    });

    it('should handle socket.close throwing gracefully', () => {
      const socket = createMockSocket(1);
      (socket.close as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Socket already closed');
      });

      manager.create(socket);

      vi.advanceTimersByTime(60_000);

      // Should not throw
      const removed = manager.cleanup(30_000);

      expect(removed).toBe(1);
      expect(manager.count).toBe(0);
    });

    it('should remove multiple stale sessions at once', () => {
      manager.create(createMockSocket(1));
      manager.create(createMockSocket(1));
      manager.create(createMockSocket(1));

      vi.advanceTimersByTime(120_000);

      const removed = manager.cleanup(60_000);

      expect(removed).toBe(3);
      expect(manager.count).toBe(0);
    });
  });
});
