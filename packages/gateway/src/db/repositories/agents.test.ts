/**
 * Agents Repository Tests
 *
 * Unit tests for AgentsRepository CRUD, JSON config serialization,
 * dynamic updates, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { AgentsRepository } from './agents.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    system_prompt: null,
    provider: 'openai',
    model: 'gpt-4',
    config: '{}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentsRepository', () => {
  let repo: AgentsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AgentsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert an agent and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      const result = await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('agent-1');
      expect(result.name).toBe('TestAgent');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.config).toEqual({});
    });

    it('should store systemPrompt when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ system_prompt: 'You are a helpful assistant.' }),
      );

      const result = await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        systemPrompt: 'You are a helpful assistant.',
        provider: 'openai',
        model: 'gpt-4',
      });

      expect(result.systemPrompt).toBe('You are a helpful assistant.');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe('You are a helpful assistant.');
    });

    it('should store null systemPrompt when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBeNull();
    });

    it('should serialize config as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ config: '{"temperature":0.7,"maxTokens":1000}' }),
      );

      const result = await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
        config: { temperature: 0.7, maxTokens: 1000 },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('{"temperature":0.7,"maxTokens":1000}');
      expect(result.config).toEqual({ temperature: 0.7, maxTokens: 1000 });
    });

    it('should default config to empty object when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[5]).toBe('{}');
    });

    it('should throw when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          id: 'agent-1',
          name: 'TestAgent',
          provider: 'openai',
          model: 'gpt-4',
        }),
      ).rejects.toThrow('Failed to create agent');
    });

    it('should include INSERT INTO agents in the SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      await repo.create({
        id: 'agent-1',
        name: 'TestAgent',
        provider: 'openai',
        model: 'gpt-4',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO agents');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return an agent when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      const result = await repo.getById('agent-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('agent-1');
      expect(result!.name).toBe('TestAgent');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getById('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      const result = await repo.getById('agent-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null system_prompt to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ system_prompt: null }));

      const result = await repo.getById('agent-1');

      expect(result!.systemPrompt).toBeUndefined();
    });

    it('should convert non-null system_prompt to string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ system_prompt: 'You are helpful.' }),
      );

      const result = await repo.getById('agent-1');

      expect(result!.systemPrompt).toBe('You are helpful.');
    });

    it('should parse JSON config string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ config: '{"temperature":0.5}' }),
      );

      const result = await repo.getById('agent-1');

      expect(result!.config).toEqual({ temperature: 0.5 });
    });

    it('should handle empty config string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ config: '' }));

      const result = await repo.getById('agent-1');

      expect(result!.config).toEqual({});
    });

    it('should handle config that is already an object', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ config: { temperature: 0.5 } }),
      );

      const result = await repo.getById('agent-1');

      expect(result!.config).toEqual({ temperature: 0.5 });
    });

    it('should query with WHERE id = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getById('agent-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['agent-1']);
    });
  });

  // =========================================================================
  // getByName
  // =========================================================================

  describe('getByName', () => {
    it('should return an agent when found by name', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ name: 'MyBot' }));

      const result = await repo.getByName('MyBot');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('MyBot');
    });

    it('should return null when name not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByName('Unknown')).toBeNull();
    });

    it('should query with WHERE name = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getByName('TestAgent');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE name = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['TestAgent']);
    });
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('should return empty array when no agents', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getAll()).toEqual([]);
    });

    it('should return mapped agent records', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeAgentRow({ id: 'agent-1', name: 'Bot1' }),
        makeAgentRow({ id: 'agent-2', name: 'Bot2' }),
      ]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('agent-1');
      expect(result[1]!.id).toBe('agent-2');
    });

    it('should order by name ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY name ASC');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update name and return the updated agent', async () => {
      // First call: getById to check existence
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // Second call: getById to return updated agent
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ name: 'UpdatedBot' }));

      const result = await repo.update('agent-1', { name: 'UpdatedBot' });

      expect(result!.name).toBe('UpdatedBot');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null if agent does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { name: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing agent when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());

      const result = await repo.update('agent-1', {});

      expect(result!.id).toBe('agent-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update systemPrompt', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ system_prompt: 'New prompt' }),
      );

      const result = await repo.update('agent-1', { systemPrompt: 'New prompt' });

      expect(result!.systemPrompt).toBe('New prompt');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('system_prompt = $');
    });

    it('should update provider', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ provider: 'anthropic' }));

      const result = await repo.update('agent-1', { provider: 'anthropic' });

      expect(result!.provider).toBe('anthropic');
    });

    it('should update model', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ model: 'claude-3' }));

      const result = await repo.update('agent-1', { model: 'claude-3' });

      expect(result!.model).toBe('claude-3');
    });

    it('should serialize config on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({ config: '{"temperature":0.9}' }),
      );

      await repo.update('agent-1', { config: { temperature: 0.9 } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('{"temperature":0.9}');
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeAgentRow({
          name: 'NewBot',
          provider: 'anthropic',
          model: 'claude-3',
          system_prompt: 'New prompt',
        }),
      );

      const result = await repo.update('agent-1', {
        name: 'NewBot',
        provider: 'anthropic',
        model: 'claude-3',
        systemPrompt: 'New prompt',
      });

      expect(result!.name).toBe('NewBot');
      expect(result!.provider).toBe('anthropic');
      expect(result!.model).toBe('claude-3');
      expect(result!.systemPrompt).toBe('New prompt');
    });

    it('should include updated_at = NOW() in SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ name: 'Updated' }));

      await repo.update('agent-1', { name: 'Updated' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });

    it('should include WHERE id = $N in the UPDATE SQL', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeAgentRow({ name: 'Updated' }));

      await repo.update('agent-1', { name: 'Updated' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $');
      // Last param should be the id
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[params.length - 1]).toBe('agent-1');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('agent-1')).toBe(true);
    });

    it('should return false when agent not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should query with DELETE FROM agents WHERE id = $1', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('agent-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM agents');
      expect(sql).toContain('WHERE id = $1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['agent-1']);
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      expect(await repo.count()).toBe(5);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should return 0 for empty table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.count()).toBe(0);
    });

    it('should query COUNT(*) from agents', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('agents');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createAgentsRepository', () => {
    it('should be importable and return an AgentsRepository instance', async () => {
      const { createAgentsRepository } = await import('./agents.js');
      const r = createAgentsRepository();
      expect(r).toBeInstanceOf(AgentsRepository);
    });
  });

  describe('agentsRepo', () => {
    it('should export a singleton instance', async () => {
      const { agentsRepo } = await import('./agents.js');
      expect(agentsRepo).toBeInstanceOf(AgentsRepository);
    });
  });
});
