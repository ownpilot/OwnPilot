/**
 * LINE Channel Plugin
 *
 * Webhook-based messaging via @line/bot-sdk.
 * Flex Messages, reply token management.
 */

import {
  createChannelPlugin,
  type PluginCapability,
  type PluginPermission,
} from '@ownpilot/core';
import { LINEChannelAPI } from './line-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildLINEChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.line',
      name: 'LINE',
      version: '1.0.0',
      description: 'Connect to LINE Messaging API for real-time messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '🟢',
      requiredServices: [
        {
          name: 'line_messaging',
          displayName: 'LINE Messaging API',
          category: 'channels',
          docsUrl: 'https://developers.line.biz/en/docs/messaging-api/',
          configSchema: [
            {
              name: 'channel_access_token',
              label: 'Channel Access Token',
              type: 'secret',
              required: true,
              description: 'Long-lived token from LINE Developers Console',
              order: 0,
            },
            {
              name: 'channel_secret',
              label: 'Channel Secret',
              type: 'secret',
              required: true,
              description: 'Channel secret for webhook verification',
              order: 1,
            },
            {
              name: 'webhook_port',
              label: 'Webhook Port',
              type: 'number',
              defaultValue: 3100,
              description: 'Port for LINE webhook server',
              order: 2,
            },
          ],
        },
      ],
    })
    .platform('line')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        channel_access_token:
          config.channel_access_token ??
          configServicesRepo.getApiKey('line_messaging') ??
          '',
      };
      return new LINEChannelAPI(resolvedConfig, 'channel.line');
    })
    .tool(
      {
        name: 'channel_line_send',
        description: 'Send a message to a LINE user or group',
        parameters: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'LINE user ID or group ID to send the message to',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['user_id', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.line');
        if (!api || api.getStatus() !== 'connected') {
          return { content: 'LINE bot is not connected. Please connect it first.' };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.user_id),
          text: String(params.text),
        });
        return { content: `LINE message sent to ${params.user_id} (ID: ${msgId})` };
      }
    )
    .build();
}
