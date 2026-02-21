import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../memory/conversation.js', () => ({
  DEFAULT_RETENTION_POLICY: {
    autoArchiveDays: 90,
    deleteArchivedAfterDays: 180,
    maxMemories: 10000,
    exemptCategories: ['instruction'],
  },
}));

const {
  MEMORY_OVERSIGHT_TOOLS,
  LIST_MEMORIES_TOOL,
  DELETE_MEMORY_TOOL,
  BULK_DELETE_MEMORIES_TOOL,
  ARCHIVE_MEMORY_TOOL,
  RESTORE_MEMORY_TOOL,
  VIEW_PROFILE_TOOL,
  UPDATE_MEMORY_IMPORTANCE_TOOL,
  EXPORT_MEMORIES_TOOL,
  MEMORY_STATS_TOOL,
  CLEAR_ALL_MEMORIES_TOOL,
  CONFIGURE_RETENTION_TOOL,
  createMemoryOversightExecutors,
  createMemoryOversightTools,
  MemoryCleaner,
  createMemoryCleaner,
} = await import('./memory-oversight.js');

function makeMemoryEntry(overrides: Partial<any> = {}): any {
  return {
    id: 'mem_1',
    content: 'User prefers dark mode for all applications',
    category: 'preference' as const,
    importance: 'medium' as const,
    tags: ['preference', 'ui'],
    source: 'conversation',
    createdAt: '2026-01-15T10:00:00Z',
    accessCount: 3,
    archived: false,
    ...overrides,
  };
}

function makeMockStore() {
  return {
    queryMemories: vi.fn().mockResolvedValue([]),
    getMemory: vi.fn().mockResolvedValue(null),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    archiveMemory: vi.fn().mockResolvedValue(undefined),
    restoreMemory: vi.fn().mockResolvedValue(undefined),
    updateMemory: vi.fn().mockResolvedValue(undefined),
    getUserProfile: vi.fn().mockResolvedValue({
      name: 'Test User',
      preferences: ['dark mode'],
      facts: ['developer'],
      goals: ['learn AI'],
      relationships: ['Alice'],
      topicsOfInterest: ['TypeScript'],
      communicationStyle: { formality: 'casual', verbosity: 'concise', language: 'English' },
    }),
    getUserId: vi.fn().mockReturnValue('user_123'),
    setRetentionPolicy: vi.fn(),
    applyRetentionPolicy: vi.fn().mockResolvedValue({ archived: 2, deleted: 1 }),
  };
}

const mockCtx = {} as any;

