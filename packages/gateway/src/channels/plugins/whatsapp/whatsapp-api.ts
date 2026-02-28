/**
 * WhatsApp Channel API (Baileys)
 *
 * Implements ChannelPluginAPI using @whiskeysockets/baileys.
 * Connects via WhatsApp Web's WebSocket protocol using QR code authentication.
 * No Meta Business account needed — works with personal WhatsApp accounts.
 */

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
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
import { getErrorMessage } from '../../../routes/helpers.js';
import { MAX_MESSAGE_CHAT_MAP_SIZE } from '../../../config/defaults.js';
import { splitMessage } from '../../utils/message-utils.js';
import { getSessionDir, clearSession } from './session-store.js';
import { wsGateway } from '../../../ws/server.js';

const log = getLog('WhatsApp');
const WHATSAPP_MAX_LENGTH = 4096;

// Baileys logger — silent to avoid noisy output
const baileysLogger = pino({ level: 'silent' }) as ReturnType<typeof pino>;

// ============================================================================
// Types
// ============================================================================

interface WhatsAppBaileysConfig {
  allowed_users?: string;
}

// ============================================================================
// WhatsApp Baileys API
// ============================================================================

export class WhatsAppChannelAPI implements ChannelPluginAPI {
  private sock: WASocket | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly pluginId: string;
  private readonly config: WhatsAppBaileysConfig;
  private messageChatMap = new Map<string, string>();
  private sentMessageIds = new Set<string>();
  private allowedUsers: Set<string> = new Set();
  private qrCode: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.pluginId = pluginId;
    this.config = {
      allowed_users: config.allowed_users ? String(config.allowed_users) : undefined,
    };

