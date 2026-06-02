/**
 * ChannelServiceImpl
 *
 * Concrete implementation of IChannelService for the gateway.
 * Discovers channel plugins from PluginRegistry, routes messages
 * through EventBus, handles verification, and manages sessions.
 */

import { timingSafeEqual, randomInt } from 'node:crypto';
import {
  type IChannelService,
  type ChannelOutgoingMessage,
  type ChannelPlatform,
  type ChannelPluginAPI,
  type ChannelPluginInfo,
  type ChannelIncomingMessage,
  type ChannelPluginManifest,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  type ChannelUserVerifiedData,
  type ChannelUserPendingData,
  type ChannelUserFirstSeenData,
  getEventBus,
  createEvent,
  type PluginRegistry,
  type Plugin,
  hasSessionService,
  getSessionService,
  hasMessageBus,
  getMessageBus,
  getConfigCenter,
  getLLMRouter,
  type ISessionService,
  type IMessageBus,
} from '@ownpilot/core';

import {
  channelUsersRepo,
  type ChannelUsersRepository,
} from '../db/repositories/channels/users.js';
import {
  channelSessionsRepo,
  type ChannelSessionsRepository,
} from '../db/repositories/channels/sessions.js';
import { ChannelMessagesRepository } from '../db/repositories/channels/messages.js';
import { channelsRepo } from '../db/repositories/channels/index.js';
import {
  getChannelVerificationService,
  type ChannelVerificationService,
} from './auth/verification.js';
import type { DmPairingRequestsRepository } from '../db/repositories/channels/dm-pairing.js';
import { dmPairingRequestsRepo } from '../db/repositories/channels/dm-pairing.js';
import { wsGateway } from '../ws/server.js';
import { getErrorMessage } from '../utils/common.js';
import { getLog } from '../services/log.js';
import { claimOwnership, getOwnerUserId, autoClaimOwnership } from '../services/pairing-service.js';
import { clearChannelSession } from '../services/conversation-service.js';
import {
  processViaBus as processViaBusImpl,
  processDirectAgent as processDirectAgentImpl,
} from './channel-ai-routing.js';
import { channelAssetStore } from '../services/channel-asset-store.js';
import { bridgeIncomingMessage } from './bridge-runtime.js';

const log = getLog('ChannelService');

/** Try to get ISessionService via the core capability accessor. */
function tryGetSessionService(): ISessionService | null {
  return hasSessionService() ? getSessionService() : null;
}

/** Try to get IMessageBus via the core capability accessor. */
function tryGetMessageBus(): IMessageBus | null {
  return hasMessageBus() ? getMessageBus() : null;
}

// ============================================================================
// Helper: Check if a plugin is a channel plugin
// ============================================================================

function isChannelPlugin(plugin: Plugin): boolean {
  const api = plugin.api as unknown as ChannelPluginAPI | undefined;
  return (
    plugin.manifest.category === 'channel' &&
    api !== undefined &&
    typeof api.connect === 'function' &&
    typeof api.sendMessage === 'function' &&
    typeof api.getStatus === 'function' &&
    typeof api.getPlatform === 'function'
  );
}

function getChannelApi(plugin: Plugin): ChannelPluginAPI {
  return plugin.api as unknown as ChannelPluginAPI;
}

function getChannelPlatform(plugin: Plugin): ChannelPlatform {
  return (plugin.manifest as ChannelPluginManifest).platform ?? 'unknown';
}

// ============================================================================
// Implementation
// ============================================================================

export class ChannelServiceImpl implements IChannelService {
  private readonly usersRepo: ChannelUsersRepository;
  private readonly sessionsRepo: ChannelSessionsRepository;
  private readonly messagesRepo: ChannelMessagesRepository;
  private readonly verificationService: ChannelVerificationService;
  private readonly dmPairingRequests: DmPairingRequestsRepository;
  private readonly pluginRegistry: PluginRegistry;
  private unsubscribes: Array<() => void> = [];
  private readonly sessionLocks = new Map<string, Promise<void>>();
  /** Per-(platform,platformUserId) approval-code attempt counter — wiped on success. */
  private readonly approvalAttemptCounts = new Map<string, number>();
  private static readonly MAX_APPROVAL_ATTEMPTS = 3;

  /**
   * Inbound flood guard. Tracks (channelPluginId, platformUserId) -> sliding
   * window of recent message timestamps. Over-limit messages are dropped
   * BEFORE user lookup / AI routing, so a flood cannot exhaust DB or LLM.
   */
  private readonly inboundWindows = new Map<string, number[]>();
  private readonly recentlyWarnedFlooders = new Set<string>();
  private static readonly INBOUND_RATE_LIMIT_MAX = parseInt(
    process.env.CHANNEL_INBOUND_RATE_LIMIT_MAX ?? '20',
    10
  );
  private static readonly INBOUND_RATE_LIMIT_WINDOW_MS = parseInt(
    process.env.CHANNEL_INBOUND_RATE_LIMIT_WINDOW_MS ?? '60000',
    10
  );
  private static readonly INBOUND_RATE_LIMIT_MAX_TRACKED = 10_000;

