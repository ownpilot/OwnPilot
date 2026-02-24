/**
 * Tests for CredentialStore error paths that require mocking deriveKey.
 * Covers: initialize() deriveKey failure, unlock() deriveKey failure,
 * changePassword() deriveKey failure, save() guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialStore } from './credentials.js';
import { CryptoError } from '../types/errors.js';

let fsStore: Record<string, string> = {};

const mockExistsSync = vi.fn((p: string) => p in fsStore);
const mockReadFile = vi.fn(async (p: string, _enc?: string) => {
  if (p in fsStore) return fsStore[p];
  throw new Error('ENOENT');
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

// Mock deriveKey to control when it fails
const mockDeriveKey = vi.fn();
vi.mock('./derive.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    deriveKey: (...args: unknown[]) => mockDeriveKey(...args),
  };
});

const TEST_PATH = '/tmp/cred-mocked/credentials.enc';
const PASSWORD = 'test-password-long-enough';

function makeStore(): CredentialStore {
  return new CredentialStore({ path: TEST_PATH, iterations: 1 });
}

describe('CredentialStore - deriveKey failure paths', () => {
  beforeEach(() => {
    fsStore = {};
    vi.clearAllMocks();
  });

  describe('initialize - deriveKey failure', () => {
    it('returns error when deriveKey fails during initialize', async () => {
      mockDeriveKey.mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('derive', 'Key derivation failed'),
      });
      const store = makeStore();
      const result = await store.initialize(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Key derivation failed/i);
    });
  });

  describe('unlock - deriveKey failure', () => {
    it('returns error when deriveKey fails during unlock', async () => {
      // First, successfully initialize with a working deriveKey
      const { deriveKey: realDeriveKey } = await import('./derive.js');
      // We need a valid file in fsStore first. Use a simple approach:
      // Create a file manually
      fsStore[TEST_PATH] = JSON.stringify({
        version: 1,
        salt: 'AQIDBA==',
        verifier: 'AAAA',
        data: 'AAAA',
      });

      // Now make deriveKey fail
      mockDeriveKey.mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('derive', 'Key derivation failed'),
      });

      const store = makeStore();
      const result = await store.unlock(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Key derivation failed/i);
    });
  });

  describe('changePassword - deriveKey failure for new key', () => {
    it('returns error when deriveKey fails for new password', async () => {
      // Setup: create a valid credentials file
      const { generateSalt, generateIV, toBase64 } = await import('./derive.js');
      const salt = generateSalt(32);
      const iv = generateIV();

      // Create a real CryptoKey for initial setup
      const { webcrypto } = await import('node:crypto');
      const passwordKey = await webcrypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(PASSWORD),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );
      const realKey = await webcrypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 1, hash: 'SHA-256' },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // deriveKey succeeds for initial unlock
      mockDeriveKey.mockResolvedValueOnce({ ok: true, value: realKey });

      // Create verifier
      const verifierIv = generateIV();
      const verifierCt = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: verifierIv },
        realKey,
        new TextEncoder().encode('OWNPILOT_VERIFIED')
      );
      const verifierCombined = new Uint8Array(verifierIv.length + verifierCt.byteLength);
      verifierCombined.set(verifierIv, 0);
      verifierCombined.set(new Uint8Array(verifierCt), verifierIv.length);

      // Create data
      const dataIv = generateIV();
      const dataCt = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: dataIv },
        realKey,
        new TextEncoder().encode('{}')
      );
      const dataCombined = new Uint8Array(dataIv.length + dataCt.byteLength);
      dataCombined.set(dataIv, 0);
      dataCombined.set(new Uint8Array(dataCt), dataIv.length);

      fsStore[TEST_PATH] = JSON.stringify({
        version: 1,
        salt: toBase64(salt),
        verifier: toBase64(verifierCombined),
        data: toBase64(dataCombined),
      });

      const store = makeStore();
      const unlockResult = await store.unlock(PASSWORD);
      expect(unlockResult.ok).toBe(true);

      // Now make deriveKey fail for the new password
      mockDeriveKey.mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('derive', 'New key derivation failed'),
      });

      const result = await store.changePassword(PASSWORD, 'new-password-long-enough');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/New key derivation failed/i);
    });
  });
});
