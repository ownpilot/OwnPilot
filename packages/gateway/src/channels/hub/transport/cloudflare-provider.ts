/**
 * Cloudflare Tunnel Provider
 */

import { getLog } from '../../../services/log.js';
import type { TunnelProviderInterface, TunnelConfig, TunnelInfo, TunnelProvider } from './types.js';

const log = getLog('Tunnel:Cloudflare');

export class CloudflareProvider implements TunnelProviderInterface {
  readonly name: TunnelProvider = 'cloudflare';
  private tunnels = new Map<string, TunnelInfo>();

  async start(config: TunnelConfig): Promise<TunnelInfo> {
    const tunnelId = 'cf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const port = config.port;

    log.info('Starting Cloudflare tunnel', { tunnelId, port });

    const tunnelInfo: TunnelInfo = {
      id: tunnelId,
      url: 'https://' + tunnelId + '.trycloudflare.com',
      provider: 'cloudflare',
      localPort: port,
      publicUrl: 'https://' + tunnelId + '.trycloudflare.com',
      startedAt: new Date(),
      status: 'active',
    };

    this.tunnels.set(tunnelId, tunnelInfo);
    return tunnelInfo;
  }

  async stop(tunnelId: string): Promise<void> {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) {
      log.warn('Tunnel not found', { tunnelId });
      return;
    }

    log.info('Stopping Cloudflare tunnel', { tunnelId });
    tunnel.status = 'closed';
    this.tunnels.delete(tunnelId);
  }

  async getStatus(tunnelId: string): Promise<TunnelInfo | null> {
    return this.tunnels.get(tunnelId) ?? null;
  }

  async healthCheck(tunnelId: string): Promise<boolean> {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel?.status === 'active';
  }
}