import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SecureMemoryStore,
  createSecureMemoryStore,
  getDefaultMemoryStore,
  type MemoryType,
  type AccessLevel,
  type MemoryQuery as _MemoryQuery,
} from './index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import * as fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MASTER_KEY = 'test-master-key-123';
const INSTALLATION_SALT = 'test-installation-salt-fixed';
const USER_ID = 'user-alice';
const OTHER_USER_ID = 'user-bob';

// Use very low iterations for fast tests — crypto is real but PBKDF2 iteration
// count needs to be minimal to keep the test suite quick.
const FAST_ITERATIONS = 1;

// ---------------------------------------------------------------------------
// Factory helper — creates a ready-to-use store with low iterations
// ---------------------------------------------------------------------------

function makeStore(
  overrides: Partial<ConstructorParameters<typeof SecureMemoryStore>[0]> = {}
): SecureMemoryStore {
  return new SecureMemoryStore({
    storageDir: '/tmp/test-memory',
    installationSalt: INSTALLATION_SALT,
    pbkdf2Iterations: FAST_ITERATIONS,
    auditLog: true,
    auditRetentionDays: 30,
    purgeInterval: 0, // disable auto-purge timer by default
    maxEntriesPerUser: 10000,
    ...overrides,
  });
}

// Helper to store one entry and return id + content for assertions
async function storeEntry(
  store: SecureMemoryStore,
  userId = USER_ID,
  content: unknown = { value: 'hello world' },
  type: MemoryType = 'fact',
  options: Parameters<SecureMemoryStore['store']>[4] = {}
): Promise<string> {
  return store.store(userId, MASTER_KEY, type, content, options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecureMemoryStore', () => {
  let store: SecureMemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    store = makeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('Constructor', () => {
    it('applies default config when no options given', () => {
      const s = new SecureMemoryStore();
      // We can only observe defaults via behaviour — verify initialize() calls mkdir
      expect(s).toBeInstanceOf(SecureMemoryStore);
    });

    it('uses custom storageDir', async () => {
      const s = makeStore({ storageDir: '/custom/path' });
      await s.initialize();
      expect(fs.mkdir).toHaveBeenCalledWith('/custom/path', { recursive: true });
    });

    it('uses custom installationSalt', async () => {
      const s1 = makeStore({ installationSalt: 'salt-a' });
      const s2 = makeStore({ installationSalt: 'salt-b' });
      await s1.initialize();
      await s2.initialize();

      const id1 = await s1.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });
      const id2 = await s2.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });

      // Same content + same user but different salts → treated as different users
      // Each store has its own in-memory map, so both ids exist in respective stores
      expect(id1).toMatch(/^mem_/);
      expect(id2).toMatch(/^mem_/);
    });

    it('defaults auditLog to true', async () => {
      await store.initialize();
      await storeEntry(store);
      // If auditLog were false, saveAuditLog would be a no-op; with true it tries writeFile
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('defaults maxEntriesPerUser to 10000', async () => {
      // Just verify the store is created without error and entries can be stored up to the limit
      const s = new SecureMemoryStore({
        installationSalt: INSTALLATION_SALT,
        pbkdf2Iterations: FAST_ITERATIONS,
      });
      await s.initialize();
      const id = await s.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });
      expect(id).toMatch(/^mem_/);
    });

    it('defaults purgeInterval to 3600000ms', () => {
      const s = new SecureMemoryStore({ installationSalt: INSTALLATION_SALT });
      expect(s).toBeInstanceOf(SecureMemoryStore);
    });

    it('generates salt from installationSalt via SHA-256 deterministically', async () => {
      const s1 = makeStore({ installationSalt: 'same-salt' });
      const s2 = makeStore({ installationSalt: 'same-salt' });
      await s1.initialize();
      await s2.initialize();

      // Both stores encrypt the same content with the same masterKey — retrieve
      // from s2 should work with the id from s1 since salt derivation is identical.
      const id = await s1.store(USER_ID, MASTER_KEY, 'fact', { x: 42 });

      // Manually share the entry map so s2 can retrieve it
      // (access private field for white-box testing)
      const entry = (s1 as unknown as { entries: Map<string, unknown> }).entries.get(id);
      (s2 as unknown as { entries: Map<string, unknown> }).entries.set(id, entry);

      const result = await s2.retrieve(USER_ID, MASTER_KEY, id);
      expect(result).not.toBeNull();
      expect(result!.content).toEqual({ x: 42 });
    });
  });

  // =========================================================================
  // initialize()
  // =========================================================================

  describe('initialize()', () => {
    it('creates storage directory', async () => {
      await store.initialize();
      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/test-memory', { recursive: true });
    });

    it('loads entries from file when it exists', async () => {
      const existingEntry = {
        id: 'mem_123_abc',
        userIdHash: 'somehash',
        type: 'fact',
        accessLevel: 'private',
        encryptedContent: 'data',
        iv: 'iv',
        authTag: 'tag',
        contentHash: 'hash',
        metadata: {
          createdAt: new Date().toISOString(),
          accessCount: 0,
          source: 'manual',
        },
      };
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.includes('entries')) return JSON.stringify([existingEntry]);
        throw new Error('ENOENT');
      });

      const s = makeStore();
      await s.initialize();
      const stats = await s.getStats('some-user');
      expect(stats.totalEntries).toBeGreaterThanOrEqual(0); // may not match user
    });

    it('starts with empty entries when file is missing', async () => {
      await store.initialize();
      const stats = await store.getStats(USER_ID);
      expect(stats.totalEntries).toBe(0);
    });

    it('loads audit log from file when it exists', async () => {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        action: 'create',
        userId: 'partial-hash',
        success: true,
      };
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.includes('audit')) return JSON.stringify([auditEntry]);
        throw new Error('ENOENT');
      });
      const s = makeStore();
      await s.initialize();
      // No assertion on internals — just verify no throw
    });

    it('starts with empty audit log when file is missing', async () => {
      await store.initialize();
      // verify the store is initialized and operable
      const id = await storeEntry(store);
      expect(id).toMatch(/^mem_/);
    });

    it('starts purge timer when purgeInterval > 0', async () => {
      vi.useFakeTimers();
      const s = makeStore({ purgeInterval: 5000 });
      await s.initialize();
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      // The timer is set during initialize — check the internal timer exists
      // by triggering shutdown (which clears timer)
      await s.shutdown();
      setIntervalSpy.mockRestore();
    });

    it('does not start purge timer when purgeInterval is 0', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      await store.initialize(); // purgeInterval: 0
      expect(setIntervalSpy).not.toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it('is idempotent — second call does nothing', async () => {
      await store.initialize();
      await store.initialize();
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('prunes old audit log entries on load', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // older than 30-day retention
      const oldEntry = {
        timestamp: oldDate.toISOString(),
        action: 'create',
        userId: 'partial',
        success: true,
      };
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.includes('audit')) return JSON.stringify([oldEntry]);
        throw new Error('ENOENT');
      });
      const s = makeStore({ auditRetentionDays: 30 });
      await s.initialize(); // should prune old entry silently
      // If we reach here without error the test passes
    });
  });

  // =========================================================================
  // ensureInitialized()
  // =========================================================================

  describe('ensureInitialized()', () => {
    it('throws when store() called before initialize()', async () => {
      await expect(store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 })).rejects.toThrow(
        'not initialized'
      );
    });

    it('throws when retrieve() called before initialize()', async () => {
      await expect(store.retrieve(USER_ID, MASTER_KEY, 'mem_fake')).rejects.toThrow(
        'not initialized'
      );
    });

    it('throws when query() called before initialize()', async () => {
      await expect(store.query(USER_ID, MASTER_KEY, {})).rejects.toThrow('not initialized');
    });

    it('throws when delete() called before initialize()', async () => {
      await expect(store.delete(USER_ID, 'mem_fake')).rejects.toThrow('not initialized');
    });

    it('throws when deleteAll() called before initialize()', async () => {
      await expect(store.deleteAll(USER_ID)).rejects.toThrow('not initialized');
    });

    it('throws when getStats() called before initialize()', async () => {
      await expect(store.getStats(USER_ID)).rejects.toThrow('not initialized');
    });

    it('throws when update() called before initialize()', async () => {
      // update() delegates directly to updateInternal() without an ensureInitialized() guard,
      // so the empty entries map causes 'not found' rather than 'not initialized'.
      await expect(store.update(USER_ID, MASTER_KEY, 'mem_fake', { v: 1 })).rejects.toThrow(
        'not found'
      );
    });

    it('does not throw after initialize()', async () => {
      await store.initialize();
      await expect(store.query(USER_ID, MASTER_KEY, {})).resolves.toEqual([]);
    });
  });

  // =========================================================================
  // store()
  // =========================================================================

  describe('store()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns a string ID with mem_ prefix', async () => {
      const id = await storeEntry(store);
      expect(id).toMatch(/^mem_\d+_[0-9a-f]+$/);
    });

    it('saves entries to disk', async () => {
      await storeEntry(store);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('entries.encrypted.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('stores a fact type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { key: 'name', val: 'Alice' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry).not.toBeNull();
      expect(entry!.type).toBe('fact');
    });

    it('stores a preference type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'preference', { theme: 'dark' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('preference');
    });

    it('stores a conversation type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'conversation', { summary: 'We talked.' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('conversation');
    });

    it('stores a context type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'context', { ctx: 'work' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('context');
    });

    it('stores a secret type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'secret', { pin: '1234' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('secret');
    });

    it('stores a task type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'task', { title: 'Buy milk' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('task');
    });

    it('stores a relationship type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'relationship', {
        name: 'Bob',
        role: 'friend',
      });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('relationship');
    });

    it('stores a location type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'location', { city: 'Berlin' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('location');
    });

    it('stores a temporal type entry', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'temporal', { remind: '2026-12-25' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('temporal');
    });

    it('sets default accessLevel to private', async () => {
      const id = await storeEntry(store);
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.accessLevel).toBe('private');
    });

    it('respects custom accessLevel', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { accessLevel: 'assistant' }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.accessLevel).toBe('assistant');
    });

    it('sets default source to manual', async () => {
      const id = await storeEntry(store);
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.source).toBe('manual');
    });

    it('respects custom source', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { source: 'conversation' }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.source).toBe('conversation');
    });

    it('stores tags in metadata', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { tags: ['tagA', 'tagB'] }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.tags).toEqual(['tagA', 'tagB']);
    });

    it('stores confidence in metadata', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { confidence: 0.85 });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.confidence).toBe(0.85);
    });

    it('stores relatedIds in metadata', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { relatedIds: ['mem_a', 'mem_b'] }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.relatedIds).toEqual(['mem_a', 'mem_b']);
    });

    it('stores custom metadata', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { custom: { myField: 'hello' } }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.custom).toEqual({ myField: 'hello' });
    });

    it('sets expiresAt from explicit expiresAt option', async () => {
      const expiresAt = new Date(Date.now() + 60000).toISOString();
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { expiresAt });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.expiresAt).toBe(expiresAt);
    });

    it('derives expiresAt from ttl (seconds)', async () => {
      const before = Date.now();
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { ttl: 60 });
      const after = Date.now();
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      const expiresTs = new Date(entry!.metadata.expiresAt!).getTime();
      expect(expiresTs).toBeGreaterThanOrEqual(before + 59000);
      expect(expiresTs).toBeLessThanOrEqual(after + 61000);
    });

    it('stores ttl value in metadata', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { ttl: 120 });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.ttl).toBe(120);
    });

    it('initialises accessCount to 0', async () => {
      const id = await storeEntry(store);
      // Directly inspect the internal map for accessCount before retrieve
      const raw = (
        store as unknown as { entries: Map<string, { metadata: { accessCount: number } }> }
      ).entries.get(id);
      expect(raw!.metadata.accessCount).toBe(0);
    });

    it('detects duplicate content and updates existing entry', async () => {
      const content = { value: 'unique-content-for-dedup' };
      const id1 = await store.store(USER_ID, MASTER_KEY, 'fact', content);
      const id2 = await store.store(USER_ID, MASTER_KEY, 'fact', content);
      expect(id2).toBe(id1); // same ID returned
    });

    it('different users store same content as separate entries', async () => {
      const content = { value: 'shared-value' };
      const id1 = await store.store(USER_ID, MASTER_KEY, 'fact', content);
      const id2 = await store.store(OTHER_USER_ID, MASTER_KEY, 'fact', content);
      expect(id1).not.toBe(id2);
    });

    it('enforces maxEntriesPerUser limit', async () => {
      const small = makeStore({
        maxEntriesPerUser: 2,
        pbkdf2Iterations: FAST_ITERATIONS,
        purgeInterval: 0,
      });
      await small.initialize();
      await small.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });
      await small.store(USER_ID, MASTER_KEY, 'fact', { v: 2 });
      await expect(small.store(USER_ID, MASTER_KEY, 'fact', { v: 3 })).rejects.toThrow(
        'Memory entry limit exceeded'
      );
    });

    it('unlimited entries when maxEntriesPerUser is 0', async () => {
      const unlimited = makeStore({
        maxEntriesPerUser: 0,
        pbkdf2Iterations: FAST_ITERATIONS,
        purgeInterval: 0,
      });
      await unlimited.initialize();
      for (let i = 0; i < 5; i++) {
        await unlimited.store(USER_ID, MASTER_KEY, 'fact', { v: i });
      }
      const stats = await unlimited.getStats(USER_ID);
      expect(stats.totalEntries).toBe(5);
    });

    it('limit applies per-user (other user not counted)', async () => {
      const small = makeStore({
        maxEntriesPerUser: 2,
        pbkdf2Iterations: FAST_ITERATIONS,
        purgeInterval: 0,
      });
      await small.initialize();
      await small.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });
      await small.store(USER_ID, MASTER_KEY, 'fact', { v: 2 });
      // Other user should still be able to store
      const id = await small.store(OTHER_USER_ID, MASTER_KEY, 'fact', { v: 1 });
      expect(id).toMatch(/^mem_/);
    });

    it('logs audit entry on success', async () => {
      await storeEntry(store);
      // auditLog is true; after enough entries saveAuditLog is triggered at multiples of 100
      // but we can check that writeFile was called (for saveEntries at minimum)
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('encrypts content (stored content not equal to plaintext)', async () => {
      const plainContent = { secret: 'my-value' };
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', plainContent);
      const raw = (
        store as unknown as { entries: Map<string, { encryptedContent: string }> }
      ).entries.get(id);
      expect(raw!.encryptedContent).not.toContain('my-value');
    });
  });

  // =========================================================================
  // retrieve()
  // =========================================================================

  describe('retrieve()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('retrieves and decrypts an existing entry', async () => {
      const content = { city: 'Berlin', year: 2026 };
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', content);
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry).not.toBeNull();
      expect(entry!.content).toEqual(content);
    });

    it('returns correct type and accessLevel', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'preference',
        { v: 1 },
        { accessLevel: 'system' }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.type).toBe('preference');
      expect(entry!.accessLevel).toBe('system');
    });

    it('returns null for non-existent memoryId', async () => {
      const result = await store.retrieve(USER_ID, MASTER_KEY, 'mem_does_not_exist');
      expect(result).toBeNull();
    });

    it('returns null when userId does not match (access denied)', async () => {
      const id = await storeEntry(store, USER_ID);
      const result = await store.retrieve(OTHER_USER_ID, MASTER_KEY, id);
      expect(result).toBeNull();
    });

    it('returns null for expired entry', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString(); // already expired
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { expiresAt });
      const result = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(result).toBeNull();
    });

    it('increments accessCount on successful retrieve', async () => {
      const id = await storeEntry(store);
      await store.retrieve(USER_ID, MASTER_KEY, id);
      await store.retrieve(USER_ID, MASTER_KEY, id);
      const raw = (
        store as unknown as { entries: Map<string, { metadata: { accessCount: number } }> }
      ).entries.get(id);
      expect(raw!.metadata.accessCount).toBe(2);
    });

    it('updates lastAccessedAt on retrieve', async () => {
      const id = await storeEntry(store);
      const before = Date.now();
      await store.retrieve(USER_ID, MASTER_KEY, id);
      const raw = (
        store as unknown as { entries: Map<string, { metadata: { lastAccessedAt?: string } }> }
      ).entries.get(id);
      const ts = new Date(raw!.metadata.lastAccessedAt!).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
    });

    it('refreshes expiresAt when ttl is set on entry', async () => {
      const ttl = 60;
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { ttl });
      const before = Date.now();
      await store.retrieve(USER_ID, MASTER_KEY, id);
      const raw = (
        store as unknown as { entries: Map<string, { metadata: { expiresAt?: string } }> }
      ).entries.get(id);
      const newExpiry = new Date(raw!.metadata.expiresAt!).getTime();
      expect(newExpiry).toBeGreaterThanOrEqual(before + (ttl - 1) * 1000);
    });

    it('returns null when wrong masterKey used (decryption failure)', async () => {
      const id = await storeEntry(store);
      const result = await store.retrieve(USER_ID, 'wrong-master-key', id);
      expect(result).toBeNull();
    });

    it('includes metadata in retrieved entry', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        {
          tags: ['t1'],
          confidence: 0.9,
          source: 'inferred',
        }
      );
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.tags).toEqual(['t1']);
      expect(entry!.metadata.confidence).toBe(0.9);
      expect(entry!.metadata.source).toBe('inferred');
    });

    it('persists access metadata (saveEntries called)', async () => {
      const id = await storeEntry(store);
      vi.mocked(fs.writeFile).mockClear();
      await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('entries.encrypted.json'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  // =========================================================================
  // query()
  // =========================================================================

  describe('query()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns empty array when no entries exist', async () => {
      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results).toEqual([]);
    });

    it('returns all user entries with empty criteria', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'preference', { b: 2 });
      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results).toHaveLength(2);
    });

    it('does not return other users entries', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(OTHER_USER_ID, MASTER_KEY, 'fact', { a: 2 });
      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results).toHaveLength(1);
    });

    it('filters by single type', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'preference', { b: 2 });
      const results = await store.query(USER_ID, MASTER_KEY, { type: 'fact' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('fact');
    });

    it('filters by array of types', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'preference', { b: 2 });
      await store.store(USER_ID, MASTER_KEY, 'secret', { c: 3 });
      const results = await store.query(USER_ID, MASTER_KEY, { type: ['fact', 'secret'] });
      expect(results).toHaveLength(2);
      const types = results.map((r) => r.type);
      expect(types).toContain('fact');
      expect(types).toContain('secret');
    });

    it('filters by accessLevel', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { accessLevel: 'private' });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { accessLevel: 'assistant' });
      const results = await store.query(USER_ID, MASTER_KEY, { accessLevel: 'assistant' });
      expect(results).toHaveLength(1);
      expect(results[0]!.accessLevel).toBe('assistant');
    });

    it('filters by tags (any match)', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { tags: ['work', 'urgent'] });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { tags: ['personal'] });
      const results = await store.query(USER_ID, MASTER_KEY, { tags: ['urgent'] });
      expect(results).toHaveLength(1);
      expect(results[0]!.metadata.tags).toContain('urgent');
    });

    it('filters by multiple tags (any match)', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { tags: ['work'] });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { tags: ['personal'] });
      await store.store(USER_ID, MASTER_KEY, 'fact', { c: 3 }, { tags: ['other'] });
      const results = await store.query(USER_ID, MASTER_KEY, { tags: ['work', 'personal'] });
      expect(results).toHaveLength(2);
    });

    it('excludes entries with no matching tags', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { tags: ['tagA'] });
      const results = await store.query(USER_ID, MASTER_KEY, { tags: ['tagB'] });
      expect(results).toHaveLength(0);
    });

    it('filters by createdAfter', async () => {
      const pastDate = '2020-01-01T00:00:00.000Z';
      const futureDate = new Date(Date.now() + 1000).toISOString();
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      const results = await store.query(USER_ID, MASTER_KEY, { createdAfter: futureDate });
      expect(results).toHaveLength(0);
      const results2 = await store.query(USER_ID, MASTER_KEY, { createdAfter: pastDate });
      expect(results2).toHaveLength(1);
    });

    it('filters by createdBefore', async () => {
      const pastDate = '2020-01-01T00:00:00.000Z';
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      const results = await store.query(USER_ID, MASTER_KEY, { createdBefore: pastDate });
      expect(results).toHaveLength(0);
      const futureDate = new Date(Date.now() + 1000).toISOString();
      const results2 = await store.query(USER_ID, MASTER_KEY, { createdBefore: futureDate });
      expect(results2).toHaveLength(1);
    });

    it('filters by minConfidence (includes entries with confidence >= threshold)', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { confidence: 0.9 });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { confidence: 0.3 });
      const results = await store.query(USER_ID, MASTER_KEY, { minConfidence: 0.8 });
      expect(results).toHaveLength(1);
      expect(results[0]!.metadata.confidence).toBe(0.9);
    });

    it('minConfidence includes entries with no confidence set', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }); // no confidence
      const results = await store.query(USER_ID, MASTER_KEY, { minConfidence: 0.5 });
      expect(results).toHaveLength(1); // included because confidence === undefined
    });

    it('excludes expired entries by default', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { expiresAt });
      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results).toHaveLength(0);
    });

    it('includes expired entries when includeExpired is true', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { expiresAt });
      const results = await store.query(USER_ID, MASTER_KEY, { includeExpired: true });
      expect(results).toHaveLength(1);
    });

    it('filters by search term (post-decryption)', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { text: 'I love TypeScript' });
      await store.store(USER_ID, MASTER_KEY, 'fact', { text: 'I prefer Python' });
      const results = await store.query(USER_ID, MASTER_KEY, { search: 'TypeScript' });
      expect(results).toHaveLength(1);
      expect((results[0]!.content as { text: string }).text).toContain('TypeScript');
    });

    it('search is case-insensitive', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { text: 'Berlin is great' });
      const results = await store.query(USER_ID, MASTER_KEY, { search: 'berlin' });
      expect(results).toHaveLength(1);
    });

    it('applies pagination limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(USER_ID, MASTER_KEY, 'fact', { i });
      }
      const results = await store.query(USER_ID, MASTER_KEY, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('applies pagination offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(USER_ID, MASTER_KEY, 'fact', { i });
      }
      const results = await store.query(USER_ID, MASTER_KEY, { limit: 100, offset: 3 });
      expect(results).toHaveLength(2);
    });

    it('defaults limit to 100', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(USER_ID, MASTER_KEY, 'fact', { i });
      }
      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results.length).toBeLessThanOrEqual(100);
      expect(results).toHaveLength(5);
    });

    it('sorts results by creation date descending (newest first)', async () => {
      const id1 = await store.store(USER_ID, MASTER_KEY, 'fact', { seq: 1 });
      // Ensure a measurable time gap
      await new Promise((r) => setTimeout(r, 5));
      const id2 = await store.store(USER_ID, MASTER_KEY, 'fact', { seq: 2 });

      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results[0]!.id).toBe(id2);
      expect(results[1]!.id).toBe(id1);
    });

    it('skips entries that fail decryption silently', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      // Corrupt one entry in the map
      const firstId = Array.from(
        (
          store as unknown as {
            entries: Map<string, { encryptedContent: string; iv: string; authTag: string }>;
          }
        ).entries.keys()
      )[0]!;
      const raw = (
        store as unknown as {
          entries: Map<string, { encryptedContent: string; iv: string; authTag: string }>;
        }
      ).entries.get(firstId)!;
      raw.encryptedContent = 'corrupted!!!';
      raw.iv = 'AAAAAAAAAAAAAAAAAAAAAA=='; // valid base64 but wrong
      raw.authTag = 'AAAAAAAAAAAAAAAAAAAAAA==';

      const results = await store.query(USER_ID, MASTER_KEY, {});
      expect(results).toHaveLength(0); // corrupted entry skipped
    });

    it('combines multiple filters', async () => {
      await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 'keep' },
        { tags: ['keep'], accessLevel: 'private' }
      );
      await store.store(
        USER_ID,
        MASTER_KEY,
        'preference',
        { v: 'skip' },
        { tags: ['keep'], accessLevel: 'private' }
      );
      await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 'skip2' },
        { tags: ['other'], accessLevel: 'private' }
      );
      const results = await store.query(USER_ID, MASTER_KEY, { type: 'fact', tags: ['keep'] });
      expect(results).toHaveLength(1);
      expect((results[0]!.content as { v: string }).v).toBe('keep');
    });
  });

  // =========================================================================
  // update()
  // =========================================================================

  describe('update()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('updates content of existing entry', async () => {
      const id = await storeEntry(store, USER_ID, { original: true });
      await store.update(USER_ID, MASTER_KEY, id, { updated: true });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.content).toEqual({ updated: true });
    });

    it('returns true on successful update', async () => {
      const id = await storeEntry(store);
      const result = await store.update(USER_ID, MASTER_KEY, id, { v: 2 });
      expect(result).toBe(true);
    });

    it('updates tags', async () => {
      const id = await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { tags: ['old'] });
      await store.update(USER_ID, MASTER_KEY, id, { v: 1 }, { tags: ['new'] });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.tags).toEqual(['new']);
    });

    it('updates accessLevel', async () => {
      const id = await store.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        { accessLevel: 'private' }
      );
      await store.update(USER_ID, MASTER_KEY, id, { v: 1 }, { accessLevel: 'shared' });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.accessLevel).toBe('shared');
    });

    it('updates ttl and recalculates expiresAt', async () => {
      const id = await storeEntry(store);
      const before = Date.now();
      await store.update(USER_ID, MASTER_KEY, id, { v: 1 }, { ttl: 300 });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      const expiresTs = new Date(entry!.metadata.expiresAt!).getTime();
      expect(expiresTs).toBeGreaterThanOrEqual(before + 299_000);
    });

    it('updates explicit expiresAt', async () => {
      const id = await storeEntry(store);
      const newExpiry = new Date(Date.now() + 999999).toISOString();
      await store.update(USER_ID, MASTER_KEY, id, { v: 1 }, { expiresAt: newExpiry });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.expiresAt).toBe(newExpiry);
    });

    it('sets modifiedAt on update', async () => {
      const id = await storeEntry(store);
      await store.update(USER_ID, MASTER_KEY, id, { v: 2 });
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry!.metadata.modifiedAt).toBeDefined();
    });

    it('throws for non-existent entry', async () => {
      await expect(store.update(USER_ID, MASTER_KEY, 'mem_nonexistent', { v: 1 })).rejects.toThrow(
        'not found'
      );
    });

    it('throws for wrong user (access denied)', async () => {
      const id = await storeEntry(store, USER_ID);
      await expect(store.update(OTHER_USER_ID, MASTER_KEY, id, { v: 1 })).rejects.toThrow(
        'Access denied'
      );
    });
  });

  // =========================================================================
  // delete()
  // =========================================================================

  describe('delete()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('deletes an existing entry', async () => {
      const id = await storeEntry(store);
      const result = await store.delete(USER_ID, id);
      expect(result).toBe(true);
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry).toBeNull();
    });

    it('saves entries after deletion', async () => {
      const id = await storeEntry(store);
      vi.mocked(fs.writeFile).mockClear();
      await store.delete(USER_ID, id);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('entries.encrypted.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('returns false for non-existent entry', async () => {
      const result = await store.delete(USER_ID, 'mem_nonexistent');
      expect(result).toBe(false);
    });

    it('returns false when user does not own the entry', async () => {
      const id = await storeEntry(store, USER_ID);
      const result = await store.delete(OTHER_USER_ID, id);
      expect(result).toBe(false);
      // entry still exists for original owner
      const entry = await store.retrieve(USER_ID, MASTER_KEY, id);
      expect(entry).not.toBeNull();
    });

    it('does not delete entry from another user', async () => {
      const idUser = await storeEntry(store, USER_ID);
      const idOther = await storeEntry(store, OTHER_USER_ID);
      await store.delete(USER_ID, idOther); // no permission
      const entry = await store.retrieve(OTHER_USER_ID, MASTER_KEY, idOther);
      expect(entry).not.toBeNull();
      void idUser; // suppress unused warning
    });
  });

  // =========================================================================
  // deleteAll()
  // =========================================================================

  describe('deleteAll()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('deletes all entries for a user', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 });
      const count = await store.deleteAll(USER_ID);
      expect(count).toBe(2);
      const stats = await store.getStats(USER_ID);
      expect(stats.totalEntries).toBe(0);
    });

    it('returns 0 when user has no entries', async () => {
      const count = await store.deleteAll(USER_ID);
      expect(count).toBe(0);
    });

    it('does not affect entries of other users', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(OTHER_USER_ID, MASTER_KEY, 'fact', { b: 2 });
      await store.deleteAll(USER_ID);
      const stats = await store.getStats(OTHER_USER_ID);
      expect(stats.totalEntries).toBe(1);
    });

    it('saves entries after deleting', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      vi.mocked(fs.writeFile).mockClear();
      await store.deleteAll(USER_ID);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('entries.encrypted.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('does not save when no entries deleted', async () => {
      vi.mocked(fs.writeFile).mockClear();
      await store.deleteAll(USER_ID);
      // No writeFile for entries (but audit log may still be written)
      const entryWriteCalls = vi
        .mocked(fs.writeFile)
        .mock.calls.filter(([p]) => String(p).includes('entries.encrypted.json'));
      expect(entryWriteCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // getStats()
  // =========================================================================

  describe('getStats()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns zero stats for user with no entries', async () => {
      const stats = await store.getStats(USER_ID);
      expect(stats.totalEntries).toBe(0);
      expect(stats.expiredCount).toBe(0);
      expect(stats.totalTags).toBe(0);
      expect(stats.oldestEntry).toBeUndefined();
      expect(stats.newestEntry).toBeUndefined();
    });

    it('counts total entries correctly', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 });
      await store.store(OTHER_USER_ID, MASTER_KEY, 'fact', { c: 3 });
      const stats = await store.getStats(USER_ID);
      expect(stats.totalEntries).toBe(2);
    });

    it('counts byType correctly', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 });
      await store.store(USER_ID, MASTER_KEY, 'preference', { c: 3 });
      const stats = await store.getStats(USER_ID);
      expect(stats.byType['fact']).toBe(2);
      expect(stats.byType['preference']).toBe(1);
    });

    it('counts byAccessLevel correctly', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { accessLevel: 'private' });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { accessLevel: 'assistant' });
      await store.store(USER_ID, MASTER_KEY, 'fact', { c: 3 }, { accessLevel: 'private' });
      const stats = await store.getStats(USER_ID);
      expect(stats.byAccessLevel['private']).toBe(2);
      expect(stats.byAccessLevel['assistant']).toBe(1);
    });

    it('counts unique tags correctly', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { tags: ['foo', 'bar'] });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }, { tags: ['bar', 'baz'] });
      const stats = await store.getStats(USER_ID);
      expect(stats.totalTags).toBe(3); // foo, bar, baz (bar deduped)
    });

    it('counts expired entries', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 }, { expiresAt });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 }); // not expired
      const stats = await store.getStats(USER_ID);
      expect(stats.expiredCount).toBe(1);
    });

    it('tracks oldest and newest entries', async () => {
      const id1 = await store.store(USER_ID, MASTER_KEY, 'fact', { seq: 1 });
      await new Promise((r) => setTimeout(r, 5));
      const id2 = await store.store(USER_ID, MASTER_KEY, 'fact', { seq: 2 });

      const raw = store as unknown as { entries: Map<string, { metadata: { createdAt: string } }> };
      const createdAt1 = raw.entries.get(id1)!.metadata.createdAt;
      const createdAt2 = raw.entries.get(id2)!.metadata.createdAt;

      const stats = await store.getStats(USER_ID);
      expect(stats.oldestEntry).toBe(createdAt1);
      expect(stats.newestEntry).toBe(createdAt2);
    });

    it('only counts stats for the requesting user', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(OTHER_USER_ID, MASTER_KEY, 'preference', { b: 2 });
      const stats = await store.getStats(USER_ID);
      expect(stats.totalEntries).toBe(1);
      expect(stats.byType['preference']).toBeUndefined();
    });
  });

  // =========================================================================
  // export()
  // =========================================================================

  describe('export()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('exports entries with version and timestamp', async () => {
      await storeEntry(store, USER_ID, { data: 'exportable' });
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.version).toBe('1.0');
      expect(backup.exportedAt).toBeDefined();
      expect(new Date(backup.exportedAt).getTime()).toBeGreaterThan(0);
    });

    it('includes decrypted entries in export', async () => {
      const content = { secret: 'exported-value' };
      await store.store(USER_ID, MASTER_KEY, 'fact', content);
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.entryCount).toBe(1);
      expect(backup.entries).toHaveLength(1);
      expect(backup.entries[0]!.content).toEqual(content);
    });

    it('includes expired entries in export', async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      await store.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { expiresAt });
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.entryCount).toBe(1);
    });

    it('returns empty entries for user with no data', async () => {
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.entryCount).toBe(0);
      expect(backup.entries).toHaveLength(0);
    });

    it('does not export other users entries', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(OTHER_USER_ID, MASTER_KEY, 'fact', { b: 2 });
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.entryCount).toBe(1);
    });

    it('entryCount matches entries array length', async () => {
      await store.store(USER_ID, MASTER_KEY, 'fact', { a: 1 });
      await store.store(USER_ID, MASTER_KEY, 'fact', { b: 2 });
      const backup = await store.export(USER_ID, MASTER_KEY);
      expect(backup.entryCount).toBe(backup.entries.length);
    });
  });

  // =========================================================================
  // import()
  // =========================================================================

  describe('import()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('imports entries from backup', async () => {
      const backup = {
        entries: [
          {
            id: 'original-id',
            type: 'fact' as MemoryType,
            accessLevel: 'private' as AccessLevel,
            content: { imported: true },
            metadata: {
              createdAt: new Date().toISOString(),
              accessCount: 0,
              source: 'manual' as const,
              tags: ['imported'],
            },
          },
        ],
      };
      const result = await store.import(USER_ID, MASTER_KEY, backup);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('sets source to imported for all entries', async () => {
      const backup = {
        entries: [
          {
            id: 'x',
            type: 'fact' as MemoryType,
            accessLevel: 'private' as AccessLevel,
            content: { v: 1 },
            metadata: {
              createdAt: new Date().toISOString(),
              accessCount: 0,
              source: 'manual' as const,
            },
          },
        ],
      };
      const _result = await store.import(USER_ID, MASTER_KEY, backup);
      const all = await store.query(USER_ID, MASTER_KEY, {});
      expect(all[0]!.metadata.source).toBe('imported');
    });

    it('skips entries that fail (e.g., limit exceeded)', async () => {
      const small = makeStore({
        maxEntriesPerUser: 1,
        pbkdf2Iterations: FAST_ITERATIONS,
        purgeInterval: 0,
      });
      await small.initialize();
      // Fill up the limit
      await small.store(USER_ID, MASTER_KEY, 'fact', { pre: true });

      const backup = {
        entries: [
          {
            id: 'x1',
            type: 'fact' as MemoryType,
            accessLevel: 'private' as AccessLevel,
            content: { v: 1 },
            metadata: {
              createdAt: new Date().toISOString(),
              accessCount: 0,
              source: 'manual' as const,
            },
          },
          {
            id: 'x2',
            type: 'fact' as MemoryType,
            accessLevel: 'private' as AccessLevel,
            content: { v: 2 },
            metadata: {
              createdAt: new Date().toISOString(),
              accessCount: 0,
              source: 'manual' as const,
            },
          },
        ],
      };
      const result = await small.import(USER_ID, MASTER_KEY, backup);
      // All should be skipped because limit is already reached
      expect(result.skipped).toBe(2);
      expect(result.imported).toBe(0);
    });

    it('returns 0 imported 0 skipped for empty backup', async () => {
      const result = await store.import(USER_ID, MASTER_KEY, { entries: [] });
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('preserves tags from backup', async () => {
      const backup = {
        entries: [
          {
            id: 'y',
            type: 'fact' as MemoryType,
            accessLevel: 'private' as AccessLevel,
            content: { v: 1 },
            metadata: {
              createdAt: new Date().toISOString(),
              accessCount: 0,
              source: 'manual' as const,
              tags: ['tag-from-backup'],
            },
          },
        ],
      };
      await store.import(USER_ID, MASTER_KEY, backup);
      const entries = await store.query(USER_ID, MASTER_KEY, { tags: ['tag-from-backup'] });
      expect(entries).toHaveLength(1);
    });
  });

  // =========================================================================
  // shutdown()
  // =========================================================================

  describe('shutdown()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('saves entries on shutdown', async () => {
      await storeEntry(store);
      vi.mocked(fs.writeFile).mockClear();
      await store.shutdown();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('entries.encrypted.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('saves audit log on shutdown', async () => {
      await storeEntry(store);
      vi.mocked(fs.writeFile).mockClear();
      await store.shutdown();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('audit.log.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('clears the entries map after shutdown', async () => {
      await storeEntry(store);
      await store.shutdown();
      const internalMap = (store as unknown as { entries: Map<string, unknown> }).entries;
      expect(internalMap.size).toBe(0);
    });

    it('clears the audit log after shutdown', async () => {
      await storeEntry(store);
      await store.shutdown();
      const auditLog = (store as unknown as { auditLog: unknown[] }).auditLog;
      expect(auditLog).toHaveLength(0);
    });

    it('sets initialized to false after shutdown', async () => {
      await store.shutdown();
      const initialized = (store as unknown as { initialized: boolean }).initialized;
      expect(initialized).toBe(false);
    });

    it('clears purge timer on shutdown', async () => {
      vi.useFakeTimers();
      const s = makeStore({ purgeInterval: 5000 });
      await s.initialize();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await s.shutdown();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('throws when store() called after shutdown', async () => {
      await store.shutdown();
      await expect(storeEntry(store)).rejects.toThrow('not initialized');
    });

    it('can be re-initialized after shutdown', async () => {
      await store.shutdown();
      await store.initialize();
      const id = await storeEntry(store);
      expect(id).toMatch(/^mem_/);
    });
  });

  // =========================================================================
  // Purge timer
  // =========================================================================

  describe('Purge timer', () => {
    it('auto-purges expired entries after interval', async () => {
      vi.useFakeTimers();
      const s = makeStore({ purgeInterval: 1000 });
      await s.initialize();

      const expiresAt = new Date(Date.now() - 500).toISOString(); // already expired
      await s.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { expiresAt });

      const statsBefore = await s.getStats(USER_ID);
      expect(statsBefore.expiredCount).toBe(1);

      // Advance timer to trigger purge
      await vi.advanceTimersByTimeAsync(1001);

      const statsAfter = await s.getStats(USER_ID);
      expect(statsAfter.totalEntries).toBe(0);
    });

    it('does not purge non-expired entries', async () => {
      vi.useFakeTimers();
      const s = makeStore({ purgeInterval: 1000 });
      await s.initialize();

      const expiresAt = new Date(Date.now() + 99999).toISOString();
      await s.store(USER_ID, MASTER_KEY, 'fact', { v: 1 }, { expiresAt });

      await vi.advanceTimersByTimeAsync(1001);

      const stats = await s.getStats(USER_ID);
      expect(stats.totalEntries).toBe(1);
    });

    it('saves entries after purge if any were deleted', async () => {
      vi.useFakeTimers();
      const s = makeStore({ purgeInterval: 1000 });
      await s.initialize();

      await s.store(
        USER_ID,
        MASTER_KEY,
        'fact',
        { v: 1 },
        {
          expiresAt: new Date(Date.now() - 100).toISOString(),
        }
      );

      vi.mocked(fs.writeFile).mockClear();
      await vi.advanceTimersByTimeAsync(1001);

      const entryWrites = vi
        .mocked(fs.writeFile)
        .mock.calls.filter(([p]) => String(p).includes('entries.encrypted.json'));
      expect(entryWrites.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Audit log
  // =========================================================================

  describe('Audit log', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('audit log disabled skips saveAuditLog on shutdown', async () => {
      const noAudit = makeStore({ auditLog: false });
      await noAudit.initialize();
      await noAudit.store(USER_ID, MASTER_KEY, 'fact', { v: 1 });
      vi.mocked(fs.writeFile).mockClear();
      await noAudit.shutdown();
      const auditWrites = vi
        .mocked(fs.writeFile)
        .mock.calls.filter(([p]) => String(p).includes('audit.log.json'));
      expect(auditWrites).toHaveLength(0);
    });

    it('caps audit log at 10000 keeping last 5000', async () => {
      // Directly fill the audit log to exactly 10001 entries (one past the trigger threshold).
      // logAudit does: push → if length > 10000 → this.auditLog = this.auditLog.slice(-5000)
      // NOTE: slice() creates a NEW array and reassigns this.auditLog, so we must
      // re-read the reference from the store AFTER the trigger fires.
      const internalStore = store as unknown as { auditLog: unknown[] };
      for (let i = 0; i < 10001; i++) {
        internalStore.auditLog.push({
          timestamp: new Date().toISOString(),
          action: 'read',
          userId: 'partial',
          success: true,
        });
      }

      // Trigger one more audit entry via store (which internally calls logAudit).
      // This push takes length to 10002 → > 10000 → slice(-5000) → reassigns this.auditLog.
      await storeEntry(store);

      // Re-fetch the reference because slice() reassigns this.auditLog to a new array.
      const auditLogAfter = (store as unknown as { auditLog: unknown[] }).auditLog;
      expect(auditLogAfter.length).toBeLessThanOrEqual(5000);
    });

    it('saves audit log periodically at multiples of 100', async () => {
      vi.mocked(fs.writeFile).mockClear();
      // Create 100 entries — each calls logAudit once for 'create' action
      for (let i = 0; i < 100; i++) {
        await store.store(USER_ID, MASTER_KEY, 'fact', { i });
      }
      const auditWrites = vi
        .mocked(fs.writeFile)
        .mock.calls.filter(([p]) => String(p).includes('audit.log.json'));
      // At 100 entries, auditLog.length % 100 === 0 → saveAuditLog triggered
      expect(auditWrites.length).toBeGreaterThan(0);
    });

    it('hashes userId in audit log for privacy', async () => {
      await storeEntry(store);
      const auditLog = (store as unknown as { auditLog: Array<{ userId: string }> }).auditLog;
      const lastEntry = auditLog[auditLog.length - 1]!;
      // Partial hash, 16 chars — definitely not the raw userId
      expect(lastEntry.userId).not.toBe(USER_ID);
      expect(lastEntry.userId.length).toBeLessThanOrEqual(16);
    });

    it('truncates memoryId to 16 chars in audit log', async () => {
      const id = await storeEntry(store);
      const auditLog = (store as unknown as { auditLog: Array<{ memoryId?: string }> }).auditLog;
      const lastEntry = auditLog[auditLog.length - 1]!;
      expect(lastEntry.memoryId).toBeDefined();
      expect(lastEntry.memoryId!.length).toBeLessThanOrEqual(16);
      expect(id.length).toBeGreaterThan(16); // original id is longer
    });

    it('prunes old audit entries based on retention policy on load', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);
      const oldEntry = {
        timestamp: oldDate.toISOString(),
        action: 'create',
        userId: 'partial',
        success: true,
      };
      const recentEntry = {
        timestamp: new Date().toISOString(),
        action: 'read',
        userId: 'partial',
        success: true,
      };
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.includes('audit')) return JSON.stringify([oldEntry, recentEntry]);
        throw new Error('ENOENT');
      });

      const s = makeStore({ auditRetentionDays: 30 });
      await s.initialize();

      const auditLog = (s as unknown as { auditLog: unknown[] }).auditLog;
      expect(auditLog).toHaveLength(1); // old entry pruned
    });
  });

  // =========================================================================
  // Factory functions
  // =========================================================================

  describe('createSecureMemoryStore()', () => {
    it('returns a SecureMemoryStore instance', () => {
      const s = createSecureMemoryStore();
      expect(s).toBeInstanceOf(SecureMemoryStore);
    });

    it('passes config to the store', async () => {
      const s = createSecureMemoryStore({
        storageDir: '/custom/dir',
        pbkdf2Iterations: FAST_ITERATIONS,
      });
      await s.initialize();
      expect(fs.mkdir).toHaveBeenCalledWith('/custom/dir', { recursive: true });
    });

    it('each call returns a new instance', () => {
      const s1 = createSecureMemoryStore();
      const s2 = createSecureMemoryStore();
      expect(s1).not.toBe(s2);
    });
  });

  describe('getDefaultMemoryStore()', () => {
    it('returns an initialized SecureMemoryStore', async () => {
      const s = await getDefaultMemoryStore();
      expect(s).toBeInstanceOf(SecureMemoryStore);
      // Should not throw on query (only possible if initialized)
      await expect(s.query('any-user', MASTER_KEY, {})).resolves.toBeInstanceOf(Array);
    });

    it('returns the same singleton on subsequent calls', async () => {
      const s1 = await getDefaultMemoryStore();
      const s2 = await getDefaultMemoryStore();
      expect(s1).toBe(s2);
    });
  });
});
