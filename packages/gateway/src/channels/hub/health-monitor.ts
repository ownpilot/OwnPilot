/**
 * Channel Health Monitor
 *
 * Monitors health of all channels, performs automatic retries,
 * and provides health metrics for the Channel Hub.
 */

import { getLog } from '../../services/log.js';
import type { UniversalChannelAdapter } from './universal-adapter.js';
import type { ChannelHealth, ChannelStatus } from './types.js';

const log = getLog('HealthMonitor');

export interface HealthMonitorConfig {
  checkInterval: number;      // milliseconds
  unhealthyThreshold: number; // consecutive errors before marking unhealthy
  autoRetry: boolean;
  autoRetryDelay: number;     // milliseconds
  maxAutoRetries: number;
}

export interface ChannelHealthEntry {
  adapter: UniversalChannelAdapter;
  health: ChannelHealth;
  lastCheck: Date;
  autoRetryCount: number;
  statusHistory: Array<{ status: ChannelStatus; timestamp: Date }>;
}

export class ChannelHealthMonitor {
  private channels = new Map<string, ChannelHealthEntry>();
  private checkInterval?: NodeJS.Timeout;
  private config: HealthMonitorConfig;

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = {
      checkInterval: 30000,      // 30 seconds
      unhealthyThreshold: 3,
      autoRetry: true,
      autoRetryDelay: 5000,      // 5 seconds
      maxAutoRetries: 5,
      ...config,
    };
  }

  /**
   * Start monitoring a channel.
   */
  monitor(channelId: string, adapter: UniversalChannelAdapter): void {
    log.info(`Started monitoring channel: ${channelId}`);

    const entry: ChannelHealthEntry = {
      adapter,
      health: adapter.getHealth(),
      lastCheck: new Date(),
      autoRetryCount: 0,
      statusHistory: [{ status: adapter.getStatus(), timestamp: new Date() }],
    };

    this.channels.set(channelId, entry);

    // Listen to channel events
    adapter.on('channel:status_changed', (event) => {
      this.handleStatusChange(channelId, event.newStatus);
    });

    adapter.on('channel:error', (event) => {
      this.handleError(channelId, event.error);
    });

    adapter.on('message:sent', () => {
      this.updateHealth(channelId);
    });

    adapter.on('message:received', () => {
      this.updateHealth(channelId);
    });
  }

  /**
   * Stop monitoring a channel.
   */
  unmonitor(channelId: string): void {
    log.info(`Stopped monitoring channel: ${channelId}`);
    this.channels.delete(channelId);
  }

  /**
   * Start the health check loop.
   */
  start(): void {
    if (this.checkInterval) {
      return;
    }

    log.info('Health monitor started');

    this.checkInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.checkInterval);
  }

  /**
   * Stop the health check loop.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      log.info('Health monitor stopped');
    }
  }

  /**
   * Get health for a specific channel.
   */
  getChannelHealth(channelId: string): ChannelHealth | null {
    const entry = this.channels.get(channelId);
    if (!entry) {
      return null;
    }

    entry.health = entry.adapter.getHealth();
    return entry.health;
  }

  /**
   * Get health for all channels.
   */
  getAllHealth(): Map<string, ChannelHealth> {
    const result = new Map<string, ChannelHealth>();

    for (const [channelId, entry] of this.channels) {
      entry.health = entry.adapter.getHealth();
      result.set(channelId, entry.health);
    }

    return result;
  }

  /**
   * Get system-wide health summary.
   */
  getSystemHealth(): {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    disconnected: number;
    avgLatency: number;
    totalMessages: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    let disconnected = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let totalMessages = 0;

    for (const [_, entry] of this.channels) {
      const health = entry.adapter.getHealth();

      switch (health.status) {
        case 'healthy':
          healthy++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
        default:
          disconnected++;
      }

      if (health.latency.average > 0) {
        totalLatency += health.latency.average;
        latencyCount++;
      }

      totalMessages += health.throughput.messagesSent + health.throughput.messagesReceived;
    }

    return {
      total: this.channels.size,
      healthy,
      degraded,
      unhealthy,
      disconnected,
      avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      totalMessages,
    };
  }

  /**
   * Force health check on all channels.
   */
  async checkAll(): Promise<void> {
    log.debug('Performing manual health check on all channels');
    await this.performHealthChecks();
  }

  /**
   * Get channel status history.
   */
  getStatusHistory(channelId: string): Array<{ status: ChannelStatus; timestamp: Date }> | null {
    const entry = this.channels.get(channelId);
    return entry?.statusHistory || null;
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async performHealthChecks(): Promise<void> {
    for (const [channelId, entry] of this.channels) {
      try {
        const health = entry.adapter.getHealth();

        entry.health = health;
        entry.lastCheck = new Date();

        // Check if we need to auto-retry
        if (this.config.autoRetry && this.shouldAutoRetry(entry)) {
          await this.attemptAutoRetry(channelId, entry);
        }

        // Log degraded/unhealthy channels
        if (health.status === 'unhealthy') {
          log.warn(`Channel ${channelId} is unhealthy: ${health.errors.lastError?.message}`);
        } else if (health.status === 'degraded') {
          log.debug(`Channel ${channelId} is degraded (latency: ${health.latency.p95}ms)`);
        }
      } catch (error) {
        log.error(`Health check failed for channel ${channelId}:`, error);
      }
    }
  }

  private handleStatusChange(channelId: string, newStatus: ChannelStatus): void {
    const entry = this.channels.get(channelId);
    if (!entry) {
      return;
    }

    // Track status history
    entry.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
    });

    // Keep only last 100 status changes
    if (entry.statusHistory.length > 100) {
      entry.statusHistory.shift();
    }

    // Reset auto-retry count on successful connection
    if (newStatus === 'connected') {
      entry.autoRetryCount = 0;
      log.info(`Channel ${channelId} connected successfully`);
    }

    // Log important status changes
    if (newStatus === 'error') {
      log.error(`Channel ${channelId} entered error state`);
    } else if (newStatus === 'reconnecting') {
      log.info(`Channel ${channelId} is reconnecting...`);
    }

    this.updateHealth(channelId);
  }

  private handleError(channelId: string, error: { code: string; message: string }): void {
    log.error(`Channel ${channelId} error [${error.code}]: ${error.message}`);

    const entry = this.channels.get(channelId);
    if (entry) {
      entry.health = entry.adapter.getHealth();
    }
  }

  private updateHealth(channelId: string): void {
    const entry = this.channels.get(channelId);
    if (entry) {
      entry.health = entry.adapter.getHealth();
    }
  }

  private shouldAutoRetry(entry: ChannelHealthEntry): boolean {
    const status = entry.adapter.getStatus();

    // Only retry on error or disconnected states
    if (status !== 'error' && status !== 'disconnected') {
      return false;
    }

    // Don't exceed max retries
    if (entry.autoRetryCount >= this.config.maxAutoRetries) {
      if (entry.autoRetryCount === this.config.maxAutoRetries) {
        log.error(`Channel max auto-retries (${this.config.maxAutoRetries}) exceeded`);
        entry.autoRetryCount++; // Increment to prevent repeated logging
      }
      return false;
    }

    return true;
  }

  private async attemptAutoRetry(channelId: string, entry: ChannelHealthEntry): Promise<void> {
    entry.autoRetryCount++;

    log.info(
      `Attempting auto-retry for channel ${channelId} ` +
      `(attempt ${entry.autoRetryCount}/${this.config.maxAutoRetries})`
    );

    try {
      // Wait before retrying
      await this.sleep(this.config.autoRetryDelay * entry.autoRetryCount);

      // Disconnect first if needed
      if (entry.adapter.getStatus() === 'error') {
        await entry.adapter.disconnect();
      }

      // Attempt to reconnect
      const result = await entry.adapter.connect();

      if (result.success) {
        log.info(`Auto-retry successful for channel ${channelId}`);
        entry.autoRetryCount = 0;
      } else {
        log.warn(`Auto-retry failed for channel ${channelId}: ${result.error}`);
      }
    } catch (error) {
      log.error(`Auto-retry error for channel ${channelId}:`, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Singleton instance for system-wide health monitoring.
 */
let globalHealthMonitor: ChannelHealthMonitor | null = null;

export function getGlobalHealthMonitor(): ChannelHealthMonitor {
  if (!globalHealthMonitor) {
    globalHealthMonitor = new ChannelHealthMonitor();
    globalHealthMonitor.start();
  }
  return globalHealthMonitor;
}

export function resetGlobalHealthMonitor(): void {
  if (globalHealthMonitor) {
    globalHealthMonitor.stop();
    globalHealthMonitor = null;
  }
}
