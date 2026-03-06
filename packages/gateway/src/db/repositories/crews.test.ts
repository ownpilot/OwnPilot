/**
 * CrewsRepository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { CrewsRepository, getCrewsRepository } = await import('./crews.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'crew-1',
    name: 'Alpha',
    description: 'test crew',
    template_id: null,
    coordination_pattern: 'sequential',
    status: 'idle',
    workspace_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    crew_id: 'crew-1',
    agent_id: 'agent-1',
    role: 'worker',
    joined_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrewsRepository', () => {
  let repo: CrewsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new CrewsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('inserts into agent_crews and returns mapped crew', async () => {
      const row = makeCrewRow({ name: 'Beta', status: 'idle' });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.create({
        name: 'Beta',
        coordinationPattern: 'sequential',
        status: 'idle',
      });

      expect(result.name).toBe('Beta');
      expect(result.status).toBe('idle');
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO agent_crews');
      expect(sql).toContain('RETURNING *');
      expect(params[0]).toBe('Beta');
    });

    it('passes optional description, templateId, workspaceId', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCrewRow()]);
      await repo.create({
        name: 'X',
        description: 'desc',
        templateId: 'tmpl-1',
        coordinationPattern: 'parallel',
        status: 'running',
        workspaceId: 'ws-1',
      });
      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[1]).toBe('desc');
      expect(params[2]).toBe('tmpl-1');
      expect(params[5]).toBe('ws-1');
    });

    it('defaults optional fields to null when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCrewRow()]);
      await repo.create({
        name: 'Y',
        coordinationPattern: 'sequential',
        status: 'idle',
      });
      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[1]).toBeNull(); // description
      expect(params[2]).toBeNull(); // templateId
      expect(params[5]).toBeNull(); // workspaceId
    });

    it('maps description null → undefined on returned object', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCrewRow({ description: null })]);
      const result = await repo.create({
        name: 'Z',
        coordinationPattern: 'sequential',
        status: 'idle',
      });
      expect(result.description).toBeUndefined();
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.getById('missing');
      expect(result).toBeNull();
    });

    it('returns mapped crew when found (no userId)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCrewRow({ id: 'crew-42' }));
      const result = await repo.getById('crew-42');
      expect(result?.id).toBe('crew-42');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['crew-42']);
      expect(sql).not.toContain('workspace_id');
    });

    it('adds workspace_id filter when userId provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCrewRow());
      await repo.getById('crew-1', 'user-99');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('workspace_id = $2');
      expect(params[1]).toBe('user-99');
    });

    it('parses createdAt and updatedAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCrewRow({ created_at: '2025-06-01T10:00:00Z', updated_at: '2025-06-02T12:00:00Z' })
      );
      const result = await repo.getById('crew-1');
      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.updatedAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('returns empty array when no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const result = await repo.list(null, 20, 0);
      expect(result).toEqual([]);
    });

    it('maps multiple rows without userId filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeCrewRow({ id: 'c1' }),
        makeCrewRow({ id: 'c2' }),
      ]);
      const result = await repo.list(null, 10, 0);
      expect(result).toHaveLength(2);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('workspace_id');
      expect(params).toEqual([10, 0]);
    });

    it('adds workspace_id filter and pagination when userId provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCrewRow()]);
      await repo.list('user-1', 5, 10);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('workspace_id = $1');
      expect(params).toEqual(['user-1', 5, 10]);
    });

    it('orders by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.list(null, 20, 0);
      const [sql] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('returns 0 when no row returned', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      const result = await repo.count();
      expect(result).toBe(0);
    });

    it('returns parsed integer count without userId filter', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });
      const result = await repo.count();
      expect(result).toBe(42);
      const [sql] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('workspace_id');
    });

    it('adds workspace_id filter when userId provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });
      const result = await repo.count('ws-1');
      expect(result).toBe(7);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('workspace_id = $1');
      expect(params).toEqual(['ws-1']);
    });
  });

  // =========================================================================
  // updateStatus
  // =========================================================================

  describe('updateStatus', () => {
    it('executes UPDATE with status and crewId', async () => {
      await repo.updateStatus('crew-1', 'running');
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE agent_crews');
      expect(sql).toContain('status = $1');
      expect(params[0]).toBe('running');
      expect(params[1]).toBe('crew-1');
    });
  });

  // =========================================================================
  // addMember
  // =========================================================================

  describe('addMember', () => {
    it('inserts into agent_crew_members with ON CONFLICT upsert', async () => {
      await repo.addMember('crew-1', 'agent-5', 'lead');
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO agent_crew_members');
      expect(sql).toContain('ON CONFLICT');
      expect(params[0]).toBe('crew-1');
      expect(params[1]).toBe('agent-5');
      expect(params[2]).toBe('lead');
    });
  });

  // =========================================================================
  // getMembers
  // =========================================================================

  describe('getMembers', () => {
    it('returns empty array when no members', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const result = await repo.getMembers('crew-1');
      expect(result).toEqual([]);
    });

    it('maps member rows to CrewMember objects', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMemberRow({ agent_id: 'agent-A', role: 'lead' }),
        makeMemberRow({ agent_id: 'agent-B', role: 'worker' }),
      ]);
      const result = await repo.getMembers('crew-1');
      expect(result).toHaveLength(2);
      expect(result[0].agentId).toBe('agent-A');
      expect(result[0].role).toBe('lead');
      expect(result[1].agentId).toBe('agent-B');
    });

    it('queries with crew_id filter and ORDER BY joined_at', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.getMembers('crew-99');
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('crew_id = $1');
      expect(sql).toContain('ORDER BY joined_at');
      expect(params[0]).toBe('crew-99');
    });

    it('parses joinedAt as Date', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMemberRow({ joined_at: '2025-03-15T08:00:00Z' }),
      ]);
      const result = await repo.getMembers('crew-1');
      expect(result[0].joinedAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // removeMember
  // =========================================================================

  describe('removeMember', () => {
    it('deletes from agent_crew_members with crew_id and agent_id', async () => {
      await repo.removeMember('crew-1', 'agent-5');
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM agent_crew_members');
      expect(params[0]).toBe('crew-1');
      expect(params[1]).toBe('agent-5');
    });
  });

  // =========================================================================
  // removeAllMembers
  // =========================================================================

  describe('removeAllMembers', () => {
    it('deletes all members for a crew', async () => {
      await repo.removeAllMembers('crew-7');
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM agent_crew_members');
      expect(sql).toContain('crew_id = $1');
      expect(params[0]).toBe('crew-7');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('returns true when crew deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      const result = await repo.delete('crew-1');
      expect(result).toBe(true);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM agent_crews');
      expect(params[0]).toBe('crew-1');
    });

    it('returns false when crew not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      const result = await repo.delete('missing');
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // singleton
  // =========================================================================

  it('getCrewsRepository returns same instance on repeated calls', () => {
    const r1 = getCrewsRepository();
    const r2 = getCrewsRepository();
    expect(r1).toBe(r2);
  });
});
