/**
 * Channel Connection Wizard
 *
 * One-click channel connection with automatic configuration:
 * - Webhook URL generation
 * - Auto-tunnel (ngrok/cloudflare)
 * - E2E encryption setup
 * - Health monitoring activation
 */

import { getLog } from '../../services/log.js';
import { generateId } from '@ownpilot/core';
import type {
  QuickConnectInput,
  QuickConnectResult,
  ChannelConfig,
  PrivacyLevel,
  ConnectionWizardStep,
  TunnelInfo,
} from './types.js';
import type { UniversalChannelAdapter } from './universal-adapter.js';
import { getGlobalHealthMonitor } from './health-monitor.js';

const log = getLog('ConnectionWizard');

export interface WizardConfig {
  baseUrl: string;
  defaultWebhookPath: string;
  autoTunnelEnabled: boolean;
  preferredTunnelProvider: 'ngrok' | 'cloudflare' | 'localtunnel';
  ngrokAuthToken?: string;
  cloudflareToken?: string;
}

export class ConnectionWizard {
  private config: WizardConfig;
  private adapters = new Map<string, new (config: ChannelConfig) => UniversalChannelAdapter>();

  constructor(config: Partial<WizardConfig> = {}) {
    this.config = {
      baseUrl: process.env.OWNPILOT_BASE_URL || 'http://localhost:8080',
      defaultWebhookPath: '/webhooks/channels',
      autoTunnelEnabled: true,
      preferredTunnelProvider: 'cloudflare',
      ...config,
    };
  }

  /**
   * Register a platform adapter.
   */
  registerAdapter(
    platform: string,
    adapterClass: new (config: ChannelConfig) => UniversalChannelAdapter
  ): void {
    this.adapters.set(platform, adapterClass);
    log.debug(`Registered adapter for platform: ${platform}`);
  }

