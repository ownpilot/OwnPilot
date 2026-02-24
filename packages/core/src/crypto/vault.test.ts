import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureVault, createVault } from './vault.js';
import { ValidationError, NotFoundError, CryptoError } from '../types/errors.js';

// ---------------------------------------------------------------------------
// Hoisted mocks (available before vi.mock factories)
// ---------------------------------------------------------------------------
const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
  mockDecrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('"hello"').buffer),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('./derive.js', () => ({
  deriveKey: vi.fn(),
  generateSalt: vi.fn(),
  generateIV: vi.fn(),
  generateMasterKey: vi.fn(),
  toBase64: vi.fn(),
  fromBase64: vi.fn(),
  secureClear: vi.fn(),
}));

vi.mock('./keychain.js', () => ({
  storeSecret: vi.fn(),
  retrieveSecret: vi.fn(),
  deleteSecret: vi.fn(),
  hasSecret: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:path', () => ({
  dirname: vi.fn().mockReturnValue('/data'),
}));

vi.mock('node:crypto', () => ({
  webcrypto: {
    subtle: {
      encrypt: (...args: unknown[]) => mockEncrypt(...args),
      decrypt: (...args: unknown[]) => mockDecrypt(...args),
      importKey: vi.fn(),
      deriveKey: vi.fn(),
    },
    getRandomValues: (arr: Uint8Array) => arr,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-apply default mock implementations (must be called after clearAllMocks) */
async function setupMocks() {
  const keychain = await import('./keychain.js');
  const derive = await import('./derive.js');
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');

  vi.mocked(keychain.hasSecret).mockResolvedValue(false);
  vi.mocked(keychain.storeSecret).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(keychain.retrieveSecret).mockResolvedValue({
    ok: true,
    value: new Uint8Array([10, 20, 30]),
  });
  vi.mocked(keychain.deleteSecret).mockResolvedValue({ ok: true, value: undefined });

  vi.mocked(derive.deriveKey).mockResolvedValue({ ok: true, value: 'mock-derived-key' as never });
  vi.mocked(derive.generateSalt).mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  vi.mocked(derive.generateIV).mockReturnValue(new Uint8Array(12));
  vi.mocked(derive.generateMasterKey).mockReturnValue(new Uint8Array([10, 20, 30]));
  vi.mocked(derive.toBase64).mockImplementation((data: Uint8Array) =>
    Buffer.from(data).toString('base64')
  );
  vi.mocked(derive.fromBase64).mockImplementation(
    (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
  );
  vi.mocked(derive.secureClear).mockImplementation(() => {});

  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fsp.readFile).mockResolvedValue(
    JSON.stringify({
      version: 1,
      salt: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64'),
      entries: {},
    })
  );
  vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsp.mkdir).mockResolvedValue(undefined as never);

  mockEncrypt.mockResolvedValue(new ArrayBuffer(16));
  mockDecrypt.mockResolvedValue(new TextEncoder().encode('"hello"').buffer);

  return { keychain, derive, fs, fsp };
}

/** Force vault into unlocked state (bypasses unlock() dependency chain) */
function forceUnlock(v: SecureVault): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vx = v as any;
  vx.isUnlocked = true;
  vx.derivedKey = 'mock-derived-key';
  vx.vaultData = { version: 1, salt: 'AQIDBA==', entries: {} };
}

// ---------------------------------------------------------------------------
// SecureVault
// ---------------------------------------------------------------------------
describe('SecureVault', () => {
  let vault: SecureVault;
  let keychainMock: Awaited<ReturnType<typeof setupMocks>>['keychain'];
  let deriveMock: Awaited<ReturnType<typeof setupMocks>>['derive'];
  let fsMock: Awaited<ReturnType<typeof setupMocks>>['fs'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mocks = await setupMocks();
    keychainMock = mocks.keychain;
    deriveMock = mocks.derive;
    fsMock = mocks.fs;
    vault = new SecureVault({ path: '/data/vault.json' });
  });

  // -------------------------------------------------------------------------
  // constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('uses defaults for optional config fields', () => {
      const v = new SecureVault({ path: '/tmp/v.json' });
      expect(v).toBeInstanceOf(SecureVault);
    });

    it('accepts custom config', () => {
      const v = new SecureVault({
        path: '/x.json',
        service: 'my-svc',
        account: 'my-acct',
        iterations: 100,
      });
      expect(v).toBeInstanceOf(SecureVault);
    });
  });

  // -------------------------------------------------------------------------
  // initialize
  // -------------------------------------------------------------------------
  describe('initialize', () => {
    it('creates vault successfully', async () => {
      const result = await vault.initialize();
      expect(result.ok).toBe(true);
      expect(deriveMock.generateMasterKey).toHaveBeenCalledWith(32);
      expect(keychainMock.storeSecret).toHaveBeenCalled();
      expect(deriveMock.secureClear).toHaveBeenCalled();
    });

    it('fails if already initialized', async () => {
      vi.mocked(keychainMock.hasSecret).mockResolvedValueOnce(true);
      const result = await vault.initialize();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    });

    it('fails if keychain store fails', async () => {
      vi.mocked(keychainMock.storeSecret).mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('encrypt', 'keychain error'),
      });
      const result = await vault.initialize();
      expect(result.ok).toBe(false);
      expect(deriveMock.secureClear).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // isInitialized
  // -------------------------------------------------------------------------
  describe('isInitialized', () => {
    it('returns false when no secret', async () => {
      expect(await vault.isInitialized()).toBe(false);
    });

    it('returns true when secret exists', async () => {
      vi.mocked(keychainMock.hasSecret).mockResolvedValueOnce(true);
      expect(await vault.isInitialized()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // unlock / lock / unlocked
  // -------------------------------------------------------------------------
  describe('unlock', () => {
    it('unlocks successfully', async () => {
      const result = await vault.unlock();
      expect(result.ok).toBe(true);
      expect(vault.unlocked).toBe(true);
    });

    it('returns ok if already unlocked', async () => {
      forceUnlock(vault);
      const result = await vault.unlock();
      expect(result.ok).toBe(true);
    });

    it('fails if secret retrieval fails', async () => {
      vi.mocked(keychainMock.retrieveSecret).mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('decrypt', 'keychain error'),
      });
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
    });

    it('fails if secret is null', async () => {
      vi.mocked(keychainMock.retrieveSecret).mockResolvedValueOnce({
        ok: true,
        value: null,
      });
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NotFoundError);
      }
    });

    it('fails if vault file does not exist', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValueOnce(false);
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NotFoundError);
      }
    });

    it('fails if key derivation fails', async () => {
      vi.mocked(deriveMock.deriveKey).mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('derive', 'derivation failed'),
      });
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
    });
  });

  describe('lock', () => {
    it('locks the vault', () => {
      forceUnlock(vault);
      expect(vault.unlocked).toBe(true);
      vault.lock();
      expect(vault.unlocked).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set (requires unlocked vault)
  // -------------------------------------------------------------------------
  describe('set', () => {
    it('fails when locked', async () => {
      const result = await vault.set('key', 'value');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.message).toBe('Vault is locked');
      }
    });

    it('encrypts and saves when unlocked', async () => {
      forceUnlock(vault);
      const fsp = await import('node:fs/promises');
      const result = await vault.set('mykey', 'myvalue');
      expect(result.ok).toBe(true);
      expect(fsp.writeFile).toHaveBeenCalled();
    });

    it('handles encryption failure', async () => {
      forceUnlock(vault);
      mockEncrypt.mockRejectedValueOnce(new Error('encrypt fail'));
      const result = await vault.set('key', 'value');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CryptoError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------
  describe('get', () => {
    it('fails when locked', async () => {
      const result = await vault.get('key');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    });

    it('returns null for missing key', async () => {
      forceUnlock(vault);
      const result = await vault.get('nonexistent');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('decrypts existing entry', async () => {
      forceUnlock(vault);
      // First set a value to populate entries
      await vault.set('testkey', 'hello');
      const result = await vault.get('testkey');
      expect(result.ok).toBe(true);
    });

    it('handles decryption failure', async () => {
      forceUnlock(vault);
      await vault.set('key', 'value');
      mockDecrypt.mockRejectedValueOnce(new Error('decrypt fail'));
      const result = await vault.get('key');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(CryptoError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('fails when locked', async () => {
      const result = await vault.delete('key');
      expect(result.ok).toBe(false);
    });

    it('returns false for non-existent key', async () => {
      forceUnlock(vault);
      const result = await vault.delete('nokey');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('deletes existing key', async () => {
      forceUnlock(vault);
      await vault.set('k', 'v');
      const result = await vault.delete('k');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------
  describe('has', () => {
    it('fails when locked', () => {
      const result = vault.has('key');
      expect(result.ok).toBe(false);
    });

    it('returns false for missing key', () => {
      forceUnlock(vault);
      const result = vault.has('missing');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for existing key', async () => {
      forceUnlock(vault);
      await vault.set('present', 'val');
      const result = vault.has('present');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // keys
  // -------------------------------------------------------------------------
  describe('keys', () => {
    it('fails when locked', () => {
      const result = vault.keys();
      expect(result.ok).toBe(false);
    });

    it('returns empty array when no entries', () => {
      forceUnlock(vault);
      const result = vault.keys();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns all keys', async () => {
      forceUnlock(vault);
      await vault.set('a', 1);
      await vault.set('b', 2);
      const result = vault.keys();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('a');
        expect(result.value).toContain('b');
      }
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------
  describe('clear', () => {
    it('fails when locked', async () => {
      const result = await vault.clear();
      expect(result.ok).toBe(false);
    });

    it('clears all entries', async () => {
      forceUnlock(vault);
      await vault.set('x', 1);
      const result = await vault.clear();
      expect(result.ok).toBe(true);
      const keysResult = vault.keys();
      if (keysResult.ok) {
        expect(keysResult.value).toEqual([]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // destroy
  // -------------------------------------------------------------------------
  describe('destroy', () => {
    it('locks vault and deletes keychain secret', async () => {
      forceUnlock(vault);
      expect(vault.unlocked).toBe(true);
      const result = await vault.destroy();
      expect(result.ok).toBe(true);
      expect(vault.unlocked).toBe(false);
      expect(keychainMock.deleteSecret).toHaveBeenCalled();
    });

    it('propagates keychain delete error', async () => {
      vi.mocked(keychainMock.deleteSecret).mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('encrypt', 'delete failed'),
      });
      const result = await vault.destroy();
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // rotateMasterKey
  // -------------------------------------------------------------------------
  describe('rotateMasterKey', () => {
    it('fails when locked', async () => {
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    });

    it('rotates master key for empty vault', async () => {
      forceUnlock(vault);
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(true);
      expect(keychainMock.storeSecret).toHaveBeenCalled();
      expect(deriveMock.generateMasterKey).toHaveBeenCalled();
    });

    it('fails if storeSecret fails during rotation', async () => {
      forceUnlock(vault);
      vi.mocked(keychainMock.storeSecret).mockResolvedValueOnce({
        ok: false,
        error: new CryptoError('encrypt', 'store failed'),
      });
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// createVault factory
// ---------------------------------------------------------------------------
describe('createVault', () => {
  it('creates a SecureVault instance', () => {
    const vault = createVault({ path: '/tmp/vault.json' });
    expect(vault).toBeInstanceOf(SecureVault);
  });
});

// test append
