/**
 * Channel Normalizer Types
 *
 * Shared type definitions extracted to avoid circular imports
 * between base.ts and index.ts.
 */

import type { ChannelIncomingMessage, NormalizedAttachment } from '@ownpilot/core';

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
  normalizeIncoming(msg: ChannelIncomingMessage): NormalizedIncoming | Promise<NormalizedIncoming>;

  /**
   * Normalize the outgoing agent response for the target platform.
   * Strips internal tags, converts markdown, enforces length limits, etc.
   * Returns an array of message parts (split if necessary).
   */
  normalizeOutgoing(response: string): string[];
}
