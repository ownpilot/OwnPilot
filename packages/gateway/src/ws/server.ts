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
import type { ClientEvents, WSMessage, Channel } from './types.js';
import { sessionManager } from './session.js';
import { ClientEventHandler } from './events.js';
import { getChannelService } from '@ownpilot/core';
import {
  WS_PORT,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_SESSION_TIMEOUT_MS,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_CONNECTIONS,
} from '../config/defaults.js';
import { getOrCreateDefaultAgent, isDemoMode } from '../routes/agents.js';
import { getLog } from '../services/log.js';

const log = getLog('WebSocket');

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
  return allowedOrigins.some(allowed => origin === allowed);
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

  constructor(config: WSGatewayConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupClientHandlers();
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
    this.cleanupTimer = setInterval(() => {
      const removed = sessionManager.cleanup(this.config.sessionTimeout);
      if (removed > 0) {
        log.info('Cleaned up stale sessions', { removed });
      }
    }, this.config.sessionTimeout / 2);
    this.cleanupTimer.unref();
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    // Enforce max connections
    if (sessionManager.count >= this.config.maxConnections) {
      log.warn('Connection rejected: max connections reached', { current: sessionManager.count, max: this.config.maxConnections });
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

    // Create session
    const session = sessionManager.create(socket);

    log.info('New connection', { sessionId: session.id, remoteAddress: request.socket.remoteAddress });

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
    sessionManager.touch(sessionId);

    try {
      const message = JSON.parse(data.toString()) as WSMessage<unknown>;

      if (!message.type || typeof message.type !== 'string') {
        this.sendError(sessionId, 'INVALID_MESSAGE', 'Message must have a type');
        return;
      }

      // Validate event type against known client events
      const VALID_CLIENT_EVENTS = new Set<string>([
        'chat:send', 'chat:stop', 'chat:retry',
        'channel:connect', 'channel:disconnect', 'channel:subscribe', 'channel:unsubscribe',
        'channel:send', 'channel:list',
        'workspace:create', 'workspace:switch', 'workspace:delete', 'workspace:list',
        'agent:configure', 'agent:stop',
        'tool:cancel',
        'session:ping', 'session:pong',
      ]);

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
            this.sendError(
              sessionId,
              'HANDLER_ERROR',
              'Failed to process event'
            );
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
            error: error instanceof Error ? error.message : 'Unknown error',
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
        const channelId = (config.id as string) || `${data.type}-${crypto.randomUUID().slice(0, 8)}`;
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
            error: error instanceof Error ? error.message : 'Failed to connect channel',
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
            message: error instanceof Error ? error.message : 'Failed to disconnect channel',
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
          message: success ? `Unsubscribed from channel ${data.channelId}` : 'Failed to unsubscribe',
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
            error: error instanceof Error ? error.message : 'Failed to send message',
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
      if (socket.readyState === 1) {
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
