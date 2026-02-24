/**
 * Tests for the Pulse Reporter
 *
 * Covers all branches of reportPulseResult:
 * - No broadcaster (early return)
 * - Broadcast notification when reportMessage is set
 * - Broadcast notification when a successful non-skipped action exists
 * - No notification when there's no reportMessage and no successful actions
 * - data:changed events for memories, goals, notifications
 * - Skipped / failed actions are excluded from data:changed
 * - Error handling (broadcaster throws)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PulseResult } from '@ownpilot/core';
import type { Broadcaster } from './reporter.js';

// ============================================================================
// Mock log so we can assert on log.debug in the error branch
// ============================================================================

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

// ============================================================================
// Helpers
// ============================================================================

function makeResult(overrides: Partial<PulseResult> = {}): PulseResult {
  return {
    pulseId: 'pulse-1',
    userId: 'user-1',
    timestamp: new Date(),
    signalsFound: 0,
    llmCalled: false,
    actionsExecuted: [],
    reportMessage: '',
    urgencyScore: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('reportPulseResult', () => {
  let reportPulseResult: typeof import('./reporter.js').reportPulseResult;
  let mockBroadcaster: Broadcaster;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ reportPulseResult } = await import('./reporter.js'));
    mockBroadcaster = vi.fn();
  });

  // --------------------------------------------------------------------------
  // Early return when no broadcaster
  // --------------------------------------------------------------------------

  it('returns immediately when no broadcaster is provided', async () => {
    const result = makeResult({ reportMessage: 'Something happened' });
    await reportPulseResult(result);
    // No error thrown, no broadcaster called
  });

  it('returns immediately when broadcaster is undefined', async () => {
    const result = makeResult({ reportMessage: 'Something happened' });
    await reportPulseResult(result, undefined);
    // No error thrown
  });

  // --------------------------------------------------------------------------
  // Notification broadcasting
  // --------------------------------------------------------------------------

  it('broadcasts system:notification when reportMessage is set', async () => {
    const result = makeResult({
      pulseId: 'p-100',
      reportMessage: 'Daily summary ready.',
      signalsFound: 3,
      urgencyScore: 42,
      actionsExecuted: [],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('system:notification', {
      type: 'info',
      message: 'Daily summary ready.',
      action: 'pulse',
      data: {
        pulseId: 'p-100',
        signalsFound: 3,
        actionsExecuted: 0,
        urgencyScore: 42,
      },
    });
  });

  it('broadcasts notification with default message when reportMessage is empty but a successful action exists', async () => {
    const result = makeResult({
      pulseId: 'p-200',
      reportMessage: '',
      signalsFound: 1,
      urgencyScore: 10,
      actionsExecuted: [{ type: 'create_memory', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('system:notification', {
      type: 'info',
      message: 'Pulse cycle completed.',
      action: 'pulse',
      data: {
        pulseId: 'p-200',
        signalsFound: 1,
        actionsExecuted: 1,
        urgencyScore: 10,
      },
    });
  });

  it('does not broadcast notification when reportMessage is empty and all actions are skipped', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [{ type: 'create_memory', success: true, skipped: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    // No system:notification call — only data:changed might be emitted (but
    // skipped actions are excluded from that too).
    expect(mockBroadcaster).not.toHaveBeenCalledWith('system:notification', expect.anything());
  });

  it('does not broadcast notification when reportMessage is empty and all actions failed', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [{ type: 'create_memory', success: false, output: {}, error: 'fail' }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).not.toHaveBeenCalledWith('system:notification', expect.anything());
  });

  it('does not broadcast notification when reportMessage is empty and no actions exist', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // data:changed events — entity type mapping
  // --------------------------------------------------------------------------

  it('emits data:changed for memories on create_memory action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'create_memory', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'memories' });
  });

  it('emits data:changed for memories on run_memory_cleanup action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'run_memory_cleanup', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'memories' });
  });

  it('emits data:changed for goals on update_goal_progress action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'update_goal_progress', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'goals' });
  });

  it('emits data:changed for notifications on send_user_notification action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'send_user_notification', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'notifications' });
  });

  it('deduplicates data:changed events for the same entity type', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [
        { type: 'create_memory', success: true, output: {} },
        { type: 'run_memory_cleanup', success: true, output: {} },
      ],
    });

    await reportPulseResult(result, mockBroadcaster);

    // Should only get ONE data:changed for 'memories', not two
    const dataChangedCalls = (mockBroadcaster as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([event]: [string]) => event === 'data:changed'
    );
    const memoriesCalls = dataChangedCalls.filter(
      ([, data]: [string, { type: string }]) => data.type === 'memories'
    );
    expect(memoriesCalls).toHaveLength(1);
  });

  it('emits multiple data:changed events for different entity types', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [
        { type: 'create_memory', success: true, output: {} },
        { type: 'update_goal_progress', success: true, output: {} },
        { type: 'send_user_notification', success: true, output: {} },
      ],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'memories' });
    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'goals' });
    expect(mockBroadcaster).toHaveBeenCalledWith('data:changed', { type: 'notifications' });
  });

  // --------------------------------------------------------------------------
  // Skipped / failed actions excluded from data:changed
  // --------------------------------------------------------------------------

  it('does not emit data:changed for skipped actions', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'create_memory', success: true, skipped: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).not.toHaveBeenCalledWith('data:changed', { type: 'memories' });
  });

  it('does not emit data:changed for failed actions', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [
        { type: 'update_goal_progress', success: false, output: {}, error: 'boom' },
      ],
    });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).not.toHaveBeenCalledWith('data:changed', { type: 'goals' });
  });

  it('does not emit data:changed for unrecognized action types', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'some_unknown_action', success: true, output: {} }],
    });

    await reportPulseResult(result, mockBroadcaster);

    // Only the notification call, no data:changed
    const dataChangedCalls = (mockBroadcaster as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([event]: [string]) => event === 'data:changed'
    );
    expect(dataChangedCalls).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  it('catches errors from broadcaster and logs them via log.debug', async () => {
    const throwingBroadcaster: Broadcaster = () => {
      throw new Error('WebSocket closed');
    };

    const result = makeResult({
      reportMessage: 'test',
      actionsExecuted: [],
    });

    // Should NOT throw
    await reportPulseResult(result, throwingBroadcaster);

    expect(mockLog.debug).toHaveBeenCalledWith('WebSocket broadcast failed', {
      error: 'Error: WebSocket closed',
    });
  });

  it('catches non-Error thrown values and stringifies them', async () => {
    const throwingBroadcaster: Broadcaster = () => {
      throw 'plain string error';
    };

    const result = makeResult({
      reportMessage: 'test',
      actionsExecuted: [],
    });

    await reportPulseResult(result, throwingBroadcaster);

    expect(mockLog.debug).toHaveBeenCalledWith('WebSocket broadcast failed', {
      error: 'plain string error',
    });
  });
});
