/**
 * Matrix Channel API
 *
 * Implements ChannelPluginAPI using the Matrix Client-Server HTTP API
 * directly via fetch(). No external SDK dependency required.
 *
 * - connect() validates credentials via /whoami, then starts long-polling /sync
 * - sendMessage() sends text via PUT /rooms/{roomId}/send/m.room.message/{txnId}
 * - disconnect() stops the sync loop
 * - Auto-joins invited rooms when configured
 * - Routes incoming messages through EventBus (ChannelEvents.MESSAGE_RECEIVED)
 */

import {
  type ChannelPluginAPI,
  type ChannelConnectionStatus,
  type ChannelPlatform,
  type ChannelOutgoingMessage,
  type ChannelIncomingMessage,
  ChannelEvents,
  type ChannelMessageReceivedData,
  type ChannelConnectionEventData,
  getEventBus,
  createEvent,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';
import { getErrorMessage } from '../../../routes/helpers.js';
import { splitMessage } from '../../utils/message-utils.js';

const log = getLog('Matrix');

const MATRIX_MAX_LENGTH = 16384; // Matrix spec allows up to 65535 bytes; we split at 16K for readability
const SYNC_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 5_000;

// ============================================================================
// Types
// ============================================================================

interface MatrixChannelConfig {
  homeserver_url: string;
  access_token: string;
  user_id: string;
  auto_join?: boolean;
  allowed_rooms?: string;
}

/** Minimal subset of the Matrix /sync response. */
interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, { timeline?: { events: MatrixEvent[] } }>;
    invite?: Record<string, unknown>;
  };
}

interface MatrixEvent {
  type: string;
  event_id: string;
  sender: string;
  origin_server_ts: number;
  content: unknown;
}

// ============================================================================
// Matrix API
// ============================================================================

