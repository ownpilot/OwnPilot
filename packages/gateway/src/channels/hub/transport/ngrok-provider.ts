/**
 * ngrok Tunnel Provider
 */

import type { ChildProcess } from 'node:child_process';
import { getLog } from '../../../services/log.js';
import type { TunnelProviderInterface, TunnelConfig, TunnelInfo, TunnelProvider } from './types.js';

const log = getLog('Tunnel:ngrok');

export class NgrokProvider implements TunnelProviderInterface {
  readonly name: TunnelProvider = 'ngrok';
  private tunnels = new Map<string, { process: ChildProcess; info: TunnelInfo }>();

  async start(config: TunnelConfig): Promise<TunnelInfo> {
    const tunnelId = 'ngrok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const port = config.port;
    // Auth token available for future implementation
    void config.authToken;

    log.info('Starting ngrok tunnel', { tunnelId, port });

    // For now, return mock tunnel info
    // Full implementation would spawn ngrok process
    const tunnelInfo: TunnelInfo = {
      id: tunnelId,
      url: 'https://' + tunnelId + '.ngrok.io',
      provider: 'ngrok',
      localPort: port,
      publicUrl: 'https://' + tunnelId + '.ngrok.io',
      startedAt: new Date(),
      status: 'active',
    };

    this.tunnels.set(tunnelId, { process: null as unknown as ChildProcess, info: tunnelInfo });
    return tunnelInfo;
  }

  async stop(tunnelId: string): Promise<void> {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) {
      log.warn('Tunnel not found', { tunnelId });
      return;
    }

    log.info('Stopping ngrok tunnel', { tunnelId });
    tunnel.info.status = 'closed';
    this.tunnels.delete(tunnelId);
  }

  async getStatus(tunnelId: string): Promise<TunnelInfo | null> {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel?.info ?? null;
  }

  async healthCheck(tunnelId: string): Promise<boolean> {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel?.info.status === 'active';
  }
}
