/**
 * PlansRepository Tests
 *
 * Unit tests for plan CRUD, step operations, history logging,
 * progress calculation, statistics, and dependency cycle detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must be declared before vi.mock)
// ---------------------------------------------------------------------------

const mockAdapter = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  isConnected: vi.fn(() => true),
  close: vi.fn(),
  now: vi.fn(() => 'NOW()'),
  date: vi.fn((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn((i: number) => `$${i}`),
  boolean: vi.fn((v: boolean) => v),
  parseBoolean: vi.fn((v: unknown) => Boolean(v)),
  type: 'postgres' as const,
}));

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn(async () => mockAdapter),
  getAdapterSync: vi.fn(() => mockAdapter),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { PlansRepository, detectDependencyCycle, type PlanStep } from './plans.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan_1',
    user_id: 'user-1',
    name: 'Deploy v2',
    description: 'Deploy version 2',
    goal: 'Ship new version',
    status: 'pending',
    current_step: 0,
    total_steps: 3,
    progress: 0,
    priority: 5,
    source: null,
    source_id: null,
    trigger_id: null,
    goal_id: null,
    autonomy_level: 1,
    max_retries: 3,
    retry_count: 0,
    timeout_ms: null,
    checkpoint: null,
    error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    started_at: null,
    completed_at: null,
    metadata: '{}',
    ...overrides,
  };
}

function stepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step_1',
    plan_id: 'plan_1',
    order_num: 1,
    type: 'tool_call',
    name: 'Run tests',
    description: null,
    config: '{"toolName":"run_tests"}',
    status: 'pending',
    dependencies: '[]',
    result: null,
    error: null,
    retry_count: 0,
    max_retries: 3,
    timeout_ms: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    on_success: null,
    on_failure: null,
    metadata: '{}',
    ...overrides,
  };
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    plan_id: 'plan_1',
    step_id: null,
    event_type: 'started',
    details: '{}',
    created_at: NOW_ISO,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlansRepository', () => {
  let repo: PlansRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockReset();
    mockAdapter.queryOne.mockReset();
    mockAdapter.execute.mockReset();
    repo = new PlansRepository('user-1');
  });

  // ==========================================================================
  // Plan CRUD
  // ==========================================================================

  describe('create', () => {
    it('inserts a new plan and returns it', async () => {
      const row = planRow();
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(row);

      const result = await repo.create({
        name: 'Deploy v2',
        goal: 'Ship new version',
      });

      expect(result.id).toBe('plan_1');
      expect(result.name).toBe('Deploy v2');
      expect(result.status).toBe('pending');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.metadata).toEqual({});
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });

    it('applies default values for optional fields', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(planRow());

      await repo.create({ name: 'Test', goal: 'Goal' });

      const insertArgs = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // priority defaults to 5
      expect(insertArgs[5]).toBe(5);
      // autonomyLevel defaults to 1
      expect(insertArgs[10]).toBe(1);
      // maxRetries defaults to 3
      expect(insertArgs[11]).toBe(3);
      // metadata defaults to '{}'
      expect(insertArgs[13]).toBe('{}');
    });

    it('throws when plan not found after insert', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(repo.create({ name: 'X', goal: 'Y' })).rejects.toThrow('Failed to create plan');
    });
  });

  describe('get', () => {
    it('returns mapped plan when found', async () => {
      mockAdapter.queryOne.mockResolvedValue(planRow({ status: 'running', started_at: NOW_ISO }));

      const plan = await repo.get('plan_1');

      expect(plan).not.toBeNull();
      expect(plan!.id).toBe('plan_1');
      expect(plan!.userId).toBe('user-1');
      expect(plan!.startedAt).toBeInstanceOf(Date);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const plan = await repo.get('nonexistent');
      expect(plan).toBeNull();
    });

    it('parses JSON metadata from string', async () => {
      mockAdapter.queryOne.mockResolvedValue(planRow({ metadata: '{"key":"val"}' }));

      const plan = await repo.get('plan_1');
      expect(plan!.metadata).toEqual({ key: 'val' });
    });
  });

  describe('update', () => {
    it('returns null when plan not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.update('no-plan', { name: 'New' });
      expect(result).toBeNull();
    });

    it('updates name and returns refreshed plan', async () => {
      const original = planRow();
      const updated = planRow({ name: 'Updated' });
      mockAdapter.queryOne
        .mockResolvedValueOnce(original) // get() inside update
        .mockResolvedValueOnce(updated); // get() at the end
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.update('plan_1', { name: 'Updated' });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });

    it('sets started_at when transitioning to running', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow({ status: 'pending', started_at: null }))
        .mockResolvedValueOnce(planRow({ status: 'running', started_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.update('plan_1', { status: 'running' });

      expect(result!.status).toBe('running');
      // The execute call should contain started_at among its params
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('started_at');
    });

    it('sets completed_at when transitioning to completed', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow({ status: 'running', started_at: NOW_ISO }))
        .mockResolvedValueOnce(planRow({ status: 'completed', completed_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('plan_1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
    });

    it('sets completed_at when transitioning to failed', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow({ status: 'running', started_at: NOW_ISO }))
        .mockResolvedValueOnce(planRow({ status: 'failed', completed_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('plan_1', { status: 'failed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
    });

    it('sets completed_at when transitioning to cancelled', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow({ status: 'running', started_at: NOW_ISO }))
        .mockResolvedValueOnce(planRow({ status: 'cancelled', completed_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('plan_1', { status: 'cancelled' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
    });

    it('does not re-set started_at if already started', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow({ status: 'paused', started_at: NOW_ISO }))
        .mockResolvedValueOnce(planRow({ status: 'running', started_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('plan_1', { status: 'running' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      // started_at should NOT appear since it's already set
      expect(sql).not.toContain('started_at');
    });

    it('serializes metadata to JSON', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow())
        .mockResolvedValueOnce(planRow({ metadata: '{"newKey":"newVal"}' }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('plan_1', { metadata: { newKey: 'newVal' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('{"newKey":"newVal"}');
    });
  });

  describe('delete', () => {
    it('returns true when plan deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.delete('plan_1');
      expect(result).toBe(true);
    });

    it('returns false when plan not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const result = await repo.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('returns mapped plans with default pagination', async () => {
      mockAdapter.query.mockResolvedValue([planRow(), planRow({ id: 'plan_2', name: 'Plan 2' })]);

      const plans = await repo.list();

      expect(plans).toHaveLength(2);
      expect(plans[0]!.id).toBe('plan_1');
      expect(plans[1]!.id).toBe('plan_2');
    });

    it('filters by status', async () => {
      mockAdapter.query.mockResolvedValue([planRow({ status: 'running' })]);

      const plans = await repo.list({ status: 'running' });

      expect(plans).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status');
    });

    it('filters by goalId', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ goalId: 'goal-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('goal_id');
    });

    it('filters by triggerId', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ triggerId: 'trig-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('trigger_id');
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ limit: 5, offset: 10 });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
      expect(params).toContain(10);
    });
  });

  describe('getActive', () => {
    it('returns running and paused plans', async () => {
      mockAdapter.query.mockResolvedValue([
        planRow({ status: 'running' }),
        planRow({ id: 'plan_2', status: 'paused' }),
      ]);

      const plans = await repo.getActive();

      expect(plans).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("'running'");
      expect(sql).toContain("'paused'");
    });
  });

  describe('getPending', () => {
    it('returns pending plans', async () => {
      mockAdapter.query.mockResolvedValue([planRow({ status: 'pending' })]);

      const plans = await repo.getPending();

      expect(plans).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("'pending'");
    });
  });

  // ==========================================================================
  // Step Operations
  // ==========================================================================

  describe('addStep', () => {
    it('creates a step and updates total_steps count', async () => {
      // get plan
      mockAdapter.queryOne.mockResolvedValueOnce(planRow());
      // get existing steps (for dependency check - not needed here)
      // insert step
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // update total_steps
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getStep after insert
      mockAdapter.queryOne.mockResolvedValueOnce(stepRow());

      const step = await repo.addStep('plan_1', {
        orderNum: 1,
        type: 'tool_call',
        name: 'Run tests',
        config: { toolName: 'run_tests' },
      });

      expect(step.id).toBe('step_1');
      expect(step.type).toBe('tool_call');
      expect(step.config).toEqual({ toolName: 'run_tests' });
      // Two execute calls: INSERT step + UPDATE total_steps
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });

    it('throws when plan not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(
        repo.addStep('nonexistent', {
          orderNum: 1,
          type: 'tool_call',
          name: 'X',
          config: {},
        })
      ).rejects.toThrow('Plan not found');
    });

    it('checks for circular dependencies and throws on cycle', async () => {
      // get plan
      mockAdapter.queryOne.mockResolvedValueOnce(planRow());
      // getSteps for cycle detection
      const existingStep = stepRow({ id: 'step_A', dependencies: '["__new__"]' });
      mockAdapter.query.mockResolvedValueOnce([existingStep]);

      await expect(
        repo.addStep('plan_1', {
          orderNum: 2,
          type: 'tool_call',
          name: 'Step B',
          config: {},
          dependencies: ['step_A'],
        })
      ).rejects.toThrow('Circular dependency detected');
    });

    it('allows step with valid dependencies (no cycle)', async () => {
      // get plan
      mockAdapter.queryOne.mockResolvedValueOnce(planRow());
      // getSteps - existing step has no deps pointing back
      const existingStep = stepRow({ id: 'step_A', dependencies: '[]' });
      mockAdapter.query.mockResolvedValueOnce([existingStep]);
      // insert step
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // update total_steps
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(
        stepRow({ id: 'step_B', dependencies: '["step_A"]' })
      );

      const step = await repo.addStep('plan_1', {
        orderNum: 2,
        type: 'tool_call',
        name: 'Step B',
        config: {},
        dependencies: ['step_A'],
      });

      expect(step.dependencies).toEqual(['step_A']);
    });

    it('throws when step not found after insert', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow()) // get plan
        .mockResolvedValueOnce(null); // getStep after insert
      mockAdapter.execute
        .mockResolvedValueOnce({ changes: 1 }) // insert
        .mockResolvedValueOnce({ changes: 1 }); // update total

      await expect(
        repo.addStep('plan_1', {
          orderNum: 1,
          type: 'tool_call',
          name: 'X',
          config: {},
        })
      ).rejects.toThrow('Failed to create plan step');
    });
  });

  describe('getStep', () => {
    it('returns mapped step when found', async () => {
      mockAdapter.queryOne.mockResolvedValue(stepRow());

      const step = await repo.getStep('step_1');

      expect(step).not.toBeNull();
      expect(step!.planId).toBe('plan_1');
      expect(step!.type).toBe('tool_call');
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const step = await repo.getStep('nonexistent');
      expect(step).toBeNull();
    });
  });

  describe('updateStep', () => {
    it('returns null when step not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.updateStep('no-step', { status: 'completed' });
      expect(result).toBeNull();
    });

    it('returns step unchanged if no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValue(stepRow());

      const result = await repo.updateStep('step_1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('step_1');
      // execute should not be called because updates is empty
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('sets started_at when transitioning to running', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(stepRow({ status: 'pending', started_at: null }))
        .mockResolvedValueOnce(stepRow({ status: 'running', started_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateStep('step_1', { status: 'running' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('started_at');
    });

    it('sets completed_at and duration_ms when completing with started_at', async () => {
      const startedAt = '2025-01-15T11:00:00.000Z';
      mockAdapter.queryOne
        .mockResolvedValueOnce(stepRow({ status: 'running', started_at: startedAt }))
        .mockResolvedValueOnce(stepRow({ status: 'completed', completed_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateStep('step_1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
      expect(sql).toContain('duration_ms');
    });

    it('serializes result as JSON', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(stepRow())
        .mockResolvedValueOnce(stepRow({ result: '{"output":"ok"}' }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.updateStep('step_1', { result: { output: 'ok' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(JSON.stringify({ output: 'ok' }));
    });
  });

  describe('getSteps', () => {
    it('returns ordered steps', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ id: 'step_1', order_num: 1 }),
        stepRow({ id: 'step_2', order_num: 2 }),
      ]);

      const steps = await repo.getSteps('plan_1');

      expect(steps).toHaveLength(2);
      expect(steps[0]!.id).toBe('step_1');
      expect(steps[1]!.id).toBe('step_2');
    });

    it('returns empty array when no steps', async () => {
      mockAdapter.query.mockResolvedValue([]);

      const steps = await repo.getSteps('plan_1');
      expect(steps).toHaveLength(0);
    });
  });

  describe('getNextStep', () => {
    it('returns first pending step', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ id: 'step_1', status: 'completed' }),
        stepRow({ id: 'step_2', status: 'pending', order_num: 2 }),
        stepRow({ id: 'step_3', status: 'pending', order_num: 3 }),
      ]);

      const next = await repo.getNextStep('plan_1');

      expect(next).not.toBeNull();
      expect(next!.id).toBe('step_2');
    });

    it('returns null when all steps are completed', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ id: 'step_1', status: 'completed' }),
        stepRow({ id: 'step_2', status: 'completed' }),
      ]);

      const next = await repo.getNextStep('plan_1');
      expect(next).toBeNull();
    });
  });

  describe('getStepsByStatus', () => {
    it('returns steps filtered by status', async () => {
      mockAdapter.query.mockResolvedValue([stepRow({ status: 'completed' })]);

      const steps = await repo.getStepsByStatus('plan_1', 'completed');

      expect(steps).toHaveLength(1);
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('completed');
    });
  });

  describe('areDependenciesMet', () => {
    it('returns true when step has no dependencies', async () => {
      mockAdapter.queryOne.mockResolvedValue(stepRow({ dependencies: '[]' }));

      const result = await repo.areDependenciesMet('step_1');
      expect(result).toBe(true);
    });

    it('returns true when step not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.areDependenciesMet('nonexistent');
      expect(result).toBe(true);
    });

    it('returns true when all dependencies are completed', async () => {
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(
        stepRow({ id: 'step_2', plan_id: 'plan_1', dependencies: '["step_1"]' })
      );
      // getStepsByStatus('completed')
      mockAdapter.query.mockResolvedValueOnce([stepRow({ id: 'step_1', status: 'completed' })]);

      const result = await repo.areDependenciesMet('step_2');
      expect(result).toBe(true);
    });

    it('returns false when some dependencies are not completed', async () => {
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(
        stepRow({ id: 'step_3', plan_id: 'plan_1', dependencies: '["step_1","step_2"]' })
      );
      // getStepsByStatus('completed') - only step_1 is complete
      mockAdapter.query.mockResolvedValueOnce([stepRow({ id: 'step_1', status: 'completed' })]);

      const result = await repo.areDependenciesMet('step_3');
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // History Operations
  // ==========================================================================

  describe('logEvent', () => {
    it('inserts a history event', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.logEvent('plan_1', 'started', undefined, { reason: 'manual' });

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO plan_history');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('plan_1');
      expect(params[3]).toBe('started');
      expect(params[4]).toBe('{"reason":"manual"}');
    });

    it('passes stepId when provided', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.logEvent('plan_1', 'step_completed', 'step_1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe('step_1');
    });

    it('passes null stepId when not provided', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.logEvent('plan_1', 'started');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns mapped history entries', async () => {
      mockAdapter.query.mockResolvedValue([
        historyRow({ event_type: 'started' }),
        historyRow({ id: 'evt_2', event_type: 'step_completed', step_id: 'step_1' }),
      ]);

      const history = await repo.getHistory('plan_1');

      expect(history).toHaveLength(2);
      expect(history[0]!.eventType).toBe('started');
      expect(history[1]!.stepId).toBe('step_1');
    });

    it('respects custom limit', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.getHistory('plan_1', 10);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(10);
    });
  });

  // ==========================================================================
  // Progress Calculation
  // ==========================================================================

  describe('recalculateProgress', () => {
    it('returns 0 when no steps', async () => {
      // getSteps
      mockAdapter.query.mockResolvedValue([]);

      const progress = await repo.recalculateProgress('plan_1');
      expect(progress).toBe(0);
    });

    it('calculates correct progress percentage', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ id: 's1', status: 'completed' }),
        stepRow({ id: 's2', status: 'completed' }),
        stepRow({ id: 's3', status: 'pending' }),
        stepRow({ id: 's4', status: 'pending' }),
      ]);
      // update() calls: get plan, then execute, then get plan again
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow())
        .mockResolvedValueOnce(planRow({ progress: 50 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const progress = await repo.recalculateProgress('plan_1');

      expect(progress).toBe(50);
    });

    it('returns 100 when all steps completed', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ id: 's1', status: 'completed' }),
        stepRow({ id: 's2', status: 'completed' }),
      ]);
      mockAdapter.queryOne
        .mockResolvedValueOnce(planRow())
        .mockResolvedValueOnce(planRow({ progress: 100 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const progress = await repo.recalculateProgress('plan_1');
      expect(progress).toBe(100);
    });
  });

  // ==========================================================================
  // Statistics
  // ==========================================================================

  describe('getStats', () => {
    it('returns correct statistics for empty plans', async () => {
      mockAdapter.query.mockResolvedValue([]);

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.completionRate).toBe(0);
      expect(stats.avgStepsPerPlan).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.byStatus.pending).toBe(0);
    });

    it('computes stats from plan data', async () => {
      mockAdapter.query.mockResolvedValue([
        planRow({
          status: 'completed',
          total_steps: 3,
          started_at: '2025-01-01T00:00:00Z',
          completed_at: '2025-01-01T01:00:00Z',
        }),
        planRow({ id: 'plan_2', status: 'pending', total_steps: 2 }),
        planRow({ id: 'plan_3', status: 'running', total_steps: 4 }),
      ]);

      const stats = await repo.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.running).toBe(1);
      expect(stats.completionRate).toBeCloseTo(33.33, 0);
      expect(stats.avgStepsPerPlan).toBe(3); // (3+2+4)/3
      expect(stats.avgDurationMs).toBe(3600000); // 1 hour
    });
  });

  // ========================================================================
  // count()
  // ========================================================================

  describe('count()', () => {
    it('returns total count with no filters', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '5' });

      const result = await repo.count();

      expect(result).toBe(5);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0]!;
      expect(sql).toContain('SELECT COUNT(*)');
      expect(sql).toContain('user_id = $1');
      expect(params).toEqual(['user-1']);
    });

    it('filters by status', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '2' });

      const result = await repo.count({ status: 'running' });

      expect(result).toBe(2);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0]!;
      expect(sql).toContain('status =');
      expect(params).toContain('running');
    });

    it('filters by goalId', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '1' });

      const result = await repo.count({ goalId: 'goal-1' });

      expect(result).toBe(1);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0]!;
      expect(sql).toContain('goal_id =');
      expect(params).toContain('goal-1');
    });

    it('filters by triggerId', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '3' });

      const result = await repo.count({ triggerId: 'trig-1' });

      expect(result).toBe(3);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0]!;
      expect(sql).toContain('trigger_id =');
      expect(params).toContain('trig-1');
    });

    it('combines multiple filters', async () => {
      mockAdapter.queryOne.mockResolvedValue({ count: '1' });

      const result = await repo.count({ status: 'completed', goalId: 'g-2' });

      expect(result).toBe(1);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0]!;
      expect(sql).toContain('status =');
      expect(sql).toContain('goal_id =');
      expect(params).toContain('completed');
      expect(params).toContain('g-2');
    });

    it('returns 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.count();

      expect(result).toBe(0);
    });
  });
});

// ==========================================================================
// Dependency Cycle Detection (exported pure function)
// ==========================================================================

describe('detectDependencyCycle', () => {
  function makeStep(id: string, name: string, dependencies: string[]): PlanStep {
    return {
      id,
      planId: 'plan_1',
      orderNum: 0,
      type: 'tool_call',
      name,
      description: null,
      config: {},
      status: 'pending',
      dependencies,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: 3,
      timeoutMs: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      onSuccess: null,
      onFailure: null,
      metadata: {},
    };
  }

  it('returns null when no cycle exists', () => {
    const steps = [makeStep('A', 'Step A', []), makeStep('B', 'Step B', ['A'])];

    const result = detectDependencyCycle(steps, ['B'], 'C');
    expect(result).toBeNull();
  });

  it('detects direct circular dependency', () => {
    const steps = [makeStep('A', 'Step A', ['__new__'])];

    const result = detectDependencyCycle(steps, ['A']);
    expect(result).not.toBeNull();
    expect(result).toContain('->');
  });

  it('detects indirect circular dependency', () => {
    const steps = [makeStep('A', 'Step A', ['B']), makeStep('B', 'Step B', ['__new__'])];

    const result = detectDependencyCycle(steps, ['A']);
    expect(result).not.toBeNull();
  });

  it('returns null when there are no dependencies', () => {
    const steps = [makeStep('A', 'Step A', [])];

    const result = detectDependencyCycle(steps, []);
    expect(result).toBeNull();
  });

  it('uses step names in cycle path for readability', () => {
    const steps = [makeStep('A', 'Step Alpha', ['__new__'])];

    const result = detectDependencyCycle(steps, ['A']);
    expect(result).toContain('Step Alpha');
    expect(result).toContain('(new step)');
  });

  it('handles complex dependency graphs without cycles', () => {
    const steps = [
      makeStep('A', 'A', []),
      makeStep('B', 'B', ['A']),
      makeStep('C', 'C', ['A', 'B']),
      makeStep('D', 'D', ['C']),
    ];

    const result = detectDependencyCycle(steps, ['D'], 'E');
    expect(result).toBeNull();
  });

  it('detects cycle in complex graph', () => {
    // E depends on D, D depends on C, C depends on E (via __new__)
    const steps = [makeStep('C', 'C', ['__new__']), makeStep('D', 'D', ['C'])];

    const result = detectDependencyCycle(steps, ['D'], '__new__');
    expect(result).not.toBeNull();
  });
});
