/**
 * Tests for template-resolver.ts — template expression resolution in workflow node arguments.
 *
 * Covers:
 * - resolveTemplates: top-level entry point
 * - deepResolve: recursive resolution of arrays, objects, primitives
 * - resolveStringTemplates: full-match vs inline interpolation
 * - resolveTemplatePath: node output, variable, shorthand access
 * - getNestedValue: deep property access with JSON auto-parsing
 */

import { describe, it, expect } from 'vitest';
import type { NodeResult } from '../../db/repositories/workflows.js';

import {
  resolveTemplates,
  deepResolve,
  resolveStringTemplates,
  resolveTemplatePath,
  getNestedValue,
} from './template-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  nodeId: string,
  output: unknown,
  status: 'success' | 'error' = 'success'
): NodeResult {
  return { nodeId, status, output };
}

// ============================================================================
// getNestedValue
// ============================================================================

describe('getNestedValue', () => {
  it('returns the value at a simple path', () => {
    expect(getNestedValue({ a: 1 }, ['a'])).toBe(1);
  });

  it('returns deeply nested value', () => {
    expect(getNestedValue({ a: { b: { c: 42 } } }, ['a', 'b', 'c'])).toBe(42);
  });

  it('returns undefined for missing key', () => {
    expect(getNestedValue({ a: 1 }, ['b'])).toBeUndefined();
  });

  it('returns undefined when traversing null', () => {
    expect(getNestedValue(null, ['a'])).toBeUndefined();
  });

  it('returns undefined when traversing undefined', () => {
    expect(getNestedValue(undefined, ['a'])).toBeUndefined();
  });

  it('returns undefined when traversing a non-JSON string', () => {
    expect(getNestedValue('plain text', ['a'])).toBeUndefined();
  });

  it('returns undefined when traversing a primitive number', () => {
    expect(getNestedValue(42, ['a'])).toBeUndefined();
  });

  it('auto-parses JSON object string and traverses into it', () => {
    expect(getNestedValue('{"name":"John"}', ['name'])).toBe('John');
  });

  it('auto-parses JSON array string and accesses by index', () => {
    expect(getNestedValue('[10, 20, 30]', ['1'])).toBe(20);
  });

  it('returns undefined for invalid JSON string', () => {
    expect(getNestedValue('{invalid json', ['key'])).toBeUndefined();
  });

  it('auto-parses the final value if it is a JSON object string', () => {
    const obj = { data: '{"inner": "value"}' };
    expect(getNestedValue(obj, ['data'])).toEqual({ inner: 'value' });
  });

  it('auto-parses the final value if it is a JSON array string', () => {
    const obj = { data: '[1, 2, 3]' };
    expect(getNestedValue(obj, ['data'])).toEqual([1, 2, 3]);
  });

  it('returns non-JSON string as-is when it is the final value', () => {
    const obj = { data: 'hello world' };
    expect(getNestedValue(obj, ['data'])).toBe('hello world');
  });

  it('returns original string if final JSON parse fails', () => {
    const obj = { data: '{broken json' };
    expect(getNestedValue(obj, ['data'])).toBe('{broken json');
  });

  it('returns the object itself for empty path', () => {
    const obj = { a: 1 };
    expect(getNestedValue(obj, [])).toEqual({ a: 1 });
  });

  it('handles intermediate JSON parse failure (returns undefined)', () => {
    // A string that looks like JSON but is invalid at an intermediate step
    expect(getNestedValue('{not valid', ['key'])).toBeUndefined();
  });

  it('handles boolean final value', () => {
    expect(getNestedValue({ flag: true }, ['flag'])).toBe(true);
  });

  it('handles null final value', () => {
    expect(getNestedValue({ val: null }, ['val'])).toBeNull();
  });

  it('auto-parses JSON string with whitespace', () => {
    expect(getNestedValue('  {"key": "val"}  ', ['key'])).toBe('val');
  });

  it('auto-parses JSON array string with whitespace', () => {
    expect(getNestedValue('  [1, 2]  ', ['0'])).toBe(1);
  });
});

// ============================================================================
// resolveTemplatePath
// ============================================================================

