/**
 * Discord Channel API (Native REST + Gateway)
 *
 * Implements ChannelPluginAPI using Discord's native API
 * without discord.js dependency. Uses REST for sending and
 * Gateway WebSocket for receiving events.
 */

import {
  type ChannelPluginAPI,
  type ChannelConnectionStatus,
  type ChannelPlatform,
  type ChannelOutgoingMessage,
  type ChannelUser,
  type ChannelIncomingMessage,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  getEventBus,
  createEvent,
} from '@ownpilot/core';
import WebSocket from 'ws';
import { getLog } from '../../../services/log.js';

const log = getLog('Discord');

// ============================================================================
// Discord API Constants
// ============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Gateway Opcodes
const enum GatewayOpcode {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  Resume = 6,
  Reconnect = 7,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
}

// ============================================================================
// Types
// ============================================================================

export interface DiscordChannelConfig {
  bot_token: string;
  allowed_guilds?: string;
  allowed_channels?: string;
}

/** Minimal Discord gateway event data for MESSAGE_CREATE */
interface DiscordMessage {
  guild_id?: string;
  channel_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    global_name?: string;
    avatar?: string;
    bot?: boolean;
  };
  id: string;
  timestamp: string;
  referenced_message?: { id: string };
  channel?: { name?: string };
}

/** Minimal Discord gateway payload */
interface DiscordGatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

// ============================================================================
// Implementation
// ============================================================================

export class DiscordChannelAPI implements ChannelPluginAPI {
  private ws: WebSocket | null = null;
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: DiscordChannelConfig;
  private readonly pluginId: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private allowedGuilds: Set<string> = new Set();
  private allowedChannels: Set<string> = new Set();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = config as unknown as DiscordChannelConfig;
    this.pluginId = pluginId;

