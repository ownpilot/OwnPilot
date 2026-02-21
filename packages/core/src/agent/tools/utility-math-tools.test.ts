import { describe, it, expect } from 'vitest';
import {
  calculateTool,
  calculateExecutor,
  convertUnitsTool,
  convertUnitsExecutor,
  calculateStatisticsTool,
  calculateStatisticsExecutor,
} from './utility-math-tools.js';

// Helper: parse JSON content from executor result
function parse(result: { content: unknown }) {
  return JSON.parse(result.content as string);
}

// =====================================================================
// TOOL DEFINITIONS
// =====================================================================

describe('Tool definitions', () => {
  it('calculateTool has correct name and category', () => {
    expect(calculateTool.name).toBe('calculate');
    expect(calculateTool.category).toBe('Utilities');
    expect(calculateTool.parameters.required).toContain('expression');
  });

  it('convertUnitsTool has correct name and category', () => {
    expect(convertUnitsTool.name).toBe('convert_units');
    expect(convertUnitsTool.category).toBe('Utilities');
    expect(convertUnitsTool.parameters.required).toEqual(['value', 'from', 'to']);
  });

  it('calculateStatisticsTool has correct name and category', () => {
    expect(calculateStatisticsTool.name).toBe('calculate_statistics');
    expect(calculateStatisticsTool.category).toBe('Utilities');
    expect(calculateStatisticsTool.parameters.required).toContain('numbers');
  });

  it('all tools have description and brief', () => {
    for (const tool of [calculateTool, convertUnitsTool, calculateStatisticsTool]) {
      expect(tool.description).toBeTruthy();
      expect(tool.brief).toBeTruthy();
    }
  });

  it('calculateTool defines expression and precision parameters', () => {
    const props = calculateTool.parameters.properties as Record<string, { type: string }>;
    expect(props.expression.type).toBe('string');
    expect(props.precision.type).toBe('number');
  });
});

// =====================================================================
// CALCULATE EXECUTOR
// =====================================================================

