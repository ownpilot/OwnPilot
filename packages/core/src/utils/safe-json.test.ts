/**
 * Tests for safe-json.ts
 *
 * Covers all exported functions across all code paths:
 * - safeJsonParse: null/undefined input, valid/invalid JSON, onError callback
 * - safeJsonParseWithDefault: null/undefined, valid/invalid JSON
 * - safeJsonStringify: valid/invalid values, onError callback
 * - isValidJson: valid/invalid strings
 */

import { describe, it, expect, vi } from 'vitest';

const { safeJsonParse, safeJsonParseWithDefault, safeJsonStringify, isValidJson } =
  await import('./safe-json.js');

// ============================================================================
// safeJsonParse
// ============================================================================

describe('safeJsonParse', () => {
  it('returns fallback when input is null', () => {
    const result = safeJsonParse(null, { fallback: 'fallback' });
    expect(result).toBe('fallback');
  });

  it('returns fallback when input is undefined', () => {
    const result = safeJsonParse(undefined, { fallback: { key: 'val' } });
    expect(result).toEqual({ key: 'val' });
  });

  it('parses valid JSON string', () => {
    const result = safeJsonParse<{ name: string }>('{"name":"test"}');
    expect(result).toEqual({ name: 'test' });
  });

  it('returns undefined for invalid JSON without fallback', () => {
    const result = safeJsonParse('{invalid}');
    expect(result).toBeUndefined();
  });

  it('returns fallback for invalid JSON with fallback', () => {
    const result = safeJsonParse('{invalid}', { fallback: { name: 'default' } });
    expect(result).toEqual({ name: 'default' });
  });

  it('calls onError callback when parsing fails', () => {
    const onError = vi.fn();
    const result = safeJsonParse('not-json', { fallback: 'fb', onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'not-json');
    expect(result).toBe('fb');
  });

  it('does not call onError when parsing succeeds', () => {
    const onError = vi.fn();
    const result = safeJsonParse('{"ok":true}', { onError });
    expect(onError).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('handles empty string as invalid JSON', () => {
    const result = safeJsonParse('', { fallback: 'empty' });
    expect(result).toBe('empty');
  });

  it('parses JSON primitives (number)', () => {
    const result = safeJsonParse<number>('42');
    expect(result).toBe(42);
  });

  it('parses JSON primitives (string)', () => {
    const result = safeJsonParse<string>('"hello"');
    expect(result).toBe('hello');
  });

  it('parses JSON arrays', () => {
    const result = safeJsonParse<number[]>('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// safeJsonParseWithDefault
// ============================================================================

describe('safeJsonParseWithDefault', () => {
  it('returns default when input is null', () => {
    const result = safeJsonParseWithDefault<number[]>(null, []);
    expect(result).toEqual([]);
  });

  it('returns default when input is undefined', () => {
    const result = safeJsonParseWithDefault(null, {});
    expect(result).toEqual({});
  });

  it('parses valid JSON string', () => {
    const result = safeJsonParseWithDefault<{ a: number }>('{"a":1}', { a: 0 });
    expect(result).toEqual({ a: 1 });
  });

  it('returns default for invalid JSON', () => {
    const result = safeJsonParseWithDefault('{{{', []);
    expect(result).toEqual([]);
  });

  it('returns default for empty string', () => {
    const result = safeJsonParseWithDefault('', 'default');
    expect(result).toBe('default');
  });

  it('parses nested JSON objects', () => {
    const result = safeJsonParseWithDefault<{ deep: { value: string } }>(
      '{"deep":{"value":"nested"}}',
      { deep: { value: '' } }
    );
    expect(result).toEqual({ deep: { value: 'nested' } });
  });
});

// ============================================================================
// safeJsonStringify
// ============================================================================

describe('safeJsonStringify', () => {
  it('stringifies a plain object', () => {
    const result = safeJsonStringify({ a: 1, b: 'two' });
    expect(result).toBe('{"a":1,"b":"two"}');
  });

  it('returns fallback when stringification fails', () => {
    // Circular reference causes stringify to throw
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = safeJsonStringify(circular, { fallback: '{}' });
    expect(result).toBe('{}');
  });

  it('calls onError callback when stringification fails', () => {
    const onError = vi.fn();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = safeJsonStringify(circular, { fallback: 'fb', onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result).toBe('fb');
  });

  it('returns undefined for failing stringify without fallback', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = safeJsonStringify(circular);
    expect(result).toBeUndefined();
  });

  it('stringifies with space formatting', () => {
    const result = safeJsonStringify({ a: 1 }, { space: 2 });
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('stringifies null values', () => {
    const result = safeJsonStringify(null);
    expect(result).toBe('null');
  });

  it('handles BigInt (throws, should fall back)', () => {
    // BigInt is not serializable in JSON
    const result = safeJsonStringify({ big: BigInt(123) }, { fallback: 'fallback' });
    expect(result).toBe('fallback');
  });
});

// ============================================================================
// isValidJson
// ============================================================================

describe('isValidJson', () => {
  it('returns true for a valid JSON object', () => {
    expect(isValidJson('{"key":"value"}')).toBe(true);
  });

  it('returns true for a valid JSON array', () => {
    expect(isValidJson('[1,2,3]')).toBe(true);
  });

  it('returns true for a JSON primitive', () => {
    expect(isValidJson('"string"')).toBe(true);
    expect(isValidJson('42')).toBe(true);
    expect(isValidJson('true')).toBe(true);
    expect(isValidJson('null')).toBe(true);
  });

  it('returns false for invalid JSON', () => {
    expect(isValidJson('{invalid}')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidJson('')).toBe(false);
  });

  it('returns false for garbage text', () => {
    expect(isValidJson('not json at all')).toBe(false);
  });

  it('returns false for malformed JSON', () => {
    expect(isValidJson('{"key": undefined}')).toBe(false);
  });
});
