/**
 * Localtunnel Provider (Fallback)
 */

import { getLog } from '../../../services/log.js';
import type { TunnelProviderInterface, TunnelConfig, TunnelInfo, TunnelProvider } from './types.js';

const log = getLog('Tunnel:Localtunnel');

export class LocaltunnelProvider implements TunnelProviderInterface {
  readonly name: TunnelProvider = 'localtunnel';
  private tunnels = new Map<string, TunnelInfo>();

  async start(config: TunnelConfig): Promise<TunnelInfo> {
    const tunnelId = 'lt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const port = config.port;

    log.info('Starting localtunnel', { tunnelId, port });

    const tunnelInfo: TunnelInfo = {
      id: tunnelId,
      url: 'https://' + tunnelId + '.loca.lt',
      provider: 'localtunnel',
      localPort: port,
      publicUrl: 'https://' + tunnelId + '.loca.lt',
      startedAt: new Date(),
      status: 'active',
    };

    this.tunnels.set(tunnelId, tunnelInfo);
    return tunnelInfo;
  }

  async stop(tunnelId: string): Promise<void> {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return;

    log.info('Stopping localtunnel', { tunnelId });
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