/**
 * WhatsApp UCP Adapter
 *
 * Wraps the existing WhatsAppChannelAPI with UCP normalize/denormalize support.
 * Delegates all ChannelPluginAPI methods to the underlying API while adding
 * UCPMessage conversion for the UnifiedChannelBus pipeline.
 */

import { randomUUID } from 'node:crypto';
import {
  UCPChannelAdapter,
  type UCPMessage,
  type UCPContent,
  type UCPContentType,
  type UCPChannelCapabilities,
  type ChannelPluginAPI,
  type ChannelOutgoingMessage,
  type ChannelIncomingMessage,
} from '@ownpilot/core';

const WHATSAPP_CAPABILITIES: UCPChannelCapabilities = {
  channel: 'whatsapp',
  features: new Set([
    'rich_text',
    'images',
    'files',
    'audio',
    'video',
    'reactions',
    'deletion',
    'typing_indicator',
    'voice_messages',
    'stickers',
  ]),
  limits: {
    maxTextLength: 65536,
    maxFileSize: 64 * 1024 * 1024,
  },
};

export class WhatsAppUCPAdapter extends UCPChannelAdapter {
  readonly platform = 'whatsapp';
  readonly capabilities: UCPChannelCapabilities = WHATSAPP_CAPABILITIES;

  constructor(
    private readonly api: ChannelPluginAPI,
    private readonly channelId: string = 'channel.whatsapp',
  ) {
    super();

    // Wire optional methods from the underlying API
    if (this.api.sendTyping) {
      this.sendTyping = (chatId: string) => this.api.sendTyping!(chatId);
    }
    if (this.api.editMessage) {
      this.editMessage = (msgId: string, newText: string) => this.api.editMessage!(msgId, newText);
    }
    if (this.api.deleteMessage) {
      this.deleteMessage = (msgId: string) => this.api.deleteMessage!(msgId);
    }
    if (this.api.reactToMessage) {
      this.reactToMessage = (msgId: string, emoji: string) =>
        this.api.reactToMessage!(msgId, emoji);
    }
    if (this.api.resolveUser) {
      this.resolveUser = (userId: string) => this.api.resolveUser!(userId);
    }
    if (this.api.logout) {
      this.logout = () => this.api.logout!();
    }
    if (this.api.getBotInfo) {
      const apiBotInfo = this.api.getBotInfo.bind(this.api);
      (this as unknown as Record<string, unknown>).getBotInfo = apiBotInfo;
    }
  }

  // ---------------------------------------------------------------------------
  // ChannelPluginAPI delegation
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.api.connect();
    this._status = this.api.getStatus();
  }

  async disconnect(): Promise<void> {
    await this.api.disconnect();
    this._status = 'disconnected';
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    return this.api.sendMessage(message);
  }

  override getStatus() {
    return this.api.getStatus();
  }

  // ---------------------------------------------------------------------------
  // UCP normalization
  // ---------------------------------------------------------------------------

  /**
   * Normalize a ChannelIncomingMessage into a UCPMessage.
   * The `raw` parameter is expected to be a ChannelIncomingMessage.
   */
  normalize(raw: unknown): UCPMessage {
    const msg = raw as ChannelIncomingMessage;
    return {
      id: msg.id || randomUUID(),
      externalId: msg.metadata?.platformMessageId?.toString() ?? msg.id,
      channel: this.platform,
      channelInstanceId: this.channelId,
      direction: 'inbound',
      sender: {
        id: msg.sender.platformUserId,
        displayName: msg.sender.displayName,
        username: msg.sender.username,
        avatarUrl: msg.sender.avatarUrl,
        platform: this.platform,
        isBot: msg.sender.isBot,
      },
      content: this.buildContent(msg),
      threadId: msg.metadata?.threadId as string | undefined,
      replyToId: msg.replyToId,
      timestamp: msg.timestamp,
      metadata: {
        raw: msg.metadata,
        conversationId: undefined,
      },
    };
  }

  /**
   * Send a UCPMessage via the WhatsApp API.
   * Extracts text + attachments from UCPContent blocks.
   */
  async denormalize(msg: UCPMessage): Promise<string> {
    const text = this.extractText(msg);
    const mediaBlocks = this.extractMedia(msg);

    const attachments = mediaBlocks
      .filter((block) => block.url || block.data)
      .map((block) => ({
        type: block.type as 'image' | 'audio' | 'video' | 'file',
        url: block.url,
        data: block.data,
        mimeType: block.mimeType ?? 'application/octet-stream',
        filename: block.fileName,
        size: block.fileSize,
      }));

    const platformChatId = (msg.metadata?.platformChatId as string) ?? msg.recipient?.id ?? '';

    return this.api.sendMessage({
      platformChatId,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyToId: msg.replyToId,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private buildContent(msg: ChannelIncomingMessage): UCPContent[] {
    const content: UCPContent[] = [];

    if (msg.text) {
      content.push({
        type: 'text',
        text: msg.text,
        format: 'plain',
      });
    }

    if (msg.attachments) {
      for (const att of msg.attachments) {
        content.push({
          type: att.type as UCPContentType,
          url: att.url,
          data: att.data,
          mimeType: att.mimeType,
          fileName: att.filename,
          fileSize: att.size,
        });
      }
    }

    return content.length > 0 ? content : [{ type: 'text', text: '', format: 'plain' }];
  }
}
