/**
 * Base Channel Adapter
 *
 * Common functionality for all channel adapters
 */

import type {
  ChannelType,
  ChannelStatus,
  OutgoingMessage,
  Attachment,
} from '../ws/types.js';
import type {
  ChannelAdapter,
  ChannelAdapterEvents,
  ChannelConfig,
  ChannelSender,
} from './types.js';

/**
 * Abstract base class for channel adapters
 */
export abstract class BaseChannelAdapter implements ChannelAdapter {
  readonly id: string;
  readonly type: ChannelType;
  readonly name: string;

  protected _status: ChannelStatus = 'disconnected';
  protected reconnectAttempts = 0;
  protected reconnectTimer: NodeJS.Timeout | null = null;

  protected readonly config: ChannelConfig;
  protected readonly eventHandlers = new Map<
    keyof ChannelAdapterEvents,
    Set<ChannelAdapterEvents[keyof ChannelAdapterEvents]>
  >();

  constructor(config: ChannelConfig) {
    this.id = config.id;
    this.type = config.type;
    this.name = config.name;
    this.config = config;
  }

  get status(): ChannelStatus {
    return this._status;
  }

  /**
   * Update status and emit event
   */
  protected setStatus(status: ChannelStatus, error?: string): void {
    const oldStatus = this._status;
    this._status = status;

    if (oldStatus !== status) {
      this.emit('statusChange', status, error);
    }
  }

  /**
   * Connect to the channel (must be implemented by subclass)
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the channel (must be implemented by subclass)
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message (must be implemented by subclass)
   */
  abstract sendMessage(message: OutgoingMessage): Promise<string>;

  /**
   * Handle reconnection logic
   */
  protected async handleReconnect(): Promise<void> {
    if (!this.config.autoReconnect) {
      return;
    }

    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    const delay = this.config.reconnectDelay ?? 5000;

    if (this.reconnectAttempts >= maxAttempts) {
      console.error(
        `[${this.type}:${this.id}] Max reconnect attempts (${maxAttempts}) reached`
      );
      this.setStatus('error', 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    console.log(
      `[${this.type}:${this.id}] Reconnecting (attempt ${this.reconnectAttempts}/${maxAttempts}) in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.reconnectAttempts = 0;
      } catch (error) {
        console.error(`[${this.type}:${this.id}] Reconnect failed:`, error);
        await this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Cancel pending reconnection
   */
  protected cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  /**
   * Optional: Send typing indicator
   */
  async sendTyping?(chatId: string): Promise<void> {
    // Override in subclass if supported
    console.log(`[${this.type}:${this.id}] Typing indicator not supported`);
  }

  /**
   * Optional: Edit message
   */
  async editMessage?(messageId: string, content: string): Promise<void> {
    throw new Error(`Edit message not supported for ${this.type}`);
  }

  /**
   * Optional: Delete message
   */
  async deleteMessage?(messageId: string): Promise<void> {
    throw new Error(`Delete message not supported for ${this.type}`);
  }

  /**
   * Optional: React to message
   */
  async reactToMessage?(messageId: string, emoji: string): Promise<void> {
    throw new Error(`Reactions not supported for ${this.type}`);
  }

  /**
   * Optional: Upload attachment
   */
  async uploadAttachment?(attachment: Attachment): Promise<string> {
    throw new Error(`Attachment upload not supported for ${this.type}`);
  }

  /**
   * Optional: Get sender info
   */
  async getSenderInfo?(senderId: string): Promise<ChannelSender | null> {
    return null;
  }

  /**
   * Register event handler
   */
  on<K extends keyof ChannelAdapterEvents>(
    event: K,
    handler: ChannelAdapterEvents[K]
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event handler
   */
  off<K extends keyof ChannelAdapterEvents>(
    event: K,
    handler: ChannelAdapterEvents[K]
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit event to handlers
   */
  protected emit<K extends keyof ChannelAdapterEvents>(
    event: K,
    ...args: Parameters<ChannelAdapterEvents[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: unknown[]) => void)(...args);
        } catch (error) {
          console.error(`[${this.type}:${this.id}] Error in ${event} handler:`, error);
        }
      }
    }
  }

  /**
   * Cleanup resources
   */
  protected cleanup(): void {
    this.cancelReconnect();
    this.eventHandlers.clear();
  }
}
