/**
 * EventBusBridge Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOnPattern = vi.fn();
const mockEmitRaw = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: () => ({
      onPattern: mockOnPattern,
      emitRaw: mockEmitRaw,
    }),
  };
});

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { EventBusBridge } = await import('./event-bridge.js');

// ---------------------------------------------------------------------------
// Mock SessionManager
// ---------------------------------------------------------------------------

function createMockSessionManager() {
  const subscriptions = new Map<string, Map<string, () => void>>();

  return {
    send: vi.fn(),
    addEventSubscription: vi.fn((sessionId: string, pattern: string, unsub: () => void) => {
      if (!subscriptions.has(sessionId)) subscriptions.set(sessionId, new Map());
      const subs = subscriptions.get(sessionId)!;
      if (subs.size >= 50 && !subs.has(pattern)) return false;
      const existing = subs.get(pattern);
      if (existing) existing();
      subs.set(pattern, unsub);
      return true;
    }),
    removeEventSubscription: vi.fn((sessionId: string, pattern: string) => {
      const subs = subscriptions.get(sessionId);
      if (!subs) return false;
      const unsub = subs.get(pattern);
      if (unsub) {
        unsub();
        subs.delete(pattern);
        return true;
      }
      return false;
    }),
    getEventSubscriptions: vi.fn((sessionId: string) => {
      const subs = subscriptions.get(sessionId);
      return subs ? Array.from(subs.keys()) : [];
    }),
    _subscriptions: subscriptions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventBusBridge', () => {
  let bridge: InstanceType<typeof EventBusBridge>;
  let mockSM: ReturnType<typeof createMockSessionManager>;
  let mockUnsub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnsub = vi.fn();
    mockOnPattern.mockReturnValue(mockUnsub);
    mockSM = createMockSessionManager();
    bridge = new EventBusBridge(mockSM as never);
  });

  afterEach(() => {
    bridge.stop();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(bridge.isRunning).toBe(false);
      bridge.start();
      expect(bridge.isRunning).toBe(true);
      bridge.stop();
      expect(bridge.isRunning).toBe(false);
    });

    it('start is idempotent', () => {
      bridge.start();
      bridge.start();
      expect(bridge.isRunning).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Subscribe
  // -------------------------------------------------------------------------

  describe('subscribe', () => {
    beforeEach(() => bridge.start());

    it('subscribes to a valid pattern and sends success', () => {
      const result = bridge.subscribe('sess-1', 'agent.*');

      expect(result).toBe(true);
      expect(mockOnPattern).toHaveBeenCalledWith('agent.*', expect.any(Function));
      expect(mockSM.addEventSubscription).toHaveBeenCalledWith(
        'sess-1',
        'agent.*',
        expect.any(Function)
      );
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:subscribed', {
        pattern: 'agent.*',
        success: true,
      });
    });

    it('subscribes to ** (catch-all)', () => {
      const result = bridge.subscribe('sess-1', '**');
      expect(result).toBe(true);
    });

    it('rejects empty pattern', () => {
      const result = bridge.subscribe('sess-1', '');
      expect(result).toBe(false);
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:subscribed', {
        pattern: '',
        success: false,
        error: 'Pattern must be a non-empty string',
      });
    });

    it('rejects pattern with invalid characters', () => {
      const result = bridge.subscribe('sess-1', 'agent.{bad}');
      expect(result).toBe(false);
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:subscribed', {
        pattern: 'agent.{bad}',
        success: false,
        error: 'Pattern contains invalid characters',
      });
    });

    it('rejects pattern too long', () => {
      const longPattern = 'a'.repeat(101);
      const result = bridge.subscribe('sess-1', longPattern);
      expect(result).toBe(false);
    });

    it('rejects pattern too deep', () => {
      const result = bridge.subscribe('sess-1', 'a.b.c.d.e.f.g');
      expect(result).toBe(false);
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:subscribed', {
        pattern: 'a.b.c.d.e.f.g',
        success: false,
        error: 'Pattern too deep (max 6 segments)',
      });
    });

    it('rejects when bridge is not running', () => {
      bridge.stop();
      const result = bridge.subscribe('sess-1', 'agent.*');
      expect(result).toBe(false);
    });

    it('rejects when subscription limit reached', () => {
      // Fill up subscriptions
      mockSM.getEventSubscriptions.mockReturnValue(new Array(50).fill('x'));
      const result = bridge.subscribe('sess-1', 'new.pattern');
      expect(result).toBe(false);
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:subscribed', {
        pattern: 'new.pattern',
        success: false,
        error: 'Maximum subscriptions (50) reached',
      });
    });

    it('allows re-subscribing to same pattern (under limit)', () => {
      mockSM.getEventSubscriptions.mockReturnValue(new Array(50).fill('agent.*'));
      // Not rejected because the pattern already exists
      bridge.subscribe('sess-1', 'agent.*');
      // Pattern already in list, so it's allowed
    });

    it('cleans up EventBus subscription when addEventSubscription fails', () => {
      mockSM.addEventSubscription.mockReturnValue(false);
      const result = bridge.subscribe('sess-1', 'agent.*');
      expect(result).toBe(false);
      // The onPattern unsub should have been called to clean up
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('forwards matching events to WS session', () => {
      bridge.subscribe('sess-1', 'agent.*');

      // Get the handler that was passed to onPattern
      const handler = mockOnPattern.mock.calls[0]![1];

      // Simulate an event
      handler({
        type: 'agent.complete',
        category: 'agent',
        timestamp: '2026-01-01T00:00:00Z',
        source: 'orchestrator',
        data: { agentId: 'a1' },
      });

      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:message', {
        type: 'agent.complete',
        source: 'orchestrator',
        data: { agentId: 'a1' },
        timestamp: '2026-01-01T00:00:00Z',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Unsubscribe
  // -------------------------------------------------------------------------

  describe('unsubscribe', () => {
    beforeEach(() => bridge.start());

    it('unsubscribes and sends confirmation', () => {
      mockSM.removeEventSubscription.mockReturnValue(true);
      const result = bridge.unsubscribe('sess-1', 'agent.*');

      expect(result).toBe(true);
      expect(mockSM.removeEventSubscription).toHaveBeenCalledWith('sess-1', 'agent.*');
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:unsubscribed', {
        pattern: 'agent.*',
      });
    });

    it('returns false for non-existent subscription', () => {
      mockSM.removeEventSubscription.mockReturnValue(false);
      const result = bridge.unsubscribe('sess-1', 'nonexistent.*');
      expect(result).toBe(false);
      // Still sends confirmation
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:unsubscribed', {
        pattern: 'nonexistent.*',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  describe('publish', () => {
    beforeEach(() => bridge.start());

    it('publishes external.* events successfully', () => {
      const result = bridge.publish('sess-1', 'external.test', { hello: 'world' });

      expect(result).toBe(true);
      expect(mockEmitRaw).toHaveBeenCalledWith({
        type: 'external.test',
        category: 'external',
        timestamp: expect.any(String),
        source: 'ws:sess-1',
        data: { hello: 'world' },
      });
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:publish:ack', {
        type: 'external.test',
      });
    });

    it('publishes client.* events successfully', () => {
      const result = bridge.publish('sess-1', 'client.action', { action: 'click' });
      expect(result).toBe(true);
      expect(mockEmitRaw).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'client.action', category: 'client' })
      );
    });

    it('rejects events outside allowed namespaces', () => {
      const result = bridge.publish('sess-1', 'agent.complete', {});
      expect(result).toBe(false);
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:publish:error', {
        type: 'agent.complete',
        error: expect.stringContaining('restricted to namespaces'),
      });
    });

    it('rejects system.shutdown events', () => {
      const result = bridge.publish('sess-1', 'system.shutdown', {});
      expect(result).toBe(false);
      expect(mockEmitRaw).not.toHaveBeenCalled();
    });

    it('rejects empty event type', () => {
      const result = bridge.publish('sess-1', '', {});
      expect(result).toBe(false);
    });

    it('rejects when bridge is not running', () => {
      bridge.stop();
      const result = bridge.publish('sess-1', 'external.test', {});
      expect(result).toBe(false);
      expect(mockSM.send).toHaveBeenCalledWith('sess-1', 'event:publish:error', {
        type: 'external.test',
        error: 'Bridge is not running',
      });
    });

    it('rejects event type too long', () => {
      const longType = 'external.' + 'a'.repeat(100);
      const result = bridge.publish('sess-1', longType, {});
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: subscribe + publish roundtrip
  // -------------------------------------------------------------------------

  describe('subscribe + publish roundtrip', () => {
    beforeEach(() => bridge.start());

    it('subscriber receives published events via EventBus', () => {
      // Session A subscribes to external.*
      bridge.subscribe('sess-A', 'external.*');
      const handler = mockOnPattern.mock.calls[0]![1];

      // Session B publishes external.report
      bridge.publish('sess-B', 'external.report', { status: 'done' });

      // The emitRaw was called — simulate the EventBus delivering it to the handler
      const emittedEvent = mockEmitRaw.mock.calls[0]![0];
      handler(emittedEvent);

      // Session A should receive the event:message
      expect(mockSM.send).toHaveBeenCalledWith('sess-A', 'event:message', {
        type: 'external.report',
        source: 'ws:sess-B',
        data: { status: 'done' },
        timestamp: expect.any(String),
      });
    });
  });
});
