import { describe, it, expect } from 'vitest';
import {
  validateAgainstSchema,
  validateToolCall,
  findSimilarToolNames,
  formatParamSchema,
  buildExampleValue,
  buildToolHelpText,
  formatFullToolHelp,
  validateRequiredParams,
} from './tool-validation.js';

// =============================================================================
// Mock Registry Helper
// =============================================================================

function createMockRegistry(
  tools: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>,
) {
  const defs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? { type: 'object', properties: {} },
    category: 'Test',
    tags: [],
  }));

  return {
    getDefinition: (name: string) => defs.find(d => d.name === name),
    getDefinitions: () => defs,
    getAllTools: () => defs.map(d => ({ definition: d, executor: async () => ({}) })),
  } as unknown as Parameters<typeof validateToolCall>[0];
}

// =============================================================================
// Reusable tool definitions for tests
// =============================================================================

const sendEmailTool = {
  name: 'send_email',
  description: 'Send an email to a recipient',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject' },
      body: { type: 'string', description: 'Email body' },
      cc: { type: 'string', description: 'CC recipients' },
    },
    required: ['to', 'subject', 'body'],
  },
};

const listTasksTool = {
  name: 'list_tasks',
  description: 'List all tasks with optional filters',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['pending', 'in_progress', 'completed'],
      },
      limit: { type: 'integer', description: 'Max number of results', default: 20 },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
    },
  },
};

const createNoteTool = {
  name: 'create_note',
  description: 'Create a new note',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title' },
      content: { type: 'string', description: 'Note content' },
      metadata: {
        type: 'object',
        description: 'Additional metadata',
        properties: {
          category: { type: 'string', description: 'Note category' },
          priority: { type: 'integer', description: 'Priority level' },
        },
        required: ['category'],
      },
    },
    required: ['title', 'content'],
  },
};

const noParamsTool = {
  name: 'get_status',
  description: 'Get current system status',
  parameters: { type: 'object', properties: {} },
};

// =============================================================================
// validateAgainstSchema
// =============================================================================

