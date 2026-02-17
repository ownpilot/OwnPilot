/**
 * ChannelServiceImpl
 *
 * Concrete implementation of IChannelService for the gateway.
 * Discovers channel plugins from PluginRegistry, routes messages
 * through EventBus, handles verification, and manages sessions.
 */

import { randomUUID } from 'node:crypto';
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
  getEventBus,
  createEvent,
  type PluginRegistry,
  type Plugin,
  hasServiceRegistry,
  getServiceRegistry,
  Services,
  type ISessionService,
  type IMessageBus,
  type NormalizedMessage,
} from '@ownpilot/core';

import {
  channelUsersRepo,
  type ChannelUsersRepository,
} from '../db/repositories/channel-users.js';
import {
  channelSessionsRepo,
  type ChannelSessionsRepository,
} from '../db/repositories/channel-sessions.js';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import {
  getChannelVerificationService,
  type ChannelVerificationService,
} from './auth/verification.js';
import { wsGateway } from '../ws/server.js';
import { truncate, getErrorMessage } from '../routes/helpers.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelService');

/** Generate the standard demo-mode reply. */
function demoModeReply(text: string): string {
  return `[Demo Mode] I received your message: "${truncate(text, 100)}"\n\nTo get real AI responses, configure an API key in OwnPilot settings.`;
}

/**
 * Try to get ISessionService from the registry.
 */
function tryGetSessionService(): ISessionService | null {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Session);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Try to get IMessageBus from the registry.
 */
