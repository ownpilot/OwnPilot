/**
 * Discord Channel Plugin
 *
 * Registers Discord as a channel plugin using discord.js.
 * Provides bot token configuration via Config Center and
 * exposes ChannelPluginAPI for unified channel management.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { DiscordChannelAPI } from './discord-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildDiscordChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.discord',
      name: 'Discord',
      version: '1.0.0',
      description: 'Connect to Discord via Bot API for real-time messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '🎮',
      requiredServices: [
        {
          name: 'discord_bot',
          displayName: 'Discord Bot',
          category: 'channels',
          docsUrl: 'https://discord.com/developers/docs/getting-started',
          configSchema: [
            {
              name: 'bot_token',
              label: 'Bot Token',
              type: 'secret',
              required: true,
              description: 'Token from Discord Developer Portal → Bot section',
              placeholder: 'MTIz...abc',
              order: 0,
            },
            {
              name: 'application_id',
              label: 'Application ID',
              type: 'string',
              description: 'Discord application ID (for slash commands)',
              placeholder: '123456789012345678',
              order: 1,
            },
            {
              name: 'allowed_guilds',
              label: 'Allowed Guild IDs',
              type: 'string',
              description: 'Comma-separated guild (server) IDs (empty = all)',
              placeholder: '123456789012345678,987654321098765432',
              order: 2,
            },
            {
              name: 'allowed_channels',
              label: 'Allowed Channel IDs',
              type: 'string',
              description: 'Comma-separated channel IDs (empty = all)',
              placeholder: '123456789012345678',
              order: 3,
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
          (configServicesRepo.getFieldValue('discord_bot', 'bot_token') as string) ??
          '',
        application_id:
          (config.application_id as string) ??
          (configServicesRepo.getFieldValue('discord_bot', 'application_id') as string) ??
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
          return {
            content: 'Discord bot is not connected. Please connect it first.',
          };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.channel_id),
          text: String(params.text),
        });
        return {
          content: `Message sent to channel ${params.channel_id} (message ID: ${msgId})`,
        };
      }
    )
    .build();
}
