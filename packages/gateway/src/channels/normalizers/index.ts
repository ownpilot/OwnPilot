/**
 * Channel Normalizer Registry
 *
 * Unified interface for converting platform-specific messages
 * to/from the internal chat format.
 */

import { telegramNormalizer } from './telegram.js';
import { discordNormalizer } from './discord.js';
import { whatsappNormalizer } from './whatsapp.js';
import { slackNormalizer } from './slack.js';
import { baseNormalizer, createBaseNormalizer } from './base.js';
import { PLATFORM_MESSAGE_LIMITS } from '../utils/message-utils.js';
import type { ChannelNormalizer } from './types.js';

// Re-export types from types.ts for backward compatibility
export type { NormalizedIncoming, ChannelNormalizer } from './types.js';

// ============================================================================
// Registry
// ============================================================================

const normalizers = new Map<string, ChannelNormalizer>();

// Register built-in normalizers
normalizers.set('telegram', telegramNormalizer);
normalizers.set('discord', discordNormalizer);
normalizers.set('whatsapp', whatsappNormalizer);
normalizers.set('slack', slackNormalizer);
// Length-limited pass-through normalizers for platforms without bespoke
// markdown handling. SMS/Matrix split long replies; email keeps the base
// (unsplit) normalizer via the fallback in getNormalizer().
normalizers.set('sms', createBaseNormalizer('sms', PLATFORM_MESSAGE_LIMITS.sms));
normalizers.set('matrix', createBaseNormalizer('matrix', PLATFORM_MESSAGE_LIMITS.matrix));

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