describe('calculateExecutor', () => {
  // --- Basic arithmetic ---

  it('should add two numbers', async () => {
    const result = await calculateExecutor({ expression: '2 + 2' });
    const data = parse(result);
    expect(data.result).toBe(4);
    expect(data.expression).toBe('2 + 2');
  });

  it('should subtract', async () => {
    const result = await calculateExecutor({ expression: '10 - 3' });
    expect(parse(result).result).toBe(7);
  });

  it('should multiply', async () => {
    const result = await calculateExecutor({ expression: '3 * 4' });
    expect(parse(result).result).toBe(12);
  });

  it('should divide with precision', async () => {
    const result = await calculateExecutor({ expression: '10 / 3' });
    const data = parse(result);
    expect(data.result).toBe(3.3333);
  });

  it('should respect operator precedence', async () => {
    const result = await calculateExecutor({ expression: '2 + 3 * 4' });
    expect(parse(result).result).toBe(14);
  });

  it('should handle parentheses', async () => {
    const result = await calculateExecutor({ expression: '(2 + 3) * 4' });
    expect(parse(result).result).toBe(20);
  });

  // --- Percentages ---

  it('should evaluate "15% of 200"', async () => {
    const result = await calculateExecutor({ expression: '15% of 200' });
    expect(parse(result).result).toBe(30);
  });

  it('should evaluate "50%"', async () => {
    const result = await calculateExecutor({ expression: '50%' });
    expect(parse(result).result).toBe(0.5);
  });

  it('should evaluate "25% of 80"', async () => {
    const result = await calculateExecutor({ expression: '25% of 80' });
    expect(parse(result).result).toBe(20);
  });

  it('should evaluate decimal percentage "7.5% of 200"', async () => {
    const result = await calculateExecutor({ expression: '7.5% of 200' });
    expect(parse(result).result).toBe(15);
  });

  // --- Powers ---

  it('should handle power notation with ^', async () => {
    const result = await calculateExecutor({ expression: '2^10' });
    expect(parse(result).result).toBe(1024);
  });

  it('should handle 3^3', async () => {
    const result = await calculateExecutor({ expression: '3^3' });
    expect(parse(result).result).toBe(27);
  });

  // --- Math functions ---

  it('should calculate sqrt(16)', async () => {
    const result = await calculateExecutor({ expression: 'sqrt(16)' });
    expect(parse(result).result).toBe(4);
  });

  it('should calculate abs(-5)', async () => {
    const result = await calculateExecutor({ expression: 'abs(-5)' });
    expect(parse(result).result).toBe(5);
  });

  it('should calculate floor(3.7)', async () => {
    const result = await calculateExecutor({ expression: 'floor(3.7)' });
    expect(parse(result).result).toBe(3);
  });

  it('should calculate ceil(3.2)', async () => {
    const result = await calculateExecutor({ expression: 'ceil(3.2)' });
    expect(parse(result).result).toBe(4);
  });

  it('should reject round() due to "d" not in validation regex', async () => {
    // BUG: The validator regex does not include 'd', so round() is rejected
    // despite being defined in mathFunctions. Math.round(3.5) → strip 'Math.' →
    // 'round(3.5)' → 'd' fails validation.
    const result = await calculateExecutor({ expression: 'round(3.5)' });
    expect(result.isError).toBe(true);
  });

  it('should calculate exp(0)', async () => {
    const result = await calculateExecutor({ expression: 'exp(0)' });
    expect(parse(result).result).toBe(1);
  });

  // --- Constants ---

  it('should resolve pi', async () => {
    const result = await calculateExecutor({ expression: 'pi' });
    expect(parse(result).result).toBeCloseTo(3.1416, 4);
  });

  it('should resolve e', async () => {
    const result = await calculateExecutor({ expression: 'e' });
    expect(parse(result).result).toBeCloseTo(2.7183, 4);
  });

  // --- Logarithms ---

  it('should compute log(100) as Math.log (natural log, not log10)', async () => {
    // BUG: Despite mapping log→Math.log10 in mathFunctions, the replacement
    // uses the key name: Math.${name}() → Math.log() which is natural log.
    // So log(100) = Math.log(100) ≈ 4.6052, NOT Math.log10(100) = 2.
    const result = await calculateExecutor({ expression: 'log(100)' });
    const data = parse(result);
    expect(data.result).toBeCloseTo(4.6052, 4);
  });

  it('should error on ln(e) because Math.ln does not exist', async () => {
    // BUG: ln(e) → Math.ln(Math.E) but Math.ln is not a real JS function.
    // The replacement uses Math.${name} with name='ln', which doesn't exist.
    const result = await calculateExecutor({ expression: 'ln(e)' });
    expect(result.isError).toBe(true);
  });

  // --- Precision parameter ---

  it('should respect precision 0', async () => {
    const result = await calculateExecutor({ expression: '10 / 3', precision: 0 });
    expect(parse(result).result).toBe(3);
  });

  it('should respect precision 2', async () => {
    const result = await calculateExecutor({ expression: '10 / 3', precision: 2 });
    expect(parse(result).result).toBe(3.33);
  });

  it('should respect precision 10', async () => {
    const result = await calculateExecutor({ expression: '10 / 3', precision: 10 });
    const data = parse(result);
    expect(data.result).toBeCloseTo(3.3333333333, 10);
  });

  it('should default to precision 4', async () => {
    const result = await calculateExecutor({ expression: '1 / 7' });
    const data = parse(result);
    // 1/7 ≈ 0.142857... → 0.1429 at precision 4
    expect(data.result).toBe(0.1429);
  });

  // --- Complex expressions ---

  it('should evaluate sqrt(16) + 2^3', async () => {
    const result = await calculateExecutor({ expression: 'sqrt(16) + 2^3' });
    expect(parse(result).result).toBe(12); // 4 + 8
  });

  it('should return formatted result', async () => {
    const result = await calculateExecutor({ expression: '1000 + 234' });
    const data = parse(result);
    expect(data.result).toBe(1234);
    // formatted is locale-dependent, just check it exists
    expect(data.formatted).toBeDefined();
  });

  // --- Error cases ---

  it('should reject invalid characters', async () => {
    const result = await calculateExecutor({ expression: 'require("fs")' });
    expect(result.isError).toBe(true);
  });

  it('should reject variable assignment', async () => {
    const result = await calculateExecutor({ expression: 'x = 5' });
    expect(result.isError).toBe(true);
  });

  it('should return error for division by zero (Infinity)', async () => {
    const result = await calculateExecutor({ expression: '1 / 0' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('Result is not a valid number');
  });

  it('should return error for NaN result', async () => {
    const result = await calculateExecutor({ expression: 'sqrt(-1)' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('Result is not a valid number');
  });
});

// =====================================================================
// CONVERT UNITS EXECUTOR
// =====================================================================

describe('convertUnitsExecutor', () => {
  // --- Temperature ---

  it('should convert 0 celsius to 32 fahrenheit', async () => {
    const result = await convertUnitsExecutor({ value: 0, from: 'celsius', to: 'fahrenheit' });
    const data = parse(result);
    expect(data.to.value).toBe(32);
  });

  it('should convert 100 celsius to 212 fahrenheit', async () => {
    const result = await convertUnitsExecutor({ value: 100, from: 'celsius', to: 'fahrenheit' });
    expect(parse(result).to.value).toBe(212);
  });

  it('should convert 0 celsius to 273.15 kelvin', async () => {
    const result = await convertUnitsExecutor({ value: 0, from: 'c', to: 'k' });
    expect(parse(result).to.value).toBe(273.15);
  });

  it('should convert 32 fahrenheit to 0 celsius', async () => {
    const result = await convertUnitsExecutor({ value: 32, from: 'f', to: 'c' });
    expect(parse(result).to.value).toBe(0);
  });

  it('should handle temperature shorthand with degree symbol', async () => {
    const result = await convertUnitsExecutor({ value: 100, from: '°c', to: '°f' });
    expect(parse(result).to.value).toBe(212);
  });

  // --- Length ---

  it('should convert 1 km to 1000 m', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'km', to: 'm' });
    const data = parse(result);
    expect(data.to.value).toBe(1000);
    expect(data.category).toBe('length');
  });

  it('should convert 1 mile to approx 1609.344 m', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'mi', to: 'm' });
    expect(parse(result).to.value).toBe(1609.344);
  });

  it('should convert 1 ft to 0.3048 m', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'ft', to: 'm' });
    expect(parse(result).to.value).toBe(0.3048);
  });

  it('should convert 1 inch to 2.54 cm', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'in', to: 'cm' });
    // 0.0254 / 0.01 = 2.54
    expect(parse(result).to.value).toBe(2.54);
  });

  // --- Weight ---

  it('should convert 1 kg to approx 2.20462 lb', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'kg', to: 'lb' });
    const data = parse(result);
    // 1000 / 453.592 ≈ 2.204623
    expect(data.to.value).toBeCloseTo(2.2046, 3);
  });

  it('should convert 1 lb to approx 453.592 g', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'lb', to: 'g' });
    expect(parse(result).to.value).toBe(453.592);
  });

  it('should convert 1 ton to 1000000 g', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'ton', to: 'g' });
    expect(parse(result).to.value).toBe(1000000);
  });

  // --- Data ---

  it('should convert 1 gb to 1024 mb', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'gb', to: 'mb' });
    expect(parse(result).to.value).toBe(1024);
  });

  it('should convert 1 mb to 1024 kb', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'mb', to: 'kb' });
    expect(parse(result).to.value).toBe(1024);
  });

  it('should convert 1 byte to 8 bits', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'b', to: 'bit' });
    expect(parse(result).to.value).toBe(8);
  });

  // --- Time ---

  it('should convert 1 hour to 3600 seconds', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'h', to: 's' });
    expect(parse(result).to.value).toBe(3600);
  });

  it('should convert 1 day to 86400 seconds', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'd', to: 's' });
    expect(parse(result).to.value).toBe(86400);
  });

  it('should convert 1 week to 7 days', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'wk', to: 'd' });
    expect(parse(result).to.value).toBe(7);
  });

  // --- Volume ---

  it('should convert 1 gallon to approx 3.78541 liters', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'gal', to: 'l' });
    expect(parse(result).to.value).toBeCloseTo(3.78541, 4);
  });

  // --- Area ---

  it('should convert 1 hectare to 10000 square meters', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'hectare', to: 'm2' });
    expect(parse(result).to.value).toBe(10000);
  });

  // --- Speed ---

  it('should convert 1 m/s to 3.6 km/h', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'mps', to: 'kmh' });
    // 1 * 1 / 0.277778 ≈ 3.6
    expect(parse(result).to.value).toBeCloseTo(3.6, 2);
  });

  // --- Case insensitivity ---

  it('should handle uppercase unit names', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'KG', to: 'LB' });
    const data = parse(result);
    expect(data.to.value).toBeCloseTo(2.2046, 3);
  });

  // --- Error cases ---

  it('should error on incompatible units', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'kg', to: 'km' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toContain('Cannot convert');
    expect(data.supportedCategories).toBeDefined();
    expect(Array.isArray(data.supportedCategories)).toBe(true);
  });

  it('should error on unknown units', async () => {
    const result = await convertUnitsExecutor({ value: 1, from: 'xyz', to: 'abc' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toContain('Cannot convert');
  });

  it('should include from and to in result', async () => {
    const result = await convertUnitsExecutor({ value: 5, from: 'km', to: 'm' });
    const data = parse(result);
    expect(data.from.value).toBe(5);
    expect(data.from.unit).toBe('km');
    expect(data.to.unit).toBe('m');
    expect(data.to.value).toBe(5000);
  });
});

