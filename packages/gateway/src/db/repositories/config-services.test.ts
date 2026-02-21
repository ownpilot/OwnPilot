/**
 * Config Services Repository Tests
 *
 * Unit tests for ConfigServicesRepository covering service CRUD, entry CRUD,
 * caching, dependency tracking, config resolution, and statistics.
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

import { ConfigServicesRepository } from './config-services.js';

// ---------------------------------------------------------------------------
// Sample data helpers
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeServiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    name: 'openai',
    display_name: 'OpenAI',
    category: 'ai',
    description: 'OpenAI API',
    docs_url: 'https://docs.openai.com',
    config_schema: JSON.stringify([
      { name: 'api_key', label: 'API Key', type: 'secret', envVar: 'OPENAI_API_KEY' },
    ]),
    multi_entry: false,
    required_by: '[]',
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    service_name: 'openai',
    label: 'Default',
    data: JSON.stringify({ api_key: 'sk-test-123' }),
    is_default: true,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigServicesRepository', () => {
  let repo: ConfigServicesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ConfigServicesRepository();
  });

  // =========================================================================
  // initialize / refreshCache
  // =========================================================================

  describe('initialize', () => {
    it('should load services and entries into cache', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])         // services query
        .mockResolvedValueOnce([makeEntryRow()]);           // entries query

      await repo.initialize();

      // After init, sync accessors should work
      const svc = repo.getByName('openai');
      expect(svc).not.toBeNull();
      expect(svc!.name).toBe('openai');
      expect(svc!.displayName).toBe('OpenAI');
      expect(svc!.category).toBe('ai');
      expect(svc!.isActive).toBe(true);
    });

    it('should group entries by service name', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ id: 'e1', service_name: 'openai' }),
          makeEntryRow({ id: 'e2', service_name: 'openai', is_default: false, label: 'Alt' }),
        ]);

      await repo.initialize();

      const entries = repo.getEntries('openai');
      expect(entries).toHaveLength(2);
    });

    it('should handle empty database', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await repo.initialize();

      expect(repo.list()).toEqual([]);
    });
  });

  describe('refreshCache', () => {
    it('should clear and repopulate caches', async () => {
      // First init
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();
      expect(repo.getByName('openai')).not.toBeNull();

      // Refresh with empty
      mockAdapter.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await repo.refreshCache();
      expect(repo.getByName('openai')).toBeNull();
    });
  });

  // =========================================================================
  // Sync accessors (from cache)
  // =========================================================================

  describe('getByName', () => {
    it('should return null when cache not initialized', () => {
      // Fresh repo, cache not initialized
      const result = repo.getByName('openai');
      expect(result).toBeNull();
    });

    it('should return service when cached', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = repo.getByName('openai');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('openai');
    });

    it('should return null for unknown name', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getByName('unknown')).toBeNull();
    });
  });

  describe('list', () => {
    it('should return all services', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({ name: 'openai', category: 'ai' }),
          makeServiceRow({ name: 'google', display_name: 'Google', category: 'search' }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const all = repo.list();
      expect(all).toHaveLength(2);
    });

    it('should filter by category', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({ name: 'openai', category: 'ai' }),
          makeServiceRow({ name: 'google', display_name: 'Google', category: 'search' }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const filtered = repo.list('ai');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('openai');
    });

    it('should return empty array when no match', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.list('nonexistent')).toEqual([]);
    });
  });

  // =========================================================================
  // Service CRUD
  // =========================================================================

  describe('create', () => {
    it('should insert a service and refresh cache', async () => {
      // Initialize empty cache first
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      // create: execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache: queryOne for service, query for entries
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.create({
        name: 'openai',
        displayName: 'OpenAI',
        category: 'ai',
        description: 'OpenAI API',
      });

      expect(result.name).toBe('openai');
      expect(result.displayName).toBe('OpenAI');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO config_services');
    });

    it('should default isActive to true and multiEntry to false', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.create({
        name: 'test',
        displayName: 'Test',
        category: 'misc',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // multiEntry: input.multiEntry === true => false
      expect(params[7]).toBe(false);
      // isActive: input.isActive !== false => true
      expect(params[9]).toBe(true);
    });

    it('should serialize configSchema as JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const schema = [{ name: 'api_key', label: 'API Key', type: 'secret' as const }];
      await repo.create({
        name: 'test',
        displayName: 'Test',
        category: 'misc',
        configSchema: schema,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe(JSON.stringify(schema));
    });

    it('should default configSchema to empty array', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.create({
        name: 'test',
        displayName: 'Test',
        category: 'misc',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('[]');
    });
  });

  describe('update', () => {
    it('should update existing service and refresh cache', async () => {
      // Initialize with a service
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow({ display_name: 'Updated OpenAI' }));
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.update('openai', { displayName: 'Updated OpenAI' });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Updated OpenAI');
    });

    it('should return null for nonexistent service', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.update('missing', { displayName: 'x' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing service when no changes provided', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      const result = await repo.update('openai', {});

      expect(result).not.toBeNull();
      expect(result!.name).toBe('openai');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should build dynamic SET clause for provided fields', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.update('openai', {
        displayName: 'New Name',
        category: 'new-cat',
        isActive: false,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('display_name = $1');
      expect(sql).toContain('category = $2');
      expect(sql).toContain('is_active = $3');
      expect(sql).toContain('updated_at = $4');
      expect(sql).toContain('WHERE name = $5');
    });

    it('should serialize configSchema when provided', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const newSchema = [{ name: 'key', label: 'Key', type: 'string' as const }];
      await repo.update('openai', { configSchema: newSchema });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe(JSON.stringify(newSchema));
    });
  });

  describe('delete', () => {
    it('should delete entries and service, then remove from cache', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      // delete entries
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // delete service
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('openai');

      expect(result).toBe(true);
      expect(repo.getByName('openai')).toBeNull();
      expect(repo.getEntries('openai')).toEqual([]);
    });

    it('should return false when service not found in DB', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // entries
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 }); // service

      const result = await repo.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('upsert', () => {
    it('should insert with ON CONFLICT clause', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.upsert({
        name: 'openai',
        displayName: 'OpenAI',
        category: 'ai',
      });

      expect(result.name).toBe('openai');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO config_services');
      expect(sql).toContain('ON CONFLICT(name) DO UPDATE');
    });

    it('should pass hasExplicitSchema as true when configSchema has items', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.upsert({
        name: 'openai',
        displayName: 'OpenAI',
        category: 'ai',
        configSchema: [{ name: 'api_key', label: 'API Key', type: 'secret' as const }],
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[12]).toBe(true); // hasExplicitSchema
    });

    it('should pass hasExplicitSchema as false when configSchema is empty or undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.upsert({
        name: 'openai',
        displayName: 'OpenAI',
        category: 'ai',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[12]).toBe(false); // hasExplicitSchema
    });

    it('should pass hasExplicitMultiEntry correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.upsert({
        name: 'test',
        displayName: 'Test',
        category: 'misc',
        multiEntry: true,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[13]).toBe(true); // hasExplicitMultiEntry
    });
  });

  // =========================================================================
  // Entry sync accessors
  // =========================================================================

  describe('getEntries', () => {
    it('should return cached entries for a service', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ id: 'e1' }),
          makeEntryRow({ id: 'e2', is_default: false, label: 'Secondary' }),
        ]);
      await repo.initialize();

      const entries = repo.getEntries('openai');
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('e1');
    });

    it('should return empty array for unknown service', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getEntries('unknown')).toEqual([]);
    });
  });

  describe('getDefaultEntry', () => {
    it('should return the default entry', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ id: 'e1', is_default: true }),
          makeEntryRow({ id: 'e2', is_default: false }),
        ]);
      await repo.initialize();

      const entry = repo.getDefaultEntry('openai');
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe('e1');
      expect(entry!.isDefault).toBe(true);
    });

    it('should return null when no entries exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getDefaultEntry('openai')).toBeNull();
    });

    it('should return null when no default entry', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ is_default: false }),
        ]);
      await repo.initialize();

      expect(repo.getDefaultEntry('openai')).toBeNull();
    });
  });

  describe('getEntryByLabel', () => {
    it('should find entry by label', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ id: 'e1', label: 'Default' }),
          makeEntryRow({ id: 'e2', label: 'Production' }),
        ]);
      await repo.initialize();

      const entry = repo.getEntryByLabel('openai', 'Production');
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe('e2');
    });

    it('should return null when label not found', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      expect(repo.getEntryByLabel('openai', 'nonexistent')).toBeNull();
    });

    it('should return null when service has no entries', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      expect(repo.getEntryByLabel('openai', 'Default')).toBeNull();
    });
  });

  // =========================================================================
  // Entry CRUD
  // =========================================================================

  describe('createEntry', () => {
    it('should insert an entry and refresh cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      // execute insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache: queryOne + query
      // Use a dynamic id so the cache lookup succeeds -- we intercept the id from execute params
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockImplementationOnce(async () => {
        // Grab the id that was passed to execute
        const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
        const generatedId = insertParams[0] as string;
        return [makeEntryRow({ id: generatedId })];
      });

      const result = await repo.createEntry('openai', {
        label: 'Default',
        data: { api_key: 'sk-test-123' },
      });

      expect(result.serviceName).toBe('openai');
      expect(result.label).toBe('Default');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO config_entries');
    });

    it('should auto-set isDefault=true for first entry', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockImplementationOnce(async () => {
        const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
        return [makeEntryRow({ id: insertParams[0] as string })];
      });

      await repo.createEntry('openai', { data: { api_key: 'test' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // isDefault should be true (first entry)
      expect(params[4]).toBe(true);
    });

    it('should unset existing defaults when creating a new default entry', async () => {
      // Init with existing entry
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      // unset existing defaults
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // insert
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refresh
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockImplementationOnce(async () => {
        // The insert is the second execute call (index 1)
        const insertParams = mockAdapter.execute.mock.calls[1]![1] as unknown[];
        const generatedId = insertParams[0] as string;
        return [
          makeEntryRow({ id: 'entry-1', is_default: false }),
          makeEntryRow({ id: generatedId, is_default: true, label: 'New Default' }),
        ];
      });

      await repo.createEntry('openai', {
        label: 'New Default',
        isDefault: true,
        data: { api_key: 'new-key' },
      });

      // First execute call is the unset
      const unsetSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(unsetSql).toContain('is_default = FALSE');
    });

    it('should default label to "Default" when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockImplementationOnce(async () => {
        const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
        return [makeEntryRow({ id: insertParams[0] as string })];
      });

      await repo.createEntry('openai', {});

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBe('Default'); // label
    });

    it('should serialize data as JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockImplementationOnce(async () => {
        const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
        return [makeEntryRow({ id: insertParams[0] as string })];
      });

      await repo.createEntry('openai', { data: { api_key: 'key', url: 'http://example.com' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('{"api_key":"key","url":"http://example.com"}');
    });
  });

  describe('updateEntry', () => {
    it('should update entry and refresh cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      // queryOne to find entry
      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow());
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([makeEntryRow({ label: 'Updated' })]);

      const result = await repo.updateEntry('entry-1', { label: 'Updated' });

      expect(result).not.toBeNull();
      expect(result!.label).toBe('Updated');
    });

    it('should return null when entry not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateEntry('missing', { label: 'x' });

      expect(result).toBeNull();
    });

    it('should return existing entry when no changes provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow());

      const result = await repo.updateEntry('entry-1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('entry-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should unset other defaults when setting isDefault=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow({ id: 'entry-2', is_default: false }));
      // unset existing defaults
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // actual update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refresh
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([
        makeEntryRow({ id: 'entry-1', is_default: false }),
        makeEntryRow({ id: 'entry-2', is_default: true }),
      ]);

      await repo.updateEntry('entry-2', { isDefault: true });

      const unsetSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(unsetSql).toContain('is_default = FALSE');
    });

    it('should serialize data as JSON when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([makeEntryRow()]);

      await repo.updateEntry('entry-1', { data: { new_field: 'value' } });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('{"new_field":"value"}');
    });
  });

  describe('deleteEntry', () => {
    it('should delete entry and refresh cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      // queryOne to find entry
      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow());
      // execute delete
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.deleteEntry('entry-1');

      expect(result).toBe(true);
    });

    it('should return false when entry not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.deleteEntry('missing');

      expect(result).toBe(false);
    });

    it('should return false when delete changes nothing', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      mockAdapter.queryOne.mockResolvedValueOnce(makeEntryRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteEntry('entry-1');

      expect(result).toBe(false);
    });
  });

  describe('setDefaultEntry', () => {
    it('should unset other defaults and set the given entry atomically', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      // Single atomic CTE statement
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // refreshServiceCache
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());
      mockAdapter.query.mockResolvedValueOnce([makeEntryRow({ id: 'entry-2', is_default: true })]);

      await repo.setDefaultEntry('openai', 'entry-2');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('is_default = FALSE');
      expect(sql).toContain('is_default = TRUE');
    });
  });

  // =========================================================================
  // Dependency tracking
  // =========================================================================

  describe('updateRequiredBy', () => {
    it('should update required_by and refresh cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeServiceRow({ required_by: JSON.stringify([{ type: 'tool', name: 'web', id: 't1' }]) })
      );

      await repo.updateRequiredBy('openai', [{ type: 'tool', name: 'web', id: 't1' }]);

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('[{"type":"tool","name":"web","id":"t1"}]');

      const svc = repo.getByName('openai');
      expect(svc!.requiredBy).toHaveLength(1);
    });
  });

  describe('addRequiredBy', () => {
    it('should add a dependent to requiredBy (idempotent)', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow({ required_by: '[]' })])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      // updateRequiredBy: execute + queryOne
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeServiceRow({ required_by: JSON.stringify([{ type: 'tool', name: 'web', id: 't1' }]) })
      );

      await repo.addRequiredBy('openai', { type: 'tool', name: 'web', id: 't1' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const parsed = JSON.parse(params[0] as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('t1');
    });

    it('should replace existing entry with same id', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({
            required_by: JSON.stringify([{ type: 'tool', name: 'old', id: 't1' }]),
          }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow());

      await repo.addRequiredBy('openai', { type: 'tool', name: 'new', id: 't1' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const parsed = JSON.parse(params[0] as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('new');
    });

    it('should do nothing if service not in cache', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      await repo.addRequiredBy('nonexistent', { type: 'tool', name: 'web', id: 't1' });

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('removeRequiredById', () => {
    it('should remove dependent from all services', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({
            name: 'openai',
            required_by: JSON.stringify([{ type: 'tool', name: 'web', id: 't1' }]),
          }),
          makeServiceRow({
            name: 'google',
            display_name: 'Google',
            required_by: JSON.stringify([{ type: 'tool', name: 'web', id: 't1' }]),
          }),
        ])
        .mockResolvedValueOnce([]);
      await repo.initialize();

      // Two calls to updateRequiredBy (one per service)
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeServiceRow({ required_by: '[]' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeServiceRow({ name: 'google', display_name: 'Google', required_by: '[]' })
      );

      await repo.removeRequiredById('t1');

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when dependent not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([]);
      await repo.initialize();

      await repo.removeRequiredById('nonexistent');

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Config value resolution
  // =========================================================================

  describe('getApiKey', () => {
    it('should return api_key from default entry data', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: 'sk-123' }) })]);
      await repo.initialize();

      const result = repo.getApiKey('openai');

      expect(result).toBe('sk-123');
    });

    it('should return undefined when service not active', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow({ is_active: false })])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      const result = repo.getApiKey('openai');

      expect(result).toBeUndefined();
    });

    it('should return undefined when service not found', () => {
      expect(repo.getApiKey('nonexistent')).toBeUndefined();
    });

    it('should fall back to env var from schema', async () => {
      const originalEnv = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'env-key-123';

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow()])
          .mockResolvedValueOnce([makeEntryRow({ data: '{}' })]);
        await repo.initialize();

        const result = repo.getApiKey('openai');

        expect(result).toBe('env-key-123');
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });

    it('should return undefined when no api_key in data and no env var', async () => {
      const originalEnv = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow()])
          .mockResolvedValueOnce([makeEntryRow({ data: '{}' })]);
        await repo.initialize();

        const result = repo.getApiKey('openai');

        expect(result).toBeUndefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        }
      }
    });

    it('should ignore empty string api_key', async () => {
      const originalEnv = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow()])
          .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: '' }) })]);
        await repo.initialize();

        const result = repo.getApiKey('openai');

        expect(result).toBeUndefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        }
      }
    });
  });

  describe('getFieldValue', () => {
    it('should return value from default entry data', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: 'sk-123', base_url: 'http://x' }) })]);
      await repo.initialize();

      expect(repo.getFieldValue('openai', 'base_url')).toBe('http://x');
    });

    it('should pick entry by label when provided', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([
          makeEntryRow({ id: 'e1', label: 'Default', data: JSON.stringify({ api_key: 'default-key' }) }),
          makeEntryRow({ id: 'e2', label: 'Prod', data: JSON.stringify({ api_key: 'prod-key' }), is_default: false }),
        ]);
      await repo.initialize();

      expect(repo.getFieldValue('openai', 'api_key', 'Prod')).toBe('prod-key');
    });

    it('should fall back to env var', async () => {
      const originalEnv = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'env-val';

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow()])
          .mockResolvedValueOnce([makeEntryRow({ data: '{}' })]);
        await repo.initialize();

        expect(repo.getFieldValue('openai', 'api_key')).toBe('env-val');
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });

    it('should fall back to defaultValue from schema', async () => {
      const schemaWithDefault = [
        { name: 'api_key', label: 'API Key', type: 'secret', defaultValue: 'default-val' },
      ];
      const originalEnv = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow({ config_schema: JSON.stringify(schemaWithDefault) })])
          .mockResolvedValueOnce([makeEntryRow({ data: '{}' })]);
        await repo.initialize();

        expect(repo.getFieldValue('openai', 'api_key')).toBe('default-val');
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        }
      }
    });

    it('should return undefined for unknown service', () => {
      expect(repo.getFieldValue('nonexistent', 'api_key')).toBeUndefined();
    });

    it('should return undefined for unknown field', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: '{}' })]);
      await repo.initialize();

      expect(repo.getFieldValue('openai', 'nonexistent_field')).toBeUndefined();
    });

    it('should skip empty string values in data', async () => {
      const schemaWithDefault = [
        { name: 'api_key', label: 'API Key', type: 'secret', defaultValue: 'fallback' },
      ];
      const originalEnv = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      try {
        mockAdapter.query
          .mockResolvedValueOnce([makeServiceRow({ config_schema: JSON.stringify(schemaWithDefault) })])
          .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: '' }) })]);
        await repo.initialize();

        expect(repo.getFieldValue('openai', 'api_key')).toBe('fallback');
      } finally {
        if (originalEnv !== undefined) {
          process.env['OPENAI_API_KEY'] = originalEnv;
        }
      }
    });
  });

  describe('isAvailable', () => {
    it('should return true when service has default entry with non-empty data', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: 'sk-123' }) })]);
      await repo.initialize();

      expect(repo.isAvailable('openai')).toBe(true);
    });

    it('should return false when service is not active', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow({ is_active: false })])
        .mockResolvedValueOnce([makeEntryRow()]);
      await repo.initialize();

      expect(repo.isAvailable('openai')).toBe(false);
    });

    it('should return false when no default entry', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ is_default: false })]);
      await repo.initialize();

      expect(repo.isAvailable('openai')).toBe(false);
    });

    it('should return false when service not found', () => {
      expect(repo.isAvailable('nonexistent')).toBe(false);
    });

    it('should return false when data has only empty values', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: '', url: null }) })]);
      await repo.initialize();

      expect(repo.isAvailable('openai')).toBe(false);
    });

    it('should return true when at least one data field has a value', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([makeServiceRow()])
        .mockResolvedValueOnce([makeEntryRow({ data: JSON.stringify({ api_key: '', url: 'http://x' }) })]);
      await repo.initialize();

      expect(repo.isAvailable('openai')).toBe(true);
    });
  });

  // =========================================================================
  // Statistics
  // =========================================================================

  describe('getStats', () => {
    it('should return aggregate statistics', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({ name: 'openai', is_active: true, required_by: '[]' }),
          makeServiceRow({ name: 'google', display_name: 'Google', category: 'search', is_active: false, required_by: '[]' }),
        ])
        .mockResolvedValueOnce([
          makeEntryRow({ service_name: 'openai', data: JSON.stringify({ api_key: 'sk-123' }) }),
        ]);
      await repo.initialize();

      const stats = await repo.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.configured).toBe(1);
      expect(stats.categories).toContain('ai');
      expect(stats.categories).toContain('search');
    });

    it('should track neededByTools and neededButUnconfigured', async () => {
      mockAdapter.query
        .mockResolvedValueOnce([
          makeServiceRow({
            name: 'openai',
            is_active: true,
            required_by: JSON.stringify([{ type: 'tool', name: 'web', id: 't1' }]),
          }),
          makeServiceRow({
            name: 'unconfigured',
            display_name: 'Unconfigured',
            is_active: true,
            required_by: JSON.stringify([{ type: 'tool', name: 'search', id: 't2' }]),
          }),
        ])
        .mockResolvedValueOnce([
          makeEntryRow({ service_name: 'openai', data: JSON.stringify({ api_key: 'key' }) }),
        ]);
      await repo.initialize();

      const stats = await repo.getStats();

      expect(stats.neededByTools).toBe(2);
      expect(stats.neededButUnconfigured).toBe(1);
    });

    it('should return empty stats when no services', async () => {
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repo.initialize();

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.configured).toBe(0);
      expect(stats.categories).toEqual([]);
      expect(stats.neededByTools).toBe(0);
      expect(stats.neededButUnconfigured).toBe(0);
    });
  });

  // =========================================================================
  // JSON Parsing edge cases
  // =========================================================================

  describe('JSON parsing', () => {
    it('should handle config_schema as already-parsed object', async () => {
      const row = makeServiceRow({
        config_schema: [{ name: 'key', label: 'Key', type: 'string' }],
      });
      mockAdapter.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await repo.initialize();

      const svc = repo.getByName('openai');
      expect(svc!.configSchema).toEqual([{ name: 'key', label: 'Key', type: 'string' }]);
    });

    it('should handle null config_schema with fallback', async () => {
      const row = makeServiceRow({ config_schema: null });
      mockAdapter.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await repo.initialize();

      const svc = repo.getByName('openai');
      expect(svc!.configSchema).toEqual([]);
    });

    it('should handle invalid JSON config_schema with fallback', async () => {
      const row = makeServiceRow({ config_schema: '{invalid' });
      mockAdapter.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await repo.initialize();

      const svc = repo.getByName('openai');
      expect(svc!.configSchema).toEqual([]);
    });

    it('should handle entry data as already-parsed object', async () => {
      const row = makeEntryRow({ data: { api_key: 'parsed' } });
      mockAdapter.query.mockResolvedValueOnce([makeServiceRow()]).mockResolvedValueOnce([row]);
      await repo.initialize();

      const entries = repo.getEntries('openai');
      expect(entries[0].data).toEqual({ api_key: 'parsed' });
    });

    it('should handle boolean values as strings', async () => {
      const row = makeServiceRow({ is_active: 'true', multi_entry: 'false' });
      mockAdapter.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await repo.initialize();

      const svc = repo.getByName('openai');
      expect(svc!.isActive).toBe(true);
      expect(svc!.multiEntry).toBe(false);
    });

    it('should handle boolean values as numbers', async () => {
      const row = makeServiceRow({ is_active: 1, multi_entry: 0 });
      mockAdapter.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await repo.initialize();

      const svc = repo.getByName('openai');
      expect(svc!.isActive).toBe(true);
      expect(svc!.multiEntry).toBe(false);
    });
  });

  // =========================================================================
  // Factory / singleton
  // =========================================================================

  describe('initializeConfigServicesRepo', () => {
    it('should be importable', async () => {
      const { initializeConfigServicesRepo } = await import('./config-services.js');
      expect(typeof initializeConfigServicesRepo).toBe('function');
    });
  });
});
