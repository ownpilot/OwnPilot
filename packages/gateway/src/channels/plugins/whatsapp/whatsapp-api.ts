/**
 * WhatsApp Channel API (Meta Cloud API)
 *
 * Implements ChannelPluginAPI using direct HTTP calls to Meta Graph API.
 * No npm dependency — uses native fetch.
 *
 * Key limitation: WhatsApp has a 24-hour conversation window.
 * Free-form messages can only be sent within 24h of the last user message.
 * After that, approved message templates must be used.
 */

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

const log = getLog('WhatsApp');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const WHATSAPP_MAX_LENGTH = 4096;

// ============================================================================
// Types
// ============================================================================

interface WhatsAppChannelConfig {
  access_token: string;
  phone_number_id: string;
  business_account_id?: string;
  webhook_verify_token: string;
  app_secret?: string;
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        text?: { body: string };
        image?: { id: string; mime_type: string; sha256: string; caption?: string };
        document?: { id: string; mime_type: string; filename: string; caption?: string };
        audio?: { id: string; mime_type: string };
        video?: { id: string; mime_type: string; caption?: string };
        context?: { from: string; id: string };
      }>;
      statuses?: Array<{ id: string; status: string; timestamp: string }>;
    };
    field: string;
  }>;
}

// Webhook handler singleton
let webhookHandler: {
  verifyToken: string;
  callback: (body: WhatsAppWebhookEntry[]) => Promise<void>;
} | null = null;

export function registerWhatsAppWebhookHandler(
  verifyToken: string,
  callback: (body: WhatsAppWebhookEntry[]) => Promise<void>
): void {
  webhookHandler = { verifyToken, callback };
}

export function unregisterWhatsAppWebhookHandler(): void {
  webhookHandler = null;
}

export function getWhatsAppWebhookHandler() {
  return webhookHandler;
}

// ============================================================================
// WhatsApp API
// ============================================================================

export class WhatsAppChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private readonly config: WhatsAppChannelConfig;
  private readonly pluginId: string;
  private messageChatMap = new Map<string, string>();

  constructor(config: Record<string, unknown>, pluginId: string) {
    this.config = {
      access_token: String(config.access_token ?? ''),
      phone_number_id: String(config.phone_number_id ?? ''),
      business_account_id: config.business_account_id
        ? String(config.business_account_id)
        : undefined,
      webhook_verify_token: String(config.webhook_verify_token ?? ''),
      app_secret: config.app_secret ? String(config.app_secret) : undefined,
    };
    this.pluginId = pluginId;
  }

  // ==========================================================================
  // ChannelPluginAPI — Required
  // ==========================================================================

  async connect(): Promise<void> {
    if (!this.config.access_token) {
      throw new Error('WhatsApp access token is required');
    }
    if (!this.config.phone_number_id) {
      throw new Error('WhatsApp phone number ID is required');
    }

    this.status = 'connecting';
    this.emitConnectionEvent('connecting');

    try {
      // Verify credentials by fetching the phone number info
      const response = await fetch(
        `${GRAPH_API_BASE}/${this.config.phone_number_id}`,
        {
          headers: { Authorization: `Bearer ${this.config.access_token}` },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`WhatsApp API verification failed: ${error}`);
      }

      // Register webhook handler
      registerWhatsAppWebhookHandler(
        this.config.webhook_verify_token,
        (entries) => this.handleWebhookEntries(entries)
      );

      this.status = 'connected';
      this.emitConnectionEvent('connected');
      log.info(`WhatsApp bot connected (phone: ${this.config.phone_number_id})`);
    } catch (error) {
      this.status = 'error';
      this.emitConnectionEvent('error');
      throw new Error(`Failed to connect WhatsApp: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    unregisterWhatsAppWebhookHandler();
    this.status = 'disconnected';
    this.emitConnectionEvent('disconnected');
    log.info('WhatsApp bot disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    const parts = splitMessage(message.text, WHATSAPP_MAX_LENGTH);
    let lastMessageId = '';

    for (let i = 0; i < parts.length; i++) {
      const body = {
        messaging_product: 'whatsapp',
        to: message.platformChatId,
        type: 'text',
        text: { body: parts[i] },
        ...(i === 0 && message.replyToId
          ? { context: { message_id: message.replyToId } }
          : {}),
      };

      const response = await fetch(
        `${GRAPH_API_BASE}/${this.config.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WhatsApp send failed: ${errorText}`);
      }

      const result = (await response.json()) as {
        messages?: Array<{ id: string }>;
      };
      lastMessageId = result.messages?.[0]?.id ?? '';

      if (lastMessageId) {
        this.trackMessage(lastMessageId, message.platformChatId);
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
    try {
      await fetch(
        `${GRAPH_API_BASE}/${this.config.phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: platformChatId,
            type: 'reaction',
            // WhatsApp doesn't have a true typing indicator via API
            // This is a no-op placeholder
          }),
        }
      );
    } catch {
      // Non-fatal
    }
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
  // Webhook Handling
  // ==========================================================================

  private async handleWebhookEntries(entries: WhatsAppWebhookEntry[]): Promise<void> {
    for (const entry of entries) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const { value } = change;
        if (!value.messages) continue;

        const contacts = value.contacts ?? [];

        for (const msg of value.messages) {
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const sender: ChannelUser = {
            platformUserId: msg.from,
            platform: 'whatsapp',
            displayName: contact?.profile?.name ?? msg.from,
            username: msg.from,
          };

          let text = '';
          const attachments: ChannelAttachment[] = [];

          switch (msg.type) {
            case 'text':
              text = msg.text?.body ?? '';
              break;
            case 'image':
              if (msg.image) {
                text = msg.image.caption ?? '';
                attachments.push({
                  type: 'image',
                  url: msg.image.id, // Media ID — needs download via Graph API
                  mimeType: msg.image.mime_type,
                });
              }
              break;
            case 'document':
              if (msg.document) {
                text = msg.document.caption ?? '';
                attachments.push({
                  type: 'file',
                  url: msg.document.id,
                  mimeType: msg.document.mime_type,
                  filename: msg.document.filename,
                });
              }
              break;
            case 'audio':
              if (msg.audio) {
                attachments.push({
                  type: 'audio',
                  url: msg.audio.id,
                  mimeType: msg.audio.mime_type,
                });
              }
              break;
            case 'video':
              if (msg.video) {
                text = msg.video.caption ?? '';
                attachments.push({
                  type: 'video',
                  url: msg.video.id,
                  mimeType: msg.video.mime_type,
                });
              }
              break;
          }

          const channelMessage: ChannelIncomingMessage = {
            id: `${this.pluginId}:${msg.id}`,
            channelPluginId: this.pluginId,
            platform: 'whatsapp',
            platformChatId: msg.from, // WhatsApp uses phone number as chat ID
            sender,
            text: text || (attachments.length > 0 ? '[Attachment]' : ''),
            attachments: attachments.length > 0 ? attachments : undefined,
            replyToId: msg.context?.id
              ? `${this.pluginId}:${msg.context.id}`
              : undefined,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
            metadata: {
              platformMessageId: msg.id,
              phoneNumberId: value.metadata.phone_number_id,
              displayPhoneNumber: value.metadata.display_phone_number,
            },
          };

          this.trackMessage(msg.id, msg.from);

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
      }
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
          platform: 'whatsapp',
          status,
        })
      );
    } catch {
      // EventBus may not be ready during early boot
    }
  }
}
