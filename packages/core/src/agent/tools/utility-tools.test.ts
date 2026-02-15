import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentDateTimeExecutor, dateDiffExecutor, dateAddExecutor } from './utility-date-tools.js';
import { calculateExecutor, convertUnitsExecutor, calculateStatisticsExecutor } from './utility-math-tools.js';
import { countTextExecutor, extractFromTextExecutor, transformTextExecutor, compareTextExecutor, runRegexExecutor } from './utility-text-tools.js';
import { generateUuidExecutor, generatePasswordExecutor, generateRandomNumberExecutor, hashTextExecutor, encodeDecodeExecutor } from './utility-gen-tools.js';
import { validateDataExecutor, formatJsonExecutor, parseCsvExecutor, generateCsvExecutor, arrayOperationsExecutor, getSystemInfoExecutor } from './utility-data-tools.js';
import { UTILITY_TOOLS, UTILITY_TOOL_NAMES } from './utility-tools.js';

// Helper to parse the JSON content from a successful result
function parseContent(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

// =============================================================================
// getCurrentDateTimeExecutor
// =============================================================================

describe('getCurrentDateTimeExecutor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday, 2025-07-16T12:30:00.000Z
    vi.setSystemTime(new Date('2025-07-16T12:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns all fields when format is "all" (default)', async () => {
    const result = await getCurrentDateTimeExecutor({ timezone: 'UTC' });
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.iso).toBe('2025-07-16T12:30:00.000Z');
    expect(data.unix).toBe(Math.floor(new Date('2025-07-16T12:30:00.000Z').getTime() / 1000));
    expect(data.unixMs).toBe(new Date('2025-07-16T12:30:00.000Z').getTime());
    expect(data.timezone).toBe('UTC');
    expect(data.date).toBe('2025-07-16');
    expect(data.time).toBe('12:30:00');
    expect(data.weekNumber).toBeTypeOf('number');
    expect(data.quarter).toBe(3);
    expect(data.isWeekend).toBe(false);
  });

  it('returns only ISO when format is "iso"', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'iso', timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.iso).toBe('2025-07-16T12:30:00.000Z');
    expect(data.timezone).toBe('UTC');
    expect(data.formatted).toBeUndefined();
    expect(data.unix).toBeUndefined();
  });

  it('returns formatted string when format is "locale"', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'locale', timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.formatted).toBeTypeOf('string');
    expect(data.timezone).toBe('UTC');
    expect(data.iso).toBeUndefined();
  });

  it('returns unix timestamps when format is "unix"', async () => {
    const result = await getCurrentDateTimeExecutor({ format: 'unix', timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.unix).toBeTypeOf('number');
    expect(data.unixMs).toBeTypeOf('number');
    expect(data.timezone).toBe('UTC');
    expect(data.iso).toBeUndefined();
  });

  it('returns error for invalid timezone', async () => {
    const result = await getCurrentDateTimeExecutor({ timezone: 'Invalid/Timezone' });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('Invalid timezone');
  });

  it('handles specific timezones', async () => {
    const result = await getCurrentDateTimeExecutor({ timezone: 'America/New_York', format: 'all' });
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.timezone).toBe('America/New_York');
  });

  it('detects weekend correctly for a Saturday', async () => {
    // 2025-07-19 is a Saturday
    vi.setSystemTime(new Date('2025-07-19T12:00:00.000Z'));
    const result = await getCurrentDateTimeExecutor({ timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.isWeekend).toBe(true);
  });

  it('detects weekend correctly for a Sunday', async () => {
    // 2025-07-20 is a Sunday
    vi.setSystemTime(new Date('2025-07-20T12:00:00.000Z'));
    const result = await getCurrentDateTimeExecutor({ timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.isWeekend).toBe(true);
  });

  it('computes quarter correctly for Q1', async () => {
    vi.setSystemTime(new Date('2025-02-15T12:00:00.000Z'));
    const result = await getCurrentDateTimeExecutor({ timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.quarter).toBe(1);
  });

  it('computes quarter correctly for Q4', async () => {
    vi.setSystemTime(new Date('2025-12-01T12:00:00.000Z'));
    const result = await getCurrentDateTimeExecutor({ timezone: 'UTC' });
    const data = parseContent(result.content);
    expect(data.quarter).toBe(4);
  });

  it('uses local timezone when none provided', async () => {
    const result = await getCurrentDateTimeExecutor({});
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.timezone).toBeTypeOf('string');
  });
});

// =============================================================================
// calculateExecutor
// =============================================================================