// ---------------------------------------------------------------------------
// 1. Tool definitions
// ---------------------------------------------------------------------------
describe('Tool definitions', () => {
  it('MEMORY_OVERSIGHT_TOOLS has 11 entries', () => {
    expect(MEMORY_OVERSIGHT_TOOLS).toHaveLength(11);
  });

  it('each tool definition has name, description, and parameters', () => {
    for (const tool of MEMORY_OVERSIGHT_TOOLS) {
      expect(tool).toHaveProperty('name');
      expect(typeof tool.name).toBe('string');
      expect(tool).toHaveProperty('description');
      expect(typeof tool.description).toBe('string');
      expect(tool).toHaveProperty('parameters');
    }
  });

  it('LIST_MEMORIES_TOOL has optional category, importance, search, limit, includeArchived', () => {
    const props = LIST_MEMORIES_TOOL.parameters.properties;
    expect(props).toHaveProperty('category');
    expect(props).toHaveProperty('importance');
    expect(props).toHaveProperty('search');
    expect(props).toHaveProperty('limit');
    expect(props).toHaveProperty('includeArchived');
    const required = LIST_MEMORIES_TOOL.parameters.required ?? [];
    expect(required).not.toContain('category');
    expect(required).not.toContain('importance');
    expect(required).not.toContain('search');
    expect(required).not.toContain('limit');
    expect(required).not.toContain('includeArchived');
  });

  it('DELETE_MEMORY_TOOL requires memoryId', () => {
    const required = DELETE_MEMORY_TOOL.parameters.required;
    expect(required).toContain('memoryId');
  });

  it('BULK_DELETE_MEMORIES_TOOL requires confirm', () => {
    const required = BULK_DELETE_MEMORIES_TOOL.parameters.required;
    expect(required).toContain('confirm');
  });

  it('CLEAR_ALL_MEMORIES_TOOL requires confirm and confirmPhrase', () => {
    const required = CLEAR_ALL_MEMORIES_TOOL.parameters.required;
    expect(required).toContain('confirm');
    expect(required).toContain('confirmPhrase');
  });

  it('ARCHIVE_MEMORY_TOOL requires memoryId', () => {
    const required = ARCHIVE_MEMORY_TOOL.parameters.required;
    expect(required).toContain('memoryId');
  });

  it('RESTORE_MEMORY_TOOL requires memoryId', () => {
    const required = RESTORE_MEMORY_TOOL.parameters.required;
    expect(required).toContain('memoryId');
  });

  it('UPDATE_MEMORY_IMPORTANCE_TOOL requires memoryId and importance', () => {
    const required = UPDATE_MEMORY_IMPORTANCE_TOOL.parameters.required;
    expect(required).toContain('memoryId');
    expect(required).toContain('importance');
  });

  it('VIEW_PROFILE_TOOL has parameters defined', () => {
    expect(VIEW_PROFILE_TOOL).toHaveProperty('parameters');
  });

  it('EXPORT_MEMORIES_TOOL has parameters defined', () => {
    expect(EXPORT_MEMORIES_TOOL).toHaveProperty('parameters');
  });

  it('MEMORY_STATS_TOOL name is get_memory_stats', () => {
    expect(MEMORY_STATS_TOOL.name).toBe('get_memory_stats');
  });

  it('CONFIGURE_RETENTION_TOOL has parameters defined', () => {
    expect(CONFIGURE_RETENTION_TOOL).toHaveProperty('parameters');
  });
});

// ---------------------------------------------------------------------------
// 2. list_memories executor
// ---------------------------------------------------------------------------
describe('list_memories executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('returns memories when found', async () => {
    const mem = makeMemoryEntry();
    store.queryMemories.mockResolvedValue([mem]);
    const result = await executors.list_memories({ limit: 10 }, mockCtx);
    expect(result.content.success).toBe(true);
    expect(result.content.count).toBe(1);
    expect(result.content.memories).toHaveLength(1);
    expect(result.content.memories[0].content).toBe(mem.content);
  });

  it('returns empty message when none found', async () => {
    store.queryMemories.mockResolvedValue([]);
    const result = await executors.list_memories({}, mockCtx);
    expect(result.content.success).toBe(true);
    expect(result.content.message).toMatch(/no memor/i);
    expect(result.content.memories).toEqual([]);
  });

  it('passes category to queryOptions', async () => {
    store.queryMemories.mockResolvedValue([]);
    await executors.list_memories({ category: 'preference' }, mockCtx);
    const opts = store.queryMemories.mock.calls[0]![0];
    expect(opts.category).toBe('preference');
  });

  it('passes importance as minImportance to queryOptions', async () => {
    store.queryMemories.mockResolvedValue([]);
    await executors.list_memories({ importance: 'high' }, mockCtx);
    const opts = store.queryMemories.mock.calls[0]![0];
    expect(opts.minImportance).toBe('high');
  });

  it('passes search as searchText to queryOptions', async () => {
    store.queryMemories.mockResolvedValue([]);
    await executors.list_memories({ search: 'dark mode' }, mockCtx);
    const opts = store.queryMemories.mock.calls[0]![0];
    expect(opts.searchText).toBe('dark mode');
  });

  it('passes limit and includeArchived to queryOptions', async () => {
    store.queryMemories.mockResolvedValue([]);
    await executors.list_memories({ limit: 5, includeArchived: true }, mockCtx);
    const opts = store.queryMemories.mock.calls[0]![0];
    expect(opts.limit).toBe(5);
    expect(opts.includeArchived).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. delete_memory executor
// ---------------------------------------------------------------------------
describe('delete_memory executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('deletes existing memory and returns formatted result', async () => {
    const mem = makeMemoryEntry({ id: 'mem_42' });
    store.getMemory.mockResolvedValue(mem);
    const result = await executors.delete_memory({ memoryId: 'mem_42' }, mockCtx);
    expect(store.deleteMemory).toHaveBeenCalledWith('mem_42');
    expect(result.content.success).toBe(true);
    expect(result.content.deletedMemory).toBeDefined();
    expect(result.content.deletedMemory.id).toBe('mem_42');
  });

  it('returns error when memory not found', async () => {
    store.getMemory.mockResolvedValue(null);
    const result = await executors.delete_memory({ memoryId: 'missing' }, mockCtx);
    expect(store.deleteMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/not found/i);
  });

  it('calls getMemory with the provided memoryId', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry());
    await executors.delete_memory({ memoryId: 'abc' }, mockCtx);
    expect(store.getMemory).toHaveBeenCalledWith('abc');
  });

  it('includes truncated content in success message', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry());
    const result = await executors.delete_memory({ memoryId: 'mem_1' }, mockCtx);
    expect(result.content.message).toContain('Deleted memory');
  });
});

