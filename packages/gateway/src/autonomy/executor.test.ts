/**
 * Tests for the Pulse Action Executor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePulseActions } from './executor.js';
import type { PulseAction } from './prompt.js';

// ============================================================================
// Mocks
// ============================================================================

const mockMemoryService = {
  createMemory: vi.fn(),
  getImportantMemories: vi.fn(),
  deleteMemory: vi.fn(),
  getStats: vi.fn(),
};

const mockGoalService = {
  updateGoal: vi.fn(),
  listGoals: vi.fn(),
  getActive: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getServiceRegistry: () => ({
      get: (token: { name: string }) => {
        if (token.name === 'memory') return mockMemoryService;
        if (token.name === 'goal') return mockGoalService;
        throw new Error(`No mock for token: ${token.name}`);
      },
    }),
  };
});

// ============================================================================
// Tests
// ============================================================================

describe('executePulseActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles skip action', async () => {
    const actions: PulseAction[] = [{ type: 'skip', params: {} }];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('skip');
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.skipped).toBe(true);
  });

  it('executes create_memory action', async () => {
    mockMemoryService.createMemory.mockResolvedValue({ id: 'mem-1' });

    const actions: PulseAction[] = [
      {
        type: 'create_memory',
        params: { content: 'Test memory', type: 'fact', importance: 0.7 },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.output).toEqual({ memoryId: 'mem-1' });
    expect(mockMemoryService.createMemory).toHaveBeenCalledWith('user1', {
      content: 'Test memory',
      type: 'fact',
      importance: 0.7,
      source: 'pulse',
    });
  });

  it('executes update_goal_progress action', async () => {
    mockGoalService.updateGoal.mockResolvedValue({ id: 'g1', progress: 50 });

    const actions: PulseAction[] = [
      {
        type: 'update_goal_progress',
        params: { goalId: 'g1', progress: 50, note: 'Good progress' },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.output).toEqual({ goalId: 'g1', progress: 50 });
  });

  it('handles update_goal_progress when goal not found', async () => {
    mockGoalService.updateGoal.mockResolvedValue(null);

    const actions: PulseAction[] = [
      {
        type: 'update_goal_progress',
        params: { goalId: 'nonexistent', progress: 50 },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toContain('Goal not found');
  });

  it('executes send_notification action (passthrough)', async () => {
    const actions: PulseAction[] = [
      {
        type: 'send_notification',
        params: { message: 'Hello!', urgency: 'low' },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.output).toEqual({ message: 'Hello!', urgency: 'low' });
  });

  it('executes run_memory_cleanup action', async () => {
    mockMemoryService.getImportantMemories.mockResolvedValue([
      { id: 'mem-1', importance: 0.1 },
      { id: 'mem-2', importance: 0.05 },
      { id: 'mem-3', importance: 0.8 },
    ]);
    mockMemoryService.deleteMemory.mockResolvedValue(true);

    const actions: PulseAction[] = [
      {
        type: 'run_memory_cleanup',
        params: { minImportance: 0.2 },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.output).toEqual({ checked: 3, deleted: 2 });
  });

  it('bounds number of actions to maxActions', async () => {
    const actions: PulseAction[] = Array.from({ length: 10 }, (_, i) => ({
      type: 'send_notification' as const,
      params: { message: `Msg ${i}`, urgency: 'low' },
    }));

    const results = await executePulseActions(actions, 'user1', 3);

    expect(results).toHaveLength(3);
  });

  it('handles errors gracefully', async () => {
    mockMemoryService.createMemory.mockRejectedValue(new Error('DB error'));

    const actions: PulseAction[] = [
      {
        type: 'create_memory',
        params: { content: 'Fail', type: 'fact', importance: 0.5 },
      },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toContain('DB error');
  });

  it('handles unknown action type', async () => {
    const actions: PulseAction[] = [
      { type: 'unknown_action' as PulseAction['type'], params: {} },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toContain('Unknown action type');
  });

  it('executes multiple actions in sequence', async () => {
    mockMemoryService.createMemory.mockResolvedValue({ id: 'mem-1' });
    mockGoalService.updateGoal.mockResolvedValue({ id: 'g1', progress: 75 });

    const actions: PulseAction[] = [
      { type: 'create_memory', params: { content: 'Note', type: 'fact', importance: 0.5 } },
      { type: 'update_goal_progress', params: { goalId: 'g1', progress: 75 } },
      { type: 'send_notification', params: { message: 'Done', urgency: 'low' } },
    ];
    const results = await executePulseActions(actions, 'user1');

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
