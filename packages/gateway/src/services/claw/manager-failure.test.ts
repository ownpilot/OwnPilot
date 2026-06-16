/**
 * Tests for manager-failure.ts — failure-log helpers.
 *
 * Pure functions that truncate and stringify tool results for safe
 * inclusion in reflection prompts and session logs.
 */

import { describe, it, expect } from 'vitest';
import { stringifyToolResult, truncateForFailureLog } from './manager-failure.js';

describe('manager-failure helpers', () => {
  describe('stringifyToolResult', () => {
    it('returns strings unchanged', () => {
      expect(stringifyToolResult('hello world')).toBe('hello world');
    });

    it('JSON-stringifies objects', () => {
      expect(stringifyToolResult({ foo: 'bar' })).toBe('{"foo":"bar"}');
    });

    it('JSON-stringifies arrays', () => {
      expect(stringifyToolResult([1, 2, 3])).toBe('[1,2,3]');
    });

    it('stringifies numbers', () => {
      expect(stringifyToolResult(42)).toBe('42');
    });

    it('stringifies null', () => {
      expect(stringifyToolResult(null)).toBe('null');
    });

    it('returns undefined for undefined input (JSON.stringify quirk)', () => {
      // JSON.stringify(undefined) returns undefined (not "undefined"),
      // which technically violates the string return type — known edge case
      const result = stringifyToolResult(undefined);
      expect(result).toBeUndefined();
    });

    it('falls back to String() for circular references', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      // JSON.stringify throws on circular → falls back to String()
      const result = stringifyToolResult(circular);
      expect(result).toContain('object');
    });
  });

  describe('truncateForFailureLog', () => {
    it('returns short strings unchanged', () => {
      expect(truncateForFailureLog('short')).toBe('short');
    });

    it('returns strings at exactly the max length unchanged', () => {
      const exact = 'a'.repeat(300);
      expect(truncateForFailureLog(exact)).toBe(exact);
    });

    it('truncates strings over the max length', () => {
      const long = 'a'.repeat(500);
      const result = truncateForFailureLog(long);
      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain('[truncated]');
    });

    it('respects custom max parameter', () => {
      const long = 'a'.repeat(100);
      const result = truncateForFailureLog(long, 10);
      expect(result).toBe('aaaaaaaaaa… [truncated]');
    });

    it('handles empty string', () => {
      expect(truncateForFailureLog('')).toBe('');
    });
  });
});
