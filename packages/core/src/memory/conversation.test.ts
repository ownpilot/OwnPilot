import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConversationMemoryStore,
  createConversationMemoryStore,
  getMemoryStore,
  DEFAULT_RETENTION_POLICY,
  type MemoryEntry,
  type ConversationSummary,
} from './conversation.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryInput(
  overrides: Partial<
    Omit<MemoryEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'archived'>
  > = {},
) {
  return {
    category: 'fact' as const,
    content: 'The user likes TypeScript',
    importance: 'medium' as const,
    source: 'user_stated' as const,
    confidence: 0.9,
    tags: ['typescript', 'programming'],
    ...overrides,
  };
}

function makeSummaryInput(
  overrides: Partial<Omit<ConversationSummary, 'createdAt'>> = {},
): Omit<ConversationSummary, 'createdAt'> {
  return {
    conversationId: 'conv-1',
    userId: 'test-user',
    summary: 'We discussed TypeScript patterns.',
    topics: ['typescript', 'patterns'],
    factsLearned: ['User prefers strict mode'],
    actionsTaken: ['Showed example'],
    sentiment: 'positive',
    messageCount: 12,
    durationMinutes: 15,
    startedAt: '2025-01-01T10:00:00.000Z',
    endedAt: '2025-01-01T10:15:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationMemoryStore', () => {
  let store: ConversationMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    store = new ConversationMemoryStore('test-user', { storageDir: '/tmp/test' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('sets userId and storageDir from options', () => {
      const s = new ConversationMemoryStore('user-42', { storageDir: '/custom/dir' });
      expect(s.getUserId()).toBe('user-42');
    });

    it('uses default storageDir when not provided', () => {
      const s = new ConversationMemoryStore('user-default');
      expect(s.getUserId()).toBe('user-default');
    });

    it('applies custom retention policy', () => {
      const s = new ConversationMemoryStore('u', {
        retentionPolicy: { maxMemories: 500, autoArchiveDays: 30 },
      });
      const policy = s.getRetentionPolicy();
      expect(policy.maxMemories).toBe(500);
      expect(policy.autoArchiveDays).toBe(30);
      expect(policy.lowImportanceMaxAgeDays).toBe(DEFAULT_RETENTION_POLICY.lowImportanceMaxAgeDays);
    });

    it('uses default retention policy when not provided', () => {
      const s = new ConversationMemoryStore('u');
      expect(s.getRetentionPolicy()).toEqual(DEFAULT_RETENTION_POLICY);
    });
  });

  describe('initialize()', () => {
    it('creates storage directory', async () => {
      await store.initialize();
      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/test', { recursive: true });
    });

    it('loads memories from file', async () => {
      const existingMemory: MemoryEntry = {
        id: 'mem_existing',
        userId: 'test-user',
        category: 'fact',
        content: 'existing fact',
        importance: 'high',
        source: 'user_stated',
        confidence: 1,
        tags: ['existing'],
        accessCount: 5,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        archived: false,
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.includes('memories.json')) return JSON.stringify([existingMemory]);
        throw new Error('ENOENT');
      });

      await store.initialize();
      const result = await store.getMemory('mem_existing');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('existing fact');
    });

    it('loads summaries from file', async () => {
      const existingSummary: ConversationSummary = {
        conversationId: 'conv-old',
        userId: 'test-user',
        summary: 'old conversation',
        topics: ['general'],
        factsLearned: [],
        actionsTaken: [],
        sentiment: 'neutral',
        messageCount: 3,
        durationMinutes: 5,
        startedAt: '2025-01-01T00:00:00.000Z',
        endedAt: '2025-01-01T00:05:00.000Z',
        createdAt: '2025-01-01T00:05:00.000Z',
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.includes('summaries.json')) return JSON.stringify([existingSummary]);
        throw new Error('ENOENT');
      });

      await store.initialize();
      const summary = await store.getConversationSummary('conv-old');
      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('old conversation');
    });

    it('only initializes once (idempotent)', async () => {
      await store.initialize();
      await store.initialize();
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('handles missing files gracefully (new store)', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      await store.initialize();
      const memories = await store.queryMemories();
      expect(memories).toEqual([]);
    });
  });

  describe('Memory CRUD', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    describe('addMemory', () => {
      it('creates entry with auto-generated id, userId, timestamps, accessCount=0, archived=false', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        expect(entry.id).toMatch(/^mem_/);
        expect(entry.userId).toBe('test-user');
        expect(entry.accessCount).toBe(0);
        expect(entry.archived).toBe(false);
        expect(entry.createdAt).toBeDefined();
        expect(entry.updatedAt).toBeDefined();
        expect(entry.content).toBe('The user likes TypeScript');
      });

      it('persists to disk', async () => {
        await store.addMemory(makeMemoryInput());
        expect(fs.writeFile).toHaveBeenCalled();
        const writeCall = vi.mocked(fs.writeFile).mock.calls.find((c) =>
          String(c[0]).includes('memories.json'),
        );
        expect(writeCall).toBeDefined();
      });
    });

    describe('updateMemory', () => {
      it('updates fields, preserves id/userId/createdAt, updates updatedAt', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        const originalCreatedAt = entry.createdAt;
        const updated = await store.updateMemory(entry.id, {
          content: 'Updated content',
          importance: 'high',
        });
        expect(updated).not.toBeNull();
        expect(updated!.id).toBe(entry.id);
        expect(updated!.userId).toBe('test-user');
        expect(updated!.createdAt).toBe(originalCreatedAt);
        expect(updated!.content).toBe('Updated content');
        expect(updated!.importance).toBe('high');
        expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(originalCreatedAt).getTime(),
        );
      });

      it('returns null for non-existent id', async () => {
        const result = await store.updateMemory('non-existent', { content: 'nope' });
        expect(result).toBeNull();
      });
    });

    describe('getMemory', () => {
      it('returns memory by id', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        const result = await store.getMemory(entry.id);
        expect(result).not.toBeNull();
        expect(result!.id).toBe(entry.id);
      });

      it('increments accessCount and updates lastAccessed', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        expect(entry.accessCount).toBe(0);
        const first = await store.getMemory(entry.id);
        expect(first!.accessCount).toBe(1);
        expect(first!.lastAccessed).toBeDefined();
        const second = await store.getMemory(entry.id);
        expect(second!.accessCount).toBe(2);
      });

      it('returns null for non-existent id', async () => {
        const result = await store.getMemory('does-not-exist');
        expect(result).toBeNull();
      });
    });

    describe('deleteMemory', () => {
      it('removes memory and saves', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        const deleted = await store.deleteMemory(entry.id);
        expect(deleted).toBe(true);
        const result = await store.getMemory(entry.id);
        expect(result).toBeNull();
      });

      it('returns false for non-existent id', async () => {
        const result = await store.deleteMemory('no-such-id');
        expect(result).toBe(false);
      });
    });

    describe('archiveMemory', () => {
      it('sets archived=true', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        const result = await store.archiveMemory(entry.id);
        expect(result).toBe(true);
        const mem = await store.getMemory(entry.id);
        expect(mem!.archived).toBe(true);
      });

      it('returns false for non-existent id', async () => {
        const result = await store.archiveMemory('nope');
        expect(result).toBe(false);
      });
    });

    describe('restoreMemory', () => {
      it('sets archived=false', async () => {
        const entry = await store.addMemory(makeMemoryInput());
        await store.archiveMemory(entry.id);
        const result = await store.restoreMemory(entry.id);
        expect(result).toBe(true);
        const mem = await store.getMemory(entry.id);
        expect(mem!.archived).toBe(false);
      });

      it('returns false for non-existent id', async () => {
        const result = await store.restoreMemory('nope');
        expect(result).toBe(false);
      });
    });
  });

  describe('queryMemories()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns all non-archived memories by default', async () => {
      await store.addMemory(makeMemoryInput({ content: 'A' }));
      await store.addMemory(makeMemoryInput({ content: 'B' }));
      const entry = await store.addMemory(makeMemoryInput({ content: 'C' }));
      await store.archiveMemory(entry.id);
      const results = await store.queryMemories();
      expect(results).toHaveLength(2);
      expect(results.every((m) => !m.archived)).toBe(true);
    });

    it('filters by single category', async () => {
      await store.addMemory(makeMemoryInput({ category: 'fact' }));
      await store.addMemory(makeMemoryInput({ category: 'preference' }));
      await store.addMemory(makeMemoryInput({ category: 'episode' }));
      const results = await store.queryMemories({ category: 'fact' });
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('fact');
    });

    it('filters by multiple categories', async () => {
      await store.addMemory(makeMemoryInput({ category: 'fact' }));
      await store.addMemory(makeMemoryInput({ category: 'preference' }));
      await store.addMemory(makeMemoryInput({ category: 'episode' }));
      const results = await store.queryMemories({ categories: ['fact', 'preference'] });
      expect(results).toHaveLength(2);
    });

    it('filters by minImportance (uses weight: critical=4, high=3, medium=2, low=1)', async () => {
      await store.addMemory(makeMemoryInput({ importance: 'low' }));
      await store.addMemory(makeMemoryInput({ importance: 'medium' }));
      await store.addMemory(makeMemoryInput({ importance: 'high' }));
      await store.addMemory(makeMemoryInput({ importance: 'critical' }));
      const highAndAbove = await store.queryMemories({ minImportance: 'high' });
      expect(highAndAbove).toHaveLength(2);
      expect(highAndAbove.every((m) => ['high', 'critical'].includes(m.importance))).toBe(true);
      const mediumAndAbove = await store.queryMemories({ minImportance: 'medium' });
      expect(mediumAndAbove).toHaveLength(3);
    });

    it('filters by minConfidence', async () => {
      await store.addMemory(makeMemoryInput({ confidence: 0.3 }));
      await store.addMemory(makeMemoryInput({ confidence: 0.7 }));
      await store.addMemory(makeMemoryInput({ confidence: 0.95 }));
      const results = await store.queryMemories({ minConfidence: 0.5 });
      expect(results).toHaveLength(2);
      expect(results.every((m) => m.confidence >= 0.5)).toBe(true);
    });

    it('filters by tags (any match)', async () => {
      await store.addMemory(makeMemoryInput({ tags: ['python'] }));
      await store.addMemory(makeMemoryInput({ tags: ['typescript', 'javascript'] }));
      await store.addMemory(makeMemoryInput({ tags: ['rust'] }));
      const results = await store.queryMemories({ tags: ['typescript', 'python'] });
      expect(results).toHaveLength(2);
    });

    it('includes archived when includeArchived=true', async () => {
      await store.addMemory(makeMemoryInput({ content: 'active' }));
      const entry = await store.addMemory(makeMemoryInput({ content: 'archived' }));
      await store.archiveMemory(entry.id);
      const results = await store.queryMemories({ includeArchived: true });
      expect(results).toHaveLength(2);
    });

    it('searches by query text (content and tags)', async () => {
      await store.addMemory(makeMemoryInput({ content: 'I love coffee', tags: ['coffee'] }));
      await store.addMemory(makeMemoryInput({ content: 'I enjoy tea', tags: ['tea'] }));
      await store.addMemory(makeMemoryInput({ content: 'I use Vim', tags: ['editor'] }));
      const results = await store.queryMemories({ query: 'coffee' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('I love coffee');
    });

    it('searches by searchText alias', async () => {
      await store.addMemory(makeMemoryInput({ content: 'Vim user', tags: ['editor'] }));
      await store.addMemory(makeMemoryInput({ content: 'VS Code user', tags: ['editor'] }));
      const results = await store.queryMemories({ searchText: 'vim' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Vim user');
    });

    it('search also matches tags', async () => {
      await store.addMemory(makeMemoryInput({ content: 'Uses an editor', tags: ['vim'] }));
      const results = await store.queryMemories({ query: 'vim' });
      expect(results).toHaveLength(1);
    });

    it('sorts by recency', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      const a = await store.addMemory(makeMemoryInput({ content: 'older' }));
      vi.setSystemTime(new Date('2025-01-02T00:00:00.000Z'));
      await store.updateMemory(a.id, { content: 'older-updated' });
      vi.setSystemTime(new Date('2025-01-03T00:00:00.000Z'));
      const b = await store.addMemory(makeMemoryInput({ content: 'newer' }));
      vi.useRealTimers();
      const results = await store.queryMemories({ sortBy: 'recency' });
      expect(results[0].id).toBe(b.id);
    });

    it('sorts by importance', async () => {
      await store.addMemory(makeMemoryInput({ content: 'low-imp', importance: 'low' }));
      await store.addMemory(makeMemoryInput({ content: 'critical-imp', importance: 'critical' }));
      await store.addMemory(makeMemoryInput({ content: 'medium-imp', importance: 'medium' }));
      const results = await store.queryMemories({ sortBy: 'importance' });
      expect(results[0].importance).toBe('critical');
      expect(results[1].importance).toBe('medium');
      expect(results[2].importance).toBe('low');
    });

    it('sorts by access_count', async () => {
      const a = await store.addMemory(makeMemoryInput({ content: 'rarely' }));
      const b = await store.addMemory(makeMemoryInput({ content: 'often' }));
      await store.getMemory(b.id);
      await store.getMemory(b.id);
      await store.getMemory(b.id);
      await store.getMemory(a.id);
      const results = await store.queryMemories({ sortBy: 'access_count' });
      expect(results[0].id).toBe(b.id);
      expect(results[0].accessCount).toBeGreaterThan(results[1].accessCount);
    });

    it('sorts by relevance (default)', async () => {
      await store.addMemory(makeMemoryInput({ importance: 'low', confidence: 0.5 }));
      await store.addMemory(makeMemoryInput({ importance: 'critical', confidence: 1.0 }));
      const results = await store.queryMemories();
      expect(results[0].importance).toBe('critical');
    });

    it('limits results', async () => {
      await store.addMemory(makeMemoryInput({ content: '1' }));
      await store.addMemory(makeMemoryInput({ content: '2' }));
      await store.addMemory(makeMemoryInput({ content: '3' }));
      const results = await store.queryMemories({ limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('Convenience methods', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('getFacts returns fact category sorted by importance', async () => {
      await store.addMemory(makeMemoryInput({ category: 'fact', importance: 'low', content: 'low fact' }));
      await store.addMemory(makeMemoryInput({ category: 'fact', importance: 'high', content: 'high fact' }));
      await store.addMemory(makeMemoryInput({ category: 'preference', content: 'pref' }));
      const facts = await store.getFacts();
      expect(facts).toHaveLength(2);
      expect(facts.every((f) => f.category === 'fact')).toBe(true);
      expect(facts[0].importance).toBe('high');
    });

    it('getPreferences returns preference category', async () => {
      await store.addMemory(makeMemoryInput({ category: 'preference', content: 'dark mode' }));
      await store.addMemory(makeMemoryInput({ category: 'fact', content: 'some fact' }));
      const prefs = await store.getPreferences();
      expect(prefs).toHaveLength(1);
      expect(prefs[0].category).toBe('preference');
    });

    it('getInstructions returns instruction category', async () => {
      await store.addMemory(makeMemoryInput({ category: 'instruction', content: 'Always reply briefly' }));
      await store.addMemory(makeMemoryInput({ category: 'fact', content: 'some fact' }));
      const instructions = await store.getInstructions();
      expect(instructions).toHaveLength(1);
      expect(instructions[0].category).toBe('instruction');
    });

    it('getRecentEpisodes returns episodes sorted by recency with limit', async () => {
      await store.addMemory(makeMemoryInput({ category: 'episode', content: 'ep1' }));
      await store.addMemory(makeMemoryInput({ category: 'episode', content: 'ep2' }));
      await store.addMemory(makeMemoryInput({ category: 'episode', content: 'ep3' }));
      const episodes = await store.getRecentEpisodes(2);
      expect(episodes).toHaveLength(2);
      expect(episodes.every((e) => e.category === 'episode')).toBe(true);
    });

    it('searchMemories searches with relevance sort and limit', async () => {
      await store.addMemory(makeMemoryInput({ content: 'I love coffee in the morning', tags: ['coffee'] }));
      await store.addMemory(makeMemoryInput({ content: 'I drink tea at night', tags: ['tea'] }));
      await store.addMemory(makeMemoryInput({ content: 'Coffee is great', tags: ['coffee'] }));
      const results = await store.searchMemories('coffee', 1);
      expect(results).toHaveLength(1);
      expect(results[0].content.toLowerCase()).toContain('coffee');
    });
  });

  describe('Conversation Summaries', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('addConversationSummary creates summary with createdAt', async () => {
      const input = makeSummaryInput();
      const result = await store.addConversationSummary(input);
      expect(result.conversationId).toBe('conv-1');
      expect(result.createdAt).toBeDefined();
      expect(result.summary).toBe('We discussed TypeScript patterns.');
    });

    it('addConversationSummary also creates an episode memory', async () => {
      const input = makeSummaryInput();
      await store.addConversationSummary(input);
      const episodes = await store.queryMemories({ categories: ['episode'] });
      expect(episodes.length).toBeGreaterThanOrEqual(1);
      const ep = episodes.find((e) => e.conversationId === 'conv-1');
      expect(ep).toBeDefined();
      expect(ep!.content).toBe('We discussed TypeScript patterns.');
      expect(ep!.tags).toContain('conversation');
      expect(ep!.tags).toContain('episode');
    });

    it('getConversationSummary returns summary by conversationId', async () => {
      await store.addConversationSummary(makeSummaryInput());
      const summary = await store.getConversationSummary('conv-1');
      expect(summary).not.toBeNull();
      expect(summary!.conversationId).toBe('conv-1');
    });

    it('getConversationSummary returns null for non-existent', async () => {
      const result = await store.getConversationSummary('no-such-conv');
      expect(result).toBeNull();
    });

    it('getRecentSummaries returns sorted by endedAt descending, limited', async () => {
      await store.addConversationSummary(makeSummaryInput({
        conversationId: 'conv-old',
        endedAt: '2025-01-01T10:00:00.000Z',
      }));
      await store.addConversationSummary(makeSummaryInput({
        conversationId: 'conv-new',
        endedAt: '2025-06-01T10:00:00.000Z',
      }));
      await store.addConversationSummary(makeSummaryInput({
        conversationId: 'conv-mid',
        endedAt: '2025-03-01T10:00:00.000Z',
      }));
      const summaries = await store.getRecentSummaries(2);
      expect(summaries).toHaveLength(2);
      expect(summaries[0].conversationId).toBe('conv-new');
      expect(summaries[1].conversationId).toBe('conv-mid');
    });
  });

  describe('User Profile', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('getUserProfile builds profile from facts, preferences, instructions, goals, relationships', async () => {
      await store.addMemory(makeMemoryInput({ category: 'fact', content: 'Works at Acme', tags: ['job'] }));
      await store.addMemory(makeMemoryInput({ category: 'preference', content: 'Dark mode' }));
      await store.addMemory(makeMemoryInput({ category: 'instruction', content: 'Be concise' }));
      await store.addMemory(makeMemoryInput({ category: 'goal', content: 'Learn Rust' }));
      await store.addMemory(makeMemoryInput({ category: 'relationship', content: 'Knows Alice' }));
      const profile = await store.getUserProfile();
      expect(profile.userId).toBe('test-user');
      expect(profile.facts.length).toBeGreaterThanOrEqual(1);
      expect(profile.preferences).toContain('Dark mode');
      expect(profile.customInstructions).toContain('Be concise');
      expect(profile.goals).toContain('Learn Rust');
      expect(profile.relationships).toContain('Knows Alice');
    });

    it('getUserProfile extracts name from facts with name tag', async () => {
      await store.addMemory(makeMemoryInput({
        category: 'fact',
        content: 'Name is Alice',
        tags: ['name'],
        data: { name: 'Alice' },
      }));
      const profile = await store.getUserProfile();
      expect(profile.name).toBe('Alice');
    });

    it('getUserProfile calculates completeness percentage', async () => {
      const emptyProfile = await store.getUserProfile();
      expect(emptyProfile.completeness).toBe(0);
      await store.addMemory(makeMemoryInput({ category: 'fact', tags: ['name'], content: 'Alice' }));
      await store.addMemory(makeMemoryInput({ category: 'fact', tags: ['job'], content: 'Engineer' }));
      await store.addMemory(makeMemoryInput({ category: 'fact', tags: ['location'], content: 'NYC' }));
      await store.addMemory(makeMemoryInput({ category: 'preference', content: 'Dark mode' }));
      const fullProfile = await store.getUserProfile();
      expect(fullProfile.completeness).toBe(100);
    });

    it('getUserProfile counts total conversations from summaries', async () => {
      await store.addConversationSummary(makeSummaryInput({ conversationId: 'c1' }));
      await store.addConversationSummary(makeSummaryInput({ conversationId: 'c2' }));
      const profile = await store.getUserProfile();
      expect(profile.totalConversations).toBe(2);
    });
  });

  describe('Memory Management', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    describe('getStats', () => {
      it('returns correct counts by category, importance, source', async () => {
        await store.addMemory(makeMemoryInput({ category: 'fact', importance: 'high', source: 'user_stated' }));
        await store.addMemory(makeMemoryInput({ category: 'preference', importance: 'low', source: 'ai_inferred' }));
        await store.addMemory(makeMemoryInput({ category: 'fact', importance: 'high', source: 'user_stated' }));
        const stats = await store.getStats();
        expect(stats.totalMemories).toBe(3);
        expect(stats.byCategory.fact).toBe(2);
        expect(stats.byCategory.preference).toBe(1);
        expect(stats.byImportance.high).toBe(2);
        expect(stats.byImportance.low).toBe(1);
        expect(stats.bySource.user_stated).toBe(2);
        expect(stats.bySource.ai_inferred).toBe(1);
      });

      it('counts archived, estimates storage', async () => {
        await store.addMemory(makeMemoryInput({ content: 'active' }));
        const entry = await store.addMemory(makeMemoryInput({ content: 'will be archived' }));
        await store.archiveMemory(entry.id);
        const stats = await store.getStats();
        expect(stats.archivedCount).toBe(1);
        expect(stats.storageBytes).toBeGreaterThan(0);
      });
    });

    describe('applyRetentionPolicy', () => {
      it('deletes old archived memories', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { deleteArchivedAfterDays: 1 },
        });
        await s.initialize();
        const entry = await s.addMemory(makeMemoryInput({ category: 'episode' }));
        await s.archiveMemory(entry.id);
        const mem = await s.getMemory(entry.id);
        mem!.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = await s.applyRetentionPolicy();
        expect(result.deleted).toBeGreaterThanOrEqual(1);
      });

      it('auto-archives inactive memories', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { autoArchiveDays: 1 },
        });
        await s.initialize();
        const entry = await s.addMemory(makeMemoryInput({ category: 'episode' }));
        const mem = await s.getMemory(entry.id);
        mem!.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        mem!.lastAccessed = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = await s.applyRetentionPolicy();
        expect(result.archived).toBeGreaterThanOrEqual(1);
      });

      it('deletes old low-importance memories', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { lowImportanceMaxAgeDays: 1 },
        });
        await s.initialize();
        const entry = await s.addMemory(makeMemoryInput({ category: 'episode', importance: 'low' }));
        const mem = await s.getMemory(entry.id);
        mem!.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = await s.applyRetentionPolicy();
        expect(result.deleted).toBeGreaterThanOrEqual(1);
      });

      it('deletes old medium-importance memories', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { mediumImportanceMaxAgeDays: 1 },
        });
        await s.initialize();
        const entry = await s.addMemory(makeMemoryInput({ category: 'episode', importance: 'medium' }));
        const mem = await s.getMemory(entry.id);
        mem!.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = await s.applyRetentionPolicy();
        expect(result.deleted).toBeGreaterThanOrEqual(1);
      });

      it('skips exempt categories (fact, instruction, goal)', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { lowImportanceMaxAgeDays: 1 },
        });
        await s.initialize();
        const entry = await s.addMemory(makeMemoryInput({ category: 'fact', importance: 'low' }));
        const mem = await s.getMemory(entry.id);
        mem!.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
        const result = await s.applyRetentionPolicy();
        expect(result.deleted).toBe(0);
        const stillExists = await s.getMemory(entry.id);
        expect(stillExists).not.toBeNull();
      });

      it('enforces maxMemories limit', async () => {
        const s = new ConversationMemoryStore('test-user', {
          storageDir: '/tmp/test',
          retentionPolicy: { maxMemories: 2 },
        });
        await s.initialize();
        await s.addMemory(makeMemoryInput({ content: 'a', category: 'episode', importance: 'low' }));
        await s.addMemory(makeMemoryInput({ content: 'b', category: 'episode', importance: 'medium' }));
        await s.addMemory(makeMemoryInput({ content: 'c', category: 'episode', importance: 'high' }));
        const result = await s.applyRetentionPolicy();
        expect(result.deleted).toBeGreaterThanOrEqual(1);
        const stats = await s.getStats();
        expect(stats.totalMemories).toBeLessThanOrEqual(2);
      });
    });

    describe('clearAllMemories', () => {
      it('clears all data and saves', async () => {
        await store.addMemory(makeMemoryInput());
        await store.addConversationSummary(makeSummaryInput());
        await store.clearAllMemories();
        const memories = await store.queryMemories({ includeArchived: true });
        expect(memories).toHaveLength(0);
        const summary = await store.getConversationSummary('conv-1');
        expect(summary).toBeNull();
      });
    });

    describe('exportMemories', () => {
      it('returns all memories and summaries', async () => {
        await store.addMemory(makeMemoryInput({ content: 'mem1' }));
        await store.addMemory(makeMemoryInput({ content: 'mem2' }));
        await store.addConversationSummary(makeSummaryInput());
        const exported = await store.exportMemories();
        expect(exported.memories).toHaveLength(3);
        expect(exported.summaries).toHaveLength(1);
        expect(exported.exportedAt).toBeDefined();
      });
    });

    describe('importMemories', () => {
      it('imports new, skips existing duplicates', async () => {
        const existing = await store.addMemory(makeMemoryInput({ content: 'existing' }));
        const newMemory: MemoryEntry = {
          id: 'mem_imported-1',
          userId: 'test-user',
          category: 'fact',
          content: 'imported fact',
          importance: 'medium',
          source: 'imported',
          confidence: 1,
          tags: [],
          accessCount: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          archived: false,
        };
        const duplicateMemory: MemoryEntry = { ...existing };
        const newSummary: ConversationSummary = {
          conversationId: 'conv-imported',
          userId: 'test-user',
          summary: 'imported summary',
          topics: [],
          factsLearned: [],
          actionsTaken: [],
          sentiment: 'neutral',
          messageCount: 1,
          durationMinutes: 1,
          startedAt: '2025-01-01T00:00:00.000Z',
          endedAt: '2025-01-01T00:00:00.000Z',
          createdAt: '2025-01-01T00:00:00.000Z',
        };
        const result = await store.importMemories({
          memories: [newMemory, duplicateMemory],
          summaries: [newSummary],
        });
        expect(result.imported).toBe(1);
        expect(result.skipped).toBe(1);
        const mem = await store.getMemory('mem_imported-1');
        expect(mem).not.toBeNull();
        const summary = await store.getConversationSummary('conv-imported');
        expect(summary).not.toBeNull();
      });
    });
  });

  describe('Constants', () => {
    it('DEFAULT_RETENTION_POLICY has correct default values', () => {
      expect(DEFAULT_RETENTION_POLICY).toEqual({
        maxMemories: 10000,
        lowImportanceMaxAgeDays: 90,
        mediumImportanceMaxAgeDays: 365,
        autoArchiveDays: 180,
        deleteArchivedAfterDays: 365,
        exemptCategories: ['fact', 'instruction', 'goal'],
      });
    });

    it('IMPORTANCE_WEIGHTS: critical=4, high=3, medium=2, low=1', async () => {
      await store.initialize();
      await store.addMemory(makeMemoryInput({ importance: 'low' }));
      await store.addMemory(makeMemoryInput({ importance: 'medium' }));
      await store.addMemory(makeMemoryInput({ importance: 'high' }));
      await store.addMemory(makeMemoryInput({ importance: 'critical' }));
      const critical = await store.queryMemories({ minImportance: 'critical' });
      expect(critical).toHaveLength(1);
      const high = await store.queryMemories({ minImportance: 'high' });
      expect(high).toHaveLength(2);
      const medium = await store.queryMemories({ minImportance: 'medium' });
      expect(medium).toHaveLength(3);
      const low = await store.queryMemories({ minImportance: 'low' });
      expect(low).toHaveLength(4);
    });
  });

  describe('Factory functions', () => {
    it('createConversationMemoryStore creates store with options', () => {
      const s = createConversationMemoryStore('user-factory', {
        storageDir: '/custom',
        retentionPolicy: { maxMemories: 100 },
      });
      expect(s).toBeInstanceOf(ConversationMemoryStore);
      expect(s.getUserId()).toBe('user-factory');
      expect(s.getRetentionPolicy().maxMemories).toBe(100);
    });

    it('getMemoryStore returns cached store, creates if not exists', async () => {
      const store1 = await getMemoryStore('cached-user-test');
      const store2 = await getMemoryStore('cached-user-test');
      expect(store1).toBe(store2);
      expect(store1.getUserId()).toBe('cached-user-test');
    });
  });
});
