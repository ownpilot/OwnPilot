/**
 * Additional coverage tests for credentials.ts error paths
 * Covers: save() readFile error, save() catch block, destroy() catch block
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CredentialStore } from './credentials.js';

let fsStore: Record<string, string> = {};

const mockExistsSync = vi.fn((p: string) => p in fsStore);
const mockReadFile = vi.fn(async (p: string, _enc?: string) => {
  if (p in fsStore) return fsStore[p];
  throw new Error('ENOENT: no such file');
});
const mockWriteFile = vi.fn(async (p: string, data: string, _opts?: unknown) => {
  fsStore[p] = data;
});
const mockMkdir = vi.fn(async () => undefined);
const mockUnlink = vi.fn(async (p: string) => {
  delete fsStore[p];
});

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [string])),
}));
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...(args as [string, string?])),
  writeFile: (...args: unknown[]) => mockWriteFile(...(args as [string, string, unknown?])),
  mkdir: (...args: unknown[]) => mockMkdir(...(args as [string])),
  unlink: (...args: unknown[]) => mockUnlink(...(args as [string])),
}));

const TEST_PATH = '/tmp/ownpilot-cov-test/credentials.enc';
const PASSWORD = 'test-password-long-enough';

function makeStore(): CredentialStore {
  return new CredentialStore({ path: TEST_PATH, iterations: 1 });
}

async function initAndUnlock(): Promise<CredentialStore> {
  const s = makeStore();
  const initRes = await s.initialize(PASSWORD);
  expect(initRes.ok).toBe(true);
  const unlockRes = await s.unlock(PASSWORD);
  expect(unlockRes.ok).toBe(true);
  return s;
}

describe('CredentialStore - additional coverage', () => {
  beforeEach(() => {
    fsStore = {};
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('save - readFile failure', () => {
    it('returns error when readFile fails during save', async () => {
      const store = await initAndUnlock();
      mockReadFile.mockRejectedValueOnce(new Error('EACCES'));
      const result = await store.setCredentials({ openaiApiKey: 'sk-test' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to read credentials file/i);
    });
  });

  describe('save - writeFile failure', () => {
    it('returns error when writeFile throws during save', async () => {
      const store = await initAndUnlock();
      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));
      const result = await store.setCredentials({ openaiApiKey: 'sk-test' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to save credentials/i);
    });
  });

  describe('destroy - unlink failure', () => {
    it('returns error when unlink throws', async () => {
      const store = await initAndUnlock();
      mockUnlink.mockRejectedValueOnce(new Error('EPERM'));
      const result = await store.destroy();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to delete credentials file/i);
    });
  });

  describe('save - guard when derivedKey is null', () => {
    it('returns error when derivedKey is null', async () => {
      const store = await initAndUnlock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).derivedKey = null;
      const result = await store.setCredentials({ openaiApiKey: 'sk-test' });
      expect(result.ok).toBe(false);
    });
  });

  describe('deleteCredential - save failure', () => {
    it('returns error when save fails after delete', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-del' });
      mockReadFile.mockRejectedValueOnce(new Error('EACCES'));
      const result = await store.deleteCredential('openaiApiKey');
      expect(result.ok).toBe(false);
    });
  });

  describe('changePassword - readFile failure', () => {
    it('returns error when readFile fails during change', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-pw' });
      mockReadFile.mockRejectedValueOnce(new Error('EACCES'));
      const result = await store.changePassword(PASSWORD, 'new-password-long-enough');
      expect(result.ok).toBe(false);
    });
  });

  describe('initialize - catch block', () => {
    it('returns error when crypto/FS fails during init', async () => {
      const store = makeStore();
      mockWriteFile.mockRejectedValueOnce(new Error('crypto fail'));
      const result = await store.initialize(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.message).toMatch(/Failed to initialize credential store/i);
    });
  });

  describe('unlock - readFile failure', () => {
    it('returns error when readFile throws during unlock', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);
      const store2 = makeStore();
      mockReadFile.mockRejectedValueOnce(new Error('EACCES'));
      const result = await store2.unlock(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to read credentials file/i);
    });
  });

  describe('unlock - credentials decryption failure', () => {
    it('returns error when data decryption fails', async () => {
      const store = await initAndUnlock();
      store.lock();
      const file = JSON.parse(fsStore[TEST_PATH]);
      file.data = 'AAAA'; // invalid encrypted data
      fsStore[TEST_PATH] = JSON.stringify(file);
      const store2 = makeStore();
      const result = await store2.unlock(PASSWORD);
      expect(result.ok).toBe(false);
    });
  });

  describe('changePassword - crypto failure catch block', () => {
    it('returns error when writeFile throws during password change', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-test' });
      // Make writeFile throw during the password change save
      mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
      const result = await store.changePassword(PASSWORD, 'another-long-password');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to change password/i);
    });
  });
});
