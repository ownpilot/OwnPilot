/**
 * ID Generation Utility
 *
 * Generates unique prefixed IDs using cryptographically secure randomness.
 * Replaces the `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` pattern
 * found across 23+ locations in the codebase.
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a unique prefixed ID.
 * Format: `{prefix}_{timestamp}_{random}` (e.g., `task_1707900000000_a3f9b2c1`)
 *
 * @param prefix - Short identifier prefix (e.g., 'task', 'plan', 'goal')
 * @param randomLength - Number of random hex characters (default: 8, giving 4 bytes = ~4 billion unique values)
 */
export function generateId(prefix: string, randomLength = 8): string {
  const bytes = randomBytes(Math.ceil(randomLength / 2));
  const random = bytes.toString('hex').slice(0, randomLength);
  return `${prefix}_${Date.now()}_${random}`;
}
