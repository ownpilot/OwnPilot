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
  downloadMediaMessage,
  Browsers,
  type WASocket,
  type WAMessage,
  type proto,
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

/** Simple TTL cache (replaces node-cache dependency). */
class SimpleTTLCache<V> {
  private data = new Map<string, { value: V; expires: number }>();
  constructor(private readonly ttlMs: number) {}
  set(key: string, value: V): void {
    this.data.set(key, { value, expires: Date.now() + this.ttlMs });
  }
  get(key: string): V | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) { this.data.delete(key); return undefined; }
    return entry.value;
  }
  del(key: string): void { this.data.delete(key); }
  flushAll(): void { this.data.clear(); }
}

// Anti-ban constants
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_CONSECUTIVE_440 = 3;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_MESSAGES = 20; // max 20 messages per minute (global)
const RATE_LIMIT_PER_JID_MS = 3_000; // min 3s gap per recipient
const MESSAGE_CACHE_SIZE = 500; // getMessage cache for retry/decryption

// Baileys logger — silent in production to prevent leaking JIDs/message content
const baileysLogger = pino({
  level: process.env.NODE_ENV === 'production' ? 'silent' : 'warn',
}) as ReturnType<typeof pino>;

// ============================================================================
// Types
// ============================================================================

interface WhatsAppBaileysConfig {
  allowed_users?: string;
}

// ============================================================================
// Group/Chat Listing Types
// ============================================================================

export interface WhatsAppGroupSummary {
  id: string;
  subject: string;
  description: string | null;
  participantCount: number;
  createdAt: number | null;
  owner: string | null;
  isAnnounceGroup: boolean;
  isLocked: boolean;
  isCommunity: boolean;
  isCommunityAnnounce: boolean;
  linkedParent: string | null;
}

export interface WhatsAppGroupDetail extends WhatsAppGroupSummary {
  participants: Array<{
    jid: string;
    phone: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
  }>;
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
  private isReconnecting = false;
  private consecutive440Count = 0;

  // Anti-ban: message cache for getMessage callback (retry/decryption)
  private messageCache = new Map<string, proto.IMessage>();

  // Anti-ban: rate limiting
  private globalSendTimes: number[] = [];
  private perJidLastSend = new Map<string, number>();

  // Anti-ban: message deduplication (prevent double AI responses on reconnect)
  private processedMsgIds = new Set<string>();

  // Anti-ban: retry counter cache (prevents infinite retry loops — Evolution + WAHA pattern)
  private msgRetryCounterCache = new SimpleTTLCache<number>(300_000); // 5 min TTL
  // Anti-ban: device info cache (reduces protocol overhead — WAHA pattern)
  private userDevicesCache = new SimpleTTLCache<string[]>(300_000); // 5 min TTL

  // Group listing cache (5 min TTL — prevents excessive groupFetchAllParticipating calls)
  private groupsCache: WhatsAppGroupSummary[] | null = null;
  private groupsRawParticipants: Map<string, Array<{ id: string; admin?: string | null }>> | null = null;
  private groupsCacheTime = 0;
  private groupsFetchInFlight: Promise<WhatsAppGroupSummary[]> | null = null;
  private static readonly GROUPS_CACHE_TTL = 5 * 60_000;

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

    // Prevent concurrent reconnection attempts
    if (this.isReconnecting) return;
    this.isReconnecting = true;