  /**
   * Returns true if the message should be dropped due to sender flood.
   * Records the timestamp on the allowed path so consecutive messages count
   * toward the window.
   */
  private isFlooding(channelPluginId: string, platformUserId: string): boolean {
    if (!platformUserId) return false;
    const key = `${channelPluginId}::${platformUserId}`;
    const now = Date.now();
    const windowMs = ChannelServiceImpl.INBOUND_RATE_LIMIT_WINDOW_MS;
    const limit = ChannelServiceImpl.INBOUND_RATE_LIMIT_MAX;

    let stamps = this.inboundWindows.get(key);
    if (!stamps) {
      stamps = [];
      this.inboundWindows.set(key, stamps);
      if (this.inboundWindows.size > ChannelServiceImpl.INBOUND_RATE_LIMIT_MAX_TRACKED) {
        const oldest = this.inboundWindows.keys().next().value;
        if (oldest !== undefined && oldest !== key) this.inboundWindows.delete(oldest);
      }
    }

    const cutoff = now - windowMs;
    const filtered: number[] = [];
    for (const t of stamps) if (t >= cutoff) filtered.push(t);
    stamps = filtered;
    this.inboundWindows.set(key, stamps);

    if (stamps.length >= limit) {
      if (!this.recentlyWarnedFlooders.has(key)) {
        log.warn('Inbound message dropped: sender exceeded rate limit', {
          channelPluginId,
          platformUserId,
          limit,
          windowMs,
        });
        this.recentlyWarnedFlooders.add(key);
        const timer = setTimeout(() => this.recentlyWarnedFlooders.delete(key), windowMs);
        timer.unref?.();
      }
      return true;
    }

    stamps.push(now);
    return false;
  }

  constructor(
    pluginRegistry: PluginRegistry,
    options?: {
      usersRepo?: ChannelUsersRepository;
      sessionsRepo?: ChannelSessionsRepository;
      verificationService?: ChannelVerificationService;
      dmPairingRequests?: DmPairingRequestsRepository;
    }
  ) {
    this.pluginRegistry = pluginRegistry;
    this.usersRepo = options?.usersRepo ?? channelUsersRepo;
    this.sessionsRepo = options?.sessionsRepo ?? channelSessionsRepo;
    this.messagesRepo = new ChannelMessagesRepository();
    this.verificationService = options?.verificationService ?? getChannelVerificationService();
    this.dmPairingRequests = options?.dmPairingRequests ?? dmPairingRequestsRepo;

    // Subscribe to incoming messages from channel plugins
    this.subscribeToEvents();
  }

  // ==========================================================================
  // IChannelService Implementation
  // ==========================================================================

  async send(channelPluginId: string, message: ChannelOutgoingMessage): Promise<string> {
    const api = this.getChannel(channelPluginId);
    if (!api) {
      throw new Error(`Channel plugin not found: ${channelPluginId}`);
    }

    try {
      const messageId = await api.sendMessage(message);

      // Emit sent event
      try {
        const eventBus = getEventBus();
        eventBus.emit(
          createEvent(ChannelEvents.MESSAGE_SENT, 'channel', `channel-service`, {
            channelPluginId,
            platform: api.getPlatform(),
            platformMessageId: messageId,
            platformChatId: message.platformChatId,
          })
        );
      } catch (emitErr) {
        log.warn('EventBus not available for MESSAGE_SENT event', { error: emitErr });
      }

      return messageId;
    } catch (error) {
      // Emit error event
      try {
        const eventBus = getEventBus();
        eventBus.emit(
          createEvent(ChannelEvents.MESSAGE_SEND_ERROR, 'channel', 'channel-service', {
            channelPluginId,
            platform: api.getPlatform(),
            error: getErrorMessage(error),
            platformChatId: message.platformChatId,
          })
        );
      } catch (emitErr) {
        log.warn('EventBus not available for MESSAGE_SEND_ERROR event', { error: emitErr });
      }
      throw error;
    }
  }

  async broadcast(
    platform: ChannelPlatform,
    message: ChannelOutgoingMessage
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const channels = this.getChannelPlugins().filter((p) => getChannelPlatform(p) === platform);

    for (const plugin of channels) {
      try {
        const api = getChannelApi(plugin);
        const messageId = await api.sendMessage(message);
        results.set(plugin.manifest.id, messageId);
      } catch (error) {
        log.error(`Failed to send to ${plugin.manifest.id}`, {
          pluginId: plugin.manifest.id,
          error,
        });
      }
    }

    return results;
  }

  async broadcastAll(message: ChannelOutgoingMessage): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const channels = this.getChannelPlugins();

    for (const plugin of channels) {
      try {
        const api = getChannelApi(plugin);
        if (api.getStatus() === 'connected') {
          const messageId = await api.sendMessage(message);
          results.set(plugin.manifest.id, messageId);
        }
      } catch (error) {
        log.error(`Failed to send to ${plugin.manifest.id}`, {
          pluginId: plugin.manifest.id,
          error,
        });
      }
    }

