/**
 * Channel manager for handling multiple messaging channels
 */

import type { Agent } from '@ownpilot/core';
import type {
  ChannelHandler,
  IncomingMessage,
  OutgoingMessage,
  ChannelConfig,
  TelegramConfig,
} from './types/index.js';
import { createTelegramBot } from './telegram/index.js';
import { getLog } from './log.js';

const log = getLog('ChannelManager');

/**
 * Channel manager options
 */
export interface ChannelManagerOptions {
  /** Agent to use for processing messages */
  agent: Agent;
  /** Channel configurations */
  channels: ChannelConfig[];
}

/**
 * Manages multiple communication channels
 */
export class ChannelManager {
  private handlers = new Map<string, ChannelHandler>();
  private agent: Agent;

  constructor(options: ChannelManagerOptions) {
    this.agent = options.agent;

    // Initialize channels
    for (const config of options.channels) {
      if (!config.enabled) continue;

      const handler = this.createHandler(config);
      if (handler) {
        this.handlers.set(config.type, handler);
        this.setupMessageHandler(handler);
      }
    }
  }

  /**
   * Create channel handler based on config
   */
  private createHandler(config: ChannelConfig): ChannelHandler | undefined {
    switch (config.type) {
      case 'telegram':
        return createTelegramBot(config as TelegramConfig);
      // Add more channel types here
      default:
        log.warn(`Unknown channel type: ${config.type}`);
        return undefined;
    }
  }

  /**
   * Setup message handler for a channel
   */
  private setupMessageHandler(handler: ChannelHandler): void {
    handler.onMessage(async (message: IncomingMessage) => {
      log.info(`[${handler.type}] Message from ${message.username ?? message.userId}: ${message.text}`);

      try {
        // Process message through agent
        const result = await this.agent.chat(message.text);

        if (result.ok) {
          // Send response back
          const response: OutgoingMessage = {
            chatId: message.chatId,
            text: result.value.content,
            replyToMessageId: message.id,
          };
          await handler.sendMessage(response);
        } else {
          // Send error message
          await handler.sendMessage({
            chatId: message.chatId,
            text: `Sorry, I encountered an error: ${result.error.message}`,
            replyToMessageId: message.id,
          });
        }
      } catch (err) {
        log.error(`Error processing message`, err);
        await handler.sendMessage({
          chatId: message.chatId,
          text: 'Sorry, something went wrong while processing your message.',
          replyToMessageId: message.id,
        });
      }
    });
  }

  /**
   * Start all channels
   */
  async start(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (const [type, handler] of this.handlers) {
      if (handler.isReady()) {
        log.info(`Starting channel: ${type}`);
        startPromises.push(handler.start());
      } else {
        log.warn(`Channel ${type} is not ready, skipping`);
      }
    }

    await Promise.all(startPromises);
    log.info('All channels started');
  }

  /**
   * Stop all channels
   */
  async stop(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [type, handler] of this.handlers) {
      log.info(`Stopping channel: ${type}`);
      stopPromises.push(handler.stop());
    }

    await Promise.all(stopPromises);
    log.info('All channels stopped');
  }

  /**
   * Get a channel handler by type
   */
  getChannel<T extends ChannelHandler>(type: string): T | undefined {
    return this.handlers.get(type) as T | undefined;
  }

  /**
   * List all active channels
   */
  getActiveChannels(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Send message to a specific channel
   */
  async sendMessage(channelType: string, message: OutgoingMessage): Promise<boolean> {
    const handler = this.handlers.get(channelType);
    if (!handler) {
      return false;
    }

    await handler.sendMessage(message);
    return true;
  }

  /**
   * Broadcast message to all channels
   */
  async broadcast(chatIds: Map<string, string>, text: string): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [channelType, chatId] of chatIds) {
      const handler = this.handlers.get(channelType);
      if (handler) {
        promises.push(handler.sendMessage({ chatId, text }));
      }
    }

    await Promise.all(promises);
  }
}

/**
 * Create a channel manager instance
 */
export function createChannelManager(options: ChannelManagerOptions): ChannelManager {
  return new ChannelManager(options);
}
