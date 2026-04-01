/**
 * Universal Channel Adapter
 *
 * Base class for all channel adapters in Channel Hub 2.0.
 * Provides unified interface for bidirectional, encrypted communication.
 */

import { EventEmitter } from 'node:events';
import { getLog } from '../../services/log.js';
import type {
  ChannelConfig,
  ChannelStatus,
  ChannelHealth,
  HubIncomingMessage,
  HubOutgoingMessage,
  HealthStatus,
  MessageContent,
  ChannelCredentials,
} from './types.js';
import type { ChannelUser } from '@ownpilot/core';

const log = getLog('UniversalAdapter');

export interface MessageHandler {
  (message: HubIncomingMessage): void | Promise<void>;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
  webhookUrl?: string;
  setupTime: number;
}

export abstract class UniversalChannelAdapter extends EventEmitter {
  protected config: ChannelConfig;
  protected status: ChannelStatus = 'disconnected';
  protected health: ChannelHealth;
  protected messageHandler?: MessageHandler;
  protected stats = {
    messagesSent: 0,
    messagesReceived: 0,
    bytesTransferred: 0,
    startTime: Date.now(),
  };
  protected errorHistory: Array<{ message: string; code: string; timestamp: Date }> = [];
  protected consecutiveErrors = 0;
  protected lastActivity = new Date();
  protected connectedAt?: Date;

  constructor(config: ChannelConfig) {
    super();
    this.config = config;
    this.health = this.createInitialHealth();
  }

  // ========================================================================
  // Abstract Methods - Must be implemented by each platform
  // ========================================================================

  /**
   * Connect to the channel platform.
   * Should establish webhook, websocket, or polling connection.
   */
  abstract connect(): Promise<ConnectionResult>;

  /**
   * Disconnect from the platform gracefully.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message to the platform.
   * Returns the platform-specific message ID.
   */
  protected abstract sendInternal(message: HubOutgoingMessage): Promise<string>;

  /**
   * Set up the incoming message listener.
   * Should call handleIncomingMessage() when messages arrive.
   */
  protected abstract setupIncomingHandler(): Promise<void>;

  /**
   * Validate the provided credentials.
   */
  abstract validateCredentials(credentials: ChannelCredentials): Promise<boolean>;

  /**
   * Get platform-specific user info.
   */
  abstract getUserInfo(platformUserId: string): Promise<ChannelUser | null>;

  /**
   * Send typing indicator (if supported).
   */
  abstract sendTypingIndicator(platformChatId: string): Promise<void>;

  // ========================================================================
  // Universal Features - Shared across all adapters
  // ========================================================================

  /**
   * Send a message with optional encryption.
   */
  async send(message: HubOutgoingMessage): Promise<string> {
    const startTime = Date.now();

    try {
      if (this.status !== 'connected') {
        throw new Error(`Cannot send message: channel is ${this.status}`);
      }

      // Encrypt if requested and enabled
      if (message.encrypt && this.config.privacy.e2eEnabled) {
        // TODO: Integrate with SignalProtocol
        log.debug('Encryption requested but not yet implemented');
      }

      // Send via platform-specific implementation
      const messageId = await this.sendInternal(message);

      // Update stats
      this.stats.messagesSent++;
      this.lastActivity = new Date();
      this.consecutiveErrors = 0;

      // Update health metrics
      const latency = Date.now() - startTime;
      this.updateLatencyMetrics(latency);

      // Emit event
      this.emit('message:sent', {
        channelId: this.config.id,
        messageId,
        latency,
        timestamp: new Date(),
      });

      return messageId;
    } catch (error) {
      this.handleError('SEND_FAILED', 'Failed to send message', error);
      throw error;
    }
  }

  /**
   * Register a handler for incoming messages.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandler = handler;

    // Return unsubscribe function
    return () => {
      this.messageHandler = undefined;
    };
  }

  /**
   * Handle incoming message from platform.
   * Called by platform-specific implementations.
   */
  protected async handleIncomingMessage(
    platformMessageId: string,
    sender: ChannelUser,
    content: MessageContent,
    metadata: {
      platformChatId: string;
      timestamp: Date;
      replyTo?: string;
      threadId?: string;
      raw?: unknown;
    }
  ): Promise<void> {
    try {
      // Strip metadata for privacy
      const strippedMetadata = this.stripMetadata(metadata);

      const message: HubIncomingMessage = {
        id: `${this.config.id}:${platformMessageId}`,
        channelId: this.config.id,
        platform: this.config.platform,
        platformMessageId,
        sender,
        content,
        timestamp: metadata.timestamp,
        replyTo: metadata.replyTo,
        threadId: metadata.threadId,
        encrypted: false, // TODO: Detect encrypted messages
        metadata: strippedMetadata,
      };

      // Update stats
      this.stats.messagesReceived++;
      this.lastActivity = new Date();

      // Call registered handler
      if (this.messageHandler) {
        await this.messageHandler(message);
      }

      // Emit event
      this.emit('message:received', {
        channelId: this.config.id,
        message,
        timestamp: new Date(),
      });
    } catch (error) {
      this.handleError('MESSAGE_HANDLER_ERROR', 'Error processing incoming message', error);
    }
  }

  /**
   * Get current connection status.
   */
  getStatus(): ChannelStatus {
    return this.status;
  }

  /**
   * Get comprehensive health metrics.
   */
  getHealth(): ChannelHealth {
    this.updateHealthStatus();
    return this.health;
  }