function tryGetMessageBus(): IMessageBus | null {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.Message);
    } catch {
      return null;
    }
  }
  return null;
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
  private readonly pluginRegistry: PluginRegistry;
  private unsubscribes: Array<() => void> = [];
  private readonly sessionLocks = new Map<string, Promise<void>>();

  constructor(
    pluginRegistry: PluginRegistry,
    options?: {
      usersRepo?: ChannelUsersRepository;
      sessionsRepo?: ChannelSessionsRepository;
      verificationService?: ChannelVerificationService;
    }
  ) {
    this.pluginRegistry = pluginRegistry;
    this.usersRepo = options?.usersRepo ?? channelUsersRepo;
    this.sessionsRepo = options?.sessionsRepo ?? channelSessionsRepo;
    this.messagesRepo = new ChannelMessagesRepository();
    this.verificationService =
      options?.verificationService ?? getChannelVerificationService();

    // Subscribe to incoming messages from channel plugins
    this.subscribeToEvents();
  }

  // ==========================================================================
  // IChannelService Implementation
  // ==========================================================================

  async send(
    channelPluginId: string,
    message: ChannelOutgoingMessage
  ): Promise<string> {
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
          createEvent(
            ChannelEvents.MESSAGE_SENT,
            'channel',
            `channel-service`,
            {
              channelPluginId,
              platform: api.getPlatform(),
              platformMessageId: messageId,
              platformChatId: message.platformChatId,
            }
          )
        );
      } catch (emitErr) {
        log.debug('EventBus not available for MESSAGE_SENT event', { error: emitErr });
      }

      return messageId;
    } catch (error) {
      // Emit error event
      try {
        const eventBus = getEventBus();
        eventBus.emit(
          createEvent(
            ChannelEvents.MESSAGE_SEND_ERROR,
            'channel',
            'channel-service',
            {
              channelPluginId,
              platform: api.getPlatform(),
              error: getErrorMessage(error),
              platformChatId: message.platformChatId,
            }
          )
        );
      } catch (emitErr) {
        log.debug('EventBus not available for MESSAGE_SEND_ERROR event', { error: emitErr });
      }
      throw error;
    }
  }

  async broadcast(
    platform: ChannelPlatform,
    message: ChannelOutgoingMessage
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const channels = this.getChannelPlugins().filter(
      (p) => getChannelPlatform(p) === platform
    );

    for (const plugin of channels) {
      try {
        const api = getChannelApi(plugin);
        const messageId = await api.sendMessage(message);
        results.set(plugin.manifest.id, messageId);
      } catch (error) {
        log.error(`Failed to send to ${plugin.manifest.id}`, { pluginId: plugin.manifest.id, error });
      }
    }

    return results;
  }

  async broadcastAll(
    message: ChannelOutgoingMessage
  ): Promise<Map<string, string>> {
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
        log.error(`Failed to send to ${plugin.manifest.id}`, { pluginId: plugin.manifest.id, error });
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
      log.debug('EventBus not available for CONNECTING event', { error: emitErr });
    }

    await api.connect();

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
      log.debug('EventBus not available for CONNECTED event', { error: emitErr });
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
      log.debug('EventBus not available for DISCONNECTED event', { error: emitErr });
    }

    // Broadcast disconnection status to WebSocket clients
    wsGateway.broadcast('channel:status', {
      channelId: channelPluginId,
      status: 'disconnected',
    });
  }

  async resolveUser(
    platform: ChannelPlatform,
    platformUserId: string
  ): Promise<string | null> {
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
      const requiredServices = manifest.requiredServices as
        | Array<{ name: string }>
        | undefined;
      if (!requiredServices || requiredServices.length === 0) continue;

      const serviceName = requiredServices[0]!.name;

      if (!configServicesRepo.isAvailable(serviceName)) {
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
  async processIncomingMessage(
    message: ChannelIncomingMessage
  ): Promise<void> {
    try {
      // 1. Find or create channel user
      const channelUser = await this.usersRepo.findOrCreate({
        platform: message.platform,
        platformUserId: message.sender.platformUserId,
        displayName: message.sender.displayName,
        platformUsername: message.sender.username,
        avatarUrl: message.sender.avatarUrl,
      });

      // 2. Check if blocked
      if (channelUser.isBlocked) {
        log.info('Blocked user message ignored', { displayName: message.sender.displayName, platform: message.platform });
        return;
      }

      // 3. Handle /connect command for verification
      if (message.text.startsWith('/connect ')) {
        const token = message.text.slice('/connect '.length).trim();
        await this.handleConnectCommand(message, channelUser.id, token);
        return;
      }

      // 4. Check verification (auto-verify whitelisted users)
      if (!channelUser.isVerified) {
        // Check if user is in the plugin's allowed_users whitelist
        const plugin = this.pluginRegistry.get(message.channelPluginId);
        const allowedUsers = plugin
          ? this.getPluginAllowedUsers(plugin)
          : [];

        if (allowedUsers.length > 0 && allowedUsers.includes(message.sender.platformUserId)) {
          // Auto-verify: user is explicitly whitelisted in Config Center
          const verificationSvc = getChannelVerificationService();
          await verificationSvc.verifyViaWhitelist(
            message.platform,
            message.sender.platformUserId,
            message.sender.displayName,
          );
          // Update local reference so the rest of the pipeline proceeds
          channelUser.isVerified = true;
          log.info('Auto-verified whitelisted user', {
            platform: message.platform,
            userId: message.sender.platformUserId,
          });
        } else {
          // Send verification prompt
          const api = this.getChannel(message.channelPluginId);
          if (api) {
            await api.sendMessage({
              platformChatId: message.platformChatId,
              text: `Welcome! To use this assistant, you need to verify your identity.\n\nGenerate a verification token in the OwnPilot web interface, then send:\n/connect YOUR_TOKEN`,
              replyToId: message.id,
            });
          }
          return;
        }
      }

      // 5. Save incoming message
      try {
        await this.messagesRepo.create({
          id: message.id,
          channelId: message.channelPluginId,
          externalId: message.metadata?.platformMessageId?.toString(),
          direction: 'inbound',
          senderId: message.sender.platformUserId,
          senderName: message.sender.displayName,
          content: message.text,
          contentType: 'text',
          attachments: message.attachments?.map((a) => ({
            type: a.type,
            url: a.url ?? '',
            name: a.filename,
          })),
          replyToId: message.replyToId,
          metadata: message.metadata,
        });
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

      // 6. Find or create session -> conversation (serialized per chat to prevent duplicates)
      const sessionLockKey = `${channelUser.id}:${message.channelPluginId}:${message.platformChatId}`;
      const session = await this.withSessionLock(sessionLockKey, async () => {
        const existing = await this.sessionsRepo.findActive(
          channelUser.id,
          message.channelPluginId,
          message.platformChatId
        );
        if (existing) return existing;

        // Create a new conversation for this channel session
        const { createConversationsRepository } = await import(
          '../db/repositories/conversations.js'
        );
        const conversationsRepo = createConversationsRepository();
        const conversationId = randomUUID();
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

      // Send typing indicator (best-effort)
      if (api.sendTyping) {
        await api.sendTyping(message.platformChatId).catch((err) => {
          log.debug('Typing indicator failed', { plugin: message.channelPluginId, error: err });
        });
      }

      let responseText: string;

      // Try MessageBus pipeline first
      const bus = tryGetMessageBus();
      if (bus) {
        responseText = await this.processViaBus(bus, message, session, channelUser);
      } else {
        // Legacy fallback: direct agent.chat()
        responseText = await this.processDirectAgent(message);
      }

      // 8. Send response (guard against empty text — Telegram rejects it)
      if (!responseText || !responseText.trim()) {
        responseText = '(No response generated)';
      }
      const sentMessageId = await api.sendMessage({
        platformChatId: message.platformChatId,
        text: responseText,
        replyToId: message.id,
      });

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

      log.info('Responded to user', { displayName: message.sender.displayName, platform: message.platform });
    } catch (error) {
      log.error('Error processing message', { error });

      // Build a helpful error message
      const errMsg = getErrorMessage(error);
      const isProviderError = /provider|model|api.?key|unauthorized|401|no.*configured/i.test(errMsg);
      const userMessage = isProviderError
        ? 'No AI provider configured. Please set up an API key (e.g. OpenAI, Anthropic) in OwnPilot Settings or Config Center.'
        : `Sorry, I encountered an error: ${errMsg.substring(0, 200)}`;

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
  // Private Methods — Message Processing
  // ==========================================================================

  /**
   * Process a channel message through the MessageBus pipeline.
   * Returns the assistant's response text.
   */
  private async processViaBus(
    bus: IMessageBus,
    message: ChannelIncomingMessage,
    session: { conversationId: string | null },
    channelUser: { ownpilotUserId: string },
  ): Promise<string> {
    const { getOrCreateDefaultAgent, isDemoMode } = await import(
      '../routes/agents.js'
    );

    // Demo mode short-circuit (bus isn't needed for demo)
    if (await isDemoMode()) {
      return demoModeReply(message.text);
    }

    const agent = await getOrCreateDefaultAgent();

    // Resolve provider/model from agent config
    const { resolveProviderAndModel } = await import('../routes/settings.js');
    const resolved = await resolveProviderAndModel('default', 'default');

    // Normalize channel message into NormalizedMessage
    const normalized: NormalizedMessage = {
      id: message.id,
      sessionId: session.conversationId ?? randomUUID(),
      role: 'user',
      content: message.text,
      metadata: {
        source: 'channel',
        channelPluginId: message.channelPluginId,
        platform: message.platform,
        platformMessageId: message.metadata?.platformMessageId?.toString(),
        provider: resolved.provider ?? undefined,
        model: resolved.model ?? undefined,
        conversationId: session.conversationId ?? undefined,
        agentId: 'default',
      },
      timestamp: new Date(),
    };

    // Process through the pipeline with context
    const result = await bus.process(normalized, {
      context: {
        agent,
        userId: channelUser.ownpilotUserId,
        agentId: 'default',
        provider: resolved.provider ?? 'unknown',
        model: resolved.model ?? 'unknown',
        conversationId: session.conversationId,
      },
    });

    // Strip <memories> and <suggestions> tags from channel response
    const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
    const { content: stripped } = extractMemoriesFromResponse(result.response.content);
    return stripped.replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '').trimEnd();
  }

  /**
   * Legacy fallback: process directly via agent.chat() without the bus.
   */
  private async processDirectAgent(
    message: ChannelIncomingMessage,
  ): Promise<string> {
    const { getOrCreateDefaultAgent, isDemoMode } = await import(
      '../routes/agents.js'
    );

    if (await isDemoMode()) {
      return demoModeReply(message.text);
    }

    const agent = await getOrCreateDefaultAgent();
    const result = await agent.chat(message.text);

    if (result.ok) {
      // Strip <memories> and <suggestions> tags from channel response
      const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
      const { content: stripped } = extractMemoriesFromResponse(result.value.content);
      return stripped.replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '').trimEnd();
    }
    return `Sorry, I encountered an error: ${result.error.message}`;
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
    const gate = new Promise<void>(r => { resolve = r; });
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
    return this.pluginRegistry
      .getAll()
      .filter((p) => p.status === 'enabled' && isChannelPlugin(p));
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
    const entry = configServicesRepo.getDefaultEntry(serviceName);
    const raw = entry?.data?.allowed_users;
    if (typeof raw !== 'string' || !raw.trim()) return [];

    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  private async handleConnectCommand(
    message: ChannelIncomingMessage,
    channelUserId: string,
    token: string
  ): Promise<void> {
    const result = await this.verificationService.verifyToken(
      token,
      message.platform,
      message.sender.platformUserId,
      message.sender.displayName,
      message.sender.username
    );

    const api = this.getChannel(message.channelPluginId);
    if (!api) return;

    if (result.success) {
      await api.sendMessage({
        platformChatId: message.platformChatId,
        text: `Verified! You are now connected as an OwnPilot user. You can start chatting with the AI assistant.`,
        replyToId: message.id,
      });
    } else {
      await api.sendMessage({
        platformChatId: message.platformChatId,
        text: `Verification failed. Please generate a new token in the OwnPilot web interface and try again with /connect YOUR_TOKEN`,
        replyToId: message.id,
      });
    }
  }

  private subscribeToEvents(): void {
    try {
      const eventBus = getEventBus();

      // Listen for incoming messages from all channel plugins
      const unsub = eventBus.on<ChannelMessageReceivedData>(ChannelEvents.MESSAGE_RECEIVED, (event) => {
        const data = event.data;
        // Process asynchronously - don't block the event handler
        this.processIncomingMessage(data.message).catch((error) => {
          log.error('Failed to process incoming message', { error });
        });
      });
      this.unsubscribes.push(unsub);

      log.info('Subscribed to channel events');
    } catch {
      // EventBus not initialized yet - will be wired later
      log.info('EventBus not ready, events will be subscribed later');
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
    log.info('ChannelService disposed');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: ChannelServiceImpl | null = null;

export function createChannelServiceImpl(
  pluginRegistry: PluginRegistry
): ChannelServiceImpl {
  _instance = new ChannelServiceImpl(pluginRegistry);
  return _instance;
}

export function getChannelServiceImpl(): ChannelServiceImpl | null {
  return _instance;
}
