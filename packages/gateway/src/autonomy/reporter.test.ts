/**
 * Tests for the Pulse Reporter
 *
 * Covers all branches of reportPulseResult:
 * - Broadcast notification via EventBus when reportMessage is set
 * - Broadcast notification when a successful non-skipped action exists
 * - No notification when there's no reportMessage and no successful actions
 * - data:changed events for memories, goals, notifications
 * - Skipped / failed actions are excluded from data:changed
 * - Error handling (EventBus throws)
 * - Legacy broadcaster parameter is ignored
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PulseResult } from '@ownpilot/core';

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
// Mock EventSystem
// ============================================================================

const mockEventEmit = vi.fn();
const mockEventEmitRaw = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventSystem: vi.fn(() => ({
      emit: mockEventEmit,
      emitRaw: mockEventEmitRaw,
    })),
  };
});

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

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ reportPulseResult } = await import('./reporter.js'));
  });

  // --------------------------------------------------------------------------
  // Notification broadcasting via EventBus
  // --------------------------------------------------------------------------

  it('emits system notification via EventBus when reportMessage is set', async () => {
    const result = makeResult({
      pulseId: 'p-100',
      reportMessage: 'Daily summary ready.',
      signalsFound: 3,
      urgencyScore: 42,
      actionsExecuted: [],
    });

    await reportPulseResult(result);

    expect(mockEventEmit).toHaveBeenCalledWith(
      'gateway.system.notification',
      'pulse-reporter',
      {
        type: 'info',
        message: 'Daily summary ready.',
        action: 'pulse',
      }
    );
  });

  it('emits notification with default message when reportMessage is empty but a successful action exists', async () => {
    const result = makeResult({
      pulseId: 'p-200',
      reportMessage: '',
      signalsFound: 1,
      urgencyScore: 10,
      actionsExecuted: [{ type: 'create_memory', success: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmit).toHaveBeenCalledWith(
      'gateway.system.notification',
      'pulse-reporter',
      {
        type: 'info',
        message: 'Pulse cycle completed.',
        action: 'pulse',
      }
    );
  });

  it('does not emit notification when reportMessage is empty and all actions are skipped', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [{ type: 'create_memory', success: true, skipped: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmit).not.toHaveBeenCalledWith(
      'gateway.system.notification',
      expect.anything(),
      expect.anything()
    );
  });

  it('does not emit notification when reportMessage is empty and all actions failed', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [{ type: 'create_memory', success: false, output: {}, error: 'fail' }],
    });

    await reportPulseResult(result);

    expect(mockEventEmit).not.toHaveBeenCalledWith(
      'gateway.system.notification',
      expect.anything(),
      expect.anything()
    );
  });

  it('does not emit notification when reportMessage is empty and no actions exist', async () => {
    const result = makeResult({
      reportMessage: '',
      actionsExecuted: [],
    });

    await reportPulseResult(result);

    expect(mockEventEmit).not.toHaveBeenCalled();
    expect(mockEventEmitRaw).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Legacy broadcaster parameter is ignored
  // --------------------------------------------------------------------------

  it('ignores legacy broadcaster parameter', async () => {
    const mockBroadcaster = vi.fn();
    const result = makeResult({ reportMessage: 'test' });

    await reportPulseResult(result, mockBroadcaster);

    expect(mockBroadcaster).not.toHaveBeenCalled();
    expect(mockEventEmit).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // data:changed events — entity type mapping via emitRaw
  // --------------------------------------------------------------------------

  it('emits data:changed for memories on create_memory action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'create_memory', success: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gateway.data.changed',
        data: { type: 'memories' },
      })
    );
  });

  it('emits data:changed for memories on run_memory_cleanup action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'run_memory_cleanup', success: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gateway.data.changed',
        data: { type: 'memories' },
      })
    );
  });

  it('emits data:changed for goals on update_goal_progress action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'update_goal_progress', success: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gateway.data.changed',
        data: { type: 'goals' },
      })
    );
  });

  it('emits data:changed for notifications on send_user_notification action', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'send_user_notification', success: true, output: {} }],
    });

    await reportPulseResult(result);

    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gateway.data.changed',
        data: { type: 'notifications' },
      })
    );
  });

  it('deduplicates data:changed events for the same entity type', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [
        { type: 'create_memory', success: true, output: {} },
        { type: 'run_memory_cleanup', success: true, output: {} },
      ],
    });

    await reportPulseResult(result);

    // Should only get ONE data:changed for 'memories', not two
    const memoriesEmits = mockEventEmitRaw.mock.calls.filter(
      ([event]: [{ type: string; data: { type: string } }]) =>
        event.type === 'gateway.data.changed' && event.data.type === 'memories'
    );
    expect(memoriesEmits).toHaveLength(1);
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

    await reportPulseResult(result);

    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'memories' } })
    );
    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'goals' } })
    );
    expect(mockEventEmitRaw).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'notifications' } })
    );
  });

  // --------------------------------------------------------------------------
  // Skipped / failed actions excluded from data:changed
  // --------------------------------------------------------------------------

  it('does not emit data:changed for skipped actions', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'create_memory', success: true, skipped: true, output: {} }],
    });

    await reportPulseResult(result);

    const dataChangedCalls = mockEventEmitRaw.mock.calls.filter(
      ([event]: [{ type: string }]) => event.type === 'gateway.data.changed'
    );
    expect(dataChangedCalls).toHaveLength(0);
  });

  it('does not emit data:changed for failed actions', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [
        { type: 'update_goal_progress', success: false, output: {}, error: 'boom' },
      ],
    });

    await reportPulseResult(result);

    const dataChangedCalls = mockEventEmitRaw.mock.calls.filter(
      ([event]: [{ type: string }]) => event.type === 'gateway.data.changed'
    );
    expect(dataChangedCalls).toHaveLength(0);
  });

  it('does not emit data:changed for unrecognized action types', async () => {
    const result = makeResult({
      reportMessage: 'done',
      actionsExecuted: [{ type: 'some_unknown_action', success: true, output: {} }],
    });

    await reportPulseResult(result);

    const dataChangedCalls = mockEventEmitRaw.mock.calls.filter(
      ([event]: [{ type: string }]) => event.type === 'gateway.data.changed'
    );
    expect(dataChangedCalls).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  it('catches errors from EventBus and logs them via log.debug', async () => {
    mockEventEmit.mockImplementation(() => {
      throw new Error('EventBus closed');
    });

    const result = makeResult({
      reportMessage: 'test',
      actionsExecuted: [],
    });

    // Should NOT throw
    await reportPulseResult(result);

    expect(mockLog.debug).toHaveBeenCalledWith('EventBus emission failed', {
      error: 'Error: EventBus closed',
    });
  });

  it('catches non-Error thrown values and stringifies them', async () => {
    mockEventEmit.mockImplementation(() => {
      throw 'plain string error';
    });

    const result = makeResult({
      reportMessage: 'test',
      actionsExecuted: [],
    });

    await reportPulseResult(result);

    expect(mockLog.debug).toHaveBeenCalledWith('EventBus emission failed', {
      error: 'plain string error',
    });
  });
});
