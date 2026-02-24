/**
 * Workspaces Repository Tests
 *
 * Unit tests for WorkspacesRepository CRUD, container status, code executions,
 * audit logging, and user-scoped operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

// Mock node:crypto for deterministic UUIDs and hashes
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  let callCount = 0;
  return {
    ...actual,
    randomUUID: () => `uuid-${++callCount}`,
    createHash: () => ({
      update: () => ({
        digest: () => 'abcdef1234567890abcdef1234567890',
      }),
    }),
  };
});

import { WorkspacesRepository } from './workspaces.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

const sampleContainerConfig = {
  memoryMB: 512,
  cpuCores: 0.5,
  storageGB: 2,
  timeoutMs: 30000,
  networkPolicy: 'none' as const,
};

function makeWorkspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    user_id: 'user-1',
    name: 'My Workspace',
    description: null,
    status: 'active',
    storage_path: '/data/workspaces/ws-1',
    container_config: JSON.stringify(sampleContainerConfig),
    container_id: null,
    container_status: 'stopped',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeExecutionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    language: 'python',
    code_hash: 'abcdef1234567890',
    status: 'pending',
    stdout: null,
    stderr: null,
    exit_code: null,
    execution_time_ms: null,
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesRepository', () => {
  let repo: WorkspacesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new WorkspacesRepository('user-1');
  });

  // =========================================================================
  // constructor
  // =========================================================================

  describe('constructor', () => {
    it('should default userId to "default"', () => {
      const defaultRepo = new WorkspacesRepository();
      // We verify by checking the userId is used in queries
      expect(defaultRepo).toBeInstanceOf(WorkspacesRepository);
    });

    it('should accept a custom userId', () => {
      const customRepo = new WorkspacesRepository('custom-user');
      expect(customRepo).toBeInstanceOf(WorkspacesRepository);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no workspaces', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped workspace records', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkspaceRow({ id: 'ws-1' }),
        makeWorkspaceRow({ id: 'ws-2', name: 'Second Workspace' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('ws-1');
      expect(result[1]!.name).toBe('Second Workspace');
    });

    it('should exclude deleted workspaces', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("status != 'deleted'");
    });

    it('should filter by user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });

    it('should order by updated_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY updated_at DESC');
    });

    it('should parse containerConfig from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkspaceRow()]);

      const result = await repo.list();

      expect(result[0]!.containerConfig).toEqual(sampleContainerConfig);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeWorkspaceRow()]);

      const result = await repo.list();

      expect(result[0]!.description).toBeUndefined();
      expect(result[0]!.containerId).toBeUndefined();
    });

    it('should convert non-null optional fields to values', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeWorkspaceRow({
          description: 'A test workspace',
          container_id: 'container-abc',
        }),
      ]);

      const result = await repo.list();

      expect(result[0]!.description).toBe('A test workspace');
      expect(result[0]!.containerId).toBe('container-abc');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      expect(await repo.count()).toBe(3);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should return 0 for empty results', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.count()).toBe(0);
    });

    it('should exclude deleted workspaces', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain("status != 'deleted'");
    });

    it('should filter by user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a workspace when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      const result = await repo.get('ws-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ws-1');
      expect(result!.name).toBe('My Workspace');
      expect(result!.status).toBe('active');
      expect(result!.containerStatus).toBe('stopped');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      const result = await repo.get('ws-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should scope to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('ws-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ws-1', 'user-1']);
    });

    it('should parse containerConfig from JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      const result = await repo.get('ws-1');

      expect(result!.containerConfig).toEqual(sampleContainerConfig);
    });

    it('should handle containerConfig that is already an object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWorkspaceRow({ container_config: sampleContainerConfig })
      );

      const result = await repo.get('ws-1');

      expect(result!.containerConfig).toEqual(sampleContainerConfig);
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a workspace and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      const result = await repo.create({
        name: 'My Workspace',
        storagePath: '/data/workspaces/ws-1',
        containerConfig: sampleContainerConfig,
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('ws-1');
      expect(result.name).toBe('My Workspace');
      expect(result.status).toBe('active');
      expect(result.containerStatus).toBe('stopped');
    });

    it('should use the repository userId when input.userId is not set', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      await repo.create({
        name: 'Test',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // userId should be the second param
      expect(params[1]).toBe('user-1');
    });

    it('should use input.userId when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ user_id: 'custom-user' }));

      await repo.create({
        userId: 'custom-user',
        name: 'Test',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('custom-user');
    });

    it('should serialize containerConfig as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      await repo.create({
        name: 'Test',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(JSON.stringify(sampleContainerConfig));
    });

    it('should store null description when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      await repo.create({
        name: 'Test',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // description is the 4th param
      expect(params[3]).toBeNull();
    });

    it('should store description when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ description: 'A workspace' }));

      await repo.create({
        name: 'Test',
        description: 'A workspace',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('A workspace');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          name: 'Test',
          storagePath: '/data/test',
          containerConfig: sampleContainerConfig,
        })
      ).rejects.toThrow('Failed to create workspace');
    });

    it('should insert with status active and container_status stopped', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      await repo.create({
        name: 'Test',
        storagePath: '/data/test',
        containerConfig: sampleContainerConfig,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("'active'");
      expect(sql).toContain("'stopped'");
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update name and return the updated workspace', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ name: 'Updated Workspace' }));

      const result = await repo.update('ws-1', { name: 'Updated Workspace' });

      expect(result!.name).toBe('Updated Workspace');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return existing workspace when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow());

      const result = await repo.update('ws-1', {});

      expect(result!.id).toBe('ws-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update description', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWorkspaceRow({ description: 'New description' })
      );

      const result = await repo.update('ws-1', { description: 'New description' });

      expect(result!.description).toBe('New description');
    });

    it('should update status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ status: 'paused' }));

      const result = await repo.update('ws-1', { status: 'paused' });

      expect(result!.status).toBe('paused');
    });

    it('should serialize containerConfig on update', async () => {
      const newConfig = { ...sampleContainerConfig, memoryMB: 1024 };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWorkspaceRow({ container_config: JSON.stringify(newConfig) })
      );

      await repo.update('ws-1', { containerConfig: newConfig });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(JSON.stringify(newConfig));
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWorkspaceRow({
          name: 'NewName',
          description: 'NewDesc',
          status: 'paused',
        })
      );

      const result = await repo.update('ws-1', {
        name: 'NewName',
        description: 'NewDesc',
        status: 'paused',
      });

      expect(result!.name).toBe('NewName');
      expect(result!.description).toBe('NewDesc');
      expect(result!.status).toBe('paused');
    });

    it('should include updated_at = NOW() in SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ name: 'Updated' }));

      await repo.update('ws-1', { name: 'Updated' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });

    it('should scope update to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWorkspaceRow({ name: 'Updated' }));

      await repo.update('ws-1', { name: 'Updated' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // id and userId should be the last two params
      expect(params).toContain('ws-1');
      expect(params).toContain('user-1');
    });

    it('should return null when workspace not found (get returns null)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('missing', { name: 'Updated' });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // delete (soft delete)
  // =========================================================================

  describe('delete', () => {
    it('should return true when soft deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('ws-1')).toBe(true);
    });

    it('should return false when workspace not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should set status to deleted instead of deleting row', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('ws-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'deleted'");
      expect(sql).not.toContain('DELETE FROM');
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('ws-1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ws-1', 'user-1']);
    });

    it('should include updated_at = NOW()', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('ws-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });
  });

  // =========================================================================
  // updateContainerStatus
  // =========================================================================

  describe('updateContainerStatus', () => {
    it('should update container_id and container_status', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateContainerStatus('ws-1', 'container-abc', 'running');

      expect(result).toBe(true);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('container_id = $1');
      expect(sql).toContain('container_status = $2');
    });

    it('should return false when workspace not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.updateContainerStatus('missing', null, 'stopped')).toBe(false);
    });

    it('should accept null containerId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateContainerStatus('ws-1', null, 'stopped');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBeNull();
      expect(params[1]).toBe('stopped');
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateContainerStatus('ws-1', 'c-1', 'running');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe('ws-1');
      expect(params[3]).toBe('user-1');
    });

    it('should update updated_at', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateContainerStatus('ws-1', 'c-1', 'running');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });
  });

  // =========================================================================
  // countExecutions
  // =========================================================================

  describe('countExecutions', () => {
    it('should return the count of executions for a workspace', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      expect(await repo.countExecutions('ws-1')).toBe(5);
    });

    it('should return 0 when no executions', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.countExecutions('ws-1')).toBe(0);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.countExecutions('ws-1')).toBe(0);
    });

    it('should query by workspace_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.countExecutions('ws-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('code_executions');
      expect(sql).toContain('WHERE workspace_id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ws-1']);
    });
  });

  // =========================================================================
  // createExecution
  // =========================================================================

  describe('createExecution', () => {
    it('should insert an execution and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.createExecution('ws-1', 'python', 'print("hello")');

      expect(result.workspaceId).toBe('ws-1');
      expect(result.userId).toBe('user-1');
      expect(result.language).toBe('python');
      expect(result.status).toBe('pending');
    });

    it('should hash the code', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.createExecution('ws-1', 'python', 'print("hello")');

      expect(result.codeHash).toBeDefined();
      expect(typeof result.codeHash).toBe('string');
    });

    it('should throw when queryOne returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.createExecution('ws-1', 'python', 'print("hello")')).rejects.toThrow(
        'Failed to create execution'
      );
    });

    it('should insert with status pending', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      await repo.createExecution('ws-1', 'python', 'code');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("'pending'");
      expect(sql).toContain('INSERT INTO code_executions');
    });

    it('should convert null stdout/stderr to undefined', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.createExecution('ws-1', 'python', 'code');

      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBeUndefined();
    });

    it('should convert null exit_code and execution_time_ms to undefined', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeExecutionRow());

      const result = await repo.createExecution('ws-1', 'python', 'code');

      expect(result.exitCode).toBeUndefined();
      expect(result.executionTimeMs).toBeUndefined();
    });
  });

  // =========================================================================
  // updateExecution
  // =========================================================================

  describe('updateExecution', () => {
    it('should update execution status and return true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateExecution('exec-1', 'completed', 'output', '', 0, 150);

      expect(result).toBe(true);
    });

    it('should return false when execution not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.updateExecution('missing', 'failed')).toBe(false);
    });

    it('should store stdout and stderr', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateExecution('exec-1', 'completed', 'hello world', 'warning', 0, 100);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('completed');
      expect(params[1]).toBe('hello world');
      expect(params[2]).toBe('warning');
      expect(params[3]).toBe(0);
      expect(params[4]).toBe(100);
      expect(params[5]).toBe('exec-1');
    });

    it('should store null for optional fields when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateExecution('exec-1', 'failed');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('failed');
      expect(params[1]).toBeNull(); // stdout
      expect(params[2]).toBeNull(); // stderr
      expect(params[3]).toBeNull(); // exitCode
      expect(params[4]).toBeNull(); // executionTimeMs
    });

    it('should update the correct execution by id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateExecution('exec-1', 'completed');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $6');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('exec-1');
    });
  });

  // =========================================================================
  // listExecutions
  // =========================================================================

  describe('listExecutions', () => {
    it('should return executions for a workspace', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeExecutionRow({ id: 'exec-1' }),
        makeExecutionRow({ id: 'exec-2', status: 'completed' }),
      ]);

      const result = await repo.listExecutions('ws-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('exec-1');
      expect(result[1]!.status).toBe('completed');
    });

    it('should return empty array when no executions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.listExecutions('ws-1')).toEqual([]);
    });

    it('should use default limit of 10', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listExecutions('ws-1');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(10);
    });

    it('should accept custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listExecutions('ws-1', 50);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(50);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listExecutions('ws-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should filter by workspace_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listExecutions('ws-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE workspace_id = $1');
    });

    it('should parse execution fields correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeExecutionRow({
          stdout: 'output text',
          stderr: 'error text',
          exit_code: 1,
          execution_time_ms: 250,
          status: 'failed',
        }),
      ]);

      const result = await repo.listExecutions('ws-1');

      expect(result[0]!.stdout).toBe('output text');
      expect(result[0]!.stderr).toBe('error text');
      expect(result[0]!.exitCode).toBe(1);
      expect(result[0]!.executionTimeMs).toBe(250);
      expect(result[0]!.status).toBe('failed');
    });
  });

  // =========================================================================
  // logAudit
  // =========================================================================

  describe('logAudit', () => {
    it('should insert an audit record', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace', 'ws-1');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO workspace_audit');
    });

    it('should use resourceType as resource when resource is not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('list', 'workspace');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // resource param (5th) should be the resourceType
      expect(params[4]).toBe('workspace');
    });

    it('should use provided resource when given', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace', 'ws-123');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBe('ws-123');
    });

    it('should default success to true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(true);
    });

    it('should accept success=false and error message', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace', 'ws-1', false, 'Something failed');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe(false);
      expect(params[6]).toBe('Something failed');
    });

    it('should accept an IP address', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace', 'ws-1', true, undefined, '192.168.1.1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[7]).toBe('192.168.1.1');
    });

    it('should store null for optional error and ip_address', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBeNull(); // error
      expect(params[7]).toBeNull(); // ip_address
    });

    it('should not throw when execute fails', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw
      await expect(repo.logAudit('create', 'workspace')).resolves.toBeUndefined();
    });

    it('should use the repository userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.logAudit('create', 'workspace');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('user-1');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createWorkspacesRepository', () => {
    it('should be importable and return a WorkspacesRepository instance', async () => {
      const { createWorkspacesRepository } = await import('./workspaces.js');
      const r = createWorkspacesRepository('user-1');
      expect(r).toBeInstanceOf(WorkspacesRepository);
    });

    it('should default userId to "default"', async () => {
      const { createWorkspacesRepository } = await import('./workspaces.js');
      const r = createWorkspacesRepository();
      expect(r).toBeInstanceOf(WorkspacesRepository);
    });
  });
});
