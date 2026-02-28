/**
 * WebSocket Gateway Server
 *
 * Central control plane for real-time communication
 */

import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Http2SecureServer, Http2Server } from 'node:http2';
import { timingSafeEqual } from 'node:crypto';
import {
  validateSession as validateUiSession,
  isPasswordConfigured,
} from '../services/ui-session.js';
import type { ClientEvents, WSMessage, Channel } from './types.js';
import { sessionManager } from './session.js';
import { ClientEventHandler } from './events.js';
import { getChannelService, getEventSystem } from '@ownpilot/core';
import { EventBusBridge, setEventBusBridge } from './event-bridge.js';
import type { ServerEvents } from './types.js';
import {
  WS_PORT,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_SESSION_TIMEOUT_MS,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_CONNECTIONS,
  WS_READY_STATE_OPEN,
} from '../config/defaults.js';
import { getOrCreateDefaultAgent, isDemoMode } from '../routes/agents.js';
import { getErrorMessage } from '../routes/helpers.js';
import { getLog } from '../services/log.js';

const log = getLog('WebSocket');

/**
 * Validate a WebSocket authentication token.
 * Reads API_KEYS from env (same keys used for HTTP auth).
 * Returns true if auth is disabled (no keys) or token is valid.
 */
function validateWsToken(token: string | null): boolean {
  // Check UI session token first
  if (token && validateUiSession(token)) return true;

  const apiKeys = process.env.API_KEYS?.split(',').filter(Boolean);

  if (!apiKeys || apiKeys.length === 0) {
    // No API keys configured — but if UI password is set, require a valid session token
    // (the check above already failed, so reject)
    if (isPasswordConfigured()) return false;
    return true;
  }

  // Auth enabled but no token provided
  if (!token) return false;
  // Timing-safe comparison against all valid keys
  const tokenBuf = Buffer.from(token);
  return apiKeys.some((key) => {
    const keyBuf = Buffer.from(key);
    return tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf);
  });
}

/** Whitelist of valid client event types (static set, avoid re-creating per message) */
const VALID_CLIENT_EVENTS = new Set<string>([
  'chat:send',
  'chat:stop',
  'chat:retry',
  'channel:connect',
  'channel:disconnect',
  'channel:subscribe',
  'channel:unsubscribe',
  'channel:send',
  'channel:list',
  'workspace:create',
  'workspace:switch',
  'workspace:delete',
  'workspace:list',
  'agent:configure',
  'agent:stop',
  'tool:cancel',
  'session:ping',
  'session:pong',
  'coding-agent:input',
  'coding-agent:resize',
  'coding-agent:subscribe',
  'event:subscribe',
  'event:unsubscribe',
  'event:publish',
]);

export interface WSGatewayConfig {
  /** Port for standalone WebSocket server (if not using HTTP upgrade) */
  port?: number;
  /** Path for WebSocket endpoint when using HTTP upgrade */
  path?: string;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
  /** Session timeout in ms */
  sessionTimeout?: number;
  /** Max message size in bytes */
  maxPayloadSize?: number;
  /** Maximum concurrent connections */
  maxConnections?: number;
  /** Allowed origins for WebSocket connections (empty = allow all) */
  allowedOrigins?: string[];
}

const DEFAULT_CONFIG: Required<WSGatewayConfig> = {
  port: WS_PORT,
  path: '/ws',
  heartbeatInterval: WS_HEARTBEAT_INTERVAL_MS,
  sessionTimeout: WS_SESSION_TIMEOUT_MS,
  maxPayloadSize: WS_MAX_PAYLOAD_BYTES,
  maxConnections: WS_MAX_CONNECTIONS,
  allowedOrigins: [],
};

/**
 * Validate WebSocket origin against allowed origins.
 * Returns true if origin is allowed or no restrictions are configured.
 */
function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  // No restrictions configured — allow all (self-hosted default)
  if (allowedOrigins.length === 0) return true;
  // No origin header — reject when restrictions are configured
  if (!origin) return false;
  return allowedOrigins.some((allowed) => origin === allowed);
}

/**
 * WebSocket Gateway Server
 */
export class WSGateway {
  private wss: WebSocketServer | null = null;
  private config: Required<WSGatewayConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private clientHandler = new ClientEventHandler();
  private httpServer: (HttpServer | HttpsServer | Http2Server | Http2SecureServer) | null = null;
  private upgradeHandler: ((...args: unknown[]) => void) | null = null;
  private eventBridge: EventBusBridge | null = null;
  private legacyUnsubs: (() => void)[] = [];

