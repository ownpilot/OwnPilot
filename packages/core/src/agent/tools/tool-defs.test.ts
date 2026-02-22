/**
 * Gateway Tool Definitions Tests
 *
 * Validates structural integrity of MEMORY_TOOLS, GOAL_TOOLS,
 * CUSTOM_DATA_TOOLS, and PERSONAL_DATA_TOOLS definitions.
 * Ensures each tool has valid schema, naming, and required fields.
 */

import { describe, it, expect } from 'vitest';
import { MEMORY_TOOLS, MEMORY_TOOL_NAMES } from './memory-tools.js';
import { GOAL_TOOLS, GOAL_TOOL_NAMES } from './goal-tools.js';
import { CUSTOM_DATA_TOOLS, CUSTOM_DATA_TOOL_NAMES } from './custom-data.js';
import { PERSONAL_DATA_TOOLS, PERSONAL_DATA_TOOL_NAMES } from './personal-data.js';

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const validTypes = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

function validateToolArray(
  name: string,
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
) {
  describe(name, () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('all tools have unique names', () => {
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('all tool names use snake_case', () => {
      for (const tool of tools) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('all tools have non-empty descriptions', () => {
      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });

    it('all tools have parameters with type "object"', () => {
      for (const tool of tools) {
        expect(tool.parameters.type).toBe('object');
        expect(typeof tool.parameters.properties).toBe('object');
      }
    });

    it('required fields reference existing properties', () => {
      for (const tool of tools) {
        const params = tool.parameters as {
          required?: string[];
          properties: Record<string, unknown>;
        };
        if (params.required) {
          for (const req of params.required) {
            expect(params.properties).toHaveProperty(req);
          }
        }
      }
    });

    it('all properties have valid JSON Schema types', () => {
      for (const tool of tools) {
        const props = (tool.parameters as { properties: Record<string, { type: string }> })
          .properties;
        for (const [propName, prop] of Object.entries(props)) {
          expect(
            validTypes.has(prop.type),
            `${tool.name}.${propName} has invalid type "${prop.type}"`
          ).toBe(true);
        }
      }
    });

    it('all properties have descriptions', () => {
      for (const tool of tools) {
        const props = (tool.parameters as { properties: Record<string, { description?: string }> })
          .properties;
        for (const [propName, prop] of Object.entries(props)) {
          expect(prop.description, `${tool.name}.${propName} missing description`).toBeTruthy();
        }
      }
    });

    it('array properties have items schema', () => {
      for (const tool of tools) {
        const props = (
          tool.parameters as { properties: Record<string, { type: string; items?: unknown }> }
        ).properties;
        for (const [propName, prop] of Object.entries(props)) {
          if (prop.type === 'array') {
            expect(
              prop.items,
              `${tool.name}.${propName} is array but missing items schema`
            ).toBeDefined();
          }
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Run structural validations
// ---------------------------------------------------------------------------

describe('Gateway Tool Definitions', () => {
  validateToolArray('MEMORY_TOOLS', MEMORY_TOOLS);
  validateToolArray('GOAL_TOOLS', GOAL_TOOLS);
  validateToolArray('CUSTOM_DATA_TOOLS', CUSTOM_DATA_TOOLS);
  validateToolArray('PERSONAL_DATA_TOOLS', PERSONAL_DATA_TOOLS);

  // ========================================================================
  // Tool name arrays match
  // ========================================================================

  describe('tool name arrays', () => {
    it('MEMORY_TOOL_NAMES matches MEMORY_TOOLS', () => {
      expect(MEMORY_TOOL_NAMES).toEqual(MEMORY_TOOLS.map((t) => t.name));
    });

    it('GOAL_TOOL_NAMES matches GOAL_TOOLS', () => {
      expect(GOAL_TOOL_NAMES).toEqual(GOAL_TOOLS.map((t) => t.name));
    });

    it('CUSTOM_DATA_TOOL_NAMES matches CUSTOM_DATA_TOOLS', () => {
      expect(CUSTOM_DATA_TOOL_NAMES).toEqual(CUSTOM_DATA_TOOLS.map((t) => t.name));
    });

    it('PERSONAL_DATA_TOOL_NAMES matches PERSONAL_DATA_TOOLS', () => {
      expect(PERSONAL_DATA_TOOL_NAMES).toEqual(PERSONAL_DATA_TOOLS.map((t) => t.name));
    });
  });

  // ========================================================================
  // Specific tool counts
  // ========================================================================

  describe('tool counts', () => {
    it('MEMORY_TOOLS has 7 tools', () => {
      expect(MEMORY_TOOLS).toHaveLength(7);
    });

    it('GOAL_TOOLS has 8 tools', () => {
      expect(GOAL_TOOLS).toHaveLength(8);
    });

    it('CUSTOM_DATA_TOOLS has 11 tools', () => {
      expect(CUSTOM_DATA_TOOLS).toHaveLength(11);
    });

    it('PERSONAL_DATA_TOOLS has 24 tools', () => {
      expect(PERSONAL_DATA_TOOLS).toHaveLength(24);
    });
  });

  // ========================================================================
  // Essential tool presence
  // ========================================================================

  describe('essential tools present', () => {
    const memoryEssentials = ['create_memory', 'search_memories', 'delete_memory'];
    const goalEssentials = ['create_goal', 'list_goals', 'update_goal', 'decompose_goal'];
    const customDataEssentials = [
      'list_custom_tables',
      'create_custom_table',
      'add_custom_record',
      'search_custom_records',
    ];
    const personalEssentials = [
      'add_task',
      'list_tasks',
      'add_note',
      'add_calendar_event',
      'add_contact',
    ];

    for (const name of memoryEssentials) {
      it(`MEMORY_TOOLS includes ${name}`, () => {
        expect(MEMORY_TOOLS.find((t) => t.name === name)).toBeDefined();
      });
    }

    for (const name of goalEssentials) {
      it(`GOAL_TOOLS includes ${name}`, () => {
        expect(GOAL_TOOLS.find((t) => t.name === name)).toBeDefined();
      });
    }

    for (const name of customDataEssentials) {
      it(`CUSTOM_DATA_TOOLS includes ${name}`, () => {
        expect(CUSTOM_DATA_TOOLS.find((t) => t.name === name)).toBeDefined();
      });
    }

    for (const name of personalEssentials) {
      it(`PERSONAL_DATA_TOOLS includes ${name}`, () => {
        expect(PERSONAL_DATA_TOOLS.find((t) => t.name === name)).toBeDefined();
      });
    }
  });

  // ========================================================================
  // Specific tool schema validations
  // ========================================================================

  describe('specific tool schemas', () => {
    it('create_memory requires content', () => {
      const tool = MEMORY_TOOLS.find((t) => t.name === 'create_memory')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('content');
    });

    it('search_memories requires query', () => {
      const tool = MEMORY_TOOLS.find((t) => t.name === 'search_memories')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('query');
    });

    it('create_goal requires title', () => {
      const tool = GOAL_TOOLS.find((t) => t.name === 'create_goal')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('title');
    });

    it('create_custom_table requires name and columns', () => {
      const tool = CUSTOM_DATA_TOOLS.find((t) => t.name === 'create_custom_table')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('name');
      expect(params.required).toContain('columns');
    });

    it('add_task requires title', () => {
      const tool = PERSONAL_DATA_TOOLS.find((t) => t.name === 'add_task')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('title');
    });

    it('add_contact requires name', () => {
      const tool = PERSONAL_DATA_TOOLS.find((t) => t.name === 'add_contact')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('name');
    });

    it('add_calendar_event requires title and startTime', () => {
      const tool = PERSONAL_DATA_TOOLS.find((t) => t.name === 'add_calendar_event')!;
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('title');
      expect(params.required).toContain('startTime');
    });

    it('batch tools accept array parameters', () => {
      const batchTools = [
        MEMORY_TOOLS.find((t) => t.name === 'batch_create_memories'),
        PERSONAL_DATA_TOOLS.find((t) => t.name === 'batch_add_tasks'),
        PERSONAL_DATA_TOOLS.find((t) => t.name === 'batch_add_notes'),
        PERSONAL_DATA_TOOLS.find((t) => t.name === 'batch_add_calendar_events'),
        PERSONAL_DATA_TOOLS.find((t) => t.name === 'batch_add_contacts'),
        PERSONAL_DATA_TOOLS.find((t) => t.name === 'batch_add_bookmarks'),
      ];

      for (const tool of batchTools) {
        expect(tool, 'batch tool missing').toBeDefined();
        const props = (tool!.parameters as { properties: Record<string, { type: string }> })
          .properties;
        const arrayProps = Object.entries(props).filter(([_, p]) => p.type === 'array');
        expect(
          arrayProps.length,
          `${tool!.name} should have at least 1 array param`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ========================================================================
  // No cross-collection name collisions
  // ========================================================================

  describe('no name collisions across tool sets', () => {
    it('all tool names are unique across all collections', () => {
      const allNames = [
        ...MEMORY_TOOL_NAMES,
        ...GOAL_TOOL_NAMES,
        ...CUSTOM_DATA_TOOL_NAMES,
        ...PERSONAL_DATA_TOOL_NAMES,
      ];
      const unique = new Set(allNames);
      expect(unique.size).toBe(allNames.length);
    });
  });
});
