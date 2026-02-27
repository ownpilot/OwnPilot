/**
 * Slack Channel Plugin
 *
 * Registers Slack as a channel plugin using @slack/web-api.
 * Supports Socket Mode (development) and Events API (production).
 * Provides configuration via Config Center and exposes
 * ChannelPluginAPI for unified channel management.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { SlackChannelAPI } from './slack-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildSlackChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.slack',
      name: 'Slack',
      version: '1.0.0',
      description: 'Connect to Slack via Bot API for workspace messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '💼',
      requiredServices: [
        {
          name: 'slack_bot',
          displayName: 'Slack Bot',
          category: 'channels',
          docsUrl: 'https://api.slack.com/quickstart',
          configSchema: [
            {
              name: 'bot_token',
              label: 'Bot Token',
              type: 'secret',
              required: true,
              description: 'Bot User OAuth Token (xoxb-...)',
              placeholder: 'xoxb-1234567890-...',
              order: 0,
            },
            {
              name: 'signing_secret',
              label: 'Signing Secret',
              type: 'secret',
              required: true,
              description: 'Request signing secret for webhook verification',
              placeholder: 'abc123...',
              order: 1,
            },
            {
              name: 'app_token',
              label: 'App-Level Token',
              type: 'secret',
              description:
                'App-Level Token (xapp-...) for Socket Mode. If empty, uses Events API webhooks.',
              placeholder: 'xapp-1-...',
              order: 2,
            },
            {
              name: 'allowed_channels',
              label: 'Allowed Channel IDs',
              type: 'string',
              description: 'Comma-separated Slack channel IDs (empty = all)',
              placeholder: 'C01ABC123,C02DEF456',
              order: 3,
            },
          ],
        },
      ],
    })
    .platform('slack')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        bot_token:
          config.bot_token ??
          (configServicesRepo.getFieldValue('slack_bot', 'bot_token') as string) ??
          '',
        signing_secret:
          (config.signing_secret as string) ??
          (configServicesRepo.getFieldValue('slack_bot', 'signing_secret') as string) ??
          '',
        app_token:
          (config.app_token as string) ??
          (configServicesRepo.getFieldValue('slack_bot', 'app_token') as string) ??
          '',
      };
      return new SlackChannelAPI(resolvedConfig, 'channel.slack');
    })
    .tool(
      {
        name: 'channel_slack_send',
        description: 'Send a message to a Slack channel via the connected bot',
        parameters: {
          type: 'object',
          properties: {
            channel_id: {
              type: 'string',
              description: 'Slack channel ID to send the message to',
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
        const api = service.getChannel('channel.slack');
        if (!api || api.getStatus() !== 'connected') {
          return {
            content: 'Slack bot is not connected. Please connect it first.',
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
