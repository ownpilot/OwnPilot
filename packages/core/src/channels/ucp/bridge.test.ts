/**
 * UCP Bridge Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UCPBridgeManager, type BridgeStore } from './bridge.js';
import type { UCPMessage, UCPBridgeConfig } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<UCPMessage> = {}): UCPMessage {
  return {
    id: 'msg-1',
    externalId: 'ext-1',
    channel: 'telegram',
    channelInstanceId: 'channel.telegram',
    direction: 'inbound',
    sender: { id: 'user-1', platform: 'telegram' },
    content: [{ type: 'text', text: 'hello world', format: 'plain' }],
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

function makeBridge(overrides: Partial<UCPBridgeConfig> = {}): UCPBridgeConfig {
  return {
    id: 'bridge-1',
    sourceChannelId: 'channel.telegram',
    targetChannelId: 'channel.whatsapp',
    direction: 'both',
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('UCPBridgeManager', () => {
  let manager: UCPBridgeManager;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new UCPBridgeManager();
    sendFn = vi.fn().mockResolvedValue('sent-1');
    manager.setSendFunction(sendFn);
  });

  describe('addBridge / removeBridge', () => {
    it('adds a bridge configuration', () => {
      manager.addBridge(makeBridge());
      expect(manager.getActiveBridges()).toHaveLength(1);
    });

    it('removes a bridge by ID', () => {
      manager.addBridge(makeBridge({ id: 'b-1' }));
      manager.addBridge(makeBridge({ id: 'b-2' }));

      manager.removeBridge('b-1');
      expect(manager.getActiveBridges()).toHaveLength(1);
      expect(manager.getActiveBridges()[0].id).toBe('b-2');
    });
  });

  describe('getActiveBridges', () => {
    it('only returns enabled bridges', () => {
      manager.addBridge(makeBridge({ id: 'b-1', enabled: true }));
      manager.addBridge(makeBridge({ id: 'b-2', enabled: false }));

      const active = manager.getActiveBridges();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('b-1');
    });
  });

  describe('bridgeMessage', () => {
    it('forwards inbound message to target channel', async () => {
      manager.addBridge(
        makeBridge({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'both',
        })
      );

      const msg = makeMessage({
        channelInstanceId: 'channel.telegram',
        direction: 'inbound',
      });

      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(1);
      expect(sendFn).toHaveBeenCalledTimes(1);

      const sentMsg = sendFn.mock.calls[0][1] as UCPMessage;
      expect(sentMsg.direction).toBe('outbound');
      expect(sentMsg.channelInstanceId).toBe('channel.whatsapp');
      expect(sentMsg.metadata.bridgedFrom).toBe('channel.telegram');
    });

    it('forwards reverse direction (target → source)', async () => {
      manager.addBridge(
        makeBridge({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'both',
        })
      );

      const msg = makeMessage({
        channelInstanceId: 'channel.whatsapp',
        direction: 'inbound',
      });

      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(1);
      expect(sendFn.mock.calls[0][0]).toBe('channel.telegram');
    });

    it('respects one-way bridge direction', async () => {
      manager.addBridge(
        makeBridge({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'source_to_target',
        })
      );

      // Forward direction: source → target
      const msg1 = makeMessage({
        channelInstanceId: 'channel.telegram',
        direction: 'inbound',
      });
      expect(await manager.bridgeMessage(msg1)).toBe(1);

      sendFn.mockClear();

      // Reverse direction: target → source should NOT bridge
      const msg2 = makeMessage({
        channelInstanceId: 'channel.whatsapp',
        direction: 'inbound',
      });
      expect(await manager.bridgeMessage(msg2)).toBe(0);
    });

    it('does not bridge outbound messages', async () => {
      manager.addBridge(makeBridge());

      const msg = makeMessage({ direction: 'outbound' });
      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(0);
    });

    it('does not bridge disabled bridges', async () => {
      manager.addBridge(makeBridge({ enabled: false }));

      const msg = makeMessage({ direction: 'inbound' });
      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(0);
    });

    it('applies filter pattern', async () => {
      manager.addBridge(
        makeBridge({
          filterPattern: 'urgent|important',
        })
      );

      // Non-matching message
      const msg1 = makeMessage({
        direction: 'inbound',
        content: [{ type: 'text', text: 'casual hello' }],
      });
      expect(await manager.bridgeMessage(msg1)).toBe(0);

      // Matching message
      const msg2 = makeMessage({
        direction: 'inbound',
        content: [{ type: 'text', text: 'this is urgent!' }],
      });
      expect(await manager.bridgeMessage(msg2)).toBe(1);
    });

    it('handles send failure gracefully (best-effort)', async () => {
      manager.addBridge(makeBridge());
      sendFn.mockRejectedValueOnce(new Error('Send failed'));

      const msg = makeMessage({ direction: 'inbound' });
      // Should not throw, just return 0
      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(0);
    });

    it('returns 0 when no send function is set', async () => {
      const mgr = new UCPBridgeManager();
      mgr.addBridge(makeBridge());

      const msg = makeMessage({ direction: 'inbound' });
      const count = await mgr.bridgeMessage(msg);
      expect(count).toBe(0);
    });

    it('bridges to multiple targets', async () => {
      manager.addBridge(
        makeBridge({
          id: 'b-1',
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
        })
      );
      manager.addBridge(
        makeBridge({
          id: 'b-2',
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.email',
        })
      );

      const msg = makeMessage({ direction: 'inbound' });
      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(2);
      expect(sendFn).toHaveBeenCalledTimes(2);
    });

    it('ignores invalid filter regex (forwards anyway)', async () => {
      manager.addBridge(
        makeBridge({
          filterPattern: '[invalid(regex',
        })
      );

      const msg = makeMessage({ direction: 'inbound' });
      // Invalid regex is silently ignored — message still bridges
      const count = await manager.bridgeMessage(msg);
      expect(count).toBe(1);
    });
  });

  describe('loadBridges', () => {
    it('loads bridges from a store', async () => {
      const store: BridgeStore = {
        getAll: vi.fn().mockResolvedValue([makeBridge({ id: 'b-1' }), makeBridge({ id: 'b-2' })]),
        getById: vi.fn(),
        getByChannel: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      await manager.loadBridges(store);
      expect(manager.getActiveBridges()).toHaveLength(2);
    });
  });
});
