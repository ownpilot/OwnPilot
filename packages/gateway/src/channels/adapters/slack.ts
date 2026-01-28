/**
 * Slack Channel Adapter
 *
 * Uses @slack/bolt for bot communication via Socket Mode
 */

import { App } from '@slack/bolt';
import type { IncomingMessage, OutgoingMessage, Attachment } from '../../ws/types.js';
import type { SlackConfig, ChannelSender } from '../types.js';
import { BaseChannelAdapter } from '../base-adapter.js';

/**
 * Generic Slack message event type
 */
interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  team?: string;
  files?: SlackFile[];
}

/**
 * Slack message subtype that has files
 */
interface SlackFileMessageEvent extends SlackMessageEvent {
  files?: SlackFile[];
}

/**
 * Slack file object
 */
interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  filetype?: string;
}

/**
 * Slack user info
 */
interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    image_72?: string;
    image_192?: string;
  };
  is_bot?: boolean;
}

/**
 * Slack Channel Adapter
 */
export class SlackAdapter extends BaseChannelAdapter {
  private readonly botToken: string;
  private readonly appToken: string | undefined;
  private readonly signingSecret: string | undefined;
  private readonly allowedWorkspaces: Set<string>;
  private readonly allowedChannels: Set<string>;
  private app: App | null = null;

  constructor(config: SlackConfig) {
    super(config);
    this.botToken = config.botToken;
    this.appToken = config.appToken;
    this.signingSecret = config.signingSecret;
    this.allowedWorkspaces = new Set(config.allowedWorkspaces ?? []);
    this.allowedChannels = new Set(config.allowedChannels ?? []);
  }

  /**
   * Connect to Slack
   */
  async connect(): Promise<void> {
    this.setStatus('connecting');

    try {
      // Create Bolt app
      this.app = new App({
        token: this.botToken,
        appToken: this.appToken,
        signingSecret: this.signingSecret,
        socketMode: !!this.appToken, // Use socket mode if app token provided
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Start the app
      await this.app.start();

      // Get bot info
      const authResult = await this.app.client.auth.test();
      console.log(`[slack:${this.id}] Connected as ${authResult.user}`);

      this.setStatus('connected');
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'Connection failed');
      throw error;
    }
  }

  /**
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.setStatus('disconnected');
    this.cleanup();
  }

  /**
   * Send a message
   */
  async sendMessage(message: OutgoingMessage): Promise<string> {
    if (!this.app) {
      throw new Error('Slack app not connected');
    }

    const channel = this.parseChannelId(message.channelId);

    const options: {
      channel: string;
      text: string;
      thread_ts?: string;
    } = {
      channel,
      text: message.content,
    };

    // Handle thread replies
    if (message.replyToId) {
      options.thread_ts = message.replyToId;
    }

    const result = await this.app.client.chat.postMessage(options);
    return result.ts ?? '';
  }

  /**
   * Send typing indicator (Slack doesn't have this, but we can show a reaction)
   */
  override async sendTyping(_chatId: string): Promise<void> {
    // Slack doesn't support typing indicators in the traditional sense
    // We could potentially add an emoji reaction, but that's not standard
    console.log(`[slack:${this.id}] Typing indicator not supported`);
  }

  /**
   * Edit a message
   */
  override async editMessage(messageId: string, content: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack app not connected');
    }

    // messageId should be in format "channelId:ts"
    const [channel, ts] = messageId.split(':');
    if (!channel || !ts) {
      throw new Error('Invalid message ID format. Expected "channelId:ts"');
    }

    await this.app.client.chat.update({
      channel,
      ts,
      text: content,
    });
  }

  /**
   * Delete a message
   */
  override async deleteMessage(messageId: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack app not connected');
    }

    const [channel, ts] = messageId.split(':');
    if (!channel || !ts) {
      throw new Error('Invalid message ID format. Expected "channelId:ts"');
    }

