/**
 * Channel Normalizer Registry Tests
 */

import { describe, it, expect } from 'vitest';
import { getNormalizer, registerNormalizer } from './index.js';
import type { ChannelNormalizer } from './index.js';

describe('getNormalizer', () => {
  it('returns telegram normalizer for "telegram"', () => {
    const n = getNormalizer('telegram');
    expect(n.platform).toBe('telegram');
  });

  it('returns discord normalizer for "discord"', () => {
    const n = getNormalizer('discord');
    expect(n.platform).toBe('discord');
  });

  it('returns whatsapp normalizer for "whatsapp"', () => {
    const n = getNormalizer('whatsapp');
    expect(n.platform).toBe('whatsapp');
  });

  it('returns slack normalizer for "slack"', () => {
    const n = getNormalizer('slack');
    expect(n.platform).toBe('slack');
  });

  it('falls back to base normalizer for unknown platform', () => {
    const n = getNormalizer('unknown-platform-xyz');
    expect(n).toBeDefined();
    expect(typeof n.normalizeIncoming).toBe('function');
    expect(typeof n.normalizeOutgoing).toBe('function');
  });

  it('each built-in normalizer has normalizeIncoming and normalizeOutgoing', () => {
    for (const platform of ['telegram', 'discord', 'whatsapp', 'slack']) {
      const n = getNormalizer(platform);
      expect(typeof n.normalizeIncoming).toBe('function');
      expect(typeof n.normalizeOutgoing).toBe('function');
    }
  });
});

describe('registerNormalizer', () => {
  it('registers a custom normalizer and retrieves it', () => {
    const custom: ChannelNormalizer = {
      platform: 'test-platform',
      normalizeIncoming: (msg) => ({ text: msg.content ?? '' }),
      normalizeOutgoing: (resp) => [resp],
    };

    registerNormalizer(custom);
    const retrieved = getNormalizer('test-platform');
    expect(retrieved).toBe(custom);
  });

  it('overrides existing normalizer for the same platform', () => {
    const override: ChannelNormalizer = {
      platform: 'telegram',
      normalizeIncoming: (msg) => ({ text: `[overridden] ${msg.content ?? ''}` }),
      normalizeOutgoing: (resp) => [`[overridden] ${resp}`],
    };

    registerNormalizer(override);
    const retrieved = getNormalizer('telegram');
    expect(retrieved).toBe(override);

    // Cleanup: restore by re-importing would require module reset, but we can
    // at least verify the override was applied
    const outgoing = retrieved.normalizeOutgoing('hello');
    expect(outgoing[0]).toContain('[overridden]');
  });
});
