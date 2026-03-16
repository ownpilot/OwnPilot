import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockRepo = {
  create: vi.fn(),
  list: vi.fn(async () => []),
  update: vi.fn(),
  delete: vi.fn(async () => true),
  archive: vi.fn(),
  logHabit: vi.fn(),
  getTodayHabits: vi.fn(async () => []),
  getTodayProgress: vi.fn(async () => ({ total: 0, completed: 0, percentage: 0, habits: [] })),
  getHabitStats: vi.fn(),
};

vi.mock('../db/repositories/habits.js', () => ({
  HabitsRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

const { executeHabitTool, HABIT_TOOLS, HABIT_TOOL_NAMES } = await import('./habit-tools.js');

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HABIT_TOOLS', () => {
  it('exports 8 tool definitions', () => {
    expect(HABIT_TOOLS).toHaveLength(8);
  });

  it('all tools have unique names', () => {
    const names = HABIT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('HABIT_TOOL_NAMES matches tool definitions', () => {
    expect(HABIT_TOOL_NAMES).toEqual(HABIT_TOOLS.map((t) => t.name));
  });

  it('all tools have required fields', () => {
    for (const tool of HABIT_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
    }
  });
});

describe('executeHabitTool', () => {
  it('create_habit calls repo.create and returns habit', async () => {
    const habit = { id: 'hab_1', name: 'Exercise' };
    mockRepo.create.mockResolvedValue(habit);

    const result = await executeHabitTool('create_habit', { name: 'Exercise' }, 'user-1');

    expect(result.success).toBe(true);
    expect(result.result).toEqual(habit);
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Exercise', frequency: 'daily', targetCount: 1 })
    );
  });

  it('list_habits returns habits with message', async () => {
    mockRepo.list.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

    const result = await executeHabitTool('list_habits', {}, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { total: number }).total).toBe(2);
  });

  it('list_habits returns empty message when no habits', async () => {
    mockRepo.list.mockResolvedValue([]);

    const result = await executeHabitTool('list_habits', {}, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { message: string }).message).toContain('No habits found');
  });

  it('update_habit returns updated habit', async () => {
    const updated = { id: 'h1', name: 'Updated' };
    mockRepo.update.mockResolvedValue(updated);

    const result = await executeHabitTool(
      'update_habit',
      { habitId: 'h1', name: 'Updated' },
      'user-1'
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual(updated);
  });

  it('update_habit returns error for missing habit', async () => {
    mockRepo.update.mockResolvedValue(null);

    const result = await executeHabitTool('update_habit', { habitId: 'missing' }, 'user-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('delete_habit succeeds', async () => {
    mockRepo.delete.mockResolvedValue(true);

    const result = await executeHabitTool('delete_habit', { habitId: 'h1' }, 'user-1');

    expect(result.success).toBe(true);
  });

  it('delete_habit returns error for missing habit', async () => {
    mockRepo.delete.mockResolvedValue(false);

    const result = await executeHabitTool('delete_habit', { habitId: 'missing' }, 'user-1');

    expect(result.success).toBe(false);
  });

  it('log_habit logs completion', async () => {
    const log = { id: 'log_1', habitId: 'h1', count: 1 };
    mockRepo.logHabit.mockResolvedValue(log);

    const result = await executeHabitTool('log_habit', { habitId: 'h1' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { message: string }).message).toContain('logged');
  });

  it('log_habit returns error for missing habit', async () => {
    mockRepo.logHabit.mockResolvedValue(null);

    const result = await executeHabitTool('log_habit', { habitId: 'missing' }, 'user-1');

    expect(result.success).toBe(false);
  });

  it('get_today_habits returns progress', async () => {
    mockRepo.getTodayHabits.mockResolvedValue([{ id: 'h1', completedToday: true }]);
    mockRepo.getTodayProgress.mockResolvedValue({ total: 2, completed: 1 });

    const result = await executeHabitTool('get_today_habits', {}, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { progress: { completed: number } }).progress.completed).toBe(1);
  });

  it('get_habit_stats returns stats', async () => {
    const stats = { streakCurrent: 5, streakLongest: 10, completionRate: 0.85 };
    mockRepo.getHabitStats.mockResolvedValue(stats);

    const result = await executeHabitTool('get_habit_stats', { habitId: 'h1' }, 'user-1');

    expect(result.success).toBe(true);
    expect(result.result).toEqual(stats);
  });

  it('archive_habit succeeds', async () => {
    const archived = { id: 'h1', isArchived: true };
    mockRepo.archive.mockResolvedValue(archived);

    const result = await executeHabitTool('archive_habit', { habitId: 'h1' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { message: string }).message).toContain('archived');
  });

  it('returns error for unknown tool name', async () => {
    const result = await executeHabitTool('unknown_tool', {}, 'user-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });

  it('catches and wraps exceptions', async () => {
    mockRepo.create.mockRejectedValue(new Error('DB connection failed'));

    const result = await executeHabitTool('create_habit', { name: 'Test' }, 'user-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB connection failed');
  });
});