// ---------------------------------------------------------------------------
// 4. bulk_delete_memories executor
// ---------------------------------------------------------------------------
describe('bulk_delete_memories executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('requires confirm=true', async () => {
    const result = await executors.bulk_delete_memories({ confirm: false }, mockCtx);
    expect(store.queryMemories).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/confirm/i);
  });

  it('deletes matching memories when confirmed', async () => {
    const mems = [makeMemoryEntry({ id: 'a' }), makeMemoryEntry({ id: 'b' })];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.bulk_delete_memories({ confirm: true, category: 'preference' }, mockCtx);
    expect(store.deleteMemory).toHaveBeenCalledTimes(2);
    expect(result.content.success).toBe(true);
    expect(result.content.message).toContain('2');
  });

  it('filters by olderThan date', async () => {
    const old = makeMemoryEntry({ id: 'old', createdAt: '2025-01-01T00:00:00Z' });
    const recent = makeMemoryEntry({ id: 'recent', createdAt: '2026-02-20T00:00:00Z' });
    store.queryMemories.mockResolvedValue([old, recent]);
    await executors.bulk_delete_memories(
      { confirm: true, olderThan: '2026-01-01' },
      mockCtx,
    );
    expect(store.deleteMemory).toHaveBeenCalledWith('old');
    expect(store.deleteMemory).not.toHaveBeenCalledWith('recent');
  });

  it('filters by importance level (at or below)', async () => {
    const low = makeMemoryEntry({ id: 'lo', importance: 'low' });
    const high = makeMemoryEntry({ id: 'hi', importance: 'high' });
    store.queryMemories.mockResolvedValue([low, high]);
    await executors.bulk_delete_memories(
      { confirm: true, importance: 'low' },
      mockCtx,
    );
    expect(store.deleteMemory).toHaveBeenCalledWith('lo');
    expect(store.deleteMemory).not.toHaveBeenCalledWith('hi');
  });

  it('returns count of deleted memories in message', async () => {
    store.queryMemories.mockResolvedValue([makeMemoryEntry()]);
    const result = await executors.bulk_delete_memories({ confirm: true }, mockCtx);
    expect(result.content.message).toContain('1');
  });
});

// ---------------------------------------------------------------------------
// 5. archive_memory executor
// ---------------------------------------------------------------------------
describe('archive_memory executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('archives existing non-archived memory', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry({ archived: false }));
    const result = await executors.archive_memory({ memoryId: 'mem_1' }, mockCtx);
    expect(store.archiveMemory).toHaveBeenCalledWith('mem_1');
    expect(result.content.success).toBe(true);
    expect(result.content.message).toMatch(/archived/i);
  });

  it('returns error if memory not found', async () => {
    store.getMemory.mockResolvedValue(null);
    const result = await executors.archive_memory({ memoryId: 'nope' }, mockCtx);
    expect(store.archiveMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/not found/i);
  });

  it('returns error if already archived', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry({ archived: true }));
    const result = await executors.archive_memory({ memoryId: 'mem_1' }, mockCtx);
    expect(store.archiveMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/already archived/i);
  });
});

