/**
 * Utility Tools
 *
 * General-purpose utility tools for AI agents:
 * - Date/time operations
 * - Mathematical calculations
 * - Unit conversions
 * - Text utilities
 * - Validation
 * - Encoding/hashing
 * - Random generation
 */

import * as crypto from 'node:crypto';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';

// =============================================================================
// DATE/TIME TOOLS
// =============================================================================

export const getCurrentDateTimeTool: ToolDefinition = {
  name: 'get_current_datetime',
  description: `Get the current date and time. Use this when you need to know the current time,
calculate relative dates, or provide time-sensitive information.
Returns date in multiple formats and includes timezone info.`,
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Timezone name (e.g., "Europe/Istanbul", "America/New_York", "UTC"). Defaults to local timezone.',
      },
      format: {
        type: 'string',
        enum: ['iso', 'locale', 'unix', 'all'],
        description: 'Output format: iso (ISO 8601), locale (localized), unix (timestamp), all (everything). Default: all',
      },
    },
    required: [],
  },
};

export const getCurrentDateTimeExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const timezone = (args.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const format = (args.format as string) || 'all';
    const now = new Date();

    const formatDate = (tz: string) => {
      try {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          weekday: 'long',
        }).format(now);
      } catch {
        return null;
      }
    };

    const localFormatted = formatDate(timezone);
    if (!localFormatted) {
      return {
        content: JSON.stringify({ error: `Invalid timezone: ${timezone}` }),
        isError: true,
      };
    }

    let result: Record<string, unknown>;

    switch (format) {
      case 'iso':
        result = { iso: now.toISOString(), timezone };
        break;
      case 'locale':
        result = { formatted: localFormatted, timezone };
        break;
      case 'unix':
        result = { unix: Math.floor(now.getTime() / 1000), unixMs: now.getTime(), timezone };
        break;
      case 'all':
      default:
        result = {
          iso: now.toISOString(),
          formatted: localFormatted,
          unix: Math.floor(now.getTime() / 1000),
          unixMs: now.getTime(),
          timezone,
          date: now.toISOString().split('T')[0],
          time: now.toISOString().split('T')[1]?.split('.')[0],
          dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }),
          weekNumber: getWeekNumber(now),
          quarter: Math.ceil((now.getMonth() + 1) / 3),
          isWeekend: [0, 6].includes(now.getDay()),
        };
    }

    return { content: JSON.stringify(result) };
  } catch (error) {
    return {
      content: `Error getting datetime: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// =============================================================================
// CALCULATION TOOLS
// =============================================================================

export const calculateTool: ToolDefinition = {
  name: 'calculate',
  description: `Perform mathematical calculations. Supports basic arithmetic, percentages,
and common math functions. Use this for any numerical computation.
Examples: "15% of 250", "sqrt(144)", "2^10", "(45 + 55) * 2"`,
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to evaluate (e.g., "2 + 2", "15% of 200", "sqrt(16)")',
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
    if (!/^[0-9+\-*/().%\s,Math.PIELOGSQRTSINCOSTABNFLRCEUXP]+$/i.test(expr.replace(/Math\./g, ''))) {
      return {
        content: JSON.stringify({ error: 'Invalid characters in expression' }),
        isError: true,
      };
    }

    // Evaluate
    // eslint-disable-next-line no-eval
    const result = eval(expr);

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
      content: `Calculation error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// UNIT CONVERSION TOOLS
// =============================================================================

export const convertUnitsTool: ToolDefinition = {
  name: 'convert_units',
  description: `Convert between different units of measurement.
Supports: length, weight, temperature, volume, area, speed, time, data.
Examples: "5 kg to lb", "100 km to miles", "30 celsius to fahrenheit"`,
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
    m: 1, meter: 1, meters: 1,
    km: 1000, kilometer: 1000, kilometers: 1000,
    cm: 0.01, centimeter: 0.01, centimeters: 0.01,
    mm: 0.001, millimeter: 0.001, millimeters: 0.001,
    mi: 1609.344, mile: 1609.344, miles: 1609.344,
    yd: 0.9144, yard: 0.9144, yards: 0.9144,
    ft: 0.3048, foot: 0.3048, feet: 0.3048,
    in: 0.0254, inch: 0.0254, inches: 0.0254,
    nm: 1852, 'nautical mile': 1852, 'nautical miles': 1852,
  },
  // Weight (base: grams)
  weight: {
    g: 1, gram: 1, grams: 1,
    kg: 1000, kilogram: 1000, kilograms: 1000,
    mg: 0.001, milligram: 0.001, milligrams: 0.001,
    lb: 453.592, pound: 453.592, pounds: 453.592,
    oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
    ton: 1000000, tons: 1000000,
    tonne: 1000000, tonnes: 1000000,
  },
  // Volume (base: liters)
  volume: {
    l: 1, liter: 1, liters: 1, litre: 1, litres: 1,
    ml: 0.001, milliliter: 0.001, milliliters: 0.001,
    gal: 3.78541, gallon: 3.78541, gallons: 3.78541,
    qt: 0.946353, quart: 0.946353, quarts: 0.946353,
    pt: 0.473176, pint: 0.473176, pints: 0.473176,
    cup: 0.236588, cups: 0.236588,
    floz: 0.0295735, 'fluid ounce': 0.0295735, 'fluid ounces': 0.0295735,
    m3: 1000, 'cubic meter': 1000, 'cubic meters': 1000,
  },
  // Area (base: square meters)
  area: {
    m2: 1, sqm: 1, 'square meter': 1, 'square meters': 1,
    km2: 1000000, sqkm: 1000000, 'square kilometer': 1000000,
    cm2: 0.0001, sqcm: 0.0001, 'square centimeter': 0.0001,
    ft2: 0.092903, sqft: 0.092903, 'square foot': 0.092903, 'square feet': 0.092903,
    mi2: 2589988, sqmi: 2589988, 'square mile': 2589988,
    acre: 4046.86, acres: 4046.86,
    hectare: 10000, hectares: 10000, ha: 10000,
  },
  // Speed (base: m/s)
  speed: {
    'mps': 1, 'm/s': 1, 'meters per second': 1,
    'kmh': 0.277778, 'km/h': 0.277778, 'kph': 0.277778, 'kilometers per hour': 0.277778,
    'mph': 0.44704, 'miles per hour': 0.44704,
    'knot': 0.514444, 'knots': 0.514444,
    'fps': 0.3048, 'ft/s': 0.3048, 'feet per second': 0.3048,
  },
  // Time (base: seconds)
  time: {
    s: 1, sec: 1, second: 1, seconds: 1,
    ms: 0.001, millisecond: 0.001, milliseconds: 0.001,
    min: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
    wk: 604800, week: 604800, weeks: 604800,
    mo: 2592000, month: 2592000, months: 2592000, // 30 days
    yr: 31536000, year: 31536000, years: 31536000, // 365 days
  },
  // Data (base: bytes)
  data: {
    b: 1, byte: 1, bytes: 1,
    kb: 1024, kilobyte: 1024, kilobytes: 1024,
    mb: 1048576, megabyte: 1048576, megabytes: 1048576,
    gb: 1073741824, gigabyte: 1073741824, gigabytes: 1073741824,
    tb: 1099511627776, terabyte: 1099511627776, terabytes: 1099511627776,
    bit: 0.125, bits: 0.125,
    kbit: 128, kilobit: 128, kilobits: 128,
    mbit: 131072, megabit: 131072, megabits: 131072,
    gbit: 134217728, gigabit: 134217728, gigabits: 134217728,
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
    case 'c': celsius = value; break;
    case 'f': celsius = (value - 32) * 5 / 9; break;
    case 'k': celsius = value - 273.15; break;
    default: return null;
  }

  // Convert from Celsius to target
  switch (t) {
    case 'c': return celsius;
    case 'f': return celsius * 9 / 5 + 32;
    case 'k': return celsius + 273.15;
    default: return null;
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
      content: `Conversion error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// RANDOM GENERATION TOOLS
// =============================================================================

export const generateUuidTool: ToolDefinition = {
  name: 'generate_uuid',
  description: 'Generate a universally unique identifier (UUID v4).',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of UUIDs to generate (default: 1, max: 10)',
      },
      format: {
        type: 'string',
        enum: ['standard', 'no-dashes', 'uppercase'],
        description: 'UUID format (default: standard)',
      },
    },
    required: [],
  },
};

export const generateUuidExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const count = Math.min((args.count as number) || 1, 10);
    const format = (args.format as string) || 'standard';

    const uuids: string[] = [];
    for (let i = 0; i < count; i++) {
      let uuid: string = crypto.randomUUID();
      if (format === 'no-dashes') {
        uuid = uuid.replace(/-/g, '');
      } else if (format === 'uppercase') {
        uuid = uuid.toUpperCase();
      }
      uuids.push(uuid);
    }

    return {
      content: JSON.stringify(count === 1 ? { uuid: uuids[0] } : { uuids, count }),
    };
  } catch (error) {
    return {
      content: `Error generating UUID: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

export const generatePasswordTool: ToolDefinition = {
  name: 'generate_password',
  description: 'Generate a secure random password.',
  parameters: {
    type: 'object',
    properties: {
      length: {
        type: 'number',
        description: 'Password length (default: 16, min: 8, max: 128)',
      },
      includeUppercase: {
        type: 'boolean',
        description: 'Include uppercase letters (default: true)',
      },
      includeLowercase: {
        type: 'boolean',
        description: 'Include lowercase letters (default: true)',
      },
      includeNumbers: {
        type: 'boolean',
        description: 'Include numbers (default: true)',
      },
      includeSymbols: {
        type: 'boolean',
        description: 'Include symbols (default: true)',
      },
      excludeAmbiguous: {
        type: 'boolean',
        description: 'Exclude ambiguous characters like 0, O, l, 1, I (default: false)',
      },
      count: {
        type: 'number',
        description: 'Number of passwords to generate (default: 1, max: 5)',
      },
    },
    required: [],
  },
};

export const generatePasswordExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const length = Math.max(8, Math.min((args.length as number) || 16, 128));
    const includeUppercase = args.includeUppercase !== false;
    const includeLowercase = args.includeLowercase !== false;
    const includeNumbers = args.includeNumbers !== false;
    const includeSymbols = args.includeSymbols !== false;
    const excludeAmbiguous = args.excludeAmbiguous === true;
    const count = Math.min((args.count as number) || 1, 5);

    let chars = '';
    if (includeUppercase) chars += excludeAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLowercase) chars += excludeAmbiguous ? 'abcdefghjkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (includeNumbers) chars += excludeAmbiguous ? '23456789' : '0123456789';
    if (includeSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (chars.length === 0) {
      return {
        content: JSON.stringify({ error: 'At least one character type must be included' }),
        isError: true,
      };
    }

    const passwords: string[] = [];
    for (let i = 0; i < count; i++) {
      let password = '';
      const randomBytes = crypto.randomBytes(length);
      for (let j = 0; j < length; j++) {
        password += chars[randomBytes[j]! % chars.length];
      }
      passwords.push(password);
    }

    // Calculate password strength
    const entropyPerChar = Math.log2(chars.length);
    const totalEntropy = entropyPerChar * length;
    const strength = totalEntropy >= 128 ? 'very strong' :
                     totalEntropy >= 80 ? 'strong' :
                     totalEntropy >= 60 ? 'moderate' :
                     totalEntropy >= 40 ? 'weak' : 'very weak';

    return {
      content: JSON.stringify(
        count === 1
          ? { password: passwords[0], length, strength, entropyBits: Math.round(totalEntropy) }
          : { passwords, count, length, strength, entropyBits: Math.round(totalEntropy) }
      ),
    };
  } catch (error) {
    return {
      content: `Error generating password: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

export const generateRandomNumberTool: ToolDefinition = {
  name: 'random_number',
  description: 'Generate a random number within a specified range.',
  parameters: {
    type: 'object',
    properties: {
      min: {
        type: 'number',
        description: 'Minimum value (default: 0)',
      },
      max: {
        type: 'number',
        description: 'Maximum value (default: 100)',
      },
      count: {
        type: 'number',
        description: 'Number of random numbers to generate (default: 1, max: 100)',
      },
      integer: {
        type: 'boolean',
        description: 'Generate integer only (default: true)',
      },
    },
    required: [],
  },
};

export const generateRandomNumberExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const min = (args.min as number) ?? 0;
    const max = (args.max as number) ?? 100;
    const count = Math.min((args.count as number) || 1, 100);
    const integer = args.integer !== false;

    if (min >= max) {
      return {
        content: JSON.stringify({ error: 'min must be less than max' }),
        isError: true,
      };
    }

    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      const rand = Math.random() * (max - min) + min;
      numbers.push(integer ? Math.floor(rand) : Number(rand.toFixed(4)));
    }

    return {
      content: JSON.stringify(
        count === 1
          ? { number: numbers[0], min, max }
          : { numbers, count, min, max }
      ),
    };
  } catch (error) {
    return {
      content: `Error generating random number: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// ENCODING/HASHING TOOLS
// =============================================================================

export const hashTextTool: ToolDefinition = {
  name: 'hash_text',
  description: 'Generate a hash of the given text using various algorithms.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to hash',
      },
      algorithm: {
        type: 'string',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
        description: 'Hash algorithm (default: sha256)',
      },
    },
    required: ['text'],
  },
};

export const hashTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const algorithm = (args.algorithm as string) || 'sha256';

    const hash = crypto.createHash(algorithm).update(text).digest('hex');

    return {
      content: JSON.stringify({
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        algorithm,
        hash,
        length: hash.length,
      }),
    };
  } catch (error) {
    return {
      content: `Error hashing text: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

export const encodeDecodeTool: ToolDefinition = {
  name: 'encode_decode',
  description: 'Encode or decode text using various encoding methods.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to encode or decode',
      },
      method: {
        type: 'string',
        enum: ['base64', 'url', 'html', 'hex'],
        description: 'Encoding method',
      },
      operation: {
        type: 'string',
        enum: ['encode', 'decode'],
        description: 'Whether to encode or decode',
      },
    },
    required: ['text', 'method', 'operation'],
  },
};

export const encodeDecodeExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const method = args.method as string;
    const operation = args.operation as 'encode' | 'decode';

    let result: string;

    switch (method) {
      case 'base64':
        result = operation === 'encode'
          ? Buffer.from(text).toString('base64')
          : Buffer.from(text, 'base64').toString('utf-8');
        break;
      case 'url':
        result = operation === 'encode'
          ? encodeURIComponent(text)
          : decodeURIComponent(text);
        break;
      case 'html':
        if (operation === 'encode') {
          result = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        } else {
          result = text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");
        }
        break;
      case 'hex':
        result = operation === 'encode'
          ? Buffer.from(text).toString('hex')
          : Buffer.from(text, 'hex').toString('utf-8');
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown encoding method: ${method}` }),
          isError: true,
        };
    }

    return {
      content: JSON.stringify({
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        output: result,
        method,
        operation,
      }),
    };
  } catch (error) {
    return {
      content: `Error ${args.operation}ing text: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// TEXT UTILITY TOOLS
// =============================================================================

export const countTextTool: ToolDefinition = {
  name: 'count_text',
  description: 'Count characters, words, sentences, and paragraphs in text.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to analyze',
      },
    },
    required: ['text'],
  },
};

export const countTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
    const lines = text.split('\n').length;

    // Estimate reading time (average 200 words per minute)
    const readingTimeMinutes = Math.ceil(words / 200);

    return {
      content: JSON.stringify({
        characters: chars,
        charactersNoSpaces: charsNoSpaces,
        words,
        sentences,
        paragraphs,
        lines,
        readingTimeMinutes,
      }),
    };
  } catch (error) {
    return {
      content: `Error counting text: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

export const extractFromTextTool: ToolDefinition = {
  name: 'extract_from_text',
  description: 'Extract specific patterns from text (URLs, emails, phone numbers, dates, etc.).',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to extract from',
      },
      pattern: {
        type: 'string',
        enum: ['urls', 'emails', 'phones', 'dates', 'numbers', 'hashtags', 'mentions'],
        description: 'What to extract',
      },
    },
    required: ['text', 'pattern'],
  },
};

