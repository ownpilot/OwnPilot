/**
 * CrudRepository Base Class Tests
 *
 * Tests the generic CRUD operations using a concrete mock implementation.
 * Verifies SQL generation, parameterization, row mapping, multi-tenant
 * scoping, error handling, and customization hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';
import type { UpdateField } from './query-helpers.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventBus: () => ({ emit: mockEmit }),
    createEvent: (type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
    }),
    EventTypes: {
      RESOURCE_CREATED: 'resource.created',
      RESOURCE_UPDATED: 'resource.updated',
      RESOURCE_DELETED: 'resource.deleted',
    },
  };
});

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { CrudRepository, type CreateFields } from './crud-base.js';

// ---------------------------------------------------------------------------
// Concrete test implementation
// ---------------------------------------------------------------------------

interface WidgetRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface Widget {
  id: string;
  userId: string;
  name: string;
  color?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateWidgetInput {
  name: string;
  color?: string;
  active?: boolean;
}

interface UpdateWidgetInput {
  name?: string;
  color?: string;
  active?: boolean;
}

class WidgetsRepository extends CrudRepository<
  WidgetRow,
  Widget,
  CreateWidgetInput,
  UpdateWidgetInput
> {
  readonly tableName = 'widgets';

  mapRow(row: WidgetRow): Widget {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      color: row.color ?? undefined,
      active: row.active === true,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  buildCreateFields(input: CreateWidgetInput): CreateFields {
    return {
      name: input.name,
      color: input.color ?? null,
      active: input.active ?? true,
    };
  }

  buildUpdateFields(input: UpdateWidgetInput): UpdateField[] {
    return [
      { column: 'name', value: input.name },
      { column: 'color', value: input.color },
      { column: 'active', value: input.active },
    ];
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-06-01T12:00:00.000Z';

function makeWidgetRow(overrides: Record<string, unknown> = {}): WidgetRow {
  return {
    id: 'w-1',
    user_id: 'user-1',
    name: 'Gadget',
    color: null,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrudRepository', () => {
  let repo: WidgetsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockReset();
    repo = new WidgetsRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a record and return the entity', async () => {
      const row = makeWidgetRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({ name: 'Gadget' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('Gadget');
      expect(result.active).toBe(true);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should generate INSERT SQL with correct columns and placeholders', async () => {
      const row = makeWidgetRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({ name: 'Test', color: 'red' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO widgets');
      expect(sql).toContain('id');
      expect(sql).toContain('user_id');
      expect(sql).toContain('name');
      expect(sql).toContain('color');
      expect(sql).toContain('active');
      expect(sql).toContain('$1');
    });

    it('should include user_id in the insert params', async () => {
      const row = makeWidgetRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({ name: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // params[0] = id (uuid), params[1] = user_id
      expect(params[1]).toBe('user-1');
    });

    it('should throw when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ name: 'Test' })).rejects.toThrow('Failed to create widget');
    });

    it('should pass optional fields correctly', async () => {
      const row = makeWidgetRow({ color: 'blue', active: false });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({ name: 'Gadget', color: 'blue', active: false });

      expect(result.color).toBe('blue');
      expect(result.active).toBe(false);
    });

    it('should use null for missing optional fields', async () => {
      const row = makeWidgetRow();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({ name: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // color should be null (3rd field after id, user_id, name)
      expect(params[3]).toBeNull();
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return entity when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      const result = await repo.getById('w-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('w-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should scope query by user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getById('w-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('id = $1');
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['w-1', 'user-1']);
    });

    it('should parse dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      const result = await repo.getById('w-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      const result = await repo.getById('w-1');

      expect(result!.color).toBeUndefined();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated entity', async () => {
      const original = makeWidgetRow();
      const updated = makeWidgetRow({ name: 'Updated' });

      mockAdapter.queryOne.mockResolvedValueOnce(original); // getById for existing check
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // execute update
      mockAdapter.queryOne.mockResolvedValueOnce(updated); // getById for return

      const result = await repo.update('w-1', { name: 'Updated' });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when entity does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('nonexistent', { name: 'New' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing entity when no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      const result = await repo.update('w-1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('w-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should include updated_at = NOW() in the SET clause', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow({ name: 'New' }));

      await repo.update('w-1', { name: 'New' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('updated_at = NOW()');
    });

    it('should scope UPDATE by id and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow({ name: 'New' }));

      await repo.update('w-1', { name: 'New' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('id = $');
      expect(sql).toContain('user_id = $');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('w-1');
      expect(params).toContain('user-1');
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeWidgetRow({ name: 'New', color: 'red', active: false }),
      );

      const result = await repo.update('w-1', {
        name: 'New',
        color: 'red',
        active: false,
      });

      expect(result!.name).toBe('New');
      expect(result!.color).toBe('red');
      expect(result!.active).toBe(false);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('w-1')).toBe(true);
    });

    it('should return false when entity not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('nonexistent')).toBe(false);
    });

    it('should scope DELETE by id and user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('w-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM widgets');
      expect(sql).toContain('id = $1');
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['w-1', 'user-1']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('listAll', () => {
    it('should return empty array when no records', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listAll();

      expect(result).toEqual([]);
    });

    it('should return mapped entities', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeWidgetRow({ id: 'w-1' }),
        makeWidgetRow({ id: 'w-2', name: 'Second' }),
      ]);

      const result = await repo.listAll();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('w-1');
      expect(result[1]!.id).toBe('w-2');
    });

    it('should scope by user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('user-1');
    });

    it('should apply ORDER BY defaultOrderBy', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should apply LIMIT when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll(10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });

    it('should apply LIMIT and OFFSET when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll(10, 20);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should not add LIMIT or OFFSET when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('LIMIT');
      expect(sql).not.toContain('OFFSET');
    });

    it('should not add LIMIT when zero', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll(0);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('LIMIT');
    });

    it('should not add OFFSET when zero', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listAll(10, 0);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('OFFSET');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      expect(await repo.count()).toBe(42);
    });

    it('should return 0 when no rows', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should scope by user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });
  });

  // =========================================================================
  // Customization
  // =========================================================================

  describe('customization', () => {
    it('should use custom defaultOrderBy', async () => {
      class CustomOrderRepo extends WidgetsRepository {
        override get defaultOrderBy(): string {
          return 'name ASC';
        }
      }

      const customRepo = new CustomOrderRepo('user-1');
      mockAdapter.query.mockResolvedValueOnce([]);

      await customRepo.listAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY name ASC');
    });

    it('should use custom generateId', async () => {
      class CustomIdRepo extends WidgetsRepository {
        protected override generateId(): string {
          return 'custom-id-123';
        }
      }

      const customRepo = new CustomIdRepo('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow({ id: 'custom-id-123' }));

      await customRepo.create({ name: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('custom-id-123');
    });

    it('should use custom entityName in error messages', async () => {
      class CustomNameRepo extends WidgetsRepository {
        override get entityName(): string {
          return 'gadget';
        }
      }

      const customRepo = new CustomNameRepo('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(customRepo.create({ name: 'Test' })).rejects.toThrow(
        'Failed to create gadget',
      );
    });

    it('should derive entityName from tableName by default', () => {
      // "widgets" -> "widget" (removes trailing 's')
      expect(repo['entityName']).toBe('widget');
    });
  });

  // =========================================================================
  // Multi-tenant isolation
  // =========================================================================

  describe('multi-tenant isolation', () => {
    it('should use different user_id per instance', async () => {
      const repoA = new WidgetsRepository('alice');
      const repoB = new WidgetsRepository('bob');

      mockAdapter.query.mockResolvedValue([]);

      await repoA.listAll();
      await repoB.listAll();

      const paramsA = mockAdapter.query.mock.calls[0]![1] as unknown[];
      const paramsB = mockAdapter.query.mock.calls[1]![1] as unknown[];
      expect(paramsA[0]).toBe('alice');
      expect(paramsB[0]).toBe('bob');
    });

    it('should default userId to "default"', async () => {
      const defaultRepo = new WidgetsRepository();
      mockAdapter.query.mockResolvedValueOnce([]);

      await defaultRepo.listAll();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('default');
    });
  });

  // =========================================================================
  // Event emission (opt-in)
  // =========================================================================

  describe('event emission', () => {
    /**
     * Subclass that opts in to event emission by overriding emitEvents.
     */
    class EventfulWidgetsRepository extends WidgetsRepository {
      protected override get emitEvents(): boolean {
        return true;
      }
    }

    /**
     * Subclass with custom resourceType.
     */
    class CustomResourceTypeRepo extends WidgetsRepository {
      protected override get emitEvents(): boolean {
        return true;
      }
      protected override get resourceType(): string {
        return 'gadget';
      }
    }

    // -----------------------------------------------------------------------
    // Default (emitEvents = false) — no events
    // -----------------------------------------------------------------------

    it('should NOT emit events on create when emitEvents is false (default)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      await repo.create({ name: 'Test' });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should NOT emit events on update when emitEvents is false (default)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow({ name: 'Updated' }));

      await repo.update('w-1', { name: 'Updated' });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should NOT emit events on delete when emitEvents is false (default)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('w-1');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // emitEvents = true — events emitted
    // -----------------------------------------------------------------------

    it('should emit RESOURCE_CREATED on create when emitEvents is true', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      await eventRepo.create({ name: 'Test' });

      expect(mockEmit).toHaveBeenCalledOnce();
      const event = mockEmit.mock.calls[0]![0];
      expect(event.type).toBe('resource.created');
      expect(event.category).toBe('resource');
      expect(event.source).toBe('widgets-repository');
      expect(event.data.resourceType).toBe('widget');
      expect(event.data.id).toEqual(expect.any(String));
    });

    it('should emit RESOURCE_UPDATED on update when emitEvents is true', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow({ name: 'Updated' }));

      await eventRepo.update('w-1', { name: 'Updated' });

      expect(mockEmit).toHaveBeenCalledOnce();
      const event = mockEmit.mock.calls[0]![0];
      expect(event.type).toBe('resource.updated');
      expect(event.category).toBe('resource');
      expect(event.source).toBe('widgets-repository');
      expect(event.data.resourceType).toBe('widget');
      expect(event.data.id).toBe('w-1');
      expect(event.data.changes).toEqual({ name: 'Updated' });
    });

    it('should emit RESOURCE_DELETED on delete when emitEvents is true', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await eventRepo.delete('w-1');

      expect(mockEmit).toHaveBeenCalledOnce();
      const event = mockEmit.mock.calls[0]![0];
      expect(event.type).toBe('resource.deleted');
      expect(event.category).toBe('resource');
      expect(event.source).toBe('widgets-repository');
      expect(event.data.resourceType).toBe('widget');
      expect(event.data.id).toBe('w-1');
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    it('should NOT emit RESOURCE_UPDATED when entity not found', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await eventRepo.update('nonexistent', { name: 'New' });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should NOT emit RESOURCE_UPDATED when no fields changed', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      await eventRepo.update('w-1', {});

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should NOT emit RESOURCE_DELETED when entity not found', async () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await eventRepo.delete('nonexistent');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Custom resourceType
    // -----------------------------------------------------------------------

    it('should use custom resourceType in event payload', async () => {
      const customRepo = new CustomResourceTypeRepo('user-1');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeWidgetRow());

      await customRepo.create({ name: 'Test' });

      expect(mockEmit).toHaveBeenCalledOnce();
      const event = mockEmit.mock.calls[0]![0];
      expect(event.data.resourceType).toBe('gadget');
    });

    it('should default resourceType to entityName', () => {
      const eventRepo = new EventfulWidgetsRepository('user-1');
      // "widgets" -> "widget" (entityName strips trailing 's')
      expect(eventRepo['resourceType']).toBe('widget');
    });
  });
});