export class MatrixChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: MatrixChannelConfig;
  private readonly pluginId: string;
  private allowedRooms: Set<string> = new Set();

  private syncToken: string | null = null;
  private syncAbortController: AbortController | null = null;
  private syncing = false;
  private txnCounter = 0;

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = {
      homeserver_url: String(config.homeserver_url ?? '').replace(/\/$/, ''),
      access_token: String(config.access_token ?? ''),
      user_id: String(config.user_id ?? ''),
      auto_join: config.auto_join !== false,
      allowed_rooms: config.allowed_rooms ? String(config.allowed_rooms) : undefined,
    };
    this.pluginId = pluginId;

    if (this.config.allowed_rooms) {
      for (const id of this.config.allowed_rooms.split(',')) {
        const trimmed = id.trim();
        if (trimmed) this.allowedRooms.add(trimmed);
      }
    }
  }

  // ==========================================================================
  // ChannelPluginAPI — Required
  // ==========================================================================

  async connect(): Promise<void> {
    if (!this.config.homeserver_url || !this.config.access_token || !this.config.user_id) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      log.warn('Matrix channel missing credentials — configure in Config Center');
      return;
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      // Validate credentials via /whoami
      const res = await this.matrixFetch('GET', '/_matrix/client/v3/account/whoami');
      if (!res.ok) {
        this.status = 'error';
        this.emitConnectionEvent('error');
        log.error('Matrix credential validation failed', { status: res.status });
        return;
      }

      const data = (await res.json()) as { user_id: string };
      log.info(`Matrix bot authenticated as ${data.user_id}`);

      this.status = 'connected';
      this.emitConnectionEvent('connected');

      // Start sync loop in background
      this.startSync();
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      log.error(`Failed to connect to Matrix homeserver: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    this.syncing = false;
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
    }
    this.status = 'disconnected';
    this.syncToken = null;
    this.emitConnectionEvent('disconnected');
    log.info('Matrix channel disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (this.status !== 'connected') {
      throw new Error('Matrix channel not connected');
    }

    const roomId = message.platformChatId;
    const parts = splitMessage(message.text, MATRIX_MAX_LENGTH);
    let lastEventId = '';

    for (let i = 0; i < parts.length; i++) {
      const txnId = `op_${Date.now()}_${this.txnCounter++}`;

      const content: Record<string, unknown> = {
        msgtype: 'm.text',
        body: parts[i],
      };

      // If replying, add Matrix reply format (first part only)
      if (i === 0 && message.replyToId) {
        content['m.relates_to'] = {
          'm.in_reply_to': {
            event_id: message.replyToId,
          },
        };
      }

      const res = await this.matrixFetch(
        'PUT',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        content,
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Matrix API error ${res.status}: ${errBody}`);
      }

      const resData = (await res.json()) as { event_id: string };
      lastEventId = resData.event_id;

      // Small delay between split messages
      if (i < parts.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    log.info('Matrix message sent', { roomId, eventId: lastEventId });
    return lastEventId;
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'matrix';
  }

  // ==========================================================================
  // ChannelPluginAPI — Optional
  // ==========================================================================

  async sendTyping(platformChatId: string): Promise<void> {
    try {
      await this.matrixFetch(
        'PUT',
        `/_matrix/client/v3/rooms/${encodeURIComponent(platformChatId)}/typing/${encodeURIComponent(this.config.user_id)}`,
        { typing: true, timeout: 5000 },
      );
    } catch {
      // Typing indicator failure is non-critical
    }
  }

  // ==========================================================================
  // Private — HTTP helper
  // ==========================================================================

  private async matrixFetch(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = `${this.config.homeserver_url}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.access_token}`,
    };

    const init: RequestInit = {
      method,
      headers,
      signal: signal ?? AbortSignal.timeout(30_000),
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return fetch(url, init);
  }

  // ==========================================================================
  // Private — Sync loop
  // ==========================================================================

  private startSync(): void {
    this.syncing = true;
    this.syncLoop().catch((err) => {
      if (this.syncing) {
        log.error(`Matrix sync loop crashed: ${getErrorMessage(err)}`);
        this.status = 'error';
        this.emitConnectionEvent('error');
      }
    });
  }

  private async syncLoop(): Promise<void> {
    // Initial sync — get sync token without processing old messages
    try {
      const params = new URLSearchParams({
        timeout: '0',
        filter: JSON.stringify({
          room: { timeline: { limit: 0 } },
          presence: { types: [] },
        }),
      });

      const res = await this.matrixFetch('GET', `/_matrix/client/v3/sync?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { next_batch: string };
        this.syncToken = data.next_batch;
      }
    } catch (error) {
      log.warn(`Matrix initial sync failed: ${getErrorMessage(error)}`);
    }

    // Long-polling sync loop
    while (this.syncing && this.status === 'connected') {
      try {
        this.syncAbortController = new AbortController();

        const params = new URLSearchParams({
          timeout: String(SYNC_TIMEOUT_MS),
          filter: JSON.stringify({
            room: {
              timeline: { limit: 50 },
              state: { types: ['m.room.member'] },
            },
            presence: { types: [] },
          }),
        });

        if (this.syncToken) {
          params.set('since', this.syncToken);
        }

        const res = await this.matrixFetch(
          'GET',
          `/_matrix/client/v3/sync?${params}`,
          undefined,
          this.syncAbortController.signal,
        );

        if (!res.ok) {
          log.warn('Matrix sync error', { status: res.status });
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        const data = (await res.json()) as MatrixSyncResponse;
        this.syncToken = data.next_batch;

        // Process joined rooms
        if (data.rooms?.join) {
          for (const [roomId, room] of Object.entries(data.rooms.join)) {
            // Room filter
            if (this.allowedRooms.size > 0 && !this.allowedRooms.has(roomId)) {
              continue;
            }

            for (const event of room.timeline?.events ?? []) {
              await this.handleRoomEvent(roomId, event);
            }
          }
        }

        // Auto-join invited rooms
        if (this.config.auto_join && data.rooms?.invite) {
          for (const roomId of Object.keys(data.rooms.invite)) {
            try {
              await this.matrixFetch(
                'POST',
                `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
                {},
              );
              log.info('Auto-joined Matrix room', { roomId });
            } catch (err) {
              log.warn(`Failed to auto-join Matrix room: ${getErrorMessage(err)}`, { roomId });
            }
          }
        }
      } catch (error) {
        if (!this.syncing) break; // Intentional disconnect
        const errMsg = String(error);
        if (errMsg.includes('abort') || errMsg.includes('AbortError')) break;
        log.warn(`Matrix sync error, retrying: ${getErrorMessage(error)}`);
        await this.delay(RETRY_DELAY_MS);
      }
    }
  }

  // ==========================================================================
  // Private — Message Processing
  // ==========================================================================

  private async handleRoomEvent(roomId: string, event: MatrixEvent): Promise<void> {
    // Only process m.room.message events from other users
    if (event.type !== 'm.room.message') return;
    if (event.sender === this.config.user_id) return;

    const content = event.content as { msgtype?: string; body?: string } | undefined;
    if (!content?.body) return;

    // Only handle text messages for now
    if (content.msgtype !== 'm.text' && content.msgtype !== 'm.notice') return;

    const channelMessage: ChannelIncomingMessage = {
      id: `${this.pluginId}:${event.event_id}`,
      channelPluginId: this.pluginId,
      platform: 'matrix',
      platformChatId: roomId,
      sender: {
        platformUserId: event.sender,
        platform: 'matrix',
        displayName: (event.sender.split(':')[0] ?? event.sender).replace('@', ''),
      },
      text: content.body,
      timestamp: new Date(event.origin_server_ts),
      metadata: {
        platformMessageId: event.event_id,
        roomId,
        msgtype: content.msgtype,
      },
    };

    // Emit event for ChannelServiceImpl to pick up
    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelMessageReceivedData>(
          ChannelEvents.MESSAGE_RECEIVED,
          'channel',
          this.pluginId,
          { message: channelMessage },
        ),
      );
    } catch (err) {
      log.error(`Failed to emit Matrix message event: ${getErrorMessage(err)}`);
    }
  }

  // ==========================================================================
  // Private — Connection Events
  // ==========================================================================

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
          platform: 'matrix',
          status,
        }),
      );
    } catch {
      // EventBus may not be ready during early boot
    }
  }

  // ==========================================================================
  // Private — Utilities
  // ==========================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