    // Parse allowed users
    if (this.config.allowed_users) {
      this.config.allowed_users
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((phone) => this.allowedUsers.add(phone));
    }
  }

  // ==========================================================================
  // ChannelPluginAPI — Required
  // ==========================================================================

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;

    // Clean up any existing socket
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        /* already closed */
      }
      this.sock = null;
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      const sessionDir = getSessionDir(this.pluginId);
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: false,
        logger: baileysLogger,
        browser: ['OwnPilot', 'Chrome', '22.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      // Handle connection updates (QR code, connect, disconnect)
      this.sock.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update);
      });

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', (upsert) => {
        if (upsert.type !== 'notify') return;
        for (const msg of upsert.messages) {
          const isSelf = this.isSelfChat(msg.key.remoteJid);
          // Skip our own messages — EXCEPT self-chat (user messaging themselves)
          if (msg.key.fromMe && !isSelf) continue;
          // In self-chat, skip messages the bot sent (prevent infinite loop)
          if (isSelf && msg.key.id && this.sentMessageIds.has(msg.key.id)) continue;
          this.handleIncomingMessage(msg).catch((err) => {
            log.error('Failed to handle WhatsApp message:', err);
          });
        }
      });

      // Save credentials on update
      this.sock.ev.on('creds.update', saveCreds);

      log.info('WhatsApp socket created, waiting for authentication...');
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw new Error(`Failed to connect WhatsApp: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }

    this.qrCode = null;
    this.reconnectAttempt = 0;
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
    log.info('WhatsApp disconnected (session preserved — reconnect without QR)');
  }

  /**
   * Logout: disconnect AND clear session files.
   * Next connect() will require a fresh QR code scan.
   */
  async logout(): Promise<void> {
    this.clearReconnectTimer();

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // logout may fail if already disconnected — just end the socket
        this.sock.end(undefined);
      }
      this.sock = null;
    }

    await clearSession(this.pluginId);

    this.qrCode = null;
    this.reconnectAttempt = 0;
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
    log.info('WhatsApp logged out (session cleared — new QR scan required)');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.sock) {
      throw new Error('WhatsApp is not connected');
    }

    const jid = this.toJid(message.platformChatId);
    const parts = splitMessage(message.text, WHATSAPP_MAX_LENGTH);
    let lastMessageId = '';

    for (let i = 0; i < parts.length; i++) {
      const options: Record<string, unknown> = {};

      // Reply context for first part
      if (i === 0 && message.replyToId) {
        const externalId = message.replyToId.includes(':')
          ? message.replyToId.split(':').pop()
          : message.replyToId;
        if (externalId) {
          options.quoted = {
            key: { remoteJid: jid, id: externalId },
            message: {},
          };
        }
      }

      const result = await this.sock.sendMessage(jid, { text: parts[i]! }, options);
      lastMessageId = result?.key?.id ?? '';

      if (lastMessageId) {
        this.trackMessage(lastMessageId, message.platformChatId);
        // Track our own sent messages to avoid self-chat loops
        this.sentMessageIds.add(lastMessageId);
        if (this.sentMessageIds.size > 500) {
          const first = this.sentMessageIds.values().next().value;
          if (first !== undefined) this.sentMessageIds.delete(first);
        }
      }

      // Small delay between split messages
      if (i < parts.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return lastMessageId;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'whatsapp';
  }

  // ==========================================================================
  // ChannelPluginAPI — Optional
  // ==========================================================================

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.sock) return;
    try {
      const jid = this.toJid(platformChatId);
      await this.sock.sendPresenceUpdate('composing', jid);
    } catch {
      // Non-fatal
    }
  }

  getBotInfo(): { username?: string; firstName?: string } | null {
    if (!this.sock?.user) return null;
    const user = this.sock.user;
    // Baileys user.id format: "phone:device@s.whatsapp.net"
    const phone = user.id?.split(':')[0] ?? user.id;
    return {
      username: phone,
      firstName: user.name ?? undefined,
    };
  }

  // ==========================================================================
  // QR Code — used by channels route for QR display
  // ==========================================================================

  /** Get the current QR code string (null if not in QR state). */
  getQrCode(): string | null {
    return this.qrCode;
  }

  // ==========================================================================
  // Message Tracking
  // ==========================================================================

  trackMessage(platformMessageId: string, chatId: string): void {
    if (this.messageChatMap.size >= MAX_MESSAGE_CHAT_MAP_SIZE) {
      const first = this.messageChatMap.keys().next().value;
      if (first !== undefined) this.messageChatMap.delete(first);
    }
    this.messageChatMap.set(platformMessageId, chatId);
  }

  // ==========================================================================
  // Private — Connection Handling
  // ==========================================================================

  private handleConnectionUpdate(update: {
    connection?: string;
    lastDisconnect?: { error?: Error | undefined; date?: Date };
    qr?: string;
    isOnline?: boolean;
    isNewLogin?: boolean;
  }): void {
    const { connection, lastDisconnect, qr } = update;

    // QR code received — broadcast to UI
    if (qr) {
      this.qrCode = qr;
      this.status = 'connecting';
      log.info('WhatsApp QR code generated, waiting for scan...');

      // Broadcast QR to WebSocket clients
      try {
        wsGateway.broadcast('channel:qr', { channelId: this.pluginId, qr });
      } catch {
        // WS gateway may not be ready
      }
    }

    // Connected
    if (connection === 'open') {
      this.status = 'connected';
      this.qrCode = null;
      this.reconnectAttempt = 0;
      this.emitConnectionEvent('connected');

      const info = this.getBotInfo();
      log.info(`WhatsApp connected as ${info?.username ?? 'unknown'} (${info?.firstName ?? ''})`);

      // Broadcast status update
      try {
        wsGateway.broadcast('channel:status', {
          channelId: this.pluginId,
          status: 'connected',
          botInfo: info,
        });
      } catch {
        // WS gateway may not be ready
      }
    }

    // Disconnected
    if (connection === 'close') {
      const error = lastDisconnect?.error;
      const statusCode = (error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        // User logged out — need new QR scan
        this.status = 'disconnected';
        this.qrCode = null;
        this.emitConnectionEvent('disconnected');
        log.info('WhatsApp logged out — session cleared, new QR scan required');
      } else {
        // Temporary disconnect — auto-reconnect with backoff
        this.status = 'reconnecting';
        this.emitConnectionEvent('reconnecting');
        this.scheduleReconnect();
        log.warn(
          `WhatsApp disconnected (code: ${statusCode}), reconnecting in ${this.getReconnectDelay()}ms...`
        );
      }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = this.getReconnectDelay();
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      log.info(`WhatsApp reconnect attempt ${this.reconnectAttempt}...`);
      this.sock = null;
      this.connect().catch((err) => {
        log.error('WhatsApp reconnect failed:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });
    }, delay);
  }

  private getReconnectDelay(): number {
    // Exponential backoff: 3s, 6s, 12s, 24s, max 60s
    return Math.min(3000 * Math.pow(2, this.reconnectAttempt), 60000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==========================================================================
  // Private — Message Processing
  // ==========================================================================

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    // Extract phone number from JID
    const phone = this.phoneFromJid(remoteJid);

    // Access control
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(phone)) {
      return;
    }

    // Extract message content
    const m = msg.message;
    if (!m) return;

    let text = '';
    const attachments: ChannelAttachment[] = [];

    // Text messages
    if (m.conversation) {
      text = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      text = m.extendedTextMessage.text;
    }
    // Image messages
    else if (m.imageMessage) {
      text = m.imageMessage.caption ?? '';
      attachments.push({
        type: 'image',
        mimeType: m.imageMessage.mimetype ?? 'image/jpeg',
      });
    }
    // Document messages
    else if (m.documentMessage) {
      text = m.documentMessage.caption ?? '';
      attachments.push({
        type: 'file',
        mimeType: m.documentMessage.mimetype ?? 'application/octet-stream',
        filename: m.documentMessage.fileName ?? undefined,
      });
    }
    // Audio messages
    else if (m.audioMessage) {
      attachments.push({
        type: 'audio',
        mimeType: m.audioMessage.mimetype ?? 'audio/ogg',
      });
    }
    // Video messages
    else if (m.videoMessage) {
      text = m.videoMessage.caption ?? '';
      attachments.push({
        type: 'video',
        mimeType: m.videoMessage.mimetype ?? 'video/mp4',
      });
    }

    // Skip empty messages
    if (!text && attachments.length === 0) return;

    const messageId = msg.key.id ?? '';
    const isGroup = remoteJid.endsWith('@g.us');

    const sender: ChannelUser = {
      platformUserId: phone,
      platform: 'whatsapp',
      displayName: msg.pushName || phone,
      username: phone,
    };

    const rawTs = msg.messageTimestamp;
    const timestamp =
      typeof rawTs === 'number'
        ? new Date(rawTs * 1000)
        : typeof rawTs === 'object' && rawTs !== null && 'toNumber' in rawTs
          ? new Date((rawTs as { toNumber(): number }).toNumber() * 1000)
          : new Date();

    const channelMessage: ChannelIncomingMessage = {
      id: `${this.pluginId}:${messageId}`,
      channelPluginId: this.pluginId,
      platform: 'whatsapp',
      platformChatId: phone,
      sender,
      text: text || (attachments.length > 0 ? '[Attachment]' : ''),
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp,
      metadata: {
        platformMessageId: messageId,
        jid: remoteJid,
        isGroup,
        pushName: msg.pushName || undefined,
      },
    };

    this.trackMessage(messageId, phone);

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel',
          this.pluginId,
          { message: channelMessage }
        )
      );
    } catch (err) {
      log.error('Failed to emit WhatsApp message event:', err);
    }
  }

  // ==========================================================================
  // Private — Helpers
  // ==========================================================================

  /** Convert a phone number or chat ID to a WhatsApp JID. */
  private toJid(chatId: string): string {
    if (chatId.includes('@')) return chatId;
    // Strip any non-digit characters for phone numbers
    const cleaned = chatId.replace(/[^0-9]/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  /** Extract phone number from a WhatsApp JID. */
  private phoneFromJid(jid: string): string {
    return jid.split('@')[0]?.split(':')[0] ?? jid;
  }

  /** Check if a message is sent to the user's own chat (self-chat). */
  private isSelfChat(remoteJid: string | null | undefined): boolean {
    if (!remoteJid || !this.sock?.user?.id) return false;
    const ownPhone = this.sock.user.id.split(':')[0];
    const chatPhone = this.phoneFromJid(remoteJid);
    return ownPhone === chatPhone;
  }

  private emitConnectionEvent(status: ChannelConnectionStatus): void {
    try {
      const eventBus = getEventBus();
      const eventName =
        status === 'connecting'
          ? ChannelEvents.CONNECTING
          : status === 'connected'
            ? ChannelEvents.CONNECTED
            : status === 'reconnecting'
              ? ChannelEvents.RECONNECTING
              : status === 'error'
                ? ChannelEvents.ERROR
                : ChannelEvents.DISCONNECTED;

      eventBus.emit(
        createEvent<ChannelConnectionEventData>(eventName, 'channel', this.pluginId, {
          channelPluginId: this.pluginId,
          platform: 'whatsapp',
          status,
        })
      );
    } catch {
      // EventBus may not be ready during early boot
    }
  }
}
