/**
 * Plans Seed Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { MockPlansRepository } = vi.hoisted(() => {
  const MockPlansRepository = vi.fn().mockImplementation(function () {
    return {
      list: vi.fn(),
      create: vi.fn(),
      addStep: vi.fn(),
    };
  });
  return { MockPlansRepository };
});

vi.mock('../repositories/plans.js', () => ({
  PlansRepository: MockPlansRepository,
}));

vi.mock('../../services/log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { seedExamplePlans } from './plans-seed.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function makeRepo() {
  return MockPlansRepository.mock.results[MockPlansRepository.mock.results.length - 1]!.value as {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    addStep: ReturnType<typeof vi.fn>;
  };
}

describe('seedExamplePlans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a PlansRepository with the given userId', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'p1' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });
    await seedExamplePlans('user-123');
    expect(MockPlansRepository).toHaveBeenCalledWith('user-123');
  });

  it('defaults userId to "default"', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'p1' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });
    await seedExamplePlans();
    expect(MockPlansRepository).toHaveBeenCalledWith('default');
  });

  it('skips plans that already exist', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi
          .fn()
          .mockResolvedValue([
            { name: 'Weekly Goal Review' },
            { name: 'Daily Memory Digest' },
            { name: 'Task Cleanup' },
          ]),
        create: vi.fn(),
        addStep: vi.fn(),
      };
    });

    const result = await seedExamplePlans();
    const repo = makeRepo();
    expect(repo.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(3);
  });

  it('creates plans that do not exist yet', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'new-plan' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });

    const result = await seedExamplePlans();
    const repo = makeRepo();
    expect(repo.create).toHaveBeenCalledTimes(3);
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('creates steps for each plan', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'plan-id' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });

    await seedExamplePlans();
    const repo = makeRepo();
    // All 3 example plans combined have 3+2+2 = 7 steps
    expect(repo.addStep).toHaveBeenCalledTimes(7);
  });

  it('adds steps with correct orderNum (1-based)', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi
          .fn()
          .mockResolvedValue([{ name: 'Daily Memory Digest' }, { name: 'Task Cleanup' }]),
        create: vi.fn().mockResolvedValue({ id: 'plan-id' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });

    await seedExamplePlans();
    const repo = makeRepo();
    // Only "Weekly Goal Review" (3 steps) is created
    expect(repo.addStep.mock.calls[0]?.[1]).toMatchObject({ orderNum: 1 });
    expect(repo.addStep.mock.calls[1]?.[1]).toMatchObject({ orderNum: 2 });
    expect(repo.addStep.mock.calls[2]?.[1]).toMatchObject({ orderNum: 3 });
  });

  it('skips and counts failed plan creates', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([]),
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'p1' })
          .mockRejectedValueOnce(new Error('DB error'))
          .mockResolvedValueOnce({ id: 'p3' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });

    const result = await seedExamplePlans();
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it('mixes skipped (existing) and created (new) plans', async () => {
    MockPlansRepository.mockImplementation(function () {
      return {
        list: vi.fn().mockResolvedValue([{ name: 'Weekly Goal Review' }]),
        create: vi.fn().mockResolvedValue({ id: 'plan-id' }),
        addStep: vi.fn().mockResolvedValue(undefined),
      };
    });

    const result = await seedExamplePlans();
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
  });
});
