/**
 * Discord Channel Plugin
 *
 * Native Discord REST + Gateway implementation.
 * No discord.js dependency - uses raw API for minimal footprint.
 */

import {
  createChannelPlugin,
  type PluginCapability,
  type PluginPermission,
} from '@ownpilot/core';
import { DiscordChannelAPI } from './discord-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildDiscordChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.discord',
      name: 'Discord',
      version: '1.0.0',
      description: 'Connect to Discord via native Bot API with Gateway events',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '🎮',
      requiredServices: [
        {
          name: 'discord_bot',
          displayName: 'Discord Bot',
          category: 'channels',
          docsUrl: 'https://discord.com/developers/docs/intro',
          configSchema: [
            {
              name: 'bot_token',
              label: 'Bot Token',
              type: 'secret',
              required: true,
              description: 'Token from Discord Developer Portal',
              order: 0,
            },
            {
              name: 'allowed_guilds',
              label: 'Allowed Server IDs',
              type: 'string',
              description: 'Comma-separated Discord server/guild IDs (empty = all)',
              order: 1,
            },
            {
              name: 'allowed_channels',
              label: 'Allowed Channel IDs',
              type: 'string',
              description: 'Comma-separated Discord channel IDs (empty = all)',
              order: 2,
            },
          ],
        },
      ],
    })
    .platform('discord')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        bot_token:
          config.bot_token ??
          configServicesRepo.getApiKey('discord_bot') ??
          '',
      };
      return new DiscordChannelAPI(resolvedConfig, 'channel.discord');
    })
    .tool(
      {
        name: 'channel_discord_send',
        description: 'Send a message to a Discord channel via the connected bot',
        parameters: {
          type: 'object',
          properties: {
            channel_id: {
              type: 'string',
              description: 'Discord channel ID to send the message to',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['channel_id', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.discord');
        if (!api || api.getStatus() !== 'connected') {
          return { content: 'Discord bot is not connected. Please connect it first.' };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.channel_id),
          text: String(params.text),
        });
        return { content: `Discord message sent to channel ${params.channel_id} (ID: ${msgId})` };
      }
    )
    .build();
}
