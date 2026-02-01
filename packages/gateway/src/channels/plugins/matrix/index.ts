/**
 * Matrix Channel Plugin
 *
 * Client-Server API via matrix-js-sdk.
 * Room management, optional E2EE, federation-aware.
 */

import {
  createChannelPlugin,
  type PluginCapability,
  type PluginPermission,
} from '@ownpilot/core';
import { MatrixChannelAPI } from './matrix-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildMatrixChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.matrix',
      name: 'Matrix',
      version: '1.0.0',
      description: 'Connect to Matrix network via Client-Server API',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '🔗',
      requiredServices: [
        {
          name: 'matrix_server',
          displayName: 'Matrix Server',
          category: 'channels',
          docsUrl: 'https://spec.matrix.org/latest/client-server-api/',
          configSchema: [
            {
              name: 'homeserver_url',
              label: 'Homeserver URL',
              type: 'url',
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
              description: 'Bot user access token',
              order: 1,
            },
            {
              name: 'user_id',
              label: 'User ID',
              type: 'string',
              required: true,
              description: 'Bot user ID (e.g. @bot:matrix.org)',
              placeholder: '@ownpilot:matrix.org',
              order: 2,
            },
            {
              name: 'allowed_rooms',
              label: 'Allowed Room IDs',
              type: 'string',
              description: 'Comma-separated room IDs (empty = all)',
              placeholder: '!abc123:matrix.org',
              order: 3,
            },
          ],
        },
      ],
    })
    .platform('matrix')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        access_token:
          config.access_token ??
          configServicesRepo.getApiKey('matrix_server') ??
          '',
      };
      return new MatrixChannelAPI(resolvedConfig, 'channel.matrix');
    })
    .tool(
      {
        name: 'channel_matrix_send',
        description: 'Send a message to a Matrix room',
        parameters: {
          type: 'object',
          properties: {
            room_id: {
              type: 'string',
              description: 'Matrix room ID to send the message to',
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
          return { content: 'Matrix client is not connected. Please connect it first.' };
        }
        const eventId = await api.sendMessage({
          platformChatId: String(params.room_id),
          text: String(params.text),
        });
        return { content: `Matrix message sent to ${params.room_id} (event: ${eventId})` };
      }
    )
    .build();
}
