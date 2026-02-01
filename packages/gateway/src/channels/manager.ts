/**
 * Channel Manager (Bridge to IChannelService)
 *
 * Provides backward-compatible channelManager singleton.
 * All operations delegate to the unified IChannelService.
 *
 * @deprecated Use `getChannelService()` from '@ownpilot/core' directly.
 */

import {
  getChannelService,
  type IChannelService,
  type ChannelPluginAPI,
} from '@ownpilot/core';
import { getLog } from '../services/log.js';

const log = getLog('ChannelManager');

/**
 * Backward-compatible adapter wrapper.
 * Makes ChannelPluginAPI look like old ChannelAdapter.
 */
function wrapApi(pluginId: string, api: ChannelPluginAPI): {
  id: string;
  type: string;
  name: string;
  status: string;
} {
  return {
    id: pluginId,
    type: api.getPlatform(),
    name: pluginId,
    status: api.getStatus(),
  };
}

/**
 * @deprecated Use `getChannelService()` from '@ownpilot/core'.
 */
export class ChannelManager {
  private get service(): IChannelService {
    return getChannelService();
  }

  get(channelId: string) {
    const api = this.service.getChannel(channelId);
    return api ? wrapApi(channelId, api) : undefined;
  }

  getAll() {
    return this.service.listChannels().map((ch) => ({
      id: ch.pluginId,
      type: ch.platform,
      name: ch.name,
      status: ch.status,
    }));
  }

  getByType(type: string) {
    return this.service
      .listChannels()
      .filter((ch) => ch.platform === type)
      .map((ch) => ({
        id: ch.pluginId,
        type: ch.platform,
        name: ch.name,
        status: ch.status,
      }));
  }

  has(channelId: string): boolean {
    return this.service.getChannel(channelId) !== undefined;
  }

  async send(
    channelId: string,
    message: { content: string; channelId: string; replyToId?: string }
  ): Promise<string> {
    // Parse "adapterId:chatId" format from old system
    const parts = message.channelId.split(':');
    const chatId = parts.length > 1 ? parts.slice(1).join(':') : message.channelId;

    return this.service.send(channelId, {
      platformChatId: chatId,
      text: message.content,
      replyToId: message.replyToId,
    });
  }

  async connect(config: { id?: string; type?: string; [key: string]: unknown }) {
    const pluginId = config.id ?? `channel.${config.type}`;
    await this.service.connect(pluginId);
    return this.get(pluginId);
  }

  async disconnect(channelId: string): Promise<void> {
    await this.service.disconnect(channelId);
  }

  getStatus() {
    const channels = this.service.listChannels();
    const byType: Record<string, number> = {};
    for (const ch of channels) {
      byType[ch.platform] = (byType[ch.platform] ?? 0) + 1;
    }
    return {
      total: channels.length,
      connected: channels.filter((c) => c.status === 'connected').length,
      disconnected: channels.filter((c) => c.status === 'disconnected').length,
      error: channels.filter((c) => c.status === 'error').length,
      byType,
    };
  }

  async disconnectAll(): Promise<void> {
    const channels = this.service.listChannels();
    for (const ch of channels) {
      if (ch.status === 'connected') {
        await this.service.disconnect(ch.pluginId).catch((e) => log.error(e));
      }
    }
  }
}

/**
 * @deprecated Use `getChannelService()` from '@ownpilot/core'.
 */
export const channelManager = new ChannelManager();

/**
 * @deprecated No longer needed. Channel plugins are initialized by PluginRegistry.
 */
export async function initializeChannelFactories(): Promise<void> {
  log.info('[Channels] Legacy initializeChannelFactories is a no-op. Channels are now plugins.');
}
