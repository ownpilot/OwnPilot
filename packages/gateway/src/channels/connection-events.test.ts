import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelEvents } from '@ownpilot/core/channels';

const { mockBroadcast, mockCreateEvent, mockEmit, mockGetEventBus, mockLog } = vi.hoisted(() => ({
  mockBroadcast: vi.fn(),
  mockCreateEvent: vi.fn(
    (type: string, source: string, actor: string, data: Record<string, unknown>) => ({
      type,
      source,
      actor,
      data,
    })
  ),
  mockEmit: vi.fn(),
  mockGetEventBus: vi.fn(),
  mockLog: { warn: vi.fn() },
}));

vi.mock('@ownpilot/core/events', () => ({
  createEvent: mockCreateEvent,
  getEventBus: mockGetEventBus,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

import { emitConnectionEvent } from './connection-events.js';

describe('emitConnectionEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEventBus.mockReturnValue({ emit: mockEmit });
  });

  it.each([
    ['connecting', ChannelEvents.CONNECTING],
    ['connected', ChannelEvents.CONNECTED],
    ['disconnected', ChannelEvents.DISCONNECTED],
  ] as const)('maps %s status to the matching channel event', (status, eventType) => {
    emitConnectionEvent('telegram.main', 'telegram', status);

    expect(mockCreateEvent).toHaveBeenCalledWith(eventType, 'channel', 'channel-service', {
      channelPluginId: 'telegram.main',
      platform: 'telegram',
      status,
    });
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockBroadcast).toHaveBeenCalledWith('channel:status', {
      channelId: 'telegram.main',
      status,
    });
  });

  it('still broadcasts when the event bus is unavailable', () => {
    mockGetEventBus.mockImplementation(() => {
      throw new Error('not initialized');
    });

    emitConnectionEvent('discord.main', 'discord', 'connected');

    expect(mockLog.warn).toHaveBeenCalledWith(
      'EventBus not available for connection event',
      expect.objectContaining({ channelPluginId: 'discord.main', status: 'connected' })
    );
    expect(mockBroadcast).toHaveBeenCalledOnce();
  });

  it('contains WebSocket broadcast failures', () => {
    mockBroadcast.mockImplementation(() => {
      throw new Error('socket unavailable');
    });

    expect(() => emitConnectionEvent('slack.main', 'slack', 'disconnected')).not.toThrow();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'Failed to broadcast channel connection status',
      expect.objectContaining({ channelPluginId: 'slack.main', status: 'disconnected' })
    );
  });
});
