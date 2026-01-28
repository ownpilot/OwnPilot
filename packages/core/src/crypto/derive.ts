/**
 * Key derivation using PBKDF2
 * OWASP 2023 recommendation: 600,000 iterations for SHA-256
 * Uses Node.js built-in crypto module (webcrypto)
 */

import { webcrypto } from 'node:crypto';
import { type Result, ok, err } from '../types/result.js';
import { CryptoError } from '../types/errors.js';

// Use Node.js webcrypto directly - properly typed in @types/node
const crypto = webcrypto;

// Type alias for CryptoKey from Node.js webcrypto
type CryptoKeyType = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

/**
 * Key derivation options
 */
export interface KeyDerivationOptions {
  /** PBKDF2 iterations (default: 600,000 - OWASP 2023) */
  iterations?: number;
  /** Hash algorithm (default: SHA-256) */
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** Key length in bits (default: 256 for AES-256) */
  keyLength?: number;
}

const DEFAULT_OPTIONS: Required<KeyDerivationOptions> = {
  iterations: 600_000,
  hash: 'SHA-256',
  keyLength: 256,
};

/**
 * Derive a cryptographic key from a password using PBKDF2
 *
 * @param password - The password to derive from
 * @param salt - The salt (should be 32 bytes random)
 * @param options - Derivation options
 * @returns The derived key as CryptoKey
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  options: KeyDerivationOptions = {}
): Promise<Result<CryptoKeyType, CryptoError>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Import password as raw key material
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive the actual key
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: opts.iterations,
        hash: opts.hash,
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: opts.keyLength,
      },
      true, // extractable (needed for export in some cases)
      ['encrypt', 'decrypt']
    );

    return ok(derivedKey);
  } catch (error) {
    return err(
      new CryptoError('derive', 'Key derivation failed', {
        cause: error,
      })
    );
  }
}

/**
 * Derive raw key bytes from a password using PBKDF2
 *
 * @param password - The password to derive from
 * @param salt - The salt (should be 32 bytes random)
 * @param options - Derivation options
 * @returns The derived key as Uint8Array
 */
export async function deriveKeyBytes(
  password: string,
  salt: Uint8Array,
  options: KeyDerivationOptions = {}
): Promise<Result<Uint8Array, CryptoError>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: opts.iterations,
        hash: opts.hash,
      },
      passwordKey,
      opts.keyLength
    );

    return ok(new Uint8Array(bits));
  } catch (error) {
    return err(
      new CryptoError('derive', 'Key derivation failed', {
        cause: error,
      })
    );
  }
}

/**
 * Generate a random salt
 *
 * @param length - Salt length in bytes (default: 32)
 * @returns Random salt as Uint8Array
 */
export function generateSalt(length: number = 32): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generate a random IV for AES-GCM
 *
 * @returns Random 12-byte IV (recommended for AES-GCM)
 */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Generate a random master key (for initial setup)
 *
 * @param length - Key length in bytes (default: 32 for 256 bits)
 * @returns Random key as Uint8Array
 */
export function generateMasterKey(length: number = 32): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert Uint8Array to base64 string
 */
export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Convert base64 string to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex');
}

/**
 * Convert hex string to Uint8Array
 */
export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Securely compare two byte arrays in constant time
 * Prevents timing attacks
 */
export function secureCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }

  return result === 0;
}

/**
 * Securely clear sensitive data from memory
 * Note: This is best-effort as JS doesn't guarantee memory clearing
 */
export function secureClear(data: Uint8Array): void {
  crypto.getRandomValues(data); // Overwrite with random data
  data.fill(0); // Then fill with zeros
}
