/**
 * Utility Data Tools
 *
 * - Data validation (email, URL, JSON, IBAN, credit card, TC Kimlik)
 * - JSON formatting and querying
 * - CSV parsing and generation
 * - Array/collection operations
 * - System information
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// VALIDATION
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
// JSON FORMATTING
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

// =============================================================================
// CSV PARSING
// =============================================================================

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

// =============================================================================
// CSV GENERATION
// =============================================================================

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
// ARRAY/COLLECTION OPERATIONS
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
// SYSTEM INFO
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
