/**
 * Secure Personal Memory System — Encryption Utilities
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const _AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
export const PBKDF2_DEFAULT_ITERATIONS = 100000;

// =============================================================================
// Encryption Utilities
// =============================================================================

/**
 * Derive encryption key from user password/master key
 * NEVER store the derived key - always derive on demand
 */
export function deriveKey(
  masterKey: string,
  salt: Buffer,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS
): Buffer {
  return pbkdf2Sync(masterKey, salt, iterations, KEY_LENGTH, 'sha512');
}

/**
 * Generate a secure random salt
 */
export function _generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH);
}

/**
 * Hash user ID (for storage without revealing actual ID)
 */
export function hashUserId(userId: string, salt: string): string {
  return createHash('sha256')
    .update(userId + salt)
    .digest('hex');
}

/**
 * Hash content for deduplication (without revealing content)
 */
export function hashContent(content: string, salt: string): string {
  return createHash('sha256')
    .update(content + salt)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Encrypt content with AES-256-GCM
 */
export function encryptContent(
  content: string,
  key: Buffer
): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(content, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Decrypt content
 */
export function decryptContent(
  encrypted: string,
  iv: string,
  authTag: string,
  key: Buffer
): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Securely wipe a buffer (overwrite with zeros)
 */
export function secureWipe(buffer: Buffer): void {
  buffer.fill(0);
}
