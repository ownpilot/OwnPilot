/**
 * Slack Channel Plugin
 *
 * Socket Mode messaging via @slack/bolt.
 * Thread-aware replies, Block Kit support.
 */

import {
  createChannelPlugin,
  type PluginCapability,
  type PluginPermission,
} from '@ownpilot/core';
import { SlackChannelAPI } from './slack-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildSlackChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.slack',
      name: 'Slack',
      version: '1.0.0',
      description: 'Connect to Slack workspace via Bot API with Socket Mode',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '📨',
      requiredServices: [
        {
          name: 'slack_bot',
          displayName: 'Slack Bot',
          category: 'channels',
          docsUrl: 'https://api.slack.com/start/building/bolt-js',
          configSchema: [
            {
              name: 'bot_token',
              label: 'Bot Token (xoxb-...)',
              type: 'secret',
              required: true,
              description: 'Bot User OAuth Token from Slack App settings',
              order: 0,
            },
            {
              name: 'app_token',
              label: 'App Token (xapp-...)',
              type: 'secret',
              required: true,
              description: 'App-Level Token for Socket Mode',
              order: 1,
            },
            {
              name: 'signing_secret',
              label: 'Signing Secret',
              type: 'secret',
              description: 'App Signing Secret (optional for Socket Mode)',
              order: 2,
            },
            {
              name: 'allowed_channels',
              label: 'Allowed Channel IDs',
              type: 'string',
              description: 'Comma-separated Slack channel IDs (empty = all)',
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
          configServicesRepo.getApiKey('slack_bot') ??
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
            thread_ts: {
              type: 'string',
              description: 'Thread timestamp to reply in (optional)',
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
          return { content: 'Slack bot is not connected. Please connect it first.' };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.channel_id),
          text: String(params.text),
          replyToId: params.thread_ts ? String(params.thread_ts) : undefined,
        });
        return { content: `Slack message sent to channel ${params.channel_id} (ts: ${msgId})` };
      }
    )
    .build();
}
