/**
 * AgentMessagesRepository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { AgentMessagesRepository, getAgentMessagesRepository } = await import('./agent-messages.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    from_agent_id: 'agent-A',
    to_agent_id: 'agent-B',
    type: 'task',
    subject: 'Do work',
    content: 'Please process this',
    attachments: '[]',
    priority: 'normal',
    thread_id: null,
    requires_response: false,
    deadline: null,
    status: 'pending',
    crew_id: null,
    created_at: '2025-01-01T00:00:00Z',
    read_at: null,
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    from: 'agent-A',
    to: 'agent-B',
    type: 'task' as const,
    subject: 'Do work',
    content: 'Please process this',
    attachments: [],
    priority: 'normal' as const,
    requiresResponse: false,
    status: 'pending' as const,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentMessagesRepository', () => {
  let repo: AgentMessagesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new AgentMessagesRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('inserts into agent_messages with all 15 params', async () => {
      const msg = makeMessage();
      await repo.create(msg);
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO agent_messages');
      expect(params).toHaveLength(15);
      expect(params[0]).toBe('msg-1');
      expect(params[1]).toBe('agent-A');
      expect(params[2]).toBe('agent-B');
    });

    it('serializes attachments as JSON', async () => {
      const msg = makeMessage({ attachments: [{ type: 'file', url: 's3://x' }] });
      await repo.create(msg);
      const [, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(params[6]).toBe('[{"type":"file","url":"s3://x"}]');
    });

    it('serializes deadline as ISO string when present', async () => {
      const deadline = new Date('2025-12-31T23:59:59Z');
      const msg = makeMessage({ deadline });
      await repo.create(msg);
      const [, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(params[10]).toBe(deadline.toISOString());
    });

    it('sets deadline to null when not provided', async () => {
      await repo.create(makeMessage());
      const [, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(params[10]).toBeNull();
    });

    it('sets threadId and crewId to null when not provided', async () => {
      await repo.create(makeMessage());
      const [, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(params[8]).toBeNull(); // threadId
      expect(params[12]).toBeNull(); // crewId
    });
  });

  // =========================================================================
  // findForAgent
  // =========================================================================

  describe('findForAgent', () => {
    it('returns empty array when no rows', async () => {
      const result = await repo.findForAgent('agent-B', {});
      expect(result).toEqual([]);
    });

    it('queries with to_agent_id filter and default limit 20', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);
      await repo.findForAgent('agent-B', {});
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('to_agent_id = $1');
      expect(params[0]).toBe('agent-B');
      expect(params[params.length - 1]).toBe(20); // default limit
    });

    it('adds unreadOnly filter when requested', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.findForAgent('agent-B', { unreadOnly: true });
      const [sql] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("status != 'read'");
    });

    it('adds types filter when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.findForAgent('agent-B', { types: ['task', 'instruction'] });
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('type = ANY(');
      expect(params).toContainEqual(['task', 'instruction']);
    });

    it('adds fromAgent filter when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.findForAgent('agent-B', { fromAgent: 'agent-A' });
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('from_agent_id =');
      expect(params).toContain('agent-A');
    });

    it('maps rows to AgentMessage with correct field names', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ from_agent_id: null, to_agent_id: null }),
      ]);
      const result = await repo.findForAgent('agent-B', {});
      expect(result[0].from).toBe('unknown');
      expect(result[0].to).toBe('unknown');
    });
  });

  // =========================================================================
  // markAsRead
  // =========================================================================

  describe('markAsRead', () => {
    it('does nothing when ids array is empty', async () => {
      await repo.markAsRead([]);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('executes UPDATE with ids array', async () => {
      await repo.markAsRead(['msg-1', 'msg-2']);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("status = 'read'");
      expect(params[0]).toEqual(['msg-1', 'msg-2']);
    });
  });

  // =========================================================================
  // getCrewMembers
  // =========================================================================

  describe('getCrewMembers', () => {
    it('returns agent_id array from crew members table', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ agent_id: 'agent-X' }, { agent_id: 'agent-Y' }]);
      const result = await repo.getCrewMembers('crew-1');
      expect(result).toEqual(['agent-X', 'agent-Y']);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('agent_crew_members');
      expect(params[0]).toBe('crew-1');
    });

    it('returns empty array when no members', async () => {
      expect(await repo.getCrewMembers('crew-empty')).toEqual([]);
    });
  });

  // =========================================================================
  // findConversation
  // =========================================================================

  describe('findConversation', () => {
    it('queries messages between two agents bidirectionally', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);
      const result = await repo.findConversation('agent-A', 'agent-B', 10);
      expect(result).toHaveLength(1);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('from_agent_id = $1 AND to_agent_id = $2');
      expect(sql).toContain('from_agent_id = $2 AND to_agent_id = $1');
      expect(params[2]).toBe(10);
    });
  });

  // =========================================================================
  // findByThread
  // =========================================================================

  describe('findByThread', () => {
    it('queries by thread_id ordered by created_at', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);
      await repo.findByThread('thread-42');
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('thread_id = $1');
      expect(sql).toContain('ORDER BY created_at');
      expect(params[0]).toBe('thread-42');
    });
  });

  // =========================================================================
  // countUnread
  // =========================================================================

  describe('countUnread', () => {
    it('returns 0 when null returned', async () => {
      expect(await repo.countUnread('agent-B')).toBe(0);
    });

    it('returns parsed integer', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });
      expect(await repo.countUnread('agent-B')).toBe(7);
    });

    it('filters by to_agent_id and not-read status', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });
      await repo.countUnread('agent-X');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('to_agent_id = $1');
      expect(sql).toContain("status != 'read'");
      expect(params[0]).toBe('agent-X');
    });
  });

  // =========================================================================
  // countToday
  // =========================================================================

  describe('countToday', () => {
    it('returns 0 when null returned', async () => {
      expect(await repo.countToday('crew-1')).toBe(0);
    });

    it('returns parsed integer for crew messages today', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '15' });
      expect(await repo.countToday('crew-1')).toBe(15);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('returns mapped messages with pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow(), makeMessageRow({ id: 'msg-2' })]);
      const result = await repo.list(10, 20);
      expect(result).toHaveLength(2);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params[0]).toBe(10);
      expect(params[1]).toBe(20);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('returns 0 when no row', async () => {
      expect(await repo.count()).toBe(0);
    });

    it('returns count of all messages', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });
      expect(await repo.count()).toBe(42);
    });
  });

  // =========================================================================
  // listByAgent
  // =========================================================================

  describe('listByAgent', () => {
    it('filters by from_agent_id OR to_agent_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow()]);
      await repo.listByAgent('agent-A', 5, 0);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('from_agent_id = $1 OR to_agent_id = $1');
      expect(params[0]).toBe('agent-A');
      expect(params[1]).toBe(5);
    });
  });

  // =========================================================================
  // listByCrew
  // =========================================================================

  describe('listByCrew', () => {
    it('filters by crew_id with pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.listByCrew('crew-7', 10, 5);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('crew_id = $1');
      expect(params[0]).toBe('crew-7');
      expect(params[1]).toBe(10);
      expect(params[2]).toBe(5);
    });
  });

  // =========================================================================
  // countUnreadByAgentIds
  // =========================================================================

  describe('countUnreadByAgentIds', () => {
    it('returns empty Map when agentIds is empty', async () => {
      const result = await repo.countUnreadByAgentIds([]);
      expect(result).toEqual(new Map());
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('returns Map with parsed counts keyed by agent_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { to_agent_id: 'agent-A', count: '3' },
        { to_agent_id: 'agent-B', count: '7' },
      ]);
      const result = await repo.countUnreadByAgentIds(['agent-A', 'agent-B']);
      expect(result.get('agent-A')).toBe(3);
      expect(result.get('agent-B')).toBe(7);
    });

    it('uses IN placeholders for agent IDs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      await repo.countUnreadByAgentIds(['a1', 'a2', 'a3']);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('IN ($1, $2, $3)');
      expect(params).toEqual(['a1', 'a2', 'a3']);
    });
  });

  // =========================================================================
  // Row mapper edge cases
  // =========================================================================

  describe('row mapper', () => {
    it('maps readAt to Date when present', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ read_at: '2025-06-01T10:00:00Z' }),
      ]);
      const result = await repo.list(10, 0);
      expect(result[0].readAt).toBeInstanceOf(Date);
    });

    it('maps readAt to undefined when null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ read_at: null })]);
      const result = await repo.list(10, 0);
      expect(result[0].readAt).toBeUndefined();
    });

    it('maps threadId to undefined when null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ thread_id: null })]);
      const result = await repo.list(10, 0);
      expect(result[0].threadId).toBeUndefined();
    });

    it('maps crewId to undefined when null', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeMessageRow({ crew_id: null })]);
      const result = await repo.list(10, 0);
      expect(result[0].crewId).toBeUndefined();
    });

    it('parses attachments JSON array', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeMessageRow({ attachments: '[{"type":"file","url":"s3://x"}]' }),
      ]);
      const result = await repo.list(10, 0);
      expect(result[0].attachments).toEqual([{ type: 'file', url: 's3://x' }]);
    });
  });

  // =========================================================================
  // singleton
  // =========================================================================

  it('getAgentMessagesRepository returns same instance on repeated calls', () => {
    const r1 = getAgentMessagesRepository();
    const r2 = getAgentMessagesRepository();
    expect(r1).toBe(r2);
  });
});
