/**
 * Transport Layer Types
 */

export type TunnelProvider = 'ngrok' | 'cloudflare' | 'localtunnel';

export interface TunnelConfig {
  provider: TunnelProvider;
  port: number;
  subdomain?: string;
  region?: string;
  authToken?: string;
  apiKey?: string;
  accountId?: string;
  timeout?: number;
  retries?: number;
}

export interface TunnelInfo {
  id: string;
  url: string;
  provider: TunnelProvider;
  localPort: number;
  publicUrl: string;
  metricsUrl?: string;
  startedAt: Date;
  expiresAt?: Date;
  status: 'starting' | 'active' | 'error' | 'closed';
  error?: string;
}

export interface TunnelProviderInterface {
  readonly name: TunnelProvider;
  start(config: TunnelConfig): Promise<TunnelInfo>;
  stop(tunnelId: string): Promise<void>;
  getStatus(tunnelId: string): Promise<TunnelInfo | null>;
  healthCheck(tunnelId: string): Promise<boolean>;
}

export interface WebhookEndpoint {
  path: string;
  channelId: string;
  platform: string;
  secret: string;
  tunnelId?: string;
  url?: string;
}

export interface TunnelStats {
  totalRequests: number;
  bytesTransferred: number;
  averageLatency: number;
  errorRate: number;
  uptimeSeconds: number;
}
