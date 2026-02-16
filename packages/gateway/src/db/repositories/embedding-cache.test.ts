/**
 * EmbeddingCacheRepository Tests
 *
 * Tests for content hashing, static method, and type correctness.
 * DB operations tested via integration (not mocked here since BaseRepository is abstract).
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingCacheRepository } from './embedding-cache.js';

describe('EmbeddingCacheRepository', () => {
  describe('contentHash', () => {
    it('produces consistent hash for same content', () => {
      const hash1 = EmbeddingCacheRepository.contentHash('hello world');
      const hash2 = EmbeddingCacheRepository.contentHash('hello world');
      expect(hash1).toBe(hash2);
    });

    it('is case-insensitive', () => {
      const lower = EmbeddingCacheRepository.contentHash('Hello World');
      const upper = EmbeddingCacheRepository.contentHash('hello world');
      expect(lower).toBe(upper);
    });

    it('trims whitespace', () => {
      const trimmed = EmbeddingCacheRepository.contentHash('hello');
      const padded = EmbeddingCacheRepository.contentHash('  hello  ');
      expect(trimmed).toBe(padded);
    });

    it('produces different hashes for different content', () => {
      const hash1 = EmbeddingCacheRepository.contentHash('hello');
      const hash2 = EmbeddingCacheRepository.contentHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('produces a 64-char hex string (SHA-256)', () => {
      const hash = EmbeddingCacheRepository.contentHash('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
