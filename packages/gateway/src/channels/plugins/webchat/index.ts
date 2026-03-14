/**
 * Web Chat Channel Plugin
 *
 * Provides an embeddable web chat widget for websites.
 * Messages flow through WebSocket events via the existing wsGateway.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { WebChatChannelAPI } from './webchat-api.js';

export function buildWebChatChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.webchat',
      name: 'Web Chat',
      version: '1.0.0',
      description: 'Embeddable web chat widget for websites and the OwnPilot dashboard',
      author: { name: 'OwnPilot' },
      capabilities: ['events'] as PluginCapability[],
      permissions: [] as PluginPermission[],
      icon: '💬',
    })
    .platform('webchat')
    .channelApi((_config) => new WebChatChannelAPI(_config))
    .build();
}

export { WebChatChannelAPI } from './webchat-api.js';