describe('validateAgainstSchema', () => {
  it('returns empty array for null value', () => {
    const errors = validateAgainstSchema(null, { type: 'string' });
    expect(errors).toEqual([]);
  });

  it('returns empty array for undefined value', () => {
    const errors = validateAgainstSchema(undefined, { type: 'string' });
    expect(errors).toEqual([]);
  });

  it('returns empty array when string matches string type', () => {
    const errors = validateAgainstSchema('hello', { type: 'string' });
    expect(errors).toEqual([]);
  });

  it('returns empty array when number matches number type', () => {
    const errors = validateAgainstSchema(3.14, { type: 'number' });
    expect(errors).toEqual([]);
  });

  it('returns empty array when boolean matches boolean type', () => {
    const errors = validateAgainstSchema(true, { type: 'boolean' });
    expect(errors).toEqual([]);
  });

  it('returns empty array when object matches object type', () => {
    const errors = validateAgainstSchema({ a: 1 }, { type: 'object' });
    expect(errors).toEqual([]);
  });

  it('returns empty array when array matches array type', () => {
    const errors = validateAgainstSchema([1, 2], { type: 'array' });
    expect(errors).toEqual([]);
  });

  it('returns error when string provided where number expected', () => {
    const errors = validateAgainstSchema('hello', { type: 'number' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expected).toBe('number');
    expect(errors[0]!.received).toBe('string');
  });

  it('returns error when number provided where string expected', () => {
    const errors = validateAgainstSchema(42, { type: 'string' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expected).toBe('string');
    expect(errors[0]!.received).toBe('integer');
  });

  it('returns error when array provided where object expected', () => {
    const errors = validateAgainstSchema([1, 2], { type: 'object' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expected).toBe('object');
    expect(errors[0]!.received).toBe('array');
  });

  it('returns error when boolean provided where string expected', () => {
    const errors = validateAgainstSchema(false, { type: 'string' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expected).toBe('string');
    expect(errors[0]!.received).toBe('boolean');
  });

  it('integer matches number type (5 is valid for type number)', () => {
    const errors = validateAgainstSchema(5, { type: 'number' });
    expect(errors).toEqual([]);
  });

  it('non-integer number does NOT match integer type (5.5 fails for type integer)', () => {
    const errors = validateAgainstSchema(5.5, { type: 'integer' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.expected).toBe('integer');
    expect(errors[0]!.received).toBe('number');
  });

  it('integer value matches integer type', () => {
    const errors = validateAgainstSchema(5, { type: 'integer' });
    expect(errors).toEqual([]);
  });

  // Enum validation
  it('enum validation passes for valid value', () => {
    const schema = { type: 'string', enum: ['red', 'green', 'blue'] };
    const errors = validateAgainstSchema('green', schema);
    expect(errors).toEqual([]);
  });

  it('enum validation fails with descriptive error for invalid value', () => {
    const schema = { type: 'string', enum: ['red', 'green', 'blue'] };
    const errors = validateAgainstSchema('yellow', schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('"red"');
    expect(errors[0]!.message).toContain('"green"');
    expect(errors[0]!.message).toContain('"blue"');
    expect(errors[0]!.received).toBe('"yellow"');
  });

  it('enum validation works with non-string values', () => {
    const schema = { type: 'number', enum: [1, 2, 3] };
    expect(validateAgainstSchema(2, schema)).toEqual([]);
    const errors = validateAgainstSchema(4, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('must be one of');
  });

  // Object validation
  it('object required property missing produces error', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };
    const errors = validateAgainstSchema({ name: 'Alice' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe('params.age');
    expect(errors[0]!.message).toContain('required but missing');
  });

  it('object property type mismatch produces error on nested path', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };
    const errors = validateAgainstSchema({ name: 'Alice', age: 'twenty' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe('params.age');
    expect(errors[0]!.expected).toBe('number');
    expect(errors[0]!.received).toBe('string');
  });

  it('multiple required properties missing produces multiple errors', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
      required: ['a', 'b', 'c'],
    };
    const errors = validateAgainstSchema({}, schema);
    expect(errors).toHaveLength(3);
  });

  it('null property value triggers required check', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    };
    const errors = validateAgainstSchema({ name: null }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('required but missing');
  });

  // Array validation
  it('array items validation validates each item', () => {
    const schema = {
      type: 'array',
      items: { type: 'string' },
    };
    const errors = validateAgainstSchema(['hello', 42, 'world'], schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe('params[1]');
    expect(errors[0]!.expected).toBe('string');
  });

  it('array of objects validates nested schemas', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          label: { type: 'string' },
        },
        required: ['id'],
      },
    };
    const value = [
      { id: 1, label: 'first' },
      { label: 'missing id' },
      { id: 'not-a-number', label: 'bad id' },
    ];
    const errors = validateAgainstSchema(value, schema);
    // Item 1: missing required id; Item 2: id is wrong type
    expect(errors).toHaveLength(2);
    expect(errors[0]!.path).toBe('params[1].id');
    expect(errors[1]!.path).toBe('params[2].id');
  });

  // Nested object
  it('nested object validation recurses into child objects', () => {
    const schema = {
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            fontSize: { type: 'integer' },
          },
          required: ['theme'],
        },
      },
    };
    const errors = validateAgainstSchema({ settings: { fontSize: 'big' } }, schema);
    // Missing required 'theme' + fontSize type mismatch
    expect(errors).toHaveLength(2);
    const paths = errors.map(e => e.path);
    expect(paths).toContain('params.settings.theme');
    expect(paths).toContain('params.settings.fontSize');
  });

  // Combined complex case
  it('combined: object with required string, optional number, array of objects', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'number' },
            },
            required: ['key'],
          },
        },
      },
      required: ['name'],
    };

    // Valid
    expect(validateAgainstSchema({ name: 'test', items: [{ key: 'a', value: 1 }] }, schema)).toEqual([]);

    // Invalid: missing name, bad item
    const errors = validateAgainstSchema({ items: [{ value: 'not-a-number' }] }, schema);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const paths = errors.map(e => e.path);
    expect(paths).toContain('params.name');
    expect(paths).toContain('params.items[0].key');
  });

  it('uses custom path prefix when provided', () => {
    const errors = validateAgainstSchema('hello', { type: 'number' }, 'root.field');
    expect(errors[0]!.path).toBe('root.field');
    expect(errors[0]!.message).toContain('root.field');
  });

  it('returns empty array when schema has no type constraint', () => {
    const errors = validateAgainstSchema('anything', {});
    expect(errors).toEqual([]);
  });

  it('stops further checks when type is wrong (no enum check after type mismatch)', () => {
    const schema = { type: 'string', enum: ['a', 'b'] };
    const errors = validateAgainstSchema(42, schema);
    // Should only have type error, not enum error
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('expected string');
  });
});