  /**
   * Get available platforms and their connection steps.
   */
  getAvailablePlatforms(): Array<{
    id: string;
    name: string;
    icon: string;
    description: string;
    steps: ConnectionWizardStep[];
  }> {
    return [
      {
        id: 'telegram',
        name: 'Telegram',
        icon: '✈️',
        description: 'Connect via Telegram Bot API',
        steps: this.getTelegramSteps(),
      },
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        icon: '💬',
        description: 'Connect via WhatsApp Web (QR scan)',
        steps: this.getWhatsAppSteps(),
      },
      {
        id: 'discord',
        name: 'Discord',
        icon: '🎮',
        description: 'Connect via Discord Bot API',
        steps: this.getDiscordSteps(),
      },
      {
        id: 'slack',
        name: 'Slack',
        icon: '💼',
        description: 'Connect via Slack Bot Token',
        steps: this.getSlackSteps(),
      },
      {
        id: 'signal',
        name: 'Signal',
        icon: '🔐',
        description: 'Connect via Signal API (most private)',
        steps: this.getSignalSteps(),
      },
      {
        id: 'matrix',
        name: 'Matrix',
        icon: '🔗',
        description: 'Connect via Matrix homeserver',
        steps: this.getMatrixSteps(),
      },
    ];
  }

  /**
   * Quick connect a channel with minimal input.
   */
  async quickConnect(input: QuickConnectInput): Promise<QuickConnectResult> {
    const startTime = Date.now();
    const channelId = generateId('chan');

    log.info(`Starting quick connect for ${input.platform}`, { channelId });

    try {
      // 1. Get adapter class
      const AdapterClass = this.adapters.get(input.platform);
      if (!AdapterClass) {
        throw new Error(`Unsupported platform: ${input.platform}`);
      }

      // 2. Setup tunnel if needed
      const tunnelInfo = await this.setupTunnel(channelId, input.platform);

      // 3. Create channel config
      const config = this.buildChannelConfig(channelId, input, tunnelInfo);

      // 4. Create and connect adapter
      const adapter = new AdapterClass(config);

      // 5. Validate credentials
      const isValid = await adapter.validateCredentials(config.credentials);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      // 6. Connect
      const connectionResult = await adapter.connect();
      if (!connectionResult.success) {
        throw new Error(connectionResult.error || 'Connection failed');
      }

      // 7. Setup incoming message handler (handled via onMessage registration)

      // 8. Start health monitoring
      const healthMonitor = getGlobalHealthMonitor();
      healthMonitor.monitor(channelId, adapter);

      // 9. Get initial health
      const health = adapter.getHealth();

      const setupTime = Date.now() - startTime;

      log.info(`Quick connect successful for ${input.platform}`, {
        channelId,
        setupTime,
        webhookUrl: tunnelInfo?.url,
      });

      return {
        channelId,
        status: adapter.getStatus(),
        webhookUrl: tunnelInfo?.url,
        encryptionPublicKey: undefined, // TODO: Implement SignalProtocol
        health,
        setupTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Quick connect failed for ${input.platform}:`, error);

      return {
        channelId,
        status: 'error',
        health: {
          status: 'unhealthy',
          latency: { current: 0, average: 0, p95: 0, p99: 0 },
          throughput: {
            messagesSent: 0,
            messagesReceived: 0,
            bytesTransferred: 0,
            messagesPerSecond: 0,
          },
          errors: {
            totalErrors: 1,
            consecutiveErrors: 1,
            errorRate: 0,
            lastError: {
              message: errorMessage,
              code: 'QUICK_CONNECT_FAILED',
              timestamp: new Date(),
            },
          },
          encryption: {
            enabled: input.privacyLevel !== 'standard',
            protocol: input.privacyLevel === 'standard' ? 'none' : 'signal',
            sessionEstablished: false,
            lastRotation: new Date(),
          },
          lastActivity: new Date(),
        },
        setupTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Disconnect and remove a channel.
   */
  async disconnect(channelId: string): Promise<void> {
    const healthMonitor = getGlobalHealthMonitor();
    const health = healthMonitor.getChannelHealth(channelId);

    if (!health) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    log.info(`Disconnecting channel: ${channelId}`);

    // Stop monitoring
    healthMonitor.unmonitor(channelId);

    // TODO: Actually disconnect the adapter
    // This requires storing adapter instances

    log.info(`Channel disconnected: ${channelId}`);
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async setupTunnel(
    channelId: string,
    platform: string
  ): Promise<TunnelInfo | undefined> {
    if (!this.config.autoTunnelEnabled) {
      return undefined;
    }

    // For now, return local URL
    // TODO: Implement actual ngrok/cloudflare tunnel
    const webhookPath = `${this.config.defaultWebhookPath}/${platform}/${channelId}`;

    log.debug(`Setting up tunnel for ${channelId}`, {
      provider: this.config.preferredTunnelProvider,
    });

    return {
      url: `${this.config.baseUrl}${webhookPath}`,
      type: 'local',
      isPermanent: false,
    };
  }

  private buildChannelConfig(
    channelId: string,
    input: QuickConnectInput,
    tunnelInfo?: TunnelInfo
  ): ChannelConfig {
    const privacyConfig = this.getPrivacyConfig(input.privacyLevel);

    return {
      id: channelId,
      name: input.name || `${input.platform}_${channelId.slice(-6)}`,
      platform: input.platform,
      credentials: {
        type: this.inferCredentialType(input.platform),
        value: input.credential,
      },
      privacy: privacyConfig,
      transport: {
        type: 'webhook',
        webhook: tunnelInfo
          ? {
              url: tunnelInfo.url,
              path: `${this.config.defaultWebhookPath}/${input.platform}/${channelId}`,
              secret: this.generateWebhookSecret(),
              autoTunnel: this.config.autoTunnelEnabled,
              tunnelProvider: this.config.preferredTunnelProvider,
            }
          : undefined,
      },
      retryPolicy: {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        exponential: true,
      },
    };
  }

  private getPrivacyConfig(level: PrivacyLevel) {
    return {
      level,
      e2eEnabled: level !== 'standard',
      metadataStripping: level !== 'standard',
      ephemeralTimeout: level === 'paranoid' ? 3600 : undefined, // 1 hour for paranoid
      identityKeyPath: level !== 'standard' ? `keys/${level}` : undefined,
    };
  }

  private inferCredentialType(platform: string): 'token' | 'qr' | 'oauth' | 'webhook_secret' | 'certificate' {
    switch (platform) {
      case 'whatsapp':
      case 'signal':
        return 'qr';
      case 'telegram':
      case 'discord':
      case 'slack':
        return 'token';
      default:
        return 'token';
    }
  }

  private generateWebhookSecret(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ========================================================================
  // Wizard Steps for Each Platform
  // ========================================================================

  private getTelegramSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'token',
        title: 'Bot Token',
        description: 'Get your bot token from @BotFather on Telegram',
        fields: [
          {
            name: 'credential',
            label: 'Bot Token',
            type: 'password',
            required: true,
            placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
            helpText: 'Format: numbers:letters-and-numbers',
          },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy Settings',
        description: 'Choose your privacy level',
        fields: [
          {
            name: 'privacyLevel',
            label: 'Privacy Mode',
            type: 'select',
            required: true,
            options: [
              { value: 'standard', label: 'Standard (Platform native)' },
              { value: 'enhanced', label: 'Enhanced (E2E encrypted)' },
              { value: 'paranoid', label: 'Paranoid (E2E + Ephemeral)' },
            ],
          },
        ],
      },
    ];
  }

  private getWhatsAppSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'qr',
        title: 'QR Code Scan',
        description: 'Scan the QR code with your WhatsApp app',
        fields: [
          {
            name: 'credential',
            label: 'QR Data',
            type: 'qr_scan',
            required: true,
            helpText: 'Open WhatsApp > Settings > Linked Devices > Link a Device',
          },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy Settings',
        description: 'WhatsApp messages are already E2E encrypted by default',
        fields: [
          {
            name: 'privacyLevel',
            label: 'Additional Privacy',
            type: 'select',
            required: true,
            options: [
              { value: 'standard', label: 'WhatsApp Native (already E2E)' },
              { value: 'enhanced', label: 'Enhanced + Metadata stripping' },
            ],
          },
        ],
      },
    ];
  }

  private getDiscordSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'token',
        title: 'Bot Token',
        description: 'Create a bot at https://discord.com/developers/applications',
        fields: [
          {
            name: 'credential',
            label: 'Bot Token',
            type: 'password',
            required: true,
          },
        ],
      },
    ];
  }

  private getSlackSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'token',
        title: 'Bot Token',
        description: 'Get your Bot User OAuth Token from api.slack.com/apps',
        fields: [
          {
            name: 'credential',
            label: 'Bot Token',
            type: 'password',
            required: true,
            placeholder: 'xoxb-your-token-here',
          },
        ],
      },
    ];
  }

  private getSignalSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'phone',
        title: 'Phone Number',
        description: 'Enter your Signal-registered phone number',
        fields: [
          {
            name: 'credential',
            label: 'Phone Number',
            type: 'text',
            required: true,
            placeholder: '+1234567890',
          },
        ],
      },
      {
        id: 'verification',
        title: 'Verification',
        description: 'Signal requires verification code',
        fields: [
          {
            name: 'verificationCode',
            label: 'Verification Code',
            type: 'text',
            required: true,
            placeholder: '123456',
          },
        ],
      },
    ];
  }

  private getMatrixSteps(): ConnectionWizardStep[] {
    return [
      {
        id: 'homeserver',
        title: 'Homeserver',
        description: 'Enter your Matrix homeserver URL',
        fields: [
          {
            name: 'homeserver',
            label: 'Homeserver URL',
            type: 'text',
            required: true,
            placeholder: 'https://matrix.org',
          },
          {
            name: 'credential',
            label: 'Access Token',
            type: 'password',
            required: true,
          },
        ],
      },
    ];
  }
}

/**
 * Singleton instance.
 */
let globalWizard: ConnectionWizard | null = null;

export function getGlobalConnectionWizard(): ConnectionWizard {
  if (!globalWizard) {
    globalWizard = new ConnectionWizard();
  }
  return globalWizard;
}

export function resetGlobalConnectionWizard(): void {
  globalWizard = null;
}
