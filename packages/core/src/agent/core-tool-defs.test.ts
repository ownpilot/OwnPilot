/**
 * Core Tool Definitions Tests
 *
 * Validates structural integrity of all CORE_TOOLS definitions.
 * Ensures each tool has valid schema, naming, and required fields.
 */

import { describe, it, expect } from 'vitest';
import { CORE_TOOLS } from './core-tool-defs.js';

describe('CORE_TOOLS', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(CORE_TOOLS)).toBe(true);
    expect(CORE_TOOLS.length).toBeGreaterThan(0);
  });

  it('has at least 50 tools', () => {
    expect(CORE_TOOLS.length).toBeGreaterThanOrEqual(50);
  });

  it('all tools have unique names', () => {
    const names = CORE_TOOLS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all tool names use snake_case', () => {
    for (const tool of CORE_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('all tools have non-empty descriptions', () => {
    for (const tool of CORE_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('all tools have parameters with type "object"', () => {
    for (const tool of CORE_TOOLS) {
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.parameters.properties).toBe('object');
    }
  });

  it('required fields reference existing properties', () => {
    for (const tool of CORE_TOOLS) {
      if (tool.parameters.required) {
        for (const req of tool.parameters.required) {
          expect(tool.parameters.properties).toHaveProperty(req);
        }
      }
    }
  });

  it('all properties have valid JSON Schema types', () => {
    const validTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

    for (const tool of CORE_TOOLS) {
      for (const [propName, prop] of Object.entries(tool.parameters.properties)) {
        expect(
          validTypes.has(prop.type),
          `${tool.name}.${propName} has invalid type "${prop.type}"`
        ).toBe(true);
      }
    }
  });

  it('all properties have descriptions', () => {
    for (const tool of CORE_TOOLS) {
      for (const [propName, prop] of Object.entries(tool.parameters.properties)) {
        expect(prop.description, `${tool.name}.${propName} missing description`).toBeTruthy();
      }
    }
  });

  it('array properties have items schema', () => {
    for (const tool of CORE_TOOLS) {
      for (const [propName, prop] of Object.entries(tool.parameters.properties)) {
        if (prop.type === 'array') {
          expect(
            prop.items,
            `${tool.name}.${propName} is array but missing items schema`
          ).toBeDefined();
        }
      }
    }
  });

  it('enum properties have non-empty enum arrays', () => {
    for (const tool of CORE_TOOLS) {
      for (const [propName, prop] of Object.entries(tool.parameters.properties)) {
        if (prop.enum) {
          expect(prop.enum.length, `${tool.name}.${propName} has empty enum`).toBeGreaterThan(0);
        }
      }
    }
  });

  // ==========================================================================
  // Specific tool presence checks
  // ==========================================================================

  describe('essential tools are present', () => {
    const essentialTools = [
      'get_current_time',
      'calculate',
      'generate_uuid',
      'write_file',
      'read_file',
      'list_files',
      'delete_file',
      'create_task',
      'list_tasks',
      'create_note',
      'search_notes',
    ];

    for (const name of essentialTools) {
      it(`includes ${name}`, () => {
        const tool = CORE_TOOLS.find((t) => t.name === name);
        expect(tool, `Missing essential tool: ${name}`).toBeDefined();
      });
    }
  });

  // ==========================================================================
  // Category validation
  // ==========================================================================

  describe('categories', () => {
    it('tools with categories use valid category names', () => {
      for (const tool of CORE_TOOLS) {
        if (tool.category) {
          expect(tool.category).toMatch(/^[a-z][a-z0-9_-]*$/);
        }
      }
    });
  });

  // ==========================================================================
  // Specific tool schema validation
  // ==========================================================================

  describe('specific tool schemas', () => {
    it('calculate requires expression', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'calculate')!;
      expect(tool.parameters.required).toContain('expression');
      expect(tool.parameters.properties.expression.type).toBe('string');
    });

    it('write_file requires path and content', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'write_file')!;
      expect(tool.parameters.required).toContain('path');
      expect(tool.parameters.required).toContain('content');
    });

    it('read_file requires path', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'read_file')!;
      expect(tool.parameters.required).toContain('path');
    });

    it('create_task requires title', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'create_task')!;
      expect(tool.parameters.required).toContain('title');
    });

    it('hash_text has algorithm property with description', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'hash_text')!;
      expect(tool.parameters.properties.algorithm).toBeDefined();
      expect(tool.parameters.properties.algorithm.description).toContain('sha256');
    });

    it('convert_units requires value, from, to', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'convert_units')!;
      expect(tool.parameters.required).toContain('value');
      expect(tool.parameters.required).toContain('from');
      expect(tool.parameters.required).toContain('to');
    });

    it('random_number has min/max parameters', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'random_number')!;
      expect(tool.parameters.properties.min).toBeDefined();
      expect(tool.parameters.properties.max).toBeDefined();
    });

    it('text_transform requires text and operation', () => {
      const tool = CORE_TOOLS.find((t) => t.name === 'text_transform')!;
      expect(tool.parameters.required).toContain('text');
      expect(tool.parameters.required).toContain('operation');
      expect(tool.parameters.properties.operation.description).toContain('uppercase');
    });
  });
});