// =============================================================================
// validateToolCall
// =============================================================================

describe('validateToolCall', () => {
  const registry = createMockRegistry([sendEmailTool, listTasksTool, createNoteTool, noParamsTool]);

  it('valid tool with valid args returns valid: true, no errors', () => {
    const result = validateToolCall(registry, 'send_email', {
      to: 'alice@example.com',
      subject: 'Hello',
      body: 'Hi there',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.correctedName).toBeUndefined();
    expect(result.helpText).toBeUndefined();
  });

  it('valid tool with invalid args returns valid: false, errors, and helpText', () => {
    const result = validateToolCall(registry, 'send_email', {
      to: 123, // wrong type
      subject: 'Hello',
      body: 'Hi there',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.helpText).toBeDefined();
    expect(result.helpText).toContain('TOOL HELP');
  });

  it('valid tool with missing required params returns validation errors', () => {
    const result = validateToolCall(registry, 'send_email', {
      to: 'alice@example.com',
      // missing subject and body
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
    const messages = result.errors.map(e => e.message);
    expect(messages.some(m => m.includes('subject'))).toBe(true);
    expect(messages.some(m => m.includes('body'))).toBe(true);
  });

  it('unknown tool returns valid: false with "not found" error', () => {
    const result = validateToolCall(registry, 'nonexistent_tool', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('not found');
    expect(result.errors[0]!.path).toBe('tool_name');
  });

  it('unknown tool with similar name auto-corrects (correctedName set)', () => {
    // 'send_emal' is close to 'send_email' (1 char diff)
    const result = validateToolCall(registry, 'send_emal', {
      to: 'alice@example.com',
      subject: 'Hello',
      body: 'Hi there',
    });
    expect(result.correctedName).toBe('send_email');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('auto-corrected tool with valid params returns valid: true with correctedName', () => {
    const result = validateToolCall(registry, 'list_task', {
      status: 'pending',
    });
    expect(result.correctedName).toBe('list_tasks');
    expect(result.valid).toBe(true);
  });

  it('auto-corrected tool with invalid params returns valid: false with correctedName and errors', () => {
    const result = validateToolCall(registry, 'send_emal', {
      to: 123, // wrong type
      subject: 'Test',
      body: 'Content',
    });
    expect(result.correctedName).toBe('send_email');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.helpText).toBeDefined();
  });

  it('unknown tool with no similar names returns error with no suggestions', () => {
    const result = validateToolCall(registry, 'zzzzzzzzz', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('not found');
    // Should not contain "Did you mean" since no matches
    expect(result.errors[0]!.message).not.toContain('Did you mean');
  });

  it('tool without parameters validates successfully with any args', () => {
    const result = validateToolCall(registry, 'get_status', { extra: 'stuff' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('unknown tool with moderate similarity returns suggestions in error', () => {
    // 'create_notes' is close but differs by one char — might auto-correct
    // 'creat_note' differs by more but still similar
    const result = validateToolCall(registry, 'make_a_completely_different_note_thing', {});
    // This should either auto-correct or show suggestions depending on distance
    expect(result.valid).toBe(false);
    if (result.errors.length > 0 && !result.correctedName) {
      // If not auto-corrected, suggestions might be in the error message
      expect(result.errors[0]!.message).toContain('not found');
    }
  });

  it('enum param validation error through validateToolCall', () => {
    const result = validateToolCall(registry, 'list_tasks', {
      status: 'invalid_status',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('must be one of'))).toBe(true);
  });
});

// =============================================================================
// findSimilarToolNames
// =============================================================================

describe('findSimilarToolNames', () => {
  const registry = createMockRegistry([
    { name: 'send_email', description: 'Send an email message' },
    { name: 'list_emails', description: 'List all emails in inbox' },
    { name: 'search_emails', description: 'Search for emails by query' },
    { name: 'create_task', description: 'Create a new task' },
    { name: 'list_tasks', description: 'List all tasks' },
    { name: 'search_tools', description: 'Search available tools' },
    { name: 'get_tool_help', description: 'Get help for a tool' },
    { name: 'use_tool', description: 'Use a tool by name' },
    { name: 'batch_use_tool', description: 'Use multiple tools' },
    { name: 'read_file', description: 'Read file contents from disk' },
    { name: 'write_file', description: 'Write content to file on disk' },
  ]);

  it('returns matching tools for substring match', () => {
    const results = findSimilarToolNames(registry, 'email');
    expect(results.length).toBeGreaterThan(0);
    // All email-related tools should be included
    expect(results).toContain('send_email');
    expect(results).toContain('list_emails');
    expect(results).toContain('search_emails');
  });

  it('filters out meta-tools (search_tools, use_tool, etc.)', () => {
    const results = findSimilarToolNames(registry, 'tool');
    expect(results).not.toContain('search_tools');
    expect(results).not.toContain('get_tool_help');
    expect(results).not.toContain('use_tool');
    expect(results).not.toContain('batch_use_tool');
  });

  it('returns empty array when no matches', () => {
    const results = findSimilarToolNames(registry, 'xyznonexistent');
    expect(results).toEqual([]);
  });

  it('respects limit parameter', () => {
    const results = findSimilarToolNames(registry, 'email', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('scores higher for exact name matches vs description matches', () => {
    const results = findSimilarToolNames(registry, 'file');
    // read_file and write_file should rank above tools that only mention "file" in description
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatch(/file/);
  });

  it('uses default limit of 5', () => {
    const manyToolsRegistry = createMockRegistry(
      Array.from({ length: 20 }, (_, i) => ({
        name: `test_tool_${i}`,
        description: `Test tool number ${i}`,
      })),
    );
    const results = findSimilarToolNames(manyToolsRegistry, 'test');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('shared prefix of 3+ characters adds bonus score', () => {
    const results = findSimilarToolNames(registry, 'send');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toBe('send_email');
  });

  it('word-level matching works across underscores', () => {
    const results = findSimilarToolNames(registry, 'create');
    expect(results).toContain('create_task');
  });
});

// =============================================================================
// formatParamSchema
// =============================================================================

describe('formatParamSchema', () => {
  it('formats simple required string parameter', () => {
    const lines = formatParamSchema(
      'name',
      { type: 'string', description: 'The user name' },
      new Set(['name']),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('string');
    expect(lines[0]).toContain('(REQUIRED)');
    expect(lines[0]).toContain('The user name');
  });

  it('formats optional parameter with default value', () => {
    const lines = formatParamSchema(
      'limit',
      { type: 'integer', description: 'Max results', default: 20 },
      new Set([]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('(optional)');
    expect(lines[0]).toContain('[default: 20]');
    expect(lines[0]).toContain('integer');
  });

  it('formats enum parameter with pipe-separated values', () => {
    const lines = formatParamSchema(
      'status',
      { type: 'string', enum: ['active', 'inactive', 'pending'] },
      new Set(['status']),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"active"');
    expect(lines[0]).toContain('"inactive"');
    expect(lines[0]).toContain('"pending"');
    expect(lines[0]).toContain('|');
  });

  it('formats array of objects with nested properties', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Item key' },
          value: { type: 'number', description: 'Item value' },
        },
        required: ['key'],
      },
    };
    const lines = formatParamSchema('items', schema, new Set(['items']));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('array of objects');
    expect(lines[0]).toContain('(REQUIRED)');
    // Nested props should be indented further
    const nestedLines = lines.slice(1);
    expect(nestedLines.some(l => l.includes('key'))).toBe(true);
    expect(nestedLines.some(l => l.includes('value'))).toBe(true);
  });

  it('formats nested object parameter', () => {
    const schema = {
      type: 'object',
      description: 'Config settings',
      properties: {
        theme: { type: 'string' },
        fontSize: { type: 'integer' },
      },
      required: ['theme'],
    };
    const lines = formatParamSchema('config', schema, new Set(['config']));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain('object');
    expect(lines[0]).toContain('(REQUIRED)');
    expect(lines[0]).toContain('Config settings');
    // Nested properties
    const nested = lines.slice(1);
    expect(nested.some(l => l.includes('theme') && l.includes('(REQUIRED)'))).toBe(true);
    expect(nested.some(l => l.includes('fontSize') && l.includes('(optional)'))).toBe(true);
  });

  it('formats simple array of primitives', () => {
    const lines = formatParamSchema(
      'tags',
      { type: 'array', items: { type: 'string' }, description: 'Tag list' },
      new Set([]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('array of string');
    expect(lines[0]).toContain('(optional)');
    expect(lines[0]).toContain('Tag list');
  });

  it('uses custom indent', () => {
    const lines = formatParamSchema(
      'name',
      { type: 'string' },
      new Set([]),
      '    ',
    );
    expect(lines[0]).toMatch(/^ {4}/);
  });

  it('handles parameter with no description', () => {
    const lines = formatParamSchema('count', { type: 'number' }, new Set([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('count');
    expect(lines[0]).toContain('number');
    // No dash for description
    expect(lines[0]).not.toContain(' — ');
  });
});

// =============================================================================
// buildExampleValue
// =============================================================================

describe('buildExampleValue', () => {
  it('returns first enum value', () => {
    const result = buildExampleValue({ type: 'string', enum: ['high', 'medium', 'low'] }, 'priority');
    expect(result).toBe('high');
  });

  it('returns 0 for number type', () => {
    const result = buildExampleValue({ type: 'number' }, 'count');
    expect(result).toBe(0);
  });

  it('returns 0 for integer type', () => {
    const result = buildExampleValue({ type: 'integer' }, 'age');
    expect(result).toBe(0);
  });

  it('returns true for boolean type', () => {
    const result = buildExampleValue({ type: 'boolean' }, 'enabled');
    expect(result).toBe(true);
  });

  it('returns "user@example.com" for name containing "email"', () => {
    const result = buildExampleValue({ type: 'string' }, 'user_email');
    expect(result).toBe('user@example.com');
  });

  it('returns "user@example.com" for name "to"', () => {
    const result = buildExampleValue({ type: 'string' }, 'to');
    expect(result).toBe('user@example.com');
  });

  it('returns "user@example.com" for name "replyTo"', () => {
    const result = buildExampleValue({ type: 'string' }, 'replyTo');
    expect(result).toBe('user@example.com');
  });

  it('returns "/path/to/file" for name containing "path"', () => {
    const result = buildExampleValue({ type: 'string' }, 'file_path');
    expect(result).toBe('/path/to/file');
  });

  it('returns "/path/to/file" for name containing "file"', () => {
    const result = buildExampleValue({ type: 'string' }, 'output_file');
    expect(result).toBe('/path/to/file');
  });

  it('returns "https://example.com" for name containing "url"', () => {
    const result = buildExampleValue({ type: 'string' }, 'target_url');
    expect(result).toBe('https://example.com');
  });

  it('returns "https://example.com" for name containing "link"', () => {
    const result = buildExampleValue({ type: 'string' }, 'share_link');
    expect(result).toBe('https://example.com');
  });

  it('returns "2025-01-01" for name containing "date"', () => {
    const result = buildExampleValue({ type: 'string' }, 'start_date');
    expect(result).toBe('2025-01-01');
  });

  it('returns "some-id" for name containing "id"', () => {
    const result = buildExampleValue({ type: 'string' }, 'user_id');
    expect(result).toBe('some-id');
  });

  it('returns "..." for generic string name', () => {
    const result = buildExampleValue({ type: 'string' }, 'description');
    expect(result).toBe('...');
  });

  it('returns array with example item for array of objects', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['name'],
      },
    };
    const result = buildExampleValue(schema, 'items') as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('name');
  });

  it('returns ["..."] for simple array', () => {
    const result = buildExampleValue({ type: 'array', items: { type: 'string' } }, 'tags');
    expect(result).toEqual(['...']);
  });

  it('returns ["..."] for array without items schema', () => {
    const result = buildExampleValue({ type: 'array' }, 'data');
    expect(result).toEqual(['...']);
  });

  it('builds object example with only required fields', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        nickname: { type: 'string' },
      },
      required: ['name', 'age'],
    };
    const result = buildExampleValue(schema, 'person') as Record<string, unknown>;
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('age');
    expect(result).not.toHaveProperty('nickname');
  });

  it('returns empty object for object type without properties', () => {
    const result = buildExampleValue({ type: 'object' }, 'data');
    expect(result).toEqual({});
  });

  it('array of objects includes all fields when 3 or fewer properties', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'number' },
        },
      },
    };
    const result = buildExampleValue(schema, 'pairs') as unknown[];
    const item = result[0] as Record<string, unknown>;
    // With 2 properties (<=3), all should be included even without required
    expect(item).toHaveProperty('key');
    expect(item).toHaveProperty('value');
  });
});

// =============================================================================
// buildToolHelpText
// =============================================================================

describe('buildToolHelpText', () => {
  const registry = createMockRegistry([sendEmailTool, noParamsTool]);

  it('returns empty string when tool not found', () => {
    const result = buildToolHelpText(registry, 'nonexistent');
    expect(result).toBe('');
  });

  it('returns empty string for tool without parameters properties', () => {
    const emptyParamsRegistry = createMockRegistry([{
      name: 'no_props',
      description: 'No properties tool',
      parameters: { type: 'object' }, // no properties key
    }]);
    const result = buildToolHelpText(emptyParamsRegistry, 'no_props');
    expect(result).toBe('');
  });

  it('returns help text for tool with empty properties (properties: {} is truthy)', () => {
    const result = buildToolHelpText(registry, 'get_status');
    // properties is {} (truthy), so the function still generates help text
    // but with no parameter lines — just the banner, description, and example
    expect(result).toContain('--- TOOL HELP (get_status) ---');
    expect(result).toContain('Example:');
  });

  it('returns formatted help with TOOL HELP banner, params, and example', () => {
    const result = buildToolHelpText(registry, 'send_email');
    expect(result).toContain('--- TOOL HELP (send_email) ---');
    expect(result).toContain('Send an email to a recipient');
    expect(result).toContain('Parameters:');
    expect(result).toContain('to');
    expect(result).toContain('subject');
    expect(result).toContain('body');
    expect(result).toContain('Example:');
    expect(result).toContain('Fix your parameters and retry immediately.');
  });

  it('example includes only required args', () => {
    const result = buildToolHelpText(registry, 'send_email');
    // The example should have to, subject, body but NOT cc
    expect(result).toContain('"to"');
    expect(result).toContain('"subject"');
    expect(result).toContain('"body"');
    // Extract the example line
    const exampleLine = result.split('\n').find(l => l.startsWith('Example:'));
    expect(exampleLine).toBeDefined();
    // cc is optional, should not be in the example args
    expect(exampleLine).not.toContain('"cc"');
  });
});

// =============================================================================
// formatFullToolHelp
// =============================================================================

describe('formatFullToolHelp', () => {
  const registry = createMockRegistry([sendEmailTool, listTasksTool, noParamsTool]);

  it('returns "not found" message for unknown tool', () => {
    const result = formatFullToolHelp(registry, 'nonexistent_tool');
    expect(result).toContain("'nonexistent_tool' not found");
  });

  it('returns "No parameters required" for parameterless tool', () => {
    const result = formatFullToolHelp(registry, 'get_status');
    expect(result).toContain('No parameters required');
    expect(result).toContain('## get_status');
    expect(result).toContain('use_tool("get_status", {})');
  });

  it('returns Required and Optional sections', () => {
    const result = formatFullToolHelp(registry, 'send_email');
    expect(result).toContain('### Required Parameters');
    expect(result).toContain('### Optional Parameters');
    expect(result).toContain('## send_email');
  });

  it('example call includes only required params', () => {
    const result = formatFullToolHelp(registry, 'send_email');
    expect(result).toContain('### Example Call');
    expect(result).toContain('use_tool("send_email"');
    // Required params in example
    expect(result).toContain('"to"');
    expect(result).toContain('"subject"');
    expect(result).toContain('"body"');
  });

  it('includes tool limit info when available (list_tasks)', () => {
    const result = formatFullToolHelp(registry, 'list_tasks');
    // list_tasks has a limit in TOOL_MAX_LIMITS
    expect(result).toContain('Note:');
    expect(result).toContain('"limit"');
    expect(result).toContain('capped at max');
  });

  it('does not include limit info for tools without limits', () => {
    const result = formatFullToolHelp(registry, 'send_email');
    expect(result).not.toContain('capped at max');
  });

  it('shows only optional section when no required params', () => {
    const result = formatFullToolHelp(registry, 'list_tasks');
    // list_tasks has no required params
    expect(result).not.toContain('### Required Parameters');
    expect(result).toContain('### Optional Parameters');
  });

  it('contains tool description', () => {
    const result = formatFullToolHelp(registry, 'send_email');
    expect(result).toContain('Send an email to a recipient');
  });
});

// =============================================================================
// validateRequiredParams
// =============================================================================

describe('validateRequiredParams', () => {
  const registry = createMockRegistry([sendEmailTool, listTasksTool, noParamsTool]);

  it('returns null for tool without parameters', () => {
    const noParamsToolDef = {
      name: 'bare_tool',
      description: 'Tool with no parameters property',
    };
    const reg = createMockRegistry([noParamsToolDef]);
    const result = validateRequiredParams(reg, 'bare_tool', {});
    expect(result).toBeNull();
  });

  it('returns null when all required params provided', () => {
    const result = validateRequiredParams(registry, 'send_email', {
      to: 'alice@example.com',
      subject: 'Hello',
      body: 'Content',
    });
    expect(result).toBeNull();
  });

  it('returns error message listing missing params', () => {
    const result = validateRequiredParams(registry, 'send_email', {
      to: 'alice@example.com',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('Missing required parameter(s)');
    expect(result).toContain('subject');
    expect(result).toContain('body');
  });

  it('returns null when tool has no required params', () => {
    const result = validateRequiredParams(registry, 'list_tasks', {});
    expect(result).toBeNull();
  });

  it('returns null for unknown tool (no definition found)', () => {
    const result = validateRequiredParams(registry, 'nonexistent', { foo: 'bar' });
    expect(result).toBeNull();
  });

  it('treats null param values as missing', () => {
    const result = validateRequiredParams(registry, 'send_email', {
      to: 'alice@example.com',
      subject: null,
      body: null,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('subject');
    expect(result).toContain('body');
  });

  it('returns error for single missing required param', () => {
    const result = validateRequiredParams(registry, 'send_email', {
      to: 'alice@example.com',
      subject: 'Hello',
      // missing body
    });
    expect(result).not.toBeNull();
    expect(result).toContain('body');
    expect(result).not.toContain('subject');
    expect(result).not.toContain(', to');
  });
});

// =============================================================================
// Edge cases and integration
// =============================================================================

describe('edge cases', () => {
  it('validateToolCall with tool that has no properties key', () => {
    const registry = createMockRegistry([{
      name: 'raw_tool',
      description: 'Tool with parameters but no properties',
      parameters: { type: 'object' },
    }]);
    const result = validateToolCall(registry, 'raw_tool', { anything: 'goes' });
    expect(result.valid).toBe(true);
  });

  it('findSimilarToolNames handles empty query', () => {
    const registry = createMockRegistry([
      { name: 'send_email', description: 'Send email' },
    ]);
    const results = findSimilarToolNames(registry, '');
    // Empty query → no word matches, but potentially zero-length prefix bonus
    expect(Array.isArray(results)).toBe(true);
  });

  it('findSimilarToolNames handles query with special characters', () => {
    const registry = createMockRegistry([
      { name: 'send_email', description: 'Send email' },
    ]);
    const results = findSimilarToolNames(registry, 'send-email');
    // Hyphens are normalized to spaces, so 'send email' should match 'send_email'
    expect(results).toContain('send_email');
  });

  it('buildExampleValue for array of objects with many optional fields', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'string' },
          d: { type: 'string' },
          e: { type: 'string' },
        },
        required: ['a'],
      },
    };
    const result = buildExampleValue(schema, 'items') as unknown[];
    const item = result[0] as Record<string, unknown>;
    // With >3 properties and only 'a' required, only 'a' should be in example
    expect(item).toHaveProperty('a');
    expect(Object.keys(item)).toHaveLength(1);
  });

  it('validateAgainstSchema with deeply nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        level1: {
          type: 'object',
          properties: {
            level2: {
              type: 'object',
              properties: {
                value: { type: 'string' },
              },
              required: ['value'],
            },
          },
          required: ['level2'],
        },
      },
      required: ['level1'],
    };
    // Valid deep nesting
    expect(validateAgainstSchema({ level1: { level2: { value: 'ok' } } }, schema)).toEqual([]);

    // Missing deeply nested required field
    const errors = validateAgainstSchema({ level1: { level2: {} } }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe('params.level1.level2.value');
  });

  it('validateAgainstSchema with empty array passes', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    const errors = validateAgainstSchema([], schema);
    expect(errors).toEqual([]);
  });

  it('formatParamSchema for array without items type', () => {
    const lines = formatParamSchema('data', { type: 'array' }, new Set([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('array of any');
  });

  it('formatParamSchema for array with items but no type on items', () => {
    const lines = formatParamSchema('data', { type: 'array', items: {} }, new Set([]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('array of any');
  });
});
