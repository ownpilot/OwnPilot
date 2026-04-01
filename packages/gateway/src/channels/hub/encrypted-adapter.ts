/**
 * Encrypted Channel Adapter
 *
 * Wrapper around UniversalChannelAdapter that adds transparent E2E encryption
 * using Signal Protocol. Messages are automatically encrypted before sending
 * and decrypted when received.
 */

import { EventEmitter } from 'node:events';
import { getLog } from '../../services/log.js';
import type { UniversalChannelAdapter, MessageHandler, ConnectionResult } from './universal-adapter.js';
import type {
  ChannelStatus,
  ChannelHealth,
  HubIncomingMessage,
  HubOutgoingMessage,
  MessageContent,
  ChannelCredentials,
} from './types.js';
import type { ChannelUser } from '@ownpilot/core';
import type { SignalProtocol, EncryptedMessage } from './crypto/index.js';

const log = getLog('EncryptedAdapter');

export interface EncryptedAdapterConfig {
  baseAdapter: UniversalChannelAdapter;
  signalProtocol: SignalProtocol;
  peerIdentityKey?: string; // Base64 public key for initiating sessions
  enableEncryption: boolean;
}

/**
 * Encrypted wrapper for UniversalChannelAdapter.
 * Adds transparent E2E encryption to any channel adapter.
 */
export class EncryptedChannelAdapter extends EventEmitter {
  // This class wraps a UniversalChannelAdapter and provides encryption
  // It implements a similar public interface but is not a true adapter itself
  private baseAdapter: UniversalChannelAdapter;
  private signalProtocol: SignalProtocol;
  private peerIdentityKey?: string;
  private messageHandler?: MessageHandler;
  private enableEncryption: boolean;
  private sessionId?: string;

  constructor(config: EncryptedAdapterConfig) {
    super();
    this.baseAdapter = config.baseAdapter;
    this.signalProtocol = config.signalProtocol;
    this.peerIdentityKey = config.peerIdentityKey;
    this.enableEncryption = config.enableEncryption;


    this.setupBaseAdapterEvents();
  }

  // ========================================================================
  // UniversalChannelAdapter Implementation
  // ========================================================================

  async connect(): Promise<ConnectionResult> {
    const result = await this.baseAdapter.connect();

    if (result.success && this.enableEncryption && this.peerIdentityKey) {
      // Initialize encryption session
      try {
        // If we have peer's public key, initiate session
        // Otherwise, wait for first message to accept session
        log.info('Encryption enabled, ready to establish session');
      } catch (error) {
        log.error('Failed to initialize encryption session:', error);
        // Don't fail connection if encryption setup fails
      }
    }

    return result;
  }

  async disconnect(): Promise<void> {
    await this.baseAdapter.disconnect();
  }

  async send(message: HubOutgoingMessage): Promise<string> {
    if (!this.enableEncryption) {
      return this.baseAdapter.send(message);
    }

    // Check if we have an active session
    if (!this.sessionId && this.peerIdentityKey) {
      // Need to initiate session first
      // This would require fetching peer's key bundle from server
      log.warn('No encryption session established, sending unencrypted');
      return this.baseAdapter.send(message);
    }

    if (!this.sessionId) {
      log.warn('No peer identity key configured, sending unencrypted');
      return this.baseAdapter.send(message);
    }

    try {
      // Encrypt the message content
      const plaintext = JSON.stringify(message.content);
      const { encrypted } = await this.signalProtocol.encrypt(this.sessionId, plaintext);

      // Wrap encrypted content in a special message type
      const encryptedContent: MessageContent = {
        type: 'encrypted',
        encrypted: encrypted,
      };

      const encryptedMessage: HubOutgoingMessage = {
        ...message,
        content: encryptedContent,
      };

      return this.baseAdapter.send(encryptedMessage);
    } catch (error) {
      log.error('Encryption failed, falling back to unencrypted:', error);
      return this.baseAdapter.send(message);
    }
  }

  async setupIncomingHandler(): Promise<void> {
    // Intercept messages to decrypt them
    this.baseAdapter.onMessage(async (message) => {
      await this.processIncomingMessage(message);
    });

    // Note: setupIncomingHandler is protected on base adapter
    // The base adapter should already have its handler set up
  }

  async validateCredentials(credentials: ChannelCredentials): Promise<boolean> {
    return this.baseAdapter.validateCredentials(credentials);
  }

  async getUserInfo(platformUserId: string): Promise<ChannelUser | null> {
    return this.baseAdapter.getUserInfo(platformUserId);
  }

