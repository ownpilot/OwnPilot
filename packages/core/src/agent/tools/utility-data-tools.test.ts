import { describe, it, expect } from 'vitest';
import {
  validateDataTool,
  validateDataExecutor,
  formatJsonTool,
  formatJsonExecutor,
  parseCsvTool,
  parseCsvExecutor,
  generateCsvTool,
  generateCsvExecutor,
  arrayOperationsTool,
  arrayOperationsExecutor,
  getSystemInfoTool,
  getSystemInfoExecutor,
} from './utility-data-tools.js';

function parse(result: { content: string }) {
  return JSON.parse(result.content);
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

describe('tool definitions', () => {
  it('should define validateDataTool with correct shape', () => {
    expect(validateDataTool.name).toBe('validate_data');
    expect(validateDataTool.category).toBe('Utilities');
    expect(validateDataTool.parameters.required).toContain('value');
    expect(validateDataTool.parameters.required).toContain('type');
    expect(validateDataTool.parameters.properties).toHaveProperty('value');
    expect(validateDataTool.parameters.properties).toHaveProperty('type');
  });

  it('should define formatJsonTool with correct shape', () => {
    expect(formatJsonTool.name).toBe('format_json');
    expect(formatJsonTool.category).toBe('Utilities');
    expect(formatJsonTool.parameters.required).toContain('json');
    expect(formatJsonTool.parameters.required).toContain('operation');
  });

  it('should define parseCsvTool with correct shape', () => {
    expect(parseCsvTool.name).toBe('parse_csv');
    expect(parseCsvTool.category).toBe('Utilities');
    expect(parseCsvTool.parameters.required).toContain('csv');
  });

  it('should define generateCsvTool with correct shape', () => {
    expect(generateCsvTool.name).toBe('generate_csv');
    expect(generateCsvTool.category).toBe('Utilities');
    expect(generateCsvTool.parameters.required).toContain('data');
  });

  it('should define arrayOperationsTool with correct shape', () => {
    expect(arrayOperationsTool.name).toBe('array_operations');
    expect(arrayOperationsTool.category).toBe('Utilities');
    expect(arrayOperationsTool.parameters.required).toContain('array');
    expect(arrayOperationsTool.parameters.required).toContain('operation');
  });

  it('should define getSystemInfoTool with correct shape', () => {
    expect(getSystemInfoTool.name).toBe('get_system_info');
    expect(getSystemInfoTool.category).toBe('Utilities');
    expect(getSystemInfoTool.parameters.properties).toHaveProperty('include');
  });
});

// =============================================================================
// VALIDATE DATA EXECUTOR
// =============================================================================

describe('validateDataExecutor', () => {
  // --- Email ---
  describe('email validation', () => {
    it('should validate a correct email', async () => {
      const result = await validateDataExecutor({ value: 'test@example.com', type: 'email' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('email');
      expect(data.value).toBe('test@example.com');
    });

    it('should reject an invalid email', async () => {
      const result = await validateDataExecutor({ value: 'notanemail', type: 'email' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toBe('Invalid email format');
    });

    it('should reject email without TLD', async () => {
      const result = await validateDataExecutor({ value: 'user@localhost', type: 'email' });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });

    it('should accept email with subdomains', async () => {
      const result = await validateDataExecutor({
        value: 'user@mail.sub.example.com',
        type: 'email',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });
  });

  // --- URL ---
  describe('url validation', () => {
    it('should validate a correct URL', async () => {
      const result = await validateDataExecutor({ value: 'https://example.com', type: 'url' });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });

    it('should reject an invalid URL', async () => {
      const result = await validateDataExecutor({ value: 'not-a-url', type: 'url' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toBe('Invalid URL format');
    });

    it('should accept URL with path and query', async () => {
      const result = await validateDataExecutor({
        value: 'https://example.com/path?q=1&b=2',
        type: 'url',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });
  });

  // --- JSON ---
  describe('json validation', () => {
    it('should validate correct JSON', async () => {
      const result = await validateDataExecutor({ value: '{"key":"value"}', type: 'json' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.parsed).toEqual({ key: 'value' });
    });

    it('should reject invalid JSON', async () => {
      const result = await validateDataExecutor({ value: '{broken', type: 'json' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toBeDefined();
    });

    it('should validate JSON array', async () => {
      const result = await validateDataExecutor({ value: '[1,2,3]', type: 'json' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.parsed).toEqual([1, 2, 3]);
    });
  });

  // --- Credit Card ---
  describe('credit_card validation', () => {
    it('should validate a valid Visa card (Luhn passes)', async () => {
      const result = await validateDataExecutor({ value: '4111111111111111', type: 'credit_card' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Visa');
    });

    it('should reject an invalid card number', async () => {
      const result = await validateDataExecutor({ value: '1234567890', type: 'credit_card' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('Luhn');
    });

    it('should detect Mastercard', async () => {
      // 5500000000000004 is a standard Mastercard test number
      const result = await validateDataExecutor({ value: '5500000000000004', type: 'credit_card' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Mastercard');
    });

    it('should detect American Express', async () => {
      // 378282246310005 is a standard Amex test number
      const result = await validateDataExecutor({ value: '378282246310005', type: 'credit_card' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('American Express');
    });

    it('should detect Discover', async () => {
      // 6011111111111117 is a standard Discover test number
      const result = await validateDataExecutor({ value: '6011111111111117', type: 'credit_card' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Discover');
    });

    it('should strip non-digit characters before validation', async () => {
      const result = await validateDataExecutor({
        value: '4111-1111-1111-1111',
        type: 'credit_card',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.type).toBe('Visa');
    });
  });

  // --- IBAN ---
  describe('iban validation', () => {
    it('should validate a correct IBAN', async () => {
      const result = await validateDataExecutor({ value: 'GB29NWBK60161331926819', type: 'iban' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.country).toBe('GB');
    });

    it('should reject an invalid IBAN', async () => {
      const result = await validateDataExecutor({ value: 'XXINVALID', type: 'iban' });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });

    it('should reject IBAN that is too short', async () => {
      const result = await validateDataExecutor({ value: 'GB29NW', type: 'iban' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('length');
    });

    it('should validate IBAN with spaces (stripped)', async () => {
      const result = await validateDataExecutor({
        value: 'GB29 NWBK 6016 1331 9268 19',
        type: 'iban',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.country).toBe('GB');
    });

    it('should reject IBAN with invalid checksum', async () => {
      // Change last digit to break checksum
      const result = await validateDataExecutor({ value: 'GB29NWBK60161331926810', type: 'iban' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('checksum');
    });
  });

  // --- Phone ---
  describe('phone validation', () => {
    it('should validate a 10-digit phone number', async () => {
      const result = await validateDataExecutor({ value: '1234567890', type: 'phone' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.normalized).toBe('1234567890');
    });

    it('should reject a phone number that is too short', async () => {
      const result = await validateDataExecutor({ value: '123', type: 'phone' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('10-15');
    });

    it('should strip non-digit characters', async () => {
      const result = await validateDataExecutor({ value: '+1 (234) 567-8901', type: 'phone' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.normalized).toBe('12345678901');
    });

    it('should reject phone number with too many digits', async () => {
      const result = await validateDataExecutor({ value: '1234567890123456', type: 'phone' });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });
  });

  // --- UUID ---
  describe('uuid validation', () => {
    it('should validate a correct UUID', async () => {
      const result = await validateDataExecutor({
        value: '550e8400-e29b-41d4-a716-446655440000',
        type: 'uuid',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });

    it('should reject an invalid UUID', async () => {
      const result = await validateDataExecutor({ value: 'not-uuid', type: 'uuid' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toBe('Invalid UUID format');
    });

    it('should accept uppercase UUID', async () => {
      const result = await validateDataExecutor({
        value: '550E8400-E29B-41D4-A716-446655440000',
        type: 'uuid',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });

    it('should reject UUID with wrong version digit', async () => {
      // Version position (first digit of 3rd group) must be 1-5
      const result = await validateDataExecutor({
        value: '550e8400-e29b-91d4-a716-446655440000',
        type: 'uuid',
      });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });
  });

  // --- IP ---
  describe('ip validation', () => {
    it('should validate a correct IPv4 address', async () => {
      const result = await validateDataExecutor({ value: '192.168.1.1', type: 'ip' });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.version).toBe('IPv4');
    });

    it('should validate a correct IPv6 address', async () => {
      const result = await validateDataExecutor({
        value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        type: 'ip',
      });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.version).toBe('IPv6');
    });

    it('should reject an invalid IP address', async () => {
      const result = await validateDataExecutor({ value: '999.999.999.999', type: 'ip' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('Invalid IP');
    });

    it('should reject a random string as IP', async () => {
      const result = await validateDataExecutor({ value: 'hello', type: 'ip' });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });
  });

  // --- TC Kimlik ---
  describe('tc_kimlik validation', () => {
    it('should validate a correct TC Kimlik number', async () => {
      const result = await validateDataExecutor({ value: '10000000146', type: 'tc_kimlik' });
      const data = parse(result);
      expect(data.valid).toBe(true);
    });

    it('should reject TC Kimlik starting with 0', async () => {
      const result = await validateDataExecutor({ value: '00000000000', type: 'tc_kimlik' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('start with 0');
    });

    it('should reject TC Kimlik with wrong length', async () => {
      const result = await validateDataExecutor({ value: '12345', type: 'tc_kimlik' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('11 digits');
    });

    it('should reject TC Kimlik with invalid digit-10 checksum', async () => {
      // 10000000137: change last two digits to break digit-10 check
      const result = await validateDataExecutor({ value: '10000000137', type: 'tc_kimlik' });
      const data = parse(result);
      expect(data.valid).toBe(false);
    });
  });

  // --- Unknown type ---
  describe('unknown validation type', () => {
    it('should return error for unknown type', async () => {
      const result = await validateDataExecutor({ value: 'test', type: 'unknown_type' });
      const data = parse(result);
      expect(data.valid).toBe(false);
      expect(data.reason).toContain('Unknown validation type');
    });
  });

  // --- Value truncation ---
  describe('value truncation', () => {
    it('should truncate value to 50 chars in output', async () => {
      const longValue = 'a'.repeat(100) + '@example.com';
      const result = await validateDataExecutor({ value: longValue, type: 'email' });
      const data = parse(result);
      expect(data.value.length).toBe(50);
    });
  });
});

// =============================================================================
// FORMAT JSON EXECUTOR
// =============================================================================

describe('formatJsonExecutor', () => {
  // --- Prettify ---
  describe('prettify', () => {
    it('should prettify JSON with default indent', async () => {
      const result = await formatJsonExecutor({ json: '{"a":1,"b":2}', operation: 'prettify' });
      const data = parse(result);
      expect(data.operation).toBe('prettify');
      expect(data.result).toContain('  '); // 2-space indent
      expect(data.result).toContain('"a": 1');
    });

    it('should prettify JSON with custom indent', async () => {
      const result = await formatJsonExecutor({
        json: '{"a":1}',
        operation: 'prettify',
        indent: 4,
      });
      const data = parse(result);
      expect(data.result).toContain('    "a"'); // 4-space indent
    });
  });

  // --- Minify ---
  describe('minify', () => {
    it('should minify JSON by removing whitespace', async () => {
      const json = '{\n  "a": 1,\n  "b": 2\n}';
      const result = await formatJsonExecutor({ json, operation: 'minify' });
      const data = parse(result);
      expect(data.result).toBe('{"a":1,"b":2}');
    });
  });

  // --- get_path ---
  describe('get_path', () => {
    it('should get a nested value by dot path', async () => {
      const json = '{"user":{"name":"Alice","age":30}}';
      const result = await formatJsonExecutor({ json, operation: 'get_path', path: 'user.name' });
      const data = parse(result);
      // String results are passed through as-is (typeof result === 'string')
      expect(data.result).toBe('Alice');
    });

    it('should get array element by index path', async () => {
      const json = '{"items":[{"id":1},{"id":2}]}';
      const result = await formatJsonExecutor({ json, operation: 'get_path', path: 'items[0].id' });
      const data = parse(result);
      expect(data.result).toBe('1');
    });

    it('should return undefined for non-existent path', async () => {
      const json = '{"a":1}';
      const result = await formatJsonExecutor({ json, operation: 'get_path', path: 'b.c.d' });
      const data = parse(result);
      // undefined serializes as nothing in JSON.stringify
      expect(data.operation).toBe('get_path');
    });

    it('should error when path is not provided', async () => {
      const result = await formatJsonExecutor({ json: '{"a":1}', operation: 'get_path' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toContain('Path is required');
    });

    it('should navigate deeply nested structures', async () => {
      const json = '{"a":{"b":{"c":{"d":"deep"}}}}';
      const result = await formatJsonExecutor({ json, operation: 'get_path', path: 'a.b.c.d' });
      const data = parse(result);
      // String results are passed through as-is (typeof result === 'string')
      expect(data.result).toBe('deep');
    });
  });

  // --- get_keys ---
  describe('get_keys', () => {
    it('should return keys of an object', async () => {
      const result = await formatJsonExecutor({
        json: '{"a":1,"b":2,"c":3}',
        operation: 'get_keys',
      });
      const data = parse(result);
      const keys = JSON.parse(data.result);
      expect(keys).toEqual(['a', 'b', 'c']);
    });

    it('should return indices for an array', async () => {
      const result = await formatJsonExecutor({ json: '[10,20,30]', operation: 'get_keys' });
      const data = parse(result);
      const keys = JSON.parse(data.result);
      expect(keys).toEqual([0, 1, 2]);
    });

    it('should return empty array for primitive', async () => {
      const result = await formatJsonExecutor({ json: '"hello"', operation: 'get_keys' });
      const data = parse(result);
      const keys = JSON.parse(data.result);
      expect(keys).toEqual([]);
    });
  });

  // --- get_values ---
  describe('get_values', () => {
    it('should return values of an object', async () => {
      const result = await formatJsonExecutor({ json: '{"a":1,"b":2}', operation: 'get_values' });
      const data = parse(result);
      const values = JSON.parse(data.result);
      expect(values).toEqual([1, 2]);
    });

    it('should return array as-is', async () => {
      const result = await formatJsonExecutor({ json: '[1,2,3]', operation: 'get_values' });
      const data = parse(result);
      const values = JSON.parse(data.result);
      expect(values).toEqual([1, 2, 3]);
    });

    it('should wrap primitive in array', async () => {
      const result = await formatJsonExecutor({ json: '42', operation: 'get_values' });
      const data = parse(result);
      const values = JSON.parse(data.result);
      expect(values).toEqual([42]);
    });
  });

  // --- flatten ---
  describe('flatten', () => {
    it('should flatten nested objects', async () => {
      const json = '{"a":{"b":1},"c":{"d":{"e":2}}}';
      const result = await formatJsonExecutor({ json, operation: 'flatten' });
      const data = parse(result);
      const flattened = JSON.parse(data.result);
      expect(flattened['a.b']).toBe(1);
      expect(flattened['c.d.e']).toBe(2);
    });

    it('should keep arrays as leaf values', async () => {
      const json = '{"a":{"b":[1,2,3]}}';
      const result = await formatJsonExecutor({ json, operation: 'flatten' });
      const data = parse(result);
      const flattened = JSON.parse(data.result);
      expect(flattened['a.b']).toEqual([1, 2, 3]);
    });

    it('should handle already flat object', async () => {
      const json = '{"x":1,"y":2}';
      const result = await formatJsonExecutor({ json, operation: 'flatten' });
      const data = parse(result);
      const flattened = JSON.parse(data.result);
      expect(flattened).toEqual({ x: 1, y: 2 });
    });
  });

  // --- sort_keys ---
  describe('sort_keys', () => {
    it('should sort object keys alphabetically', async () => {
      const json = '{"c":3,"a":1,"b":2}';
      const result = await formatJsonExecutor({ json, operation: 'sort_keys' });
      const data = parse(result);
      const sorted = JSON.parse(data.result);
      expect(Object.keys(sorted)).toEqual(['a', 'b', 'c']);
    });

    it('should recursively sort nested keys', async () => {
      const json = '{"z":{"b":2,"a":1},"m":0}';
      const result = await formatJsonExecutor({ json, operation: 'sort_keys' });
      const data = parse(result);
      const sorted = JSON.parse(data.result);
      expect(Object.keys(sorted)).toEqual(['m', 'z']);
      expect(Object.keys(sorted.z)).toEqual(['a', 'b']);
    });

    it('should handle arrays (sort keys inside array objects)', async () => {
      const json = '[{"b":2,"a":1}]';
      const result = await formatJsonExecutor({ json, operation: 'sort_keys' });
      const data = parse(result);
      const sorted = JSON.parse(data.result);
      expect(Object.keys(sorted[0])).toEqual(['a', 'b']);
    });
  });

  // --- Errors ---
  describe('errors', () => {
    it('should return error for invalid JSON', async () => {
      const result = await formatJsonExecutor({ json: 'not json', operation: 'prettify' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toBe('Invalid JSON input');
    });

    it('should return error for unknown operation', async () => {
      const result = await formatJsonExecutor({ json: '{"a":1}', operation: 'explode' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toContain('Unknown operation');
    });
  });
});

// =============================================================================
// PARSE CSV EXECUTOR
// =============================================================================

describe('parseCsvExecutor', () => {
  it('should parse basic CSV with headers', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const result = await parseCsvExecutor({ csv });
    const data = parse(result);
    expect(data.headers).toEqual(['name', 'age']);
    expect(data.data).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
    expect(data.rowCount).toBe(2);
    expect(data.columnCount).toBe(2);
  });

  it('should parse tab-delimited CSV', async () => {
    const csv = 'name\tage\nAlice\t30';
    const result = await parseCsvExecutor({ csv, delimiter: '\t' });
    const data = parse(result);
    expect(data.headers).toEqual(['name', 'age']);
    expect(data.data).toEqual([{ name: 'Alice', age: '30' }]);
  });

  it('should parse CSV without header', async () => {
    const csv = 'Alice,30\nBob,25';
    const result = await parseCsvExecutor({ csv, hasHeader: false });
    const data = parse(result);
    expect(data.data).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
    expect(data.rowCount).toBe(2);
    expect(data.columnCount).toBe(2);
  });

  it('should handle quoted fields with commas inside', async () => {
    const csv = 'name,address\nAlice,"123 Main St, Apt 4"';
    const result = await parseCsvExecutor({ csv });
    const data = parse(result);
    expect(data.data[0].address).toBe('123 Main St, Apt 4');
  });

  it('should handle escaped double quotes inside quoted fields', async () => {
    const csv = 'name,quote\nAlice,"She said ""hello"""';
    const result = await parseCsvExecutor({ csv });
    const data = parse(result);
    expect(data.data[0].quote).toBe('She said "hello"');
  });

  it('should return error for empty CSV', async () => {
    const result = await parseCsvExecutor({ csv: '' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('Empty CSV');
  });

  it('should return error for whitespace-only CSV', async () => {
    const result = await parseCsvExecutor({ csv: '   \n  \n  ' });
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toBe('Empty CSV');
  });

  it('should not trim values when trimValues=false', async () => {
    const csv = 'name,age\n  Alice  , 30 ';
    const result = await parseCsvExecutor({ csv, trimValues: false });
    const data = parse(result);
    expect(data.data[0].name).toBe('  Alice  ');
    expect(data.data[0].age).toBe(' 30 ');
  });

  it('should trim values by default', async () => {
    const csv = 'name,age\n  Alice  , 30 ';
    const result = await parseCsvExecutor({ csv });
    const data = parse(result);
    expect(data.data[0].name).toBe('Alice');
    expect(data.data[0].age).toBe('30');
  });

  it('should handle semicolon delimiter', async () => {
    const csv = 'name;age\nAlice;30';
    const result = await parseCsvExecutor({ csv, delimiter: ';' });
    const data = parse(result);
    expect(data.headers).toEqual(['name', 'age']);
    expect(data.data[0].name).toBe('Alice');
  });
});

// =============================================================================
// GENERATE CSV EXECUTOR
// =============================================================================

describe('generateCsvExecutor', () => {
  it('should generate CSV from array of objects', async () => {
    const data = JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
    const result = await generateCsvExecutor({ data });
    const parsed = parse(result);
    expect(parsed.csv).toBe('name,age\nAlice,30\nBob,25');
    expect(parsed.rowCount).toBe(3); // header + 2 data rows
  });

  it('should generate CSV from array of arrays', async () => {
    const data = JSON.stringify([
      ['Alice', 30],
      ['Bob', 25],
    ]);
    const result = await generateCsvExecutor({ data });
    const parsed = parse(result);
    expect(parsed.csv).toBe('Alice,30\nBob,25');
    expect(parsed.rowCount).toBe(2);
  });

  it('should generate CSV from array of primitives', async () => {
    const data = JSON.stringify([1, 2, 3, 4]);
    const result = await generateCsvExecutor({ data });
    const parsed = parse(result);
    expect(parsed.csv).toBe('1,2,3,4');
    expect(parsed.rowCount).toBe(1);
  });

  it('should escape values containing commas', async () => {
    const data = JSON.stringify([{ name: 'Alice, Jr.', age: 30 }]);
    const result = await generateCsvExecutor({ data });
    const parsed = parse(result);
    expect(parsed.csv).toContain('"Alice, Jr."');
  });

  it('should escape values containing double quotes', async () => {
    const data = JSON.stringify([{ note: 'She said "hi"' }]);
    const result = await generateCsvExecutor({ data });
    const parsed = parse(result);
    expect(parsed.csv).toContain('"She said ""hi"""');
  });

  it('should use custom delimiter', async () => {
    const data = JSON.stringify([{ name: 'Alice', age: 30 }]);
    const result = await generateCsvExecutor({ data, delimiter: '\t' });
    const parsed = parse(result);
    expect(parsed.csv).toBe('name\tage\nAlice\t30');
  });

  it('should return error for invalid JSON', async () => {
    const result = await generateCsvExecutor({ data: 'not json' });
    expect(result.isError).toBe(true);
    const parsed = parse(result);
    expect(parsed.error).toBe('Invalid JSON input');
  });

  it('should return error for empty array', async () => {
    const result = await generateCsvExecutor({ data: '[]' });
    expect(result.isError).toBe(true);
    const parsed = parse(result);
    expect(parsed.error).toContain('non-empty array');
  });

  it('should return error for non-array JSON', async () => {
    const result = await generateCsvExecutor({ data: '{"a":1}' });
    expect(result.isError).toBe(true);
    const parsed = parse(result);
    expect(parsed.error).toContain('non-empty array');
  });

  it('should exclude header when includeHeader=false', async () => {
    const data = JSON.stringify([{ name: 'Alice', age: 30 }]);
    const result = await generateCsvExecutor({ data, includeHeader: false });
    const parsed = parse(result);
    expect(parsed.csv).toBe('Alice,30');
    expect(parsed.rowCount).toBe(1);
  });
});

// =============================================================================
// ARRAY OPERATIONS EXECUTOR
// =============================================================================

describe('arrayOperationsExecutor', () => {
  // --- sort ---
  describe('sort', () => {
    it('should sort numbers ascending by default', async () => {
      const result = await arrayOperationsExecutor({ array: '[3,1,2]', operation: 'sort' });
      const data = parse(result);
      expect(data.result).toEqual([1, 2, 3]);
      expect(data.operation).toBe('sort');
      expect(data.inputLength).toBe(3);
    });

    it('should sort numbers descending', async () => {
      const result = await arrayOperationsExecutor({
        array: '[3,1,2]',
        operation: 'sort',
        options: { sortOrder: 'desc' },
      });
      const data = parse(result);
      expect(data.result).toEqual([3, 2, 1]);
    });

    it('should sort objects by key', async () => {
      const arr = JSON.stringify([{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }]);
      const result = await arrayOperationsExecutor({
        array: arr,
        operation: 'sort',
        options: { sortKey: 'name' },
      });
      const data = parse(result);
      expect(data.result[0].name).toBe('Alice');
      expect(data.result[1].name).toBe('Bob');
      expect(data.result[2].name).toBe('Charlie');
    });

    it('should sort strings alphabetically', async () => {
      const result = await arrayOperationsExecutor({
        array: '["banana","apple","cherry"]',
        operation: 'sort',
      });
      const data = parse(result);
      expect(data.result).toEqual(['apple', 'banana', 'cherry']);
    });
  });

  // --- reverse ---
  describe('reverse', () => {
    it('should reverse an array', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,3]', operation: 'reverse' });
      const data = parse(result);
      expect(data.result).toEqual([3, 2, 1]);
    });
  });

  // --- unique ---
  describe('unique', () => {
    it('should remove duplicate primitives', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,2,3,3,3]', operation: 'unique' });
      const data = parse(result);
      expect(data.result).toEqual([1, 2, 3]);
    });

    it('should remove duplicate objects (via JSON.stringify)', async () => {
      const arr = JSON.stringify([{ a: 1 }, { a: 1 }, { a: 2 }]);
      const result = await arrayOperationsExecutor({ array: arr, operation: 'unique' });
      const data = parse(result);
      expect(data.result).toEqual([{ a: 1 }, { a: 2 }]);
    });
  });

  // --- shuffle ---
  describe('shuffle', () => {
    it('should return an array of the same length', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'shuffle' });
      const data = parse(result);
      expect(data.result).toHaveLength(5);
      expect(data.result.sort()).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // --- chunk ---
  describe('chunk', () => {
    it('should split array into chunks', async () => {
      const result = await arrayOperationsExecutor({
        array: '[1,2,3,4,5]',
        operation: 'chunk',
        options: { chunkSize: 2 },
      });
      const data = parse(result);
      expect(data.result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should default to chunk size 2', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,3,4]', operation: 'chunk' });
      const data = parse(result);
      expect(data.result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  // --- flatten ---
  describe('flatten', () => {
    it('should flatten nested arrays', async () => {
      const result = await arrayOperationsExecutor({
        array: '[[1,2],[3,[4,5]]]',
        operation: 'flatten',
      });
      const data = parse(result);
      expect(data.result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // --- sample ---
  describe('sample', () => {
    it('should return a random subset of specified size', async () => {
      const result = await arrayOperationsExecutor({
        array: '[1,2,3,4,5,6,7,8,9,10]',
        operation: 'sample',
        options: { sampleSize: 3 },
      });
      const data = parse(result);
      expect(data.result).toHaveLength(3);
      // All sampled items should be from the original array
      for (const item of data.result) {
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).toContain(item);
      }
    });

    it('should not return more items than array length', async () => {
      const result = await arrayOperationsExecutor({
        array: '[1,2]',
        operation: 'sample',
        options: { sampleSize: 10 },
      });
      const data = parse(result);
      expect(data.result).toHaveLength(2);
    });
  });

  // --- first / last ---
  describe('first and last', () => {
    it('should return first N items', async () => {
      const result = await arrayOperationsExecutor({
        array: '[10,20,30,40,50]',
        operation: 'first',
        options: { count: 3 },
      });
      const data = parse(result);
      expect(data.result).toEqual([10, 20, 30]);
    });

    it('should return last N items', async () => {
      const result = await arrayOperationsExecutor({
        array: '[10,20,30,40,50]',
        operation: 'last',
        options: { count: 2 },
      });
      const data = parse(result);
      expect(data.result).toEqual([40, 50]);
    });

    it('should default to 1 item for first', async () => {
      const result = await arrayOperationsExecutor({ array: '[10,20,30]', operation: 'first' });
      const data = parse(result);
      expect(data.result).toEqual([10]);
    });

    it('should default to 1 item for last', async () => {
      const result = await arrayOperationsExecutor({ array: '[10,20,30]', operation: 'last' });
      const data = parse(result);
      expect(data.result).toEqual([30]);
    });
  });

  // --- Aggregations ---
  describe('aggregations', () => {
    it('should compute sum of numbers', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,3,4,5]', operation: 'sum' });
      const data = parse(result);
      expect(data.result).toBe(15);
    });

    it('should compute average of numbers', async () => {
      const result = await arrayOperationsExecutor({ array: '[10,20,30]', operation: 'avg' });
      const data = parse(result);
      expect(data.result).toBe(20);
    });

    it('should return 0 average for empty numeric array', async () => {
      const result = await arrayOperationsExecutor({ array: '["a","b"]', operation: 'avg' });
      const data = parse(result);
      expect(data.result).toBe(0);
    });

    it('should compute min of numbers', async () => {
      const result = await arrayOperationsExecutor({ array: '[5,3,8,1,9]', operation: 'min' });
      const data = parse(result);
      expect(data.result).toBe(1);
    });

    it('should compute max of numbers', async () => {
      const result = await arrayOperationsExecutor({ array: '[5,3,8,1,9]', operation: 'max' });
      const data = parse(result);
      expect(data.result).toBe(9);
    });

    it('should return null for min of non-numeric array', async () => {
      const result = await arrayOperationsExecutor({ array: '["a","b"]', operation: 'min' });
      const data = parse(result);
      expect(data.result).toBeNull();
    });

    it('should return null for max of non-numeric array', async () => {
      const result = await arrayOperationsExecutor({ array: '["a","b"]', operation: 'max' });
      const data = parse(result);
      expect(data.result).toBeNull();
    });

    it('should filter non-numbers from sum', async () => {
      const result = await arrayOperationsExecutor({
        array: '[1,"two",3,null,5]',
        operation: 'sum',
      });
      const data = parse(result);
      expect(data.result).toBe(9);
    });
  });

  // --- count ---
  describe('count', () => {
    it('should return array length', async () => {
      const result = await arrayOperationsExecutor({ array: '[1,2,3,4]', operation: 'count' });
      const data = parse(result);
      expect(data.result).toBe(4);
    });
  });

  // --- Errors ---
  describe('errors', () => {
    it('should return error for invalid JSON', async () => {
      const result = await arrayOperationsExecutor({ array: 'not-json', operation: 'sort' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toBe('Invalid JSON array');
    });

    it('should return error for non-array JSON', async () => {
      const result = await arrayOperationsExecutor({ array: '{"a":1}', operation: 'sort' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toBe('Input must be an array');
    });

    it('should return error for unknown operation', async () => {
      const result = await arrayOperationsExecutor({ array: '[1]', operation: 'explode' });
      expect(result.isError).toBe(true);
      const data = parse(result);
      expect(data.error).toContain('Unknown operation');
    });
  });
});

// =============================================================================
// GET SYSTEM INFO EXECUTOR
// =============================================================================

describe('getSystemInfoExecutor', () => {
  it('should return platform info by default', async () => {
    const result = await getSystemInfoExecutor({});
    const data = parse(result);
    expect(data.platform).toBeDefined();
    expect(data.platform.os).toBe(process.platform);
    expect(data.platform.arch).toBe(process.arch);
    expect(data.platform.nodeVersion).toBe(process.version);
    expect(data.platform.pid).toBe(process.pid);
    expect(data.timestamp).toBeDefined();
    // Should NOT include other sections by default
    expect(data.memory).toBeUndefined();
    expect(data.cpu).toBeUndefined();
    expect(data.env).toBeUndefined();
  });

  it('should return all sections when include=all', async () => {
    const result = await getSystemInfoExecutor({ include: ['all'] });
    const data = parse(result);
    expect(data.platform).toBeDefined();
    expect(data.memory).toBeDefined();
    expect(data.cpu).toBeDefined();
    expect(data.env).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  it('should return only memory section when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['memory'] });
    const data = parse(result);
    expect(data.memory).toBeDefined();
    expect(data.memory.heapUsed).toContain('MB');
    expect(data.memory.heapTotal).toContain('MB');
    expect(data.memory.rss).toContain('MB');
    expect(data.platform).toBeUndefined();
    expect(data.timestamp).toBeDefined();
  });

  it('should return env section when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['env'] });
    const data = parse(result);
    expect(data.env).toBeDefined();
    expect(data.env.nodeEnv).toBeDefined();
    expect(data.env.tz).toBeDefined();
    expect(data.env.lang).toBeDefined();
  });

  it('should return cpu section when requested', async () => {
    const result = await getSystemInfoExecutor({ include: ['cpu'] });
    const data = parse(result);
    expect(data.cpu).toBeDefined();
    expect(data.cpu.user).toContain('ms');
    expect(data.cpu.system).toContain('ms');
  });

  it('should always include timestamp', async () => {
    const result = await getSystemInfoExecutor({ include: ['memory'] });
    const data = parse(result);
    expect(data.timestamp).toBeDefined();
    // Should be a valid ISO string
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});
