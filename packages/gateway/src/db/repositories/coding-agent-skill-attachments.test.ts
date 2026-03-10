/**
 * CodingAgentSkillAttachmentsRepository Tests
 *
 * Tests the repository for managing coding agent skill attachments,
 * including CRUD operations and dynamic update field building.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the adapter module
// ---------------------------------------------------------------------------

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

// Import after mocks are established
const {
  CodingAgentSkillAttachmentsRepository,
  codingAgentSkillAttachmentsRepo,
  createCodingAgentSkillAttachmentsRepository,
} = await import('./coding-agent-skill-attachments.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockAttachmentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'attach-123',
    user_id: 'default',
    provider_ref: 'claude-code',
    type: 'inline',
    extension_id: null,
    label: 'Test Skill',
    instructions: 'Follow these instructions',
    priority: 5,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodingAgentSkillAttachmentsRepository', () => {
  let repo: CodingAgentSkillAttachmentsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createCodingAgentSkillAttachmentsRepository();
  });

  // ---- create() ----

  describe('create', () => {
    it('creates attachment with all fields', async () => {
      const input = {
        providerRef: 'claude-code',
        type: 'inline' as const,
        label: 'My Skill',
        instructions: 'Do this and that',
        priority: 10,
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow({
        provider_ref: 'claude-code',
        type: 'inline',
        label: 'My Skill',
        instructions: 'Do this and that',
        priority: 10,
      }));

      const result = await repo.create(input, 'default');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO coding_agent_skill_attachments');
      expect(params).toHaveLength(11);
      expect(params[1]).toBe('default');
      expect(params[2]).toBe('claude-code');
      expect(params[3]).toBe('inline');
      expect(params[4]).toBeNull(); // extension_id
      expect(params[5]).toBe('My Skill');
      expect(params[6]).toBe('Do this and that');
      expect(params[7]).toBe(10); // priority
      expect(params[8]).toBe(true); // active

      expect(result.providerRef).toBe('claude-code');
      expect(result.label).toBe('My Skill');
      expect(result.priority).toBe(10);
    });

    it('creates extension-type attachment', async () => {
      const input = {
        providerRef: 'claude-code',
        type: 'extension' as const,
        extensionId: 'ext-123',
        priority: 3,
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow({
        type: 'extension',
        extension_id: 'ext-123',
        label: null,
        instructions: null,
        priority: 3,
      }));

      const result = await repo.create(input);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[3]).toBe('extension');
      expect(params[4]).toBe('ext-123');
      expect(params[5]).toBeNull();
      expect(params[6]).toBeNull();

      expect(result.type).toBe('extension');
      expect(result.extensionId).toBe('ext-123');
    });

    it('uses default values when optional fields omitted', async () => {
      const input = {
        providerRef: 'test',
        type: 'inline' as const,
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow({
        provider_ref: 'test',
        type: 'inline',
        priority: 0,
        active: true,
      }));

      await repo.create(input);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[7]).toBe(0); // default priority
      expect(params[8]).toBe(true); // default active
    });

    it('throws error when getById returns null after create', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ providerRef: 'test', type: 'inline' })).rejects.toThrow(
        'Failed to create skill attachment'
      );
    });
  });

  // ---- getById() ----

  describe('getById', () => {
    it('returns mapped record when attachment exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow());

      const result = await repo.getById('attach-123', 'default');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT * FROM coding_agent_skill_attachments WHERE id = $1 AND user_id = $2',
        ['attach-123', 'default']
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('attach-123');
      expect(result?.userId).toBe('default');
      expect(result?.providerRef).toBe('claude-code');
      expect(result?.type).toBe('inline');
      expect(result?.label).toBe('Test Skill');
      expect(result?.instructions).toBe('Follow these instructions');
      expect(result?.priority).toBe(5);
      expect(result?.active).toBe(true);
    });

    it('returns null when attachment does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent', 'default');

      expect(result).toBeNull();
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow());

      await repo.getById('attach-123');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.any(String), [
        'attach-123',
        'default',
      ]);
    });

    it('handles extension type attachment', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockAttachmentRow({
          type: 'extension',
          extension_id: 'ext-456',
          label: null,
          instructions: null,
        })
      );

      const result = await repo.getById('attach-123');

      expect(result?.type).toBe('extension');
      expect(result?.extensionId).toBe('ext-456');
      expect(result?.label).toBeUndefined();
      expect(result?.instructions).toBeUndefined();
    });

    it('parses numeric priority to number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockAttachmentRow({ priority: '15' })
      );

      const result = await repo.getById('attach-123');

      expect(result?.priority).toBe(15);
      expect(typeof result?.priority).toBe('number');
    });

    it('parses boolean active from numeric format', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockAttachmentRow({ active: 0 })
      );

      const result = await repo.getById('attach-123');

      expect(result?.active).toBe(false);
    });
  });

  // ---- listByProvider() ----

  describe('listByProvider', () => {
    it('returns empty array when no attachments', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByProvider('claude-code', 'default');

      expect(result).toEqual([]);
    });

    it('returns attachments ordered by priority and created_at', async () => {
      const mockRows = [
        createMockAttachmentRow({ id: 'attach-1', priority: 1, provider_ref: 'claude-code' }),
        createMockAttachmentRow({ id: 'attach-2', priority: 5, provider_ref: 'claude-code' }),
        createMockAttachmentRow({ id: 'attach-3', priority: 1, provider_ref: 'claude-code', created_at: '2026-01-03T00:00:00Z' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const result = await repo.listByProvider('claude-code', 'default');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY priority ASC, created_at ASC'),
        ['claude-code', 'default']
      );
      expect(result).toHaveLength(3);
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByProvider('claude-code');

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), [
        'claude-code',
        'default',
      ]);
    });
  });

  // ---- listAllActive() ----

  describe('listAllActive', () => {
    it('returns only active attachments', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        createMockAttachmentRow({ id: 'attach-1', active: true }),
        createMockAttachmentRow({ id: 'attach-2', active: true }),
      ]);

      const result = await repo.listAllActive('default');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND active = TRUE'),
        ['default']
      );
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no active attachments', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listAllActive('default');

      expect(result).toEqual([]);
    });

    it('orders by provider_ref then priority', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAllActive('default');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY provider_ref, priority ASC'),
        expect.any(Array)
      );
    });
  });

  // ---- update() ----

  describe('update', () => {
    it('returns null when attachment does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('nonexistent', { label: 'New' });

      expect(result).toBeNull();
    });

    it('updates single field', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(createMockAttachmentRow()) // check exists
        .mockResolvedValueOnce(createMockAttachmentRow({ label: 'Updated Label' })); // return updated

      const result = await repo.update('attach-123', { label: 'Updated Label' });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coding_agent_skill_attachments SET label = $1, updated_at = $2'),
        ['Updated Label', expect.any(String), 'attach-123', 'default']
      );
      expect(result?.label).toBe('Updated Label');
    });

    it('updates multiple fields', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(createMockAttachmentRow())
        .mockResolvedValueOnce(
          createMockAttachmentRow({
            label: 'New Label',
            instructions: 'New Instructions',
            priority: 20,
            active: false,
          })
        );

      const result = await repo.update('attach-123', {
        label: 'New Label',
        instructions: 'New Instructions',
        priority: 20,
        active: false,
      });

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('label = $1');
      expect(sql).toContain('instructions = $2');
      expect(sql).toContain('priority = $3');
      expect(sql).toContain('active = $4');
      expect(sql).toContain('updated_at = $5');
      expect(params).toHaveLength(7); // 5 fields + id + userId

      expect(result?.label).toBe('New Label');
      expect(result?.instructions).toBe('New Instructions');
      expect(result?.priority).toBe(20);
      expect(result?.active).toBe(false);
    });

    it('returns existing record when no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow());

      const result = await repo.update('attach-123', {});

      expect(mockAdapter.execute).not.toHaveBeenCalled();
      expect(result?.id).toBe('attach-123');
    });

    it('uses custom userId', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(createMockAttachmentRow({ user_id: 'user-456' }))
        .mockResolvedValueOnce(createMockAttachmentRow({ user_id: 'user-456', label: 'Updated' }));

      await repo.update('attach-123', { label: 'Updated' }, 'user-456');

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[params.length - 1]).toBe('user-456');
    });
  });

  // ---- delete() ----

  describe('delete', () => {
    it('returns true when attachment was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('attach-123', 'default');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM coding_agent_skill_attachments WHERE id = $1 AND user_id = $2',
        ['attach-123', 'default']
      );
      expect(result).toBe(true);
    });

    it('returns false when no attachment found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('handles null result from execute', async () => {
      mockAdapter.execute.mockResolvedValueOnce(null);

      const result = await repo.delete('attach-123');

      expect(result).toBe(false);
    });
  });

  // ---- deleteByProvider() ----

  describe('deleteByProvider', () => {
    it('returns count of deleted attachments', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 });

      const result = await repo.deleteByProvider('claude-code', 'default');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM coding_agent_skill_attachments WHERE provider_ref = $1 AND user_id = $2',
        ['claude-code', 'default']
      );
      expect(result).toBe(5);
    });

    it('returns 0 when no attachments deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteByProvider('nonexistent');

      expect(result).toBe(0);
    });

    it('returns 0 when execute returns null', async () => {
      mockAdapter.execute.mockResolvedValueOnce(null);

      const result = await repo.deleteByProvider('test');

      expect(result).toBe(0);
    });
  });

  // ---- singleton instance ----

  describe('codingAgentSkillAttachmentsRepo singleton', () => {
    it('is exported as a singleton instance', () => {
      expect(codingAgentSkillAttachmentsRepo).toBeInstanceOf(
        CodingAgentSkillAttachmentsRepository
      );
    });

    it('createCodingAgentSkillAttachmentsRepository creates new instances', () => {
      const repo1 = createCodingAgentSkillAttachmentsRepository();
      const repo2 = createCodingAgentSkillAttachmentsRepository();

      expect(repo1).toBeInstanceOf(CodingAgentSkillAttachmentsRepository);
      expect(repo2).toBeInstanceOf(CodingAgentSkillAttachmentsRepository);
      expect(repo1).not.toBe(repo2);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('propagates database errors on create', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('connection failed'));

      await expect(repo.create({ providerRef: 'test', type: 'inline' })).rejects.toThrow(
        'connection failed'
      );
    });

    it('propagates database errors on getById', async () => {
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('query timeout'));

      await expect(repo.getById('test')).rejects.toThrow('query timeout');
    });

    it('propagates database errors on listByProvider', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.listByProvider('test')).rejects.toThrow('disk full');
    });

    it('propagates database errors on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockAttachmentRow());
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.update('attach-123', { label: 'Test' })).rejects.toThrow(
        'constraint violation'
      );
    });

    it('propagates database errors on delete', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.delete('attach-123')).rejects.toThrow('permission denied');
    });

    it('propagates database errors on deleteByProvider', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.deleteByProvider('test')).rejects.toThrow('timeout');
    });
  });
});
