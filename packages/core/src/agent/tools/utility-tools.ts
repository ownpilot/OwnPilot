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
import { runInNewContext } from 'node:vm';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// DATE/TIME TOOLS
// =============================================================================

export const getCurrentDateTimeTool: ToolDefinition = {
  name: 'get_current_datetime',
  brief: 'Get current date, time, timezone, and day of week',
  description: `Get the current date and time. Call this whenever the user asks "what time is it", "what day is today", or when you need to know the current time for scheduling, deadlines, or time-sensitive responses. Returns ISO, formatted, and unix timestamp.`,
  category: 'Utilities',
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
      content: `Error getting datetime: ${getErrorMessage(error)}`,
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
  brief: 'Evaluate math expressions with functions and percentages',
  description: `Perform mathematical calculations. Call this whenever the user asks to compute, calculate, or do math. Supports arithmetic (+,-,*,/), percentages ("15% of 250"), powers (2^10), and functions (sqrt, sin, cos, log, abs, floor, ceil, round). Returns the numeric result.`,
  category: 'Utilities',
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
// UNIT CONVERSION TOOLS
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
      content: `Conversion error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// RANDOM GENERATION TOOLS
// =============================================================================

export const generateUuidTool: ToolDefinition = {
  name: 'generate_uuid',
  brief: 'Generate one or more unique UUIDs',
  description: 'Generate a unique ID (UUID v4). Call this when the user needs a unique identifier, reference code, or tracking ID. Can generate multiple UUIDs at once.',
  category: 'Utilities',
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
      content: `Error generating UUID: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const generatePasswordTool: ToolDefinition = {
  name: 'generate_password',
  brief: 'Generate secure random passwords with strength rating',
  description: 'Generate a secure random password. Call this when the user asks for a password, passphrase, or secure random string. Configurable length, character types, and strength indicator.',
  category: 'Utilities',
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
      content: `Error generating password: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const generateRandomNumberTool: ToolDefinition = {
  name: 'random_number',
  brief: 'Generate random numbers in a range',
  description: 'Generate random numbers. Call this when the user wants a random number, dice roll, coin flip, lottery numbers, or random selection from a range. Supports integer and decimal output.',
  category: 'Utilities',
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
      content: `Error generating random number: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// ENCODING/HASHING TOOLS
// =============================================================================

export const hashTextTool: ToolDefinition = {
  name: 'hash_text',
  brief: 'Hash text with MD5, SHA-1, SHA-256, or SHA-512',
  description: 'Generate a cryptographic hash of text. Call this when the user wants to hash a string, verify integrity, or create a checksum. Supports MD5, SHA-1, SHA-256, SHA-512.',
  category: 'Utilities',
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
      content: `Error hashing text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const encodeDecodeTool: ToolDefinition = {
  name: 'encode_decode',
  brief: 'Encode/decode text: Base64, URL, HTML, or Hex',
  description: 'Encode or decode text. Call this when the user wants to convert text to/from Base64, URL-encode, HTML-encode, or Hex. Useful for encoding data for APIs, URLs, or debugging encoded strings.',
  category: 'Utilities',
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
      content: `Error ${args.operation}ing text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// TEXT UTILITY TOOLS
// =============================================================================

export const countTextTool: ToolDefinition = {
  name: 'count_text',
  brief: 'Count words, characters, sentences, lines in text',
  description: 'Count characters, words, sentences, lines, and paragraphs in text. Call this when the user asks "how many words", "character count", word count, or needs text length stats. Also estimates reading time.',
  category: 'Utilities',
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
      content: `Error counting text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const extractFromTextTool: ToolDefinition = {
  name: 'extract_from_text',
  brief: 'Extract URLs, emails, phones, dates from text',
  description: 'Extract structured data from text: URLs, email addresses, phone numbers, dates, numbers, hashtags, or @mentions. Call this when the user pastes text and wants to pull out specific data points.',
  category: 'Utilities',
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
      content: `Error extracting from text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// VALIDATION TOOLS
// =============================================================================

export const validateDataTool: ToolDefinition = {
  name: 'validate_data',
  brief: 'Check if email, URL, JSON, IBAN, UUID, IP is valid',
  description: 'Validate data format correctness. Call this when the user wants to check if an email, URL, phone number, credit card, IBAN, TC Kimlik, JSON, UUID, or IP address is valid. Returns valid/invalid with details.',
  category: 'Utilities',
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
    return { valid: false, reason: getErrorMessage(e, 'Invalid JSON') };
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

export const validateDataExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
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
      content: `Validation error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// STRING MANIPULATION TOOLS
// =============================================================================

export const transformTextTool: ToolDefinition = {
  name: 'transform_text',
  brief: 'Transform text case, slugify, camelCase, trim, reverse',
  description: `Transform text format. Call this when the user wants to convert text case (uppercase, lowercase, title case), create URL slugs, convert naming conventions (camelCase, snake_case, kebab-case, PascalCase), trim whitespace, reverse text, remove accents/diacritics, or truncate text.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to transform',
      },
      operation: {
        type: 'string',
        enum: [
          'uppercase', 'lowercase', 'capitalize', 'title_case',
          'trim', 'trim_start', 'trim_end',
          'slugify', 'camel_case', 'snake_case', 'kebab_case', 'pascal_case',
          'reverse', 'remove_whitespace', 'normalize_whitespace',
          'remove_diacritics', 'truncate'
        ],
        description: 'The transformation to apply',
      },
      options: {
        type: 'object',
        properties: {
          maxLength: { type: 'number', description: 'Max length for truncate operation' },
          suffix: { type: 'string', description: 'Suffix for truncate (default: "...")' },
        },
        description: 'Additional options for certain operations',
      },
    },
    required: ['text', 'operation'],
  },
};

export const transformTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const operation = args.operation as string;
    const options = (args.options as Record<string, unknown>) || {};

    let result: string;

    switch (operation) {
      case 'uppercase':
        result = text.toUpperCase();
        break;
      case 'lowercase':
        result = text.toLowerCase();
        break;
      case 'capitalize':
        result = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
        break;
      case 'title_case':
        result = text.replace(/\w\S*/g, (txt) =>
          txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
        );
        break;
      case 'trim':
        result = text.trim();
        break;
      case 'trim_start':
        result = text.trimStart();
        break;
      case 'trim_end':
        result = text.trimEnd();
        break;
      case 'slugify':
        result = text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        break;
      case 'camel_case':
        result = text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
        break;
      case 'snake_case':
        result = text
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .replace(/[\s-]+/g, '_')
          .toLowerCase();
        break;
      case 'kebab_case':
        result = text
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .replace(/[\s_]+/g, '-')
          .toLowerCase();
        break;
      case 'pascal_case':
        result = text
          .toLowerCase()
          .replace(/(^|[^a-zA-Z0-9])([a-z])/g, (_, __, chr) => chr.toUpperCase());
        break;
      case 'reverse':
        result = [...text].reverse().join('');
        break;
      case 'remove_whitespace':
        result = text.replace(/\s+/g, '');
        break;
      case 'normalize_whitespace':
        result = text.replace(/\s+/g, ' ').trim();
        break;
      case 'remove_diacritics':
        result = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        break;
      case 'truncate':
        const maxLength = (options.maxLength as number) || 100;
        const suffix = (options.suffix as string) ?? '...';
        result = text.length > maxLength
          ? text.slice(0, maxLength - suffix.length) + suffix
          : text;
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown operation: ${operation}` }),
          isError: true,
        };
    }

    return {
      content: JSON.stringify({
        operation,
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        output: result,
        inputLength: text.length,
        outputLength: result.length,
      }),
    };
  } catch (error) {
    return {
      content: `Transform error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// DATE MANIPULATION TOOLS
// =============================================================================

export const dateDiffTool: ToolDefinition = {
  name: 'date_diff',
  brief: 'Calculate difference between two dates',
  description: `Calculate the difference between two dates. Call this when the user asks "how many days between", "how long until", "how old is", or any date comparison. Returns difference in days, hours, weeks, months, years.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      date1: {
        type: 'string',
        description: 'First date (ISO format, or natural like "2024-01-15")',
      },
      date2: {
        type: 'string',
        description: 'Second date (ISO format, or natural like "2024-03-20")',
      },
      unit: {
        type: 'string',
        enum: ['days', 'hours', 'minutes', 'seconds', 'weeks', 'months', 'years', 'all'],
        description: 'Unit for the result (default: all)',
      },
    },
    required: ['date1', 'date2'],
  },
};

export const dateDiffExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const d1 = new Date(args.date1 as string);
    const d2 = new Date(args.date2 as string);
    const unit = (args.unit as string) || 'all';

    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return {
        content: JSON.stringify({ error: 'Invalid date format' }),
        isError: true,
      };
    }

    const diffMs = d2.getTime() - d1.getTime();
    const diffSecs = diffMs / 1000;
    const diffMins = diffSecs / 60;
    const diffHours = diffMins / 60;
    const diffDays = diffHours / 24;
    const diffWeeks = diffDays / 7;
    const diffMonths = diffDays / 30.44; // Average days per month
    const diffYears = diffDays / 365.25;

    const formatNum = (n: number) => Number(n.toFixed(2));

    if (unit === 'all') {
      return {
        content: JSON.stringify({
          from: d1.toISOString(),
          to: d2.toISOString(),
          difference: {
            years: formatNum(diffYears),
            months: formatNum(diffMonths),
            weeks: formatNum(diffWeeks),
            days: formatNum(diffDays),
            hours: formatNum(diffHours),
            minutes: formatNum(diffMins),
            seconds: formatNum(diffSecs),
          },
          isPositive: diffMs >= 0,
        }),
      };
    }

    const unitMap: Record<string, number> = {
      seconds: diffSecs,
      minutes: diffMins,
      hours: diffHours,
      days: diffDays,
      weeks: diffWeeks,
      months: diffMonths,
      years: diffYears,
    };

    return {
      content: JSON.stringify({
        from: d1.toISOString(),
        to: d2.toISOString(),
        difference: formatNum(unitMap[unit] || diffDays),
        unit,
      }),
    };
  } catch (error) {
    return {
      content: `Date diff error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const dateAddTool: ToolDefinition = {
  name: 'date_add',
  brief: 'Add or subtract time from a date',
  description: `Add or subtract time from a date. Call this when the user asks "what date is 30 days from now", "3 weeks ago", "next month", or needs to calculate future/past dates. Use "now" as date for current time.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Starting date (ISO format or natural). Use "now" for current time.',
      },
      amount: {
        type: 'number',
        description: 'Amount to add (negative to subtract)',
      },
      unit: {
        type: 'string',
        enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'],
        description: 'Time unit',
      },
    },
    required: ['date', 'amount', 'unit'],
  },
};

export const dateAddExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const dateStr = args.date as string;
    const amount = args.amount as number;
    const unit = args.unit as string;

    const date = dateStr.toLowerCase() === 'now' ? new Date() : new Date(dateStr);

    if (isNaN(date.getTime())) {
      return {
        content: JSON.stringify({ error: 'Invalid date format' }),
        isError: true,
      };
    }

    const result = new Date(date);

    switch (unit) {
      case 'seconds':
        result.setSeconds(result.getSeconds() + amount);
        break;
      case 'minutes':
        result.setMinutes(result.getMinutes() + amount);
        break;
      case 'hours':
        result.setHours(result.getHours() + amount);
        break;
      case 'days':
        result.setDate(result.getDate() + amount);
        break;
      case 'weeks':
        result.setDate(result.getDate() + (amount * 7));
        break;
      case 'months':
        result.setMonth(result.getMonth() + amount);
        break;
      case 'years':
        result.setFullYear(result.getFullYear() + amount);
        break;
    }

    return {
      content: JSON.stringify({
        original: date.toISOString(),
        result: result.toISOString(),
        resultFormatted: result.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        added: { amount, unit },
      }),
    };
  } catch (error) {
    return {
      content: `Date add error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// JSON/DATA TOOLS
// =============================================================================

export const formatJsonTool: ToolDefinition = {
  name: 'format_json',
  brief: 'Prettify, minify, query, or flatten JSON data',
  description: `Format, minify, or query JSON data. Call this when the user wants to prettify JSON, minify it, extract a value by path (e.g. "user.name"), list keys, flatten nested objects, or sort keys alphabetically.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      json: {
        type: 'string',
        description: 'JSON string to process',
      },
      operation: {
        type: 'string',
        enum: ['prettify', 'minify', 'get_path', 'get_keys', 'get_values', 'flatten', 'sort_keys'],
        description: 'Operation to perform',
      },
      path: {
        type: 'string',
        description: 'JSON path for get_path operation (e.g., "user.name" or "items[0].id")',
      },
      indent: {
        type: 'number',
        description: 'Indentation for prettify (default: 2)',
      },
    },
    required: ['json', 'operation'],
  },
};

export const formatJsonExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const jsonStr = args.json as string;
    const operation = args.operation as string;
    const path = args.path as string;
    const indent = (args.indent as number) || 2;

    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return {
        content: JSON.stringify({ error: 'Invalid JSON input' }),
        isError: true,
      };
    }

    let result: unknown;

    switch (operation) {
      case 'prettify':
        result = JSON.stringify(data, null, indent);
        break;
      case 'minify':
        result = JSON.stringify(data);
        break;
      case 'get_path':
        if (!path) {
          return { content: JSON.stringify({ error: 'Path is required for get_path operation' }), isError: true };
        }
        result = getJsonPath(data, path);
        break;
      case 'get_keys':
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          result = Object.keys(data);
        } else if (Array.isArray(data)) {
          result = data.map((_, i) => i);
        } else {
          result = [];
        }
        break;
      case 'get_values':
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          result = Object.values(data);
        } else if (Array.isArray(data)) {
          result = data;
        } else {
          result = [data];
        }
        break;
      case 'flatten':
        result = flattenObject(data as Record<string, unknown>);
        break;
      case 'sort_keys':
        result = sortObjectKeys(data);
        break;
      default:
        return { content: JSON.stringify({ error: `Unknown operation: ${operation}` }), isError: true };
    }

    return {
      content: JSON.stringify({
        operation,
        result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      }),
    };
  } catch (error) {
    return {
      content: `JSON error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

export const parseCsvTool: ToolDefinition = {
  name: 'parse_csv',
  brief: 'Parse CSV/TSV text into structured JSON',
  description: `Parse CSV/TSV text into structured JSON data. Call this when the user pastes CSV data or wants to convert tabular text into objects. Handles quoted fields, custom delimiters (comma, tab, semicolon), and header rows.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      csv: {
        type: 'string',
        description: 'CSV text to parse',
      },
      delimiter: {
        type: 'string',
        description: 'Column delimiter (default: ",")',
      },
      hasHeader: {
        type: 'boolean',
        description: 'First row is header (default: true)',
      },
      trimValues: {
        type: 'boolean',
        description: 'Trim whitespace from values (default: true)',
      },
    },
    required: ['csv'],
  },
};

export const parseCsvExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const csv = args.csv as string;
    const delimiter = (args.delimiter as string) || ',';
    const hasHeader = args.hasHeader !== false;
    const trimValues = args.trimValues !== false;

    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return { content: JSON.stringify({ error: 'Empty CSV' }), isError: true };
    }

    const parseRow = (row: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          if (inQuotes && row[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          values.push(trimValues ? current.trim() : current);
          current = '';
        } else {
          current += char;
        }
      }
      values.push(trimValues ? current.trim() : current);
      return values;
    };

    const rows = lines.map(parseRow);

    if (hasHeader && rows.length > 0) {
      const headers = rows[0]!;
      const data = rows.slice(1).map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] || '';
        });
        return obj;
      });

      return {
        content: JSON.stringify({
          headers,
          data,
          rowCount: data.length,
          columnCount: headers.length,
        }),
      };
    }

    return {
      content: JSON.stringify({
        data: rows,
        rowCount: rows.length,
        columnCount: rows[0]?.length || 0,
      }),
    };
  } catch (error) {
    return {
      content: `CSV parse error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

export const generateCsvTool: ToolDefinition = {
  name: 'generate_csv',
  brief: 'Convert JSON array to CSV text',
  description: `Generate CSV text from JSON data. Call this when the user wants to convert a JSON array into CSV format for export or sharing. Handles object arrays (with headers) and nested data.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      data: {
        type: 'string',
        description: 'JSON array of objects or arrays to convert to CSV',
      },
      delimiter: {
        type: 'string',
        description: 'Column delimiter (default: ",")',
      },
      includeHeader: {
        type: 'boolean',
        description: 'Include header row (default: true, only for object arrays)',
      },
    },
    required: ['data'],
  },
};

export const generateCsvExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const dataStr = args.data as string;
    const delimiter = (args.delimiter as string) || ',';
    const includeHeader = args.includeHeader !== false;

    let data: unknown[];
    try {
      data = JSON.parse(dataStr);
    } catch {
      return { content: JSON.stringify({ error: 'Invalid JSON input' }), isError: true };
    }

    if (!Array.isArray(data) || data.length === 0) {
      return { content: JSON.stringify({ error: 'Data must be a non-empty array' }), isError: true };
    }

    const escapeValue = (val: unknown): string => {
      const str = String(val ?? '');
      if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines: string[] = [];

    // Check if array of objects
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      const headers = Object.keys(data[0] as Record<string, unknown>);
      if (includeHeader) {
        lines.push(headers.map(escapeValue).join(delimiter));
      }
      for (const row of data) {
        const obj = row as Record<string, unknown>;
        lines.push(headers.map(h => escapeValue(obj[h])).join(delimiter));
      }
    } else if (Array.isArray(data[0])) {
      // Array of arrays
      for (const row of data) {
        lines.push((row as unknown[]).map(escapeValue).join(delimiter));
      }
    } else {
      // Array of primitives
      lines.push(data.map(escapeValue).join(delimiter));
    }

    return {
      content: JSON.stringify({
        csv: lines.join('\n'),
        rowCount: lines.length,
      }),
    };
  } catch (error) {
    return {
      content: `CSV generate error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// ARRAY/COLLECTION TOOLS
// =============================================================================

export const arrayOperationsTool: ToolDefinition = {
  name: 'array_operations',
  brief: 'Sort, deduplicate, shuffle, chunk, or aggregate arrays',
  description: `Perform operations on a list/array of items. Call this when the user wants to sort a list, remove duplicates, shuffle, split into chunks, pick random samples, or calculate sum/average/min/max of numbers. Input is a JSON array string.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      array: {
        type: 'string',
        description: 'JSON array to operate on',
      },
      operation: {
        type: 'string',
        enum: ['sort', 'reverse', 'unique', 'shuffle', 'chunk', 'flatten', 'sample', 'first', 'last', 'sum', 'avg', 'min', 'max', 'count'],
        description: 'Operation to perform',
      },
      options: {
        type: 'object',
        properties: {
          sortKey: { type: 'string', description: 'Key to sort by (for object arrays)' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default: asc)' },
          chunkSize: { type: 'number', description: 'Size of chunks for chunk operation' },
          sampleSize: { type: 'number', description: 'Number of items for sample operation' },
          count: { type: 'number', description: 'Number of items for first/last operations' },
        },
      },
    },
    required: ['array', 'operation'],
  },
};

export const arrayOperationsExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const arrayStr = args.array as string;
    const operation = args.operation as string;
    const options = (args.options as Record<string, unknown>) || {};

    let array: unknown[];
    try {
      array = JSON.parse(arrayStr);
    } catch {
      return { content: JSON.stringify({ error: 'Invalid JSON array' }), isError: true };
    }

    if (!Array.isArray(array)) {
      return { content: JSON.stringify({ error: 'Input must be an array' }), isError: true };
    }

    let result: unknown;

    switch (operation) {
      case 'sort': {
        const key = options.sortKey as string;
        const order = (options.sortOrder as string) || 'asc';
        const sorted = [...array].sort((a, b) => {
          const valA = String(key ? (a as Record<string, unknown>)[key] : a);
          const valB = String(key ? (b as Record<string, unknown>)[key] : b);
          const numA = Number(valA);
          const numB = Number(valB);
          const cmp = (!isNaN(numA) && !isNaN(numB))
            ? numA - numB
            : valA < valB ? -1 : valA > valB ? 1 : 0;
          return order === 'desc' ? -cmp : cmp;
        });
        result = sorted;
        break;
      }
      case 'reverse':
        result = [...array].reverse();
        break;
      case 'unique':
        result = [...new Set(array.map(x => JSON.stringify(x)))].map(x => JSON.parse(x));
        break;
      case 'shuffle': {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        result = shuffled;
        break;
      }
      case 'chunk': {
        const size = (options.chunkSize as number) || 2;
        const chunks: unknown[][] = [];
        for (let i = 0; i < array.length; i += size) {
          chunks.push(array.slice(i, i + size));
        }
        result = chunks;
        break;
      }
      case 'flatten':
        result = array.flat(Infinity);
        break;
      case 'sample': {
        const sampleSize = Math.min((options.sampleSize as number) || 1, array.length);
        const shuffledForSample = [...array].sort(() => Math.random() - 0.5);
        result = shuffledForSample.slice(0, sampleSize);
        break;
      }
      case 'first': {
        const firstCount = (options.count as number) || 1;
        result = array.slice(0, firstCount);
        break;
      }
      case 'last': {
        const lastCount = (options.count as number) || 1;
        result = array.slice(-lastCount);
        break;
      }
      case 'sum': {
        const nums = array.filter((x): x is number => typeof x === 'number');
        result = nums.reduce((a, b) => a + b, 0);
        break;
      }
      case 'avg': {
        const numsAvg = array.filter((x): x is number => typeof x === 'number');
        result = numsAvg.length > 0 ? numsAvg.reduce((a, b) => a + b, 0) / numsAvg.length : 0;
        break;
      }
      case 'min': {
        const numsMin = array.filter((x): x is number => typeof x === 'number');
        result = numsMin.length > 0 ? Math.min(...numsMin) : null;
        break;
      }
      case 'max': {
        const numsMax = array.filter((x): x is number => typeof x === 'number');
        result = numsMax.length > 0 ? Math.max(...numsMax) : null;
        break;
      }
      case 'count':
        result = array.length;
        break;
      default:
        return { content: JSON.stringify({ error: `Unknown operation: ${operation}` }), isError: true };
    }

    return {
      content: JSON.stringify({
        operation,
        inputLength: array.length,
        result,
      }),
    };
  } catch (error) {
    return {
      content: `Array operation error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// STATISTICS TOOLS
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

export const calculateStatisticsExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
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
      numbers = numbersInput.split(',')
        .map(s => parseFloat(s.trim()))
        .filter(n => !isNaN(n));
    }

    if (numbers.length === 0) {
      return { content: JSON.stringify({ error: 'No valid numbers provided' }), isError: true };
    }

    const sorted = [...numbers].sort((a, b) => a - b);
    const n = numbers.length;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    // Median
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
      : sorted[Math.floor(n / 2)]!;

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

// =============================================================================
// COMPARISON TOOLS
// =============================================================================

export const compareTextTool: ToolDefinition = {
  name: 'compare_text',
  brief: 'Diff two texts and show similarity percentage',
  description: `Compare two texts and show differences. Call this when the user wants to diff two versions, check similarity, or find what changed between texts. Compares by lines, words, or characters and shows added/removed/common parts.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text1: {
        type: 'string',
        description: 'First text',
      },
      text2: {
        type: 'string',
        description: 'Second text',
      },
      mode: {
        type: 'string',
        enum: ['lines', 'words', 'chars'],
        description: 'Comparison mode (default: lines)',
      },
    },
    required: ['text1', 'text2'],
  },
};

export const compareTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text1 = args.text1 as string;
    const text2 = args.text2 as string;
    const mode = (args.mode as string) || 'lines';

    const split = (text: string): string[] => {
      switch (mode) {
        case 'lines': return text.split('\n');
        case 'words': return text.split(/\s+/);
        case 'chars': return text.split('');
        default: return text.split('\n');
      }
    };

    const units1 = split(text1);
    const units2 = split(text2);

    // Simple LCS-based diff
    const set1 = new Set(units1);
    const set2 = new Set(units2);

    const added = units2.filter(u => !set1.has(u));
    const removed = units1.filter(u => !set2.has(u));
    const common = units1.filter(u => set2.has(u));

    const identical = text1 === text2;
    const similarity = identical ? 100 :
      (common.length / Math.max(units1.length, units2.length)) * 100;

    return {
      content: JSON.stringify({
        identical,
        similarity: Number(similarity.toFixed(2)),
        mode,
        text1Stats: { count: units1.length },
        text2Stats: { count: units2.length },
        added: added.slice(0, 20),
        removed: removed.slice(0, 20),
        addedCount: added.length,
        removedCount: removed.length,
        commonCount: common.length,
      }),
    };
  } catch (error) {
    return {
      content: `Compare error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// REGEX TOOLS
// =============================================================================

export const runRegexTool: ToolDefinition = {
  name: 'run_regex',
  brief: 'Test, match, replace, or split text with regex',
  description: `Test, match, or replace text using regular expressions. Call this when you need pattern matching, find-and-replace, text splitting by pattern, or when the user asks to extract data matching a specific pattern. Supports test, match, match_all, replace, and split operations.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to search in',
      },
      pattern: {
        type: 'string',
        description: 'Regular expression pattern',
      },
      operation: {
        type: 'string',
        enum: ['test', 'match', 'match_all', 'replace', 'split'],
        description: 'Operation to perform',
      },
      replacement: {
        type: 'string',
        description: 'Replacement string (for replace operation)',
      },
      flags: {
        type: 'string',
        description: 'Regex flags (e.g., "gi" for global, case-insensitive)',
      },
    },
    required: ['text', 'pattern', 'operation'],
  },
};

export const runRegexExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const pattern = args.pattern as string;
    const operation = args.operation as string;
    const replacement = args.replacement as string;
    const flags = (args.flags as string) || '';

    // Guard against excessively long patterns that could cause ReDoS
    if (pattern.length > 1000) {
      return {
        content: JSON.stringify({ error: 'Regex pattern too long (max 1000 characters)' }),
        isError: true,
      };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      return {
        content: JSON.stringify({ error: `Invalid regex: ${getErrorMessage(e)}` }),
        isError: true,
      };
    }

    let result: unknown;

    switch (operation) {
      case 'test':
        result = regex.test(text);
        break;
      case 'match': {
        const match = text.match(regex);
        result = match ? { match: match[0], groups: match.slice(1), index: match.index } : null;
        break;
      }
      case 'match_all': {
        const globalRegex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
        const matches = [...text.matchAll(globalRegex)];
        result = matches.map(m => ({ match: m[0], groups: m.slice(1), index: m.index }));
        break;
      }
      case 'replace':
        result = text.replace(regex, replacement || '');
        break;
      case 'split':
        result = text.split(regex);
        break;
      default:
        return { content: JSON.stringify({ error: `Unknown operation: ${operation}` }), isError: true };
    }

    return {
      content: JSON.stringify({
        operation,
        pattern,
        flags,
        result,
      }),
    };
  } catch (error) {
    return {
      content: `Regex error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// SYSTEM INFO TOOL
// =============================================================================

export const getSystemInfoTool: ToolDefinition = {
  name: 'get_system_info',
  brief: 'Get OS, Node version, memory, and CPU stats',
  description: `Get system information: OS platform, architecture, Node.js version, memory usage, and CPU stats. Call this when the user asks about the system, server status, or when you need platform-specific context for recommendations. Read-only and safe.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      include: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['platform', 'memory', 'cpu', 'env', 'all'],
        },
        description: 'What info to include (default: platform)',
      },
    },
    required: [],
  },
};

export const getSystemInfoExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const include = (args.include as string[]) || ['platform'];
    const includeAll = include.includes('all');

    const result: Record<string, unknown> = {};

    if (includeAll || include.includes('platform')) {
      result.platform = {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
      };
    }

    if (includeAll || include.includes('memory')) {
      const mem = process.memoryUsage();
      result.memory = {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
      };
    }

    if (includeAll || include.includes('cpu')) {
      const cpuUsage = process.cpuUsage();
      result.cpu = {
        user: Math.round(cpuUsage.user / 1000) + ' ms',
        system: Math.round(cpuUsage.system / 1000) + ' ms',
      };
    }

    if (includeAll || include.includes('env')) {
      // Only include safe env vars
      result.env = {
        nodeEnv: process.env.NODE_ENV || 'development',
        tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: process.env.LANG || 'unknown',
      };
    }

    result.timestamp = new Date().toISOString();

    return { content: JSON.stringify(result) };
  } catch (error) {
    return {
      content: `System info error: ${getErrorMessage(error)}`,
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
  { definition: dateDiffTool, executor: dateDiffExecutor },
  { definition: dateAddTool, executor: dateAddExecutor },
  // Calculation & Statistics
  { definition: calculateTool, executor: calculateExecutor },
  { definition: calculateStatisticsTool, executor: calculateStatisticsExecutor },
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
  { definition: transformTextTool, executor: transformTextExecutor },
  { definition: compareTextTool, executor: compareTextExecutor },
  { definition: runRegexTool, executor: runRegexExecutor },
  // Data Processing
  { definition: formatJsonTool, executor: formatJsonExecutor },
  { definition: parseCsvTool, executor: parseCsvExecutor },
  { definition: generateCsvTool, executor: generateCsvExecutor },
  { definition: arrayOperationsTool, executor: arrayOperationsExecutor },
  // Validation
  { definition: validateDataTool, executor: validateDataExecutor },
  // System
  { definition: getSystemInfoTool, executor: getSystemInfoExecutor },
];

/**
 * Get tool names for utility operations
 */
export const UTILITY_TOOL_NAMES = UTILITY_TOOLS.map((t) => t.definition.name);