// ---------------------------------------------------------------------------
// 6. restore_memory executor
// ---------------------------------------------------------------------------
describe('restore_memory executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('restores archived memory', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry({ archived: true }));
    const result = await executors.restore_memory({ memoryId: 'mem_1' }, mockCtx);
    expect(store.restoreMemory).toHaveBeenCalledWith('mem_1');
    expect(result.content.success).toBe(true);
    expect(result.content.message).toMatch(/restored/i);
  });

  it('returns error if not found', async () => {
    store.getMemory.mockResolvedValue(null);
    const result = await executors.restore_memory({ memoryId: 'nope' }, mockCtx);
    expect(store.restoreMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/not found/i);
  });

  it('returns error if not archived', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry({ archived: false }));
    const result = await executors.restore_memory({ memoryId: 'mem_1' }, mockCtx);
    expect(store.restoreMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/not archived/i);
  });
});

// ---------------------------------------------------------------------------
// 7. view_my_profile executor
// ---------------------------------------------------------------------------
describe('view_my_profile executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('returns profile with summary', async () => {
    const result = await executors.view_my_profile({}, mockCtx);
    expect(store.getUserProfile).toHaveBeenCalled();
    expect(result.content.success).toBe(true);
    expect(result.content.profile).toBeDefined();
    expect(result.content.profile.summary).toBeDefined();
    expect(result.content.profile.name).toBe('Test User');
  });

  it('summary includes name, preferences, facts count, goals, relationships, interests, style', async () => {
    const result = await executors.view_my_profile({}, mockCtx);
    const summary = result.content.profile.summary as string;
    expect(summary).toContain('Test User');
    expect(summary).toContain('dark mode');
    // facts are shown as count
    expect(summary).toMatch(/Known facts: 1/);
    expect(summary).toContain('learn AI');
    expect(summary).toContain('Alice');
    expect(summary).toContain('TypeScript');
    // Communication style
    expect(summary).toContain('casual');
    expect(summary).toContain('concise');
    expect(summary).toContain('English');
  });
});

// ---------------------------------------------------------------------------
// 8. update_memory_importance executor
// ---------------------------------------------------------------------------
describe('update_memory_importance executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('updates importance and returns old and new level in message', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry({ importance: 'low' }));
    const result = await executors.update_memory_importance(
      { memoryId: 'mem_1', importance: 'critical' },
      mockCtx,
    );
    expect(result.content.success).toBe(true);
    expect(result.content.message).toContain('low');
    expect(result.content.message).toContain('critical');
  });

  it('returns error if memory not found', async () => {
    store.getMemory.mockResolvedValue(null);
    const result = await executors.update_memory_importance(
      { memoryId: 'nope', importance: 'high' },
      mockCtx,
    );
    expect(store.updateMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/not found/i);
  });

  it('calls updateMemory with the new importance', async () => {
    store.getMemory.mockResolvedValue(makeMemoryEntry());
    await executors.update_memory_importance(
      { memoryId: 'mem_1', importance: 'high' },
      mockCtx,
    );
    expect(store.updateMemory).toHaveBeenCalledWith('mem_1', { importance: 'high' });
  });
});

// ---------------------------------------------------------------------------
// 9. export_memories executor
// ---------------------------------------------------------------------------
describe('export_memories executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('exports all memories with profile', async () => {
    const mems = [makeMemoryEntry({ id: 'a' }), makeMemoryEntry({ id: 'b' })];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.export_memories({}, mockCtx);
    expect(store.getUserProfile).toHaveBeenCalled();
    expect(store.queryMemories).toHaveBeenCalled();
    expect(result.content.success).toBe(true);
    expect(result.content.exportData.memoryCount).toBe(2);
    expect(result.content.exportData.memories).toHaveLength(2);
    expect(result.content.exportData.profile).toBeDefined();
  });

  it('filters by category', async () => {
    store.queryMemories.mockResolvedValue([]);
    await executors.export_memories({ category: 'fact' }, mockCtx);
    const opts = store.queryMemories.mock.calls[0]![0];
    expect(opts.category).toBe('fact');
  });

  it('includes profile data in export', async () => {
    store.queryMemories.mockResolvedValue([]);
    const result = await executors.export_memories({}, mockCtx);
    expect(result.content.exportData.profile.name).toBe('Test User');
  });
});

