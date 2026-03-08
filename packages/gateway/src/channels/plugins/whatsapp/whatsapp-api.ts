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
  proto,
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
import fs from 'fs/promises';
import type { ChannelMessageAttachmentInput } from '../../../db/repositories/channel-messages.js';
import { channelUsersRepo } from '../../../db/repositories/channel-users.js';
import {
  extractWhatsAppMessageMetadata,
  parseWhatsAppMessagePayload,
  type WhatsAppMediaDescriptor,
  type WhatsAppDocumentMetadata,
} from './message-parser.js';

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
    if (Date.now() > entry.expires) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }
  del(key: string): void {
    this.data.delete(key);
  }
  flushAll(): void {
    this.data.clear();
  }
}

// Anti-ban constants
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_CONSECUTIVE_440 = 3;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_MESSAGES = 20; // max 20 messages per minute (global)
const RATE_LIMIT_PER_JID_MS = 3_000; // min 3s gap per recipient
const MESSAGE_CACHE_SIZE = 500; // getMessage cache for retry/decryption
const HISTORY_ANCHOR_CACHE_SIZE = 500; // per-chat history anchors for on-demand fetch
const PROCESSED_MSG_IDS_CAP = 5000; // dedup cap for processedMsgIds (shared across upsert + history sync)

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
  private messageKeyCache = new Map<string, WAMessage['key']>();
  private historyAnchorByJid = new Map<string, { key: WAMessage['key']; timestamp: number }>();

  // Anti-ban: rate limiting
  private globalSendTimes: number[] = [];
  private perJidLastSend = new Map<string, number>();

  // Anti-ban: message deduplication (prevent double AI responses on reconnect)
  private processedMsgIds = new Set<string>();

  // Reconnect gap tracking — records when the socket last went offline
  private lastDisconnectedAt: number | null = null;

  // Anti-ban: retry counter cache (prevents infinite retry loops — Evolution + WAHA pattern)
  private msgRetryCounterCache = new SimpleTTLCache<number>(300_000); // 5 min TTL
  // Anti-ban: device info cache (reduces protocol overhead — WAHA pattern)
  private userDevicesCache = new SimpleTTLCache<string[]>(300_000); // 5 min TTL

  // History sync tracking — promise queue serializes concurrent batches (Node.js can context-switch at await)
  private historySyncQueue: Promise<void> = Promise.resolve();
  private lastHistoryFetchTime: number | null = null;

  // Display name resolution cache (LID → display_name from channel_users, 10 min TTL)
  private displayNameCache = new SimpleTTLCache<string>(10 * 60_000);

  // Group listing cache (5 min TTL — prevents excessive groupFetchAllParticipating calls)
  private groupsCache: WhatsAppGroupSummary[] | null = null;
  private groupsRawParticipants: Map<string, Array<{ id: string; admin?: string | null }>> | null =
    null;
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
        // History sync: accept all passive sync messages (Evolution API + WAHA pattern)
        // REQUIRED for messaging-history.set to fire (GitHub Issue #1934)
        shouldSyncHistoryMessage: () => true,
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
        log.info(
          `[WhatsApp] UPSERT EVENT received — type: ${upsert.type}, count: ${upsert.messages.length}`
        );

        // Cache ALL messages for getMessage retry/decryption (both append and notify)
        for (const msg of upsert.messages) {
          this.rememberHistoryAnchor(msg);
          if (msg.key.id && msg.message) {
            this.cacheMessage(msg.key.id, msg.message, msg.key);
          }
        }

        if (upsert.type === 'append') {
          // Offline/reconnect messages: save to DB but do NOT trigger AI responses.
          // Serialized via historySyncQueue to prevent race conditions with messaging-history.set.
          // SAFETY: NEVER emit MESSAGE_RECEIVED from this path.
          this.handleOfflineMessages(upsert.messages).catch((err) => {
            log.error('[WhatsApp] Failed to handle offline messages:', err);
          });
          return;
        }

        if (upsert.type !== 'notify') return;
        for (const msg of upsert.messages) {
          log.info(
            `[WhatsApp] Processing message — jid: ${msg.key.remoteJid}, fromMe: ${msg.key.fromMe}, id: ${msg.key.id}`
          );

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
            this.addToProcessedMsgIds(msgId);
          }

          this.handleIncomingMessage(msg).catch((err) => {
            log.error('Failed to handle WhatsApp message:', err);
          });
        }
      });

      // Save credentials on update
      this.sock.ev.on('creds.update', saveCreds);

      // Sync WhatsApp contacts to DB (new/updated contacts from phone)
      this.sock.ev.on('contacts.upsert', (contacts) => {
        log.info(`[WhatsApp] contacts.upsert: ${contacts.length} contacts`);
        this.syncContactsToDb(contacts).catch((err) => {
          log.error('[WhatsApp] contacts.upsert sync failed:', err);
        });
      });

      this.sock.ev.on('contacts.update', (updates) => {
        log.info(`[WhatsApp] contacts.update: ${updates.length} updates`);
        this.syncContactsToDb(updates).catch((err) => {
          log.error('[WhatsApp] contacts.update sync failed:', err);
        });
      });

      // Handle passive history sync (WhatsApp sends past messages on first connect)
      // Uses promise queue to serialize concurrent batches (Baileys can fire multiple events rapidly)
      this.sock.ev.on(
        'messaging-history.set',
        ({ messages, chats, contacts, syncType, progress, isLatest }) => {
          this.historySyncQueue = this.historySyncQueue.then(async () => {
            try {
              const syncTypeName =
                syncType != null
                  ? (proto.HistorySync.HistorySyncType[syncType] ?? String(syncType))
                  : 'unknown';
              log.info(
                `[WhatsApp] History sync received — type: ${syncTypeName}, messages: ${messages.length}, chats: ${chats?.length ?? 0}, contacts: ${contacts?.length ?? 0}, progress: ${progress ?? 'N/A'}%, isLatest: ${isLatest ?? 'N/A'}`
              );

              if (messages.length === 0) {
                log.info('[WhatsApp] History sync batch empty — skipping');
                return;
              }

              const { ChannelMessagesRepository } =
                await import('../../../db/repositories/channel-messages.js');
              const messagesRepo = new ChannelMessagesRepository();

              // Transform WAMessage[] to DB rows
              const rows: Array<Parameters<typeof messagesRepo.createBatch>[0][number]> = [];

              for (const msg of messages) {
                const remoteJid = msg.key?.remoteJid;
                if (!remoteJid) continue;

                const isGroup = remoteJid.endsWith('@g.us');
                const isDM = remoteJid.endsWith('@s.whatsapp.net');
                if (!isDM && !isGroup) continue;

                // Skip protocol/stub messages (Baileys isRealMessage pattern — WAHA best practice)
                if (msg.messageStubType != null && !msg.message) continue;

                // Skip our own outbound messages (except self-chat)
                const isSelf = this.isSelfChat(remoteJid);
                if (msg.key.fromMe && !isSelf) continue;

                const messageId = msg.key.id ?? '';
                if (!messageId) continue;

                const m = msg.message;
                if (!m) continue;
                this.rememberHistoryAnchor(msg);

                const parsedPayload = parseWhatsAppMessagePayload(m);
                const parsedMetadata = extractWhatsAppMessageMetadata(m);
                const attachments: ChannelMessageAttachmentInput[] = [];

                // DIAGNOSTIC: Log raw proto media fields for document messages
                // to determine if on-demand history sync includes mediaKey.
                if (m.documentMessage) {
                  const d = m.documentMessage;
                  log.info(
                    `[WhatsApp] PROTO-DIAG doc msgId=${messageId} jid=${remoteJid} ` +
                    `syncType=${syncTypeName} ` +
                    `fileName=${d.fileName ?? 'null'} ` +
                    `mediaKey=${d.mediaKey ? 'PRESENT(' + Buffer.from(d.mediaKey as Uint8Array).toString('base64').slice(0, 12) + '...)' : 'ABSENT'} ` +
                    `directPath=${d.directPath ? 'PRESENT' : 'ABSENT'} ` +
                    `url=${d.url ? 'PRESENT' : 'ABSENT'} ` +
                    `mimetype=${d.mimetype ?? 'null'} ` +
                    `fileLength=${d.fileLength ?? 'null'}`
                  );
                }

                // Download each detected media payload (if any) while preserving text.
                for (const media of parsedPayload.media) {
                  const mediaData = await this.downloadMediaWithRetry(msg);
                  const att = this.toAttachmentInput(media, mediaData);
                  const localPath = await this.writeSorToDisk(media.filename, messageId, mediaData);
                  if (localPath) att.local_path = localPath;
                  attachments.push(att);
                }

                // Skip empty messages (no text, no recognizable content)
                if (!parsedPayload.text && parsedPayload.media.length === 0) continue;
                const contentText = parsedPayload.text || parsedPayload.media[0]?.filename || '[Attachment]';

                const participantJid = isGroup ? (msg.key.participant ?? '') : remoteJid;
                const phone = this.phoneFromJid(participantJid || remoteJid);

                // Parse timestamp (handles number, protobuf Long, and BigInt)
                const rawTs = msg.messageTimestamp;
                let timestamp: Date;
                if (typeof rawTs === 'number') {
                  timestamp = new Date(rawTs * 1000);
                } else if (typeof rawTs === 'bigint') {
                  timestamp = new Date(Number(rawTs) * 1000);
                } else if (typeof rawTs === 'object' && rawTs !== null && 'toNumber' in rawTs) {
                  timestamp = new Date((rawTs as { toNumber(): number }).toNumber() * 1000);
                } else {
                  // No valid timestamp — skip message (bad data is worse than missing data)
                  log.warn(
                    `[WhatsApp] History sync: skipping message ${messageId} — no valid timestamp`
                  );
                  continue;
                }

                // Resolve display name from channel_users cache (LID→name)
                const resolvedName = await this.resolveDisplayName(phone, msg.pushName || undefined);

                rows.push({
                  id: `${this.pluginId}:${messageId}`,
                  channelId: this.pluginId,
                  externalId: messageId,
                  direction: 'inbound' as const,
                  senderId: phone,
                  senderName: resolvedName,
                  content: contentText,
                  contentType: parsedPayload.media.length > 0 ? 'attachment' : 'text',
                  attachments: attachments.length > 0 ? attachments : undefined,
                  metadata: {
                    platformMessageId: messageId,
                    jid: remoteJid,
                    isGroup,
                    pushName: msg.pushName || undefined,
                    ...(isGroup && participantJid ? { participant: participantJid } : {}),
                    historySync: true,
                    syncType: syncTypeName,
                    ...parsedMetadata,
                  },
                  createdAt: timestamp,
                });

                // Seed processedMsgIds to prevent double-processing on reconnect
                if (messageId) {
                  this.addToProcessedMsgIds(messageId);
                }

                // Keep history media payload in cache so retry endpoint can patch stale DB rows.
                if (messageId && parsedPayload.media.length > 0) {
                  this.cacheMessage(messageId, m, msg.key);
                }
              }

              if (rows.length > 0) {
                const inserted = await messagesRepo.createBatch(rows);

                // Enrich existing rows with media metadata from fresh protos.
                // createBatch uses ON CONFLICT DO NOTHING, so re-delivered messages
                // with mediaKey are silently dropped. This batch pass merges the new
                // mediaKey/directPath/url into rows that were missing them (single SQL).
                const enrichItems = rows
                  .map((row) => {
                    const doc = (row.metadata as Record<string, unknown>)?.document as
                      | WhatsAppDocumentMetadata
                      | undefined;
                    return doc?.mediaKey ? { id: row.id, documentMeta: doc } : null;
                  })
                  .filter((item): item is NonNullable<typeof item> => item !== null);

                const enriched = enrichItems.length > 0
                  ? await messagesRepo.enrichMediaMetadataBatch(enrichItems)
                  : 0;
                if (enriched > 0) {
                  log.info(
                    `[WhatsApp] History sync enriched ${enriched} existing rows with mediaKey (type: ${syncTypeName})`
                  );
                }

                // Update local_path for SOR files written to disk (existing rows skipped by ON CONFLICT DO NOTHING)
                const sorRows = rows.filter((row) => row.attachments?.[0]?.local_path);
                let sorUpdated = 0;
                for (const row of sorRows) {
                  const ok = await messagesRepo.updateAttachments(row.id, row.attachments!);
                  if (ok) sorUpdated++;
                }
                if (sorUpdated > 0) {
                  log.info(`[WhatsApp] History sync updated local_path for ${sorUpdated} SOR file(s) (type: ${syncTypeName})`);
                }

                log.info(
                  `[WhatsApp] History sync saved ${inserted}/${rows.length} messages to DB (type: ${syncTypeName})`
                );
              } else {
                log.info('[WhatsApp] History sync — no processable messages in batch');
              }

              // Sync contacts from history sync payload to DB
              if (contacts && contacts.length > 0) {
                try {
                  const mappedContacts = contacts
                    .filter((c: { id?: string; name?: string; notify?: string }) => c.id && (c.name || c.notify))
                    .map((c: { id: string; name?: string; notify?: string }) => ({
                      id: c.id,
                      name: c.name ?? c.notify,
                      notify: c.notify,
                    }));
                  if (mappedContacts.length > 0) {
                    const synced = await this.syncContactsToDb(mappedContacts);
                    log.info(
                      `[WhatsApp] History sync contacts: ${synced}/${contacts.length} synced to DB`
                    );
                  }
                } catch (contactErr) {
                  log.error('[WhatsApp] History sync contacts failed:', contactErr);
                }
              }
            } catch (err) {
              log.error('[WhatsApp] History sync failed:', err);
            }
          });
        }
      );

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
  async listGroups(
    includeParticipants = false
  ): Promise<WhatsAppGroupSummary[] | WhatsAppGroupDetail[]> {
    const sock = this.sock;
    if (!sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    // Return cache if valid and participants not requested
    const cacheAge = Date.now() - this.groupsCacheTime;
    if (
      !includeParticipants &&
      this.groupsCache &&
      cacheAge < WhatsAppChannelAPI.GROUPS_CACHE_TTL
    ) {
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
            isCommunityAnnounce:
              (g as unknown as Record<string, unknown>).isCommunityAnnounce === true,
            linkedParent:
              ((g as unknown as Record<string, unknown>).linkedParent as string) ?? null,
          }));

          // Only update cache if socket is still the same (guards against stale write after disconnect)
          if (this.sock === sock) {
            this.groupsCache = summaries;
            this.groupsCacheTime = Date.now();
            // Cache raw participants for includeParticipants=true requests within same TTL window
            this.groupsRawParticipants = new Map(
              groups.map((g) => [
                g.id,
                (g.participants ?? []).map((p) => ({ id: p.id, admin: p.admin })),
              ])
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
   * Fetch message history for a specific group on-demand.
   * Uses Baileys fetchMessageHistory() — sends request to phone (must be online).
   * Result arrives async via messaging-history.set event (syncType = ON_DEMAND).
   */
  async fetchGroupHistory(groupJid: string, count = 50): Promise<string> {
    if (!groupJid.endsWith('@g.us')) {
      throw new Error('Invalid group JID: expected @g.us suffix');
    }

    const sock = this.sock;
    if (!sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    // Rate limit: max 1 call per 30 seconds (atomic check+set to prevent TOCTOU race)
    const now = Date.now();
    const lastFetch = this.lastHistoryFetchTime;
    this.lastHistoryFetchTime = now; // Set FIRST to block concurrent requests
    if (lastFetch && now - lastFetch < 30_000) {
      throw new Error('Rate limited — wait 30 seconds between history fetch requests');
    }

    // Always load from DB — historyAnchorByJid tracks NEWEST per chat (for dedup/upsert),
    // but fetchMessageHistory requires the OLDEST known message as anchor to page backward.
    // Using newest as anchor yields empty ON_DEMAND batches (WhatsApp treats history as synced).
    const anchor = await this.loadHistoryAnchorFromDatabase(groupJid);
    const anchorKey = anchor?.key;
    const requestKey =
      anchorKey?.id && anchorKey.id.length > 0
        ? {
            remoteJid: groupJid,
            fromMe: anchorKey.fromMe ?? false,
            id: anchorKey.id,
            participant: anchorKey.participant,
          }
        : { remoteJid: groupJid, fromMe: false, id: '' };
    const requestTimestamp = anchor?.timestamp ?? 0;

    const sessionId = await sock.fetchMessageHistory(
      Math.min(count, 50), // Baileys max 50 per request
      requestKey,
      requestTimestamp
    );

    log.info(
      `[WhatsApp] On-demand history fetch requested — group: ${groupJid}, count: ${count}, sessionId: ${sessionId}, anchorId: ${requestKey.id || 'none'}, anchorTs: ${requestTimestamp}`
    );
    return sessionId;
  }

  /**
   * Fetch history using a caller-provided anchor (message id + timestamp).
   * Useful for targeted recovery when retrying media for a specific stale row.
   */
  async fetchGroupHistoryFromAnchor(params: {
    groupJid: string;
    messageId: string;
    messageTimestamp: number;
    count?: number;
    fromMe?: boolean;
    participant?: string;
  }): Promise<string> {
    const { groupJid, messageId, messageTimestamp, count = 50, fromMe = false, participant } = params;
    if (!groupJid.endsWith('@g.us')) {
      throw new Error('Invalid group JID: expected @g.us suffix');
    }
    if (!messageId || messageTimestamp <= 0) {
      throw new Error('Invalid anchor: messageId and messageTimestamp are required');
    }

    const sock = this.sock;
    if (!sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const now = Date.now();
    const lastFetch = this.lastHistoryFetchTime;
    this.lastHistoryFetchTime = now;
    if (lastFetch && now - lastFetch < 30_000) {
      throw new Error('Rate limited — wait 30 seconds between history fetch requests');
    }

    const sessionId = await sock.fetchMessageHistory(
      Math.min(count, 50),
      {
        remoteJid: groupJid,
        fromMe,
        id: messageId,
        participant,
      },
      messageTimestamp
    );

    log.info(
      `[WhatsApp] On-demand history fetch requested (anchor override) — group: ${groupJid}, count: ${count}, sessionId: ${sessionId}, anchorId: ${messageId}, anchorTs: ${messageTimestamp}`
    );
    return sessionId;
  }

  /**
   * Retry media download for a known WhatsApp message.
   * Works when the message payload is still available in in-memory cache.
   */
  async retryMediaDownload(params: {
    messageId: string;
    remoteJid: string;
    participant?: string;
    fromMe?: boolean;
  }): Promise<{ data: Uint8Array; size: number; mimeType?: string; filename?: string }> {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const cachedMessage = this.messageCache.get(params.messageId);
    if (!cachedMessage) {
      throw new Error('Message payload not found in cache for retry');
    }

    const parsed = parseWhatsAppMessagePayload(cachedMessage);
    if (parsed.media.length === 0) {
      throw new Error('Message has no retryable media payload');
    }

    const cachedKey = this.messageKeyCache.get(params.messageId);
    const key: WAMessage['key'] = {
      id: params.messageId,
      remoteJid: cachedKey?.remoteJid ?? params.remoteJid,
      fromMe: cachedKey?.fromMe ?? params.fromMe ?? false,
      participant: cachedKey?.participant ?? params.participant,
    };

    const waMessage: WAMessage = {
      key,
      message: cachedMessage,
    };

    const data = await this.downloadMediaWithRetry(waMessage);
    if (!data) {
      throw new Error('Media download failed');
    }

    const primaryMedia = parsed.media[0];
    return {
      data,
      size: data.length,
      mimeType: primaryMedia?.mimeType,
      filename: primaryMedia?.filename,
    };
  }

  /**
   * Retry media download using stored metadata (mediaKey, directPath, url) from the DB.
   * Reconstructs a minimal WAMessage proto and calls downloadMediaWithRetry,
   * which will automatically trigger reuploadRequest on 410/404 (expired CDN URL).
   *
   * This is the key method for recovering old media whose CDN URLs have expired:
   * the sender's phone re-uploads the file, giving us a fresh URL.
   */
  async retryMediaFromMetadata(params: {
    messageId: string;
    remoteJid: string;
    participant?: string;
    fromMe?: boolean;
    mediaKey: string;       // base64-encoded
    directPath: string;
    url: string;
    mimeType?: string;
    filename?: string;
    fileLength?: number;
  }): Promise<{ data: Uint8Array; size: number; mimeType?: string; filename?: string }> {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const mediaKeyBuffer = Buffer.from(params.mediaKey, 'base64');

    // Reconstruct minimal WAMessage with documentMessage proto
    const reconstructedMsg: WAMessage = {
      key: {
        id: params.messageId,
        remoteJid: params.remoteJid,
        fromMe: params.fromMe ?? false,
        participant: params.participant,
      },
      message: {
        documentMessage: {
          url: params.url,
          directPath: params.directPath,
          mediaKey: new Uint8Array(mediaKeyBuffer),
          mimetype: params.mimeType ?? 'application/octet-stream',
          fileName: params.filename,
          fileLength: params.fileLength != null ? BigInt(params.fileLength) as any : undefined,
        },
      },
    };

    log.info(
      `[retryMediaFromMetadata] Attempting download for msgId=${params.messageId} ` +
      `file=${params.filename ?? 'unknown'} via stored metadata`
    );

    // Step 1: Try direct download first (unlikely to work for expired URLs)
    try {
      const data = await this.downloadMediaWithRetry(reconstructedMsg);
      if (data) {
        log.info(
          `[retryMediaFromMetadata] Direct download success! msgId=${params.messageId} size=${data.length}`
        );
        return { data, size: data.length, mimeType: params.mimeType, filename: params.filename };
      }
    } catch (err: any) {
      log.info(
        `[retryMediaFromMetadata] Direct download failed (expected for expired URLs): ${err?.message?.slice(0, 200)}`
      );
    }

    // Step 2: Explicit re-upload request — asks sender's phone to re-upload file to CDN.
    // Baileys downloadMediaMessage has a bug in RC9: checks error.status but Boom sets
    // output.statusCode, so automatic reuploadRequest never triggers. We call it explicitly.
    // Timeout: updateMediaMessage waits indefinitely for sender's phone response.
    // Add 30s timeout to prevent infinite hang if sender is offline.
    log.info(
      `[retryMediaFromMetadata] Requesting media re-upload from sender's phone for msgId=${params.messageId}`
    );

    const REUPLOAD_TIMEOUT_MS = 30_000;
    const updatedMsg = await Promise.race([
      this.sock.updateMediaMessage(reconstructedMsg),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Re-upload request timed out — sender phone may be offline')), REUPLOAD_TIMEOUT_MS)
      ),
    ]);

    log.info(
      `[retryMediaFromMetadata] Re-upload response received for msgId=${params.messageId}, ` +
      `hasNewUrl=${!!updatedMsg?.message?.documentMessage?.url}`
    );

    // Step 3: Download with fresh URL from re-uploaded message
    const data = await this.downloadMediaWithRetry(updatedMsg);
    if (!data) {
      throw new Error('Media download failed after re-upload request');
    }

    log.info(
      `[retryMediaFromMetadata] Success! msgId=${params.messageId} ` +
      `file=${params.filename ?? 'unknown'} size=${data.length}`
    );

    return {
      data,
      size: data.length,
      mimeType: params.mimeType,
      filename: params.filename,
    };
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
        this.sock.ev.removeAllListeners('messaging-history.set');
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
      this.historySyncQueue = Promise.resolve();
      this.messageCache.clear();
      this.messageKeyCache.clear();
      this.historyAnchorByJid.clear();
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
      // Log reconnection gap duration (helps debug missed messages)
      if (this.lastDisconnectedAt) {
        const gapMs = Date.now() - this.lastDisconnectedAt;
        log.info(`[WhatsApp] Reconnected after ${Math.round(gapMs / 1000)}s gap`);
      }

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
      this.lastDisconnectedAt = Date.now();
      const error = lastDisconnect?.error;
      const statusCode = (error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      // Anti-ban: 403 (forbidden), 402, 406 are PERMANENT — reconnecting makes it worse
      const isPermanentDisconnect =
        isLoggedOut || statusCode === 403 || statusCode === 402 || statusCode === 406;

      if (isPermanentDisconnect) {
        // Permanent disconnect — stop reconnect, need new QR or account action
        this.status = 'disconnected';
        this.qrCode = null;
        this.emitConnectionEvent('disconnected');
        log.error(
          `WhatsApp permanently disconnected (code: ${statusCode}) — reconnect DISABLED to prevent ban escalation`
        );
      } else {
        // Temporary disconnect — auto-reconnect with backoff
        this.status = 'reconnecting';
        this.emitConnectionEvent('reconnecting');
        this.scheduleReconnect(statusCode);
        const baseDelay = statusCode === 440 ? 10000 : 3000;
        const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt - 1), 60000);
        log.warn(`WhatsApp disconnected (code: ${statusCode}), reconnecting in ${delay}ms...`);
      }
    }
  }

  private scheduleReconnect(statusCode?: number): void {
    this.clearReconnectTimer();

    // Anti-ban: track consecutive 440 (connectionReplaced) errors
    if (statusCode === 440) {
      this.consecutive440Count++;
      if (this.consecutive440Count >= MAX_CONSECUTIVE_440) {
        log.error(
          `WhatsApp: ${MAX_CONSECUTIVE_440} consecutive 440 errors — stopping reconnect to avoid ban`
        );
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

  /** Cache a message + key for getMessage retry/decryption and manual media retry. */
  private cacheMessage(id: string, message: proto.IMessage, key?: WAMessage['key']): void {
    if (this.messageCache.size >= MESSAGE_CACHE_SIZE) {
      const first = this.messageCache.keys().next().value;
      if (first !== undefined) {
        this.messageCache.delete(first);
        this.messageKeyCache.delete(first);
      }
    }
    this.messageCache.set(id, message);
    if (key) {
      this.messageKeyCache.set(id, key);
    }
  }

  /** Track latest seen key per chat so on-demand history can use a meaningful anchor. */
  private rememberHistoryAnchor(msg: WAMessage): void {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || !msg.key.id) return;

    const timestamp = this.extractMessageTimestampSeconds(msg.messageTimestamp);
    if (!timestamp) return;

    const existing = this.historyAnchorByJid.get(remoteJid);
    if (!existing || timestamp >= existing.timestamp) {
      if (this.historyAnchorByJid.size >= HISTORY_ANCHOR_CACHE_SIZE) {
        const first = this.historyAnchorByJid.keys().next().value;
        if (first !== undefined) this.historyAnchorByJid.delete(first);
      }
      this.historyAnchorByJid.set(remoteJid, {
        key: msg.key,
        timestamp,
      });
    }
  }

  private extractMessageTimestampSeconds(
    rawTs: WAMessage['messageTimestamp'] | undefined
  ): number | null {
    if (typeof rawTs === 'number') return rawTs;
    if (typeof rawTs === 'bigint') return Number(rawTs);
    if (typeof rawTs === 'object' && rawTs !== null && 'toNumber' in rawTs) {
      return (rawTs as { toNumber(): number }).toNumber();
    }
    return null;
  }

  /**
   * Fallback history anchor from persisted DB when in-memory cache is cold
   * (e.g., after restart and before any new incoming message).
   *
   * Baileys fetchMessageHistory expects an "oldest known" key/timestamp.
   * Using newest rows as anchor can yield empty on-demand batches.
   */
  private async loadHistoryAnchorFromDatabase(
    chatJid: string
  ): Promise<{ key: WAMessage['key']; timestamp: number } | undefined> {
    try {
      const { ChannelMessagesRepository } =
        await import('../../../db/repositories/channel-messages.js');
      const repo = new ChannelMessagesRepository();
      const oldest = await repo.getOldestByChat(this.pluginId, chatJid);
      if (!oldest) return undefined;

      const metadata = oldest.metadata ?? {};
      const platformMessageId =
        typeof metadata.platformMessageId === 'string' && metadata.platformMessageId.length > 0
          ? metadata.platformMessageId
          : oldest.externalId;
      if (!platformMessageId) return undefined;

      return {
        key: {
          id: platformMessageId,
          remoteJid: chatJid,
          fromMe: oldest.direction === 'outbound',
          participant:
            typeof metadata.participant === 'string' ? metadata.participant : undefined,
        },
        timestamp: Math.floor(oldest.createdAt.getTime() / 1000),
      };
    } catch (error) {
      log.warn(`[WhatsApp] Failed to load DB history anchor for ${chatJid}: ${getErrorMessage(error)}`);
      return undefined;
    }
  }

  private toAttachmentInput(
    media: WhatsAppMediaDescriptor,
    data: Uint8Array | undefined
  ): ChannelMessageAttachmentInput {
    if (media.kind === 'document') {
      return {
        type: 'file',
        url: '',
        mimeType: media.mimeType,
        filename: media.filename,
        size: data?.length ?? media.size,
        data,
      };
    }
    if (media.kind === 'sticker') {
      return {
        type: 'image',
        url: '',
        mimeType: media.mimeType,
        data,
      };
    }
    return {
      type: media.kind,
      url: '',
      mimeType: media.mimeType,
      size: data?.length ?? media.size,
      data,
    };
  }

  /**
   * Write a SOR binary to disk under /app/data/sor-files/{messageId}.sor.
   * Returns the written path, or undefined if not a SOR file or write failed.
   */
  private async writeSorToDisk(
    filename: string | undefined,
    messageId: string,
    data: Uint8Array | undefined
  ): Promise<string | undefined> {
    if (!filename?.toLowerCase().endsWith('.sor') || !data || !messageId) return undefined;
    const sorDir = '/app/data/sor-files';
    const filePath = `${sorDir}/${messageId}.sor`;
    try {
      await fs.mkdir(sorDir, { recursive: true });
      await fs.writeFile(filePath, data);
      log.info(`[SOR] Written to disk: ${filePath} (${data.length} bytes)`);
      return filePath;
    } catch (err) {
      log.warn(`[SOR] Failed to write to disk: ${err}`);
      return undefined;
    }
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
        log.info(
          `[RateLimit] Global throttle: waiting ${waitMs}ms (${this.globalSendTimes.length}/${RATE_LIMIT_MAX_MESSAGES} in window)`
        );
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
    log.info(
      `[WhatsApp] handleIncomingMessage called — jid: ${msg.key.remoteJid}, pushName: ${msg.pushName}`
    );
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
      log.info(
        `[WhatsApp] Skipping non-chat message from ${remoteJid} (only @s.whatsapp.net and @g.us processed)`
      );
      return;
    }

    // Skip group messages where participant cannot be determined (guard BEFORE phone extraction)
    if (isGroup && !msg.key.participant) {
      log.info(`[WhatsApp] Skipping group message without participant from ${remoteJid}`);
      return;
    }

    // For group messages, extract participant (individual sender) from msg.key.participant
    // For DMs, sender is derived from remoteJid
    const participantJid = isGroup ? msg.key.participant! : remoteJid;
    const phone = this.phoneFromJid(participantJid);

    // Access control — if allowed_users is set, ONLY those users get AI responses (DM only)
    if (!isGroup && this.allowedUsers.size > 0 && !this.allowedUsers.has(phone)) {
      log.info(`[WhatsApp] Skipping message from ${phone} (not in allowed_users)`);
      return;
    }

    // Extract message content
    const m = msg.message;
    if (!m) return;

    const parsedPayload = parseWhatsAppMessagePayload(m);
    const parsedMetadata = extractWhatsAppMessageMetadata(m);
    const text = parsedPayload.text;
    const attachments: ChannelMessageAttachmentInput[] = [];

    const messageId = msg.key.id ?? '';

    for (const media of parsedPayload.media) {
      const mediaData = await this.downloadMediaWithRetry(msg);
      const att = this.toAttachmentInput(media, mediaData);
      const localPath = await this.writeSorToDisk(media.filename, messageId, mediaData);
      if (localPath) att.local_path = localPath;
      attachments.push(att);
    }

    // Skip empty messages
    if (!text && attachments.length === 0) return;

    const resolvedName = await this.resolveDisplayName(phone, msg.pushName || undefined);
    const sender: ChannelUser = {
      platformUserId: phone,
      platform: 'whatsapp',
      displayName: resolvedName,
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
      text: text || (attachments.length > 0 ? (parsedPayload.media[0]?.filename ?? '[Attachment]') : ''),
      attachments: attachments.length > 0 ? (attachments as unknown as ChannelAttachment[]) : undefined,
      timestamp,
      metadata: {
        platformMessageId: messageId,
        jid: remoteJid,
        isGroup,
        pushName: msg.pushName || undefined,
        // For groups: store participant JID so we know who sent it
        ...(isGroup && { participant: participantJid }),
        ...parsedMetadata,
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
   * Sync WhatsApp contacts to the contacts DB table.
   * Handles contacts.upsert, contacts.update, and messaging-history.set contacts.
   * Uses ON CONFLICT upsert — safe to call repeatedly (idempotent).
   */
  private async syncContactsToDb(
    contacts: Array<{ id?: string; name?: string; notify?: string; verifiedName?: string }>
  ): Promise<number> {
    const { ContactsRepository } = await import('../../../db/repositories/contacts.js');
    const repo = new ContactsRepository();

    let synced = 0;
    for (const contact of contacts) {
      if (!contact.id) continue;

      // Skip group JIDs and status broadcasts
      if (contact.id.endsWith('@g.us') || contact.id.endsWith('@broadcast')) continue;

      const name =
        contact.name || contact.notify || contact.verifiedName || contact.id.split('@')[0] || contact.id;
      const phone = this.phoneFromJid(contact.id);
      if (!phone) continue;

      try {
        await repo.upsertByExternal({
          externalId: contact.id,
          externalSource: 'whatsapp',
          name,
          phone,
        });
        synced++;
      } catch (err) {
        log.warn(`[WhatsApp] Contact sync failed for ${contact.id}:`, err);
      }
    }
    return synced;
  }

  /**
   * Resolve a human-readable display name for a sender.
   * Priority: pushName (if non-empty) → channel_users display_name → phone/LID fallback.
   * Uses TTL cache to avoid repeated DB lookups.
   */
  private async resolveDisplayName(platformUserId: string, pushName?: string): Promise<string> {
    // If pushName is a real name (not numeric LID), use it directly
    if (pushName && !/^\d+$/.test(pushName)) return pushName;

    // Check cache first
    const cached = this.displayNameCache.get(platformUserId);
    if (cached) return cached;

    // Lookup from channel_users table
    try {
      const user = await channelUsersRepo.findByPlatform('whatsapp', platformUserId);
      if (user?.displayName && !/^\d+$/.test(user.displayName)) {
        this.displayNameCache.set(platformUserId, user.displayName);
        return user.displayName;
      }
    } catch {
      // DB not available — fall through to fallback
    }

    // Fallback to pushName or phone/LID
    return pushName || platformUserId;
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

  /** Add a message ID to the dedup set with FIFO cap eviction. */
  private addToProcessedMsgIds(messageId: string): void {
    this.processedMsgIds.add(messageId);
    if (this.processedMsgIds.size > PROCESSED_MSG_IDS_CAP) {
      const first = this.processedMsgIds.values().next().value;
      if (first !== undefined) this.processedMsgIds.delete(first);
    }
  }

  /**
   * Parse a WAMessage timestamp to a Date object.
   * Handles number, BigInt, and protobuf Long formats.
   * Returns null if timestamp is invalid (caller decides whether to skip or fallback).
   */
  private parseMessageTimestamp(rawTs: WAMessage['messageTimestamp']): Date | null {
    const seconds = this.extractMessageTimestampSeconds(rawTs);
    return seconds != null ? new Date(seconds * 1000) : null;
  }

  /**
   * Save offline/reconnect messages (type='append') to DB without triggering AI responses.
   * Serialized via historySyncQueue to prevent race conditions with messaging-history.set.
   *
   * SAFETY: This method MUST NEVER emit MESSAGE_RECEIVED or call handleIncomingMessage.
   * Offline messages are stored for history completeness only.
   *
   * Design decisions (backed by 10-agent research):
   * - Batch-collect all messages, then single createBatch call (not per-message create)
   * - Metadata-only for media (no downloadMediaWithRetry — ban risk)
   * - Serialized via historySyncQueue (prevents race with history sync)
   * - Uses createBatch with ON CONFLICT DO NOTHING (DB-level dedup)
   */
  private async handleOfflineMessages(messages: WAMessage[]): Promise<void> {
    if (messages.length === 0) return;

    // Serialize with history sync to prevent race conditions
    this.historySyncQueue = this.historySyncQueue.then(async () => {
      try {
        const { ChannelMessagesRepository } =
          await import('../../../db/repositories/channel-messages.js');
        const messagesRepo = new ChannelMessagesRepository();

        const rows: Array<Parameters<typeof messagesRepo.createBatch>[0][number]> = [];

        for (const msg of messages) {
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid) continue;

          const isGroup = remoteJid.endsWith('@g.us');
          const isDM = remoteJid.endsWith('@s.whatsapp.net');
          if (!isDM && !isGroup) continue;

          // Skip protocol/stub messages (Baileys isRealMessage pattern)
          if (msg.messageStubType != null && !msg.message) continue;

          // Skip our own messages (except self-chat)
          const isSelf = this.isSelfChat(remoteJid);
          if (msg.key.fromMe && !isSelf) continue;

          const messageId = msg.key.id ?? '';
          if (!messageId) continue;

          const m = msg.message;
          if (!m) continue;

          // Dedup: skip if already processed by notify or history sync
          if (this.processedMsgIds.has(messageId)) continue;

          // Skip group messages without participant (can't determine sender)
          if (isGroup && !msg.key.participant) continue;

          const parsedPayload = parseWhatsAppMessagePayload(m);
          const parsedMetadata = extractWhatsAppMessageMetadata(m);

          // Metadata-only for media: extract metadata but do NOT download binary.
          // CDN URLs may be expired, and burst downloads trigger ban detection.
          // Media can be recovered later via the recover-media endpoint with throttling.
          const attachments: ChannelMessageAttachmentInput[] = [];
          for (const media of parsedPayload.media) {
            attachments.push(this.toAttachmentInput(media, undefined));
          }

          // Skip empty messages (no text, no recognizable content)
          if (!parsedPayload.text && parsedPayload.media.length === 0) continue;
          const contentText = parsedPayload.text || parsedPayload.media[0]?.filename || '[Attachment]';

          const participantJid = isGroup ? (msg.key.participant ?? '') : remoteJid;
          const phone = this.phoneFromJid(participantJid || remoteJid);

          // Parse timestamp
          const timestamp = this.parseMessageTimestamp(msg.messageTimestamp);
          if (!timestamp) {
            log.warn(`[WhatsApp] Offline: skipping message ${messageId} — no valid timestamp`);
            continue;
          }

          const resolvedName = await this.resolveDisplayName(phone, msg.pushName || undefined);

          rows.push({
            id: `${this.pluginId}:${messageId}`,
            channelId: this.pluginId,
            externalId: messageId,
            direction: 'inbound' as const,
            senderId: phone,
            senderName: resolvedName,
            content: contentText,
            contentType: parsedPayload.media.length > 0 ? 'attachment' : 'text',
            attachments: attachments.length > 0 ? attachments : undefined,
            metadata: {
              platformMessageId: messageId,
              jid: remoteJid,
              isGroup,
              pushName: msg.pushName || undefined,
              ...(isGroup && participantJid ? { participant: participantJid } : {}),
              offlineSync: true,
              ...parsedMetadata,
            },
            createdAt: timestamp,
          });

          // Seed processedMsgIds to prevent double-processing if notify arrives later
          this.addToProcessedMsgIds(messageId);
        }

        if (rows.length > 0) {
          const inserted = await messagesRepo.createBatch(rows);

          // Enrich existing rows with media metadata (same pattern as history sync)
          const enrichItems = rows
            .map((row) => {
              const doc = (row.metadata as Record<string, unknown>)?.document as
                | WhatsAppDocumentMetadata
                | undefined;
              return doc?.mediaKey ? { id: row.id, documentMeta: doc } : null;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          const enriched = enrichItems.length > 0
            ? await messagesRepo.enrichMediaMetadataBatch(enrichItems)
            : 0;
          if (enriched > 0) {
            log.info(`[WhatsApp] Offline sync enriched ${enriched} existing rows with mediaKey`);
          }

          // Update local_path for SOR files written to disk (existing rows skipped by ON CONFLICT DO NOTHING)
          const sorRows = rows.filter((row) => row.attachments?.[0]?.local_path);
          let sorUpdated = 0;
          for (const row of sorRows) {
            const ok = await messagesRepo.updateAttachments(row.id, row.attachments!);
            if (ok) sorUpdated++;
          }
          if (sorUpdated > 0) {
            log.info(`[WhatsApp] Offline sync updated local_path for ${sorUpdated} SOR file(s)`);
          }

          log.info(
            `[WhatsApp] Offline sync saved ${inserted}/${rows.length} messages to DB (from ${messages.length} append messages)`
          );
        } else {
          log.info(`[WhatsApp] Offline sync — no processable messages in ${messages.length} append batch`);
        }
      } catch (err) {
        log.error('[WhatsApp] Offline sync failed:', err);
      }
    });
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

  /**
   * Download media from a WhatsApp message with automatic retry on expired URLs.
   *
   * WhatsApp media URLs expire after some time (410 Gone). When this happens,
   * we use reuploadRequest (sock.updateMediaMessage) to get a fresh URL.
   *
   * @param msg - The WhatsApp message containing media
   * @returns Uint8Array binary data, or undefined if download fails
   */
  private async downloadMediaWithRetry(msg: WAMessage): Promise<Uint8Array | undefined> {
    if (!this.sock) {
      log.warn('[downloadMediaWithRetry] No sock available');
      return undefined;
    }

    const downloadOptions = {
      logger: log as any,
      reuploadRequest: this.sock.updateMediaMessage.bind(this.sock),
    };

    // Check if message has media content
    const msgAny = msg.message as any;
    const hasMediaKey = !!(msgAny?.imageMessage?.mediaKey || msgAny?.videoMessage?.mediaKey || msgAny?.documentMessage?.mediaKey || msgAny?.audioMessage?.mediaKey || msgAny?.stickerMessage?.mediaKey);
    const hasUrl = !!(msgAny?.imageMessage?.url || msgAny?.videoMessage?.url || msgAny?.documentMessage?.url || msgAny?.audioMessage?.url || msgAny?.stickerMessage?.url);
    log.info(`[downloadMediaWithRetry] hasMediaKey=${hasMediaKey}, hasUrl=${hasUrl}`);

    try {
      // First attempt
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, downloadOptions);
      if (buffer) {
        log.info(`[downloadMediaWithRetry] Success, size=${buffer.length}`);
        // Convert Buffer to Uint8Array if needed
        if (Buffer.isBuffer(buffer)) {
          return new Uint8Array(buffer);
        }
        return buffer;
      }
      log.warn('[downloadMediaWithRetry] Buffer is empty/undefined');
    } catch (error: any) {
      const errorMsg = error?.message?.toString() || '';
      const is410Gone = errorMsg.includes('410') || errorMsg.includes('Gone') || errorMsg.includes('status code 410');
      const is404NotFound = errorMsg.includes('404') || errorMsg.includes('Not Found') || errorMsg.includes('status code 404');

      log.warn(`[downloadMediaWithRetry] First attempt failed: ${errorMsg.slice(0, 200)}`);

      // Retry on 410 Gone or 404 Not Found
      if (is410Gone || is404NotFound) {
        try {
          log.info('[downloadMediaWithRetry] Retrying with reuploadRequest...');
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, downloadOptions);
          if (buffer) {
            if (Buffer.isBuffer(buffer)) {
              return new Uint8Array(buffer);
            }
            return buffer;
          }
        } catch (retryError: any) {
          const retryErrorMsg = retryError?.message?.toString() || '';
          log.error(`[downloadMediaWithRetry] Retry failed: ${retryErrorMsg.slice(0, 200)}`);
        }
      }
    }

    return undefined;
  }
}