  /**
   * Pause the channel (stop processing but keep connection).
   */
  async pause(): Promise<void> {
    if (this.status === 'connected') {
      this.status = 'paused';
      log.info(`Channel ${this.config.id} paused`);
      this.emit('channel:paused', { channelId: this.config.id });
    }
  }

  /**
   * Resume the channel.
   */
  async resume(): Promise<void> {
    if (this.status === 'paused') {
      this.status = 'connected';
      log.info(`Channel ${this.config.id} resumed`);
      this.emit('channel:resumed', { channelId: this.config.id });
    }
  }

  // ========================================================================
  // Health Monitoring
  // ========================================================================

  private createInitialHealth(): ChannelHealth {
    return {
      status: 'unknown',
      latency: { current: 0, average: 0, p95: 0, p99: 0 },
      throughput: {
        messagesSent: 0,
        messagesReceived: 0,
        bytesTransferred: 0,
        messagesPerSecond: 0,
      },
      errors: {
        totalErrors: 0,
        consecutiveErrors: 0,
        errorRate: 0,
      },
      encryption: {
        enabled: this.config.privacy.e2eEnabled,
        protocol: this.config.privacy.e2eEnabled ? 'signal' : 'none',
        sessionEstablished: false,
        lastRotation: new Date(),
      },
      lastActivity: new Date(),
    };
  }

  private updateHealthStatus(): void {
    const uptime = Date.now() - (this.connectedAt?.getTime() || this.stats.startTime);
    const errorRate = (this.errorHistory.length / (uptime / 60000)) || 0;

    // Determine health status
    let status: HealthStatus = 'healthy';
    if (this.status === 'error' || this.consecutiveErrors > 5) {
      status = 'unhealthy';
    } else if (errorRate > 1 || this.health.latency.p95 > 5000) {
      status = 'degraded';
    }

    // Calculate throughput
    const secondsRunning = uptime / 1000;
    const messagesPerSecond = (this.stats.messagesSent + this.stats.messagesReceived) / secondsRunning;

    this.health = {
      ...this.health,
      status,
      throughput: {
        messagesSent: this.stats.messagesSent,
        messagesReceived: this.stats.messagesReceived,
        bytesTransferred: this.stats.bytesTransferred,
        messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
      },
      errors: {
        totalErrors: this.errorHistory.length,
        consecutiveErrors: this.consecutiveErrors,
        errorRate: Math.round(errorRate * 100) / 100,
        lastError: this.errorHistory[this.errorHistory.length - 1],
      },
      lastActivity: this.lastActivity,
    };
  }

  private latencyHistory: number[] = [];

  private updateLatencyMetrics(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }

    const sorted = [...this.latencyHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    this.health.latency = {
      current: latency,
      average: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      p95: sorted[p95Index] || latency,
      p99: sorted[p99Index] || latency,
    };
  }

  // ========================================================================
  // Privacy & Security
  // ========================================================================

  private stripMetadata(metadata: {
    platformChatId: string;
    timestamp: Date;
    replyTo?: string;
    threadId?: string;
    raw?: unknown;
  }) {
    const stripped: string[] = [];

    // Remove platform-specific sensitive data
    if (metadata.raw) {
      stripped.push('raw_platform_data');
      delete (metadata as { raw?: unknown }).raw;
    }

    // Normalize timestamp to remove precision that could identify timezone
    const originalTimestamp = metadata.timestamp;
    const normalizedTimestamp = new Date(
      Math.floor(originalTimestamp.getTime() / 60000) * 60000
    );

    if (originalTimestamp.getTime() !== normalizedTimestamp.getTime()) {
      stripped.push('precise_timestamp');
    }

    return {
      originalTimestamp,
      processedAt: new Date(),
      stripped,
      platform: this.config.platform,
    };
  }

  // ========================================================================
  // Error Handling
  // ========================================================================

  protected handleError(code: string, message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.consecutiveErrors++;
    this.errorHistory.push({
      message: `${message}: ${errorMessage}`,
      code,
      timestamp: new Date(),
    });

    // Keep only last 100 errors
    if (this.errorHistory.length > 100) {
      this.errorHistory.shift();
    }

    log.error(`[${this.config.id}] ${code}: ${message}`, error);

    // Check if we should transition to error state
    if (this.consecutiveErrors >= this.config.retryPolicy.maxAttempts) {
      this.status = 'error';
      this.emit('channel:error', {
        channelId: this.config.id,
        error: { code, message: errorMessage },
      });
    }

    this.updateHealthStatus();
  }

  // ========================================================================
  // Retry Logic
  // ========================================================================

  protected async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    const { maxAttempts, baseDelay, maxDelay, exponential } = this.config.retryPolicy;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }

        const delay = exponential
          ? Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
          : baseDelay;

        log.warn(`[${this.config.id}] ${context} failed (attempt ${attempt}), retrying in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    throw new Error(`Max retry attempts exceeded for ${context}`);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================================================
  // Protected Helpers for Subclasses
  // ========================================================================

  protected setStatus(status: ChannelStatus): void {
    const oldStatus = this.status;
    this.status = status;

    if (status === 'connected' && oldStatus !== 'connected') {
      this.connectedAt = new Date();
      this.consecutiveErrors = 0;
    }


    this.emit('channel:status_changed', {
      channelId: this.config.id,
      oldStatus,
      newStatus: status,
      timestamp: new Date(),
    });

    log.info(`[${this.config.id}] Status: ${oldStatus} -> ${status}`);
  }

  protected updateStats(bytes: number): void {
    this.stats.bytesTransferred += bytes;
    this.lastActivity = new Date();
  }
}
