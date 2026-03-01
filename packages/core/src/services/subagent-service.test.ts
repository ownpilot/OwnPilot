/**
 * Subagent Service Core Types Tests
 *
 * Validates exported types, constants, and default values.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SUBAGENT_LIMITS,
  DEFAULT_SUBAGENT_BUDGET,
  MAX_SUBAGENT_DEPTH,
} from './subagent-service.js';

describe('Subagent Core Types', () => {
  describe('DEFAULT_SUBAGENT_LIMITS', () => {
    it('has expected default values', () => {
      expect(DEFAULT_SUBAGENT_LIMITS).toEqual({
        maxTurns: 20,
        maxToolCalls: 100,
        timeoutMs: 120_000,
        maxTokens: 8192,
      });
    });

    it('timeout is 2 minutes', () => {
      expect(DEFAULT_SUBAGENT_LIMITS.timeoutMs).toBe(2 * 60 * 1000);
    });
  });

  describe('DEFAULT_SUBAGENT_BUDGET', () => {
    it('has expected default values', () => {
      expect(DEFAULT_SUBAGENT_BUDGET).toEqual({
        maxConcurrent: 5,
        maxTotalSpawns: 20,
        maxTotalTokens: 0,
      });
    });

    it('maxTotalTokens 0 means unlimited', () => {
      expect(DEFAULT_SUBAGENT_BUDGET.maxTotalTokens).toBe(0);
    });
  });

  describe('MAX_SUBAGENT_DEPTH', () => {
    it('is 2', () => {
      expect(MAX_SUBAGENT_DEPTH).toBe(2);
    });
  });
});