  constructor(config: WSGatewayConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupClientHandlers();
  }

  /**
   * Initialize and start the EventBusBridge.
   * Call after the server is set up.
   */
  startEventBridge(): EventBusBridge {
    if (this.eventBridge) return this.eventBridge;
    this.eventBridge = new EventBusBridge(sessionManager);
    this.eventBridge.start();
    setEventBusBridge(this.eventBridge);

    // Legacy event forwarding: translate EventBus dot-notation events to
    // colon-separated WS broadcasts for backward compatibility with existing UI
    this.setupLegacyEventForwarding();

    return this.eventBridge;
  }

  /**
   * Forward EventBus events as legacy colon-separated WS broadcasts.
   * This ensures existing UI components (RealtimeBridge.tsx) continue working
   * while the Event Monitor page receives dot-notation events via EventBusBridge.
   */
  private setupLegacyEventForwarding(): void {
    const eventSystem = getEventSystem();

    // trigger.success / trigger.failed → trigger:executed
    this.legacyUnsubs.push(
      eventSystem.onPattern('trigger.*', (event) => {
        if (event.type === 'trigger.success' || event.type === 'trigger.failed') {
          const d = event.data as Record<string, unknown>;
          this.broadcast('trigger:executed', {
            triggerId: d.triggerId as string,
            triggerName: d.triggerName as string,
            status: event.type === 'trigger.success' ? 'success' : 'failure',
            durationMs: d.durationMs as number,
            error: d.error as string | undefined,
          } as ServerEvents['trigger:executed']);
        }
      })
    );

    // pulse.* → pulse:activity
    this.legacyUnsubs.push(
      eventSystem.onPattern('pulse.*', (event) => {
        const d = event.data as Record<string, unknown>;
        const stageMap: Record<string, string> = {
          'pulse.started': 'started',
          'pulse.stage': 'stage',
          'pulse.completed': 'completed',
        };
        const status = stageMap[event.type] ?? event.type;
        this.broadcast('pulse:activity', {
          status,
          stage: (d.stage as string) ?? status,
          pulseId: d.pulseId ?? null,
          ...d,
        } as ServerEvents['pulse:activity']);
      })
    );

    // gateway.system.notification → system:notification
    this.legacyUnsubs.push(
      eventSystem.on('gateway.system.notification', (event) => {
        this.broadcast(
          'system:notification',
          event.data as ServerEvents['system:notification']
        );
      })
    );

    // gateway.data.changed → data:changed
    this.legacyUnsubs.push(
      eventSystem.onAny('gateway.data.changed', (event) => {
        this.broadcast('data:changed', event.data as ServerEvents['data:changed']);
      })
    );

    // background-agent.update → background-agent:update (colon for WS)
    this.legacyUnsubs.push(
      eventSystem.onAny('background-agent.update', (event) => {
        this.broadcast(
          'background-agent:update',
          event.data as ServerEvents['background-agent:update']
        );
      })
    );

    // channel.user.* → channel:user:* (pending, blocked, unblocked, verified, first_seen)
    this.legacyUnsubs.push(
      eventSystem.onPattern('channel.user.*', (event) => {
        const d = event.data as Record<string, unknown>;

        switch (event.type) {
          case 'channel.user.pending':
            this.broadcast('channel:user:pending', {
              channelId: (d.channelPluginId as string) ?? '',
              platform: (d.platform as string) ?? '',
              userId: '',
              platformUserId: (d.platformUserId as string) ?? '',
              displayName: d.displayName as string | undefined,
            });
            break;
          case 'channel.user.blocked':
            this.broadcast('channel:user:blocked', {
              channelId: (d.channelPluginId as string) ?? '',
              platform: (d.platform as string) ?? '',
              platformUserId: (d.platformUserId as string) ?? '',
            });
            break;
          case 'channel.user.unblocked':
            this.broadcast('channel:user:unblocked', {
              channelId: (d.channelPluginId as string) ?? '',
              platform: (d.platform as string) ?? '',
              platformUserId: (d.platformUserId as string) ?? '',
            });
            break;
          case 'channel.user.verified':
            this.broadcast('channel:user:verified', {
              channelId: '',
              platform: (d.platform as string) ?? '',
              platformUserId: (d.platformUserId as string) ?? '',
              ownpilotUserId: (d.ownpilotUserId as string) ?? '',
              verificationMethod: d.verificationMethod as string | undefined,
            });
            break;
          case 'channel.user.first_seen':
            this.broadcast('channel:user:first_seen', {
              channelId: (d.channelPluginId as string) ?? '',
              platform: (d.platform as string) ?? '',
              platformUserId: ((d.user as Record<string, unknown>)?.platformUserId as string) ?? '',
              displayName: ((d.user as Record<string, unknown>)?.displayName as string) ?? undefined,
            });
            break;
        }
      })
    );
  }

