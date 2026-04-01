/**
 * Tunnel Service
 */

import { getLog } from '../../../services/log.js';
import type { TunnelInfo, WebhookEndpoint } from './types.js';

const log = getLog('TunnelService');

export interface TunnelServiceConfig {
  preferredProvider: 'ngrok' | 'cloudflare' | 'localtunnel';
  fallbackEnabled: boolean;
  ngrokAuthToken?: string;
  cloudflareToken?: string;
  defaultPort: number;
  webhookBasePath: string;
}

export class TunnelService {
  private tunnels = new Map<string, TunnelInfo>();
  private webhooks = new Map<string, WebhookEndpoint>();
  private config: TunnelServiceConfig;

  constructor(config: Partial<TunnelServiceConfig> = {}) {
    this.config = {
      preferredProvider: 'cloudflare',
      fallbackEnabled: true,
      defaultPort: parseInt(process.env.PORT || '8080'),
      webhookBasePath: '/webhooks/channels',
      ...config,
    };

    log.info('TunnelService initialized', { preferred: this.config.preferredProvider });
  }

  async startTunnel(
    channelId: string,
    platform: string,
    options?: {
      preferredProvider?: 'ngrok' | 'cloudflare' | 'localtunnel';
      subdomain?: string;
    }
  ): Promise<WebhookEndpoint> {
    const preferredProvider = options?.preferredProvider || this.config.preferredProvider;
    const secret = this.generateWebhookSecret();
    const path = this.config.webhookBasePath + '/' + platform + '/' + channelId;

    log.info('Starting tunnel for channel', { channelId, provider: preferredProvider });

    // For now, return a local URL (tunnel providers would be integrated here)
    const localUrl = 'http://localhost:' + this.config.defaultPort;

    const endpoint: WebhookEndpoint = {
      path,
      channelId,
      platform,
      secret,
      url: localUrl + path,
    };

    this.webhooks.set(channelId, endpoint);
    log.info('Tunnel endpoint created', { channelId, url: endpoint.url });

    return endpoint;
  }

  async stopTunnel(channelId: string): Promise<void> {
    const webhook = this.webhooks.get(channelId);
    if (!webhook) {
      log.warn('No tunnel found for channel', { channelId });
      return;
    }

    this.webhooks.delete(channelId);
    log.info('Tunnel stopped', { channelId });
  }

  getWebhookEndpoint(channelId: string): WebhookEndpoint | undefined {
    return this.webhooks.get(channelId);
  }

  getAllWebhooks(): WebhookEndpoint[] {
    return Array.from(this.webhooks.values());
  }

  async getTunnelHealth(channelId: string): Promise<{
    healthy: boolean;
    provider?: string;
    url?: string;
    error?: string;
  }> {
    const webhook = this.webhooks.get(channelId);
    if (!webhook) {
      return { healthy: false, error: 'No tunnel found' };
    }

    return {
      healthy: true,
      provider: this.config.preferredProvider,
      url: webhook.url,
    };
  }

  async stopAll(): Promise<void> {
    log.info('Stopping all tunnels');
    const stopPromises: Promise<void>[] = [];

    for (const [channelId] of this.webhooks) {
      stopPromises.push(
        this.stopTunnel(channelId).catch((error) => {
          log.error('Error stopping tunnel', { channelId, error });
        })
      );
    }

    await Promise.all(stopPromises);
    log.info('All tunnels stopped');
  }

  getStats(): {
    activeTunnels: number;
    activeWebhooks: number;
    providers: string[];
  } {
    return {
      activeTunnels: this.tunnels.size,
      activeWebhooks: this.webhooks.size,
      providers: ['ngrok', 'cloudflare', 'localtunnel'],
    };
  }

  private generateWebhookSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

let globalTunnelService: TunnelService | null = null;

export function getGlobalTunnelService(): TunnelService {
  if (!globalTunnelService) {
    globalTunnelService = new TunnelService();
  }
  return globalTunnelService;
}

export function resetGlobalTunnelService(): void {
  globalTunnelService = null;
}