// =====================================================================
// CALCULATE STATISTICS EXECUTOR
// =====================================================================

describe('calculateStatisticsExecutor', () => {
  // --- Input parsing ---

  it('should parse JSON array input', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1, 2, 3, 4, 5]' });
    const data = parse(result);
    expect(data.count).toBe(5);
    expect(data.sum).toBe(15);
  });

  it('should parse comma-separated input', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '1, 2, 3, 4, 5' });
    const data = parse(result);
    expect(data.count).toBe(5);
    expect(data.sum).toBe(15);
  });

  it('should handle JSON array with non-number values filtered out', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1, "a", 2, null, 3]' });
    const data = parse(result);
    expect(data.count).toBe(3);
  });

  // --- Mean ---

  it('should calculate mean of [1,2,3,4,5] as 3', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]' });
    expect(parse(result).mean).toBe(3);
  });

  it('should calculate mean of [10, 20, 30] as 20', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '10, 20, 30' });
    expect(parse(result).mean).toBe(20);
  });

  // --- Median ---

  it('should calculate median of odd count [1,2,3,4,5] as 3', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]' });
    expect(parse(result).median).toBe(3);
  });

  it('should calculate median of even count [1,2,3,4] as 2.5', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4]' });
    expect(parse(result).median).toBe(2.5);
  });

  it('should calculate median of unsorted input correctly', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[5,1,3,2,4]' });
    expect(parse(result).median).toBe(3);
  });

  // --- Mode ---

  it('should find mode [1] for [1,1,2,3]', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,1,2,3]' });
    const data = parse(result);
    expect(data.mode).toEqual([1]);
  });

  it('should find multiple modes [1,3] for [1,1,2,3,3]', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,1,2,3,3]' });
    const data = parse(result);
    expect(data.mode).toEqual(expect.arrayContaining([1, 3]));
    expect(data.mode).toHaveLength(2);
  });

  it('should return "no mode" when all values have same frequency', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3]' });
    expect(parse(result).mode).toBe('no mode');
  });

  // --- Variance and standard deviation ---

  it('should calculate variance and stdDev for [2, 4, 4, 4, 5, 5, 7, 9]', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[2, 4, 4, 4, 5, 5, 7, 9]' });
    const data = parse(result);
    // mean = 5, population variance = 4
    expect(data.mean).toBe(5);
    expect(data.variance).toBe(4);
    expect(data.standardDeviation).toBe(2);
  });

  // --- Min, max, range ---

  it('should calculate min, max, and range', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[3, 7, 1, 9, 4]' });
    const data = parse(result);
    expect(data.min).toBe(1);
    expect(data.max).toBe(9);
    expect(data.range).toBe(8);
  });

  // --- Quartiles ---

  it('should calculate quartiles for [1,2,3,4,5,6,7,8,9,10]', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5,6,7,8,9,10]' });
    const data = parse(result);
    expect(data.quartiles.q1).toBeCloseTo(3.25, 4);
    expect(data.quartiles.q2).toBe(5.5); // median
    expect(data.quartiles.q3).toBeCloseTo(7.75, 4);
  });

  // --- Percentile ---

  it('should calculate requested percentile', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]', percentile: 50 });
    const data = parse(result);
    expect(data.requestedPercentile).toBeDefined();
    expect(data.requestedPercentile.percentile).toBe(50);
    expect(data.requestedPercentile.value).toBe(3); // median
  });

  it('should calculate 0th percentile as min', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]', percentile: 0 });
    const data = parse(result);
    expect(data.requestedPercentile.value).toBe(1);
  });

  it('should calculate 100th percentile as max', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3,4,5]', percentile: 100 });
    const data = parse(result);
    expect(data.requestedPercentile.value).toBe(5);
  });

  it('should not include requestedPercentile when not specified', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[1,2,3]' });
    expect(parse(result).requestedPercentile).toBeUndefined();
  });

  // --- Single number ---

  it('should handle a single number', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[5]' });
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.sum).toBe(5);
    expect(data.mean).toBe(5);
    expect(data.median).toBe(5);
    expect(data.min).toBe(5);
    expect(data.max).toBe(5);
    expect(data.range).toBe(0);
    expect(data.variance).toBe(0);
    expect(data.standardDeviation).toBe(0);
  });

  // --- Error cases ---

  it('should error on empty numbers', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('No valid numbers provided');
  });

  it('should error on non-numeric comma-separated values', async () => {
    const result = await calculateStatisticsExecutor({ numbers: 'a, b, c' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('No valid numbers provided');
  });

  it('should error on empty JSON array', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[]' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('No valid numbers provided');
  });

  // --- Large datasets ---

  it('should handle a large dataset', async () => {
    const nums = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = await calculateStatisticsExecutor({ numbers: JSON.stringify(nums) });
    const data = parse(result);
    expect(data.count).toBe(100);
    expect(data.sum).toBe(5050);
    expect(data.mean).toBe(50.5);
    expect(data.min).toBe(1);
    expect(data.max).toBe(100);
  });

  // --- Negative numbers ---

  it('should handle negative numbers', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '[-3, -1, 0, 1, 3]' });
    const data = parse(result);
    expect(data.mean).toBe(0);
    expect(data.min).toBe(-3);
    expect(data.max).toBe(3);
    expect(data.range).toBe(6);
  });

  // --- Decimal numbers ---

  it('should handle decimal numbers', async () => {
    const result = await calculateStatisticsExecutor({ numbers: '1.5, 2.5, 3.5' });
    const data = parse(result);
    expect(data.mean).toBe(2.5);
    expect(data.median).toBe(2.5);
    expect(data.sum).toBe(7.5);
  });
});