// ---------------------------------------------------------------------------
// 10. memory_stats executor
// ---------------------------------------------------------------------------
describe('memory_stats executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('calculates stats by category, importance, and dates', async () => {
    const mems = [
      makeMemoryEntry({ id: '1', category: 'preference', importance: 'high', createdAt: '2026-01-10T00:00:00Z' }),
      makeMemoryEntry({ id: '2', category: 'fact', importance: 'low', createdAt: '2026-01-05T00:00:00Z' }),
      makeMemoryEntry({ id: '3', category: 'preference', importance: 'medium', createdAt: '2026-01-20T00:00:00Z' }),
    ];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.memory_stats({}, mockCtx);
    expect(result.content.success).toBe(true);
    const stats = result.content.stats;
    expect(stats.total).toBe(3);
    expect(stats.byCategory.preference).toBe(2);
    expect(stats.byCategory.fact).toBe(1);
    expect(stats.byImportance.high).toBe(1);
    expect(stats.byImportance.low).toBe(1);
    expect(stats.byImportance.medium).toBe(1);
    expect(stats.oldestMemory).toBe('2026-01-05T00:00:00Z');
    expect(stats.newestMemory).toBe('2026-01-20T00:00:00Z');
  });

  it('handles empty memories', async () => {
    store.queryMemories.mockResolvedValue([]);
    const result = await executors.memory_stats({}, mockCtx);
    expect(result.content.success).toBe(true);
    expect(result.content.stats.total).toBe(0);
    expect(result.content.stats.oldestMemory).toBeNull();
    expect(result.content.stats.newestMemory).toBeNull();
  });

  it('calculates active vs archived counts', async () => {
    const mems = [
      makeMemoryEntry({ id: '1', archived: false }),
      makeMemoryEntry({ id: '2', archived: true }),
    ];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.memory_stats({}, mockCtx);
    expect(result.content.stats.active).toBe(1);
    expect(result.content.stats.archived).toBe(1);
  });

  it('sums total access counts', async () => {
    const mems = [
      makeMemoryEntry({ id: '1', accessCount: 5 }),
      makeMemoryEntry({ id: '2', accessCount: 10 }),
    ];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.memory_stats({}, mockCtx);
    expect(result.content.stats.totalAccessCount).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// 11. clear_all_memories executor
// ---------------------------------------------------------------------------
describe('clear_all_memories executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('requires confirm=true', async () => {
    const result = await executors.clear_all_memories(
      { confirm: false, confirmPhrase: 'DELETE ALL MY MEMORIES' },
      mockCtx,
    );
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/confirm/i);
  });

  it('requires exact confirmPhrase "DELETE ALL MY MEMORIES"', async () => {
    const result = await executors.clear_all_memories(
      { confirm: true, confirmPhrase: 'wrong phrase' },
      mockCtx,
    );
    expect(store.deleteMemory).not.toHaveBeenCalled();
    expect(result.content.success).toBe(false);
    expect(result.content.error).toMatch(/phrase|DELETE ALL MY MEMORIES/i);
  });

  it('deletes all memories when properly confirmed', async () => {
    const mems = [makeMemoryEntry({ id: 'a' }), makeMemoryEntry({ id: 'b' }), makeMemoryEntry({ id: 'c' })];
    store.queryMemories.mockResolvedValue(mems);
    const result = await executors.clear_all_memories(
      { confirm: true, confirmPhrase: 'DELETE ALL MY MEMORIES' },
      mockCtx,
    );
    expect(store.deleteMemory).toHaveBeenCalledTimes(3);
    expect(result.content.success).toBe(true);
    expect(result.content.message).toContain('3');
  });
});