    return results;
  }

  getChannel(channelPluginId: string): ChannelPluginAPI | undefined {
    const plugin = this.pluginRegistry.get(channelPluginId);
    if (plugin && isChannelPlugin(plugin)) {
      return getChannelApi(plugin);
    }
    return undefined;
  }

  listChannels(): ChannelPluginInfo[] {
    return this.getChannelPlugins().map((plugin) => {
      const api = getChannelApi(plugin);
      return {
        pluginId: plugin.manifest.id,
        platform: getChannelPlatform(plugin),
        name: plugin.manifest.name,
        status: api.getStatus(),
        icon: plugin.manifest.icon,
      };
    });
  }

  getByPlatform(platform: ChannelPlatform): ChannelPluginAPI[] {
    return this.getChannelPlugins()
      .filter((p) => getChannelPlatform(p) === platform)
      .map(getChannelApi);
  }

  async connect(channelPluginId: string): Promise<void> {
    const api = this.getChannel(channelPluginId);
    if (!api) {
      throw new Error(`Channel plugin not found: ${channelPluginId}`);
    }

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          ChannelEvents.CONNECTING,
          'channel',
          'channel-service',
          {
            channelPluginId,
            platform: api.getPlatform(),
            status: 'connecting',
          }
        )
      );
    } catch (emitErr) {
      log.warn('EventBus not available for CONNECTING event', { error: emitErr });
    }

    await api.connect();

    // Upsert channels row so channel_messages FK constraint is satisfied
    const plugin = this.pluginRegistry.get(channelPluginId);
    try {
      await channelsRepo.upsert({
        id: channelPluginId,
        type: api.getPlatform(),
        name: plugin?.manifest.name ?? channelPluginId,
        status: 'connected',
      });
    } catch (err) {
      log.warn('Failed to upsert channel row', { channelPluginId, error: err });
    }

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          ChannelEvents.CONNECTED,
          'channel',
          'channel-service',
          {
            channelPluginId,
            platform: api.getPlatform(),
            status: 'connected',
          }
        )
      );
    } catch (emitErr) {
      log.warn('EventBus not available for CONNECTED event', { error: emitErr });
    }

    // Broadcast connection status to WebSocket clients
    wsGateway.broadcast('channel:status', {
      channelId: channelPluginId,
      status: 'connected',
    });
  }

  async disconnect(channelPluginId: string): Promise<void> {
    const api = this.getChannel(channelPluginId);
    if (!api) {
      throw new Error(`Channel plugin not found: ${channelPluginId}`);
    }

    await api.disconnect();

    // Update channel status in DB
    try {
      await channelsRepo.updateStatus(channelPluginId, 'disconnected');
    } catch (err) {
      log.warn('Failed to update channel status', { channelPluginId, error: err });
    }

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          ChannelEvents.DISCONNECTED,
          'channel',
          'channel-service',
          {
            channelPluginId,
            platform: api.getPlatform(),
            status: 'disconnected',
          }
        )
      );
    } catch (emitErr) {
      log.warn('EventBus not available for DISCONNECTED event', { error: emitErr });
    }

    // Broadcast disconnection status to WebSocket clients
    wsGateway.broadcast('channel:status', {
      channelId: channelPluginId,
      status: 'disconnected',
    });
  }

  async logout(channelPluginId: string): Promise<void> {
    const api = this.getChannel(channelPluginId);
    if (!api) {
      throw new Error(`Channel plugin not found: ${channelPluginId}`);
    }

    // Use logout() if available (clears session), otherwise fall back to disconnect()
    if (typeof api.logout === 'function') {
      await api.logout();
    } else {
      await api.disconnect();
    }

    // Update channel status in DB
    try {
      await channelsRepo.updateStatus(channelPluginId, 'disconnected');
    } catch (err) {
      log.warn('Failed to update channel status', { channelPluginId, error: err });
    }

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelConnectionEventData>(
          ChannelEvents.DISCONNECTED,
          'channel',
          'channel-service',
          {
            channelPluginId,
            platform: api.getPlatform(),
            status: 'disconnected',
          }
        )
      );
    } catch (emitErr) {
      log.warn('EventBus not available for DISCONNECTED event', { error: emitErr });
    }

    wsGateway.broadcast('channel:status', {
      channelId: channelPluginId,
      status: 'disconnected',
    });
  }

  async resolveUser(platform: ChannelPlatform, platformUserId: string): Promise<string | null> {
    return this.verificationService.resolveUser(platform, platformUserId);
  }

  /**
   * Auto-connect all channel plugins that have valid configuration.
   * Fire-and-forget — errors are logged but don't block boot.
   */
  async autoConnectChannels(): Promise<void> {
    const channels = this.getChannelPlugins();

    for (const plugin of channels) {
      const api = getChannelApi(plugin);
      const manifest = plugin.manifest;

      // Skip already-connected channels
      if (api.getStatus() === 'connected') continue;

      // Check if the required service has a configured API key
      const requiredServices = manifest.requiredServices as Array<{ name: string }> | undefined;
      if (!requiredServices || requiredServices.length === 0) continue;

      const serviceName = requiredServices[0]!.name;

      if (!getConfigCenter().isServiceAvailable(serviceName)) {
        log.debug('Skipping auto-connect (service not configured)', {
          pluginId: manifest.id,
          service: serviceName,
        });
        continue;
      }

      try {
        log.info('Auto-connecting channel...', { pluginId: manifest.id });
        await this.connect(manifest.id);
        log.info('Channel auto-connected', { pluginId: manifest.id });
      } catch (error) {
        log.warn('Channel auto-connect failed', {
          pluginId: manifest.id,
          error: getErrorMessage(error),
        });

        // Broadcast error status so UI can display the failure
        wsGateway.broadcast('channel:status', {
          channelId: manifest.id,
          status: 'error',
          error: getErrorMessage(error),
        });
      }
    }
  }

  // ==========================================================================
  // Message Processing Pipeline
  // ==========================================================================

  /**
   * Process an incoming channel message.
   * This is the main pipeline: auth check -> session lookup -> AI routing.
   */
  async processIncomingMessage(message: ChannelIncomingMessage): Promise<void> {
    try {
      // 0. Drop floods before any DB/LLM work. A single sender cannot exhaust
      //    resources by spamming — see isFlooding() for the sliding window.
      if (this.isFlooding(message.channelPluginId, message.sender.platformUserId)) {
        return;
      }

      // 1. Find or create channel user
      const channelUser = await this.usersRepo.findOrCreate({
        platform: message.platform,
        platformUserId: message.sender.platformUserId,
        displayName: message.sender.displayName,
        platformUsername: message.sender.username,
        avatarUrl: message.sender.avatarUrl,
      });

      // 1b. Emit first_seen event for new users
      if (channelUser.created) {
        try {
          const eventBus = getEventBus();
          eventBus.emit(
            createEvent<ChannelUserFirstSeenData>(
              ChannelEvents.USER_FIRST_SEEN,
              'channel',
              'channel-service',
              {
                platform: message.platform,
                user: message.sender,
                channelPluginId: message.channelPluginId,
              }
            )
          );
        } catch {
          // EventBus not initialized yet
        }
      }

      // 2. Check if blocked
      if (channelUser.isBlocked) {
        log.info('Blocked user message ignored', {
          displayName: message.sender.displayName,
          platform: message.platform,
        });
        return;
      }

      // 2b. Group messages: save to DB + broadcast but skip AI routing (anti-ban: no auto-reply to groups)
      if (message.metadata?.isGroup === true) {
        try {
          await this.messagesRepo.create({
            id: message.id,
            channelId: message.channelPluginId,
            externalId: message.metadata?.platformMessageId?.toString(),
            direction: 'inbound',
            senderId: message.sender.platformUserId,
            senderName: message.sender.displayName,
            content: message.text,
            contentType:
              message.attachments && message.attachments.length > 0 ? 'attachment' : 'text',
            attachments: message.attachments?.map((a) => ({
              type: a.type,
              url: a.url,
              assetId: a.assetId,
              path: a.path,
              mimeType: a.mimeType,
              size: a.size,
              name: a.filename,
              expiresAt: a.expiresAt,
            })),
            replyToId: message.replyToId,
            metadata: message.metadata,
          });
        } catch (error) {
          log.warn('Failed to save group message', { error });
        }

        wsGateway.broadcast('channel:message', {
          id: message.id,
          channelId: message.channelPluginId,
          channelType: message.platform,
          sender: message.sender.displayName,
          content: message.text,
          timestamp: message.timestamp.toISOString(),
          direction: 'incoming',
        });

        log.info('Group message saved to DB (AI routing skipped)', {
          platform: message.platform,
          chatId: message.platformChatId,
        });
        return;
      }

      // 3. Handle /connect — pairing key claim takes priority over everything
      if (message.text.startsWith('/connect ')) {
        const submittedKey = message.text.slice('/connect '.length).trim();
        await this.handleConnectCommand(message, channelUser.id, submittedKey);
        return;
      }

      // 3a. Handle /clear — deactivate session so next message starts fresh
      if (message.text.trim() === '/clear') {
        await this.handleClearCommand(message, channelUser.id);
        return;
      }

      // 3b. Owner check — only the claimed owner gets AI responses.
      //     Non-owners get the DM pairing flow: generate code, notify owner.
      const ownerUserId = await getOwnerUserId(message.platform);
      if (ownerUserId !== null) {
        // Owner IS claimed — check if sender is the owner
        if (message.sender.platformUserId !== ownerUserId) {
          // Non-owner: check if pending approval
          const pendingSenders = await this.getPendingSenders(message.platform);
          if (pendingSenders.has(message.sender.platformUserId)) {
            // Pending — generate code, notify owner, store as pending
            const code = await this.generateDmPairingCode(
              message.channelPluginId,
              message.platform,
              message.sender.platformUserId,
              ownerUserId
            );
            log.info('DM pairing code sent to owner for pending sender', {
              platform: message.platform,
              sender: message.sender.platformUserId,
              code,
            });
          } else {
            // Not pending — drop silently
            log.debug('Dropping message from non-owner, non-pending sender', {
              platform: message.platform,
              sender: message.sender.platformUserId,
            });
          }
          return;
        }
      } else {
        // No owner claimed yet.
        // WhatsApp self-chat: the Baileys `fromMe` filter already guarantees only the
        // account owner can reach this point via self-chat, so auto-claim them.
        if (message.platform === 'whatsapp') {
          const api = this.getChannel(message.channelPluginId);
          const botInfo = api?.getBotInfo?.();
          const botPhone = botInfo?.username ?? '';
          if (botPhone && message.sender.platformUserId === botPhone) {
            await autoClaimOwnership(
              message.channelPluginId,
              message.platform,
              message.sender.platformUserId,
              message.platformChatId
            );
            log.info('Auto-claimed WhatsApp owner from self-chat', {
              userId: message.sender.platformUserId,
            });
            // Fall through — process this message normally
          } else {
            // fromMe=false message from another person before owner is set — just drop
            log.debug('Dropping WhatsApp message from non-owner (no claim yet)', {
              sender: message.sender.platformUserId,
              botPhone,
            });
            return;
          }
        } else {
          // Telegram/other: the channel is unclaimed. SECURITY: never disclose the
          // pairing key in-band — anyone who messages an unclaimed bot would receive
          // it and could claim ownership of the assistant. The key is shown only on
          // the server console (startup banner) and the authenticated web UI; the
          // owner claims with `/connect <key>` from there.
          log.info('No owner claimed yet — prompting owner to claim from console', {
            platform: message.platform,
            sender: message.sender.platformUserId,
          });
          const api = this.getChannel(message.channelPluginId);
          if (api) {
            try {
              await api.sendMessage({
                platformChatId: message.platformChatId,
                text:
                  `👋 This OwnPilot assistant has not been activated yet.\n\n` +
                  `If you are the owner, open the OwnPilot console or web UI (Channels) ` +
                  `to get your pairing key, then send:\n/connect YOUR-KEY`,
              });
            } catch (err) {
              log.warn('Failed to send activation notice', { error: getErrorMessage(err) });
            }
          }
          return;
        }
      }

      // 4. Check verification — whitelist, approval code, or admin approval
      if (!channelUser.isVerified) {
        if (message.platform === 'whatsapp') {
          // Owner confirmed above — auto-verify
          const verificationSvc = getChannelVerificationService();
          await verificationSvc.verifyViaWhitelist(
            message.platform,
            message.sender.platformUserId,
            message.sender.displayName
          );
          channelUser.isVerified = true;
          log.info('Auto-verified WhatsApp owner', {
            userId: message.sender.platformUserId,
          });
        } else {
          const plugin = this.pluginRegistry.get(message.channelPluginId);
          const allowedUsers = plugin ? this.getPluginAllowedUsers(plugin) : [];
          const approvalCode = plugin ? this.getPluginApprovalCode(plugin) : null;

          // (a) Explicitly whitelisted in Config Center → auto-verify
          const isWhitelisted = allowedUsers.includes(message.sender.platformUserId);

          if (isWhitelisted) {
            const verificationSvc = getChannelVerificationService();
            await verificationSvc.verifyViaWhitelist(
              message.platform,
              message.sender.platformUserId,
              message.sender.displayName
            );
            channelUser.isVerified = true;
            log.info('Auto-verified user', {
              platform: message.platform,
              userId: message.sender.platformUserId,
              reason: 'whitelisted',
            });
          } else if (approvalCode) {
            // (b) Approval code configured — challenge-response verification
            // AUTH-007: count failed attempts per sender; block after MAX_APPROVAL_ATTEMPTS
            const attemptKey = `${message.platform}:${message.sender.platformUserId}`;
            const attempts = this.approvalAttemptCounts.get(attemptKey) ?? 0;
            if (attempts >= ChannelServiceImpl.MAX_APPROVAL_ATTEMPTS) {
              // Block the sender after too many wrong guesses. Drop the counter
              // entry too — block() is final state (the isBlocked check at the
              // top of processIncomingMessage catches future attempts), so the
              // counter for this attacker is dead weight that would otherwise
              // grow the map unboundedly.
              await this.usersRepo.block(channelUser.id);
              this.approvalAttemptCounts.delete(attemptKey);
              const api = this.getChannel(message.channelPluginId);
              if (api) {
                await api.sendMessage({
                  platformChatId: message.platformChatId,
                  text: 'Too many failed attempts. Please contact the admin.',
                  replyToId: message.id,
                });
              }
              log.warn('Blocked channel user after max approval attempts', {
                platform: message.platform,
                userId: message.sender.platformUserId,
              });
              return;
            }
            const submittedCode = Buffer.from(message.text.trim());
            const expectedCode = Buffer.from(approvalCode);
            const codeMatches =
              submittedCode.length === expectedCode.length &&
              timingSafeEqual(submittedCode, expectedCode);
            if (codeMatches) {
              // Correct code → approve
              const verificationSvc = getChannelVerificationService();
              await verificationSvc.verifyViaWhitelist(
                message.platform,
                message.sender.platformUserId,
                message.sender.displayName
              );
              channelUser.isVerified = true;
              // Clear failed-attempt counter on success
              this.approvalAttemptCounts.delete(attemptKey);
              log.info('Auto-verified user via approval code', {
                platform: message.platform,
                userId: message.sender.platformUserId,
              });

              const api = this.getChannel(message.channelPluginId);
              if (api) {
                await api.sendMessage({
                  platformChatId: message.platformChatId,
                  text: 'Access granted! You can now chat with the AI assistant.',
                  replyToId: message.id,
                });
              }
            } else {
              // Wrong code → reject and count the failed attempt
              this.approvalAttemptCounts.set(attemptKey, attempts + 1);
              const api = this.getChannel(message.channelPluginId);
              if (api) {
                await api.sendMessage({
                  platformChatId: message.platformChatId,
                  text: 'Please send the approval code to get access to this bot.',
                  replyToId: message.id,
                });
              }
              return;
            }
          } else {
            // (c) No code configured — require admin approval via UI
            const api = this.getChannel(message.channelPluginId);
            if (api) {
              await api.sendMessage({
                platformChatId: message.platformChatId,
                text: 'Your message has been received. An admin needs to approve your access.',
                replyToId: message.id,
              });
            }

            // Emit pending user event via EventBus
            try {
              const eventBus = getEventBus();
              eventBus.emit(
                createEvent<ChannelUserPendingData>(
                  ChannelEvents.USER_PENDING,
                  'channel',
                  'channel-service',
                  {
                    platform: message.platform,
                    platformUserId: message.sender.platformUserId,
                    displayName: message.sender.displayName,
                    channelPluginId: message.channelPluginId,
                  }
                )
              );
            } catch {
              // EventBus not initialized yet
            }

            return;
          }
        } // end else (non-whatsapp verification)
      }

      // 5. Save incoming message (conversationId wired after session creation below)
      let savedInboundId: string | undefined;
      try {
        await this.messagesRepo.create({
          id: message.id,
          channelId: message.channelPluginId,
          externalId: message.metadata?.platformMessageId?.toString(),
          direction: 'inbound',
          senderId: message.sender.platformUserId,
          senderName: message.sender.displayName,
          content: message.text,
          contentType:
            message.attachments && message.attachments.length > 0 ? 'attachment' : 'text',
          attachments: message.attachments?.map((a) => ({
            type: a.type,
            url: a.url,
            assetId: a.assetId,
            path: a.path,
            mimeType: a.mimeType,
            size: a.size,
            name: a.filename,
            expiresAt: a.expiresAt,
          })),
          replyToId: message.replyToId,
          metadata: message.metadata,
        });
        savedInboundId = message.id;
      } catch (error) {
        log.warn('Failed to save incoming message', { error });
      }

      // 5b. Broadcast incoming message to WebSocket clients
      // Flat shape — matches what RealtimeBridge expects ({ sender, content })
      wsGateway.broadcast('channel:message', {
        id: message.id,
        channelId: message.channelPluginId,
        channelType: message.platform,
        sender: message.sender.displayName,
        content: message.text,
        timestamp: message.timestamp.toISOString(),
        direction: 'incoming',
      });

      // 5c. System notification for new message
      wsGateway.broadcast('system:notification', {
        type: 'info',
        message: `New message from ${message.sender.displayName} on ${message.platform}`,
        action: 'channel:message',
      });

      // 5d. Forward to any configured cross-channel bridges (best-effort,
      //     fire-and-forget — never blocks or fails the AI reply path).
      void bridgeIncomingMessage(message).catch((err) => {
        log.debug('Bridge forwarding error', { error: err });
      });

      // 6. Find or create session -> conversation (serialized per chat to prevent duplicates)
      const sessionLockKey = `${channelUser.id}:${message.channelPluginId}:${message.platformChatId}`;
      const session = await this.withSessionLock(sessionLockKey, async () => {
        const existing = await this.sessionsRepo.findActive(
          channelUser.id,
          message.channelPluginId,
          message.platformChatId
        );
        if (existing) return existing;

        // Create a new conversation in the agent's in-memory ConversationMemory
        // so that loadConversation() can find it later for context continuity
        const { getOrCreateChatAgent } = await import('../services/agent/service.js');
        const routing = await getLLMRouter().pick({ process: 'channel' });
        const fallback =
          routing.fallbackProvider && routing.fallbackModel
            ? { provider: routing.fallbackProvider, model: routing.fallbackModel }
            : undefined;
        const agent = await getOrCreateChatAgent(
          routing.provider ?? 'openai',
          routing.model ?? 'gpt-4o',
          fallback
        );
        const systemPrompt = agent.getConversation().systemPrompt;
        const conv = agent.getMemory().create(systemPrompt);
        const conversationId = conv.id;

        // Also persist to DB for audit/history
        const { createConversationsRepository } =
          await import('../db/repositories/chat/conversations.js');
        const conversationsRepo = createConversationsRepository();
        await conversationsRepo.create({
          id: conversationId,
          agentName: 'default',
          metadata: {
            source: 'channel',
            platform: message.platform,
            channelUserId: channelUser.id,
            ownpilotUserId: channelUser.ownpilotUserId,
            displayName: message.sender.displayName,
          },
        });

        return this.sessionsRepo.create({
          channelUserId: channelUser.id,
          channelPluginId: message.channelPluginId,
          platformChatId: message.platformChatId,
          conversationId,
        });
      });

      // Touch last message
      await this.sessionsRepo.touchLastMessage(session.id);

      // Back-fill conversation_id on the inbound channel_message saved above
      if (savedInboundId && session.conversationId) {
        this.messagesRepo
          .linkConversation(savedInboundId, session.conversationId)
          .catch((err) => log.warn('Failed to backfill inbound conversation_id', { error: err }));
      }

      const assetIds =
        message.attachments
          ?.map((attachment) => attachment.assetId)
          .filter(
            (assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0
          ) ?? [];
      if (session.conversationId && assetIds.length > 0) {
        channelAssetStore
          .linkConversation(assetIds, session.conversationId)
          .catch((err) =>
            log.warn('Failed to link channel assets to conversation', { error: err })
          );
      }

      // Register/touch in unified ISessionService
      const sessionSvc = tryGetSessionService();
      if (sessionSvc) {
        const unified = sessionSvc.getOrCreate({
          userId: channelUser.ownpilotUserId,
          source: 'channel',
          channelPluginId: message.channelPluginId,
          platformChatId: message.platformChatId,
        });
        if (session.conversationId) {
          sessionSvc.linkConversation(unified.id, session.conversationId);
        }
      }

      // 7. Route to AI agent
      const api = this.getChannel(message.channelPluginId);
      if (!api) return;

      // Create progress manager if channel supports it
      type ProgressCapableAPI = typeof api & {
        createProgressManager?(chatId: string): {
          start(text?: string): Promise<string>;
          update(text: string): void;
          finish(text: string): Promise<string>;
          cancel(): Promise<void>;
          getMessageId(): number | null;
        } | null;
        trackMessage?(platformMessageId: string, chatId: string): void;
        shouldReplyWithVoice?(message: ChannelIncomingMessage): Promise<boolean> | boolean;
      };
      const progressApi = api as ProgressCapableAPI;
      const progress =
        typeof progressApi.createProgressManager === 'function'
          ? progressApi.createProgressManager(message.platformChatId)
          : null;
      const replyWithVoice =
        typeof progressApi.shouldReplyWithVoice === 'function'
          ? await progressApi.shouldReplyWithVoice(message)
          : false;

      if (progress && !replyWithVoice) {
        // Send "Thinking..." progress message instead of typing indicator
        await progress.start();
      } else if (api.sendTyping) {
        // Fallback: plain typing indicator
        await api.sendTyping(message.platformChatId).catch((err) => {
          log.debug('Typing indicator failed', { plugin: message.channelPluginId, error: err });
        });
      }

      let responseText: string;

      // Try MessageBus pipeline first
      const bus = tryGetMessageBus();
      if (bus) {
        responseText = await this.processViaBus(
          bus,
          message,
          {
            sessionId: session.id,
            conversationId: session.conversationId,
            context: session.context,
          },
          channelUser,
          progress ?? undefined
        );
      } else {
        // Legacy fallback: direct agent.chat()
        responseText = await this.processDirectAgent(message);
      }

      // 8. Send response (guard against empty text — Telegram rejects it)
      if (!responseText || !responseText.trim()) {
        responseText = '(No response generated)';
      }

      let sentMessageId: string;
      if (progress && !replyWithVoice) {
        // Replace progress message with final response
        sentMessageId = await progress.finish(responseText);
        // Track message ID for edit/delete support
        if (typeof progressApi.trackMessage === 'function') {
          progressApi.trackMessage(sentMessageId, message.platformChatId);
        }
      } else {
        if (progress && replyWithVoice) {
          await progress.cancel().catch((err) => {
            log.debug('Progress cancellation failed before voice reply', { error: err });
          });
        }
        sentMessageId = await api.sendMessage({
          platformChatId: message.platformChatId,
          text: responseText,
          replyToId: message.id,
          options: replyWithVoice ? { telegram: { asVoice: true } } : undefined,
        });
      }

      // Save outgoing message to channel_messages table
      // (bus persistence middleware handles the main messages table separately)
      try {
        await this.messagesRepo.create({
          id: `${message.channelPluginId}:${sentMessageId}`,
          channelId: message.channelPluginId,
          externalId: sentMessageId,
          direction: 'outbound',
          senderId: 'assistant',
          senderName: 'Assistant',
          content: responseText,
          contentType: 'text',
          replyToId: message.id,
          conversationId: session.conversationId ?? undefined,
          metadata: { ...message.metadata, platformChatId: message.platformChatId },
        });
      } catch (error) {
        log.warn('Failed to save outgoing message', { error });
      }

      // 8a. Broadcast outgoing message to WebSocket clients
      wsGateway.broadcast('channel:message', {
        id: `${message.channelPluginId}:${sentMessageId}`,
        channelId: message.channelPluginId,
        channelType: message.platform,
        sender: 'Assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        direction: 'outgoing',
      });

      log.info('Responded to user', {
        displayName: message.sender.displayName,
        platform: message.platform,
      });
    } catch (error) {
      log.error('Error processing message', { error });

      // Build a helpful error message
      const errMsg = getErrorMessage(error);
      const isProviderError = /provider|model|api.?key|unauthorized|401|no.*configured/i.test(
        errMsg
      );
      const userMessage = isProviderError
        ? 'No AI provider configured. Please set up an API key (e.g. OpenAI, Anthropic) in OwnPilot Settings or Config Center.'
        : 'Sorry, I encountered an internal error. Please try again.';

      // Try to send error reply
      try {
        const api = this.getChannel(message.channelPluginId);
        if (api) {
          await api.sendMessage({
            platformChatId: message.platformChatId,
            text: userMessage,
            replyToId: message.id,
          });
        }
      } catch {
        // Best-effort error reply — original error already logged above
      }
    }
  }

  // ==========================================================================
  // Private Methods — AI Routing (delegated to channel-ai-routing.ts)
  // ==========================================================================

  private async processViaBus(
    bus: IMessageBus,
    message: ChannelIncomingMessage,
    session: {
      sessionId: string;
      conversationId: string | null;
      context?: Record<string, unknown>;
    },
    channelUser: { ownpilotUserId: string },
    progress?: { update(text: string): void }
  ): Promise<string> {
    return processViaBusImpl(
      bus,
      message,
      session,
      channelUser,
      {
        sessionsRepo: this.sessionsRepo,
        getChannel: (id) => this.getChannel(id),
      },
      progress
    );
  }

  private async processDirectAgent(message: ChannelIncomingMessage): Promise<string> {
    return processDirectAgentImpl(message);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Serialize async operations per key to prevent race conditions.
   * Different keys run concurrently; same key waits for prior call.
   */
  private async withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionLocks.get(key);
    let resolve: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    this.sessionLocks.set(key, gate);
    try {
      if (prev) await prev;
      return await fn();
    } finally {
      resolve!();
      // Only delete if we're still the latest lock for this key
      if (this.sessionLocks.get(key) === gate) {
        this.sessionLocks.delete(key);
      }
    }
  }

  private getChannelPlugins(): Plugin[] {
    return this.pluginRegistry.getAll().filter((p) => p.status === 'enabled' && isChannelPlugin(p));
  }

  /**
   * Get allowed user IDs from a channel plugin's Config Center entry.
   */
  private getPluginAllowedUsers(plugin: Plugin): string[] {
    const requiredServices = plugin.manifest.requiredServices as
      | Array<{ name: string }>
      | undefined;
    if (!requiredServices || requiredServices.length === 0) return [];

    const serviceName = requiredServices[0]!.name;
    const entry = getConfigCenter().getConfigEntry(serviceName);
    const raw = entry?.data?.allowed_users;
    if (typeof raw !== 'string' || !raw.trim()) return [];

    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Get the approval code from a channel plugin's Config Center entry.
   * Returns null if not configured.
   */
  private getPluginApprovalCode(plugin: Plugin): string | null {
    const requiredServices = plugin.manifest.requiredServices as
      | Array<{ name: string }>
      | undefined;
    if (!requiredServices || requiredServices.length === 0) return null;

    const serviceName = requiredServices[0]!.name;
    const entry = getConfigCenter().getConfigEntry(serviceName);
    const raw = entry?.data?.approval_code;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    return raw.trim();
  }

  private async handleClearCommand(
    message: ChannelIncomingMessage,
    channelUserId: string
  ): Promise<void> {
    const api = this.getChannel(message.channelPluginId);
    const cleared = await clearChannelSession(
      channelUserId,
      message.channelPluginId,
      message.platformChatId
    );
    if (cleared) {
      log.info('Channel session cleared via /clear', { platform: message.platform });
    }
    if (api) {
      await api.sendMessage({
        platformChatId: message.platformChatId,
        text: cleared
          ? '🧹 Conversation cleared. Your next message starts a fresh session.'
          : '⚠️ No active session to clear. Send a message to start one.',
        replyToId: message.id,
      });
    }
  }

  private async handleConnectCommand(
    message: ChannelIncomingMessage,
    _channelUserId: string,
    submittedKey: string
  ): Promise<void> {
    const api = this.getChannel(message.channelPluginId);

    // Try pairing key claim first
    const claim = await claimOwnership(
      message.channelPluginId,
      message.platform,
      message.sender.platformUserId,
      message.platformChatId,
      submittedKey
    );

    if (claim.success) {
      log.info('Owner claimed via pairing key', {
        platform: message.platform,
        userId: message.sender.platformUserId,
      });
      if (api) {
        await api.sendMessage({
          platformChatId: message.platformChatId,
          text: `✅ Ownership confirmed! You are now the owner of this OwnPilot channel. You can start chatting with the AI assistant.`,
          replyToId: message.id,
        });
      }
      return;
    }

    if (claim.alreadyClaimed) {
      // Platform already has an owner — try old token-based verification
      // so users the owner shared access with can still connect
      const tokenResult = await this.verificationService.verifyToken(
        submittedKey,
        message.platform,
        message.sender.platformUserId,
        message.sender.displayName,
        message.sender.username
      );
      if (api) {
        await api.sendMessage({
          platformChatId: message.platformChatId,
          text: tokenResult.success
            ? `Verified! You are now connected as an OwnPilot user.`
            : `Verification failed. Please try again with a valid token.`,
          replyToId: message.id,
        });
      }
      return;
    }

    // Wrong pairing key — send hint
    if (api) {
      await api.sendMessage({
        platformChatId: message.platformChatId,
        text: `Invalid key. Please check the OwnPilot console for the correct pairing key and try again with /connect YOUR-KEY`,
        replyToId: message.id,
      });
    }
  }

  private subscribeToEvents(): void {
    try {
      const eventBus = getEventBus();

      // Listen for incoming messages from all channel plugins
      const unsub = eventBus.on<ChannelMessageReceivedData>(
        ChannelEvents.MESSAGE_RECEIVED,
        (event) => {
          const data = event.data;
          // Process asynchronously - don't block the event handler
          this.processIncomingMessage(data.message).catch((error) => {
            log.error('Failed to process incoming message', { error });
          });
        }
      );
      this.unsubscribes.push(unsub);

      // Listen for admin-approved users — send welcome message via their channel
      const unsubVerified = eventBus.on<ChannelUserVerifiedData>(
        'channel.user.verified',
        (event) => {
          const data = event.data;
          if (data.verificationMethod !== 'admin') return;

          this.sendApprovalNotification(data.platform, data.platformUserId).catch((err) => {
            log.warn('Failed to send approval notification', { error: err });
          });
        }
      );
      this.unsubscribes.push(unsubVerified);

      log.info('Subscribed to channel events');
    } catch {
      // EventBus not initialized yet - will be wired later
      log.info('EventBus not ready, events will be subscribed later');
    }
  }

  /**
   * Send a welcome message to a newly approved user via their channel.
   */
  private async sendApprovalNotification(platform: string, platformUserId: string): Promise<void> {
    const channelPlugins = this.getChannelPlugins().filter(
      (p) => getChannelPlatform(p) === platform
    );

    for (const plugin of channelPlugins) {
      const api = getChannelApi(plugin);
      if (api.getStatus() !== 'connected') continue;

      try {
        await api.sendMessage({
          platformChatId: platformUserId,
          text: 'You have been approved! You can now chat with the AI assistant.',
        });
        return; // Sent successfully — no need to try other plugins
      } catch (err) {
        log.debug('Failed to send approval notification via plugin', {
          pluginId: plugin.manifest.id,
          error: err,
        });
      }
    }
  }

  /**
   * Dispose event listeners. Call during shutdown to prevent leaks.
   */
  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.sessionLocks.clear();
    log.info('ChannelService disposed');
  }
  // ============================================================================
  // DM Pairing Security
  // ============================================================================

  /**
   * Get the set of platformUserIds that are pending approval for a platform.
   * Used to determine whether a non-owner DM gets the pairing flow.
   */
  private async getPendingSenders(platform: string): Promise<Set<string>> {
    const tokens = await this.dmPairingRequests.listPending(platform);
    return new Set(tokens.map((t) => t.platformUserId));
  }

  /**
   * Generate a 6-digit pairing code for a non-owner DM.
   * Stores the code in verification_tokens and notifies the owner via WS.
   */
  private async generateDmPairingCode(
    _pluginId: string,
    platform: string,
    senderUserId: string,
    _ownerUserId: string
  ): Promise<string> {
    // Generate 6-digit code. SECURITY (EXPOSE-004): use a CSPRNG — Math.random()
    // is a non-cryptographic PRNG whose internal state can be recovered from a
    // few observed outputs, making pairing codes predictable/brute-forceable.
    const code = String(randomInt(100000, 1000000));

    // Store in verification_tokens
    await this.dmPairingRequests.create({
      platform,
      platformUserId: senderUserId,
      code,
      expiresInMinutes: 10,
    });

    // Mark sender as pending
    const channelUser = await this.usersRepo.findByPlatform(platform, senderUserId);
    if (channelUser) {
      await this.usersRepo.updateStatus(channelUser.id, 'pending');
    }

    // Notify owner via WS
    wsGateway.broadcast('data:changed', {
      entity: 'dm-pairing' as const,
      action: 'pending' as const,
    });

    return code;
  }

  /**
   * Approve a pending DM sender by code.
   * Called via REST API from the owner's dashboard.
   */
  async approvePendingSender(
    platform: string,
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = await this.dmPairingRequests.findByCode(code, platform);
    if (!token) {
      return { success: false, error: 'Invalid or expired code.' };
    }

    // Mark token as used
    await this.dmPairingRequests.markUsed(token.id);

    // Update channel user status to active
    const channelUser = await this.usersRepo.findByPlatform(platform, token.platformUserId);
    if (channelUser) {
      await this.usersRepo.updateStatus(channelUser.id, 'active');
    }

    // Verify the user
    if (channelUser) {
      await this.usersRepo.markVerified(channelUser.id, 'default', 'admin');
    }

    log.info('Pending sender approved via DM pairing code', {
      platform,
      senderUserId: token.platformUserId,
      code,
    });

    return { success: true };
  }

  /**
   * Deny a pending DM sender by platform+userId.
   */
  async denyPendingSender(
    platform: string,
    platformUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = await this.dmPairingRequests.findValidToken(platform, platformUserId);
    if (token) {
      await this.dmPairingRequests.markUsed(token.id);
    }

    const channelUser = await this.usersRepo.findByPlatform(platform, platformUserId);
    if (channelUser) {
      await this.usersRepo.block(channelUser.id);
    }

    log.info('Pending sender denied', { platform, platformUserId });
    return { success: true };
  }

  /**
   * List all pending DM pairing requests for a platform.
   */
  async listPendingSenders(platform: string): Promise<
    Array<{
      platformUserId: string;
      displayName?: string;
      code: string;
      expiresAt: Date;
    }>
  > {
    const tokens = await this.dmPairingRequests.listPending(platform);
    const result = [];
    for (const token of tokens) {
      const channelUser = await this.usersRepo.findByPlatform(platform, token.platformUserId);
      result.push({
        platformUserId: token.platformUserId,
        displayName: channelUser?.displayName,
        code: token.code,
        expiresAt: token.expiresAt,
      });
    }
    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: ChannelServiceImpl | null = null;

export function createChannelServiceImpl(pluginRegistry: PluginRegistry): ChannelServiceImpl {
  _instance = new ChannelServiceImpl(pluginRegistry);
  return _instance;
}

export function getChannelServiceImpl(): ChannelServiceImpl | null {
  return _instance;
}