    if (this.config.allowed_guilds) {
      this.config.allowed_guilds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedGuilds.add(id));
    }
    if (this.config.allowed_channels) {
      this.config.allowed_channels
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => this.allowedChannels.add(id));
    }
  }

  // --------------------------------------------------------------------------
  // ChannelPluginAPI
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.status === 'connected') return;
    if (!this.config.bot_token) {
      throw new Error('Discord bot_token is required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(DISCORD_GATEWAY_URL);

      this.ws.on('open', () => {
        log.info('[Discord] Gateway WebSocket opened');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString());
          this.handleGatewayPayload(payload, resolve);
        } catch (err) {
          log.error('[Discord] Failed to parse gateway message:', err);
        }
      });

      this.ws.on('close', (_code, _reason) => {
        this.stopHeartbeat();
        if (this.status !== 'disconnected') {
          this.status = 'reconnecting';
          this.emitConnectionEvent('reconnecting');
          // Auto-reconnect after delay (tracked for cleanup on disconnect)
          const timer = setTimeout(() => { this.pendingTimers.delete(timer); this.connect().catch((e) => log.error(e)); }, 5000);
          this.pendingTimers.add(timer);
        }
      });

      this.ws.on('error', (err) => {
        log.error('[Discord] Gateway error:', err);
        this.status = 'error';
        this.emitConnectionEvent('error');
        reject(err);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.stopHeartbeat();
    // Cancel any pending reconnect/identify timers
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    this.emitConnectionEvent('disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (!this.config.bot_token) {
      throw new Error('Discord bot is not connected');
    }

    const body: Record<string, unknown> = {
      content: message.text,
    };

    if (message.replyToId) {
      const msgId = message.replyToId.includes(':')
        ? message.replyToId.split(':').pop()
        : message.replyToId;
      body.message_reference = { message_id: msgId };
    }

    const res = await fetch(
      `${DISCORD_API_BASE}/channels/${message.platformChatId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.config.bot_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { id: string };
    return data.id;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'discord';
  }

  async sendTyping(platformChatId: string): Promise<void> {
    if (!this.config.bot_token) return;
    await fetch(
      `${DISCORD_API_BASE}/channels/${platformChatId}/typing`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${this.config.bot_token}` },
      }
    ).catch((err: unknown) => {
      log.debug('[Discord] Typing indicator failed', { chatId: platformChatId, error: err });
    });
  }

  async editMessage(_platformMessageId: string, _newText: string): Promise<void> {
    // Would need channel_id tracking per message
    log.warn('[Discord] editMessage not yet supported (requires channel_id tracking)');
  }

  async deleteMessage(_platformMessageId: string): Promise<void> {
    log.warn('[Discord] deleteMessage not yet supported (requires channel_id tracking)');
  }

  // --------------------------------------------------------------------------
  // Private: Gateway
  // --------------------------------------------------------------------------

  private handleGatewayPayload(
    payload: DiscordGatewayPayload,
    onReady?: (value: void) => void
  ): void {
    if (payload.s !== null) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case GatewayOpcode.Hello: {
        const helloData = payload.d as { heartbeat_interval?: number } | null;
        if (!helloData?.heartbeat_interval) break;
        this.startHeartbeat(helloData.heartbeat_interval);
        this.identify();
        break;
      }

      case GatewayOpcode.HeartbeatAck:
        break;

      case GatewayOpcode.Reconnect:
        this.ws?.close(4000, 'Server requested reconnect');
        break;

      case GatewayOpcode.InvalidSession: {
        const timer = setTimeout(() => { this.pendingTimers.delete(timer); this.identify(); }, 5000);
        this.pendingTimers.add(timer);
        break;
      }

      case GatewayOpcode.Dispatch:
        if (payload.t) {
          this.handleDispatch(payload.t, (payload.d ?? {}) as Record<string, unknown>, onReady);
        }
        break;
    }
  }

  private handleDispatch(
    event: string,
    data: Record<string, unknown>,
    onReady?: (value: void) => void
  ): void {
    switch (event) {
      case 'READY': {
        const readyData = data as unknown as {
          session_id: string;
          user: { username: string; discriminator: string };
        };
        this.sessionId = readyData.session_id;
        this.status = 'connected';
        log.info(`[Discord] Connected as ${readyData.user.username}#${readyData.user.discriminator}`);
        this.emitConnectionEvent('connected');
        onReady?.();
        break;
      }

      case 'MESSAGE_CREATE': {
        const msg = data as unknown as DiscordMessage;
        // Skip bot messages
        if (msg.author.bot) return;
        this.handleIncomingMessage(msg).catch((err) => {
          log.error('[Discord] Error handling message:', err);
        });
        break;
      }
    }
  }

  private identify(): void {
    this.ws?.send(
      JSON.stringify({
        op: GatewayOpcode.Identify,
        d: {
          token: this.config.bot_token,
          intents: 1 << 9 | 1 << 12 | 1 << 15, // GUILDS, MESSAGE_CONTENT, GUILD_MESSAGES
          properties: {
            os: process.platform,
            browser: 'OwnPilot',
            device: 'OwnPilot',
          },
        },
      })
    );
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(
        JSON.stringify({ op: GatewayOpcode.Heartbeat, d: this.sequence })
      );
    }, intervalMs);
    this.heartbeatInterval.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // Private: Message Processing
  // --------------------------------------------------------------------------

  private async handleIncomingMessage(data: DiscordMessage): Promise<void> {
    const guildId = data.guild_id ?? '';
    const channelId = data.channel_id ?? '';

    // Access control
    if (this.allowedGuilds.size > 0 && guildId && !this.allowedGuilds.has(guildId)) {
      return;
    }
    if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId)) {
      return;
    }

    const sender: ChannelUser = {
      platformUserId: data.author.id,
      platform: 'discord',
      displayName: data.author.global_name ?? data.author.username,
      username: data.author.username,
      avatarUrl: data.author.avatar
        ? `https://cdn.discordapp.com/avatars/${data.author.id}/${data.author.avatar}.png`
        : undefined,
      isBot: data.author.bot ?? false,
    };

    const normalized: ChannelIncomingMessage = {
      id: `${this.pluginId}:${data.id}`,
      channelPluginId: this.pluginId,
      platform: 'discord',
      platformChatId: channelId,
      sender,
      text: data.content ?? '',
      timestamp: new Date(data.timestamp),
      replyToId: data.referenced_message
        ? `${this.pluginId}:${data.referenced_message.id}`
        : undefined,
      metadata: {
        platformMessageId: data.id,
        guildId,
        channelName: data.channel?.name,
      },
    };

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel',
          this.pluginId,
          { message: normalized }
        )
      );
    } catch (err) {
      log.error('[Discord] Failed to emit message event:', err);
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
          'channel',
          this.pluginId,
          {
            channelPluginId: this.pluginId,
            platform: 'discord',
            status,
          }
        )
      );
    } catch {
      // EventBus not ready
    }
  }
}