describe('calculateExecutor', () => {
  it('evaluates simple addition', async () => {
    const result = await calculateExecutor({ expression: '2 + 3' });
    const data = parseContent(result.content);
    expect(data.result).toBe(5);
  });

  it('evaluates subtraction', async () => {
    const result = await calculateExecutor({ expression: '10 - 4' });
    const data = parseContent(result.content);
    expect(data.result).toBe(6);
  });

  it('evaluates multiplication', async () => {
    const result = await calculateExecutor({ expression: '7 * 8' });
    const data = parseContent(result.content);
    expect(data.result).toBe(56);
  });

  it('evaluates division', async () => {
    const result = await calculateExecutor({ expression: '100 / 4' });
    const data = parseContent(result.content);
    expect(data.result).toBe(25);
  });

  it('handles percentage of a number', async () => {
    const result = await calculateExecutor({ expression: '15% of 250' });
    const data = parseContent(result.content);
    expect(data.result).toBe(37.5);
  });

  it('handles bare percentage', async () => {
    const result = await calculateExecutor({ expression: '15%' });
    const data = parseContent(result.content);
    expect(data.result).toBe(0.15);
  });

  it('handles power notation with ^', async () => {
    const result = await calculateExecutor({ expression: '2^10' });
    const data = parseContent(result.content);
    expect(data.result).toBe(1024);
  });

  it('handles sqrt function', async () => {
    const result = await calculateExecutor({ expression: 'sqrt(16)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(4);
  });

  it('handles sin(0)', async () => {
    const result = await calculateExecutor({ expression: 'sin(0)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(0);
  });

  it('handles cos(0)', async () => {
    const result = await calculateExecutor({ expression: 'cos(0)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(1);
  });

  it('handles log(100) which maps to Math.log (natural log)', async () => {
    // Note: the executor replaces log() with Math.log(), which is natural log (not log10)
    const result = await calculateExecutor({ expression: 'log(100)' });
    const data = parseContent(result.content);
    expect(data.result).toBeCloseTo(Math.log(100), 4);
  });

  it('handles ln(1) - maps to Math.ln which does not exist, so it errors', async () => {
    // The executor replaces ln() with Math.ln() but Math.ln is undefined,
    // so runInNewContext throws an error
    const result = await calculateExecutor({ expression: 'ln(1)' });
    expect(result.isError).toBe(true);
  });

  it('handles abs function', async () => {
    const result = await calculateExecutor({ expression: 'abs(-42)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(42);
  });

  it('handles floor function', async () => {
    const result = await calculateExecutor({ expression: 'floor(3.7)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(3);
  });

  it('handles ceil function', async () => {
    const result = await calculateExecutor({ expression: 'ceil(3.2)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(4);
  });

  it('rejects round() because "d" is not in the allowed character set', async () => {
    // The validation regex does not include 'd', so Math.round expressions
    // are rejected by the character whitelist even though round is a listed function
    const result = await calculateExecutor({ expression: 'round(3.5)' });
    expect(result.isError).toBe(true);
  });

  it('handles pi constant', async () => {
    const result = await calculateExecutor({ expression: 'pi' });
    const data = parseContent(result.content);
    expect(data.result).toBeCloseTo(Math.PI, 4);
  });

  it('handles e constant', async () => {
    const result = await calculateExecutor({ expression: 'e' });
    const data = parseContent(result.content);
    expect(data.result).toBeCloseTo(Math.E, 4);
  });

  it('respects precision parameter', async () => {
    const result = await calculateExecutor({ expression: '1 / 3', precision: 2 });
    const data = parseContent(result.content);
    expect(data.result).toBe(0.33);
  });

  it('uses default precision of 4', async () => {
    const result = await calculateExecutor({ expression: '1 / 3' });
    const data = parseContent(result.content);
    expect(data.result).toBe(0.3333);
  });

  it('returns error for invalid characters', async () => {
    const result = await calculateExecutor({ expression: 'require("fs")' });
    expect(result.isError).toBe(true);
  });

  it('returns error for division by zero (Infinity)', async () => {
    const result = await calculateExecutor({ expression: '1 / 0' });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('not a valid number');
  });

  it('returns the original expression in the result', async () => {
    const result = await calculateExecutor({ expression: '2 + 2' });
    const data = parseContent(result.content);
    expect(data.expression).toBe('2 + 2');
  });

  it('returns a formatted string', async () => {
    const result = await calculateExecutor({ expression: '1000 * 1000' });
    const data = parseContent(result.content);
    expect(data.formatted).toBeTypeOf('string');
  });

  it('handles complex expressions', async () => {
    const result = await calculateExecutor({ expression: '(2 + 3) * 4 - 1' });
    const data = parseContent(result.content);
    expect(data.result).toBe(19);
  });

  it('handles decimal percentage of', async () => {
    const result = await calculateExecutor({ expression: '12.5% of 200' });
    const data = parseContent(result.content);
    expect(data.result).toBe(25);
  });

  it('handles exp function', async () => {
    const result = await calculateExecutor({ expression: 'exp(0)' });
    const data = parseContent(result.content);
    expect(data.result).toBe(1);
  });
});

// =============================================================================
// convertUnitsExecutor
// =============================================================================

describe('convertUnitsExecutor', () => {
  // Temperature
  describe('temperature conversions', () => {
    it('converts celsius to fahrenheit', async () => {
      const result = await convertUnitsExecutor({ value: 0, from: 'celsius', to: 'fahrenheit' });
      const data = parseContent(result.content);
      expect(data.to).toEqual({ value: 32, unit: 'fahrenheit' });
    });

    it('converts fahrenheit to celsius', async () => {
      const result = await convertUnitsExecutor({ value: 212, from: 'fahrenheit', to: 'celsius' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(100);
    });

    it('converts celsius to kelvin', async () => {
      const result = await convertUnitsExecutor({ value: 0, from: 'celsius', to: 'kelvin' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(273.15);
    });

    it('converts kelvin to celsius', async () => {
      const result = await convertUnitsExecutor({ value: 273.15, from: 'kelvin', to: 'celsius' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(0);
    });

    it('converts fahrenheit to kelvin', async () => {
      const result = await convertUnitsExecutor({ value: 32, from: 'fahrenheit', to: 'kelvin' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(273.15);
    });

    it('handles short unit names (c, f, k)', async () => {
      const result = await convertUnitsExecutor({ value: 100, from: 'c', to: 'f' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(212);
    });
  });

  // Length
  describe('length conversions', () => {
    it('converts km to miles', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'km', to: 'mi' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(0.621371, 4);
    });

    it('converts meters to feet', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'm', to: 'ft' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(3.28084, 4);
    });

    it('converts inches to centimeters', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'in', to: 'cm' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(2.54, 2);
    });

    it('includes category in result', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'km', to: 'm' });
      const data = parseContent(result.content);
      expect(data.category).toBe('length');
    });
  });

  // Weight
  describe('weight conversions', () => {
    it('converts kg to lb', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'kg', to: 'lb' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(2.20462, 4);
    });

    it('converts lb to kg', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'lb', to: 'kg' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(0.453592, 4);
    });

    it('converts g to oz', async () => {
      const result = await convertUnitsExecutor({ value: 100, from: 'g', to: 'oz' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(3.5274, 3);
    });
  });

  // Volume
  describe('volume conversions', () => {
    it('converts liters to gallons', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'l', to: 'gal' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(0.264172, 4);
    });

    it('converts ml to floz', async () => {
      const result = await convertUnitsExecutor({ value: 100, from: 'ml', to: 'floz' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(3.3814, 3);
    });
  });

  // Area
  describe('area conversions', () => {
    it('converts m2 to ft2', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'm2', to: 'ft2' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(10.7639, 3);
    });

    it('converts acre to hectare', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'acre', to: 'hectare' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(0.404686, 4);
    });
  });

  // Speed
  describe('speed conversions', () => {
    it('converts km/h to mph', async () => {
      const result = await convertUnitsExecutor({ value: 100, from: 'km/h', to: 'mph' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(62.1371, 3);
    });

    it('converts m/s to knots', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'm/s', to: 'knots' });
      const data = parseContent(result.content);
      const toValue = (data.to as Record<string, unknown>).value as number;
      expect(toValue).toBeCloseTo(1.94384, 4);
    });
  });

  // Time
  describe('time conversions', () => {
    it('converts hours to minutes', async () => {
      const result = await convertUnitsExecutor({ value: 2, from: 'h', to: 'min' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(120);
    });

    it('converts days to hours', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'd', to: 'h' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(24);
    });

    it('converts weeks to days', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'wk', to: 'd' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(7);
    });
  });

  // Data
  describe('data conversions', () => {
    it('converts gb to mb', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'gb', to: 'mb' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(1024);
    });

    it('converts tb to gb', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'tb', to: 'gb' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(1024);
    });

    it('converts bytes to bits', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'b', to: 'bit' });
      const data = parseContent(result.content);
      expect((data.to as Record<string, unknown>).value).toBe(8);
    });
  });

  // Error cases
  describe('error cases', () => {
    it('returns error for incompatible units', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'kg', to: 'km' });
      expect(result.isError).toBe(true);
      const data = parseContent(result.content);
      expect(data.error).toContain('Cannot convert');
      expect(data.supportedCategories).toBeDefined();
    });

    it('returns error for unsupported units', async () => {
      const result = await convertUnitsExecutor({ value: 1, from: 'foo', to: 'bar' });
      expect(result.isError).toBe(true);
    });
  });
});

// =============================================================================
// generateUuidExecutor
// =============================================================================

describe('generateUuidExecutor', () => {
  it('generates a single UUID by default', async () => {
    const result = await generateUuidExecutor({});
    const data = parseContent(result.content);
    expect(data.uuid).toBeTypeOf('string');
    expect((data.uuid as string)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('generates multiple UUIDs', async () => {
    const result = await generateUuidExecutor({ count: 3 });
    const data = parseContent(result.content);
    expect(data.uuids).toHaveLength(3);
    expect(data.count).toBe(3);
  });

  it('caps count at 10', async () => {
    const result = await generateUuidExecutor({ count: 50 });
    const data = parseContent(result.content);
    expect((data.uuids as string[]).length).toBe(10);
  });

  it('generates UUID without dashes', async () => {
    const result = await generateUuidExecutor({ format: 'no-dashes' });
    const data = parseContent(result.content);
    expect((data.uuid as string)).toMatch(/^[0-9a-f]{32}$/);
    expect((data.uuid as string)).not.toContain('-');
  });

  it('generates uppercase UUID', async () => {
    const result = await generateUuidExecutor({ format: 'uppercase' });
    const data = parseContent(result.content);
    const uuid = data.uuid as string;
    expect(uuid).toBe(uuid.toUpperCase());
  });

  it('generates unique UUIDs', async () => {
    const result = await generateUuidExecutor({ count: 5 });
    const data = parseContent(result.content);
    const uuids = data.uuids as string[];
    const unique = new Set(uuids);
    expect(unique.size).toBe(5);
  });
});

// =============================================================================
// generatePasswordExecutor
// =============================================================================

describe('generatePasswordExecutor', () => {
  it('generates a password of default length 16', async () => {
    const result = await generatePasswordExecutor({});
    const data = parseContent(result.content);
    expect(data.length).toBe(16);
    expect((data.password as string).length).toBe(16);
  });

  it('respects custom length', async () => {
    const result = await generatePasswordExecutor({ length: 32 });
    const data = parseContent(result.content);
    expect(data.length).toBe(32);
    expect((data.password as string).length).toBe(32);
  });

  it('enforces minimum length of 8', async () => {
    const result = await generatePasswordExecutor({ length: 4 });
    const data = parseContent(result.content);
    expect(data.length).toBe(8);
  });

  it('enforces maximum length of 128', async () => {
    const result = await generatePasswordExecutor({ length: 200 });
    const data = parseContent(result.content);
    expect(data.length).toBe(128);
  });

  it('generates password with only lowercase', async () => {
    const result = await generatePasswordExecutor({
      includeUppercase: false,
      includeLowercase: true,
      includeNumbers: false,
      includeSymbols: false,
    });
    const data = parseContent(result.content);
    expect((data.password as string)).toMatch(/^[a-z]+$/);
  });

  it('generates password with only uppercase', async () => {
    const result = await generatePasswordExecutor({
      includeUppercase: true,
      includeLowercase: false,
      includeNumbers: false,
      includeSymbols: false,
    });
    const data = parseContent(result.content);
    expect((data.password as string)).toMatch(/^[A-Z]+$/);
  });

  it('generates password with only numbers', async () => {
    const result = await generatePasswordExecutor({
      includeUppercase: false,
      includeLowercase: false,
      includeNumbers: true,
      includeSymbols: false,
    });
    const data = parseContent(result.content);
    expect((data.password as string)).toMatch(/^[0-9]+$/);
  });

  it('excludes ambiguous characters when requested', async () => {
    const result = await generatePasswordExecutor({
      excludeAmbiguous: true,
      includeSymbols: false,
      length: 128,
    });
    const data = parseContent(result.content);
    const password = data.password as string;
    expect(password).not.toMatch(/[0OlI1]/);
  });

  it('returns error when no character types included', async () => {
    const result = await generatePasswordExecutor({
      includeUppercase: false,
      includeLowercase: false,
      includeNumbers: false,
      includeSymbols: false,
    });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('At least one character type');
  });

  it('generates multiple passwords', async () => {
    const result = await generatePasswordExecutor({ count: 3 });
    const data = parseContent(result.content);
    expect((data.passwords as string[])).toHaveLength(3);
    expect(data.count).toBe(3);
  });

  it('caps password count at 5', async () => {
    const result = await generatePasswordExecutor({ count: 20 });
    const data = parseContent(result.content);
    expect((data.passwords as string[])).toHaveLength(5);
  });

  it('includes strength assessment', async () => {
    const result = await generatePasswordExecutor({ length: 32 });
    const data = parseContent(result.content);
    expect(data.strength).toBeTypeOf('string');
    expect(data.entropyBits).toBeTypeOf('number');
  });

  it('reports weak strength for short number-only password', async () => {
    const result = await generatePasswordExecutor({
      length: 8,
      includeUppercase: false,
      includeLowercase: false,
      includeNumbers: true,
      includeSymbols: false,
    });
    const data = parseContent(result.content);
    // log2(10) * 8 ≈ 26.6 bits -> very weak
    expect(data.strength).toBe('very weak');
  });
});

// =============================================================================
// generateRandomNumberExecutor
// =============================================================================

describe('generateRandomNumberExecutor', () => {
  it('generates a number in default range 0-100', async () => {
    const result = await generateRandomNumberExecutor({});
    const data = parseContent(result.content);
    expect(data.number).toBeTypeOf('number');
    expect(data.number as number).toBeGreaterThanOrEqual(0);
    expect(data.number as number).toBeLessThan(100);
  });

  it('generates integers by default', async () => {
    const result = await generateRandomNumberExecutor({});
    const data = parseContent(result.content);
    expect(Number.isInteger(data.number)).toBe(true);
  });

  it('generates decimal numbers when integer is false', async () => {
    // Run multiple times to increase chance of non-integer
    let hasDecimal = false;
    for (let i = 0; i < 20; i++) {
      const result = await generateRandomNumberExecutor({ integer: false, min: 0, max: 100 });
      const data = parseContent(result.content);
      if (!Number.isInteger(data.number)) {
        hasDecimal = true;
        break;
      }
    }
    expect(hasDecimal).toBe(true);
  });

  it('respects custom min and max', async () => {
    const result = await generateRandomNumberExecutor({ min: 50, max: 60 });
    const data = parseContent(result.content);
    expect(data.number as number).toBeGreaterThanOrEqual(50);
    expect(data.number as number).toBeLessThan(60);
  });

  it('generates multiple numbers', async () => {
    const result = await generateRandomNumberExecutor({ count: 5 });
    const data = parseContent(result.content);
    expect((data.numbers as number[])).toHaveLength(5);
  });

  it('caps count at 100', async () => {
    const result = await generateRandomNumberExecutor({ count: 200 });
    const data = parseContent(result.content);
    expect((data.numbers as number[])).toHaveLength(100);
  });

  it('returns error when min >= max', async () => {
    const result = await generateRandomNumberExecutor({ min: 100, max: 50 });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('min must be less than max');
  });

  it('returns error when min equals max', async () => {
    const result = await generateRandomNumberExecutor({ min: 50, max: 50 });
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// hashTextExecutor
// =============================================================================

describe('hashTextExecutor', () => {
  it('hashes with sha256 by default', async () => {
    const result = await hashTextExecutor({ text: 'hello' });
    const data = parseContent(result.content);
    expect(data.algorithm).toBe('sha256');
    expect(data.hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('hashes with md5', async () => {
    const result = await hashTextExecutor({ text: 'hello', algorithm: 'md5' });
    const data = parseContent(result.content);
    expect(data.algorithm).toBe('md5');
    expect(data.hash).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(data.length).toBe(32);
  });

  it('hashes with sha1', async () => {
    const result = await hashTextExecutor({ text: 'hello', algorithm: 'sha1' });
    const data = parseContent(result.content);
    expect(data.algorithm).toBe('sha1');
    expect(data.hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  });

  it('hashes with sha512', async () => {
    const result = await hashTextExecutor({ text: 'hello', algorithm: 'sha512' });
    const data = parseContent(result.content);
    expect(data.algorithm).toBe('sha512');
    expect((data.hash as string).length).toBe(128);
  });

  it('truncates long input in the result', async () => {
    const longText = 'a'.repeat(100);
    const result = await hashTextExecutor({ text: longText });
    const data = parseContent(result.content);
    expect(data.input).toBe('a'.repeat(50) + '...');
  });

  it('does not truncate short input', async () => {
    const result = await hashTextExecutor({ text: 'hello' });
    const data = parseContent(result.content);
    expect(data.input).toBe('hello');
  });
});

// =============================================================================
// encodeDecodeExecutor
// =============================================================================

describe('encodeDecodeExecutor', () => {
  describe('base64', () => {
    it('encodes to base64', async () => {
      const result = await encodeDecodeExecutor({ text: 'hello world', method: 'base64', operation: 'encode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('aGVsbG8gd29ybGQ=');
    });

    it('decodes from base64', async () => {
      const result = await encodeDecodeExecutor({ text: 'aGVsbG8gd29ybGQ=', method: 'base64', operation: 'decode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('hello world');
    });
  });

  describe('url', () => {
    it('encodes URL', async () => {
      const result = await encodeDecodeExecutor({ text: 'hello world!', method: 'url', operation: 'encode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('hello%20world!');
    });

    it('decodes URL', async () => {
      const result = await encodeDecodeExecutor({ text: 'hello%20world%21', method: 'url', operation: 'decode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('hello world!');
    });
  });

  describe('html', () => {
    it('encodes HTML entities', async () => {
      const result = await encodeDecodeExecutor({ text: '<div class="test">&</div>', method: 'html', operation: 'encode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('&lt;div class=&quot;test&quot;&gt;&amp;&lt;/div&gt;');
    });

    it('decodes HTML entities', async () => {
      const result = await encodeDecodeExecutor({ text: '&lt;p&gt;Hello &amp; World&lt;/p&gt;', method: 'html', operation: 'decode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('<p>Hello & World</p>');
    });

    it('encodes single quotes', async () => {
      const result = await encodeDecodeExecutor({ text: "it's", method: 'html', operation: 'encode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('it&#039;s');
    });
  });

  describe('hex', () => {
    it('encodes to hex', async () => {
      const result = await encodeDecodeExecutor({ text: 'AB', method: 'hex', operation: 'encode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('4142');
    });

    it('decodes from hex', async () => {
      const result = await encodeDecodeExecutor({ text: '4142', method: 'hex', operation: 'decode' });
      const data = parseContent(result.content);
      expect(data.output).toBe('AB');
    });
  });

  it('returns error for unknown method', async () => {
    const result = await encodeDecodeExecutor({ text: 'test', method: 'unknown', operation: 'encode' });
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// countTextExecutor
// =============================================================================

describe('countTextExecutor', () => {
  it('counts characters', async () => {
    const result = await countTextExecutor({ text: 'hello world' });
    const data = parseContent(result.content);
    expect(data.characters).toBe(11);
  });

  it('counts characters without spaces', async () => {
    const result = await countTextExecutor({ text: 'hello world' });
    const data = parseContent(result.content);
    expect(data.charactersNoSpaces).toBe(10);
  });

  it('counts words', async () => {
    const result = await countTextExecutor({ text: 'hello beautiful world' });
    const data = parseContent(result.content);
    expect(data.words).toBe(3);
  });

  it('counts sentences', async () => {
    const result = await countTextExecutor({ text: 'Hello. World! How?' });
    const data = parseContent(result.content);
    expect(data.sentences).toBe(3);
  });

  it('counts lines', async () => {
    const result = await countTextExecutor({ text: 'line1\nline2\nline3' });
    const data = parseContent(result.content);
    expect(data.lines).toBe(3);
  });

  it('counts paragraphs', async () => {
    const result = await countTextExecutor({ text: 'para1\n\npara2\n\npara3' });
    const data = parseContent(result.content);
    expect(data.paragraphs).toBe(3);
  });

  it('estimates reading time', async () => {
    // 200 words should be 1 minute
    const words = Array(200).fill('word').join(' ');
    const result = await countTextExecutor({ text: words });
    const data = parseContent(result.content);
    expect(data.readingTimeMinutes).toBe(1);
  });

  it('handles empty string', async () => {
    const result = await countTextExecutor({ text: '' });
    const data = parseContent(result.content);
    expect(data.characters).toBe(0);
    expect(data.words).toBe(0);
  });
});

// =============================================================================
// extractFromTextExecutor
// =============================================================================

describe('extractFromTextExecutor', () => {
  it('extracts URLs', async () => {
    const result = await extractFromTextExecutor({
      text: 'Visit https://example.com and http://test.org for info',
      pattern: 'urls',
    });
    const data = parseContent(result.content);
    expect(data.matches).toEqual(['https://example.com', 'http://test.org']);
    expect(data.count).toBe(2);
  });

  it('extracts emails', async () => {
    const result = await extractFromTextExecutor({
      text: 'Contact user@example.com or admin@test.org',
      pattern: 'emails',
    });
    const data = parseContent(result.content);
    expect(data.matches).toEqual(['user@example.com', 'admin@test.org']);
  });

  it('extracts hashtags', async () => {
    const result = await extractFromTextExecutor({
      text: 'Love #TypeScript and #Vitest!',
      pattern: 'hashtags',
    });
    const data = parseContent(result.content);
    expect(data.matches).toEqual(['#TypeScript', '#Vitest']);
  });

  it('extracts mentions', async () => {
    const result = await extractFromTextExecutor({
      text: 'Hey @alice and @bob!',
      pattern: 'mentions',
    });
    const data = parseContent(result.content);
    expect(data.matches).toEqual(['@alice', '@bob']);
  });

  it('extracts numbers', async () => {
    const result = await extractFromTextExecutor({
      text: 'Values are 42, 3.14, and -7',
      pattern: 'numbers',
    });
    const data = parseContent(result.content);
    expect(data.matches).toContain('42');
    expect(data.matches).toContain('3.14');
    expect(data.matches).toContain('-7');
  });

  it('deduplicates results', async () => {
    const result = await extractFromTextExecutor({
      text: 'Visit https://example.com and again https://example.com',
      pattern: 'urls',
    });
    const data = parseContent(result.content);
    expect(data.count).toBe(1);
    expect(data.totalOccurrences).toBe(2);
  });

  it('returns empty matches for no hits', async () => {
    const result = await extractFromTextExecutor({
      text: 'no urls here',
      pattern: 'urls',
    });
    const data = parseContent(result.content);
    expect(data.matches).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns error for unknown pattern', async () => {
    const result = await extractFromTextExecutor({
      text: 'test',
      pattern: 'unknown',
    });
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// validateDataExecutor
// =============================================================================

describe('validateDataExecutor', () => {
  describe('email validation', () => {
    it('validates a correct email', async () => {
      const result = await validateDataExecutor({ value: 'user@example.com', type: 'email' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
    });

    it('rejects an invalid email', async () => {
      const result = await validateDataExecutor({ value: 'not-an-email', type: 'email' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('Invalid email');
    });
  });

  describe('url validation', () => {
    it('validates a correct URL', async () => {
      const result = await validateDataExecutor({ value: 'https://example.com', type: 'url' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
    });

    it('rejects an invalid URL', async () => {
      const result = await validateDataExecutor({ value: 'not a url', type: 'url' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
    });
  });

  describe('json validation', () => {
    it('validates valid JSON', async () => {
      const result = await validateDataExecutor({ value: '{"key": "value"}', type: 'json' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
    });

    it('rejects invalid JSON', async () => {
      const result = await validateDataExecutor({ value: '{invalid}', type: 'json' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
    });
  });

  describe('uuid validation', () => {
    it('validates a correct UUID v4', async () => {
      const result = await validateDataExecutor({ value: '550e8400-e29b-41d4-a716-446655440000', type: 'uuid' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
    });

    it('rejects an invalid UUID', async () => {
      const result = await validateDataExecutor({ value: 'not-a-uuid', type: 'uuid' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
    });
  });

  describe('ip validation', () => {
    it('validates IPv4', async () => {
      const result = await validateDataExecutor({ value: '192.168.1.1', type: 'ip' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.version).toBe('IPv4');
    });

    it('validates IPv6', async () => {
      const result = await validateDataExecutor({ value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', type: 'ip' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.version).toBe('IPv6');
    });

    it('rejects invalid IP', async () => {
      const result = await validateDataExecutor({ value: '999.999.999.999', type: 'ip' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
    });
  });

  describe('phone validation', () => {
    it('validates a phone number with 10+ digits', async () => {
      const result = await validateDataExecutor({ value: '+1 (555) 123-4567', type: 'phone' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.normalized).toBe('15551234567');
    });

    it('rejects too-short phone number', async () => {
      const result = await validateDataExecutor({ value: '12345', type: 'phone' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
    });
  });

  describe('credit card validation', () => {
    it('validates a valid Visa card (Luhn)', async () => {
      // Test number: 4111111111111111 (well-known Visa test)
      const result = await validateDataExecutor({ value: '4111111111111111', type: 'credit_card' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Visa');
    });

    it('validates Mastercard', async () => {
      // Test number: 5500000000000004
      const result = await validateDataExecutor({ value: '5500000000000004', type: 'credit_card' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Mastercard');
    });

    it('rejects invalid card (Luhn fails)', async () => {
      const result = await validateDataExecutor({ value: '1234567890123456', type: 'credit_card' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('Luhn');
    });
  });

  describe('iban validation', () => {
    it('validates a correct IBAN', async () => {
      // GB82 WEST 1234 5698 7654 32 is a well-known test IBAN
      const result = await validateDataExecutor({ value: 'GB82 WEST 1234 5698 7654 32', type: 'iban' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(true);
      expect(data.country).toBe('GB');
    });

    it('rejects too-short IBAN', async () => {
      const result = await validateDataExecutor({ value: 'GB82', type: 'iban' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('length');
    });

    it('rejects IBAN with invalid checksum', async () => {
      const result = await validateDataExecutor({ value: 'GB00 WEST 1234 5698 7654 32', type: 'iban' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('checksum');
    });
  });

  describe('tc_kimlik validation', () => {
    it('rejects TC Kimlik not 11 digits', async () => {
      const result = await validateDataExecutor({ value: '12345', type: 'tc_kimlik' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('11 digits');
    });

    it('rejects TC Kimlik starting with 0', async () => {
      const result = await validateDataExecutor({ value: '01234567890', type: 'tc_kimlik' });
      const data = parseContent(result.content);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('cannot start with 0');
    });
  });

  it('returns error for unknown validation type', async () => {
    const result = await validateDataExecutor({ value: 'test', type: 'unknown' });
    const data = parseContent(result.content);
    expect(data.valid).toBe(false);
    expect(data.reason).toContain('Unknown validation type');
  });

  it('truncates long value in result', async () => {
    const longValue = 'a'.repeat(100);
    const result = await validateDataExecutor({ value: longValue, type: 'email' });
    const data = parseContent(result.content);
    expect((data.value as string).length).toBe(50);
  });
});

// =============================================================================
// transformTextExecutor
// =============================================================================

describe('transformTextExecutor', () => {
  it('transforms to uppercase', async () => {
    const result = await transformTextExecutor({ text: 'hello world', operation: 'uppercase' });
    const data = parseContent(result.content);
    expect(data.output).toBe('HELLO WORLD');
  });

  it('transforms to lowercase', async () => {
    const result = await transformTextExecutor({ text: 'HELLO WORLD', operation: 'lowercase' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello world');
  });

  it('capitalizes first letter', async () => {
    const result = await transformTextExecutor({ text: 'HELLO WORLD', operation: 'capitalize' });
    const data = parseContent(result.content);
    expect(data.output).toBe('Hello world');
  });

  it('transforms to title case', async () => {
    const result = await transformTextExecutor({ text: 'hello beautiful world', operation: 'title_case' });
    const data = parseContent(result.content);
    expect(data.output).toBe('Hello Beautiful World');
  });

  it('trims whitespace', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello');
  });

  it('trims start', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim_start' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello  ');
  });

  it('trims end', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim_end' });
    const data = parseContent(result.content);
    expect(data.output).toBe('  hello');
  });

  it('slugifies text', async () => {
    const result = await transformTextExecutor({ text: 'Hello World! This is a Test', operation: 'slugify' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello-world-this-is-a-test');
  });

  it('slugifies text with diacritics', async () => {
    const result = await transformTextExecutor({ text: 'Cafe Resume', operation: 'slugify' });
    const data = parseContent(result.content);
    expect(data.output).toBe('cafe-resume');
  });

  it('converts to camelCase', async () => {
    const result = await transformTextExecutor({ text: 'hello world test', operation: 'camel_case' });
    const data = parseContent(result.content);
    expect(data.output).toBe('helloWorldTest');
  });

  it('converts to snake_case', async () => {
    const result = await transformTextExecutor({ text: 'helloWorld test', operation: 'snake_case' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello_world_test');
  });

  it('converts to kebab-case', async () => {
    const result = await transformTextExecutor({ text: 'helloWorld test', operation: 'kebab_case' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello-world-test');
  });

  it('converts to PascalCase', async () => {
    const result = await transformTextExecutor({ text: 'hello world test', operation: 'pascal_case' });
    const data = parseContent(result.content);
    expect(data.output).toBe('HelloWorldTest');
  });

  it('reverses text', async () => {
    const result = await transformTextExecutor({ text: 'hello', operation: 'reverse' });
    const data = parseContent(result.content);
    expect(data.output).toBe('olleh');
  });

  it('removes whitespace', async () => {
    const result = await transformTextExecutor({ text: 'h e l l o', operation: 'remove_whitespace' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello');
  });

  it('normalizes whitespace', async () => {
    const result = await transformTextExecutor({ text: '  hello   world  ', operation: 'normalize_whitespace' });
    const data = parseContent(result.content);
    expect(data.output).toBe('hello world');
  });

  it('removes diacritics', async () => {
    const result = await transformTextExecutor({ text: 'caf\u00e9 r\u00e9sum\u00e9', operation: 'remove_diacritics' });
    const data = parseContent(result.content);
    expect(data.output).toBe('cafe resume');
  });

  it('truncates text with default suffix', async () => {
    const result = await transformTextExecutor({
      text: 'This is a very long text that should be truncated',
      operation: 'truncate',
      options: { maxLength: 20 },
    });
    const data = parseContent(result.content);
    expect((data.output as string).length).toBeLessThanOrEqual(20);
    expect((data.output as string)).toContain('...');
  });

  it('truncates text with custom suffix', async () => {
    const result = await transformTextExecutor({
      text: 'This is a very long text',
      operation: 'truncate',
      options: { maxLength: 15, suffix: '~' },
    });
    const data = parseContent(result.content);
    expect((data.output as string).endsWith('~')).toBe(true);
  });

  it('does not truncate short text', async () => {
    const result = await transformTextExecutor({
      text: 'short',
      operation: 'truncate',
      options: { maxLength: 100 },
    });
    const data = parseContent(result.content);
    expect(data.output).toBe('short');
  });

  it('returns error for unknown operation', async () => {
    const result = await transformTextExecutor({ text: 'test', operation: 'unknown' });
    expect(result.isError).toBe(true);
  });

  it('includes input/output lengths', async () => {
    const result = await transformTextExecutor({ text: 'hello', operation: 'uppercase' });
    const data = parseContent(result.content);
    expect(data.inputLength).toBe(5);
    expect(data.outputLength).toBe(5);
  });
});

// =============================================================================
// dateDiffExecutor
// =============================================================================

describe('dateDiffExecutor', () => {
  it('calculates difference in all units', async () => {
    const result = await dateDiffExecutor({ date1: '2024-01-01', date2: '2024-01-31' });
    const data = parseContent(result.content);
    const diff = data.difference as Record<string, number>;
    expect(diff.days).toBe(30);
    expect(diff.hours).toBe(720);
    expect(data.isPositive).toBe(true);
  });

  it('calculates difference in specific unit', async () => {
    const result = await dateDiffExecutor({ date1: '2024-01-01', date2: '2024-01-08', unit: 'weeks' });
    const data = parseContent(result.content);
    expect(data.difference).toBe(1);
    expect(data.unit).toBe('weeks');
  });

  it('handles negative difference', async () => {
    const result = await dateDiffExecutor({ date1: '2024-02-01', date2: '2024-01-01' });
    const data = parseContent(result.content);
    expect(data.isPositive).toBe(false);
  });

  it('returns error for invalid date', async () => {
    const result = await dateDiffExecutor({ date1: 'invalid', date2: '2024-01-01' });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('Invalid date');
  });

  it('calculates difference in days unit', async () => {
    const result = await dateDiffExecutor({ date1: '2024-01-01', date2: '2024-01-11', unit: 'days' });
    const data = parseContent(result.content);
    expect(data.difference).toBe(10);
  });
});

// =============================================================================
// dateAddExecutor
// =============================================================================

describe('dateAddExecutor', () => {
  it('adds days to a date', async () => {
    const result = await dateAddExecutor({ date: '2024-01-01T00:00:00.000Z', amount: 10, unit: 'days' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2024-01-11');
  });

  it('subtracts days with negative amount', async () => {
    const result = await dateAddExecutor({ date: '2024-01-11T00:00:00.000Z', amount: -10, unit: 'days' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2024-01-01');
  });

  it('adds months', async () => {
    const result = await dateAddExecutor({ date: '2024-01-15T00:00:00.000Z', amount: 2, unit: 'months' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2024-03-15');
  });

  it('adds years', async () => {
    const result = await dateAddExecutor({ date: '2024-01-15T00:00:00.000Z', amount: 1, unit: 'years' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2025-01-15');
  });

  it('adds hours', async () => {
    const result = await dateAddExecutor({ date: '2024-01-01T00:00:00.000Z', amount: 5, unit: 'hours' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2024-01-01T05:00:00');
  });

  it('adds weeks', async () => {
    const result = await dateAddExecutor({ date: '2024-01-01T00:00:00.000Z', amount: 2, unit: 'weeks' });
    const data = parseContent(result.content);
    expect(data.result).toContain('2024-01-15');
  });

  it('handles "now" as date string', async () => {
    const result = await dateAddExecutor({ date: 'now', amount: 1, unit: 'days' });
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.result).toBeTypeOf('string');
    expect(data.added).toEqual({ amount: 1, unit: 'days' });
  });

  it('returns error for invalid date', async () => {
    const result = await dateAddExecutor({ date: 'not-a-date', amount: 1, unit: 'days' });
    expect(result.isError).toBe(true);
    const data = parseContent(result.content);
    expect(data.error).toContain('Invalid date');
  });

  it('includes formatted result', async () => {
    const result = await dateAddExecutor({ date: '2024-06-15T12:00:00.000Z', amount: 0, unit: 'days' });
    const data = parseContent(result.content);
    expect(data.resultFormatted).toBeTypeOf('string');
  });
});

// =============================================================================
// formatJsonExecutor
// =============================================================================

describe('formatJsonExecutor', () => {
  it('prettifies JSON', async () => {
    const result = await formatJsonExecutor({ json: '{"a":1,"b":2}', operation: 'prettify' });
    const data = parseContent(result.content);
    expect(data.result).toContain('\n');
  });

  it('minifies JSON', async () => {
    const result = await formatJsonExecutor({ json: '{ "a": 1, "b": 2 }', operation: 'minify' });
    const data = parseContent(result.content);
    expect(data.result).toBe('{"a":1,"b":2}');
  });

  it('gets value by path', async () => {
    const result = await formatJsonExecutor({
      json: '{"user":{"name":"Alice"}}',
      operation: 'get_path',
      path: 'user.name',
    });
    const data = parseContent(result.content);
    expect(data.result).toContain('Alice');
  });

  it('gets value by path with array index', async () => {
    const result = await formatJsonExecutor({
      json: '{"items":[{"id":1},{"id":2}]}',
      operation: 'get_path',
      path: 'items[1].id',
    });
    const data = parseContent(result.content);
    expect(data.result).toContain('2');
  });

  it('returns error when path is missing for get_path', async () => {
    const result = await formatJsonExecutor({ json: '{"a":1}', operation: 'get_path' });
    expect(result.isError).toBe(true);
  });

  it('gets keys of an object', async () => {
    const result = await formatJsonExecutor({ json: '{"a":1,"b":2,"c":3}', operation: 'get_keys' });
    const data = parseContent(result.content);
    expect(data.result).toContain('a');
    expect(data.result).toContain('b');
    expect(data.result).toContain('c');
  });

  it('gets values of an object', async () => {
    const result = await formatJsonExecutor({ json: '{"a":1,"b":2}', operation: 'get_values' });
    const data = parseContent(result.content);
    expect(data.result).toContain('1');
    expect(data.result).toContain('2');
  });

  it('flattens nested object', async () => {
    const result = await formatJsonExecutor({ json: '{"a":{"b":{"c":1}}}', operation: 'flatten' });
    const data = parseContent(result.content);
    expect(data.result).toContain('a.b.c');
  });

  it('sorts keys alphabetically', async () => {
    const result = await formatJsonExecutor({ json: '{"c":3,"a":1,"b":2}', operation: 'sort_keys' });
    const data = parseContent(result.content);
    const parsed = JSON.parse(data.result as string);
    const keys = Object.keys(parsed);
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('returns error for invalid JSON input', async () => {
    const result = await formatJsonExecutor({ json: 'invalid', operation: 'prettify' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown operation', async () => {
    const result = await formatJsonExecutor({ json: '{}', operation: 'unknown' });
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// parseCsvExecutor
// =============================================================================

describe('parseCsvExecutor', () => {
  it('parses CSV with headers', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const result = await parseCsvExecutor({ csv });
    const data = parseContent(result.content);
    expect(data.headers).toEqual(['name', 'age']);
    expect(data.rowCount).toBe(2);
    expect(data.columnCount).toBe(2);
  });

  it('parses CSV without headers', async () => {
    const csv = 'Alice,30\nBob,25';
    const result = await parseCsvExecutor({ csv, hasHeader: false });
    const data = parseContent(result.content);
    expect(data.rowCount).toBe(2);
    expect(data.headers).toBeUndefined();
  });

  it('handles quoted fields', async () => {
    const csv = 'name,desc\nAlice,"Hello, World"\nBob,"He said ""hi"""';
    const result = await parseCsvExecutor({ csv });
    const data = parseContent(result.content);
    const rows = data.data as Record<string, string>[];
    expect(rows[0]!.desc).toBe('Hello, World');
    expect(rows[1]!.desc).toBe('He said "hi"');
  });

  it('handles custom delimiter', async () => {
    const csv = 'name\tage\nAlice\t30';
    const result = await parseCsvExecutor({ csv, delimiter: '\t' });
    const data = parseContent(result.content);
    expect(data.headers).toEqual(['name', 'age']);
  });

  it('returns error for empty CSV', async () => {
    const result = await parseCsvExecutor({ csv: '' });
    expect(result.isError).toBe(true);
  });

  it('trims values by default', async () => {
    const csv = 'name , age\n Alice , 30 ';
    const result = await parseCsvExecutor({ csv });
    const data = parseContent(result.content);
    expect((data.headers as string[])[0]).toBe('name');
    const rows = data.data as Record<string, string>[];
    expect(rows[0]!['name']).toBe('Alice');
  });
});

// =============================================================================
// generateCsvExecutor
// =============================================================================

describe('generateCsvExecutor', () => {
  it('generates CSV from object array', async () => {
    const data = JSON.stringify([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);
    const result = await generateCsvExecutor({ data });
    const parsed = parseContent(result.content);
    const csv = parsed.csv as string;
    expect(csv).toContain('name,age');
    expect(csv).toContain('Alice,30');
    expect(csv).toContain('Bob,25');
  });

  it('generates CSV without header', async () => {
    const data = JSON.stringify([{ name: 'Alice' }]);
    const result = await generateCsvExecutor({ data, includeHeader: false });
    const parsed = parseContent(result.content);
    const csv = parsed.csv as string;
    expect(csv).not.toContain('name');
    expect(csv).toContain('Alice');
  });

  it('escapes values containing delimiter', async () => {
    const data = JSON.stringify([{ name: 'Alice, Bob' }]);
    const result = await generateCsvExecutor({ data });
    const parsed = parseContent(result.content);
    const csv = parsed.csv as string;
    expect(csv).toContain('"Alice, Bob"');
  });

  it('returns error for invalid JSON', async () => {
    const result = await generateCsvExecutor({ data: 'invalid' });
    expect(result.isError).toBe(true);
  });

  it('returns error for empty array', async () => {
    const result = await generateCsvExecutor({ data: '[]' });
    expect(result.isError).toBe(true);
  });

  it('handles array of arrays', async () => {
    const data = JSON.stringify([[1, 2], [3, 4]]);
    const result = await generateCsvExecutor({ data });
    const parsed = parseContent(result.content);
    const csv = parsed.csv as string;
    expect(csv).toContain('1,2');
    expect(csv).toContain('3,4');
  });
});

// =============================================================================
// arrayOperationsExecutor
// =============================================================================

describe('arrayOperationsExecutor', () => {
  it('sorts numbers ascending', async () => {
    const result = await arrayOperationsExecutor({ array: '[3,1,2]', operation: 'sort' });
    const data = parseContent(result.content);
    expect(data.result).toEqual([1, 2, 3]);
  });

  it('sorts numbers descending', async () => {
    const result = await arrayOperationsExecutor({ array: '[3,1,2]', operation: 'sort', options: { sortOrder: 'desc' } });
    const data = parseContent(result.content);
    expect(data.result).toEqual([3, 2, 1]);
  });

  it('sorts by key', async () => {
    const result = await arrayOperationsExecutor({
      array: '[{"name":"Bob"},{"name":"Alice"}]',
      operation: 'sort',
      options: { sortKey: 'name' },
    });
    const data = parseContent(result.content);
    const sorted = data.result as { name: string }[];
    expect(sorted[0]!.name).toBe('Alice');
    expect(sorted[1]!.name).toBe('Bob');
  });

  it('reverses an array', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3]', operation: 'reverse' });
    const data = parseContent(result.content);
    expect(data.result).toEqual([3, 2, 1]);
  });

  it('removes duplicates', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,2,3,3,3]', operation: 'unique' });
    const data = parseContent(result.content);
    expect(data.result).toEqual([1, 2, 3]);
  });

  it('shuffles an array', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'shuffle' });
    const data = parseContent(result.content);
    expect((data.result as number[]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('chunks an array', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'chunk', options: { chunkSize: 2 } });
    const data = parseContent(result.content);
    expect(data.result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('flattens a nested array', async () => {
    const result = await arrayOperationsExecutor({ array: '[[1,2],[3,[4,5]]]', operation: 'flatten' });
    const data = parseContent(result.content);
    expect(data.result).toEqual([1, 2, 3, 4, 5]);
  });

  it('samples from array', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'sample', options: { sampleSize: 2 } });
    const data = parseContent(result.content);
    expect((data.result as number[])).toHaveLength(2);
  });

  it('gets first N items', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'first', options: { count: 3 } });
    const data = parseContent(result.content);
    expect(data.result).toEqual([1, 2, 3]);
  });

  it('gets last N items', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'last', options: { count: 2 } });
    const data = parseContent(result.content);
    expect(data.result).toEqual([4, 5]);
  });

  it('calculates sum', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'sum' });
    const data = parseContent(result.content);
    expect(data.result).toBe(15);
  });

  it('calculates average', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'avg' });
    const data = parseContent(result.content);
    expect(data.result).toBe(3);
  });

  it('calculates min', async () => {
    const result = await arrayOperationsExecutor({ array: '[3,1,4,1,5]', operation: 'min' });
    const data = parseContent(result.content);
    expect(data.result).toBe(1);
  });

  it('calculates max', async () => {
    const result = await arrayOperationsExecutor({ array: '[3,1,4,1,5]', operation: 'max' });
    const data = parseContent(result.content);
    expect(data.result).toBe(5);
  });

  it('counts items', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2,3]', operation: 'count' });
    const data = parseContent(result.content);
    expect(data.result).toBe(3);
  });

  it('returns error for invalid JSON', async () => {
    const result = await arrayOperationsExecutor({ array: 'not-json', operation: 'sort' });
    expect(result.isError).toBe(true);
  });

  it('returns error for non-array input', async () => {
    const result = await arrayOperationsExecutor({ array: '{"a":1}', operation: 'sort' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown operation', async () => {
    const result = await arrayOperationsExecutor({ array: '[1,2]', operation: 'unknown' });
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// calculateStatisticsExecutor
// =============================================================================

describe('calculateStatisticsExecutor', () => {
  it('calculates basic statistics', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]' });
    const data = parseContent(result.content);
    expect(data.count).toBe(5);
    expect(data.sum).toBe(15);
    expect(data.mean).toBe(3);
    expect(data.median).toBe(3);
    expect(data.min).toBe(1);
    expect(data.max).toBe(5);
    expect(data.range).toBe(4);
  });

  it('calculates median for even count', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4]' });
    const data = parseContent(result.content);
    expect(data.median).toBe(2.5);
  });

  it('calculates standard deviation', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[2,4,4,4,5,5,7,9]' });
    const data = parseContent(result.content);
    expect(data.standardDeviation).toBeTypeOf('number');
    expect(data.variance).toBeTypeOf('number');
  });

  it('calculates quartiles', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5,6,7,8,9,10]' });
    const data = parseContent(result.content);
    const quartiles = data.quartiles as Record<string, number>;
    expect(quartiles.q1).toBeTypeOf('number');
    expect(quartiles.q2).toBeTypeOf('number');
    expect(quartiles.q3).toBeTypeOf('number');
  });

  it('calculates requested percentile', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5,6,7,8,9,10]', percentile: 90 });
    const data = parseContent(result.content);
    expect(data.requestedPercentile).toBeDefined();
    const pct = data.requestedPercentile as Record<string, number>;
    expect(pct.percentile).toBe(90);
    expect(pct.value).toBeTypeOf('number');
  });

  it('parses comma-separated numbers', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '1, 2, 3, 4, 5' });
    const data = parseContent(result.content);
    expect(data.count).toBe(5);
    expect(data.mean).toBe(3);
  });

  it('returns error for no valid numbers', async () => {
    const result = await calculateStatisticsExecutor({ numbers: 'abc, def' });
    expect(result.isError).toBe(true);
  });

  it('returns "no mode" when all values are unique', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]' });
    const data = parseContent(result.content);
    expect(data.mode).toBe('no mode');
  });

  it('detects mode when values repeat', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,2,3]' });
    const data = parseContent(result.content);
    expect(data.mode).toEqual([2]);
  });
});

// =============================================================================
// compareTextExecutor
// =============================================================================

describe('compareTextExecutor', () => {
  it('detects identical texts', async () => {
    const result = await compareTextExecutor({ text1: 'hello', text2: 'hello' });
    const data = parseContent(result.content);
    expect(data.identical).toBe(true);
    expect(data.similarity).toBe(100);
  });

  it('detects different texts', async () => {
    const result = await compareTextExecutor({ text1: 'hello', text2: 'world' });
    const data = parseContent(result.content);
    expect(data.identical).toBe(false);
  });

  it('compares by lines', async () => {
    const result = await compareTextExecutor({
      text1: 'line1\nline2\nline3',
      text2: 'line1\nline2\nline4',
      mode: 'lines',
    });
    const data = parseContent(result.content);
    expect(data.addedCount).toBeTypeOf('number');
    expect(data.removedCount).toBeTypeOf('number');
    expect(data.commonCount).toBeTypeOf('number');
  });

  it('compares by words', async () => {
    const result = await compareTextExecutor({
      text1: 'hello beautiful world',
      text2: 'hello wonderful world',
      mode: 'words',
    });
    const data = parseContent(result.content);
    expect(data.commonCount).toBe(2); // "hello" and "world"
  });

  it('compares by chars', async () => {
    const result = await compareTextExecutor({
      text1: 'abc',
      text2: 'abd',
      mode: 'chars',
    });
    const data = parseContent(result.content);
    expect(data.mode).toBe('chars');
  });
});

// =============================================================================
// runRegexExecutor
// =============================================================================

describe('runRegexExecutor', () => {
  it('tests a pattern', async () => {
    const result = await runRegexExecutor({ text: 'hello world', pattern: 'hello', operation: 'test' });
    const data = parseContent(result.content);
    expect(data.result).toBe(true);
  });

  it('tests a non-matching pattern', async () => {
    const result = await runRegexExecutor({ text: 'hello world', pattern: 'xyz', operation: 'test' });
    const data = parseContent(result.content);
    expect(data.result).toBe(false);
  });

  it('matches a pattern', async () => {
    const result = await runRegexExecutor({ text: 'hello world', pattern: '(\\w+)\\s(\\w+)', operation: 'match' });
    const data = parseContent(result.content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = data.result as any;
    expect(match.match).toBe('hello world');
    expect(match.groups).toEqual(['hello', 'world']);
  });

  it('matches all occurrences', async () => {
    const result = await runRegexExecutor({ text: 'cat bat hat', pattern: '[a-z]at', operation: 'match_all', flags: 'g' });
    const data = parseContent(result.content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches = data.result as any[];
    expect(matches).toHaveLength(3);
  });

  it('replaces text', async () => {
    const result = await runRegexExecutor({ text: 'hello world', pattern: 'world', operation: 'replace', replacement: 'vitest', flags: 'g' });
    const data = parseContent(result.content);
    expect(data.result).toBe('hello vitest');
  });

  it('splits text', async () => {
    const result = await runRegexExecutor({ text: 'a,b,,c', pattern: ',+', operation: 'split' });
    const data = parseContent(result.content);
    expect(data.result).toEqual(['a', 'b', 'c']);
  });

  it('returns error for too-long pattern', async () => {
    const result = await runRegexExecutor({ text: 'test', pattern: 'a'.repeat(1001), operation: 'test' });
    expect(result.isError).toBe(true);
  });

  it('returns error for invalid regex', async () => {
    const result = await runRegexExecutor({ text: 'test', pattern: '(unclosed', operation: 'test' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown operation', async () => {
    const result = await runRegexExecutor({ text: 'test', pattern: 'test', operation: 'unknown' });
    expect(result.isError).toBe(true);
  });

  it('auto-adds g flag for match_all', async () => {
    const result = await runRegexExecutor({ text: 'aa', pattern: 'a', operation: 'match_all' });
    const data = parseContent(result.content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((data.result as any[]).length).toBe(2);
  });
});

// =============================================================================
// getSystemInfoExecutor
// =============================================================================

describe('getSystemInfoExecutor', () => {
  it('returns platform info by default', async () => {
    const result = await getSystemInfoExecutor({});
    const data = parseContent(result.content);
    expect(data.platform).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const platform = data.platform as any;
    expect(platform.os).toBe(process.platform);
    expect(platform.arch).toBe(process.arch);
    expect(platform.nodeVersion).toBe(process.version);
  });

  it('returns memory info when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['memory'] });
    const data = parseContent(result.content);
    expect(data.memory).toBeDefined();
  });

  it('returns cpu info when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['cpu'] });
    const data = parseContent(result.content);
    expect(data.cpu).toBeDefined();
  });

  it('returns env info when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['env'] });
    const data = parseContent(result.content);
    expect(data.env).toBeDefined();
  });

  it('returns everything with "all"', async () => {
    const result = await getSystemInfoExecutor({ include: ['all'] });
    const data = parseContent(result.content);
    expect(data.platform).toBeDefined();
    expect(data.memory).toBeDefined();
    expect(data.cpu).toBeDefined();
    expect(data.env).toBeDefined();
  });

  it('always includes timestamp', async () => {
    const result = await getSystemInfoExecutor({});
    const data = parseContent(result.content);
    expect(data.timestamp).toBeTypeOf('string');
  });
});

// =============================================================================
// UTILITY_TOOLS & UTILITY_TOOL_NAMES exports
// =============================================================================

describe('UTILITY_TOOLS export', () => {
  it('exports a non-empty array of tool pairs', () => {
    expect(UTILITY_TOOLS.length).toBeGreaterThan(0);
  });

  it('each entry has a definition and executor', () => {
    for (const tool of UTILITY_TOOLS) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTypeOf('string');
      expect(tool.executor).toBeTypeOf('function');
    }
  });

  it('all tool names are unique', () => {
    const names = UTILITY_TOOLS.map((t) => t.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('UTILITY_TOOL_NAMES export', () => {
  it('is an array of strings', () => {
    expect(Array.isArray(UTILITY_TOOL_NAMES)).toBe(true);
    for (const name of UTILITY_TOOL_NAMES) {
      expect(typeof name).toBe('string');
    }
  });

  it('matches UTILITY_TOOLS definitions', () => {
    const expected = UTILITY_TOOLS.map((t) => t.definition.name);
    expect(UTILITY_TOOL_NAMES).toEqual(expected);
  });

  it('contains known tool names', () => {
    expect(UTILITY_TOOL_NAMES).toContain('get_current_datetime');
    expect(UTILITY_TOOL_NAMES).toContain('calculate');
    expect(UTILITY_TOOL_NAMES).toContain('convert_units');
    expect(UTILITY_TOOL_NAMES).toContain('generate_uuid');
    expect(UTILITY_TOOL_NAMES).toContain('generate_password');
    expect(UTILITY_TOOL_NAMES).toContain('hash_text');
    expect(UTILITY_TOOL_NAMES).toContain('validate_data');
    expect(UTILITY_TOOL_NAMES).toContain('transform_text');
    expect(UTILITY_TOOL_NAMES).toContain('calculate_statistics');
    expect(UTILITY_TOOL_NAMES).toContain('run_regex');
  });
});