    await this.app.client.chat.delete({
      channel,
      ts,
    });
  }

  /**
   * React to a message
   */
  override async reactToMessage(messageId: string, emoji: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack app not connected');
    }

    const [channel, ts] = messageId.split(':');
    if (!channel || !ts) {
      throw new Error('Invalid message ID format. Expected "channelId:ts"');
    }

    // Remove colons from emoji name if present
    const emojiName = emoji.replace(/:/g, '');

    await this.app.client.reactions.add({
      channel,
      timestamp: ts,
      name: emojiName,
    });
  }

  /**
   * Get sender info
   */
  override async getSenderInfo(senderId: string): Promise<ChannelSender | null> {
    if (!this.app) return null;

    try {
      const result = await this.app.client.users.info({ user: senderId });
      const user = result.user as SlackUser | undefined;

      if (!user) return null;

      return {
        id: user.id,
        name: user.real_name ?? user.name,
        username: user.name,
        avatarUrl: user.profile?.image_192 ?? user.profile?.image_72,
        isBot: user.is_bot,
      };
    } catch {
      return null;
    }
  }

  /**
   * Setup Slack event handlers
   */
  private setupEventHandlers(): void {
    if (!this.app) return;

    // Listen for messages
    this.app.message(async ({ message, say }) => {
      // Type guard for generic message events
      if (!this.isGenericMessage(message)) return;

      // Ignore bot messages and edited messages
      if (message.subtype === 'bot_message') return;
      if (message.subtype === 'message_changed') return;

      // Check if message is allowed
      if (!this.isMessageAllowed(message)) return;

      const incomingMessage = await this.convertMessage(message);
      this.emit('message', incomingMessage);
    });

    // Handle app mention (when bot is @mentioned)
    this.app.event('app_mention', async ({ event }) => {
      // Check if allowed
      if (this.allowedChannels.size > 0 && !this.allowedChannels.has(event.channel)) {
        return;
      }

      const incomingMessage: IncomingMessage = {
        id: `${event.channel}:${event.ts}`,
        channelId: this.id,
        channelType: 'slack',
        senderId: event.user ?? 'unknown',
        senderName: event.user ?? 'Unknown', // Would need to fetch user info
        content: event.text ?? '',
        timestamp: new Date(parseFloat(event.ts) * 1000),
        metadata: {
          channel: event.channel,
          ts: event.ts,
          isMention: true,
        },
      };

      this.emit('message', incomingMessage);
    });

    // Handle errors
    this.app.error(async (error) => {
      console.error(`[slack:${this.id}] Error:`, error);
      this.emit('error', error as Error);
    });
  }

  /**
   * Type guard for generic message events
   */
  private isGenericMessage(message: unknown): message is SlackMessageEvent {
    return (
      typeof message === 'object' &&
      message !== null &&
      'channel' in message &&
      'ts' in message
    );
  }

  /**
   * Check if a message should be processed
   */
  private isMessageAllowed(message: SlackMessageEvent): boolean {
    // Check workspace restrictions
    if (this.allowedWorkspaces.size > 0 && message.team) {
      if (!this.allowedWorkspaces.has(message.team)) {
        return false;
      }
    }

    // Check channel restrictions
    if (this.allowedChannels.size > 0) {
      if (!this.allowedChannels.has(message.channel)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert Slack message to IncomingMessage
   */
  private async convertMessage(message: SlackMessageEvent): Promise<IncomingMessage> {
    const attachments: Attachment[] = [];

    // Handle file attachments
    const fileMessage = message as SlackFileMessageEvent;
    if (fileMessage.files) {
      for (const file of fileMessage.files) {
        attachments.push({
          type: this.getAttachmentType(file.mimetype ?? ''),
          mimeType: file.mimetype ?? 'application/octet-stream',
          url: file.url_private ?? '',
          filename: file.name,
          size: file.size,
        });
      }
    }

    // Get user info for sender name
    let senderName = message.user;
    if (this.app && message.user) {
      try {
        const userInfo = await this.getSenderInfo(message.user);
        if (userInfo?.name) {
          senderName = userInfo.name;
        }
      } catch {
        // Ignore errors fetching user info
      }
    }

    return {
      id: `${message.channel}:${message.ts}`,
      channelId: this.id,
      channelType: 'slack',
      senderId: message.user ?? 'unknown',
      senderName: senderName ?? 'Unknown',
      content: message.text ?? '',
      timestamp: new Date(parseFloat(message.ts) * 1000),
      replyToId: message.thread_ts !== message.ts ? message.thread_ts : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      metadata: {
        channel: message.channel,
        ts: message.ts,
        threadTs: message.thread_ts,
        team: message.team,
      },
    };
  }

  /**
   * Get attachment type from MIME type
   */
  private getAttachmentType(mimeType: string): Attachment['type'] {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
  }

  /**
   * Parse channel ID from our format
   */
  private parseChannelId(channelId: string): string {
    // Channel ID might be in format "workspaceId:channelId" or just "channelId"
    const parts = channelId.split(':');
    return parts.length > 1 ? parts[1]! : parts[0]!;
  }
}

/**
 * Factory function for Slack adapter
 */
export function createSlackAdapter(config: SlackConfig): SlackAdapter {
  return new SlackAdapter(config);
}