  /**
   * Start standalone WebSocket server
   */
  start(): void {
    if (this.wss) {
      throw new Error('WebSocket server already running');
    }

    this.wss = new WebSocketServer({
      port: this.config.port,
      maxPayload: this.config.maxPayloadSize,
    });

    this.setupServer();

    log.info('Gateway listening', { address: `ws://0.0.0.0:${this.config.port}` });
  }

  /**
   * Attach to existing HTTP server (upgrade handling)
   */
  attachToServer(server: HttpServer | HttpsServer | Http2Server | Http2SecureServer): void {
    if (this.wss) {
      throw new Error('WebSocket server already running');
    }

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxPayloadSize,
    });

    this.setupServer();

    // Handle HTTP upgrade requests (store handler for cleanup on stop)
    this.httpServer = server;
    this.upgradeHandler = (...args: unknown[]) => {
      const request = args[0] as IncomingMessage;
      const socket = args[1] as import('stream').Duplex;
      const head = args[2] as Buffer;
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

      if (url.pathname === this.config.path) {
        // Authenticate before upgrading: token via query param or Authorization header
        const token = url.searchParams.get('token') ?? null;
        if (!validateWsToken(token)) {
          log.warn('WebSocket connection rejected: invalid or missing token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    };
    server.on('upgrade', this.upgradeHandler);

    log.info('Gateway attached', { path: this.config.path });
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      this.handleConnection(socket, request);
    });

    this.wss.on('error', (error) => {
      log.error('Server error', { error });
    });

    // Start heartbeat (unref so timer doesn't block process exit)
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.config.heartbeatInterval);
    this.heartbeatTimer.unref();

    // Start cleanup timer (unref so timer doesn't block process exit)
    this.cleanupTimer = setInterval(
      () => {
        const removed = sessionManager.cleanup(this.config.sessionTimeout);
        if (removed > 0) {
          log.info('Cleaned up stale sessions', { removed });
        }
      },
      Math.min(this.config.sessionTimeout / 3, 60_000)
    );
    this.cleanupTimer.unref();
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    // Enforce max connections
    if (sessionManager.count >= this.config.maxConnections) {
      log.warn('Connection rejected: max connections reached', {
        current: sessionManager.count,
        max: this.config.maxConnections,
      });
      socket.close(1013, 'Maximum connections reached');
      return;
    }

    // Validate origin
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin, this.config.allowedOrigins)) {
      log.warn('Connection rejected: origin not allowed', { origin });
      socket.close(1008, 'Origin not allowed');
      return;
    }

    // Authenticate (standalone mode — upgrade handler already checks for attachToServer mode)
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') ?? null;
    if (!validateWsToken(token)) {
      log.warn('Connection rejected: invalid or missing token');
      socket.close(1008, 'Authentication required');
      return;
    }

    // Create session
    const session = sessionManager.create(socket);

    log.info('New connection', {
      sessionId: session.id,
      remoteAddress: request.socket.remoteAddress,
    });

    // Send ready event
    sessionManager.send(session.id, 'connection:ready', { sessionId: session.id });

    // Setup socket event handlers
    socket.on('message', (data: RawData) => {
      this.handleMessage(session.id, data);
    });

    socket.on('close', (code, reason) => {
      log.info('Connection closed', { sessionId: session.id, code, reason: reason.toString() });
      sessionManager.removeBySocket(socket);
    });

    socket.on('error', (error) => {
      log.error('Connection error', { sessionId: session.id, error });
    });

    socket.on('pong', () => {
      sessionManager.touch(session.id);
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(sessionId: string, data: RawData): void {
    // Per-session rate limiting (token bucket)
    if (!sessionManager.consumeRateLimit(sessionId)) {
      this.sendError(sessionId, 'RATE_LIMITED', 'Too many messages, slow down');
      return;
    }

    sessionManager.touch(sessionId);

    try {
      const message = JSON.parse(data.toString()) as WSMessage<unknown>;

      if (!message.type || typeof message.type !== 'string') {
        this.sendError(sessionId, 'INVALID_MESSAGE', 'Message must have a type');
        return;
      }

      // Validate event type against known client events
      if (!VALID_CLIENT_EVENTS.has(message.type)) {
        this.sendError(sessionId, 'UNKNOWN_EVENT', 'Unknown event type');
        return;
      }

      // Process client event
      const eventType = message.type as keyof ClientEvents;

      if (this.clientHandler.has(eventType)) {
        this.clientHandler
          .process(eventType, message.payload as ClientEvents[typeof eventType], sessionId)
          .catch((error) => {
            log.error('Error processing event', { eventType, error });
            this.sendError(sessionId, 'HANDLER_ERROR', 'Failed to process event');
          });
      } else {
        log.warn('Unknown client event', { type: message.type });
      }
    } catch (error) {
      log.error('Failed to parse message', { error });
      this.sendError(sessionId, 'PARSE_ERROR', 'Invalid JSON message');
    }
  }

  /**
   * Setup handlers for client events
   */
  private setupClientHandlers(): void {
    // Chat send - Integrate with agent system
    this.clientHandler.handle('chat:send', async (data, sessionId) => {
      log.info('Chat message received', { data });

      try {
        // Get or create default agent
        const agent = await getOrCreateDefaultAgent();

        // Generate message ID
        const messageId = crypto.randomUUID();

        // Send stream start event
        if (sessionId) {
          sessionManager.send(sessionId, 'chat:stream:start', {
            sessionId,
            messageId,
          });
        }

        // Check demo mode
        if (await isDemoMode()) {
          // Demo mode: send simulated response
          const demoResponse = `This is a demo response. In production, configure an API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) to get real AI responses.\n\nYour message: "${data.content}"`;

          if (sessionId) {
            // Send chunks for demo
            const chunks = demoResponse.split(' ');
            for (const chunk of chunks) {
              sessionManager.send(sessionId, 'chat:stream:chunk', {
                sessionId,
                messageId,
                chunk: chunk + ' ',
              });
              await new Promise((r) => setTimeout(r, 50));
            }

            // Send stream end
            sessionManager.send(sessionId, 'chat:stream:end', {
              sessionId,
              messageId,
              fullContent: demoResponse,
            });

            // Send final message
            sessionManager.send(sessionId, 'chat:message', {
              sessionId,
              message: {
                id: messageId,
                content: demoResponse,
                timestamp: new Date(),
                model: 'demo',
                provider: 'demo',
              },
            });
          }
          return;
        }

        // Real mode: process with agent using streaming
        let fullContent = '';

        const result = await agent.chat(data.content, {
          stream: true,
          onChunk: (chunk) => {
            if (chunk.content && sessionId) {
              fullContent += chunk.content;
              sessionManager.send(sessionId, 'chat:stream:chunk', {
                sessionId,
                messageId,
                chunk: chunk.content,
              });
            }

            // Handle tool calls in chunk
            if (chunk.toolCalls && sessionId) {
              for (const tc of chunk.toolCalls) {
                if (tc.id) {
                  sessionManager.send(sessionId, 'tool:start', {
                    sessionId,
                    tool: {
                      id: tc.id,
                      name: tc.name ?? 'unknown',
                      arguments: {},
                      status: 'running',
                      startedAt: new Date(),
                    },
                  });
                }
              }
            }
          },
        });

        // Check result and use final content
        if (result.ok) {
          fullContent = result.value.content;
        }

        // Send stream end
        if (sessionId) {
          sessionManager.send(sessionId, 'chat:stream:end', {
            sessionId,
            messageId,
            fullContent,
          });

          // Send final message
          sessionManager.send(sessionId, 'chat:message', {
            sessionId,
            message: {
              id: messageId,
              content: fullContent,
              timestamp: new Date(),
            },
          });
        }
      } catch (error) {
        log.error('Error processing chat message', { error });
        if (sessionId) {
          sessionManager.send(sessionId, 'chat:error', {
            sessionId,
            error: getErrorMessage(error),
          });
        }
      }
    });

    // Chat stop
    this.clientHandler.handle('chat:stop', async (data, sessionId) => {
      log.info('Chat stop requested', { data });
      // Agent stop would be implemented here
      if (sessionId) {
        sessionManager.send(sessionId, 'system:notification', {
          type: 'info',
          message: 'Chat stopped',
        });
      }
    });

    // Chat retry
    this.clientHandler.handle('chat:retry', async (data, sessionId) => {
      log.info('Chat retry requested', { data });
      if (sessionId) {
        sessionManager.send(sessionId, 'system:notification', {
          type: 'info',
          message: 'Retrying message...',
        });
      }
    });

    // Channel connect - Initialize channel adapter based on type
    this.clientHandler.handle('channel:connect', async (data, sessionId) => {
      log.info('Channel connect', { data });

      try {
        // Generate channel ID if not provided
        const config = data.config as Record<string, unknown>;
        const channelId =
          (config.id as string) || `${data.type}-${crypto.randomUUID().slice(0, 8)}`;
        const channelName = (config.name as string) || `${data.type} Channel`;

        // Build the full config based on channel type
        const fullConfig = {
          id: channelId,
          type: data.type,
          name: channelName,
          ...config,
        };

        // Connect the channel using IChannelService
        const service = getChannelService();
        const pluginId = fullConfig.id ?? `channel.${fullConfig.type}`;
        await service.connect(pluginId);

        const channelApi = service.getChannel(pluginId);
        if (!channelApi) {
          throw new Error(`Channel plugin ${pluginId} not found`);
        }

        // Subscribe this session to the channel
        if (sessionId) {
          sessionManager.subscribeToChannel(sessionId, channelId);

          // Send success response
          sessionManager.send(sessionId, 'channel:connected', {
            channel: {
              id: pluginId,
              type: channelApi.getPlatform(),
              name: pluginId,
              status: channelApi.getStatus(),
              connectedAt: new Date(),
              config: {},
            },
          });
        }

        log.info('Channel connected', { type: data.type, channelId });
      } catch (error) {
        log.error('Failed to connect channel', { error });
        if (sessionId) {
          sessionManager.send(sessionId, 'channel:status', {
            channelId: 'unknown',
            status: 'error',
            error: getErrorMessage(error, 'Failed to connect channel'),
          });
        }
      }
    });

    // Channel disconnect
    this.clientHandler.handle('channel:disconnect', async (data, sessionId) => {
      log.info('Channel disconnect', { data });

      try {
        await getChannelService().disconnect(data.channelId);

        if (sessionId) {
          sessionManager.unsubscribeFromChannel(sessionId, data.channelId);
          sessionManager.send(sessionId, 'channel:disconnected', {
            channelId: data.channelId,
            reason: 'User requested disconnect',
          });
        }
      } catch (error) {
        log.error('Failed to disconnect channel', { error });
        if (sessionId) {
          sessionManager.send(sessionId, 'system:notification', {
            type: 'error',
            message: getErrorMessage(error, 'Failed to disconnect channel'),
          });
        }
      }
    });

    // Channel subscribe
    this.clientHandler.handle('channel:subscribe', async (data, sessionId) => {
      log.info('Channel subscribe', { data });

      if (sessionId) {
        const success = sessionManager.subscribeToChannel(sessionId, data.channelId);
        sessionManager.send(sessionId, 'system:notification', {
          type: success ? 'success' : 'error',
          message: success ? `Subscribed to channel ${data.channelId}` : 'Failed to subscribe',
        });
      }
    });

    // Channel unsubscribe
    this.clientHandler.handle('channel:unsubscribe', async (data, sessionId) => {
      log.info('Channel unsubscribe', { data });

      if (sessionId) {
        const success = sessionManager.unsubscribeFromChannel(sessionId, data.channelId);
        sessionManager.send(sessionId, 'system:notification', {
          type: success ? 'success' : 'error',
          message: success
            ? `Unsubscribed from channel ${data.channelId}`
            : 'Failed to unsubscribe',
        });
      }
    });

    // Channel send - Send message to a channel
    this.clientHandler.handle('channel:send', async (data, sessionId) => {
      log.info('Channel send', { data });

      try {
        // Parse legacy "adapterId:chatId" format
        const cid = data.message.channelId;
        const parts = cid.split(':');
        const chatId = parts.length > 1 ? parts.slice(1).join(':') : cid;
        const messageId = await getChannelService().send(cid, {
          platformChatId: chatId,
          text: data.message.content,
          replyToId: data.message.replyToId,
        });

        if (sessionId) {
          sessionManager.send(sessionId, 'channel:message:sent', {
            channelId: data.message.channelId,
            messageId,
          });
        }
      } catch (error) {
        log.error('Failed to send channel message', { error });
        if (sessionId) {
          sessionManager.send(sessionId, 'channel:message:error', {
            channelId: data.message.channelId,
            error: getErrorMessage(error, 'Failed to send message'),
          });
        }
      }
    });

    // Channel list - Return list of connected channels
    this.clientHandler.handle('channel:list', async (_data, sessionId) => {
      log.info('Channel list requested');

      const service = getChannelService();
      const channelInfos = service.listChannels();
      const channels: Channel[] = channelInfos.map((ch) => ({
        id: ch.pluginId,
        type: ch.platform,
        name: ch.name,
        status: ch.status,
        connectedAt: ch.status === 'connected' ? new Date() : undefined,
        config: {},
      }));

      // Compute status summary
      const byType: Record<string, number> = {};
      for (const ch of channelInfos) {
        byType[ch.platform] = (byType[ch.platform] ?? 0) + 1;
      }
      const summary = {
        total: channelInfos.length,
        connected: channelInfos.filter((c) => c.status === 'connected').length,
        disconnected: channelInfos.filter((c) => c.status === 'disconnected').length,
        error: channelInfos.filter((c) => c.status === 'error').length,
        byType,
      };

      // Send channel list to requester
      if (sessionId) {
        // Use system notification to send list (could add dedicated event type)
        sessionManager.send(sessionId, 'system:notification', {
          type: 'info',
          message: JSON.stringify({
            channels,
            summary,
          }),
        });

        // Also emit each channel as connected event for UI to process
        for (const channel of channels) {
          sessionManager.send(sessionId, 'channel:connected', { channel });
        }
      }
    });

    // Workspace create
    this.clientHandler.handle('workspace:create', async (data, sessionId) => {
      log.info('Workspace create', { data });
      if (sessionId) {
        sessionManager.send(sessionId, 'workspace:created', {
          workspace: {
            id: crypto.randomUUID(),
            name: data.name,
            channels: data.channels ?? [],
            createdAt: new Date(),
          },
        });
      }
    });

    // Workspace switch
    this.clientHandler.handle('workspace:switch', async (data, sessionId) => {
      log.info('Workspace switch', { data });
      if (sessionId) {
        sessionManager.setMetadata(sessionId, 'currentWorkspace', data.workspaceId);
        sessionManager.send(sessionId, 'system:notification', {
          type: 'success',
          message: `Switched to workspace ${data.workspaceId}`,
        });
      }
    });

    // Workspace delete
    this.clientHandler.handle('workspace:delete', async (data, sessionId) => {
      log.info('Workspace delete', { data });
      if (sessionId) {
        sessionManager.send(sessionId, 'workspace:deleted', {
          workspaceId: data.workspaceId,
        });
      }
    });

    // Workspace list
    this.clientHandler.handle('workspace:list', async (_data, sessionId) => {
      log.info('Workspace list requested');
      if (sessionId) {
        sessionManager.send(sessionId, 'system:notification', {
          type: 'info',
          message: 'Workspaces: []', // Would return actual workspaces from storage
        });
      }
    });

    // Agent configure
    this.clientHandler.handle('agent:configure', async (data, sessionId) => {
      log.info('Agent configure', { data });
      if (sessionId) {
        sessionManager.setMetadata(sessionId, 'agentConfig', data);
        sessionManager.send(sessionId, 'agent:state', {
          agentId: 'default',
          state: 'idle',
        });
      }
    });

    // Agent stop
    this.clientHandler.handle('agent:stop', async (_data, sessionId) => {
      log.info('Agent stop requested');
      if (sessionId) {
        sessionManager.send(sessionId, 'agent:state', {
          agentId: 'default',
          state: 'idle',
        });
      }
    });

    // Tool cancel
    this.clientHandler.handle('tool:cancel', async (data, sessionId) => {
      log.info('Tool cancel', { data });
      if (sessionId) {
        sessionManager.send(sessionId, 'tool:end', {
          sessionId,
          toolId: data.toolId,
          result: null,
          error: 'Cancelled by user',
        });
      }
    });

    // Session ping
    this.clientHandler.handle('session:ping', async (_data, sessionId) => {
      // Handled by touch() already, but send pong
      if (sessionId) {
        sessionManager.send(sessionId, 'connection:ping', {
          timestamp: Date.now(),
        });
      }
    });

    // Session pong (response to server ping)
    this.clientHandler.handle('session:pong', async (data) => {
      log.debug('Session pong', { data });
    });

    // =========================================================================
    // Coding Agent terminal events
    // =========================================================================

    this.clientHandler.handle('coding-agent:input', async (data, wsSessionId) => {
      if (!wsSessionId) return;
      const userId = sessionManager.get(wsSessionId)?.userId ?? 'default';
      try {
        const { getCodingAgentSessionManager } =
          await import('../services/coding-agent-sessions.js');
        getCodingAgentSessionManager().writeToSession(data.sessionId, userId, data.data);
      } catch (err) {
        log.error('Coding agent input error', { error: String(err) });
      }
    });

    this.clientHandler.handle('coding-agent:resize', async (data, wsSessionId) => {
      if (!wsSessionId) return;
      const userId = sessionManager.get(wsSessionId)?.userId ?? 'default';
      try {
        const { getCodingAgentSessionManager } =
          await import('../services/coding-agent-sessions.js');
        getCodingAgentSessionManager().resizeSession(data.sessionId, userId, data.cols, data.rows);
      } catch (err) {
        log.error('Coding agent resize error', { error: String(err) });
      }
    });

    this.clientHandler.handle('coding-agent:subscribe', async (data, wsSessionId) => {
      if (!wsSessionId) return;
      const userId = sessionManager.get(wsSessionId)?.userId ?? 'default';
      try {
        const { getCodingAgentSessionManager } =
          await import('../services/coding-agent-sessions.js');
        getCodingAgentSessionManager().subscribe(data.sessionId, wsSessionId, userId);
      } catch (err) {
        log.error('Coding agent subscribe error', { error: String(err) });
      }
    });

    // =========================================================================
    // EventBus Bridge events
    // =========================================================================

    this.clientHandler.handle('event:subscribe', async (data, wsSessionId) => {
      if (!wsSessionId || !this.eventBridge) return;
      this.eventBridge.subscribe(wsSessionId, data.pattern);
    });

    this.clientHandler.handle('event:unsubscribe', async (data, wsSessionId) => {
      if (!wsSessionId || !this.eventBridge) return;
      this.eventBridge.unsubscribe(wsSessionId, data.pattern);
    });

    this.clientHandler.handle('event:publish', async (data, wsSessionId) => {
      if (!wsSessionId || !this.eventBridge) return;
      this.eventBridge.publish(wsSessionId, data.type, data.data);
    });
  }

  /**
   * Send error to a session
   */
  private sendError(sessionId: string, code: string, message: string): void {
    sessionManager.send(sessionId, 'connection:error', { code, message });
  }

  /**
   * Send heartbeat pings to all connections
   */
  private heartbeat(): void {
    if (!this.wss) return;

    for (const socket of this.wss.clients) {
      if (socket.readyState === WS_READY_STATE_OPEN) {
        socket.ping();
      }
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast<K extends keyof import('./types.js').ServerEvents>(
    event: K,
    payload: import('./types.js').ServerEvents[K]
  ): number {
    return sessionManager.broadcast(event, payload);
  }

  /**
   * Send event to a specific session
   */
  send<K extends keyof import('./types.js').ServerEvents>(
    sessionId: string,
    event: K,
    payload: import('./types.js').ServerEvents[K]
  ): boolean {
    return sessionManager.send(sessionId, event, payload);
  }

  /**
   * Get current connection count
   */
  get connectionCount(): number {
    return sessionManager.count;
  }

  /**
   * Stop the WebSocket server
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }

      // Stop legacy event forwarding
      for (const unsub of this.legacyUnsubs) unsub();
      this.legacyUnsubs = [];

      // Stop EventBusBridge
      if (this.eventBridge) {
        this.eventBridge.stop();
        this.eventBridge = null;
      }

      // Remove upgrade handler from HTTP server
      if (this.httpServer && this.upgradeHandler) {
        this.httpServer.removeListener('upgrade', this.upgradeHandler);
        this.httpServer = null;
        this.upgradeHandler = null;
      }

      if (!this.wss) {
        resolve();
        return;
      }

      // Close all connections
      for (const socket of this.wss.clients) {
        socket.close(1001, 'Server shutting down');
      }

      this.wss.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.wss = null;
          resolve();
        }
      });
    });
  }
}

/**
 * Global WebSocket gateway instance
 */
export const wsGateway = new WSGateway();
