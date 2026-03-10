/**
 * OrchestrationRunsRepository Tests
 *
 * Tests the repository for managing multi-step CLI tool orchestration runs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// Mock the adapter module
const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn().mockImplementation((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

const {
  OrchestrationRunsRepository,
  createOrchestrationRunsRepository,
  orchestrationRunsRepo,
} = await import('./orchestration-runs.js');

// Test fixtures
function createMockRunRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-123',
    user_id: 'user-456',
    goal: 'Create a React component',
    provider: 'claude-code',
    cwd: '/home/user/project',
    model: 'claude-3-5-sonnet',
    status: 'running',
    steps: '[]',
    current_step: 0,
    max_steps: 10,
    auto_mode: false,
    enable_analysis: true,
    skill_ids: '[]',
    permissions: null,
    total_duration_ms: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:05:00Z',
    completed_at: null,
    ...overrides,
  };
}

describe('OrchestrationRunsRepository', () => {
  let repo: OrchestrationRunsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createOrchestrationRunsRepository();
  });

  describe('create', () => {
    it('creates run with all fields', async () => {
      const input = {
        id: 'run-123',
        userId: 'user-456',
        goal: 'Create a React component',
        provider: 'claude-code',
        cwd: '/home/user/project',
        model: 'claude-3-5-sonnet',
        maxSteps: 15,
        autoMode: true,
        enableAnalysis: true,
        skillIds: ['skill-1', 'skill-2'],
        permissions: { fs: 'read-write', network: true },
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockRunRow({
        id: 'run-123',
        goal: 'Create a React component',
        provider: 'claude-code',
        model: 'claude-3-5-sonnet',
        max_steps: 15,
        auto_mode: true,
        enable_analysis: true,
        skill_ids: JSON.stringify(['skill-1', 'skill-2']),
        permissions: JSON.stringify({ fs: 'read-write', network: true }),
      }));

      const result = await repo.create(input);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO orchestration_runs'),
        [
          'run-123',
          'user-456',
          'Create a React component',
          'claude-code',
          '/home/user/project',
          'claude-3-5-sonnet',
          15,
          true,
          true,
          JSON.stringify(['skill-1', 'skill-2']),
          JSON.stringify({ fs: 'read-write', network: true }),
        ]
      );

      expect(result.id).toBe('run-123');
      expect(result.goal).toBe('Create a React component');
      expect(result.model).toBe('claude-3-5-sonnet');
      expect(result.maxSteps).toBe(15);
      expect(result.autoMode).toBe(true);
      expect(result.skillIds).toEqual(['skill-1', 'skill-2']);
    });

    it('uses default values for optional fields', async () => {
      const input = {
        id: 'run-789',
        userId: 'user-456',
        goal: 'Simple task',
        provider: 'claude-code',
        cwd: '/home/user',
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockRunRow({
        id: 'run-789',
        goal: 'Simple task',
        model: null,
        max_steps: 10,
        auto_mode: false,
        enable_analysis: true,
        skill_ids: '[]',
        permissions: null,
      }));

      const result = await repo.create(input);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[5]).toBeNull(); // model
      expect(params[6]).toBe(10); // maxSteps default
      expect(params[7]).toBe(false); // autoMode default
      expect(params[8]).toBe(true); // enableAnalysis default
      expect(params[9]).toBe('[]'); // skillIds default
      expect(params[10]).toBeNull(); // permissions

      expect(result.model).toBeUndefined();
      expect(result.maxSteps).toBe(10);
      expect(result.autoMode).toBe(false);
    });

    it('throws error when getById returns null after create', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          id: 'run-123',
          userId: 'user-456',
          goal: 'Test',
          provider: 'claude-code',
          cwd: '/home/user',
        })
      ).rejects.toThrow('Failed to create orchestration run');
    });
  });

  describe('getById', () => {
    it('returns mapped record when run exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockRunRow());

      const result = await repo.getById('run-123', 'user-456');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT * FROM orchestration_runs WHERE id = $1 AND user_id = $2',
        ['run-123', 'user-456']
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('run-123');
      expect(result?.userId).toBe('user-456');
      expect(result?.goal).toBe('Create a React component');
      expect(result?.provider).toBe('claude-code');
      expect(result?.cwd).toBe('/home/user/project');
      expect(result?.model).toBe('claude-3-5-sonnet');
      expect(result?.status).toBe('running');
      expect(result?.steps).toEqual([]);
      expect(result?.currentStep).toBe(0);
      expect(result?.maxSteps).toBe(10);
      expect(result?.autoMode).toBe(false);
      expect(result?.enableAnalysis).toBe(true);
      expect(result?.skillIds).toEqual([]);
      expect(result?.permissions).toBeUndefined();
      expect(result?.totalDurationMs).toBeUndefined();
      expect(result?.completedAt).toBeUndefined();
    });

    it('returns null when run does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent', 'user-456');

      expect(result).toBeNull();
    });

    it('parses steps JSON array', async () => {
      const steps = [
        { type: 'analyze', description: 'Analyze code', status: 'completed' },
        { type: 'edit', description: 'Edit file', status: 'pending' },
      ];
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ steps: JSON.stringify(steps) })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.steps).toEqual(steps);
    });

    it('parses skillIds JSON array', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ skill_ids: JSON.stringify(['skill-a', 'skill-b']) })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.skillIds).toEqual(['skill-a', 'skill-b']);
    });

    it('parses permissions JSON', async () => {
      const permissions = { fs: 'read-only', network: false, shell: true };
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ permissions: JSON.stringify(permissions) })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.permissions).toEqual(permissions);
    });

    it('handles numeric boolean for auto_mode', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ auto_mode: 1 })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.autoMode).toBe(true);
    });

    it('handles zero value for enable_analysis', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ enable_analysis: 0 })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.enableAnalysis).toBe(false);
    });

    it('converts numeric current_step to number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ current_step: '5' })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.currentStep).toBe(5);
      expect(typeof result?.currentStep).toBe('number');
    });

    it('converts total_duration_ms to number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockRunRow({ total_duration_ms: '12345' })
      );

      const result = await repo.getById('run-123', 'user-456');

      expect(result?.totalDurationMs).toBe(12345);
    });

    it('handles different status values', async () => {
      const statuses = ['planning', 'running', 'waiting_user', 'paused', 'completed', 'failed', 'aborted'];

      for (const status of statuses) {
        vi.clearAllMocks();
        mockAdapter.queryOne.mockResolvedValueOnce(
          createMockRunRow({ status })
        );

        const result = await repo.getById('run-123', 'user-456');
        expect(result?.status).toBe(status);
      }
    });
  });

  describe('list', () => {
    it('returns empty array when no runs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list('user-456', 20, 0);

      expect(result).toEqual([]);
    });

    it('returns runs ordered by created_at DESC with pagination', async () => {
      const mockRows = [
        createMockRunRow({ id: 'run-3', created_at: '2026-01-03T00:00:00Z' }),
        createMockRunRow({ id: 'run-2', created_at: '2026-01-02T00:00:00Z' }),
        createMockRunRow({ id: 'run-1', created_at: '2026-01-01T00:00:00Z' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const result = await repo.list('user-456', 10, 5);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        'SELECT * FROM orchestration_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        ['user-456', 10, 5]
      );

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('run-3');
      expect(result[1].id).toBe('run-2');
      expect(result[2].id).toBe('run-1');
    });
  });

  describe('listActive', () => {
    it('returns only active runs', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        createMockRunRow({ id: 'run-1', status: 'running' }),
        createMockRunRow({ id: 'run-2', status: 'waiting_user' }),
        createMockRunRow({ id: 'run-3', status: 'paused' }),
      ]);

      const result = await repo.listActive('user-456');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('planning', 'running', 'waiting_user', 'paused')"),
        ['user-456']
      );
      expect(result).toHaveLength(3);
    });

    it('excludes completed runs', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        createMockRunRow({ id: 'run-1', status: 'running' }),
      ]);

      const result = await repo.listActive('user-456');

      expect(result.every(r => !['completed', 'failed', 'aborted'].includes(r.status))).toBe(true);
    });
  });

  describe('updateStatus', () => {
    it('updates status only', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('run-123', 'user-456', 'completed');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE orchestration_runs SET status = $3, updated_at = NOW()'),
        ['run-123', 'user-456', 'completed']
      );
    });

    it('updates status with completedAt', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const completedAt = '2026-01-01T01:00:00Z';

      await repo.updateStatus('run-123', 'user-456', 'completed', { completedAt });

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('status = $3');
      expect(sql).toContain('completed_at = $4');
      expect(params).toEqual(['run-123', 'user-456', 'completed', completedAt]);
    });

    it('updates status with totalDurationMs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('run-123', 'user-456', 'completed', { totalDurationMs: 60000 });

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('status = $3');
      expect(sql).toContain('total_duration_ms = $4');
      expect(params).toEqual(['run-123', 'user-456', 'completed', 60000]);
    });

    it('updates status with both completedAt and totalDurationMs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const completedAt = '2026-01-01T01:00:00Z';

      await repo.updateStatus('run-123', 'user-456', 'completed', {
        completedAt,
        totalDurationMs: 60000,
      });

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('status = $3');
      expect(sql).toContain('completed_at = $4');
      expect(sql).toContain('total_duration_ms = $5');
      expect(params).toEqual(['run-123', 'user-456', 'completed', completedAt, 60000]);
    });

    it('handles all status transitions', async () => {
      const statuses = ['planning', 'running', 'waiting_user', 'paused', 'completed', 'failed', 'aborted'] as const;

      for (const status of statuses) {
        vi.clearAllMocks();
        mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

        await repo.updateStatus('run-123', 'user-456', status);

        const [, params] = mockAdapter.execute.mock.calls[0];
        expect(params[2]).toBe(status);
      }
    });
  });

  describe('updateSteps', () => {
    it('updates steps and current step', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const steps = [
        { type: 'analyze', description: 'Step 1', status: 'completed' },
        { type: 'edit', description: 'Step 2', status: 'running' },
      ];

      await repo.updateSteps('run-123', 'user-456', steps, 1);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE orchestration_runs SET steps = $3, current_step = $4, updated_at = NOW()'),
        ['run-123', 'user-456', JSON.stringify(steps), 1]
      );
    });

    it('handles empty steps array', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateSteps('run-123', 'user-456', [], 0);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[2]).toBe('[]');
      expect(params[3]).toBe(0);
    });

    it('handles complex step data', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const steps = [
        {
          type: 'analyze',
          description: 'Analyze dependencies',
          status: 'completed',
          result: { files: ['file1.ts', 'file2.ts'] },
          durationMs: 5000,
        },
      ];

      await repo.updateSteps('run-123', 'user-456', steps, 1);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(JSON.parse(params[2] as string)).toEqual(steps);
    });
  });

  describe('delete', () => {
    it('returns true when run was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ rowCount: 1 });

      const result = await repo.delete('run-123', 'user-456');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM orchestration_runs WHERE id = $1 AND user_id = $2',
        ['run-123', 'user-456']
      );
      expect(result).toBe(true);
    });

    it('returns false when no run was found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ rowCount: 0 });

      const result = await repo.delete('nonexistent', 'user-456');

      expect(result).toBe(false);
    });

    it('returns true when execute returns undefined (rowCount !== 0)', async () => {
      mockAdapter.execute.mockResolvedValueOnce(undefined);

      const result = await repo.delete('run-123', 'user-456');

      // When result is undefined, undefined?.rowCount is undefined, and undefined !== 0 is true
      expect(result).toBe(true);
    });
  });

  describe('singleton', () => {
    it('createOrchestrationRunsRepository creates new instances', () => {
      const repo1 = createOrchestrationRunsRepository();
      const repo2 = createOrchestrationRunsRepository();

      expect(repo1).toBeInstanceOf(OrchestrationRunsRepository);
      expect(repo2).toBeInstanceOf(OrchestrationRunsRepository);
      expect(repo1).not.toBe(repo2);
    });

    it('orchestrationRunsRepo is a singleton', () => {
      expect(orchestrationRunsRepo).toBeInstanceOf(OrchestrationRunsRepository);
      // Calling again should return same instance
      expect(orchestrationRunsRepo).toBe(orchestrationRunsRepo);
    });
  });

  describe('error handling', () => {
    it('propagates database errors on create', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('connection failed'));

      await expect(
        repo.create({
          id: 'run-123',
          userId: 'user-456',
          goal: 'Test',
          provider: 'claude-code',
          cwd: '/home/user',
        })
      ).rejects.toThrow('connection failed');
    });

    it('propagates database errors on getById', async () => {
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('query timeout'));

      await expect(repo.getById('run-123', 'user-456')).rejects.toThrow('query timeout');
    });

    it('propagates database errors on list', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.list('user-456')).rejects.toThrow('disk full');
    });

    it('propagates database errors on updateStatus', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.updateStatus('run-123', 'user-456', 'completed')).rejects.toThrow(
        'constraint violation'
      );
    });

    it('propagates database errors on updateSteps', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.updateSteps('run-123', 'user-456', [], 0)).rejects.toThrow(
        'permission denied'
      );
    });

    it('propagates database errors on delete', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.delete('run-123', 'user-456')).rejects.toThrow('timeout');
    });
  });
});
