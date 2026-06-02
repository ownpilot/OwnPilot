/**
 * ID Generation Utility
 *
 * Generates unique prefixed IDs using cryptographically secure randomness.
 * Replaces the `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` pattern
 * found across 23+ locations in the codebase.
 *
 * Plan 15 Step 1 (ID-001): the previous format embedded `Date.now()` in
 * the public ID, leaking approximate creation time, and used only 8 hex
 * characters (32 bits) of randomness — brute-forceable within a known
 * time window. The new format is:
 *
 *   `{prefix}_{24 hex chars}`           (e.g., `task_4a1b2c3d4e5f60718293a4b5c`)
 *
 * 24 hex characters = 12 bytes = 96 bits of CSPRNG entropy. At a
 * billion rows the collision probability is ~ 10⁻¹⁶, well below
 * any realistic risk. The timestamp is *not* part of the public ID;
 * call sites that need creation time should record it alongside the
 * ID in their own metadata.
 */

import { randomBytes } from 'node:crypto';

/** Default length of the random hex segment (24 hex = 12 bytes = 96 bits). */
const DEFAULT_RANDOM_LENGTH = 24;

/**
 * Generate a unique prefixed ID.
 *
 * Format: `{prefix}_{24 hex chars}` (e.g., `task_4a1b2c3d4e5f60718293a4b5c`).
 *
 * The returned ID is opaque — it does NOT embed a creation timestamp.
 * If your caller needs creation time, store it as a separate field.
 *
 * @param prefix - Short identifier prefix (e.g., 'task', 'plan', 'goal')
 * @param randomLength - Number of random hex characters (default: 24 = 96 bits).
 *   Callers that need shorter IDs (e.g., for display) can pass a smaller
 *   value, but the default is the recommended setting for protocol IDs.
 */
export function generateId(prefix: string, randomLength = DEFAULT_RANDOM_LENGTH): string {
  // Round up to the nearest byte — randomBytes can't return half-bytes.
  const byteCount = Math.ceil(randomLength / 2);
  const bytes = randomBytes(byteCount);
  const random = bytes.toString('hex').slice(0, randomLength);
  return `${prefix}_${random}`;
}
