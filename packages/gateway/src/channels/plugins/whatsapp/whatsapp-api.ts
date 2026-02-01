/**
 * WhatsApp Channel API (Baileys)
 *
 * Self-hosted WhatsApp Web bridge using @whiskeysockets/baileys.
 * Handles QR code auth, multi-device, session persistence, and message normalization.
 */

import {
  type ChannelPluginAPI,
  type ChannelConnectionStatus,
  type ChannelPlatform,
  type ChannelOutgoingMessage,
  type ChannelUser,
  type ChannelIncomingMessage,
  type ChannelAttachment,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  getEventBus,
  createEvent,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';

const log = getLog('WhatsApp');

// ============================================================================
// Types
// ============================================================================

export interface WhatsAppChannelConfig {
  session_id?: string;
  allowed_numbers?: string;
  auto_read?: boolean;
}

// ============================================================================
// Implementation
// ============================================================================

export class WhatsAppChannelAPI implements ChannelPluginAPI {
  private socket: any = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: WhatsAppChannelConfig;
  private readonly pluginId: string;
  private allowedNumbers: Set<string> = new Set();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as WhatsAppChannelConfig;
    this.pluginId = pluginId;

    if (this.config.allowed_numbers) {
      this.config.allowed_numbers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => this.allowedNumbers.add(n));
    }
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      // Dynamic import to avoid hard dependency at module load
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
      } = await import('@whiskeysockets/baileys');

      const sessionId = this.config.session_id ?? 'ownpilot-whatsapp';
      const { state, saveCreds } = await useMultiFileAuthState(
        `./data/whatsapp-sessions/${sessionId}`
      );

      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['OwnPilot', 'Desktop', '1.0.0'],
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Connection updates
      this.socket.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info('[WhatsApp] QR Code generated - scan with WhatsApp mobile app');
          // QR code is printed to terminal by baileys
        }

        if (connection === 'open') {
          this.status = 'connected';
          log.info('[WhatsApp] Connected');
          this.emitConnectionEvent('connected');
        }

        if (connection === 'close') {
          const statusCode =
            (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            this.status = 'reconnecting';
            log.info('[WhatsApp] Reconnecting...');
            this.emitConnectionEvent('reconnecting');
            // Baileys auto-reconnects
          } else {
            this.status = 'disconnected';
            log.info('[WhatsApp] Logged out');
            this.emitConnectionEvent('disconnected');
          }
        }
      });

      // Message handler
      this.socket.ev.on('messages.upsert', (m: any) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          this.handleIncomingMessage(msg).catch((err) => {
            log.error('[WhatsApp] Error handling message:', err);
          });
        }
      });
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.socket) {
      throw new Error('WhatsApp is not connected');
    }

    const jid = message.platformChatId.includes('@')
      ? message.platformChatId
      : `${message.platformChatId}@s.whatsapp.net`;

    const sent = await this.socket.sendMessage(jid, { text: message.text });
    return sent?.key?.id ?? '';
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'whatsapp';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.socket) return;
    const jid = platformChatId.includes('@')
      ? platformChatId
      : `${platformChatId}@s.whatsapp.net`;
    await this.socket.sendPresenceUpdate('composing', jid).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(msg: any): Promise<void> {
    const remoteJid = msg.key.remoteJid ?? '';
    const senderId = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');

    // Access control
    if (this.allowedNumbers.size > 0 && !this.allowedNumbers.has(senderId)) {
      return;
    }

    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      msg.message?.imageMessage?.caption ??
      '';

    if (!text) return;

    const pushName = msg.pushName ?? senderId;

    const sender: ChannelUser = {
      platformUserId: senderId,
      platform: 'whatsapp',
      displayName: pushName,
    };

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${msg.key.id}`,
      channelPluginId: this.pluginId,
      platform: 'whatsapp',
      platformChatId: remoteJid,
      sender,
      text,
      timestamp: new Date((msg.messageTimestamp ?? Date.now() / 1000) * 1000),
      metadata: {
        platformMessageId: msg.key.id,
        isGroup: remoteJid.endsWith('@g.us'),
      },
    };

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel' as any,
          this.pluginId,
          { message: normalized }
        )
      );
    } catch (err) {
      log.error('[WhatsApp] Failed to emit message event:', err);
    }
  }

  private emitConnectionEvent(status: ChannelConnectionStatus): void {
    try {
      const eventBus = getEventBus();
      const eventName =
        status === 'connected'
          ? ChannelEvents.CONNECTED
          : status === 'connecting'
            ? ChannelEvents.CONNECTING
            : status === 'reconnecting'
              ? ChannelEvents.RECONNECTING
              : status === 'error'
                ? ChannelEvents.ERROR
                : ChannelEvents.DISCONNECTED;

      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          eventName,
          'channel' as any,
          this.pluginId,
          {
            channelPluginId: this.pluginId,
            platform: 'whatsapp',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
