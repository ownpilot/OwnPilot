/**
 * UCP Channel Bridge
 *
 * Manages message bridging between channel instances.
 * When a message arrives on one channel, the bridge can automatically
 * forward it to another (or both directions).
 *
 * Bridge configuration is stored in the database (channel_bridges table).
 * This class provides the runtime bridging logic.
 */

import type { UCPBridgeConfig, UCPMessage, UCPContent } from './types.js';

// ============================================================================
// Bridge Store Interface
// ============================================================================

/**
 * Persistence layer for bridge configurations.
 * Implemented by the gateway's BridgeRepository.
 */
export interface BridgeStore {
  getAll(): Promise<UCPBridgeConfig[]>;
  getById(id: string): Promise<UCPBridgeConfig | null>;
  getByChannel(channelId: string): Promise<UCPBridgeConfig[]>;
  save(config: Omit<UCPBridgeConfig, 'id' | 'createdAt'>): Promise<UCPBridgeConfig>;
  update(id: string, changes: Partial<UCPBridgeConfig>): Promise<void>;
  remove(id: string): Promise<void>;
}

// ============================================================================
// Bridge Send Function
// ============================================================================

/**
 * Function to send a UCPMessage to a specific channel instance.
 * Provided by the ChannelService during bridge setup.
 */
export type BridgeSendFn = (channelInstanceId: string, msg: UCPMessage) => Promise<string>;

// ============================================================================
// Bridge Manager
// ============================================================================

export class UCPBridgeManager {
  private bridges: UCPBridgeConfig[] = [];
  private sendFn: BridgeSendFn | null = null;

  /**
   * Load bridge configurations from the store.
   */
  async loadBridges(store: BridgeStore): Promise<void> {
    this.bridges = await store.getAll();
  }

  /**
   * Set the function used to send messages through channels.
   */
  setSendFunction(fn: BridgeSendFn): void {
    this.sendFn = fn;
  }

  /**
   * Add a bridge configuration at runtime.
   */
  addBridge(config: UCPBridgeConfig): void {
    this.bridges.push(config);
  }

  /**
   * Remove a bridge configuration.
   */
  removeBridge(id: string): void {
    this.bridges = this.bridges.filter((b) => b.id !== id);
  }

  /**
   * Get all active bridges.
   */
  getActiveBridges(): UCPBridgeConfig[] {
    return this.bridges.filter((b) => b.enabled);
  }

  /**
   * Check if a message should be bridged and forward it to target channels.
   *
   * Returns the number of channels the message was forwarded to.
   */
  async bridgeMessage(msg: UCPMessage): Promise<number> {
    if (!this.sendFn || msg.direction !== 'inbound') return 0;

    const sourceId = msg.channelInstanceId;
    let forwardCount = 0;

    for (const bridge of this.bridges) {
      if (!bridge.enabled) continue;

      // Determine if this bridge applies to the source channel
      let targetId: string | null = null;

      if (bridge.sourceChannelId === sourceId) {
        if (bridge.direction === 'source_to_target' || bridge.direction === 'both') {
          targetId = bridge.targetChannelId;
        }
      } else if (bridge.targetChannelId === sourceId) {
        if (bridge.direction === 'target_to_source' || bridge.direction === 'both') {
          targetId = bridge.sourceChannelId;
        }
      }

      if (!targetId) continue;

      // Apply filter pattern if configured
      if (bridge.filterPattern) {
        const text = extractTextFromContent(msg.content);
        try {
          const regex = new RegExp(bridge.filterPattern);
          if (!regex.test(text)) continue;
        } catch {
          // Invalid regex — skip filter
        }
      }

      // Forward the message
      try {
        const forwardedMsg: UCPMessage = {
          ...msg,
          direction: 'outbound',
          channelInstanceId: targetId,
          metadata: {
            ...msg.metadata,
            bridgedFrom: sourceId,
            originalExternalId: msg.externalId,
          },
        };

        await this.sendFn(targetId, forwardedMsg);
        forwardCount++;
      } catch {
        // Log but don't fail — bridging is best-effort
      }
    }

    return forwardCount;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractTextFromContent(content: UCPContent[]): string {
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join(' ');
}
