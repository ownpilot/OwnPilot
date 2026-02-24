import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecureVault } from './vault.js';
import { CryptoError } from '../types/errors.js';

const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
  mockDecrypt: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify('hello')).buffer),
}));

vi.mock('./derive.js', () => ({ deriveKey: vi.fn(), generateSalt: vi.fn(), generateIV: vi.fn(), generateMasterKey: vi.fn(), toBase64: vi.fn(), fromBase64: vi.fn(), secureClear: vi.fn() }));
vi.mock('./keychain.js', () => ({ storeSecret: vi.fn(), retrieveSecret: vi.fn(), deleteSecret: vi.fn(), hasSecret: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:path', () => ({ dirname: vi.fn().mockReturnValue('/data') }));
vi.mock('node:crypto', () => ({
  webcrypto: {
    subtle: {
      encrypt: (...args: unknown[]) => mockEncrypt(...args),
      decrypt: (...args: unknown[]) => mockDecrypt(...args),
      importKey: vi.fn(), deriveKey: vi.fn(),
    },
    getRandomValues: (arr: Uint8Array) => arr,
  },
}));

async function setupMocks() {
  const keychain = await import('./keychain.js');
  const derive = await import('./derive.js');
  const nfs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  vi.mocked(keychain.hasSecret).mockResolvedValue(false);
  vi.mocked(keychain.storeSecret).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(keychain.retrieveSecret).mockResolvedValue({ ok: true, value: new Uint8Array([10, 20, 30]) });
  vi.mocked(keychain.deleteSecret).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(derive.deriveKey).mockResolvedValue({ ok: true, value: 'mock-derived-key' as never });
  vi.mocked(derive.generateSalt).mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  vi.mocked(derive.generateIV).mockReturnValue(new Uint8Array(12));
  vi.mocked(derive.generateMasterKey).mockReturnValue(new Uint8Array([10, 20, 30]));
  vi.mocked(derive.toBase64).mockImplementation((data: Uint8Array) => Buffer.from(data).toString('base64'));
  vi.mocked(derive.fromBase64).mockImplementation((b64: string) => new Uint8Array(Buffer.from(b64, 'base64')));
  vi.mocked(derive.secureClear).mockImplementation(() => {});
  vi.mocked(nfs.existsSync).mockReturnValue(true);
  vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify({ version: 1, salt: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64'), entries: {} }));
  vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsp.mkdir).mockResolvedValue(undefined as never);
  mockEncrypt.mockResolvedValue(new ArrayBuffer(16));
  mockDecrypt.mockResolvedValue(new TextEncoder().encode(JSON.stringify('hello')).buffer);
  return { keychain, derive, nfs, fsp };
}

function forceUnlock(v: SecureVault): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vx = v as any;
  vx.isUnlocked = true;
  vx.derivedKey = 'mock-derived-key';
  vx.vaultData = { version: 1, salt: 'AQIDBA==', entries: {} };
}

describe('SecureVault - additional coverage', () => {
  let vault: SecureVault;
  beforeEach(async () => { vi.clearAllMocks(); await setupMocks(); vault = new SecureVault({ path: '/data/vault.json' }); });

  describe('initialize - save failure', () => {
    it('returns error when saveVault fails', async () => {
      const fsp = await import('node:fs/promises');
      const derive = await import('./derive.js');
      vi.mocked(fsp.writeFile).mockRejectedValueOnce(new Error('disk full'));
      const result = await vault.initialize();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to write vault file/i);
      expect(derive.secureClear).toHaveBeenCalled();
    });
  });

  describe('unlock - loadVault failures', () => {
    it('returns error when readFile rejects', async () => {
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.readFile).mockRejectedValueOnce(new Error('permission denied'));
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to read vault file/i);
    });

    it('returns error when vault file has invalid JSON', async () => {
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.readFile).mockResolvedValueOnce('<<<not json>>>');
      const result = await vault.unlock();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Invalid vault file format/i);
    });
  });

  describe('saveVault edge cases', () => {
    it('creates parent directory if it does not exist', async () => {
      forceUnlock(vault);
      const nfs = await import('node:fs');
      const fsp = await import('node:fs/promises');
      vi.mocked(nfs.existsSync).mockReturnValueOnce(false);
      const result = await vault.set('key', 'val');
      expect(result.ok).toBe(true);
      expect(fsp.mkdir).toHaveBeenCalledWith('/data', { recursive: true });
    });

    it('returns error when writeFile throws', async () => {
      forceUnlock(vault);
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.writeFile).mockRejectedValueOnce(new Error('IO error'));
      const result = await vault.set('key', 'val');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to write vault file/i);
    });

    it('returns error when vaultData is null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vx = vault as any;
      vx.isUnlocked = true; vx.derivedKey = 'mock-key'; vx.vaultData = null;
      expect((await vault.delete('key')).ok).toBe(false);
      expect((await vault.clear()).ok).toBe(false);
      expect(vault.has('key').ok).toBe(false);
      expect(vault.keys().ok).toBe(false);
    });
  });

  describe('delete - save failure', () => {
    it('returns error when saveVault fails during delete', async () => {
      forceUnlock(vault);
      await vault.set('k', 'v');
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.writeFile).mockRejectedValueOnce(new Error('write error'));
      const result = await vault.delete('k');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to write vault file/i);
    });
  });

  describe('rotateMasterKey - with entries', () => {
    it('decrypts and re-encrypts all entries', async () => {
      forceUnlock(vault);
      await vault.set('apiKey', 'secret-123');
      await vault.set('token', 'tok-456');
      const keychain = await import('./keychain.js');
      const derive = await import('./derive.js');
      vi.mocked(keychain.storeSecret).mockClear();
      vi.mocked(derive.generateMasterKey).mockClear();
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(true);
      expect(keychain.storeSecret).toHaveBeenCalled();
      expect(derive.generateMasterKey).toHaveBeenCalled();
    });

    it('returns error when deriveKey fails during rotation', async () => {
      forceUnlock(vault);
      const derive = await import('./derive.js');
      vi.mocked(derive.deriveKey).mockResolvedValueOnce({ ok: false, error: new CryptoError('derive', 'derivation failed') });
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/derivation failed/i);
    });

    it('returns error when get fails during entry decryption', async () => {
      forceUnlock(vault);
      await vault.set('broken', 'value');
      mockDecrypt.mockRejectedValueOnce(new Error('corrupt data'));
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(CryptoError);
    });

    it('returns error when set fails during re-encryption', async () => {
      forceUnlock(vault);
      const derive = await import('./derive.js');
      vi.mocked(derive.deriveKey).mockResolvedValue({ ok: true, value: 'new-key' as never });
      await vault.set('key1', 'val1');
      mockEncrypt.mockRejectedValueOnce(new Error('encrypt failed'));
      const result = await vault.rotateMasterKey();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(CryptoError);
    });
  });

  describe('clear - save failure', () => {
    it('returns error when saveVault fails during clear', async () => {
      forceUnlock(vault);
      await vault.set('x', 1);
      const fsp = await import('node:fs/promises');
      vi.mocked(fsp.writeFile).mockRejectedValueOnce(new Error('write error'));
      const result = await vault.clear();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/Failed to write vault file/i);
    });
  });

  describe('saveVault - null vaultData guard', () => {
    it('returns error when saveVault is called with null vaultData', async () => {
      // Access private method directly to test the guard
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vx = vault as any;
      vx.isUnlocked = true;
      vx.derivedKey = 'mock-key';
      vx.vaultData = null;
      
      // Call private saveVault directly
      const result = await vx.saveVault();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/No vault data to save/i);
    });
  });
});