describe('resolveTemplatePath', () => {
  it('resolves {{variables.key}}', () => {
    expect(resolveTemplatePath('variables.env', {}, { env: 'prod' })).toBe('prod');
  });

  it('resolves {{variables.nested.key}}', () => {
    expect(
      resolveTemplatePath('variables.config.region', {}, { config: { region: 'us-east-1' } })
    ).toBe('us-east-1');
  });

  it('returns undefined for missing variable', () => {
    expect(resolveTemplatePath('variables.missing', {}, {})).toBeUndefined();
  });

  it('resolves {{nodeId}} to node output (single part)', () => {
    const outputs = { n1: makeResult('n1', 'hello') };
    expect(resolveTemplatePath('n1', outputs, {})).toBe('hello');
  });

  it('resolves {{nodeId.output}} to node output', () => {
    const outputs = { n1: makeResult('n1', 'world') };
    expect(resolveTemplatePath('n1.output', outputs, {})).toBe('world');
  });

  it('resolves {{nodeId.output.field}} for nested access', () => {
    const outputs = { n1: makeResult('n1', { name: 'Alice' }) };
    expect(resolveTemplatePath('n1.output.name', outputs, {})).toBe('Alice');
  });

  it('resolves {{nodeId.field}} as shorthand for {{nodeId.output.field}}', () => {
    const outputs = { n1: makeResult('n1', { name: 'Bob' }) };
    expect(resolveTemplatePath('n1.name', outputs, {})).toBe('Bob');
  });

  it('returns undefined for missing node', () => {
    expect(resolveTemplatePath('missing.output', {}, {})).toBeUndefined();
  });

  it('returns undefined for missing nested field', () => {
    const outputs = { n1: makeResult('n1', { name: 'Alice' }) };
    expect(resolveTemplatePath('n1.output.email', outputs, {})).toBeUndefined();
  });
});

// ============================================================================
// resolveStringTemplates
// ============================================================================

describe('resolveStringTemplates', () => {
  it('returns raw value for full single-template match (preserves types)', () => {
    const outputs = { n1: makeResult('n1', 42) };
    const result = resolveStringTemplates('{{n1.output}}', outputs, {});
    expect(result).toBe(42);
  });

  it('returns string for inline interpolation', () => {
    const outputs = { n1: makeResult('n1', 'world') };
    const result = resolveStringTemplates('Hello {{n1.output}}!', outputs, {});
    expect(result).toBe('Hello world!');
  });

  it('replaces undefined references with empty string in inline mode', () => {
    const result = resolveStringTemplates('Result: {{missing.output}} done', {}, {});
    expect(result).toBe('Result:  done');
  });

  it('stringifies objects in inline interpolation', () => {
    const outputs = { n1: makeResult('n1', { key: 'val' }) };
    const result = resolveStringTemplates('Data: {{n1.output}}', outputs, {});
    expect(result).toBe('Data: {"key":"val"}');
  });

  it('handles multiple templates in one string', () => {
    const outputs = {
      a: makeResult('a', 'Hello'),
      b: makeResult('b', 'World'),
    };
    const result = resolveStringTemplates('{{a.output}} {{b.output}}!', outputs, {});
    expect(result).toBe('Hello World!');
  });

  it('returns string as-is if no templates found', () => {
    expect(resolveStringTemplates('no templates', {}, {})).toBe('no templates');
  });

  it('handles whitespace in template expression', () => {
    const outputs = { n1: makeResult('n1', 'trimmed') };
    const result = resolveStringTemplates('{{ n1.output }}', outputs, {});
    expect(result).toBe('trimmed');
  });

  it('resolves variable fallback in full-match mode', () => {
    const result = resolveStringTemplates('{{myVar}}', {}, { myVar: 'hello' });
    expect(result).toBe('hello');
  });

  it('preserves array type in full-match mode', () => {
    const outputs = { n1: makeResult('n1', [1, 2, 3]) };
    const result = resolveStringTemplates('{{n1.output}}', outputs, {});
    expect(result).toEqual([1, 2, 3]);
  });

  it('preserves boolean type in full-match mode', () => {
    const outputs = { n1: makeResult('n1', true) };
    const result = resolveStringTemplates('{{n1.output}}', outputs, {});
    expect(result).toBe(true);
  });

  it('returns undefined for full-match referencing missing node', () => {
    const result = resolveStringTemplates('{{missing.output}}', {}, {});
    expect(result).toBeUndefined();
  });

  it('stringifies numbers in inline interpolation', () => {
    const outputs = { n1: makeResult('n1', 42) };
    const result = resolveStringTemplates('Count: {{n1.output}} items', outputs, {});
    expect(result).toBe('Count: 42 items');
  });
});

// ============================================================================
// deepResolve
// ============================================================================

