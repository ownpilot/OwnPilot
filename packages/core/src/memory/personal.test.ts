import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonalMemoryStore, createPersonalMemoryStore } from './personal.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:crypto
vi.mock('node:crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `pd-uuid-${++counter}`,
  };
});

// ---------------------------------------------------------------------------
// PersonalMemoryStore
// ---------------------------------------------------------------------------
describe('PersonalMemoryStore', () => {
  let store: PersonalMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PersonalMemoryStore('user-1', '/tmp/test-personal');
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  describe('initialize', () => {
    it('initializes successfully', async () => {
      await store.initialize();
      // No error means success
    });

    it('only initializes once', async () => {
      const fsMock = await import('node:fs/promises');
      await store.initialize();
      await store.initialize();
      expect(fsMock.mkdir).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // set / get
  // -------------------------------------------------------------------------
  describe('set', () => {
    it('creates a new entry', async () => {
      const entry = await store.set('identity', 'name', 'Alice');
      expect(entry.id).toMatch(/^pd_/);
      expect(entry.userId).toBe('user-1');
      expect(entry.category).toBe('identity');
      expect(entry.key).toBe('name');
      expect(entry.value).toBe('Alice');
      expect(entry.confidence).toBe(0.9); // default
      expect(entry.source).toBe('user_stated'); // default
    });

    it('upserts existing entry', async () => {
      const first = await store.set('identity', 'name', 'Alice');
      const second = await store.set('identity', 'name', 'Bob');
      expect(second.id).toBe(first.id);
      expect(second.value).toBe('Bob');
    });

    it('accepts options', async () => {
      const entry = await store.set('identity', 'age', '30', {
        confidence: 0.7,
        source: 'ai_inferred',
        sensitive: true,
        data: { parsed: 30 },
      });
      expect(entry.confidence).toBe(0.7);
      expect(entry.source).toBe('ai_inferred');
      expect(entry.sensitive).toBe(true);
      expect(entry.data?.parsed).toBe(30);
    });
  });

  describe('get', () => {
    it('returns null for non-existent entry', async () => {
      const result = await store.get('identity', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns entry and updates lastAccessed', async () => {
      await store.set('identity', 'name', 'Alice');
      const entry = await store.get('identity', 'name');
      expect(entry).not.toBeNull();
      expect(entry!.value).toBe('Alice');
      expect(entry!.lastAccessed).toBeDefined();
    });

    it('returns null for expired entry and removes it', async () => {
      await store.set('context', 'temp', 'value', {
        expiresAt: '2020-01-01T00:00:00Z',
      });
      const entry = await store.get('context', 'temp');
      expect(entry).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getCategory
  // -------------------------------------------------------------------------
  describe('getCategory', () => {
    it('returns entries for category sorted by confidence', async () => {
      await store.set('hobbies', 'h1', 'reading', { confidence: 0.7 });
      await store.set('hobbies', 'h2', 'cycling', { confidence: 0.9 });

      const entries = await store.getCategory('hobbies');
      expect(entries).toHaveLength(2);
      expect(entries[0]!.value).toBe('cycling'); // higher confidence first
    });

    it('excludes expired entries', async () => {
      await store.set('hobbies', 'h1', 'reading');
      await store.set('hobbies', 'h2', 'expired', { expiresAt: '2020-01-01T00:00:00Z' });

      const entries = await store.getCategory('hobbies');
      expect(entries).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('deletes existing entry', async () => {
      await store.set('identity', 'name', 'Alice');
      expect(await store.delete('identity', 'name')).toBe(true);
      expect(await store.get('identity', 'name')).toBeNull();
    });

    it('returns false for non-existent entry', async () => {
      expect(await store.delete('identity', 'nonexistent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  describe('search', () => {
    beforeEach(async () => {
      await store.set('identity', 'name', 'Alice');
      await store.set('hobbies', 'h1', 'reading books');
      await store.set('food', 'favorite', 'pizza');
    });

    it('searches by key and value', async () => {
      const results = await store.search('Alice');
      expect(results).toHaveLength(1);
      expect(results[0]!.value).toBe('Alice');
    });

    it('searches by value substring', async () => {
      const results = await store.search('book');
      expect(results).toHaveLength(1);
    });

    it('filters by categories', async () => {
      const results = await store.search('a', ['identity']);
      expect(results.every(r => r.category === 'identity')).toBe(true);
    });

    it('excludes expired entries', async () => {
      await store.set('context', 'temp', 'search me', { expiresAt: '2020-01-01T00:00:00Z' });
      const results = await store.search('search me');
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getProfile
  // -------------------------------------------------------------------------
  describe('getProfile', () => {
    it('builds comprehensive profile from entries', async () => {
      await store.set('identity', 'name', 'Alice');
      await store.set('identity', 'age', '30');
      await store.set('location', 'home_city', 'New York');
      await store.set('occupation', 'developer', 'Software Engineer', { data: { company: 'Acme' } });
      await store.set('hobbies', 'h1', 'reading');
      await store.set('communication', 'style', 'casual');
      await store.set('goals_short', 'g1', 'learn Rust');
      await store.set('ai_preferences', 'autonomy', 'high');

      const profile = await store.getProfile();
      expect(profile.userId).toBe('user-1');
      expect(profile.identity.name).toBe('Alice');
      expect(profile.identity.age).toBe(30);
      expect(profile.location.home?.city).toBe('New York');
      expect(profile.work.occupation).toBe('Software Engineer');
      expect(profile.work.company).toBe('Acme');
      expect(profile.lifestyle.hobbies).toContain('reading');
      expect(profile.communication.preferredStyle).toBe('casual');
      expect(profile.goals.shortTerm).toContain('learn Rust');
      expect(profile.aiPreferences.autonomyLevel).toBe('high');
    });

    it('calculates completeness', async () => {
      const emptyProfile = await store.getProfile();
      expect(emptyProfile.meta.completeness).toBe(0);

      await store.set('identity', 'name', 'Alice');
      await store.set('location', 'home_city', 'NYC');
      await store.set('occupation', 'dev', 'Engineer');
      await store.set('hobbies', 'h1', 'reading');
      await store.set('communication', 'style', 'casual');
      await store.set('communication', 'language', 'English');
      await store.set('goals_short', 'g1', 'learn');
      await store.set('ai_preferences', 'autonomy', 'high');

      const fullProfile = await store.getProfile();
      expect(fullProfile.meta.completeness).toBe(100);
    });

    it('handles food entries', async () => {
      await store.set('food', 'favorite', 'pizza');
      await store.set('food', 'disliked', 'olives');
      await store.set('diet', 'restriction', 'vegetarian');
      await store.set('diet', 'allergy', 'peanuts');

      const profile = await store.getProfile();
      expect(profile.lifestyle.eatingHabits?.favoriteFoods).toContain('pizza');
      expect(profile.lifestyle.eatingHabits?.dislikedFoods).toContain('olives');
      expect(profile.lifestyle.eatingHabits?.dietaryRestrictions).toContain('vegetarian');
      expect(profile.lifestyle.eatingHabits?.allergies).toContain('peanuts');
    });

    it('handles social entries', async () => {
      await store.set('family', 'member1', 'John', { data: { relation: 'brother' } });
      await store.set('pets', 'pet1', 'Luna', { data: { type: 'cat', breed: 'Persian' } });

      const profile = await store.getProfile();
      expect(profile.social.family).toHaveLength(1);
      expect(profile.social.family![0]!.name).toBe('John');
      expect(profile.social.family![0]!.relation).toBe('brother');
      expect(profile.social.pets).toHaveLength(1);
      expect(profile.social.pets![0]!.name).toBe('Luna');
    });

    it('handles AI preference entries', async () => {
      await store.set('instructions', 'i1', 'Always use TypeScript');
      await store.set('boundaries', 'b1', 'No financial advice');

      const profile = await store.getProfile();
      expect(profile.aiPreferences.customInstructions).toContain('Always use TypeScript');
      expect(profile.aiPreferences.boundaries).toContain('No financial advice');
    });

    it('handles identity sub-fields', async () => {
      await store.set('identity', 'nickname', 'Al');
      await store.set('identity', 'birthday', '1990-05-15');
      await store.set('identity', 'gender', 'female');
      await store.set('identity', 'nationality', 'American');
      await store.set('identity', 'languages', 'English', { data: { languages: ['English', 'Spanish'] } });

      const profile = await store.getProfile();
      expect(profile.identity.nickname).toBe('Al');
      expect(profile.identity.birthday).toBe('1990-05-15');
      expect(profile.identity.gender).toBe('female');
      expect(profile.identity.nationality).toBe('American');
      expect(profile.identity.languages).toEqual(['English', 'Spanish']);
    });

    it('handles location entries', async () => {
      await store.set('location', 'home_country', 'USA');
      await store.set('location', 'current', 'San Francisco');
      await store.set('timezone', 'tz', 'America/New_York');

      const profile = await store.getProfile();
      expect(profile.location.home?.country).toBe('USA');
      expect(profile.location.current).toBe('San Francisco');
      expect(profile.location.home?.timezone).toBe('America/New_York');
    });

    it('handles communication entries', async () => {
      await store.set('communication', 'verbosity', 'concise');
      await store.set('communication', 'language', 'English');
      await store.set('communication', 'emoji', 'true');
      await store.set('communication', 'humor', 'true');

      const profile = await store.getProfile();
      expect(profile.communication.verbosity).toBe('concise');
      expect(profile.communication.primaryLanguage).toBe('English');
      expect(profile.communication.emoji).toBe(true);
      expect(profile.communication.humor).toBe(true);
    });

    it('handles skills and goals entries', async () => {
      await store.set('skills', 's1', 'TypeScript');
      await store.set('goals_medium', 'gm1', 'Get promoted');
      await store.set('goals_long', 'gl1', 'Start a company');

      const profile = await store.getProfile();
      expect(profile.work.skills).toContain('TypeScript');
      expect(profile.goals.mediumTerm).toContain('Get promoted');
      expect(profile.goals.longTerm).toContain('Start a company');
    });

    it('handles AI preference booleans', async () => {
      await store.set('ai_preferences', 'proactive', 'true');
      await store.set('ai_preferences', 'reminders', 'true');
      await store.set('ai_preferences', 'suggestions', 'true');

      const profile = await store.getProfile();
      expect(profile.aiPreferences.proactivity).toBe(true);
      expect(profile.aiPreferences.reminders).toBe(true);
      expect(profile.aiPreferences.suggestions).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getProfileSummary
  // -------------------------------------------------------------------------
  describe('getProfileSummary', () => {
    it('returns formatted summary string', async () => {
      await store.set('identity', 'name', 'Alice');
      await store.set('location', 'home_city', 'NYC');
      await store.set('communication', 'style', 'casual');

      const summary = await store.getProfileSummary();
      expect(summary).toContain('Alice');
      expect(summary).toContain('NYC');
      expect(summary).toContain('casual');
    });

    it('returns empty string for empty profile', async () => {
      const summary = await store.getProfileSummary();
      expect(summary).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Import / Export / Clear
  // -------------------------------------------------------------------------
  describe('importData', () => {
    it('imports bulk entries', async () => {
      const count = await store.importData([
        { category: 'identity', key: 'name', value: 'Alice' },
        { category: 'hobbies', key: 'h1', value: 'reading' },
      ]);
      expect(count).toBe(2);

      const entry = await store.get('identity', 'name');
      expect(entry!.value).toBe('Alice');
    });
  });

  describe('exportData', () => {
    it('exports all entries', async () => {
      await store.set('identity', 'name', 'Alice');
      await store.set('hobbies', 'h1', 'reading');

      const entries = await store.exportData();
      expect(entries).toHaveLength(2);
    });
  });

  describe('clearAll', () => {
    it('clears all data', async () => {
      await store.set('identity', 'name', 'Alice');
      await store.clearAll();

      const entries = await store.exportData();
      expect(entries).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
describe('createPersonalMemoryStore', () => {
  it('creates store instance', () => {
    const store = createPersonalMemoryStore('test-user');
    expect(store).toBeInstanceOf(PersonalMemoryStore);
  });
});