// ---------------------------------------------------------------------------
// 12. configure_retention executor
// ---------------------------------------------------------------------------
describe('configure_retention executor', () => {
  let store: ReturnType<typeof makeMockStore>;
  let executors: Record<string, Function>;

  beforeEach(() => {
    store = makeMockStore();
    executors = createMemoryOversightExecutors(() => store);
  });

  it('updates policy with new values merged with defaults', async () => {
    const result = await executors.configure_retention(
      { autoArchiveDays: 30, maxMemories: 500 },
      mockCtx,
    );
    expect(store.setRetentionPolicy).toHaveBeenCalled();
    const policy = store.setRetentionPolicy.mock.calls[0]![0];
    expect(policy.autoArchiveDays).toBe(30);
    expect(policy.maxMemories).toBe(500);
    // defaults preserved
    expect(policy.deleteArchivedAfterDays).toBe(180);
    expect(policy.exemptCategories).toEqual(['instruction']);
    expect(result.content.success).toBe(true);
  });

  it('maps autoDeleteDays to deleteArchivedAfterDays', async () => {
    await executors.configure_retention({ autoDeleteDays: 60 }, mockCtx);
    const policy = store.setRetentionPolicy.mock.calls[0]![0];
    expect(policy.deleteArchivedAfterDays).toBe(60);
  });

  it('maps preserveCategories to exemptCategories', async () => {
    await executors.configure_retention({ preserveCategories: ['fact', 'goal'] }, mockCtx);
    const policy = store.setRetentionPolicy.mock.calls[0]![0];
    expect(policy.exemptCategories).toEqual(['fact', 'goal']);
  });
});