describe('deepResolve', () => {
  it('resolves strings', () => {
    const outputs = { n1: makeResult('n1', 'hello') };
    expect(deepResolve('{{n1.output}}', outputs, {})).toBe('hello');
  });

  it('resolves arrays recursively', () => {
    const outputs = { n1: makeResult('n1', 'a'), n2: makeResult('n2', 'b') };
    expect(deepResolve(['{{n1.output}}', '{{n2.output}}', 'static'], outputs, {})).toEqual([
      'a',
      'b',
      'static',
    ]);
  });

  it('resolves objects recursively', () => {
    const outputs = { n1: makeResult('n1', 'val') };
    expect(deepResolve({ key: '{{n1.output}}' }, outputs, {})).toEqual({ key: 'val' });
  });

  it('resolves nested objects recursively', () => {
    const outputs = { n1: makeResult('n1', 42) };
    expect(deepResolve({ a: { b: '{{n1.output}}' } }, outputs, {})).toEqual({ a: { b: 42 } });
  });

  it('passes through numbers unchanged', () => {
    expect(deepResolve(42, {}, {})).toBe(42);
  });

  it('passes through booleans unchanged', () => {
    expect(deepResolve(true, {}, {})).toBe(true);
  });

  it('passes through null unchanged', () => {
    expect(deepResolve(null, {}, {})).toBeNull();
  });

  it('passes through undefined unchanged', () => {
    expect(deepResolve(undefined, {}, {})).toBeUndefined();
  });

  it('handles mixed arrays with objects and strings', () => {
    const outputs = { n1: makeResult('n1', 'resolved') };
    const input = [{ key: '{{n1.output}}' }, 'plain', 42];
    expect(deepResolve(input, outputs, {})).toEqual([{ key: 'resolved' }, 'plain', 42]);
  });
});

// ============================================================================
// resolveTemplates (top-level entry point)
// ============================================================================

describe('resolveTemplates', () => {
  it('resolves all string values in args object', () => {
    const outputs = { n1: makeResult('n1', 'hello') };
    const result = resolveTemplates({ msg: '{{n1.output}}', other: 'plain' }, outputs, {});
    expect(result).toEqual({ msg: 'hello', other: 'plain' });
  });

  it('handles empty args', () => {
    expect(resolveTemplates({}, {}, {})).toEqual({});
  });

  it('resolves variable and node output references together', () => {
    const outputs = { n1: makeResult('n1', 'nodeVal') };
    const vars = { myVar: 'varVal' };
    const result = resolveTemplates(
      { fromNode: '{{n1.output}}', fromVar: '{{variables.myVar}}' },
      outputs,
      vars
    );
    expect(result).toEqual({ fromNode: 'nodeVal', fromVar: 'varVal' });
  });

  it('preserves non-string values', () => {
    const result = resolveTemplates({ num: 42 as unknown, flag: true as unknown }, {}, {});
    expect(result).toEqual({ num: 42, flag: true });
  });

  it('resolves nested object values', () => {
    const outputs = { n1: makeResult('n1', 'deep') };
    const result = resolveTemplates({ outer: { inner: '{{n1.output}}' } }, outputs, {});
    expect(result).toEqual({ outer: { inner: 'deep' } });
  });

  it('resolves array values', () => {
    const outputs = { n1: makeResult('n1', 'alpha'), n2: makeResult('n2', 'beta') };
    const result = resolveTemplates(
      { items: ['{{n1.output}}', '{{n2.output}}', 'static'] as unknown },
      outputs,
      {}
    );
    expect(result).toEqual({ items: ['alpha', 'beta', 'static'] });
  });

  it('handles ForEach item variable alias fallback', () => {
    const result = resolveTemplates({ val: '{{item}}' }, {}, { item: 'task-42' });
    expect(result.val).toBe('task-42');
  });

  it('node output takes priority over variable fallback', () => {
    const outputs = { env: makeResult('env', 'from-node') };
    const result = resolveTemplates({ val: '{{env}}' }, outputs, { env: 'from-var' });
    expect(result.val).toBe('from-node');
  });

  it('handles auto-parsed JSON string for nested field access', () => {
    const outputs = { n1: makeResult('n1', '{"name":"John","age":30}') };
    const result = resolveTemplates({ val: '{{n1.output.name}}' }, outputs, {});
    expect(result.val).toBe('John');
  });

  it('handles nested variable with direct fallback path', () => {
    const result = resolveTemplates(
      { r: '{{config.region}}' },
      {},
      { config: { region: 'eu-west-1' } }
    );
    expect(result.r).toBe('eu-west-1');
  });
});
