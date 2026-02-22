/**
 * Utility Math Tools
 *
 * - Mathematical expression evaluation
 * - Unit conversions (length, weight, temperature, volume, etc.)
 * - Statistical calculations (mean, median, mode, std dev)
 */

import { runInNewContext } from 'node:vm';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// CALCULATION
// =============================================================================

export const calculateTool: ToolDefinition = {
  name: 'calculate',
  brief: 'Evaluate math expressions with functions and percentages',
  description: `Perform mathematical calculations. Call this whenever the user asks to compute, calculate, or do math. Supports arithmetic (+,-,*,/), percentages ("15% of 250"), powers (2^10), and functions (sqrt, sin, cos, log, abs, floor, ceil, round). Returns the numeric result.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description:
          'Mathematical expression to evaluate (e.g., "2 + 2", "15% of 200", "sqrt(16)")',
      },
      precision: {
        type: 'number',
        description: 'Decimal places for result (default: 4)',
      },
    },
    required: ['expression'],
  },
};

export const calculateExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    let expr = args.expression as string;
    const precision = (args.precision as number) ?? 4;

    // Handle percentage expressions like "15% of 250"
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/gi, (_, pct, num) => {
      return `(${pct} / 100 * ${num})`;
    });

    // Handle percentage like "15%"
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1 / 100)');

    // Handle power notation
    expr = expr.replace(/\^/g, '**');

    // Handle common math functions
    const mathFunctions: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log10,
      ln: Math.log,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      exp: Math.exp,
    };

    // Replace function calls
    for (const [name, _fn] of Object.entries(mathFunctions)) {
      const regex = new RegExp(`${name}\\s*\\(([^)]+)\\)`, 'gi');
      expr = expr.replace(regex, `Math.${name}($1)`);
    }

    // Handle pi and e constants
    expr = expr.replace(/\bpi\b/gi, 'Math.PI');
    expr = expr.replace(/\be\b/gi, 'Math.E');

    // Validate expression (only allow safe characters)
    if (
      !/^[0-9+\-*/().%\s,Math.PIELOGSQRTSINCOSTABNFLRCEUXP]+$/i.test(expr.replace(/Math\./g, ''))
    ) {
      return {
        content: JSON.stringify({ error: 'Invalid characters in expression' }),
        isError: true,
      };
    }

    // Evaluate in an isolated VM context with only Math available.
    // This prevents access to process, require, global, etc.
    const result = runInNewContext(expr, { Math }, { timeout: 1000 });

    if (typeof result !== 'number' || !isFinite(result)) {
      return {
        content: JSON.stringify({ error: 'Result is not a valid number' }),
        isError: true,
      };
    }

    const rounded = Number(result.toFixed(precision));

    return {
      content: JSON.stringify({
        expression: args.expression,
        result: rounded,
        formatted: rounded.toLocaleString(),
      }),
    };
  } catch (error) {
    return {
      content: `Calculation error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// UNIT CONVERSION
// =============================================================================