export const extractFromTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const pattern = args.pattern as string;

    const patterns: Record<string, RegExp> = {
      urls: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
      emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
      phones: /[\+]?[(]?[0-9]{1,4}[)]?[-\s\./0-9]{7,}/g,
      dates: /\b\d{1,4}[-/.\s]\d{1,2}[-/.\s]\d{1,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi,
      numbers: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      hashtags: /#[a-zA-Z0-9_]+/g,
      mentions: /@[a-zA-Z0-9_]+/g,
    };

    const regex = patterns[pattern];
    if (!regex) {
      return {
        content: JSON.stringify({ error: `Unknown pattern: ${pattern}` }),
        isError: true,
      };
    }

    const matches = text.match(regex) || [];
    const unique = [...new Set(matches)];

    return {
      content: JSON.stringify({
        pattern,
        matches: unique,
        count: unique.length,
        totalOccurrences: matches.length,
      }),
    };
  } catch (error) {
    return {
      content: `Error extracting from text: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// VALIDATION TOOLS
// =============================================================================

export const validateTool: ToolDefinition = {
  name: 'validate',
  description: 'Validate various data formats (email, URL, JSON, credit card, IBAN, phone, etc.).',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'string',
        description: 'The value to validate',
      },
      type: {
        type: 'string',
        enum: ['email', 'url', 'json', 'credit_card', 'iban', 'phone', 'uuid', 'ip', 'tc_kimlik'],
        description: 'What type of validation to perform',
      },
    },
    required: ['value', 'type'],
  },
};

function validateEmail(email: string): { valid: boolean; reason?: string } {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!regex.test(email)) {
    return { valid: false, reason: 'Invalid email format' };
  }
  return { valid: true };
}

function validateUrl(url: string): { valid: boolean; reason?: string } {
  try {
    new URL(url);
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

function validateJson(json: string): { valid: boolean; reason?: string; parsed?: unknown } {
  try {
    const parsed = JSON.parse(json);
    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

function validateCreditCard(number: string): { valid: boolean; reason?: string; type?: string } {
  const cleaned = number.replace(/\D/g, '');

  // Luhn algorithm
  let sum = 0;
  let isEven = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned[i]!, 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  if (sum % 10 !== 0) {
    return { valid: false, reason: 'Invalid card number (Luhn check failed)' };
  }

  // Detect card type
  let type = 'unknown';
  if (/^4/.test(cleaned)) type = 'Visa';
  else if (/^5[1-5]/.test(cleaned)) type = 'Mastercard';
  else if (/^3[47]/.test(cleaned)) type = 'American Express';
  else if (/^6(?:011|5)/.test(cleaned)) type = 'Discover';

  return { valid: true, type };
}

function validateIban(iban: string): { valid: boolean; reason?: string; country?: string } {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();

  if (cleaned.length < 15 || cleaned.length > 34) {
    return { valid: false, reason: 'IBAN length is invalid' };
  }

  // Move first 4 chars to end and replace letters with numbers
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));

  // Mod 97 check
  let remainder = numeric;
  while (remainder.length > 2) {
    const block = remainder.slice(0, 9);
    remainder = String(parseInt(block, 10) % 97) + remainder.slice(block.length);
  }

  if (parseInt(remainder, 10) !== 1) {
    return { valid: false, reason: 'IBAN checksum is invalid' };
  }

  return { valid: true, country: cleaned.slice(0, 2) };
}

function validateTcKimlik(tcNo: string): { valid: boolean; reason?: string } {
  const cleaned = tcNo.replace(/\D/g, '');

  if (cleaned.length !== 11) {
    return { valid: false, reason: 'TC Kimlik must be 11 digits' };
  }

  if (cleaned[0] === '0') {
    return { valid: false, reason: 'TC Kimlik cannot start with 0' };
  }

  const digits = cleaned.split('').map(Number);

  // Check digit 10
  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;
  const check10 = ((oddSum * 7) - evenSum) % 10;

  if (check10 !== digits[9]) {
    return { valid: false, reason: 'TC Kimlik checksum (digit 10) is invalid' };
  }

  // Check digit 11
  const sumFirst10 = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  if (sumFirst10 % 10 !== digits[10]) {
    return { valid: false, reason: 'TC Kimlik checksum (digit 11) is invalid' };
  }

  return { valid: true };
}

export const validateExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const value = args.value as string;
    const type = args.type as string;

    let result: { valid: boolean; reason?: string; [key: string]: unknown };

    switch (type) {
      case 'email':
        result = validateEmail(value);
        break;
      case 'url':
        result = validateUrl(value);
        break;
      case 'json':
        result = validateJson(value);
        break;
      case 'credit_card':
        result = validateCreditCard(value);
        break;
      case 'iban':
        result = validateIban(value);
        break;
      case 'phone':
        // Basic phone validation
        const cleanedPhone = value.replace(/\D/g, '');
        result = cleanedPhone.length >= 10 && cleanedPhone.length <= 15
          ? { valid: true, normalized: cleanedPhone }
          : { valid: false, reason: 'Phone number should be 10-15 digits' };
        break;
      case 'uuid':
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        result = uuidRegex.test(value)
          ? { valid: true }
          : { valid: false, reason: 'Invalid UUID format' };
        break;
      case 'ip':
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}$/;
        if (ipv4Regex.test(value)) {
          result = { valid: true, version: 'IPv4' };
        } else if (ipv6Regex.test(value)) {
          result = { valid: true, version: 'IPv6' };
        } else {
          result = { valid: false, reason: 'Invalid IP address format' };
        }
        break;
      case 'tc_kimlik':
        result = validateTcKimlik(value);
        break;
      default:
        result = { valid: false, reason: `Unknown validation type: ${type}` };
    }

    return {
      content: JSON.stringify({ type, value: value.substring(0, 50), ...result }),
    };
  } catch (error) {
    return {
      content: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// EXPORT ALL UTILITY TOOLS
// =============================================================================

export const UTILITY_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  // Date/Time
  { definition: getCurrentDateTimeTool, executor: getCurrentDateTimeExecutor },
  // Calculation
  { definition: calculateTool, executor: calculateExecutor },
  // Unit Conversion
  { definition: convertUnitsTool, executor: convertUnitsExecutor },
  // Random Generation
  { definition: generateUuidTool, executor: generateUuidExecutor },
  { definition: generatePasswordTool, executor: generatePasswordExecutor },
  { definition: generateRandomNumberTool, executor: generateRandomNumberExecutor },
  // Encoding/Hashing
  { definition: hashTextTool, executor: hashTextExecutor },
  { definition: encodeDecodeTool, executor: encodeDecodeExecutor },
  // Text Utilities
  { definition: countTextTool, executor: countTextExecutor },
  { definition: extractFromTextTool, executor: extractFromTextExecutor },
  // Validation
  { definition: validateTool, executor: validateExecutor },
];

/**
 * Get tool names for utility operations
 */
export const UTILITY_TOOL_NAMES = UTILITY_TOOLS.map((t) => t.definition.name);
