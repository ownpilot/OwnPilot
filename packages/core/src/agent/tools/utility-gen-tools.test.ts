import { describe, it, expect } from 'vitest';
import {
  generateUuidExecutor,
  generatePasswordExecutor,
  generateRandomNumberExecutor,
  hashTextExecutor,
  encodeDecodeExecutor,
} from './utility-gen-tools.js';

function parse(result: { content: string }) {
  return JSON.parse(result.content as string);
}

describe('generateUuidExecutor', () => {
  it('should generate a standard UUID by default', async () => {
    const result = await generateUuidExecutor({});
    const data = parse(result);
    expect(data.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate UUID without dashes', async () => {
    const result = await generateUuidExecutor({ format: 'no-dashes' });
    const data = parse(result);
    expect(data.uuid).toMatch(/^[0-9a-f]{32}$/);
    expect(data.uuid).not.toContain('-');
  });

  it('should generate uppercase UUID', async () => {
    const result = await generateUuidExecutor({ format: 'uppercase' });
    const data = parse(result);
    expect(data.uuid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });

  it('should generate multiple UUIDs when count > 1', async () => {
    const result = await generateUuidExecutor({ count: 3 });
    const data = parse(result);
    expect(data.uuids).toHaveLength(3);
    expect(data.count).toBe(3);
  });

  it('should cap count at 10', async () => {
    const result = await generateUuidExecutor({ count: 50 });
    const data = parse(result);
    expect(data.uuids).toHaveLength(10);
  });

  it('should generate unique UUIDs', async () => {
    const result = await generateUuidExecutor({ count: 5 });
    const data = parse(result);
    const unique = new Set(data.uuids);
    expect(unique.size).toBe(5);
  });
});

describe('generatePasswordExecutor', () => {
  it('should generate a password with default settings', async () => {
    const result = await generatePasswordExecutor({});
    const data = parse(result);
    expect(data.password).toBeDefined();
    expect(data.length).toBe(16);
    expect(data.strength).toBeDefined();
    expect(data.entropyBits).toBeGreaterThan(0);
  });

  it('should clamp length to valid range (8-128)', async () => {
    const shortResult = await generatePasswordExecutor({ length: 3 });
    const shortData = parse(shortResult);
    expect(shortData.length).toBe(8);

    const longResult = await generatePasswordExecutor({ length: 500 });
    const longData = parse(longResult);
    expect(longData.length).toBe(128);
  });

  it('should exclude ambiguous characters (O, I, l, 0, 1) when requested', async () => {
    // Source excludes: I, O from uppercase; l from lowercase; 0, 1 from numbers
    // Symbols charset is fixed and always includes | so we only check letters/digits
    const result = await generatePasswordExecutor({
      length: 100,
      excludeAmbiguous: true,
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: false, // Exclude symbols to test only letters/numbers
    });
    const data = parse(result);
    expect(data.password).not.toMatch(/[OIl01]/);
  });

  it('should error when all character types are disabled', async () => {
    const result = await generatePasswordExecutor({
      includeUppercase: false,
      includeLowercase: false,
      includeNumbers: false,
      includeSymbols: false,
    });
    const data = parse(result);
    expect(data.error).toContain('At least one character type');
  });

  it('should report correct strength levels based on entropy', async () => {
    // Short password with limited charset should be weaker
    const weakResult = await generatePasswordExecutor({
      length: 8,
      includeUppercase: false,
      includeLowercase: true,
      includeNumbers: false,
      includeSymbols: false,
    });
    const weakData = parse(weakResult);
    // 26 chars, 8 length = ~37.6 bits entropy = very weak or weak
    expect(['very weak', 'weak']).toContain(weakData.strength);

    // Long password with full charset should be very strong
    const strongResult = await generatePasswordExecutor({
      length: 64,
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
    });
    const strongData = parse(strongResult);
    expect(strongData.strength).toBe('very strong');
  });

  it('should generate multiple passwords when count > 1', async () => {
    const result = await generatePasswordExecutor({ count: 3 });
    const data = parse(result);
    expect(data.passwords).toHaveLength(3);
    expect(data.count).toBe(3);
  });

  it('should generate only lowercase when others are disabled', async () => {
    const result = await generatePasswordExecutor({
      length: 50,
      includeUppercase: false,
      includeLowercase: true,
      includeNumbers: false,
      includeSymbols: false,
    });
    const data = parse(result);
    expect(data.password).toMatch(/^[a-z]+$/);
  });

  it('should calculate entropy bits as a number', async () => {
    const result = await generatePasswordExecutor({ length: 16 });
    const data = parse(result);
    expect(data.entropyBits).toBeGreaterThan(0);
    expect(typeof data.entropyBits).toBe('number');
  });
});

describe('generateRandomNumberExecutor', () => {
  it('should generate an integer in default range [0, 100)', async () => {
    const result = await generateRandomNumberExecutor({});
    const data = parse(result);
    expect(data.number).toBeGreaterThanOrEqual(0);
    expect(data.number).toBeLessThanOrEqual(100);
    expect(Number.isInteger(data.number)).toBe(true);
    expect(data.min).toBe(0);
    expect(data.max).toBe(100);
  });

  it('should generate in custom range', async () => {
    const result = await generateRandomNumberExecutor({ min: 10, max: 20 });
    const data = parse(result);
    expect(data.number).toBeGreaterThanOrEqual(10);
    expect(data.number).toBeLessThanOrEqual(20);
  });

  it('should generate decimal numbers when integer is false', async () => {
    const result = await generateRandomNumberExecutor({
      min: 0,
      max: 10,
      integer: false,
      count: 10,
    });
    const data = parse(result);
    const hasDecimal = data.numbers.some((n: number) => !Number.isInteger(n));
    // With count=10 in [0,10), very likely at least one is non-integer
    expect(hasDecimal).toBe(true);
  });

  it('should generate multiple numbers when count > 1', async () => {
    const result = await generateRandomNumberExecutor({ count: 5 });
    const data = parse(result);
    expect(data.numbers).toHaveLength(5);
    expect(data.count).toBe(5);
  });

  it('should error when min >= max', async () => {
    const result = await generateRandomNumberExecutor({ min: 10, max: 5 });
    const data = parse(result);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('min must be less than max');
  });

  it('should generate integers in range with count', async () => {
    const result = await generateRandomNumberExecutor({
      min: 1,
      max: 4,
      integer: true,
      count: 10,
    });
    const data = parse(result);
    for (const n of data.numbers) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe('hashTextExecutor', () => {
  it('should hash with sha256 by default', async () => {
    const result = await hashTextExecutor({ text: 'hello' });
    const data = parse(result);
    expect(data.algorithm).toBe('sha256');
    expect(data.hash).toBeDefined();
    expect(data.hash).toHaveLength(64); // sha256 hex = 64 chars
  });

  it('should hash with specific algorithms', async () => {
    const md5 = parse(await hashTextExecutor({ text: 'hello', algorithm: 'md5' }));
    expect(md5.algorithm).toBe('md5');
    expect(md5.hash).toHaveLength(32);

    const sha1 = parse(await hashTextExecutor({ text: 'hello', algorithm: 'sha1' }));
    expect(sha1.algorithm).toBe('sha1');
    expect(sha1.hash).toHaveLength(40);

    const sha512 = parse(await hashTextExecutor({ text: 'hello', algorithm: 'sha512' }));
    expect(sha512.algorithm).toBe('sha512');
    expect(sha512.hash).toHaveLength(128);
  });

  it('should be deterministic', async () => {
    const result1 = parse(await hashTextExecutor({ text: 'test input' }));
    const result2 = parse(await hashTextExecutor({ text: 'test input' }));
    expect(result1.hash).toBe(result2.hash);
  });

  it('should produce different hashes for different inputs', async () => {
    const result1 = parse(await hashTextExecutor({ text: 'hello' }));
    const result2 = parse(await hashTextExecutor({ text: 'world' }));
    expect(result1.hash).not.toBe(result2.hash);
  });

  it('should truncate long input in output and include hash length', async () => {
    const longText = 'a'.repeat(100);
    const data = parse(await hashTextExecutor({ text: longText }));
    // input is truncated: text.substring(0, 50) + '...'
    expect(data.input).toHaveLength(53);
    expect(data.input.endsWith('...')).toBe(true);
    // length is the hash length
    expect(data.length).toBe(data.hash.length);
  });
});

describe('encodeDecodeExecutor', () => {
  it('should base64 encode', async () => {
    const result = await encodeDecodeExecutor({ text: 'hello world', method: 'base64', operation: 'encode' });
    const data = parse(result);
    expect(data.output).toBe(Buffer.from('hello world').toString('base64'));
  });

  it('should base64 decode', async () => {
    const encoded = Buffer.from('hello world').toString('base64');
    const result = await encodeDecodeExecutor({ text: encoded, method: 'base64', operation: 'decode' });
    const data = parse(result);
    expect(data.output).toBe('hello world');
  });

  it('should URL encode', async () => {
    const result = await encodeDecodeExecutor({ text: 'hello world&foo=bar', method: 'url', operation: 'encode' });
    const data = parse(result);
    expect(data.output).toBe(encodeURIComponent('hello world&foo=bar'));
  });

  it('should URL decode', async () => {
    const encoded = encodeURIComponent('hello world&foo=bar');
    const result = await encodeDecodeExecutor({ text: encoded, method: 'url', operation: 'decode' });
    const data = parse(result);
    expect(data.output).toBe('hello world&foo=bar');
  });

  it('should HTML encode', async () => {
    const result = await encodeDecodeExecutor({ text: '<div class="test">&</div>', method: 'html', operation: 'encode' });
    const data = parse(result);
    expect(data.output).toContain('&lt;');
    expect(data.output).toContain('&gt;');
    expect(data.output).toContain('&amp;');
    expect(data.output).toContain('&quot;');
  });

  it('should HTML decode', async () => {
    const result = await encodeDecodeExecutor({
      text: '&lt;div&gt;&amp;&lt;/div&gt;',
      method: 'html',
      operation: 'decode',
    });
    const data = parse(result);
    expect(data.output).toBe('<div>&</div>');
  });

  it('should hex encode', async () => {
    const result = await encodeDecodeExecutor({ text: 'hello', method: 'hex', operation: 'encode' });
    const data = parse(result);
    expect(data.output).toBe(Buffer.from('hello').toString('hex'));
  });

  it('should hex decode', async () => {
    const encoded = Buffer.from('hello').toString('hex');
    const result = await encodeDecodeExecutor({ text: encoded, method: 'hex', operation: 'decode' });
    const data = parse(result);
    expect(data.output).toBe('hello');
  });

  it('should include metadata in response', async () => {
    const result = await encodeDecodeExecutor({ text: 'test', method: 'base64', operation: 'encode' });
    const data = parse(result);
    expect(data.method).toBe('base64');
    expect(data.operation).toBe('encode');
    expect(data.input).toBeDefined();
  });

  it('should roundtrip correctly for all methods', async () => {
    const original = 'Hello, World! <test>&"special"';

    for (const method of ['base64', 'url', 'html', 'hex'] as const) {
      const encoded = parse(
        await encodeDecodeExecutor({ text: original, method, operation: 'encode' }),
      );
      const decoded = parse(
        await encodeDecodeExecutor({ text: encoded.output, method, operation: 'decode' }),
      );
      expect(decoded.output).toBe(original);
    }
  });
});
