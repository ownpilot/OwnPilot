import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerEvents } from './types.js';

type LegacyEvent = { type: string; data: unknown };
type LegacyHandler = (event: LegacyEvent) => void;

const { mockEventSystem, patternHandlers, anyHandlers, directHandlers } = vi.hoisted(() => {
  const patternHandlers: Array<{ pattern: string; handler: LegacyHandler }> = [];
  const anyHandlers: Array<{ type: string; handler: LegacyHandler }> = [];
  const directHandlers: Array<{ type: string; handler: LegacyHandler }> = [];

  const mockEventSystem = {
    onPattern: vi.fn((pattern: string, handler: LegacyHandler) => {
      patternHandlers.push({ pattern, handler });
      return vi.fn();
    }),
    onAny: vi.fn((type: string, handler: LegacyHandler) => {
      anyHandlers.push({ type, handler });
      return vi.fn();
    }),
    on: vi.fn((type: string, handler: LegacyHandler) => {
      directHandlers.push({ type, handler });
      return vi.fn();
    }),
  };

  return { mockEventSystem, patternHandlers, anyHandlers, directHandlers };
});

vi.mock('@ownpilot/core/events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventSystem: vi.fn(() => mockEventSystem),
}));

import { setupLegacyEventForwarding } from './legacy-events.js';

describe('legacy-events', () => {
  let broadcasts: Array<{ event: keyof ServerEvents; payload: ServerEvents[keyof ServerEvents] }>;
  let broadcast: <K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    patternHandlers.length = 0;
    anyHandlers.length = 0;
    directHandlers.length = 0;
    broadcasts = [];
    broadcast = vi.fn(<K extends keyof ServerEvents>(event: K, payload: ServerEvents[K]) => {
      broadcasts.push({ event, payload });
    });
  });

  function pattern(pattern: string): LegacyHandler {
    const match = patternHandlers.find((entry) => entry.pattern === pattern);
    expect(match).toBeDefined();
    return match!.handler;
  }

  function any(type: string): LegacyHandler {
    const match = anyHandlers.find((entry) => entry.type === type);
    expect(match).toBeDefined();
    return match!.handler;
  }

  it('registers all legacy forwarders and returns their unsubscribe callbacks', () => {
    const unsubs = setupLegacyEventForwarding(broadcast);

    expect(unsubs).toHaveLength(12);
    expect(mockEventSystem.onPattern).toHaveBeenCalledWith('trigger.*', expect.any(Function));
    expect(mockEventSystem.onPattern).toHaveBeenCalledWith('pulse.*', expect.any(Function));
    expect(mockEventSystem.onPattern).toHaveBeenCalledWith('claw.*', expect.any(Function));
    expect(mockEventSystem.onPattern).toHaveBeenCalledWith('channel.user.*', expect.any(Function));
    expect(mockEventSystem.on).toHaveBeenCalledWith(
      'gateway.system.notification',
      expect.any(Function)
    );
    expect(mockEventSystem.onAny).toHaveBeenCalledWith('claw.output', expect.any(Function));
  });

  it('maps trigger success and failure events to trigger:executed', () => {
    setupLegacyEventForwarding(broadcast);
    const handler = pattern('trigger.*');

    handler({
      type: 'trigger.success',
      data: { triggerId: 'tr-1', triggerName: 'Morning', durationMs: 42 },
    });
    handler({
      type: 'trigger.failed',
      data: { triggerId: 'tr-2', triggerName: 'Night', durationMs: 13, error: 'boom' },
    });

    expect(broadcasts).toEqual([
      {
        event: 'trigger:executed',
        payload: {
          triggerId: 'tr-1',
          triggerName: 'Morning',
          status: 'success',
          durationMs: 42,
          error: undefined,
        },
      },
      {
        event: 'trigger:executed',
        payload: {
          triggerId: 'tr-2',
          triggerName: 'Night',
          status: 'failure',
          durationMs: 13,
          error: 'boom',
        },
      },
    ]);
  });

  it('maps pulse events to pulse:activity with derived status', () => {
    setupLegacyEventForwarding(broadcast);

    pattern('pulse.*')({
      type: 'pulse.stage',
      data: { stage: 'planning', pulseId: 'pulse-1', signalsFound: 3 },
    });

    expect(broadcast).toHaveBeenCalledWith('pulse:activity', {
      status: 'stage',
      stage: 'planning',
      pulseId: 'pulse-1',
      signalsFound: 3,
    });
  });

  it('forwards claw plan updates as the structured plan payload', () => {
    setupLegacyEventForwarding(broadcast);
    const planPayload: ServerEvents['claw:plan:updated'] = {
      clawId: 'claw-1',
      source: 'replace',
      tasks: [
        {
          id: 'task-1',
          title: 'Check status',
          status: 'pending',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      ],
      counts: { total: 1, pending: 1, in_progress: 0, completed: 0, blocked: 0 },
    };

    pattern('claw.*')({ type: 'claw.plan.updated', data: planPayload });

    expect(broadcast).toHaveBeenCalledWith('claw:plan:updated', planPayload);
  });

  it('maps claw output and channel first-seen events for legacy UI consumers', () => {
    setupLegacyEventForwarding(broadcast);

    any('claw.output')({
      type: 'claw.output',
      data: {
        clawId: 'claw-1',
        message: 'Need approval',
        urgency: 'high',
        timestamp: '2026-06-23T01:02:03.000Z',
      },
    });
    pattern('channel.user.*')({
      type: 'channel.user.first_seen',
      data: {
        channelPluginId: 'telegram',
        platform: 'telegram',
        user: { platformUserId: 'u-1', displayName: 'Ada' },
      },
    });

    expect(broadcasts).toEqual([
      {
        event: 'claw:output',
        payload: {
          clawId: 'claw-1',
          message: 'Need approval',
          urgency: 'high',
          timestamp: '2026-06-23T01:02:03.000Z',
        },
      },
      {
        event: 'channel:user:first_seen',
        payload: {
          channelId: 'telegram',
          platform: 'telegram',
          platformUserId: 'u-1',
          displayName: 'Ada',
        },
      },
    ]);
  });
});
