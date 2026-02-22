import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPlatform,
  isKeychainAvailable,
  storeSecret,
  retrieveSecret,
  deleteSecret,
  hasSecret,
} from './keychain.js';

// ---------------------------------------------------------------------------
// Hoisted mock (available before vi.mock factories run)
// ---------------------------------------------------------------------------
const { asyncMock } = vi.hoisted(() => ({
  asyncMock: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:os', () => ({
  platform: vi.fn().mockReturnValue('darwin'),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// promisify is called at module load for exec and execFile
vi.mock('node:util', () => ({
  promisify: () => asyncMock,
}));

vi.mock('./derive.js', () => ({
  toBase64: vi.fn().mockImplementation((data: Uint8Array) => Buffer.from(data).toString('base64')),
  fromBase64: vi
    .fn()
    .mockImplementation((b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))),
}));

// ---------------------------------------------------------------------------
// getPlatform
// ---------------------------------------------------------------------------
describe('getPlatform', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns darwin on macOS', () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    expect(getPlatform()).toBe('darwin');
  });

  it('returns linux on Linux', () => {
    vi.mocked(osMock.platform).mockReturnValue('linux');
    expect(getPlatform()).toBe('linux');
  });

  it('returns win32 on Windows', () => {
    vi.mocked(osMock.platform).mockReturnValue('win32');
    expect(getPlatform()).toBe('win32');
  });

  it('returns unsupported for other platforms', () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    expect(getPlatform()).toBe('unsupported');
  });

  it('returns unsupported for aix', () => {
    vi.mocked(osMock.platform).mockReturnValue('aix');
    expect(getPlatform()).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// isKeychainAvailable
// ---------------------------------------------------------------------------
describe('isKeychainAvailable', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns true on darwin when security exists', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    expect(await isKeychainAvailable()).toBe(true);
  });

  it('returns true on win32', async () => {
    vi.mocked(osMock.platform).mockReturnValue('win32');
    expect(await isKeychainAvailable()).toBe(true);
  });

  it('returns false for unsupported platform', async () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    expect(await isKeychainAvailable()).toBe(false);
  });

  it('returns false when command not found', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    asyncMock.mockRejectedValueOnce(new Error('not found'));
    expect(await isKeychainAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// storeSecret
// ---------------------------------------------------------------------------
describe('storeSecret', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns ok on darwin', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const secret = new Uint8Array([1, 2, 3]);
    const result = await storeSecret(secret, { service: 'test', account: 'test' });
    expect(result.ok).toBe(true);
  });

  it('returns error on unsupported platform', async () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    const secret = new Uint8Array([1, 2, 3]);
    const result = await storeSecret(secret, { service: 'test', account: 'test' });
    expect(result.ok).toBe(false);
  });

  it('uses default config when no config provided', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const secret = new Uint8Array([1, 2, 3]);
    const result = await storeSecret(secret);
    expect(result.ok).toBe(true);
  });

  it('handles command failure on darwin', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    // First call (delete-generic-password) can fail, second (add) fails
    asyncMock
      .mockRejectedValueOnce(new Error('not found')) // delete ok to fail
      .mockRejectedValueOnce(new Error('command failed')); // add fails
    const result = await storeSecret(new Uint8Array([1]));
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// retrieveSecret
// ---------------------------------------------------------------------------
describe('retrieveSecret', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns null when stdout is empty on darwin', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    asyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = await retrieveSecret({ service: 'test', account: 'test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('returns decoded secret when found on darwin', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const encoded = Buffer.from(new Uint8Array([1, 2, 3])).toString('base64');
    asyncMock.mockResolvedValueOnce({ stdout: encoded + '\n', stderr: '' });
    const result = await retrieveSecret({ service: 'test', account: 'test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
    }
  });

  it('returns error on unsupported platform', async () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    const result = await retrieveSecret({ service: 'test', account: 'test' });
    expect(result.ok).toBe(false);
  });

  it('returns null when secret not found (command error)', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    asyncMock.mockRejectedValueOnce(new Error('could not be found'));
    const result = await retrieveSecret();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('uses default config when no config provided', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const result = await retrieveSecret();
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteSecret
// ---------------------------------------------------------------------------
describe('deleteSecret', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns ok on darwin', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const result = await deleteSecret({ service: 'test', account: 'test' });
    expect(result.ok).toBe(true);
  });

  it('returns error on unsupported platform', async () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    const result = await deleteSecret({ service: 'test', account: 'test' });
    // default case returns err(), which is NOT thrown, so catch doesn't apply
    expect(result.ok).toBe(false);
  });

  it('catches command failure and returns ok', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    asyncMock.mockRejectedValueOnce(new Error('not found'));
    const result = await deleteSecret({ service: 'test', account: 'test' });
    // The outer catch returns ok(undefined)
    expect(result.ok).toBe(true);
  });

  it('uses default config', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const result = await deleteSecret();
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasSecret
// ---------------------------------------------------------------------------
describe('hasSecret', () => {
  let osMock: typeof import('node:os');

  beforeEach(async () => {
    vi.clearAllMocks();
    asyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    osMock = await import('node:os');
  });

  it('returns false when retrieveSecret returns null', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    asyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    expect(await hasSecret({ service: 'test', account: 'test' })).toBe(false);
  });

  it('returns true when retrieveSecret returns a value', async () => {
    vi.mocked(osMock.platform).mockReturnValue('darwin');
    const encoded = Buffer.from(new Uint8Array([1, 2, 3])).toString('base64');
    asyncMock.mockResolvedValueOnce({ stdout: encoded, stderr: '' });
    expect(await hasSecret({ service: 'test', account: 'test' })).toBe(true);
  });

  it('returns false on unsupported platform', async () => {
    vi.mocked(osMock.platform).mockReturnValue('freebsd' as NodeJS.Platform);
    expect(await hasSecret()).toBe(false);
  });
});
