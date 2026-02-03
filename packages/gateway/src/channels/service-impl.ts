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
import {
  getChannelVerificationService,
  type ChannelVerificationService,
} from './auth/verification.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelService');

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
              error: error instanceof Error ? error.message : String(error),
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
  }

  async resolveUser(
    platform: ChannelPlatform,
    platformUserId: string
  ): Promise<string | null> {
    return this.verificationService.resolveUser(platform, platformUserId);
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

      // 4. Check verification
      if (!channelUser.isVerified) {
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

      // 6. Find or create session -> conversation
      let session = await this.sessionsRepo.findActive(
        channelUser.id,
        message.channelPluginId,
        message.platformChatId
      );

      if (!session) {
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

        session = await this.sessionsRepo.create({
          channelUserId: channelUser.id,
          channelPluginId: message.channelPluginId,
          platformChatId: message.platformChatId,
          conversationId,
        });
      }

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

      // 8. Send response
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
          metadata: message.metadata,
        });
      } catch (error) {
        log.warn('Failed to save outgoing message', { error });
      }

      log.info('Responded to user', { displayName: message.sender.displayName, platform: message.platform });
    } catch (error) {
      log.error('Error processing message', { error });

      // Try to send error reply
      try {
        const api = this.getChannel(message.channelPluginId);
        if (api) {
          await api.sendMessage({
            platformChatId: message.platformChatId,
            text: 'Sorry, I encountered an error processing your message.',
            replyToId: message.id,
          });
        }
      } catch {
        // Ignore send errors
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
      return `[Demo Mode] I received your message: "${message.text.substring(0, 100)}"\n\nTo get real AI responses, configure an API key in OwnPilot settings.`;
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

    return result.response.content;
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
      return `[Demo Mode] I received your message: "${message.text.substring(0, 100)}"\n\nTo get real AI responses, configure an API key in OwnPilot settings.`;
    }

    const agent = await getOrCreateDefaultAgent();
    const result = await agent.chat(message.text);

    if (result.ok) {
      return result.value.content;
    }
    return `Sorry, I encountered an error: ${result.error.message}`;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getChannelPlugins(): Plugin[] {
    return this.pluginRegistry
      .getAll()
      .filter((p) => p.status === 'enabled' && isChannelPlugin(p));
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
        text: `Verification failed: ${result.error}\n\nPlease generate a new token in the OwnPilot web interface and try again with /connect YOUR_TOKEN`,
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
