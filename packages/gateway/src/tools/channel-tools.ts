/**
 * Channel Communication Tools
 *
 * Tools for sending messages through various channels (Telegram, etc.)
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult, ToolContext } from '@ownpilot/core';

// Channel manager interface for injection
interface ChannelManagerLike {
  send: (channelId: string, message: { content: string; channelId: string; replyToId?: string }) => Promise<string>;
  getAll: () => Array<{ id: string; type: string; status: string }>;
  getByType: (type: string) => Array<{ id: string; type: string; status: string }>;
}

// Channel manager will be injected at registration time
let channelManagerInstance: ChannelManagerLike | null = null;

/**
 * Set the channel manager instance
 * Uses 'unknown' to allow any compatible channel manager implementation
 */
export function setChannelManager(manager: unknown): void {
  channelManagerInstance = manager as ChannelManagerLike;
}

/**
 * Send message to channel tool definition
 */
export const sendChannelMessageTool: ToolDefinition = {
  name: 'send_channel_message',
  description: `Send a message to a communication channel (Telegram, etc.).
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
        description: 'Channel ID to send to (e.g., "telegram:123456789" or just the channel ID)',
      },
      channelType: {
        type: 'string',
        description: 'Type of channel (telegram, discord, etc.). If not specified, will try to detect from channelId.',
        enum: ['telegram', 'discord', 'slack', 'webhook'],
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
  context
): Promise<ToolExecutionResult> => {
  if (!channelManagerInstance) {
    return {
      content: JSON.stringify({
        error: 'Channel manager not configured',
        hint: 'Ensure channels are set up in the gateway',
      }),
      isError: true,
    };
  }

  try {
    const message = args.message as string;
    let channelId = args.channelId as string | undefined;
    const channelType = args.channelType as string | undefined;

    // If no channelId but channelType, get first channel of that type
    if (!channelId && channelType) {
      const channels = channelManagerInstance.getByType(channelType);
      const connectedChannel = channels.find(c => c.status === 'connected');
      if (connectedChannel) {
        channelId = connectedChannel.id;
      }
    }

    // If still no channelId, get any connected channel
    if (!channelId) {
      const allChannels = channelManagerInstance.getAll();
      const connectedChannel = allChannels.find(c => c.status === 'connected');
      if (connectedChannel) {
        channelId = connectedChannel.id;
      }
    }

    if (!channelId) {
      return {
        content: JSON.stringify({
          error: 'No connected channels available',
          hint: 'Connect a channel first (e.g., Telegram bot)',
        }),
        isError: true,
      };
    }

    const messageId = await channelManagerInstance.send(channelId, {
      content: message,
      channelId,
      replyToId: args.replyToId as string | undefined,
    });

    return {
      content: JSON.stringify({
        success: true,
        channelId,
        messageId,
        message: `Message sent successfully to ${channelId}`,
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
  description: 'List all connected communication channels (Telegram bots, etc.)',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Filter by channel type',
        enum: ['telegram', 'discord', 'slack', 'webhook'],
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
  _context
): Promise<ToolExecutionResult> => {
  if (!channelManagerInstance) {
    return {
      content: JSON.stringify({
        error: 'Channel manager not configured',
        channels: [],
      }),
      isError: true,
    };
  }

  try {
    const channelType = args.type as string | undefined;
    const channels = channelType
      ? channelManagerInstance.getByType(channelType)
      : channelManagerInstance.getAll();

    return {
      content: JSON.stringify({
        count: channels.length,
        channels: channels.map(c => ({
          id: c.id,
          type: c.type,
          status: c.status,
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
export const CHANNEL_TOOL_NAMES = CHANNEL_TOOLS.map(t => t.definition.name);
