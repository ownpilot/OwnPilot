/**
 * Channel Communication Tools
 *
 * Tools for sending messages through channel plugins.
 * Uses the unified IChannelService for all channel operations.
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import { getChannelService } from '@ownpilot/core';

/**
 * Send message to channel tool definition
 */
export const sendChannelMessageTool: ToolDefinition = {
  name: 'send_channel_message',
  description: `Send a message to a communication channel (Telegram, Discord, Slack, WhatsApp, LINE, Matrix).
Use this to:
- Send notifications to users
- Deliver scheduled task results
- Reply to users on external channels
- Send reminders and alerts`,
  parameters: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'Channel plugin ID (e.g., "channel.telegram") or leave empty for auto-detection',
      },
      platform: {
        type: 'string',
        description: 'Platform type (telegram, discord, slack, whatsapp, line, matrix). Used for auto-detection if channelId is not specified.',
      },
      chatId: {
        type: 'string',
        description: 'Platform-specific chat/channel ID to send to',
      },
      message: {
        type: 'string',
        description: 'Message content to send',
      },
      replyToId: {
        type: 'string',
        description: 'Optional message ID to reply to',
      },
    },
    required: ['message'],
  },
};

/**
 * Send message to channel executor
 */
export const sendChannelMessageExecutor: ToolExecutor = async (
  args,
): Promise<ToolExecutionResult> => {
  try {
    const service = getChannelService();
    const message = args.message as string;
    let channelId = args.channelId as string | undefined;
    const platform = args.platform as string | undefined;
    const chatId = args.chatId as string | undefined;

    // If no channelId but platform, find a connected channel for that platform
    if (!channelId && platform) {
      const channels = service.getByPlatform(platform);
      const connected = channels.find((api) => api.getStatus() === 'connected');
      if (connected) {
        // Find the plugin ID from the channels list
        const info = service.listChannels().find(
          (c) => c.platform === platform && c.status === 'connected'
        );
        channelId = info?.pluginId;
      }
    }

    // If still no channelId, get any connected channel
    if (!channelId) {
      const info = service.listChannels().find((c) => c.status === 'connected');
      channelId = info?.pluginId;
    }

    if (!channelId) {
      return {
        content: JSON.stringify({
          error: 'No connected channels available',
          hint: 'Connect a channel first (e.g., configure Telegram bot token)',
        }),
        isError: true,
      };
    }

    if (!chatId) {
      return {
        content: JSON.stringify({
          error: 'chatId is required to send a message',
          hint: 'Provide the platform-specific chat/channel ID',
        }),
        isError: true,
      };
    }

    const messageId = await service.send(channelId, {
      platformChatId: chatId,
      text: message,
      replyToId: args.replyToId as string | undefined,
    });

    return {
      content: JSON.stringify({
        success: true,
        channelId,
        messageId,
        message: `Message sent to ${channelId} (chat: ${chatId})`,
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: 'Failed to send message',
        details: error instanceof Error ? error.message : String(error),
      }),
      isError: true,
    };
  }
};

/**
 * List connected channels tool definition
 */
export const listChannelsTool: ToolDefinition = {
  name: 'list_channels',
  description: 'List all registered channel plugins and their connection status',
  parameters: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Filter by platform (telegram, discord, slack, whatsapp, line, matrix)',
      },
    },
    required: [],
  },
};

/**
 * List channels executor
 */
export const listChannelsExecutor: ToolExecutor = async (
  args,
): Promise<ToolExecutionResult> => {
  try {
    const service = getChannelService();
    const platform = args.platform as string | undefined;

    let channels = service.listChannels();

    if (platform) {
      channels = channels.filter((c) => c.platform === platform);
    }

    return {
      content: JSON.stringify({
        count: channels.length,
        channels: channels.map((c) => ({
          pluginId: c.pluginId,
          platform: c.platform,
          name: c.name,
          status: c.status,
          icon: c.icon,
        })),
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: 'Failed to list channels',
        details: error instanceof Error ? error.message : String(error),
      }),
      isError: true,
    };
  }
};

/**
 * All channel tools
 */
export const CHANNEL_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: sendChannelMessageTool, executor: sendChannelMessageExecutor },
  { definition: listChannelsTool, executor: listChannelsExecutor },
];

/**
 * Tool names for reference
 */
export const CHANNEL_TOOL_NAMES = CHANNEL_TOOLS.map((t) => t.definition.name);