// ---------------------------------------------------------------------------
// 13. createMemoryOversightTools
// ---------------------------------------------------------------------------
describe('createMemoryOversightTools', () => {
  it('returns array of {definition, executor} pairs', () => {
    const store = makeMockStore();
    const tools = createMemoryOversightTools(() => store);
    for (const tool of tools) {
      expect(tool).toHaveProperty('definition');
      expect(tool).toHaveProperty('executor');
      expect(tool.definition).toHaveProperty('name');
    }
    // Executors whose definition.name matches executor key should be functions
    const toolsWithExecutors = tools.filter((t: any) => t.executor !== undefined);
    for (const tool of toolsWithExecutors) {
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('length matches MEMORY_OVERSIGHT_TOOLS', () => {
    const store = makeMockStore();
    const tools = createMemoryOversightTools(() => store);
    expect(tools).toHaveLength(MEMORY_OVERSIGHT_TOOLS.length);
  });
});

// ---------------------------------------------------------------------------
// 14. MemoryCleaner
// ---------------------------------------------------------------------------
describe('MemoryCleaner', () => {
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = makeMockStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startAutoCleanup calls runCleanup immediately', () => {
    const cleaner = new MemoryCleaner(store);
    const spy = vi.spyOn(cleaner, 'runCleanup').mockResolvedValue({ archived: 0, deleted: 0 });
    cleaner.startAutoCleanup(60_000);
    expect(spy).toHaveBeenCalledTimes(1);
    cleaner.stopAutoCleanup();
  });

  it('stopAutoCleanup clears interval', () => {
    const cleaner = new MemoryCleaner(store);
    const spy = vi.spyOn(cleaner, 'runCleanup').mockResolvedValue({ archived: 0, deleted: 0 });
    cleaner.startAutoCleanup(60_000);
    cleaner.stopAutoCleanup();
    const callCount = spy.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(spy.mock.calls.length).toBe(callCount);
  });

  it('runCleanup calls store.applyRetentionPolicy', async () => {
    const cleaner = new MemoryCleaner(store);
    await cleaner.runCleanup();
    expect(store.applyRetentionPolicy).toHaveBeenCalled();
  });

  it('runCleanup returns the retention policy result', async () => {
    const cleaner = new MemoryCleaner(store);
    const result = await cleaner.runCleanup();
    expect(result).toEqual({ archived: 2, deleted: 1 });
  });

  it('deduplicateMemories removes duplicates keeping highest importance', async () => {
    const dup1 = makeMemoryEntry({ id: 'dup1', content: 'user likes coffee', importance: 'low' });
    const dup2 = makeMemoryEntry({ id: 'dup2', content: 'User Likes Coffee', importance: 'high' });
    const unique = makeMemoryEntry({ id: 'unique', content: 'something else', importance: 'medium' });
    store.queryMemories.mockResolvedValue([dup1, dup2, unique]);

    const cleaner = new MemoryCleaner(store);
    const removed = await cleaner.deduplicateMemories();

    // dup2 has higher importance (index 1 in ['critical','high','medium','low']) vs dup1 (index 3)
    // sort by importanceOrder index ascending: dup2 (1) < dup1 (3) -- dup2 kept, dup1 deleted
    expect(store.deleteMemory).toHaveBeenCalledWith('dup1');
    expect(store.deleteMemory).not.toHaveBeenCalledWith('dup2');
    expect(store.deleteMemory).not.toHaveBeenCalledWith('unique');
    expect(removed).toBe(1);
  });

  it('deduplicateMemories handles no duplicates', async () => {
    const mem1 = makeMemoryEntry({ id: '1', content: 'alpha' });
    const mem2 = makeMemoryEntry({ id: '2', content: 'beta' });
    store.queryMemories.mockResolvedValue([mem1, mem2]);

    const cleaner = new MemoryCleaner(store);
    const removed = await cleaner.deduplicateMemories();

    expect(store.deleteMemory).not.toHaveBeenCalled();
    expect(removed).toBe(0);
  });

  it('mergeSimilarMemories merges by prefix and combines tags', async () => {
    // Both contents must share a 50-char prefix so the prefix match triggers
    // Prefix: "User strongly prefers using dark mode in all of th" (50 chars)
    const mem1 = makeMemoryEntry({
      id: 'm1',
      content: 'User strongly prefers using dark mode in all of their coding environments and IDEs',
      category: 'preference',
      tags: ['dark', 'coding'],
      importance: 'high',
    });
    const mem2 = makeMemoryEntry({
      id: 'm2',
      content: 'User strongly prefers using dark mode in all of their reading applications and browsers',
      category: 'preference',
      tags: ['dark', 'reading'],
      importance: 'medium',
    });
    store.queryMemories.mockResolvedValue([mem1, mem2]);

    const cleaner = new MemoryCleaner(store);
    const merged = await cleaner.mergeSimilarMemories(0.5);

    // m1 has higher importance (index 1 in ['critical','high','medium','low']), so it's the primary
    expect(store.updateMemory).toHaveBeenCalled();
    const updateCall = store.updateMemory.mock.calls[0]!;
    expect(updateCall[1].tags).toEqual(expect.arrayContaining(['dark', 'coding', 'reading']));
    expect(store.deleteMemory).toHaveBeenCalled();
    expect(merged).toBeGreaterThanOrEqual(1);
  });

  it('mergeSimilarMemories with different categories does not merge', async () => {
    const mem1 = makeMemoryEntry({ id: '1', content: 'User prefers dark mode for coding and development', category: 'preference' });
    const mem2 = makeMemoryEntry({ id: '2', content: 'User prefers dark mode for coding and development', category: 'fact' });
    store.queryMemories.mockResolvedValue([mem1, mem2]);

    const cleaner = new MemoryCleaner(store);
    const merged = await cleaner.mergeSimilarMemories(0.9);

    // Different categories should not be merged
    expect(store.deleteMemory).not.toHaveBeenCalled();
    expect(merged).toBe(0);
  });

  it('startAutoCleanup triggers runCleanup on interval', () => {
    const cleaner = new MemoryCleaner(store);
    const spy = vi.spyOn(cleaner, 'runCleanup').mockResolvedValue({ archived: 0, deleted: 0 });
    cleaner.startAutoCleanup(10_000);

    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);

    cleaner.stopAutoCleanup();
  });
});

// ---------------------------------------------------------------------------
// 15. createMemoryCleaner
// ---------------------------------------------------------------------------
describe('createMemoryCleaner', () => {
  it('returns a MemoryCleaner instance', () => {
    const store = makeMockStore();
    const cleaner = createMemoryCleaner(store);
    expect(cleaner).toBeInstanceOf(MemoryCleaner);
  });
});
