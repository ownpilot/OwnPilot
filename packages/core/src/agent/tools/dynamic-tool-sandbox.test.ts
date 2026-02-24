/**
 * Tests for dynamic tool sandbox utilities
 *
 * Covers: createSafeFetch, assertInputSize, assertArraySize, mapPermissions,
 *         createSandboxUtils (all utility helpers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsPrivateUrl = vi.hoisted(() => vi.fn());

vi.mock('./dynamic-tool-permissions.js', () => ({
  isPrivateUrl: mockIsPrivateUrl,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  createSafeFetch,
  assertInputSize,
  assertArraySize,
  mapPermissions,
  createSandboxUtils,
} from './dynamic-tool-sandbox.js';

// =============================================================================
// createSafeFetch
// =============================================================================

describe('createSafeFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
  });

  it('allows public URLs', async () => {
    mockIsPrivateUrl.mockReturnValue(false);
    const safeFetch = createSafeFetch('my_tool');
    await safeFetch('https://api.example.com/data');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/data', undefined);
  });

  it('blocks private URLs with SSRF error', async () => {
    mockIsPrivateUrl.mockReturnValue(true);
    const safeFetch = createSafeFetch('my_tool');
    await expect(safeFetch('http://localhost:8080/admin')).rejects.toThrow('SSRF blocked');
  });

  it('includes tool name in error message', async () => {
    mockIsPrivateUrl.mockReturnValue(true);
    const safeFetch = createSafeFetch('weather_tool');
    await expect(safeFetch('http://127.0.0.1')).rejects.toThrow('weather_tool');
  });

  it('handles URL object input', async () => {
    mockIsPrivateUrl.mockReturnValue(false);
    const safeFetch = createSafeFetch('my_tool');
    const url = new URL('https://example.com/path');
    await safeFetch(url);
    expect(mockIsPrivateUrl).toHaveBeenCalledWith('https://example.com/path');
  });

  it('handles Request object input', async () => {
    mockIsPrivateUrl.mockReturnValue(false);
    const safeFetch = createSafeFetch('my_tool');
    const req = new Request('https://example.com/api');
    await safeFetch(req);
    expect(mockIsPrivateUrl).toHaveBeenCalledWith('https://example.com/api');
  });

  it('passes init options through to real fetch', async () => {
    mockIsPrivateUrl.mockReturnValue(false);
    const safeFetch = createSafeFetch('my_tool');
    const init = { method: 'POST', body: 'data' };
    await safeFetch('https://example.com', init);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', init);
  });
});

// =============================================================================
// assertInputSize
// =============================================================================

describe('assertInputSize', () => {
  it('does not throw for small inputs', () => {
    expect(() => assertInputSize('hello', 'test')).not.toThrow();
  });

  it('does not throw for empty string', () => {
    expect(() => assertInputSize('', 'test')).not.toThrow();
  });

  it('does not throw for exactly 1MB input', () => {
    const input = 'x'.repeat(1_000_000);
    expect(() => assertInputSize(input, 'test')).not.toThrow();
  });

  it('throws for input exceeding 1MB', () => {
    const input = 'x'.repeat(1_000_001);
    expect(() => assertInputSize(input, 'test')).toThrow('exceeds maximum size');
  });

  it('includes function name in error', () => {
    const input = 'x'.repeat(1_000_001);
    expect(() => assertInputSize(input, 'myFunc')).toThrow('myFunc');
  });
});

// =============================================================================
// assertArraySize
// =============================================================================

describe('assertArraySize', () => {
  it('does not throw for small arrays', () => {
    expect(() => assertArraySize([1, 2, 3], 'test')).not.toThrow();
  });

  it('does not throw for empty array', () => {
    expect(() => assertArraySize([], 'test')).not.toThrow();
  });

  it('does not throw for exactly 100_000 elements', () => {
    const arr = new Array(100_000);
    expect(() => assertArraySize(arr, 'test')).not.toThrow();
  });

  it('throws for array exceeding 100_000 elements', () => {
    const arr = new Array(100_001);
    expect(() => assertArraySize(arr, 'test')).toThrow('exceeds maximum size');
  });

  it('includes function name in error', () => {
    const arr = new Array(100_001);
    expect(() => assertArraySize(arr, 'bigArray')).toThrow('bigArray');
  });
});

// =============================================================================
// mapPermissions
// =============================================================================

describe('mapPermissions', () => {
  it('returns all false for empty permissions', () => {
    const result = mapPermissions([]);
    expect(result.network).toBe(false);
    expect(result.fsRead).toBe(false);
    expect(result.fsWrite).toBe(false);
    expect(result.spawn).toBe(false);
    expect(result.env).toBe(false);
  });

  it('maps network permission', () => {
    const result = mapPermissions(['network']);
    expect(result.network).toBe(true);
    expect(result.fsRead).toBe(false);
    expect(result.fsWrite).toBe(false);
    expect(result.spawn).toBe(false);
  });

  it('maps filesystem permission to fsRead and fsWrite', () => {
    const result = mapPermissions(['filesystem']);
    expect(result.fsRead).toBe(true);
    expect(result.fsWrite).toBe(true);
    expect(result.network).toBe(false);
    expect(result.spawn).toBe(false);
  });

  it('maps shell permission to spawn', () => {
    const result = mapPermissions(['shell']);
    expect(result.spawn).toBe(true);
    expect(result.network).toBe(false);
    expect(result.fsRead).toBe(false);
  });

  it('maps local permission to fsRead, fsWrite, and spawn', () => {
    const result = mapPermissions(['local']);
    expect(result.fsRead).toBe(true);
    expect(result.fsWrite).toBe(true);
    expect(result.spawn).toBe(true);
  });

  it('handles database permission without setting raw permissions', () => {
    const result = mapPermissions(['database']);
    expect(result.network).toBe(false);
    expect(result.fsRead).toBe(false);
    expect(result.fsWrite).toBe(false);
    expect(result.spawn).toBe(false);
  });

  it('handles email permission without setting raw permissions', () => {
    const result = mapPermissions(['email']);
    expect(result.network).toBe(false);
    expect(result.fsRead).toBe(false);
  });

  it('handles scheduling permission without setting raw permissions', () => {
    const result = mapPermissions(['scheduling']);
    expect(result.network).toBe(false);
    expect(result.fsRead).toBe(false);
  });

  it('combines multiple permissions', () => {
    const result = mapPermissions(['network', 'filesystem', 'shell']);
    expect(result.network).toBe(true);
    expect(result.fsRead).toBe(true);
    expect(result.fsWrite).toBe(true);
    expect(result.spawn).toBe(true);
  });

  it('handles all permissions together', () => {
    const result = mapPermissions([
      'network',
      'filesystem',
      'shell',
      'local',
      'database',
      'email',
      'scheduling',
    ]);
    expect(result.network).toBe(true);
    expect(result.fsRead).toBe(true);
    expect(result.fsWrite).toBe(true);
    expect(result.spawn).toBe(true);
    expect(result.env).toBe(false);
  });
});

// =============================================================================
// createSandboxUtils
// =============================================================================

describe('createSandboxUtils', () => {
  let utils: ReturnType<typeof createSandboxUtils>;

  beforeEach(() => {
    utils = createSandboxUtils();
  });

  // --- Hashing ---

  describe('hash', () => {
    it('returns sha256 hash by default', () => {
      const result = utils.hash('hello');
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns md5 hash when specified', () => {
      const result = utils.hash('hello', 'md5');
      expect(result).toMatch(/^[a-f0-9]{32}$/);
    });

    it('throws for oversized input', () => {
      expect(() => utils.hash('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  // --- UUID ---

  describe('uuid', () => {
    it('returns a valid UUID string', () => {
      const result = utils.uuid();
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  // --- Encoding/Decoding ---

  describe('base64Encode', () => {
    it('encodes a string to base64', () => {
      expect(utils.base64Encode('hello')).toBe('aGVsbG8=');
    });

    it('throws for oversized input', () => {
      expect(() => utils.base64Encode('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('base64Decode', () => {
    it('decodes base64 back to string', () => {
      expect(utils.base64Decode('aGVsbG8=')).toBe('hello');
    });

    it('throws for oversized input', () => {
      expect(() => utils.base64Decode('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('urlEncode', () => {
    it('encodes special characters', () => {
      expect(utils.urlEncode('hello world')).toBe('hello%20world');
    });
  });

  describe('urlDecode', () => {
    it('decodes URL-encoded string', () => {
      expect(utils.urlDecode('hello%20world')).toBe('hello world');
    });
  });

  describe('hexEncode', () => {
    it('encodes string to hex', () => {
      expect(utils.hexEncode('hi')).toBe('6869');
    });

    it('throws for oversized input', () => {
      expect(() => utils.hexEncode('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('hexDecode', () => {
    it('decodes hex to string', () => {
      expect(utils.hexDecode('6869')).toBe('hi');
    });

    it('throws for oversized input', () => {
      expect(() => utils.hexDecode('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  // --- Date/Time ---

  describe('now', () => {
    it('returns an ISO date string', () => {
      const result = utils.now();
      expect(new Date(result).toISOString()).toBe(result);
    });
  });

  describe('timestamp', () => {
    it('returns a number', () => {
      expect(typeof utils.timestamp()).toBe('number');
    });
  });

  describe('dateDiff', () => {
    it('returns difference in days by default', () => {
      const result = utils.dateDiff('2026-01-01', '2026-01-03');
      expect(result).toBe(2);
    });

    it('returns difference in hours', () => {
      const result = utils.dateDiff('2026-01-01T00:00:00Z', '2026-01-01T06:00:00Z', 'hours');
      expect(result).toBe(6);
    });

    it('returns difference in minutes', () => {
      const result = utils.dateDiff('2026-01-01T00:00:00Z', '2026-01-01T00:30:00Z', 'minutes');
      expect(result).toBe(30);
    });

    it('returns difference in seconds', () => {
      const result = utils.dateDiff('2026-01-01T00:00:00Z', '2026-01-01T00:00:45Z', 'seconds');
      expect(result).toBe(45);
    });

    it('returns difference in weeks', () => {
      const result = utils.dateDiff('2026-01-01', '2026-01-15', 'weeks');
      expect(result).toBe(2);
    });

    it('uses days for unknown unit', () => {
      const result = utils.dateDiff('2026-01-01', '2026-01-03', 'unknown_unit');
      expect(result).toBe(2);
    });
  });

  describe('dateAdd', () => {
    it('adds days by default', () => {
      const result = utils.dateAdd('2026-01-01T00:00:00.000Z', 5);
      expect(result).toContain('2026-01-06');
    });

    it('adds seconds', () => {
      const result = utils.dateAdd('2026-01-01T00:00:00.000Z', 30, 'seconds');
      expect(result).toContain('00:00:30');
    });

    it('adds minutes', () => {
      const result = utils.dateAdd('2026-01-01T00:00:00.000Z', 15, 'minutes');
      expect(result).toContain('00:15:00');
    });

    it('adds hours', () => {
      const result = utils.dateAdd('2026-01-01T00:00:00.000Z', 3, 'hours');
      expect(result).toContain('03:00:00');
    });

    it('adds weeks', () => {
      const result = utils.dateAdd('2026-01-01T00:00:00.000Z', 2, 'weeks');
      expect(result).toContain('2026-01-15');
    });

    it('adds months', () => {
      const result = utils.dateAdd('2026-01-15T00:00:00.000Z', 2, 'months');
      expect(result).toContain('2026-03');
    });

    it('adds years', () => {
      const result = utils.dateAdd('2026-01-15T00:00:00.000Z', 1, 'years');
      expect(result).toContain('2027');
    });

    it('handles "now" as date', () => {
      const result = utils.dateAdd('now', 1, 'days');
      expect(new Date(result).getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('returns original date for unrecognized unit', () => {
      const result = utils.dateAdd('2026-06-15T00:00:00.000Z', 5, 'bananas');
      // No switch case matches, so date is unchanged
      expect(result).toContain('2026-06-15');
    });
  });

  describe('formatDate', () => {
    it('formats date with default locale', () => {
      const result = utils.formatDate('2026-06-15T00:00:00.000Z');
      // Should include the day, month, year in some human-readable form
      expect(result).toContain('2026');
    });

    it('formats date with custom locale', () => {
      // Just verify it does not throw
      const result = utils.formatDate('2026-06-15T00:00:00.000Z', 'de-DE');
      expect(typeof result).toBe('string');
    });
  });

  // --- Text ---

  describe('slugify', () => {
    it('converts text to slug', () => {
      expect(utils.slugify('Hello World!')).toBe('hello-world');
    });

    it('removes diacritics', () => {
      expect(utils.slugify('cafe\u0301')).toBe('cafe');
    });

    it('handles leading/trailing hyphens', () => {
      expect(utils.slugify('-hello-')).toBe('hello');
    });

    it('throws for oversized input', () => {
      expect(() => utils.slugify('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('camelCase', () => {
    it('converts text to camelCase', () => {
      expect(utils.camelCase('hello world')).toBe('helloWorld');
    });

    it('handles hyphenated text', () => {
      expect(utils.camelCase('my-var-name')).toBe('myVarName');
    });
  });

  describe('snakeCase', () => {
    it('converts camelCase to snake_case', () => {
      expect(utils.snakeCase('helloWorld')).toBe('hello_world');
    });

    it('converts spaces to underscores', () => {
      expect(utils.snakeCase('hello world')).toBe('hello_world');
    });

    it('converts hyphens to underscores', () => {
      expect(utils.snakeCase('hello-world')).toBe('hello_world');
    });
  });

  describe('kebabCase', () => {
    it('converts camelCase to kebab-case', () => {
      expect(utils.kebabCase('helloWorld')).toBe('hello-world');
    });

    it('converts spaces to hyphens', () => {
      expect(utils.kebabCase('hello world')).toBe('hello-world');
    });

    it('converts underscores to hyphens', () => {
      expect(utils.kebabCase('hello_world')).toBe('hello-world');
    });
  });

  describe('titleCase', () => {
    it('converts text to Title Case', () => {
      expect(utils.titleCase('hello world')).toBe('Hello World');
    });
  });

  describe('truncate', () => {
    it('returns text unchanged when shorter than limit', () => {
      expect(utils.truncate('hello', 10)).toBe('hello');
    });

    it('truncates text with default suffix', () => {
      expect(utils.truncate('hello world this is long', 10)).toBe('hello w...');
    });

    it('truncates with custom suffix', () => {
      expect(utils.truncate('abcdefghij', 5, '~')).toBe('abcd~');
    });
  });

  describe('countWords', () => {
    it('counts words in a string', () => {
      expect(utils.countWords('hello world foo')).toBe(3);
    });

    it('returns 0 for empty string', () => {
      expect(utils.countWords('')).toBe(0);
    });

    it('handles multiple spaces', () => {
      expect(utils.countWords('  hello   world  ')).toBe(2);
    });
  });

  describe('removeDiacritics', () => {
    it('removes diacritics from text', () => {
      expect(utils.removeDiacritics('cafe\u0301')).toBe('cafe');
    });

    it('handles text without diacritics', () => {
      expect(utils.removeDiacritics('hello')).toBe('hello');
    });
  });

  // --- Validation ---

  describe('isEmail', () => {
    it('returns true for valid email', () => {
      expect(utils.isEmail('user@example.com')).toBe(true);
    });

    it('returns false for invalid email', () => {
      expect(utils.isEmail('not-an-email')).toBe(false);
    });
  });

  describe('isUrl', () => {
    it('returns true for valid URL', () => {
      expect(utils.isUrl('https://example.com')).toBe(true);
    });

    it('returns false for invalid URL', () => {
      expect(utils.isUrl('not a url')).toBe(false);
    });
  });

  describe('isJson', () => {
    it('returns true for valid JSON', () => {
      expect(utils.isJson('{"a":1}')).toBe(true);
    });

    it('returns false for invalid JSON', () => {
      expect(utils.isJson('{broken')).toBe(false);
    });
  });

  describe('isUuid', () => {
    it('returns true for valid UUID', () => {
      expect(utils.isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('returns false for invalid UUID', () => {
      expect(utils.isUuid('not-a-uuid')).toBe(false);
    });
  });

  // --- Math ---

  describe('clamp', () => {
    it('clamps value to min', () => {
      expect(utils.clamp(-5, 0, 10)).toBe(0);
    });

    it('clamps value to max', () => {
      expect(utils.clamp(15, 0, 10)).toBe(10);
    });

    it('returns value when within range', () => {
      expect(utils.clamp(5, 0, 10)).toBe(5);
    });
  });

  describe('round', () => {
    it('rounds to 2 decimals by default', () => {
      expect(utils.round(3.14159)).toBe(3.14);
    });

    it('rounds to specified decimals', () => {
      expect(utils.round(3.14159, 4)).toBe(3.1416);
    });
  });

  describe('randomInt', () => {
    it('returns a number within default range', () => {
      const result = utils.randomInt();
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('returns a number within specified range', () => {
      const result = utils.randomInt(10, 20);
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(20);
    });
  });

  describe('sum', () => {
    it('sums an array of numbers', () => {
      expect(utils.sum([1, 2, 3, 4])).toBe(10);
    });

    it('returns 0 for empty array', () => {
      expect(utils.sum([])).toBe(0);
    });

    it('throws for oversized array', () => {
      expect(() => utils.sum(new Array(100_001).fill(1))).toThrow('exceeds maximum size');
    });
  });

  describe('avg', () => {
    it('calculates average', () => {
      expect(utils.avg([2, 4, 6])).toBe(4);
    });

    it('returns 0 for empty array', () => {
      expect(utils.avg([])).toBe(0);
    });

    it('throws for oversized array', () => {
      expect(() => utils.avg(new Array(100_001).fill(1))).toThrow('exceeds maximum size');
    });
  });

  // --- Data ---

  describe('parseJson', () => {
    it('parses valid JSON', () => {
      expect(utils.parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('throws for invalid JSON', () => {
      expect(() => utils.parseJson('{broken')).toThrow();
    });

    it('throws for oversized input', () => {
      expect(() => utils.parseJson('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('toJson', () => {
    it('converts data to JSON string', () => {
      expect(utils.toJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    });

    it('uses custom indent', () => {
      expect(utils.toJson({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
    });

    it('throws for oversized output', () => {
      const bigObj: Record<string, string> = {};
      for (let i = 0; i < 50000; i++) {
        bigObj[`key${i}`] = 'x'.repeat(20);
      }
      expect(() => utils.toJson(bigObj)).toThrow('exceeds maximum size');
    });
  });

  describe('parseCsv', () => {
    it('parses CSV data', () => {
      const csv = 'name,age\nAlice,30\nBob,25';
      const result = utils.parseCsv(csv);
      expect(result).toEqual([
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '25' },
      ]);
    });

    it('returns empty array for CSV with only header', () => {
      const csv = 'name,age';
      expect(utils.parseCsv(csv)).toEqual([]);
    });

    it('returns empty array for empty CSV', () => {
      expect(utils.parseCsv('')).toEqual([]);
    });

    it('handles custom delimiter', () => {
      const csv = 'name;age\nAlice;30';
      const result = utils.parseCsv(csv, ';');
      expect(result).toEqual([{ name: 'Alice', age: '30' }]);
    });

    it('handles missing values', () => {
      const csv = 'a,b,c\n1,,3';
      const result = utils.parseCsv(csv);
      expect(result[0]).toEqual({ a: '1', b: '', c: '3' });
    });

    it('throws for oversized input', () => {
      expect(() => utils.parseCsv('x'.repeat(1_000_001))).toThrow('exceeds maximum size');
    });
  });

  describe('flatten', () => {
    it('flattens a nested object', () => {
      const result = utils.flatten({ a: { b: { c: 1 } }, d: 2 });
      expect(result).toEqual({ 'a.b.c': 1, d: 2 });
    });

    it('handles arrays as values', () => {
      const result = utils.flatten({ a: [1, 2] });
      expect(result).toEqual({ a: [1, 2] });
    });

    it('returns empty object for empty input', () => {
      expect(utils.flatten({})).toEqual({});
    });

    it('handles custom prefix', () => {
      const result = utils.flatten({ x: 1 }, 'root');
      expect(result).toEqual({ 'root.x': 1 });
    });
  });

  describe('getPath', () => {
    it('gets a nested value', () => {
      expect(utils.getPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
    });

    it('handles array index notation', () => {
      expect(utils.getPath({ items: ['a', 'b', 'c'] }, 'items[1]')).toBe('b');
    });

    it('returns undefined for missing path', () => {
      expect(utils.getPath({ a: 1 }, 'b.c')).toBeUndefined();
    });

    it('returns undefined for null intermediate', () => {
      expect(utils.getPath({ a: null }, 'a.b')).toBeUndefined();
    });

    it('returns undefined when traversing primitive', () => {
      expect(utils.getPath({ a: 'string' }, 'a.b')).toBeUndefined();
    });
  });

  // --- Array ---

  describe('unique', () => {
    it('removes duplicates', () => {
      expect(utils.unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    });

    it('throws for oversized array', () => {
      expect(() => utils.unique(new Array(100_001).fill(1))).toThrow('exceeds maximum size');
    });
  });

  describe('chunk', () => {
    it('splits array into chunks', () => {
      expect(utils.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('handles exact division', () => {
      expect(utils.chunk([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('throws for oversized array', () => {
      expect(() => utils.chunk(new Array(100_001).fill(1), 10)).toThrow('exceeds maximum size');
    });
  });

  describe('shuffle', () => {
    it('returns an array of the same length', () => {
      const arr = [1, 2, 3, 4, 5];
      const result = utils.shuffle(arr);
      expect(result).toHaveLength(5);
    });

    it('contains the same elements', () => {
      const arr = [1, 2, 3, 4, 5];
      const result = utils.shuffle(arr);
      expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not mutate original array', () => {
      const arr = [1, 2, 3];
      utils.shuffle(arr);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('throws for oversized array', () => {
      expect(() => utils.shuffle(new Array(100_001).fill(1))).toThrow('exceeds maximum size');
    });
  });

  describe('sample', () => {
    it('returns 1 element by default', () => {
      const result = utils.sample([1, 2, 3]);
      expect(result).toHaveLength(1);
    });

    it('returns n elements', () => {
      const result = utils.sample([1, 2, 3, 4, 5], 3);
      expect(result).toHaveLength(3);
    });

    it('throws for oversized array', () => {
      expect(() => utils.sample(new Array(100_001).fill(1))).toThrow('exceeds maximum size');
    });
  });

  describe('groupBy', () => {
    it('groups by key', () => {
      const items = [
        { type: 'a', value: 1 },
        { type: 'b', value: 2 },
        { type: 'a', value: 3 },
      ];
      const result = utils.groupBy(items, 'type');
      expect(result.a).toHaveLength(2);
      expect(result.b).toHaveLength(1);
    });

    it('throws for oversized array', () => {
      expect(() => utils.groupBy(new Array(100_001).fill({ k: 'v' }), 'k')).toThrow(
        'exceeds maximum size'
      );
    });
  });

  // --- Password ---

  describe('generatePassword', () => {
    it('generates password of default length 16', () => {
      expect(utils.generatePassword()).toHaveLength(16);
    });

    it('generates password of specified length', () => {
      expect(utils.generatePassword(32)).toHaveLength(32);
    });

    it('generates different passwords each time', () => {
      const a = utils.generatePassword();
      const b = utils.generatePassword();
      // Very unlikely to be the same
      expect(a).not.toBe(b);
    });
  });
});
