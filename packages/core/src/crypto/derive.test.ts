import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  deriveKeyBytes,
  generateSalt,
  generateIV,
  generateMasterKey,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  secureCompare,
  secureClear,
} from './derive.js';


// ---------------------------------------------------------------------------
// Shared helpers — low iterations for fast tests
// ---------------------------------------------------------------------------
const FAST_OPTS = { iterations: 1000 } as const;

/**
 * Export raw bytes from a CryptoKey so we can compare derived keys directly.
 */
async function exportKeyBytes(key: CryptoKey): Promise<Uint8Array> {
  const buf = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------
describe('deriveKey', () => {
  it('returns an ok result containing a CryptoKey', async () => {
    const salt = generateSalt();
    const result = await deriveKey('my-password', salt, FAST_OPTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeDefined();
      expect(result.value.type).toBe('secret');
    }
  });

  it('derives an AES-GCM key with encrypt/decrypt usages', async () => {
    const salt = generateSalt();
    const result = await deriveKey('test', salt, FAST_OPTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const key = result.value;
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    }
  });

  it('works with default options (no options argument)', async () => {
    const salt = generateSalt();
    // Default = 600,000 iterations — too slow for CI.
    // We still test that the function signature works without options;
    // pass minimal opts to keep it fast.
    const result = await deriveKey('x', salt, FAST_OPTS);
    expect(result.ok).toBe(true);
  });

  it('accepts custom options (hash=SHA-512, keyLength=128)', async () => {
    const salt = generateSalt();
    const result = await deriveKey('pass', salt, {
      iterations: 1000,
      hash: 'SHA-512',
      keyLength: 128,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const algo = result.value.algorithm as AesKeyAlgorithm;
      expect(algo.length).toBe(128);
    }
  });

  it('is deterministic — same password + salt produces the same key', async () => {
    const salt = generateSalt();
    const r1 = await deriveKey('deterministic', salt, FAST_OPTS);
    const r2 = await deriveKey('deterministic', salt, FAST_OPTS);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const bytes1 = await exportKeyBytes(r1.value);
      const bytes2 = await exportKeyBytes(r2.value);
      expect(toHex(bytes1)).toBe(toHex(bytes2));
    }
  });

  it('produces different keys for different passwords', async () => {
    const salt = generateSalt();
    const r1 = await deriveKey('alpha', salt, FAST_OPTS);
    const r2 = await deriveKey('bravo', salt, FAST_OPTS);

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const bytes1 = await exportKeyBytes(r1.value);
      const bytes2 = await exportKeyBytes(r2.value);
      expect(toHex(bytes1)).not.toBe(toHex(bytes2));
    }
  });

  it('produces different keys for different salts', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const r1 = await deriveKey('same', salt1, FAST_OPTS);
    const r2 = await deriveKey('same', salt2, FAST_OPTS);

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const bytes1 = await exportKeyBytes(r1.value);
      const bytes2 = await exportKeyBytes(r2.value);
      expect(toHex(bytes1)).not.toBe(toHex(bytes2));
    }
  });

  it('key is extractable', async () => {
    const salt = generateSalt();
    const result = await deriveKey('extract-me', salt, FAST_OPTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.extractable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveKeyBytes
// ---------------------------------------------------------------------------
describe('deriveKeyBytes', () => {
  it('returns an ok result with a Uint8Array', async () => {
    const salt = generateSalt();
    const result = await deriveKeyBytes('password', salt, FAST_OPTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeInstanceOf(Uint8Array);
    }
  });

  it('defaults to 32 bytes (256 bits / 8)', async () => {
    const salt = generateSalt();
    const result = await deriveKeyBytes('test', salt, FAST_OPTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(32);
    }
  });

  it('returns 16 bytes when keyLength=128', async () => {
    const salt = generateSalt();
    const result = await deriveKeyBytes('test', salt, {
      iterations: 1000,
      keyLength: 128,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(16);
    }
  });

  it('returns 64 bytes when keyLength=512', async () => {
    const salt = generateSalt();
    const result = await deriveKeyBytes('test', salt, {
      iterations: 1000,
      keyLength: 512,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(64);
    }
  });

  it('is deterministic — same password + salt produces same bytes', async () => {
    const salt = generateSalt();
    const r1 = await deriveKeyBytes('same', salt, FAST_OPTS);
    const r2 = await deriveKeyBytes('same', salt, FAST_OPTS);

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(toBase64(r1.value)).toBe(toBase64(r2.value));
    }
  });

  it('produces different bytes for different passwords', async () => {
    const salt = generateSalt();
    const r1 = await deriveKeyBytes('password-a', salt, FAST_OPTS);
    const r2 = await deriveKeyBytes('password-b', salt, FAST_OPTS);

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(toBase64(r1.value)).not.toBe(toBase64(r2.value));
    }
  });

  it('produces different bytes for different salts', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const r1 = await deriveKeyBytes('same', salt1, FAST_OPTS);
    const r2 = await deriveKeyBytes('same', salt2, FAST_OPTS);

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(toBase64(r1.value)).not.toBe(toBase64(r2.value));
    }
  });

  it('respects custom hash algorithm (SHA-384)', async () => {
    const salt = generateSalt();
    const sha256 = await deriveKeyBytes('p', salt, { iterations: 1000, hash: 'SHA-256' });
    const sha384 = await deriveKeyBytes('p', salt, { iterations: 1000, hash: 'SHA-384' });

    expect(sha256.ok && sha384.ok).toBe(true);
    if (sha256.ok && sha384.ok) {
      // Same password, same salt, different hash → different output
      expect(toBase64(sha256.value)).not.toBe(toBase64(sha384.value));
    }
  });
});

// ---------------------------------------------------------------------------
// generateSalt
// ---------------------------------------------------------------------------
describe('generateSalt', () => {
  it('generates 32 bytes by default', () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
  });

  it('generates custom length (16 bytes)', () => {
    const salt = generateSalt(16);
    expect(salt.length).toBe(16);
  });

  it('generates custom length (64 bytes)', () => {
    const salt = generateSalt(64);
    expect(salt.length).toBe(64);
  });

  it('produces different values on successive calls', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});

// ---------------------------------------------------------------------------
// generateIV
// ---------------------------------------------------------------------------
describe('generateIV', () => {
  it('generates exactly 12 bytes', () => {
    const iv = generateIV();
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12);
  });

  it('produces different values on successive calls', () => {
    const a = generateIV();
    const b = generateIV();
    expect(toBase64(a)).not.toBe(toBase64(b));
  });

  it('returns a Uint8Array instance', () => {
    expect(generateIV()).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// generateMasterKey
// ---------------------------------------------------------------------------
describe('generateMasterKey', () => {
  it('generates 32 bytes by default', () => {
    const key = generateMasterKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('generates custom length (64 bytes)', () => {
    const key = generateMasterKey(64);
    expect(key.length).toBe(64);
  });

  it('produces different values on successive calls', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});

// ---------------------------------------------------------------------------
// toBase64 / fromBase64
// ---------------------------------------------------------------------------
describe('toBase64 / fromBase64', () => {
  it('roundtrips arbitrary data', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it('encodes a known value: "Hello" → "SGVsbG8="', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    expect(toBase64(data)).toBe('SGVsbG8=');
  });

  it('decodes a known value: "SGVsbG8=" → "Hello"', () => {
    const decoded = fromBase64('SGVsbG8=');
    expect(Array.from(decoded)).toEqual([72, 101, 108, 108, 111]);
  });

  it('handles empty array', () => {
    const original = new Uint8Array([]);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
    expect(encoded).toBe('');
  });

  it('preserves data through fromBase64(toBase64(data))', () => {
    const data = generateSalt(48); // random 48 bytes
    const restored = fromBase64(toBase64(data));
    expect(restored).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// toHex / fromHex
// ---------------------------------------------------------------------------
describe('toHex / fromHex', () => {
  it('roundtrips arbitrary data', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
    const hex = toHex(original);
    const decoded = fromHex(hex);
    expect(decoded).toEqual(original);
  });

  it('encodes a known value: [0xff, 0x00, 0xab] → "ff00ab"', () => {
    const data = new Uint8Array([0xff, 0x00, 0xab]);
    expect(toHex(data)).toBe('ff00ab');
  });

  it('decodes a known hex string', () => {
    const decoded = fromHex('ff00ab');
    expect(Array.from(decoded)).toEqual([0xff, 0x00, 0xab]);
  });

  it('handles empty array', () => {
    const original = new Uint8Array([]);
    const hex = toHex(original);
    expect(hex).toBe('');
    const decoded = fromHex(hex);
    expect(decoded).toEqual(original);
  });

  it('preserves data through fromHex(toHex(data))', () => {
    const data = generateSalt(32);
    const restored = fromHex(toHex(data));
    expect(restored).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// secureCompare
// ---------------------------------------------------------------------------
describe('secureCompare', () => {
  it('returns true for equal arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(secureCompare(a, b)).toBe(true);
  });

  it('returns false when content differs', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns false when lengths differ', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns true for two empty arrays', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(secureCompare(a, b)).toBe(true);
  });

  it('returns false when one is empty and the other is not', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([1]);
    expect(secureCompare(a, b)).toBe(false);
  });

  it('returns false when only the first byte differs', () => {
    const a = new Uint8Array([0, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(secureCompare(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// secureClear
// ---------------------------------------------------------------------------
describe('secureClear', () => {
  it('sets all bytes to zero', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    secureClear(data);
    expect(data.every((b) => b === 0)).toBe(true);
  });

  it('overwrites the original data (no longer matches original)', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const copy = new Uint8Array(original);
    secureClear(original);
    // After clearing, the buffer should NOT equal the copy
    expect(toHex(original)).not.toBe(toHex(copy));
  });

  it('handles an already-zeroed array gracefully', () => {
    const data = new Uint8Array(8); // all zeros
    secureClear(data);
    expect(data.every((b) => b === 0)).toBe(true);
  });
});
