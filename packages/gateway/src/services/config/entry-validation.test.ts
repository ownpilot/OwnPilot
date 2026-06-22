import { describe, it, expect } from 'vitest';
import {
  hasConfiguredData,
  validateRequiredFields,
  normalizeAndValidateEntryData,
} from './entry-validation.js';

describe('hasConfiguredData', () => {
  it('returns false for empty object', () => {
    expect(hasConfiguredData({})).toBe(false);
  });

  it('returns false when all values are null', () => {
    expect(hasConfiguredData({ a: null, b: null })).toBe(false);
  });

  it('returns false when all values are undefined', () => {
    expect(hasConfiguredData({ a: undefined, b: undefined })).toBe(false);
  });

  it('returns false when all values are empty strings', () => {
    expect(hasConfiguredData({ a: '', b: '' })).toBe(false);
  });

  it('returns true when any value is non-empty string', () => {
    expect(hasConfiguredData({ a: '', b: 'hello' })).toBe(true);
  });

  it('returns true when any value is zero', () => {
    expect(hasConfiguredData({ a: 0, b: '' })).toBe(true);
  });

  it('returns true when any value is false boolean', () => {
    expect(hasConfiguredData({ a: false, b: '' })).toBe(true);
  });

  it('returns true when any value is an empty array', () => {
    // empty array is truthy in JS, so hasConfiguredData treats it as configured
    expect(hasConfiguredData({ a: [], b: '' })).toBe(true);
  });
});

describe('validateRequiredFields', () => {
  const makeSchema = (fields: Array<{ name: string; required?: boolean; label?: string }>) =>
    fields.map((f) => ({ name: f.name, required: f.required ?? false, label: f.label }));

  it('returns empty array when no required fields', () => {
    const schema = makeSchema([{ name: 'name' }]);
    expect(validateRequiredFields({ name: 'value' }, schema)).toEqual([]);
  });

  it('returns empty array when required field has value', () => {
    const schema = makeSchema([{ name: 'name', required: true }]);
    expect(validateRequiredFields({ name: 'Alice' }, schema)).toEqual([]);
  });

  it('returns empty array when required field has non-empty value', () => {
    const schema = makeSchema([{ name: 'count', required: true }]);
    expect(validateRequiredFields({ count: 42 }, schema)).toEqual([]);
  });

  it('returns field label when required field is missing', () => {
    const schema = makeSchema([{ name: 'email', required: true, label: 'Email Address' }]);
    expect(validateRequiredFields({}, schema)).toEqual(['Email Address']);
  });

  it('returns field name when required field is missing and no label', () => {
    const schema = makeSchema([{ name: 'apiKey', required: true }]);
    expect(validateRequiredFields({}, schema)).toEqual(['apiKey']);
  });

  it('returns multiple missing required fields', () => {
    const schema = makeSchema([
      { name: 'a', required: true },
      { name: 'b', required: true },
    ]);
    expect(validateRequiredFields({}, schema)).toEqual(['a', 'b']);
  });

  it('skips non-required fields even when missing', () => {
    const schema = makeSchema([{ name: 'optional' }]);
    expect(validateRequiredFields({}, schema)).toEqual([]);
  });

  it('treats null as missing', () => {
    const schema = makeSchema([{ name: 'required', required: true }]);
    expect(validateRequiredFields({ required: null }, schema)).toEqual(['required']);
  });

  it('treats empty string as missing', () => {
    const schema = makeSchema([{ name: 'required', required: true }]);
    expect(validateRequiredFields({ required: '' }, schema)).toEqual(['required']);
  });
});