    // Clean up any existing socket — remove listeners first, then end
    this.cleanupSocket();

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
        // Anti-ban: realistic browser fingerprint (matches actual OS)
        browser: Browsers.appropriate('Chrome'),
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        // Anti-ban: don't appear online 24/7 (bot signal)
        markOnlineOnConnect: false,
        connectTimeoutMs: 30_000,
        keepAliveIntervalMs: 30_000,
        retryRequestDelayMs: 350,
        maxMsgRetryCount: 4,
        // Anti-ban: retry counter prevents infinite retry loops (Evolution + WAHA pattern)
        msgRetryCounterCache: this.msgRetryCounterCache as never,
        // Anti-ban: cache device info to reduce protocol overhead
        userDevicesCache: this.userDevicesCache as never,
        // Anti-ban: Signal key store transaction retry (Evolution API pattern)
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
        // getMessage is REQUIRED in Baileys 7.x for message retry/decryption.
        // Without it, messages.upsert may never fire.
        // Returns cached message or undefined (NEVER empty string — would signal "found but empty").
        getMessage: async (key) => {
          const cached = this.messageCache.get(key.id ?? '');
          if (cached) {
            log.info(`[getMessage] Cache HIT for ${key.id}`);
            return cached;
          }
          log.info(`[getMessage] Cache MISS for ${key.id}`);
          return undefined;
        },
      });

      // Handle connection updates (QR code, connect, disconnect)
      this.sock.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update);
      });

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', (upsert) => {
        log.info(`[WhatsApp] UPSERT EVENT received — type: ${upsert.type}, count: ${upsert.messages.length}`);

        // Cache ALL messages for getMessage retry/decryption (both append and notify)
        for (const msg of upsert.messages) {
          if (msg.key.id && msg.message) {
            this.cacheMessage(msg.key.id, msg.message);
          }
        }

        if (upsert.type !== 'notify') return;
        for (const msg of upsert.messages) {
          log.info(`[WhatsApp] Processing message — jid: ${msg.key.remoteJid}, fromMe: ${msg.key.fromMe}, id: ${msg.key.id}`);

          // Anti-ban: deduplication — skip already-processed messages (reconnect replays)
          const msgId = msg.key.id;
          if (msgId && this.processedMsgIds.has(msgId)) {
            log.info(`[WhatsApp] Skipping duplicate message ${msgId}`);
            continue;
          }

          const isSelf = this.isSelfChat(msg.key.remoteJid);
          // Skip our own messages — EXCEPT self-chat (user messaging themselves)
          if (msg.key.fromMe && !isSelf) continue;
          // In self-chat, skip messages the bot sent (prevent infinite loop)
          if (isSelf && msg.key.id && this.sentMessageIds.has(msg.key.id)) continue;

          // Track as processed BEFORE handling (idempotency)
          if (msgId) {
            this.processedMsgIds.add(msgId);
            // Cap the set to prevent memory leak
            if (this.processedMsgIds.size > 1000) {
              const first = this.processedMsgIds.values().next().value;
              if (first !== undefined) this.processedMsgIds.delete(first);
            }
          }

          this.handleIncomingMessage(msg).catch((err) => {
            log.error('Failed to handle WhatsApp message:', err);
          });
        }
      });

      // Save credentials on update
      this.sock.ev.on('creds.update', saveCreds);

      this.isReconnecting = false;
      log.info('WhatsApp socket created, waiting for authentication...');
    } catch (error) {
      this.isReconnecting = false;
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw new Error(`Failed to connect WhatsApp: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.cleanupSocket();

    this.qrCode = null;
    this.reconnectAttempt = 0;
    this.isReconnecting = false;
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
        // logout may fail if already disconnected
      }
    }
    this.cleanupSocket();

    await clearSession(this.pluginId);

    this.qrCode = null;
    this.reconnectAttempt = 0;
    this.isReconnecting = false;
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
      // Anti-ban: rate limiting before each part
      await this.enforceRateLimit(jid);

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

      // Anti-ban: typing indicator before sending (human-like behavior)
      await this.simulateTyping(jid, parts[i]!);

      const result = await this.sock.sendMessage(jid, { text: parts[i]! }, options);
      lastMessageId = result?.key?.id ?? '';

      // Record send time for rate limiting
      this.recordSend(jid);

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

    // Anti-ban: go offline after sending (don't stay 'available' like a bot)
    try {
      await this.sock.sendPresenceUpdate('unavailable');
    } catch {
      // Non-fatal
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
  // Group/Chat Listing — Extended API (duck-type guard accessed)
  // ==========================================================================

  /**
   * List all WhatsApp groups the account participates in.
   * Uses groupFetchAllParticipating() — ONE safe Baileys call.
   * Results cached for 5 minutes to prevent excessive WhatsApp API calls.
   * Profile pictures deliberately omitted (Evolution API bottleneck: 69 sequential calls).
   */
  async listGroups(includeParticipants = false): Promise<WhatsAppGroupSummary[] | WhatsAppGroupDetail[]> {
    const sock = this.sock;
    if (!sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    // Return cache if valid and participants not requested
    const cacheAge = Date.now() - this.groupsCacheTime;
    if (!includeParticipants && this.groupsCache && cacheAge < WhatsAppChannelAPI.GROUPS_CACHE_TTL) {
      return this.groupsCache;
    }

    // Deduplicate concurrent requests — reuse in-flight promise (anti-ban: prevents double API call)
    if (!this.groupsFetchInFlight) {
      this.groupsFetchInFlight = (async () => {
        try {
          const raw = await sock.groupFetchAllParticipating();
          const groups = Object.values(raw);

          const summaries: WhatsAppGroupSummary[] = groups.map((g) => ({
            id: g.id,
            subject: g.subject ?? '',
            description: g.desc ?? null,
            participantCount: g.participants?.length ?? 0,
            createdAt: g.creation ?? null,
            owner: g.owner ? this.normalizeJid(g.owner) : null,
            isAnnounceGroup: g.announce ?? false,
            isLocked: g.restrict ?? false,
            isCommunity: (g as unknown as Record<string, unknown>).isCommunity === true,
            isCommunityAnnounce: (g as unknown as Record<string, unknown>).isCommunityAnnounce === true,
            linkedParent: ((g as unknown as Record<string, unknown>).linkedParent as string) ?? null,
          }));

          // Only update cache if socket is still the same (guards against stale write after disconnect)
          if (this.sock === sock) {
            this.groupsCache = summaries;
            this.groupsCacheTime = Date.now();
            // Cache raw participants for includeParticipants=true requests within same TTL window
            this.groupsRawParticipants = new Map(
              groups.map((g) => [g.id, (g.participants ?? []).map((p) => ({ id: p.id, admin: p.admin }))])
            );
          }

          return summaries;
        } finally {
          this.groupsFetchInFlight = null;
        }
      })();
    }

    const summaries = await this.groupsFetchInFlight;

    if (!includeParticipants) return summaries;

    // Build detail from cached summaries + cached raw participants (single fetch, no double API call)
    return summaries.map((s) => {
      const rawParticipants = this.groupsRawParticipants?.get(s.id) ?? [];
      return {
        ...s,
        participants: rawParticipants.map((p) => ({
          jid: this.normalizeJid(p.id),
          phone: this.phoneFromJid(p.id),
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
      };
    });
  }

  /**
   * Fetch full metadata for a single group by JID.
   * Uses groupMetadata() — one targeted Baileys call per invocation.
   */
  async getGroup(groupJid: string): Promise<WhatsAppGroupDetail> {
    if (!groupJid.endsWith('@g.us')) {
      throw new Error(`Invalid group JID: expected @g.us suffix`);
    }

    const sock = this.sock;
    if (!sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const g = await sock.groupMetadata(groupJid);

    return {
      id: g.id,
      subject: g.subject ?? '',
      description: g.desc ?? null,
      participantCount: g.participants?.length ?? 0,
      createdAt: g.creation ?? null,
      owner: g.owner ? this.normalizeJid(g.owner) : null,
      isAnnounceGroup: g.announce ?? false,
      isLocked: g.restrict ?? false,
      isCommunity: (g as unknown as Record<string, unknown>).isCommunity === true,
      isCommunityAnnounce: (g as unknown as Record<string, unknown>).isCommunityAnnounce === true,
      linkedParent: ((g as unknown as Record<string, unknown>).linkedParent as string) ?? null,
      participants: (g.participants ?? []).map((p) => ({
        jid: this.normalizeJid(p.id),
        phone: this.phoneFromJid(p.id),
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin',
      })),
    };
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

  /** Safely close and clean up the current socket, removing all event listeners. */
  private cleanupSocket(): void {
    if (this.sock) {
      try {
        // Remove all listeners first to prevent ghost events
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.ev.removeAllListeners('creds.update');
      } catch {
        /* listeners may already be gone */
      }
      try {
        this.sock.end(undefined);
      } catch {
        /* already closed */
      }
      this.groupsCache = null;
      this.groupsRawParticipants = null;
      this.groupsCacheTime = 0;
      this.sock = null;
    }
  }

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
      this.consecutive440Count = 0;
      this.emitConnectionEvent('connected');

      // Anti-ban: immediately go offline — only appear online when typing/sending
      // (Evolution API + WAHA both do this)
      this.sock?.sendPresenceUpdate('unavailable').catch(() => {
        // Non-fatal
      });

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
      // Anti-ban: 403 (forbidden), 402, 406 are PERMANENT — reconnecting makes it worse
      const isPermanentDisconnect = isLoggedOut || statusCode === 403 || statusCode === 402 || statusCode === 406;

      if (isPermanentDisconnect) {
        // Permanent disconnect — stop reconnect, need new QR or account action
        this.status = 'disconnected';
        this.qrCode = null;
        this.emitConnectionEvent('disconnected');
        log.error(`WhatsApp permanently disconnected (code: ${statusCode}) — reconnect DISABLED to prevent ban escalation`);
      } else {
        // Temporary disconnect — auto-reconnect with backoff
        this.status = 'reconnecting';
        this.emitConnectionEvent('reconnecting');
        this.scheduleReconnect(statusCode);
        const baseDelay = statusCode === 440 ? 10000 : 3000;
        const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt - 1), 60000);
        log.warn(
          `WhatsApp disconnected (code: ${statusCode}), reconnecting in ${delay}ms...`
        );
      }
    }
  }

  private scheduleReconnect(statusCode?: number): void {
    this.clearReconnectTimer();

    // Anti-ban: track consecutive 440 (connectionReplaced) errors
    if (statusCode === 440) {
      this.consecutive440Count++;
      if (this.consecutive440Count >= MAX_CONSECUTIVE_440) {
        log.error(`WhatsApp: ${MAX_CONSECUTIVE_440} consecutive 440 errors — stopping reconnect to avoid ban`);
        this.status = 'error';
        this.emitConnectionEvent('error');
        return;
      }
    } else {
      this.consecutive440Count = 0;
    }

    // Anti-ban: max reconnect attempts
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`WhatsApp: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
      this.status = 'error';
      this.emitConnectionEvent('error');
      return;
    }

    // For 440 (connectionReplaced): use longer base delay to avoid reconnect storm
    const baseDelay = statusCode === 440 ? 10000 : 3000;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempt);
    // Anti-ban: add jitter (0.5x to 1.5x) to prevent synchronized reconnects
    const jitter = 0.5 + Math.random();
    const delay = Math.min(exponentialDelay * jitter, 120_000);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      log.info(`WhatsApp reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}...`);
      // Clean up socket properly before reconnecting
      this.cleanupSocket();
      this.isReconnecting = false; // Reset flag so connect() can proceed
      this.status = 'reconnecting'; // Ensure guard in connect() passes
      this.connect().catch((err) => {
        log.error('WhatsApp reconnect failed:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==========================================================================
  // Private — Anti-Ban: Rate Limiting & Typing Simulation
  // ==========================================================================

  /** Cache a message for getMessage retry/decryption. */
  private cacheMessage(id: string, message: proto.IMessage): void {
    if (this.messageCache.size >= MESSAGE_CACHE_SIZE) {
      const first = this.messageCache.keys().next().value;
      if (first !== undefined) this.messageCache.delete(first);
    }
    this.messageCache.set(id, message);
  }

  /** Enforce rate limits: global 20/min + per-JID 3s gap. Waits if needed. */
  private async enforceRateLimit(jid: string): Promise<void> {
    const now = Date.now();

    // Per-JID rate limit: min 3s between messages to same recipient
    const lastSend = this.perJidLastSend.get(jid);
    if (lastSend) {
      const elapsed = now - lastSend;
      if (elapsed < RATE_LIMIT_PER_JID_MS) {
        const waitMs = RATE_LIMIT_PER_JID_MS - elapsed;
        log.info(`[RateLimit] Per-JID throttle for ${jid}: waiting ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // Global rate limit: max 20 messages per minute
    // Clean old entries
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    this.globalSendTimes = this.globalSendTimes.filter((t) => t > cutoff);

    if (this.globalSendTimes.length >= RATE_LIMIT_MAX_MESSAGES) {
      const oldestInWindow = this.globalSendTimes[0]!;
      const waitMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - Date.now();
      if (waitMs > 0) {
        log.info(`[RateLimit] Global throttle: waiting ${waitMs}ms (${this.globalSendTimes.length}/${RATE_LIMIT_MAX_MESSAGES} in window)`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  /** Record a message send for rate limiting. */
  private recordSend(jid: string): void {
    const now = Date.now();
    this.globalSendTimes.push(now);
    this.perJidLastSend.set(jid, now);

    // Clean up old per-JID entries (keep max 100)
    if (this.perJidLastSend.size > 100) {
      const first = this.perJidLastSend.keys().next().value;
      if (first !== undefined) this.perJidLastSend.delete(first);
    }
  }

  /**
   * Anti-ban: simulate typing before sending a message.
   * Full pattern: available → presenceSubscribe → composing → delay → paused
   * After send, caller should ensure 'unavailable' is sent (done in sendMessage).
   * Delay is proportional to text length (min 1s, max 5s).
   */
  private async simulateTyping(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    try {
      // Step 1: Go online (required before composing — Evolution API pattern)
      await this.sock.sendPresenceUpdate('available');
      await this.sock.presenceSubscribe(jid);
      // Step 2: Start composing
      await this.sock.sendPresenceUpdate('composing', jid);

      // Typing delay proportional to text length: ~50ms per char, min 1s, max 5s
      // Add Gaussian-like jitter for human-like behavior
      const baseMs = Math.min(Math.max(text.length * 50, 1000), 5000);
      const jitter = 0.7 + Math.random() * 0.6; // 0.7x to 1.3x
      const delayMs = Math.round(baseMs * jitter);
      log.info(`[Typing] Simulating ${delayMs}ms typing for ${text.length} chars to ${jid}`);
      await new Promise((r) => setTimeout(r, delayMs));

      // Step 3: Stop composing
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch {
      // Non-fatal — don't block message send
    }
  }

  // ==========================================================================
  // Private — Message Processing
  // ==========================================================================

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    log.info(`[WhatsApp] handleIncomingMessage called — jid: ${msg.key.remoteJid}, pushName: ${msg.pushName}`);
    let remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    // =========================================================================
    // LID Resolution (INACTIVE — uncomment to enable)
    // =========================================================================
    // WhatsApp's Linked ID system: since 2024, some messages arrive with
    // @lid JID (e.g. 179203903344808@lid) instead of @s.whatsapp.net.
    // LID is an internal device identifier, NOT a phone number.
    //
    // WHEN TO ACTIVATE:
    //   - Scenario A: Auto-reply opened to other users (not just self-chat)
    //     and some users' messages arrive as @lid → phone lookup needed
    //   - Scenario B: Group messages enabled and participant JIDs are @lid
    //   - Scenario C: LID-only contacts can't be matched to allowed_users
    //
    // HOW IT WORKS (Evolution API pattern, line 1478-1479 of
    //   ~/evolution-api-src/src/api/integrations/channel/whatsapp/
    //   whatsapp.baileys.service.ts):
    //   Baileys provides two JIDs per message:
    //     key.remoteJid    = 179203903344808@lid        (device/linked ID)
    //     key.remoteJidAlt = PHONE_NUMBER@s.whatsapp.net (real phone number)
    //   Swap remoteJid with remoteJidAlt so downstream (allowed_users filter,
    //   channel_users DB, AI pipeline) always sees the phone number.
    //
    // TO ACTIVATE: Remove the block comment markers (/* */) below.
    //   No other changes needed — the rest of the pipeline uses remoteJid.
    //
    // REFERENCE:
    //   Evolution API: inline swap (remoteJidAlt → remoteJid)
    //   WAHA: SQLite LID→Phone store (more robust but heavier)
    //   OwnPilot: could add PostgreSQL whatsapp_lid_map table if needed
    // =========================================================================
    /*
    if (remoteJid.endsWith('@lid')) {
      const altJid = (msg.key as Record<string, unknown>).remoteJidAlt as string | undefined;
      if (altJid && altJid.endsWith('@s.whatsapp.net')) {
        log.info(`[WhatsApp] LID resolved: ${remoteJid} → ${altJid}`);
        remoteJid = altJid;
      } else {
        log.info(`[WhatsApp] LID without remoteJidAlt — skipping ${remoteJid}`);
        return;
      }
    }
    */

    // SAFETY: Only process DMs (@s.whatsapp.net) and groups (@g.us).
    // Skip: broadcasts (@broadcast), LID (@lid), newsletter (@newsletter), status (@s.whatsapp.net status)
    // NOTE: If LID resolution above is activated, @lid messages will be
    //   resolved to @s.whatsapp.net BEFORE this check, so they will pass through.
    const isGroup = remoteJid.endsWith('@g.us');
    const isDM = remoteJid.endsWith('@s.whatsapp.net');
    if (!isDM && !isGroup) {
      log.info(`[WhatsApp] Skipping non-chat message from ${remoteJid} (only @s.whatsapp.net and @g.us processed)`);
      return;
    }

    // For group messages, extract participant (individual sender) from msg.key.participant
    // For DMs, sender is derived from remoteJid
    const participantJid = isGroup ? (msg.key.participant ?? '') : remoteJid;
    const phone = isGroup
      ? this.phoneFromJid(participantJid)
      : this.phoneFromJid(remoteJid);

    // Skip group messages where participant cannot be determined
    if (isGroup && !participantJid) {
      log.info(`[WhatsApp] Skipping group message without participant from ${remoteJid}`);
      return;
    }

    // Access control — if allowed_users is set, ONLY those users get AI responses (DM only)
    if (!isGroup && this.allowedUsers.size > 0 && !this.allowedUsers.has(phone)) {
      log.info(`[WhatsApp] Skipping message from ${phone} (not in allowed_users)`);
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
    // Audio messages — download binary for auto-transcription
    else if (m.audioMessage) {
      let audioData: Uint8Array | undefined;
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        audioData = buffer instanceof Buffer ? new Uint8Array(buffer) : undefined;
      } catch {
        // Download failed — metadata-only fallback
      }
      attachments.push({
        type: 'audio',
        mimeType: m.audioMessage.mimetype ?? 'audio/ogg',
        data: audioData,
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
      // For groups: platformChatId = group JID; for DMs: phone number
      platformChatId: isGroup ? remoteJid : phone,
      sender,
      text: text || (attachments.length > 0 ? '[Attachment]' : ''),
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp,
      metadata: {
        platformMessageId: messageId,
        jid: remoteJid,
        isGroup,
        pushName: msg.pushName || undefined,
        // For groups: store participant JID so we know who sent it
        ...(isGroup && { participant: participantJid }),
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

  /**
   * Normalize a WhatsApp JID by stripping device suffix.
   * "15551234567:3@s.whatsapp.net" -> "15551234567@s.whatsapp.net"
   */
  private normalizeJid(jid: string): string {
    if (!jid || !jid.includes(':')) return jid;
    const [userPart, domain] = jid.split('@');
    if (!domain) return jid;
    const phone = userPart!.split(':')[0]!;
    return `${phone}@${domain}`;
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
