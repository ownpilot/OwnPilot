/**
 * Tool Providers Tests
 *
 * Verifies that each ToolProvider returns valid tool definitions
 * and wraps gateway executors correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolProvider } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Mocks — prevent real service/repo calls
// ---------------------------------------------------------------------------

vi.mock('../../routes/memories.js', () => ({
  executeMemoryTool: vi.fn(async (_name: string, _args: unknown, _userId?: string) => ({
    success: true,
    result: { mocked: true },
  })),
}));

vi.mock('../../routes/goals.js', () => ({
  executeGoalTool: vi.fn(async (_name: string, _args: unknown, _userId?: string) => ({
    success: true,
    result: { mocked: true },
  })),
}));

vi.mock('../../routes/custom-data.js', () => ({
  executeCustomDataTool: vi.fn(async (_name: string, _args: unknown, _userId?: string) => ({
    success: true,
    result: { mocked: true },
  })),
}));

vi.mock('../../routes/personal-data-tools.js', () => ({
  executePersonalDataTool: vi.fn(async (_name: string, _args: unknown, _userId?: string) => ({
    success: true,
    result: { mocked: true },
  })),
}));

vi.mock('../../tools/index.js', () => ({
  TRIGGER_TOOLS: [
    { name: 'create_trigger', description: 'Create trigger', parameters: { type: 'object', properties: {} }, category: 'Automation' },
    { name: 'list_triggers', description: 'List triggers', parameters: { type: 'object', properties: {} }, category: 'Automation' },
  ],
  executeTriggerTool: vi.fn(async () => ({ success: true, result: {} })),
  PLAN_TOOLS: [
    { name: 'create_plan', description: 'Create plan', parameters: { type: 'object', properties: {} }, category: 'Automation' },
    { name: 'execute_plan', description: 'Execute plan', parameters: { type: 'object', properties: {} }, category: 'Automation' },
  ],
  executePlanTool: vi.fn(async () => ({ success: true, result: {} })),
}));

// Need to mock MEMORY_TOOLS, GOAL_TOOLS, CUSTOM_DATA_TOOLS, PERSONAL_DATA_TOOLS from core
vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    MEMORY_TOOLS: [
      { name: 'add_memory', description: 'Add memory', parameters: { type: 'object', properties: {} } },
      { name: 'search_memories', description: 'Search', parameters: { type: 'object', properties: {} } },
    ],
    GOAL_TOOLS: [
      { name: 'create_goal', description: 'Create goal', parameters: { type: 'object', properties: {} } },
      { name: 'list_goals', description: 'List goals', parameters: { type: 'object', properties: {} } },
    ],
    CUSTOM_DATA_TOOLS: [
      { name: 'create_table', description: 'Create table', parameters: { type: 'object', properties: {} } },
    ],
    PERSONAL_DATA_TOOLS: [
      { name: 'set_personal_info', description: 'Set info', parameters: { type: 'object', properties: {} } },
    ],
  };
});

import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
} from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Provider shape
  // ========================================================================

  describe('provider shape', () => {
    const providers: Array<{ factory: () => ToolProvider; name: string; expectedTools: number }> = [
      { factory: () => createMemoryToolProvider('user-1'), name: 'memory', expectedTools: 2 },
      { factory: () => createGoalToolProvider('user-1'), name: 'goal', expectedTools: 2 },
      { factory: () => createCustomDataToolProvider(), name: 'custom-data', expectedTools: 1 },
      { factory: () => createPersonalDataToolProvider(), name: 'personal-data', expectedTools: 1 },
      { factory: () => createTriggerToolProvider(), name: 'trigger', expectedTools: 2 },
      { factory: () => createPlanToolProvider(), name: 'plan', expectedTools: 2 },
    ];

    for (const { factory, name, expectedTools } of providers) {
      describe(`${name} provider`, () => {
        it(`has name "${name}"`, () => {
          const provider = factory();
          expect(provider.name).toBe(name);
        });

        it(`returns ${expectedTools} tools`, () => {
          const provider = factory();
          const tools = provider.getTools();
          expect(tools).toHaveLength(expectedTools);
        });

        it('returns tools with definition and executor', () => {
          const provider = factory();
          const tools = provider.getTools();
          for (const tool of tools) {
            expect(tool).toHaveProperty('definition');
            expect(tool).toHaveProperty('executor');
            expect(tool.definition).toHaveProperty('name');
            expect(tool.definition).toHaveProperty('description');
            expect(tool.definition).toHaveProperty('parameters');
            expect(typeof tool.executor).toBe('function');
          }
        });
      });
    }
  });

  // ========================================================================
  // Executor wrapping
  // ========================================================================

  describe('executor wrapping', () => {
    it('wraps successful result correctly', async () => {
      const provider = createMemoryToolProvider('user-1');
      const tools = provider.getTools();
      const executor = tools[0]!.executor;

      const result = await executor({}, { callId: 'test', conversationId: 'c1' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('mocked');
    });

    it('wraps error result correctly', async () => {
      const { executeGoalTool } = await import('../../routes/goals.js');
      (executeGoalTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Goal not found',
      });

      const provider = createGoalToolProvider('user-1');
      const tools = provider.getTools();
      const executor = tools[0]!.executor;

      const result = await executor({}, { callId: 'test', conversationId: 'c1' });

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Goal not found');
    });

    it('returns "Unknown error" when no error message', async () => {
      const { executeCustomDataTool } = await import('../../routes/custom-data.js');
      (executeCustomDataTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
      });

      const provider = createCustomDataToolProvider();
      const tools = provider.getTools();
      const executor = tools[0]!.executor;

      const result = await executor({}, { callId: 'test', conversationId: 'c1' });

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Unknown error');
    });

    it('stringifies object results to JSON', async () => {
      const provider = createTriggerToolProvider();
      const tools = provider.getTools();
      const executor = tools[0]!.executor;

      const result = await executor({}, { callId: 'test', conversationId: 'c1' });

      // Result should be stringified JSON
      expect(typeof result.content).toBe('string');
      const parsed = JSON.parse(result.content as string);
      expect(parsed).toEqual({});
    });

    it('passes string results through directly', async () => {
      const { executeMemoryTool } = await import('../../routes/memories.js');
      (executeMemoryTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        result: 'plain text result',
      });

      const provider = createMemoryToolProvider('user-1');
      const tools = provider.getTools();
      const executor = tools[0]!.executor;

      const result = await executor({}, { callId: 'test', conversationId: 'c1' });

      expect(result.content).toBe('plain text result');
    });
  });
});
