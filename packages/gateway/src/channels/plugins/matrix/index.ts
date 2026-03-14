/**
 * Matrix Channel Plugin
 *
 * Registers Matrix/Element as a channel plugin using the
 * Matrix Client-Server HTTP API directly (no external SDK).
 * Provides homeserver credentials configuration via Config Center
 * and exposes ChannelPluginAPI for unified channel management.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { MatrixChannelAPI } from './matrix-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildMatrixChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.matrix',
      name: 'Matrix',
      version: '1.0.0',
      description: 'Matrix/Element messaging — connect to any Matrix homeserver',
      author: { name: 'OwnPilot' },
      capabilities: ['events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '🟢',
      requiredServices: [
        {
          name: 'matrix_bot',
          displayName: 'Matrix Bot',
          category: 'channels',
          docsUrl: 'https://spec.matrix.org/latest/client-server-api/',
          configSchema: [
            {
              name: 'homeserver_url',
              label: 'Homeserver URL',
              type: 'string',
              required: true,
              description: 'Matrix homeserver URL (e.g. https://matrix.org)',
              placeholder: 'https://matrix.org',
              order: 0,
            },
            {
              name: 'access_token',
              label: 'Access Token',
              type: 'secret',
              required: true,
              description: 'Bot account access token',
              placeholder: 'syt_...',
              order: 1,
            },
            {
              name: 'user_id',
              label: 'Bot User ID',
              type: 'string',
              required: true,
              description: 'Full Matrix user ID for the bot account',
              placeholder: '@mybot:matrix.org',
              order: 2,
            },
            {
              name: 'auto_join',
              label: 'Auto-join Rooms',
              type: 'boolean',
              defaultValue: true,
              description: 'Automatically join rooms when invited',
              order: 3,
            },
            {
              name: 'allowed_rooms',
              label: 'Allowed Room IDs',
              type: 'string',
              description: 'Comma-separated room IDs (empty = all)',
              placeholder: '!abc123:matrix.org,!def456:matrix.org',
              order: 4,
            },
          ],
        },
      ],
    })
    .platform('matrix')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        homeserver_url:
          (config.homeserver_url as string) ??
          (configServicesRepo.getFieldValue('matrix_bot', 'homeserver_url') as string) ??
          '',
        access_token:
          config.access_token ??
          (configServicesRepo.getFieldValue('matrix_bot', 'access_token') as string) ??
          '',
        user_id:
          (config.user_id as string) ??
          (configServicesRepo.getFieldValue('matrix_bot', 'user_id') as string) ??
          '',
      };
      return new MatrixChannelAPI(resolvedConfig, 'channel.matrix');
    })
    .tool(
      {
        name: 'channel_matrix_send',
        description: 'Send a message to a Matrix room via the connected bot',
        parameters: {
          type: 'object',
          properties: {
            room_id: {
              type: 'string',
              description: 'Matrix room ID to send the message to (e.g. !abc123:matrix.org)',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['room_id', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.matrix');
        if (!api || api.getStatus() !== 'connected') {
          return {
            content: 'Matrix bot is not connected. Please connect it first.',
          };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.room_id),
          text: String(params.text),
        });
        return {
          content: `Message sent to room ${params.room_id} (event ID: ${msgId})`,
        };
      }
    )
    .build();
}

export { MatrixChannelAPI } from './matrix-api.js';