describe('normalizeAndValidateEntryData', () => {
  const makeSchema = (
    fields: Array<{
      name: string;
      type: string;
      options?: Array<{ value: string }>;
    }>
  ) => fields.map((f) => ({ name: f.name, type: f.type as never, options: f.options }));

  describe('string / text / secret fields', () => {
    it('accepts a string value', () => {
      const schema = makeSchema([{ name: 'name', type: 'string' }]);
      const result = normalizeAndValidateEntryData({ name: 'Alice' }, schema);
      expect(result.errors).toEqual([]);
      expect(result.data.name).toBe('Alice');
    });

    it('accepts a text value', () => {
      const schema = makeSchema([{ name: 'bio', type: 'text' }]);
      const result = normalizeAndValidateEntryData({ bio: 'Hello' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('accepts a secret value', () => {
      const schema = makeSchema([{ name: 'token', type: 'secret' }]);
      const result = normalizeAndValidateEntryData({ token: 'sk-xxx' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('rejects non-string for string type', () => {
      const schema = makeSchema([{ name: 'name', type: 'string' }]);
      const result = normalizeAndValidateEntryData({ name: 42 }, schema);
      expect(result.errors).toEqual(['name must be a string']);
    });

    it('skips empty string for string type', () => {
      const schema = makeSchema([{ name: 'name', type: 'string' }]);
      const result = normalizeAndValidateEntryData({ name: '' }, schema);
      expect(result.errors).toEqual([]);
    });
  });

  describe('URL fields', () => {
    it('accepts a valid URL', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData({ endpoint: 'https://example.com' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('accepts a URL with path', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData(
        { endpoint: 'https://example.com/api/v1' },
        schema
      );
      expect(result.errors).toEqual([]);
    });

    it('rejects non-string for url type', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData({ endpoint: 42 }, schema);
      expect(result.errors).toEqual(['endpoint must be a URL string']);
    });

    it('rejects invalid URL', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData({ endpoint: 'not-a-url' }, schema);
      expect(result.errors).toEqual(['endpoint must be a valid URL']);
    });

    it('rejects URL with no protocol', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData({ endpoint: 'example.com' }, schema);
      expect(result.errors).toEqual(['endpoint must be a valid URL']);
    });

    it('skips empty string for url type', () => {
      const schema = makeSchema([{ name: 'endpoint', type: 'url' }]);
      const result = normalizeAndValidateEntryData({ endpoint: '' }, schema);
      expect(result.errors).toEqual([]);
    });
  });

  describe('number fields', () => {
    it('accepts a number value', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: 8080 }, schema);
      expect(result.errors).toEqual([]);
      expect(result.data.port).toBe(8080);
    });

    it('accepts a numeric string and converts to number', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: '8080' }, schema);
      expect(result.errors).toEqual([]);
      expect(result.data.port).toBe(8080);
    });

    it('rejects non-numeric string', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: 'abc' }, schema);
      expect(result.errors).toEqual(['port must be a number']);
    });

    it('rejects Infinity', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: Infinity }, schema);
      expect(result.errors).toEqual(['port must be a number']);
    });

    it('rejects NaN', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: NaN }, schema);
      expect(result.errors).toEqual(['port must be a number']);
    });

    it('skips empty string for number type', () => {
      const schema = makeSchema([{ name: 'port', type: 'number' }]);
      const result = normalizeAndValidateEntryData({ port: '' }, schema);
      expect(result.errors).toEqual([]);
    });
  });

  describe('boolean fields', () => {
    it('accepts true', () => {
      const schema = makeSchema([{ name: 'enabled', type: 'boolean' }]);
      const result = normalizeAndValidateEntryData({ enabled: true }, schema);
      expect(result.errors).toEqual([]);
    });

    it('accepts false', () => {
      const schema = makeSchema([{ name: 'enabled', type: 'boolean' }]);
      const result = normalizeAndValidateEntryData({ enabled: false }, schema);
      expect(result.errors).toEqual([]);
    });

    it('rejects string "true"', () => {
      const schema = makeSchema([{ name: 'enabled', type: 'boolean' }]);
      const result = normalizeAndValidateEntryData({ enabled: 'true' }, schema);
      expect(result.errors).toEqual(['enabled must be true or false']);
    });

    it('skips empty string for boolean type', () => {
      const schema = makeSchema([{ name: 'enabled', type: 'boolean' }]);
      const result = normalizeAndValidateEntryData({ enabled: '' }, schema);
      expect(result.errors).toEqual([]);
    });
  });

  describe('select fields', () => {
    it('accepts a value in options', () => {
      const schema = makeSchema([
        {
          name: 'region',
          type: 'select',
          options: [{ value: 'us' }, { value: 'eu' }],
        },
      ]);
      const result = normalizeAndValidateEntryData({ region: 'us' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('rejects a value not in options', () => {
      const schema = makeSchema([
        {
          name: 'region',
          type: 'select',
          options: [{ value: 'us' }, { value: 'eu' }],
        },
      ]);
      const result = normalizeAndValidateEntryData({ region: 'asia' }, schema);
      expect(result.errors).toEqual(['region must be one of: us, eu']);
    });

    it('accepts when options array is empty', () => {
      const schema = makeSchema([{ name: 'mode', type: 'select', options: [] }]);
      const result = normalizeAndValidateEntryData({ mode: 'anything' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('accepts when options is undefined', () => {
      const schema = makeSchema([{ name: 'mode', type: 'select' }]);
      const result = normalizeAndValidateEntryData({ mode: 'value' }, schema);
      expect(result.errors).toEqual([]);
    });

    it('rejects non-string for select type', () => {
      const schema = makeSchema([
        {
          name: 'region',
          type: 'select',
          options: [{ value: 'us' }],
        },
      ]);
      const result = normalizeAndValidateEntryData({ region: 42 }, schema);
      expect(result.errors).toEqual(['region must be one of the configured options']);
    });
  });

  describe('JSON fields', () => {
    it('accepts a string and parses it', () => {
      const schema = makeSchema([{ name: 'config', type: 'json' }]);
      const result = normalizeAndValidateEntryData({ config: '{"key":"value"}' }, schema);
      expect(result.errors).toEqual([]);
      expect(result.data.config).toEqual({ key: 'value' });
    });

    it('keeps non-string values as-is', () => {
      const schema = makeSchema([{ name: 'config', type: 'json' }]);
      const result = normalizeAndValidateEntryData({ config: { key: 'value' } }, schema);
      expect(result.errors).toEqual([]);
      expect(result.data.config).toEqual({ key: 'value' });
    });

    it('rejects invalid JSON string', () => {
      const schema = makeSchema([{ name: 'config', type: 'json' }]);
      const result = normalizeAndValidateEntryData({ config: '{invalid}' }, schema);
      expect(result.errors).toEqual(['config must be valid JSON']);
    });

    it('skips empty string for json type', () => {
      const schema = makeSchema([{ name: 'config', type: 'json' }]);
      const result = normalizeAndValidateEntryData({ config: '' }, schema);
      expect(result.errors).toEqual([]);
    });
  });

  describe('field label in errors', () => {
    it('uses label instead of name in error message', () => {
      const schema = makeSchema([{ name: 'apiKey', type: 'string' }]);
      const result = normalizeAndValidateEntryData({ apiKey: 42 }, schema);
      expect(result.errors).toEqual(['apiKey must be a string']);
    });
  });

  describe('multiple fields', () => {
    it('collects errors from multiple fields', () => {
      const schema = makeSchema([
        { name: 'name', type: 'string' },
        { name: 'port', type: 'number' },
        { name: 'enabled', type: 'boolean' },
      ]);
      const result = normalizeAndValidateEntryData(
        {
          name: 42,
          port: 'abc',
          enabled: 'yes',
        },
        schema
      );
      expect(result.errors).toEqual([
        'name must be a string',
        'port must be a number',
        'enabled must be true or false',
      ]);
    });

    it('normalizes number fields while collecting errors', () => {
      const schema = makeSchema([
        { name: 'port', type: 'number' },
        { name: 'timeout', type: 'number' },
      ]);
      const result = normalizeAndValidateEntryData(
        {
          port: '8080',
          timeout: '30',
        },
        schema
      );
      expect(result.errors).toEqual([]);
      expect(result.data.port).toBe(8080);
      expect(result.data.timeout).toBe(30);
    });
  });
});