export const convertUnitsTool: ToolDefinition = {
  name: 'convert_units',
  brief: 'Convert between length, weight, temp, volume, data units',
  description: `Convert between units of measurement. Call this when the user asks to convert kg to lb, km to miles, celsius to fahrenheit, liters to gallons, GB to MB, etc. Supports: length, weight, temperature, volume, area, speed, time, and data storage units.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'The value to convert',
      },
      from: {
        type: 'string',
        description: 'Source unit (e.g., "kg", "km", "celsius", "gb")',
      },
      to: {
        type: 'string',
        description: 'Target unit (e.g., "lb", "miles", "fahrenheit", "mb")',
      },
    },
    required: ['value', 'from', 'to'],
  },
};

// Unit conversion factors (to base unit)
const UNIT_CONVERSIONS: Record<string, Record<string, number | ((v: number) => number)>> = {
  // Length (base: meters)
  length: {
    m: 1,
    meter: 1,
    meters: 1,
    km: 1000,
    kilometer: 1000,
    kilometers: 1000,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    mi: 1609.344,
    mile: 1609.344,
    miles: 1609.344,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
    nm: 1852,
    'nautical mile': 1852,
    'nautical miles': 1852,
  },
  // Weight (base: grams)
  weight: {
    g: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    kilogram: 1000,
    kilograms: 1000,
    mg: 0.001,
    milligram: 0.001,
    milligrams: 0.001,
    lb: 453.592,
    pound: 453.592,
    pounds: 453.592,
    oz: 28.3495,
    ounce: 28.3495,
    ounces: 28.3495,
    ton: 1000000,
    tons: 1000000,
    tonne: 1000000,
    tonnes: 1000000,
  },
  // Volume (base: liters)
  volume: {
    l: 1,
    liter: 1,
    liters: 1,
    litre: 1,
    litres: 1,
    ml: 0.001,
    milliliter: 0.001,
    milliliters: 0.001,
    gal: 3.78541,
    gallon: 3.78541,
    gallons: 3.78541,
    qt: 0.946353,
    quart: 0.946353,
    quarts: 0.946353,
    pt: 0.473176,
    pint: 0.473176,
    pints: 0.473176,
    cup: 0.236588,
    cups: 0.236588,
    floz: 0.0295735,
    'fluid ounce': 0.0295735,
    'fluid ounces': 0.0295735,
    m3: 1000,
    'cubic meter': 1000,
    'cubic meters': 1000,
  },
  // Area (base: square meters)
  area: {
    m2: 1,
    sqm: 1,
    'square meter': 1,
    'square meters': 1,
    km2: 1000000,
    sqkm: 1000000,
    'square kilometer': 1000000,
    cm2: 0.0001,
    sqcm: 0.0001,
    'square centimeter': 0.0001,
    ft2: 0.092903,
    sqft: 0.092903,
    'square foot': 0.092903,
    'square feet': 0.092903,
    mi2: 2589988,
    sqmi: 2589988,
    'square mile': 2589988,
    acre: 4046.86,
    acres: 4046.86,
    hectare: 10000,
    hectares: 10000,
    ha: 10000,
  },
  // Speed (base: m/s)
  speed: {
    mps: 1,
    'm/s': 1,
    'meters per second': 1,
    kmh: 0.277778,
    'km/h': 0.277778,
    kph: 0.277778,
    'kilometers per hour': 0.277778,
    mph: 0.44704,
    'miles per hour': 0.44704,
    knot: 0.514444,
    knots: 0.514444,
    fps: 0.3048,
    'ft/s': 0.3048,
    'feet per second': 0.3048,
  },
  // Time (base: seconds)
  time: {
    s: 1,
    sec: 1,
    second: 1,
    seconds: 1,
    ms: 0.001,
    millisecond: 0.001,
    milliseconds: 0.001,
    min: 60,
    minute: 60,
    minutes: 60,
    h: 3600,
    hr: 3600,
    hour: 3600,
    hours: 3600,
    d: 86400,
    day: 86400,
    days: 86400,
    wk: 604800,
    week: 604800,
    weeks: 604800,
    mo: 2592000,
    month: 2592000,
    months: 2592000, // 30 days
    yr: 31536000,
    year: 31536000,
    years: 31536000, // 365 days
  },
  // Data (base: bytes)
  data: {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    kilobyte: 1024,
    kilobytes: 1024,
    mb: 1048576,
    megabyte: 1048576,
    megabytes: 1048576,
    gb: 1073741824,
    gigabyte: 1073741824,
    gigabytes: 1073741824,
    tb: 1099511627776,
    terabyte: 1099511627776,
    terabytes: 1099511627776,
    bit: 0.125,
    bits: 0.125,
    kbit: 128,
    kilobit: 128,
    kilobits: 128,
    mbit: 131072,
    megabit: 131072,
    megabits: 131072,
    gbit: 134217728,
    gigabit: 134217728,
    gigabits: 134217728,
  },
};

// Special temperature conversions
function convertTemperature(value: number, from: string, to: string): number | null {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();

  // Normalize unit names
  const normalize = (u: string) => {
    if (u.includes('celsius') || u === 'c' || u === '°c') return 'c';
    if (u.includes('fahrenheit') || u === 'f' || u === '°f') return 'f';
    if (u.includes('kelvin') || u === 'k') return 'k';
    return u;
  };

  const f = normalize(fromLower);
  const t = normalize(toLower);

  // Convert to Celsius first
  let celsius: number;
  switch (f) {
    case 'c':
      celsius = value;
      break;
    case 'f':
      celsius = ((value - 32) * 5) / 9;
      break;
    case 'k':
      celsius = value - 273.15;
      break;
    default:
      return null;
  }

  // Convert from Celsius to target
  switch (t) {
    case 'c':
      return celsius;
    case 'f':
      return (celsius * 9) / 5 + 32;
    case 'k':
      return celsius + 273.15;
    default:
      return null;
  }
}

export const convertUnitsExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const value = args.value as number;
    const from = (args.from as string).toLowerCase().trim();
    const to = (args.to as string).toLowerCase().trim();

    // Check for temperature
    const tempResult = convertTemperature(value, from, to);
    if (tempResult !== null) {
      return {
        content: JSON.stringify({
          from: { value, unit: from },
          to: { value: Number(tempResult.toFixed(4)), unit: to },
        }),
      };
    }

    // Find the category and conversion factors
    let fromFactor: number | undefined;
    let toFactor: number | undefined;
    let category: string | undefined;

    for (const [cat, units] of Object.entries(UNIT_CONVERSIONS)) {
      const fromVal = units[from];
      const toVal = units[to];
      if (typeof fromVal === 'number' && typeof toVal === 'number') {
        fromFactor = fromVal;
        toFactor = toVal;
        category = cat;
        break;
      }
    }

    if (fromFactor === undefined || toFactor === undefined) {
      return {
        content: JSON.stringify({
          error: `Cannot convert from "${from}" to "${to}". Units may be incompatible or not supported.`,
          supportedCategories: Object.keys(UNIT_CONVERSIONS),
        }),
        isError: true,
      };
    }

    // Convert: value * fromFactor = base units, base units / toFactor = result
    const result = (value * fromFactor) / toFactor;

    return {
      content: JSON.stringify({
        from: { value, unit: from },
        to: { value: Number(result.toFixed(6)), unit: to },
        category,
      }),
    };
  } catch (error) {
    return {
      content: `Conversion error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// STATISTICS
// =============================================================================

export const calculateStatisticsTool: ToolDefinition = {
  name: 'calculate_statistics',
  brief: 'Calculate mean, median, mode, std dev, percentiles',
  description: `Calculate statistics for a set of numbers. Call this when the user wants mean, median, mode, standard deviation, variance, percentiles, quartiles, or a statistical summary. Accepts JSON array or comma-separated numbers.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      numbers: {
        type: 'string',
        description: 'JSON array of numbers, or comma-separated numbers',
      },
      percentile: {
        type: 'number',
        description: 'Calculate specific percentile (0-100)',
      },
    },
    required: ['numbers'],
  },
};

export const calculateStatisticsExecutor: ToolExecutor = async (
  args
): Promise<ToolExecutionResult> => {
  try {
    const numbersInput = args.numbers as string;
    const percentile = args.percentile as number | undefined;

    let numbers: number[];
    try {
      // Try JSON array first
      const parsed = JSON.parse(numbersInput);
      if (Array.isArray(parsed)) {
        numbers = parsed.filter((x): x is number => typeof x === 'number');
      } else {
        throw new Error('Not an array');
      }
    } catch {
      // Try comma-separated
      numbers = numbersInput
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
    }

    if (numbers.length === 0) {
      return { content: JSON.stringify({ error: 'No valid numbers provided' }), isError: true };
    }

    const sorted = [...numbers].sort((a, b) => a - b);
    const n = numbers.length;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    // Median
    const median =
      n % 2 === 0 ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : sorted[Math.floor(n / 2)]!;

    // Mode
    const freq = new Map<number, number>();
    for (const num of numbers) {
      freq.set(num, (freq.get(num) || 0) + 1);
    }
    const maxFreq = Math.max(...freq.values());
    const modes = [...freq.entries()].filter(([_, f]) => f === maxFreq).map(([v]) => v);

    // Variance and Std Dev
    const variance = numbers.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Range
    const min = sorted[0]!;
    const max = sorted[n - 1]!;
    const range = max - min;

    // Percentile calculation
    const calcPercentile = (p: number): number => {
      const idx = (p / 100) * (n - 1);
      const lower = Math.floor(idx);
      const upper = Math.ceil(idx);
      if (lower === upper) return sorted[lower]!;
      return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (idx - lower);
    };

    const result: Record<string, unknown> = {
      count: n,
      sum: Number(sum.toFixed(4)),
      mean: Number(mean.toFixed(4)),
      median: Number(median.toFixed(4)),
      mode: modes.length === n ? 'no mode' : modes,
      variance: Number(variance.toFixed(4)),
      standardDeviation: Number(stdDev.toFixed(4)),
      min,
      max,
      range,
      quartiles: {
        q1: Number(calcPercentile(25).toFixed(4)),
        q2: Number(calcPercentile(50).toFixed(4)),
        q3: Number(calcPercentile(75).toFixed(4)),
      },
    };

    if (percentile !== undefined && percentile >= 0 && percentile <= 100) {
      result.requestedPercentile = {
        percentile,
        value: Number(calcPercentile(percentile).toFixed(4)),
      };
    }

    return { content: JSON.stringify(result) };
  } catch (error) {
    return {
      content: `Statistics error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};
