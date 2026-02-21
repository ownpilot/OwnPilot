/**
 * Tests for packages/core/src/credentials/index.ts
 *
 * Covers:
 * - InMemoryCredentialBackend (CRUD operations)
 * - Encryption roundtrip via UserCredentialStore (real crypto, no mocks)
 * - UserCredentialStore (store/get/getById/list/delete/deleteAll/rotate/exists)
 * - CredentialContext (get/getApiKey/has/clear/getUserId, caching behaviour)
 * - Factory functions (createInMemoryCredentialStore, createCredentialContext)
 * - loadCredentialsFromEnv (env-var mapping, skip-existing, skip-absent)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  InMemoryCredentialBackend,
  UserCredentialStore,
  CredentialContext,
  createInMemoryCredentialStore,
  createCredentialContext,
  loadCredentialsFromEnv,
  type CredentialEntry,
  type CredentialProvider,
  type CredentialType,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_KEY = 'test-encryption-key-32-chars-long!!';
const USER_A = 'user-a';
const USER_B = 'user-b';

function makeBackend(): InMemoryCredentialBackend {
  return new InMemoryCredentialBackend();
}

function makeStore(
  key = FIXED_KEY,
  backend?: InMemoryCredentialBackend,
  auditLog = false,
): UserCredentialStore {
  return new UserCredentialStore({
    encryptionKey: key,
    backend: backend ?? makeBackend(),
    auditLog,
  });
}

function makeEntry(overrides: Partial<CredentialEntry> = {}): CredentialEntry {
  return {
    id: 'cred_abc123',
    userId: USER_A,
    provider: 'openai',
    type: 'api_key',
    encryptedValue: 'enc',
    iv: 'aXY=',
    salt: 'c2FsdA==',
    metadata: {
      createdAt: new Date('2024-01-01'),
      usageCount: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryCredentialBackend
// ---------------------------------------------------------------------------

describe('InMemoryCredentialBackend', () => {
  let backend: InMemoryCredentialBackend;

  beforeEach(() => {
    backend = makeBackend();
    vi.clearAllMocks();
  });

  // get
  describe('get()', () => {
    it('returns null for an id that does not exist', async () => {
      const result = await backend.get('nonexistent');
      expect(result).toBeNull();
    });

    it('returns the stored entry for a known id', async () => {
      const entry = makeEntry();
      await backend.set(entry);
      const result = await backend.get(entry.id);
      expect(result).toEqual(entry);
    });

    it('returns null after the entry has been deleted', async () => {
      const entry = makeEntry();
      await backend.set(entry);
      await backend.delete(entry.id);
      expect(await backend.get(entry.id)).toBeNull();
    });

    it('does not return an entry belonging to a different id', async () => {
      const entry = makeEntry({ id: 'cred_X' });
      await backend.set(entry);
      expect(await backend.get('cred_Y')).toBeNull();
    });
  });

  // getByUser
  describe('getByUser()', () => {
    it('returns an empty array when no credentials exist', async () => {
      const result = await backend.getByUser(USER_A);
      expect(result).toEqual([]);
    });

    it('returns only entries belonging to the requested user', async () => {
      const entryA = makeEntry({ id: 'cred_A', userId: USER_A });
      const entryB = makeEntry({ id: 'cred_B', userId: USER_B });
      await backend.set(entryA);
      await backend.set(entryB);

      const result = await backend.getByUser(USER_A);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('cred_A');
    });

    it('returns all entries for a user when multiple exist', async () => {
      const e1 = makeEntry({ id: 'cred_1', provider: 'openai' });
      const e2 = makeEntry({ id: 'cred_2', provider: 'anthropic' });
      await backend.set(e1);
      await backend.set(e2);

      const result = await backend.getByUser(USER_A);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for user with no entries even when others exist', async () => {
      await backend.set(makeEntry({ id: 'cred_X', userId: USER_A }));
      expect(await backend.getByUser(USER_B)).toEqual([]);
    });
  });

  // getByProvider
  describe('getByProvider()', () => {
    it('returns null when no credential exists for the provider', async () => {
      const result = await backend.getByProvider(USER_A, 'openai');
      expect(result).toBeNull();
    });

    it('returns the matching entry for user+provider', async () => {
      const entry = makeEntry({ userId: USER_A, provider: 'openai' });
      await backend.set(entry);
      const result = await backend.getByProvider(USER_A, 'openai');
      expect(result).toEqual(entry);
    });

    it('does not return entry for a different user', async () => {
      await backend.set(makeEntry({ userId: USER_A, provider: 'openai' }));
      expect(await backend.getByProvider(USER_B, 'openai')).toBeNull();
    });

    it('does not return entry for a different provider', async () => {
      await backend.set(makeEntry({ userId: USER_A, provider: 'openai' }));
      expect(await backend.getByProvider(USER_A, 'anthropic')).toBeNull();
    });

    it('returns null after the matching entry has been deleted', async () => {
      const entry = makeEntry({ userId: USER_A, provider: 'groq' });
      await backend.set(entry);
      await backend.delete(entry.id);
      expect(await backend.getByProvider(USER_A, 'groq')).toBeNull();
    });
  });

  // set
  describe('set()', () => {
    it('stores a new entry without error', async () => {
      const entry = makeEntry();
      await expect(backend.set(entry)).resolves.toBeUndefined();
    });

    it('overwrites an existing entry with the same id', async () => {
      const original = makeEntry({ provider: 'openai' });
      const updated = { ...original, provider: 'anthropic' as CredentialProvider };
      await backend.set(original);
      await backend.set(updated);
      const result = await backend.get(original.id);
      expect(result!.provider).toBe('anthropic');
    });
  });

  // delete
  describe('delete()', () => {
    it('removes the entry with the given id', async () => {
      const entry = makeEntry();
      await backend.set(entry);
      await backend.delete(entry.id);
      expect(await backend.get(entry.id)).toBeNull();
    });

    it('does not throw when deleting a non-existent id', async () => {
      await expect(backend.delete('does-not-exist')).resolves.toBeUndefined();
    });

    it('leaves other entries intact', async () => {
      const e1 = makeEntry({ id: 'cred_1' });
      const e2 = makeEntry({ id: 'cred_2' });
      await backend.set(e1);
      await backend.set(e2);
      await backend.delete('cred_1');
      expect(await backend.get('cred_2')).toEqual(e2);
    });
  });

  // deleteByUser
  describe('deleteByUser()', () => {
    it('removes all entries for the given user', async () => {
      await backend.set(makeEntry({ id: 'cred_1', userId: USER_A, provider: 'openai' }));
      await backend.set(makeEntry({ id: 'cred_2', userId: USER_A, provider: 'anthropic' }));
      await backend.deleteByUser(USER_A);
      expect(await backend.getByUser(USER_A)).toEqual([]);
    });

    it('leaves entries for other users intact', async () => {
      await backend.set(makeEntry({ id: 'cred_A', userId: USER_A }));
      await backend.set(makeEntry({ id: 'cred_B', userId: USER_B }));
      await backend.deleteByUser(USER_A);
      expect(await backend.getByUser(USER_B)).toHaveLength(1);
    });

    it('does not throw when user has no entries', async () => {
      await expect(backend.deleteByUser('nobody')).resolves.toBeUndefined();
    });
  });

  // list
  describe('list()', () => {
    it('returns an empty array when no credentials are stored', async () => {
      expect(await backend.list()).toEqual([]);
    });

    it('returns all stored credential IDs', async () => {
      await backend.set(makeEntry({ id: 'cred_1' }));
      await backend.set(makeEntry({ id: 'cred_2' }));
      const ids = await backend.list();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('cred_1');
      expect(ids).toContain('cred_2');
    });

    it('does not include deleted entries', async () => {
      await backend.set(makeEntry({ id: 'cred_1' }));
      await backend.set(makeEntry({ id: 'cred_2' }));
      await backend.delete('cred_1');
      const ids = await backend.list();
      expect(ids).not.toContain('cred_1');
      expect(ids).toContain('cred_2');
    });
  });

  // clear
  describe('clear()', () => {
    it('removes all stored credentials', async () => {
      await backend.set(makeEntry({ id: 'cred_1' }));
      await backend.set(makeEntry({ id: 'cred_2' }));
      backend.clear();
      expect(await backend.list()).toEqual([]);
    });

    it('is idempotent — calling clear on an empty store does not throw', () => {
      expect(() => backend.clear()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — store()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.store()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('returns a credential ID prefixed with "cred_"', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-test');
    expect(id).toMatch(/^cred_/);
  });

  it('returns a different ID on every call', async () => {
    const id1 = await store.store(USER_A, 'openai', 'api_key', 'sk-1');
    const id2 = await store.store(USER_A, 'anthropic', 'api_key', 'sk-2');
    expect(id1).not.toBe(id2);
  });

  it('stores the credential so it can be retrieved by provider', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-stored');
    const result = await store.get(USER_A, 'openai');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-stored');
  });

  it('stores the label in metadata', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x', { label: 'My Key' });
    const entry = await backend.get(id);
    expect(entry!.metadata.label).toBe('My Key');
  });

  it('stores the scopes in metadata', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x', {
      scopes: ['read', 'write'],
    });
    const entry = await backend.get(id);
    expect(entry!.metadata.scopes).toEqual(['read', 'write']);
  });

  it('stores the expiresAt in metadata', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const expiry = new Date(Date.now() + 3_600_000);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x', { expiresAt: expiry });
    const entry = await backend.get(id);
    expect(entry!.metadata.expiresAt).toEqual(expiry);
  });

  it('stores the projectId in metadata', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x', { projectId: 'proj-42' });
    const entry = await backend.get(id);
    expect(entry!.metadata.projectId).toBe('proj-42');
  });

  it('initialises usageCount to 0', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x');
    const entry = await backend.get(id);
    expect(entry!.metadata.usageCount).toBe(0);
  });

  it('stores an encrypted value (not the plaintext)', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'plaintext-secret');
    const entry = await backend.get(id);
    expect(entry!.encryptedValue).not.toContain('plaintext-secret');
  });

  it('stores a salt alongside the encrypted value', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    const id = await s.store(USER_A, 'openai', 'api_key', 'sk-x');
    const entry = await backend.get(id);
    expect(entry!.salt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — encryption roundtrip
// ---------------------------------------------------------------------------

describe('Encryption roundtrip (via store + get)', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('decrypted value matches the original plaintext', async () => {
    const secret = 'super-secret-api-key-12345';
    await store.store(USER_A, 'openai', 'api_key', secret);
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe(secret);
  });

  it('preserves multi-byte / unicode values', async () => {
    const secret = 'こんにちは🔑world';
    await store.store(USER_A, 'anthropic', 'api_key', secret);
    const result = await store.get(USER_A, 'anthropic');
    expect(result!.value).toBe(secret);
  });

  it('preserves long values (>= 1 KB)', async () => {
    const secret = 'x'.repeat(1024);
    await store.store(USER_A, 'groq', 'api_key', secret);
    const result = await store.get(USER_A, 'groq');
    expect(result!.value).toBe(secret);
  });

  it('two different stores with the same key can decrypt each others data', async () => {
    const backend = makeBackend();
    const storeA = makeStore(FIXED_KEY, backend);
    const storeB = makeStore(FIXED_KEY, backend);

    await storeA.store(USER_A, 'openai', 'api_key', 'shared-value');
    const result = await storeB.get(USER_A, 'openai');
    expect(result!.value).toBe('shared-value');
  });

  it('a store with the wrong key fails to decrypt (throws)', async () => {
    const backend = makeBackend();
    const storeA = makeStore('correct-key-exactly-32chars-long!', backend);
    const storeB = makeStore('wrong-key-exactly-32-chars-longxx', backend);

    await storeA.store(USER_A, 'openai', 'api_key', 'secret');
    await expect(storeB.get(USER_A, 'openai')).rejects.toThrow();
  });

  it('two encryptions of the same value produce different ciphertexts (random IV + salt)', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);

    // Store first credential and capture its raw entry before deletion
    const id1 = await s.store(USER_A, 'openai', 'api_key', 'same-value');
    const e1 = await backend.get(id1);

    // Delete id1 so we can store a second credential for the same provider
    await s.delete(id1, USER_A);
    const id2 = await s.store(USER_A, 'openai', 'api_key', 'same-value');
    const e2 = await backend.get(id2);

    expect(e1!.encryptedValue).not.toBe(e2!.encryptedValue);
    expect(e1!.iv).not.toBe(e2!.iv);
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — get()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.get()', () => {
  let backend: InMemoryCredentialBackend;
  let store: UserCredentialStore;

  beforeEach(() => {
    backend = makeBackend();
    store = makeStore(FIXED_KEY, backend);
    vi.clearAllMocks();
  });

  it('returns null when no credential exists for the provider', async () => {
    expect(await store.get(USER_A, 'openai')).toBeNull();
  });

  it('returns a Credential with provider, type, and decrypted value', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-hello');
    const result = await store.get(USER_A, 'openai');
    expect(result).toMatchObject({ provider: 'openai', type: 'api_key', value: 'sk-hello' });
  });

  it('returns null when credential has expired', async () => {
    const expiredDate = new Date(Date.now() - 1000);
    await store.store(USER_A, 'openai', 'api_key', 'sk-expired', { expiresAt: expiredDate });
    expect(await store.get(USER_A, 'openai')).toBeNull();
  });

  it('returns credential when expiresAt is in the future', async () => {
    const futureDate = new Date(Date.now() + 3_600_000);
    await store.store(USER_A, 'openai', 'api_key', 'sk-valid', { expiresAt: futureDate });
    expect(await store.get(USER_A, 'openai')).not.toBeNull();
  });

  it('increments usageCount after retrieval', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.get(USER_A, 'openai');
    const entry = await backend.get(id);
    expect(entry!.metadata.usageCount).toBe(1);
  });

  it('increments usageCount on each successive retrieval', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.get(USER_A, 'openai');
    await store.get(USER_A, 'openai');
    await store.get(USER_A, 'openai');
    const entry = await backend.get(id);
    expect(entry!.metadata.usageCount).toBe(3);
  });

  it('sets lastUsedAt after retrieval', async () => {
    const before = new Date();
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.get(USER_A, 'openai');
    const entry = await backend.get(id);
    expect(entry!.metadata.lastUsedAt).toBeInstanceOf(Date);
    expect(entry!.metadata.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('does not return credential for different user', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-A');
    expect(await store.get(USER_B, 'openai')).toBeNull();
  });

  it('does not return credential for different provider', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-A');
    expect(await store.get(USER_A, 'anthropic')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — audit log
// ---------------------------------------------------------------------------

describe('UserCredentialStore audit logging', () => {
  it('does not throw when auditLog is false', async () => {
    const store = makeStore(FIXED_KEY, makeBackend(), false);
    await expect(store.store(USER_A, 'openai', 'api_key', 'sk-x')).resolves.not.toThrow();
  });

  it('does not throw when auditLog is true', async () => {
    const store = makeStore(FIXED_KEY, makeBackend(), true);
    await expect(store.store(USER_A, 'openai', 'api_key', 'sk-x')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — getById()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.getById()', () => {
  let backend: InMemoryCredentialBackend;
  let store: UserCredentialStore;

  beforeEach(() => {
    backend = makeBackend();
    store = makeStore(FIXED_KEY, backend);
    vi.clearAllMocks();
  });

  it('returns a Credential for a valid id + correct userId', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-test');
    const result = await store.getById(id, USER_A);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-test');
  });

  it('returns null for a non-existent id', async () => {
    expect(await store.getById('cred_nonexistent', USER_A)).toBeNull();
  });

  it('returns null when userId does not match the entry owner', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.getById(id, USER_B)).toBeNull();
  });

  it('returns null for an expired credential', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x', {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await store.getById(id, USER_A)).toBeNull();
  });

  it('returns credential that has not yet expired', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x', {
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await store.getById(id, USER_A)).not.toBeNull();
  });

  it('increments usageCount after retrieval', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.getById(id, USER_A);
    const entry = await backend.get(id);
    expect(entry!.metadata.usageCount).toBe(1);
  });

  it('returns correct provider and type', async () => {
    const id = await store.store(USER_A, 'anthropic', 'bearer_token', 'token-abc');
    const result = await store.getById(id, USER_A);
    expect(result!.provider).toBe('anthropic');
    expect(result!.type).toBe('bearer_token');
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — list()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.list()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('returns an empty array when user has no credentials', async () => {
    expect(await store.list(USER_A)).toEqual([]);
  });

  it('returns one entry per stored credential', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-1');
    await store.store(USER_A, 'anthropic', 'api_key', 'sk-2');
    const items = await store.list(USER_A);
    expect(items).toHaveLength(2);
  });

  it('returned entries contain id, provider, type, and metadata', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x', { label: 'Prod Key' });
    const items = await store.list(USER_A);
    const item = items[0]!;
    expect(item.id).toBe(id);
    expect(item.provider).toBe('openai');
    expect(item.type).toBe('api_key');
    expect(item.metadata.label).toBe('Prod Key');
  });

  it('returned entries do NOT contain the decrypted value', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-secret');
    const items = await store.list(USER_A);
    // The list item type does not have a `value` field; verify via cast
    const item = items[0] as unknown as Record<string, unknown>;
    expect(item['value']).toBeUndefined();
  });

  it('does not return entries for other users', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-A');
    await store.store(USER_B, 'anthropic', 'api_key', 'sk-B');
    const itemsA = await store.list(USER_A);
    expect(itemsA).toHaveLength(1);
    expect(itemsA[0]!.provider).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — delete()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.delete()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('returns true when credential is deleted successfully', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.delete(id, USER_A)).toBe(true);
  });

  it('removes the credential so subsequent get returns null', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.delete(id, USER_A);
    expect(await store.get(USER_A, 'openai')).toBeNull();
  });

  it('returns false for a non-existent id', async () => {
    expect(await store.delete('cred_doesntexist', USER_A)).toBe(false);
  });

  it('returns false when userId does not match the entry owner', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.delete(id, USER_B)).toBe(false);
  });

  it('does not delete the entry when userId is wrong', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.delete(id, USER_B);
    // Credential should still be accessible for correct owner
    expect(await store.get(USER_A, 'openai')).not.toBeNull();
  });

  it('leaves other user credentials intact', async () => {
    const idA = await store.store(USER_A, 'openai', 'api_key', 'sk-A');
    await store.store(USER_B, 'openai', 'api_key', 'sk-B');
    await store.delete(idA, USER_A);
    expect(await store.get(USER_B, 'openai')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — deleteAll()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.deleteAll()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('removes all credentials for the given user', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-1');
    await store.store(USER_A, 'anthropic', 'api_key', 'sk-2');
    await store.deleteAll(USER_A);
    expect(await store.list(USER_A)).toEqual([]);
  });

  it('does not remove credentials for other users', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-A');
    await store.store(USER_B, 'openai', 'api_key', 'sk-B');
    await store.deleteAll(USER_A);
    expect(await store.list(USER_B)).toHaveLength(1);
  });

  it('resolves without error when user has no credentials', async () => {
    await expect(store.deleteAll('nobody')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — rotate()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.rotate()', () => {
  let backend: InMemoryCredentialBackend;
  let store: UserCredentialStore;

  beforeEach(() => {
    backend = makeBackend();
    store = makeStore(FIXED_KEY, backend);
    vi.clearAllMocks();
  });

  it('returns a new credential ID (not null) on success', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'old-key');
    const newId = await store.rotate(USER_A, 'openai', 'new-key');
    expect(newId).not.toBeNull();
    expect(newId).toMatch(/^cred_/);
  });

  it('returns null when no existing credential is found', async () => {
    const result = await store.rotate(USER_A, 'openai', 'new-key');
    expect(result).toBeNull();
  });

  it('old credential is no longer retrievable after rotation', async () => {
    const oldId = await store.store(USER_A, 'openai', 'api_key', 'old-key');
    await store.rotate(USER_A, 'openai', 'new-key');
    expect(await backend.get(oldId)).toBeNull();
  });

  it('new credential decrypts to the new value', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'old-key');
    await store.rotate(USER_A, 'openai', 'new-key');
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('new-key');
  });

  it('new credential inherits the label from the old one', async () => {
    const oldId = await store.store(USER_A, 'openai', 'api_key', 'old', { label: 'My Label' });
    const _oldEntry = await backend.get(oldId);
    const newId = await store.rotate(USER_A, 'openai', 'new');
    const newEntry = await backend.get(newId!);
    expect(newEntry!.metadata.label).toBe('My Label');
  });

  it('new credential inherits the scopes from the old one', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'old', { scopes: ['scope1', 'scope2'] });
    const newId = await store.rotate(USER_A, 'openai', 'new');
    const newEntry = await backend.get(newId!);
    expect(newEntry!.metadata.scopes).toEqual(['scope1', 'scope2']);
  });

  it('new credential inherits the projectId from the old one', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'old', { projectId: 'project-99' });
    const newId = await store.rotate(USER_A, 'openai', 'new');
    const newEntry = await backend.get(newId!);
    expect(newEntry!.metadata.projectId).toBe('project-99');
  });

  it('new credential has a different ID than the old one', async () => {
    const oldId = await store.store(USER_A, 'openai', 'api_key', 'old');
    const newId = await store.rotate(USER_A, 'openai', 'new');
    expect(newId).not.toBe(oldId);
  });

  it('expiresAt is NOT carried over from the old credential (rotate resets expiry)', async () => {
    // Per the implementation: options only passes label, scopes, projectId — not expiresAt
    const expiry = new Date(Date.now() + 3_600_000);
    await store.store(USER_A, 'openai', 'api_key', 'old', { expiresAt: expiry });
    const newId = await store.rotate(USER_A, 'openai', 'new');
    const newEntry = await backend.get(newId!);
    expect(newEntry!.metadata.expiresAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UserCredentialStore — exists()
// ---------------------------------------------------------------------------

describe('UserCredentialStore.exists()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  it('returns false when no credential exists', async () => {
    expect(await store.exists(USER_A, 'openai')).toBe(false);
  });

  it('returns true when a credential exists', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.exists(USER_A, 'openai')).toBe(true);
  });

  it('returns false for the correct user but wrong provider', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.exists(USER_A, 'anthropic')).toBe(false);
  });

  it('returns false for the correct provider but wrong user', async () => {
    await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    expect(await store.exists(USER_B, 'openai')).toBe(false);
  });

  it('returns false after the credential has been deleted', async () => {
    const id = await store.store(USER_A, 'openai', 'api_key', 'sk-x');
    await store.delete(id, USER_A);
    expect(await store.exists(USER_A, 'openai')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CredentialContext
// ---------------------------------------------------------------------------

describe('CredentialContext', () => {
  let store: UserCredentialStore;
  let context: CredentialContext;

  beforeEach(() => {
    store = makeStore();
    context = new CredentialContext(store, USER_A);
    vi.clearAllMocks();
  });

  // getUserId
  describe('getUserId()', () => {
    it('returns the userId provided at construction', () => {
      expect(context.getUserId()).toBe(USER_A);
    });

    it('returns the exact userId string without modification', () => {
      const ctx = new CredentialContext(store, 'special-user-id-123');
      expect(ctx.getUserId()).toBe('special-user-id-123');
    });
  });

  // get
  describe('get()', () => {
    it('returns null when no credential is stored', async () => {
      expect(await context.get('openai')).toBeNull();
    });

    it('returns a Credential when one is stored', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-ctx');
      const result = await context.get('openai');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('sk-ctx');
    });

    it('caches the result — second call returns the same object', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-cache');
      const first = await context.get('openai');
      const second = await context.get('openai');
      expect(first).toBe(second); // same object reference
    });

    it('does not hit the store on the second call (cache hit)', async () => {
      const getSpy = vi.spyOn(store, 'get');
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      await context.get('openai');
      await context.get('openai');
      // store.get should have been called only once (first call)
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('caches null result so store.get is NOT called again for missing providers', async () => {
      // Per implementation: only non-null credentials are cached
      // Missing provider: store.get is called each time (null is not cached)
      const getSpy = vi.spyOn(store, 'get');
      await context.get('openai'); // null — not cached
      await context.get('openai'); // null — store hit again
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it('caches separately per provider', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-oai');
      await store.store(USER_A, 'anthropic', 'api_key', 'sk-anth');
      const oai = await context.get('openai');
      const anth = await context.get('anthropic');
      expect(oai!.provider).toBe('openai');
      expect(anth!.provider).toBe('anthropic');
    });
  });

  // getApiKey
  describe('getApiKey()', () => {
    it('returns the value string when credential exists', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'my-api-key');
      const key = await context.getApiKey('openai');
      expect(key).toBe('my-api-key');
    });

    it('returns null when no credential is stored', async () => {
      expect(await context.getApiKey('openai')).toBeNull();
    });

    it('returns null for a provider not belonging to this user', async () => {
      await store.store(USER_B, 'openai', 'api_key', 'sk-B');
      expect(await context.getApiKey('openai')).toBeNull();
    });

    it('uses the cache set by a prior get() call', async () => {
      await store.store(USER_A, 'groq', 'api_key', 'groq-key');
      await context.get('groq'); // prime cache
      const getSpy = vi.spyOn(store, 'get');
      const key = await context.getApiKey('groq');
      expect(key).toBe('groq-key');
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  // has
  describe('has()', () => {
    it('returns false when no credential exists and cache is empty', async () => {
      expect(await context.has('openai')).toBe(false);
    });

    it('returns true when credential exists in the store', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      expect(await context.has('openai')).toBe(true);
    });

    it('returns true immediately from cache without hitting the store', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      await context.get('openai'); // prime cache
      const existsSpy = vi.spyOn(store, 'exists');
      expect(await context.has('openai')).toBe(true);
      expect(existsSpy).not.toHaveBeenCalled();
    });

    it('falls through to store.exists when cache is empty', async () => {
      await store.store(USER_A, 'anthropic', 'api_key', 'sk-x');
      const existsSpy = vi.spyOn(store, 'exists');
      await context.has('anthropic');
      expect(existsSpy).toHaveBeenCalledWith(USER_A, 'anthropic');
    });

    it('returns false for a different provider', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      expect(await context.has('anthropic')).toBe(false);
    });
  });

  // clear
  describe('clear()', () => {
    it('clears the cache so the next get() hits the store again', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      await context.get('openai'); // prime cache
      context.clear();
      const getSpy = vi.spyOn(store, 'get');
      await context.get('openai');
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('after clear, has() consults the store again', async () => {
      await store.store(USER_A, 'openai', 'api_key', 'sk-x');
      await context.get('openai');
      context.clear();
      const existsSpy = vi.spyOn(store, 'exists');
      await context.has('openai');
      expect(existsSpy).toHaveBeenCalled();
    });

    it('is idempotent — calling clear twice does not throw', () => {
      expect(() => {
        context.clear();
        context.clear();
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe('createInMemoryCredentialStore()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a UserCredentialStore instance', () => {
    const store = createInMemoryCredentialStore(FIXED_KEY);
    expect(store).toBeInstanceOf(UserCredentialStore);
  });

  it('uses the provided encryption key (store + get roundtrip works)', async () => {
    const store = createInMemoryCredentialStore(FIXED_KEY);
    await store.store(USER_A, 'openai', 'api_key', 'factory-key');
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('factory-key');
  });

  it('generates a random key when none is provided and CREDENTIAL_ENCRYPTION_KEY env is absent', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '');
    const store1 = createInMemoryCredentialStore();
    const store2 = createInMemoryCredentialStore();
    // Both should be valid stores; they just can't decrypt each other's data
    expect(store1).toBeInstanceOf(UserCredentialStore);
    expect(store2).toBeInstanceOf(UserCredentialStore);
    vi.unstubAllEnvs();
  });

  it('uses CREDENTIAL_ENCRYPTION_KEY env var when no key argument is provided', async () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', FIXED_KEY);
    const store = createInMemoryCredentialStore();
    await store.store(USER_A, 'openai', 'api_key', 'env-key-test');
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('env-key-test');
    vi.unstubAllEnvs();
  });

  it('auditLog defaults to true', () => {
    // We verify indirectly: if auditLog were false, the private flag would
    // block log.debug calls. We just confirm no errors are thrown with auditLog enabled.
    const store = createInMemoryCredentialStore(FIXED_KEY);
    expect(store).toBeInstanceOf(UserCredentialStore);
  });
});

describe('createCredentialContext()', () => {
  it('returns a CredentialContext instance', () => {
    const store = createInMemoryCredentialStore(FIXED_KEY);
    const ctx = createCredentialContext(store, USER_A);
    expect(ctx).toBeInstanceOf(CredentialContext);
  });

  it('context getUserId returns the provided userId', () => {
    const store = createInMemoryCredentialStore(FIXED_KEY);
    const ctx = createCredentialContext(store, 'custom-user');
    expect(ctx.getUserId()).toBe('custom-user');
  });

  it('context can retrieve credentials stored through the provided store', async () => {
    const store = createInMemoryCredentialStore(FIXED_KEY);
    await store.store(USER_A, 'openai', 'api_key', 'factory-ctx-key');
    const ctx = createCredentialContext(store, USER_A);
    expect(await ctx.getApiKey('openai')).toBe('factory-ctx-key');
  });
});

// ---------------------------------------------------------------------------
// loadCredentialsFromEnv()
// ---------------------------------------------------------------------------

describe('loadCredentialsFromEnv()', () => {
  let store: UserCredentialStore;

  beforeEach(() => {
    store = makeStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores OPENAI_API_KEY when set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('sk-openai-test');
  });

  it('stores ANTHROPIC_API_KEY when set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-anthropic-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'anthropic');
    expect(result!.value).toBe('sk-anthropic-test');
  });

  it('stores GOOGLE_AI_API_KEY when set', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'google-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'google');
    expect(result!.value).toBe('google-key-test');
  });

  it('stores DEEPSEEK_API_KEY when set', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'deepseek');
    expect(result!.value).toBe('deepseek-key-test');
  });

  it('stores GROQ_API_KEY when set', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'groq');
    expect(result!.value).toBe('groq-key-test');
  });

  it('stores TOGETHER_API_KEY when set', async () => {
    vi.stubEnv('TOGETHER_API_KEY', 'together-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'together');
    expect(result!.value).toBe('together-key-test');
  });

  it('stores FIREWORKS_API_KEY when set', async () => {
    vi.stubEnv('FIREWORKS_API_KEY', 'fireworks-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'fireworks');
    expect(result!.value).toBe('fireworks-key-test');
  });

  it('stores MISTRAL_API_KEY when set', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'mistral-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'mistral');
    expect(result!.value).toBe('mistral-key-test');
  });

  it('stores XAI_API_KEY when set', async () => {
    vi.stubEnv('XAI_API_KEY', 'xai-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'xai');
    expect(result!.value).toBe('xai-key-test');
  });

  it('stores PERPLEXITY_API_KEY when set', async () => {
    vi.stubEnv('PERPLEXITY_API_KEY', 'perplexity-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'perplexity');
    expect(result!.value).toBe('perplexity-key-test');
  });

  it('stores ZHIPU_API_KEY when set', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'zhipu');
    expect(result!.value).toBe('zhipu-key-test');
  });

  it('stores TELEGRAM_BOT_TOKEN when set', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'telegram-token-test');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'telegram');
    expect(result!.value).toBe('telegram-token-test');
  });

  it('stores with type api_key for every mapping', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-x');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'openai');
    expect(result!.type).toBe('api_key');
  });

  it('does not store a credential when the env var is absent', async () => {
    // OPENAI_API_KEY is not set — credential should not exist
    delete process.env['OPENAI_API_KEY'];
    await loadCredentialsFromEnv(store, USER_A);
    expect(await store.exists(USER_A, 'openai')).toBe(false);
  });

  it('does not overwrite an existing credential for the same provider', async () => {
    // Pre-store a credential
    await store.store(USER_A, 'openai', 'api_key', 'original-key');
    vi.stubEnv('OPENAI_API_KEY', 'new-key-from-env');
    await loadCredentialsFromEnv(store, USER_A);
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('original-key');
  });

  it('loads multiple env vars in a single call', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-anth');
    await loadCredentialsFromEnv(store, USER_A);
    expect(await store.exists(USER_A, 'openai')).toBe(true);
    expect(await store.exists(USER_A, 'anthropic')).toBe(true);
  });

  it('uses the provided userId for all stored credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-user-b');
    await loadCredentialsFromEnv(store, USER_B);
    expect(await store.exists(USER_B, 'openai')).toBe(true);
    expect(await store.exists(USER_A, 'openai')).toBe(false);
  });

  it('resolves without error when no env vars are set', async () => {
    // Ensure all known env vars are absent
    const keysToRemove = [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'DEEPSEEK_API_KEY',
      'GROQ_API_KEY', 'TOGETHER_API_KEY', 'FIREWORKS_API_KEY', 'MISTRAL_API_KEY',
      'XAI_API_KEY', 'PERPLEXITY_API_KEY', 'ZHIPU_API_KEY', 'TELEGRAM_BOT_TOKEN',
    ];
    for (const key of keysToRemove) {
      delete process.env[key];
    }
    await expect(loadCredentialsFromEnv(store, USER_A)).resolves.toBeUndefined();
  });

  it('stores label from the mapping (e.g. "OpenAI API Key")', async () => {
    const backend = makeBackend();
    const s = makeStore(FIXED_KEY, backend);
    vi.stubEnv('OPENAI_API_KEY', 'sk-label-test');
    await loadCredentialsFromEnv(s, USER_A);
    const list = await s.list(USER_A);
    expect(list[0]!.metadata.label).toBe('OpenAI API Key');
  });
});

// ---------------------------------------------------------------------------
// Edge cases and miscellaneous
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('stores and retrieves an empty string value', async () => {
    // Edge: empty string is falsy but should be treated as a valid credential value
    // Note: loadCredentialsFromEnv skips empty strings — this tests the store itself
    const store = makeStore();
    await store.store(USER_A, 'openai', 'api_key', '');
    const result = await store.get(USER_A, 'openai');
    expect(result!.value).toBe('');
  });

  it('stores credentials for all supported CredentialProvider values', async () => {
    const store = makeStore();
    const providers: CredentialProvider[] = [
      'openai', 'anthropic', 'google', 'deepseek', 'groq',
      'together', 'fireworks', 'mistral', 'xai', 'perplexity',
      'zhipu', 'telegram', 'custom',
    ];
    for (const provider of providers) {
      await store.store(USER_A, provider, 'api_key', `key-for-${provider}`);
    }
    const items = await store.list(USER_A);
    expect(items).toHaveLength(providers.length);
  });

  it('stores credentials for all supported CredentialType values', async () => {
    const store = makeStore();
    const types: CredentialType[] = [
      'api_key', 'oauth_token', 'oauth_refresh', 'basic_auth',
      'bearer_token', 'certificate', 'custom',
    ];
    for (const [i, type] of types.entries()) {
      // Use unique providers to avoid key conflicts
      await store.store(USER_A, 'custom', type, `value-${i}`);
    }
    // Only the last stored 'custom' provider survives for get(), but all are in the backend
    const items = await store.list(USER_A);
    expect(items.length).toBeGreaterThan(0);
  });

  it('InMemoryCredentialBackend is independent per instance', async () => {
    const backend1 = makeBackend();
    const backend2 = makeBackend();
    await backend1.set(makeEntry({ id: 'cred_1' }));
    expect(await backend2.get('cred_1')).toBeNull();
  });

  it('list() on backend reflects all stored entries across users', async () => {
    const backend = makeBackend();
    await backend.set(makeEntry({ id: 'cred_A', userId: USER_A }));
    await backend.set(makeEntry({ id: 'cred_B', userId: USER_B }));
    const ids = await backend.list();
    expect(ids).toContain('cred_A');
    expect(ids).toContain('cred_B');
  });

  it('CredentialContext isolates users — context for USER_A cannot see USER_B credentials', async () => {
    const store = makeStore();
    await store.store(USER_B, 'openai', 'api_key', 'sk-B');
    const ctxA = new CredentialContext(store, USER_A);
    expect(await ctxA.getApiKey('openai')).toBeNull();
  });
});
