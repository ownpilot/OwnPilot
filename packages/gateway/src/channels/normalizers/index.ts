/**
 * Channel Normalizer Registry
 *
 * Unified interface for converting platform-specific messages
 * to/from the internal chat format.
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';
import { telegramNormalizer } from './telegram.js';
import { baseNormalizer } from './base.js';

// ============================================================================
// Types
// ============================================================================

export interface NormalizedIncoming {
  /** Cleaned text content */
  text: string;
  /** Normalized attachments (base64-encoded data URIs) */
  attachments?: NormalizedAttachment[];
}

export interface ChannelNormalizer {
  /** Platform identifier */
  platform: string;

  /**
   * Normalize an incoming channel message into a clean text + attachments pair.
   * Handles platform-specific HTML entities, command prefixes, etc.
   */
  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming;

  /**
   * Normalize the outgoing agent response for the target platform.
   * Strips internal tags, converts markdown, enforces length limits, etc.
   * Returns an array of message parts (split if necessary).
   */
  normalizeOutgoing(response: string): string[];
}

// ============================================================================
// Registry
// ============================================================================

const normalizers = new Map<string, ChannelNormalizer>();

// Register built-in normalizers
normalizers.set('telegram', telegramNormalizer);

/**
 * Get the normalizer for a given platform.
 * Falls back to the base normalizer if no platform-specific one exists.
 */
export function getNormalizer(platform: string): ChannelNormalizer {
  return normalizers.get(platform) ?? baseNormalizer;
}

/**
 * Register a custom normalizer for a platform.
 */
export function registerNormalizer(normalizer: ChannelNormalizer): void {
  normalizers.set(normalizer.platform, normalizer);
}
