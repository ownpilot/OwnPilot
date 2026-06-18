/**
 * Tests for the secure personal-memory encryption primitives.
 *
 * These guard the cryptographic invariants of the AES-256-GCM + PBKDF2 layer
 * (round-trip correctness, key derivation determinism, tamper detection, IV
 * uniqueness) — security-critical code that previously had no coverage, so a
 * future refactor that weakens it (e.g. drops the auth tag, reuses an IV, or
 * changes the KDF) fails loudly here.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  deriveKey,
  encryptContent,
  decryptContent,
  hashUserId,
  hashContent,
  secureWipe,
  PBKDF2_DEFAULT_ITERATIONS,
} from './encryption.js';

const salt = Buffer.from('a'.repeat(64), 'hex');
const key = deriveKey('master-password', salt);

describe('deriveKey', () => {
  it('derives a 32-byte (256-bit) key', () => {
    expect(key).toHaveLength(32);
  });

  it('is deterministic for the same inputs', () => {
    expect(deriveKey('pw', salt).equals(deriveKey('pw', salt))).toBe(true);
  });

  it('produces a different key for a different password or salt', () => {
    expect(deriveKey('pw1', salt).equals(deriveKey('pw2', salt))).toBe(false);
    const otherSalt = Buffer.from('b'.repeat(64), 'hex');
    expect(deriveKey('pw', salt).equals(deriveKey('pw', otherSalt))).toBe(false);
  });

  it('uses a strong default iteration count', () => {
    expect(PBKDF2_DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });
});

describe('encryptContent / decryptContent', () => {
  it('round-trips arbitrary content', () => {
    const plaintext = 'sensitive memory: 🔐 contains unicode & symbols';
    const { encrypted, iv, authTag } = encryptContent(plaintext, key);
    expect(decryptContent(encrypted, iv, authTag, key)).toBe(plaintext);
  });

  it('does not leak plaintext into the ciphertext', () => {
    const { encrypted } = encryptContent('TOPSECRET', key);
    expect(encrypted).not.toContain('TOPSECRET');
  });

  it('uses a fresh IV per call (no IV reuse with the same key)', () => {
    const a = encryptContent('same plaintext', key);
    const b = encryptContent('same plaintext', key);
    expect(a.iv).not.toBe(b.iv);
    // Identical plaintext + key but different IV → different ciphertext.
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it('fails (tamper detection) when the ciphertext is altered', () => {
    const { encrypted, iv, authTag } = encryptContent('integrity', key);
    const flipped = Buffer.from(encrypted, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptContent(flipped.toString('base64'), iv, authTag, key)).toThrow();
  });

  it('fails when the auth tag is altered', () => {
    const { encrypted, iv, authTag } = encryptContent('integrity', key);
    const badTag = Buffer.from(authTag, 'base64');
    badTag[0] ^= 0xff;
    expect(() => decryptContent(encrypted, iv, badTag.toString('base64'), key)).toThrow();
  });

  it('fails when decrypted with the wrong key', () => {
    const { encrypted, iv, authTag } = encryptContent('integrity', key);
    const wrongKey = deriveKey('master-password', salt, PBKDF2_DEFAULT_ITERATIONS);
    wrongKey[0] ^= 0xff; // perturb one byte
    expect(() => decryptContent(encrypted, iv, authTag, wrongKey)).toThrow();
  });
});

describe('hashUserId / hashContent', () => {
  it('hashUserId is deterministic and salt-dependent', () => {
    expect(hashUserId('user-1', 's')).toBe(hashUserId('user-1', 's'));
    expect(hashUserId('user-1', 's1')).not.toBe(hashUserId('user-1', 's2'));
  });

  it('hashContent returns a short stable digest and is salt-dependent', () => {
    expect(hashContent('content', 's')).toHaveLength(16);
    expect(hashContent('content', 's')).toBe(hashContent('content', 's'));
    expect(hashContent('content', 's1')).not.toBe(hashContent('content', 's2'));
  });
});

describe('secureWipe', () => {
  it('zeroes the buffer in place', () => {
    const buf = randomBytes(16);
    secureWipe(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