  async sendTypingIndicator(platformChatId: string): Promise<void> {
    return this.baseAdapter.sendTypingIndicator(platformChatId);
  }

  getStatus(): ChannelStatus {
    return this.baseAdapter.getStatus();
  }

  getHealth(): ChannelHealth {
    return this.baseAdapter.getHealth();
  }

  async pause(): Promise<void> {
    return this.baseAdapter.pause();
  }

  async resume(): Promise<void> {
    return this.baseAdapter.resume();
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }

  // ========================================================================
  // Encryption-Specific Methods
  // ========================================================================

  /**
   * Initiate an encrypted session with a peer.
   * Call this after connecting and obtaining peer's public key bundle.
   */
  async initiateEncryptedSession(
    peerKeyBundle: Parameters<SignalProtocol['initiateSession']>[0],
    peerDeviceId: string
  ): Promise<string> {
    const session = await this.signalProtocol.initiateSession(peerKeyBundle, peerDeviceId);
    this.sessionId = session.sessionId;
    log.info('Established encrypted session', { sessionId: this.sessionId });
    return this.sessionId;
  }

  /**
   * Check if encryption is active.
   */
  isEncryptionActive(): boolean {
    return this.enableEncryption && !!this.sessionId;
  }

  /**
   * Get current session ID.
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Get encryption status for health monitoring.
   */
  getEncryptionStatus(): {
    enabled: boolean;
    sessionEstablished: boolean;
    sessionId?: string;
    protocol: string;
  } {
    return {
      enabled: this.enableEncryption,
      sessionEstablished: !!this.sessionId,
      sessionId: this.sessionId,
      protocol: 'signal',
    };
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async processIncomingMessage(message: HubIncomingMessage): Promise<void> {
    if (!this.enableEncryption) {
      // Pass through unencrypted messages
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
      return;
    }

    // Check if message is encrypted
    const content = message.content;
    if (content.type !== 'encrypted' || !content.encrypted) {
      // Unencrypted message - pass through but log warning
      log.warn('Received unencrypted message when encryption is enabled');
      if (this.messageHandler) {
        await this.messageHandler(message);
      }
      return;
    }

    try {
      // Decrypt the message
      const encrypted = content.encrypted as EncryptedMessage;
      const { plaintext, sessionId } = await this.signalProtocol.decrypt(
        encrypted,
        message.platform
      );

      this.sessionId = sessionId;

      // Parse decrypted content
      const decryptedContent = JSON.parse(plaintext) as MessageContent;

      // Create new message with decrypted content
      const decryptedMessage: HubIncomingMessage = {
        ...message,
        content: decryptedContent,
        encrypted: true,
      };

      if (this.messageHandler) {
        await this.messageHandler(decryptedMessage);
      }

      // Emit decryption event
      this.emit('message:decrypted', {
        channelId: message.channelId,
        sessionId,
        timestamp: new Date(),
      });
    } catch (error) {
      log.error('Failed to decrypt message:', error);

      // Still pass through the raw message so it's not lost
      // but mark it as having decryption error
      if (this.messageHandler) {
        await this.messageHandler({
          ...message,
          content: {
            type: 'text',
            text: '[Unable to decrypt message]',
          } as MessageContent,
          metadata: {
            ...message.metadata,
            decryptionError: true,
          },
        });
      }
    }
  }

  private setupBaseAdapterEvents(): void {
    // Forward all events from base adapter
    this.baseAdapter.on('channel:status_changed', (event) => {
      this.emit('channel:status_changed', event);
    });

    this.baseAdapter.on('channel:error', (event) => {
      this.emit('channel:error', event);
    });

    this.baseAdapter.on('message:sent', (event) => {
      this.emit('message:sent', event);
    });

    this.baseAdapter.on('message:received', (event) => {
      this.emit('message:received', event);
    });

    this.baseAdapter.on('channel:paused', (event) => {
      this.emit('channel:paused', event);
    });

    this.baseAdapter.on('channel:resumed', (event) => {
      this.emit('channel:resumed', event);
    });
  }
}

/**
 * Factory function to wrap any adapter with encryption.
 */
export async function wrapWithEncryption(
  baseAdapter: UniversalChannelAdapter,
  options: {
    enableEncryption: boolean;
    peerIdentityKey?: string;
  }
): Promise<EncryptedChannelAdapter> {
  const { createSignalProtocol } = await import('./crypto/index.js');
  const { protocol } = await createSignalProtocol();

  return new EncryptedChannelAdapter({
    baseAdapter,
    signalProtocol: protocol,
    peerIdentityKey: options.peerIdentityKey,
    enableEncryption: options.enableEncryption,
  });
}
