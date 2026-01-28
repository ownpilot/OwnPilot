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

describe('Key Derivation', () => {
  describe('deriveKey', () => {
    it('derives a CryptoKey from password and salt', async () => {
      const salt = generateSalt();
      const result = await deriveKey('test-password', salt, { iterations: 1000 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('secret');
        expect(result.value.algorithm.name).toBe('AES-GCM');
      }
    });

    it('produces different keys for different passwords', async () => {
      const salt = generateSalt();
      const result1 = await deriveKeyBytes('password1', salt, { iterations: 1000 });
      const result2 = await deriveKeyBytes('password2', salt, { iterations: 1000 });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(toBase64(result1.value)).not.toBe(toBase64(result2.value));
      }
    });

    it('produces different keys for different salts', async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const result1 = await deriveKeyBytes('same-password', salt1, { iterations: 1000 });
      const result2 = await deriveKeyBytes('same-password', salt2, { iterations: 1000 });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(toBase64(result1.value)).not.toBe(toBase64(result2.value));
      }
    });

    it('produces same key for same inputs', async () => {
      const salt = generateSalt();
      const result1 = await deriveKeyBytes('same-password', salt, { iterations: 1000 });
      const result2 = await deriveKeyBytes('same-password', salt, { iterations: 1000 });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(toBase64(result1.value)).toBe(toBase64(result2.value));
      }
    });
  });

  describe('deriveKeyBytes', () => {
    it('derives raw bytes from password and salt', async () => {
      const salt = generateSalt();
      const result = await deriveKeyBytes('test-password', salt, { iterations: 1000 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeInstanceOf(Uint8Array);
        expect(result.value.length).toBe(32); // 256 bits = 32 bytes
      }
    });

    it('respects custom key length', async () => {
      const salt = generateSalt();
      const result = await deriveKeyBytes('test', salt, {
        iterations: 1000,
        keyLength: 512,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(64); // 512 bits = 64 bytes
      }
    });
  });

  describe('generateSalt', () => {
    it('generates 32 bytes by default', () => {
      const salt = generateSalt();
      expect(salt.length).toBe(32);
    });

    it('generates specified length', () => {
      const salt = generateSalt(64);
      expect(salt.length).toBe(64);
    });

    it('generates random values', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(toBase64(salt1)).not.toBe(toBase64(salt2));
    });
  });

  describe('generateIV', () => {
    it('generates 12 bytes', () => {
      const iv = generateIV();
      expect(iv.length).toBe(12);
    });

    it('generates random values', () => {
      const iv1 = generateIV();
      const iv2 = generateIV();
      expect(toBase64(iv1)).not.toBe(toBase64(iv2));
    });
  });

  describe('generateMasterKey', () => {
    it('generates 32 bytes by default', () => {
      const key = generateMasterKey();
      expect(key.length).toBe(32);
    });

    it('generates specified length', () => {
      const key = generateMasterKey(64);
      expect(key.length).toBe(64);
    });
  });

  describe('base64 encoding', () => {
    it('roundtrips correctly', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
      const encoded = toBase64(original);
      const decoded = fromBase64(encoded);

      expect(decoded).toEqual(original);
    });

    it('handles empty array', () => {
      const original = new Uint8Array([]);
      const encoded = toBase64(original);
      const decoded = fromBase64(encoded);

      expect(decoded).toEqual(original);
    });
  });

  describe('hex encoding', () => {
    it('roundtrips correctly', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
      const encoded = toHex(original);
      const decoded = fromHex(encoded);

      expect(decoded).toEqual(original);
      expect(encoded).toBe('0102030405ff8000');
    });
  });

  describe('secureCompare', () => {
    it('returns true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(secureCompare(a, b)).toBe(true);
    });

    it('returns false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(secureCompare(a, b)).toBe(false);
    });

    it('returns false for different lengths', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(secureCompare(a, b)).toBe(false);
    });
  });

  describe('secureClear', () => {
    it('zeroes out the array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      secureClear(data);

      expect(data.every((b) => b === 0)).toBe(true);
    });
  });
});
