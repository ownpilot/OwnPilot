/**
 * Connection Event Helpers
 *
 * DRYs up the repeated EventBus emission + WebSocket broadcast pattern
 * in channel connect/disconnect/logout flows.
 */

import { getEventBus, createEvent } from '@ownpilot/core/events';
import { ChannelEvents, type ChannelConnectionEventData } from '@ownpilot/core/channels';
import type { ChannelPlatform } from '@ownpilot/core/channels';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('ConnectionEvents');

/**
 * Emit a channel connection-status event and broadcast it to WS clients.
 * Errors from the EventBus are logged as warnings (the bus may not be
 * initialized during boot); errors from wsGateway are silently ignored
 * (no listeners is a valid state).
 */
export function emitConnectionEvent(
  channelPluginId: string,
  platform: ChannelPlatform,
  status: ChannelConnectionEventData['status']
): void {
  try {
    const eventBus = getEventBus();
    eventBus.emit(
      createEvent<ChannelConnectionEventData>(
        status === 'connecting'
          ? ChannelEvents.CONNECTING
          : status === 'disconnected'
            ? ChannelEvents.DISCONNECTED
            : ChannelEvents.CONNECTED,
        'channel',
        'channel-service',
        { channelPluginId, platform, status }
      )
    );
  } catch (emitErr) {
    log.warn('EventBus not available for connection event', {
      channelPluginId,
      status,
      error: emitErr,
    });
  }

  try {
    wsGateway.broadcast('channel:status', { channelId: channelPluginId, status });
  } catch (broadcastErr) {
    log.warn('Failed to broadcast channel connection status', {
      channelPluginId,
      status,
      error: broadcastErr,
    });
  }
}
