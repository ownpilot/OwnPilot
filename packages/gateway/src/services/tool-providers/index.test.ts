/**
 * Tool Providers — index.ts
 *
 * Comprehensive tests for all six provider factories and the shared
 * wrapGatewayExecutor helper (exercised indirectly through the providers).
 *
 * Key invariants under test:
 *  - Provider shape: { name, getTools }
 *  - getTools() maps each ToolDefinition onto { definition, executor }
 *  - executor wraps the gateway executor:
 *      success + string  → { content: string }
 *      success + non-string → { content: JSON.stringify(value, null, 2) }
 *      failure           → { content: error ?? 'Unknown error', isError: true }
 *  - Correct gateway function is called with (toolName, args, userId?)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock values — must be created with vi.hoisted so they exist before
// the vi.mock() factory functions run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // --- @ownpilot/core tool definition arrays ---
  const memoryToolDef1 = {
    name: 'create_memory',
    description: 'Store information in persistent memory',
    parameters: { type: 'object' as const, properties: {} },
  };
  const memoryToolDef2 = {
    name: 'search_memories',
    description: 'Search stored memories',
    parameters: { type: 'object' as const, properties: {} },
  };
  const goalToolDef1 = {
    name: 'create_goal',
    description: 'Create a new goal',
    parameters: { type: 'object' as const, properties: {} },
  };
  const goalToolDef2 = {
    name: 'list_goals',
    description: 'List all goals',
    parameters: { type: 'object' as const, properties: {} },
  };
  const customDataToolDef = {
    name: 'list_custom_tables',
    description: 'List custom data tables',
    parameters: { type: 'object' as const, properties: {} },
  };
  const personalDataToolDef = {
    name: 'add_task',
    description: 'Add a personal task',
    parameters: { type: 'object' as const, properties: {} },
  };

  // --- gateway/tools tool definition arrays ---
  const triggerToolDef1 = {
    name: 'create_trigger',
    description: 'Create a trigger',
    parameters: { type: 'object' as const, properties: {} },
  };
  const triggerToolDef2 = {
    name: 'list_triggers',
    description: 'List triggers',
    parameters: { type: 'object' as const, properties: {} },
  };
  const planToolDef1 = {
    name: 'create_plan',
    description: 'Create a plan',
    parameters: { type: 'object' as const, properties: {} },
  };
  const planToolDef2 = {
    name: 'execute_plan',
    description: 'Execute a plan',
    parameters: { type: 'object' as const, properties: {} },
  };

  // --- new tool definition arrays ---
  const heartbeatToolDef = {
    name: 'create_heartbeat',
    description: 'Create a heartbeat',
    parameters: { type: 'object' as const, properties: {} },
  };
  const extensionToolDef = {
    name: 'list_extensions',
    description: 'List extensions',
    parameters: { type: 'object' as const, properties: {} },
  };
  const configToolDef = {
    name: 'config_list_services',
    description: 'List config services',
    parameters: { type: 'object' as const, properties: {} },
  };

  // --- gateway executor mocks ---
  const executeMemoryTool = vi.fn();
  const executeGoalTool = vi.fn();
  const executeCustomDataTool = vi.fn();
  const executePersonalDataTool = vi.fn();
  const executeTriggerTool = vi.fn();
  const executePlanTool = vi.fn();
  const executeHeartbeatTool = vi.fn();
  const executeExtensionTool = vi.fn();
  const executeConfigTool = vi.fn();

  return {
    // ToolDefinition arrays
    MEMORY_TOOLS: [memoryToolDef1, memoryToolDef2],
    GOAL_TOOLS: [goalToolDef1, goalToolDef2],
    CUSTOM_DATA_TOOLS: [customDataToolDef],
    PERSONAL_DATA_TOOLS: [personalDataToolDef],
    TRIGGER_TOOLS: [triggerToolDef1, triggerToolDef2],
    PLAN_TOOLS: [planToolDef1, planToolDef2],
    HEARTBEAT_TOOLS: [heartbeatToolDef],
    EXTENSION_TOOLS: [extensionToolDef],
    CONFIG_TOOLS: [configToolDef],
    // Individual tool defs for assertion
    memoryToolDef1,
    memoryToolDef2,
    goalToolDef1,
    goalToolDef2,
    customDataToolDef,
    personalDataToolDef,
    triggerToolDef1,
    triggerToolDef2,
    planToolDef1,
    planToolDef2,
    heartbeatToolDef,
    extensionToolDef,
    configToolDef,
    // Executor spies
    executeMemoryTool,
    executeGoalTool,
    executeCustomDataTool,
    executePersonalDataTool,
    executeTriggerTool,
    executePlanTool,
    executeHeartbeatTool,
    executeExtensionTool,
    executeConfigTool,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', () => ({
  MEMORY_TOOLS: mocks.MEMORY_TOOLS,
  GOAL_TOOLS: mocks.GOAL_TOOLS,
  CUSTOM_DATA_TOOLS: mocks.CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS: mocks.PERSONAL_DATA_TOOLS,
}));

vi.mock('../../routes/memories.js', () => ({
  executeMemoryTool: mocks.executeMemoryTool,
}));

vi.mock('../../routes/goals.js', () => ({
  executeGoalTool: mocks.executeGoalTool,
}));

vi.mock('../../routes/custom-data.js', () => ({
  executeCustomDataTool: mocks.executeCustomDataTool,
}));

vi.mock('../../routes/personal-data-tools.js', () => ({
  executePersonalDataTool: mocks.executePersonalDataTool,
}));

vi.mock('../../tools/index.js', () => ({
  TRIGGER_TOOLS: mocks.TRIGGER_TOOLS,
  executeTriggerTool: mocks.executeTriggerTool,
  PLAN_TOOLS: mocks.PLAN_TOOLS,
  executePlanTool: mocks.executePlanTool,
  HEARTBEAT_TOOLS: mocks.HEARTBEAT_TOOLS,
  executeHeartbeatTool: mocks.executeHeartbeatTool,
  EXTENSION_TOOLS: mocks.EXTENSION_TOOLS,
  executeExtensionTool: mocks.executeExtensionTool,
}));

vi.mock('../config-tools.js', () => ({
  CONFIG_TOOLS: mocks.CONFIG_TOOLS,
  executeConfigTool: mocks.executeConfigTool,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
  createConfigToolProvider,
  createHeartbeatToolProvider,
  createExtensionToolProvider,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default success response when executor is not configured explicitly. */
const defaultSuccess = { success: true, result: { ok: true } };

beforeEach(() => {
  vi.clearAllMocks();

  // Default behaviour: every executor succeeds unless overridden in a test.
  mocks.executeMemoryTool.mockResolvedValue(defaultSuccess);
  mocks.executeGoalTool.mockResolvedValue(defaultSuccess);
  mocks.executeCustomDataTool.mockResolvedValue(defaultSuccess);
  mocks.executePersonalDataTool.mockResolvedValue(defaultSuccess);
  mocks.executeTriggerTool.mockResolvedValue(defaultSuccess);
  mocks.executePlanTool.mockResolvedValue(defaultSuccess);
  mocks.executeHeartbeatTool.mockResolvedValue(defaultSuccess);
  mocks.executeExtensionTool.mockResolvedValue(defaultSuccess);
  mocks.executeConfigTool.mockResolvedValue(defaultSuccess);
});

// ===========================================================================
// 1. wrapGatewayExecutor — tested indirectly via provider getTools()
// ===========================================================================

describe('wrapGatewayExecutor', () => {
  describe('success path — string result', () => {
    it('returns content as the raw string when result is a string', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 'hello world' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({ q: 1 });
      expect(out.content).toBe('hello world');
    });

    it('does not set isError when result is a string', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 'text' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.isError).toBeUndefined();
    });

    it('returns an empty string unchanged when result is an empty string', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: '' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('');
    });

    it('returns a multi-line string unchanged', async () => {
      const text = 'line1\nline2\nline3';
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: text });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe(text);
    });
  });

  describe('success path — non-string result is JSON.stringified', () => {
    it('stringifies an object result with 2-space indent', async () => {
      const obj = { key: 'value', count: 42 };
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: obj });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe(JSON.stringify(obj, null, 2));
    });

    it('stringifies a number result', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 123 });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('123');
    });

    it('stringifies zero correctly', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 0 });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('0');
    });

    it('stringifies a boolean true result', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: true });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('true');
    });

    it('stringifies a boolean false result', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: false });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('false');
    });

    it('stringifies an array result', async () => {
      const arr = [1, 2, 3];
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: arr });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe(JSON.stringify(arr, null, 2));
    });

    it('stringifies null result as the string "null"', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: null });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('null');
    });

    it('stringifies a nested object result', async () => {
      const nested = { a: { b: { c: [1, 2] } } };
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: nested });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe(JSON.stringify(nested, null, 2));
    });

    it('produces undefined as content when result is undefined (JSON.stringify(undefined))', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      // JSON.stringify(undefined) returns undefined (not the string "undefined")
      expect(out.content).toBeUndefined();
    });

    it('does not set isError on success with object result', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: { data: [] } });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.isError).toBeUndefined();
    });
  });

  describe('error path', () => {
    it('sets isError true when success is false', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: false, error: 'Not found' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.isError).toBe(true);
    });

    it('uses the error message from the gateway when provided', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: false, error: 'Not found' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('Not found');
    });

    it('falls back to "Unknown error" when error field is absent', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: false });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('Unknown error');
    });

    it('returns the empty string as-is because ?? only guards against null/undefined', async () => {
      // The source uses `result.error ?? 'Unknown error'`.
      // The nullish coalescing operator (??) only falls back for null/undefined —
      // an empty string is neither, so the empty string is preserved as content.
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: false, error: '' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe('');
      expect(out.isError).toBe(true);
    });

    it('preserves a detailed multi-line error message', async () => {
      const msg = 'Validation failed:\n - field "x" required\n - field "y" must be string';
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: false, error: msg });
      const [tool] = createMemoryToolProvider('u1').getTools();
      const out = await tool!.executor({});
      expect(out.content).toBe(msg);
    });
  });

  describe('executor call forwarding', () => {
    it('forwards the correct toolName from the ToolDefinition to the gateway executor', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 'ok' });
      const [tool] = createMemoryToolProvider('u1').getTools();
      await tool!.executor({ content: 'test' });
      expect(mocks.executeMemoryTool).toHaveBeenCalledWith(
        mocks.memoryToolDef1.name,
        expect.anything(),
        expect.anything()
      );
    });

    it('forwards a different toolName for the second tool in the provider', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: 'ok' });
      const tools = createMemoryToolProvider('u1').getTools();
      await tools[1]!.executor({ query: 'foo' });
      expect(mocks.executeMemoryTool).toHaveBeenCalledWith(
        mocks.memoryToolDef2.name,
        expect.anything(),
        expect.anything()
      );
    });

    it('forwards the args Record to the gateway executor', async () => {
      const args = { content: 'my memory', type: 'fact', importance: 0.8 };
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: {} });
      const [tool] = createMemoryToolProvider('u1').getTools();
      await tool!.executor(args);
      expect(mocks.executeMemoryTool).toHaveBeenCalledWith(
        expect.any(String),
        args,
        expect.anything()
      );
    });

    it('passes an empty args object to the gateway executor', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: {} });
      const [tool] = createMemoryToolProvider('u1').getTools();
      await tool!.executor({});
      expect(mocks.executeMemoryTool).toHaveBeenCalledWith(
        expect.any(String),
        {},
        expect.anything()
      );
    });

    it('passes userId to the gateway executor when provided', async () => {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: {} });
      const [tool] = createMemoryToolProvider('user-42').getTools();
      await tool!.executor({});
      expect(mocks.executeMemoryTool).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        'user-42'
      );
    });

    it('passes undefined userId when the provider factory receives no userId', async () => {
      mocks.executeCustomDataTool.mockResolvedValueOnce({ success: true, result: {} });
      const [tool] = createCustomDataToolProvider().getTools();
      await tool!.executor({});
      expect(mocks.executeCustomDataTool).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        undefined
      );
    });

    it('executor is async and returns a Promise', () => {
      const [tool] = createMemoryToolProvider('u1').getTools();
      const result = tool!.executor({});
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

// ===========================================================================
// 2. createMemoryToolProvider
// ===========================================================================

describe('createMemoryToolProvider', () => {
  it('returns a provider with name "memory"', () => {
    expect(createMemoryToolProvider('u1').name).toBe('memory');
  });

  it('getTools returns the same number of entries as MEMORY_TOOLS', () => {
    const tools = createMemoryToolProvider('u1').getTools();
    expect(tools).toHaveLength(mocks.MEMORY_TOOLS.length);
  });

  it('each entry has a definition property', () => {
    const tools = createMemoryToolProvider('u1').getTools();
    for (const tool of tools) {
      expect(tool).toHaveProperty('definition');
    }
  });

  it('each entry has an executor function', () => {
    const tools = createMemoryToolProvider('u1').getTools();
    for (const tool of tools) {
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('first tool definition matches first MEMORY_TOOL definition', () => {
    const tools = createMemoryToolProvider('u1').getTools();
    expect(tools[0]!.definition).toBe(mocks.memoryToolDef1);
  });

  it('second tool definition matches second MEMORY_TOOL definition', () => {
    const tools = createMemoryToolProvider('u1').getTools();
    expect(tools[1]!.definition).toBe(mocks.memoryToolDef2);
  });

  it('calls executeMemoryTool when executor is invoked', async () => {
    const [tool] = createMemoryToolProvider('u1').getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).toHaveBeenCalledTimes(1);
  });

  it('does not call any other executor when memory tool executor runs', async () => {
    const [tool] = createMemoryToolProvider('u1').getTools();
    await tool!.executor({});
    expect(mocks.executeGoalTool).not.toHaveBeenCalled();
    expect(mocks.executeCustomDataTool).not.toHaveBeenCalled();
    expect(mocks.executePersonalDataTool).not.toHaveBeenCalled();
    expect(mocks.executeTriggerTool).not.toHaveBeenCalled();
    expect(mocks.executePlanTool).not.toHaveBeenCalled();
  });

  it('passes the userId from the factory argument to every tool executor', async () => {
    const userId = 'user-abc';
    const tools = createMemoryToolProvider(userId).getTools();
    for (const tool of tools) {
      mocks.executeMemoryTool.mockResolvedValueOnce({ success: true, result: {} });
      await tool.executor({});
    }
    const calls = mocks.executeMemoryTool.mock.calls;
    for (const call of calls) {
      expect(call[2]).toBe(userId);
    }
  });

  it('different userId values are captured independently per provider instance', async () => {
    mocks.executeMemoryTool
      .mockResolvedValueOnce({ success: true, result: {} })
      .mockResolvedValueOnce({ success: true, result: {} });

    const [toolA] = createMemoryToolProvider('user-A').getTools();
    const [toolB] = createMemoryToolProvider('user-B').getTools();

    await toolA!.executor({});
    await toolB!.executor({});

    expect(mocks.executeMemoryTool.mock.calls[0]![2]).toBe('user-A');
    expect(mocks.executeMemoryTool.mock.calls[1]![2]).toBe('user-B');
  });

  it('multiple calls to getTools() each return a fresh array', () => {
    const provider = createMemoryToolProvider('u1');
    const first = provider.getTools();
    const second = provider.getTools();
    expect(first).not.toBe(second);
  });

  it('each getTools() call produces the same number of tools', () => {
    const provider = createMemoryToolProvider('u1');
    expect(provider.getTools()).toHaveLength(provider.getTools().length);
  });
});

// ===========================================================================
// 3. createGoalToolProvider
// ===========================================================================

describe('createGoalToolProvider', () => {
  it('returns a provider with name "goal"', () => {
    expect(createGoalToolProvider('u1').name).toBe('goal');
  });

  it('getTools returns the same number of entries as GOAL_TOOLS', () => {
    expect(createGoalToolProvider('u1').getTools()).toHaveLength(mocks.GOAL_TOOLS.length);
  });

  it('first tool definition matches first GOAL_TOOL definition', () => {
    const [first] = createGoalToolProvider('u1').getTools();
    expect(first!.definition).toBe(mocks.goalToolDef1);
  });

  it('second tool definition matches second GOAL_TOOL definition', () => {
    const tools = createGoalToolProvider('u1').getTools();
    expect(tools[1]!.definition).toBe(mocks.goalToolDef2);
  });

  it('executor calls executeGoalTool', async () => {
    const [tool] = createGoalToolProvider('u1').getTools();
    await tool!.executor({});
    expect(mocks.executeGoalTool).toHaveBeenCalledTimes(1);
  });

  it('passes userId to executeGoalTool', async () => {
    const [tool] = createGoalToolProvider('goal-user').getTools();
    await tool!.executor({});
    expect(mocks.executeGoalTool).toHaveBeenCalledWith(mocks.goalToolDef1.name, {}, 'goal-user');
  });

  it('does not call any other executor', async () => {
    const [tool] = createGoalToolProvider('u1').getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).not.toHaveBeenCalled();
    expect(mocks.executeCustomDataTool).not.toHaveBeenCalled();
  });

  it('returns isError true on goal executor failure', async () => {
    mocks.executeGoalTool.mockResolvedValueOnce({ success: false, error: 'goal error' });
    const [tool] = createGoalToolProvider('u1').getTools();
    const out = await tool!.executor({});
    expect(out.isError).toBe(true);
    expect(out.content).toBe('goal error');
  });

  it('multiple calls to getTools() return fresh arrays', () => {
    const provider = createGoalToolProvider('u1');
    expect(provider.getTools()).not.toBe(provider.getTools());
  });
});

// ===========================================================================
// 4. createCustomDataToolProvider
// ===========================================================================

describe('createCustomDataToolProvider', () => {
  it('returns a provider with name "custom-data"', () => {
    expect(createCustomDataToolProvider().name).toBe('custom-data');
  });

  it('getTools returns the same number of entries as CUSTOM_DATA_TOOLS', () => {
    expect(createCustomDataToolProvider().getTools()).toHaveLength(mocks.CUSTOM_DATA_TOOLS.length);
  });

  it('tool definition matches the CUSTOM_DATA_TOOL definition', () => {
    const [tool] = createCustomDataToolProvider().getTools();
    expect(tool!.definition).toBe(mocks.customDataToolDef);
  });

  it('executor calls executeCustomDataTool', async () => {
    const [tool] = createCustomDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeCustomDataTool).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as userId since factory has no userId param', async () => {
    const [tool] = createCustomDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeCustomDataTool).toHaveBeenCalledWith(
      mocks.customDataToolDef.name,
      {},
      undefined
    );
  });

  it('does not call executeMemoryTool', async () => {
    const [tool] = createCustomDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).not.toHaveBeenCalled();
  });

  it('returns isError true when executeCustomDataTool fails', async () => {
    mocks.executeCustomDataTool.mockResolvedValueOnce({ success: false, error: 'db error' });
    const [tool] = createCustomDataToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.isError).toBe(true);
    expect(out.content).toBe('db error');
  });

  it('returns "Unknown error" when executeCustomDataTool fails with no message', async () => {
    mocks.executeCustomDataTool.mockResolvedValueOnce({ success: false });
    const [tool] = createCustomDataToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe('Unknown error');
  });

  it('multiple calls to getTools() return fresh arrays', () => {
    const provider = createCustomDataToolProvider();
    expect(provider.getTools()).not.toBe(provider.getTools());
  });
});

// ===========================================================================
// 5. createPersonalDataToolProvider
// ===========================================================================

describe('createPersonalDataToolProvider', () => {
  it('returns a provider with name "personal-data"', () => {
    expect(createPersonalDataToolProvider().name).toBe('personal-data');
  });

  it('getTools returns the same number of entries as PERSONAL_DATA_TOOLS', () => {
    expect(createPersonalDataToolProvider().getTools()).toHaveLength(
      mocks.PERSONAL_DATA_TOOLS.length
    );
  });

  it('tool definition matches the PERSONAL_DATA_TOOL definition', () => {
    const [tool] = createPersonalDataToolProvider().getTools();
    expect(tool!.definition).toBe(mocks.personalDataToolDef);
  });

  it('executor calls executePersonalDataTool', async () => {
    const [tool] = createPersonalDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executePersonalDataTool).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as userId since factory has no userId param', async () => {
    const [tool] = createPersonalDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executePersonalDataTool).toHaveBeenCalledWith(
      mocks.personalDataToolDef.name,
      {},
      undefined
    );
  });

  it('does not call executeMemoryTool', async () => {
    const [tool] = createPersonalDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).not.toHaveBeenCalled();
  });

  it('does not call executeGoalTool', async () => {
    const [tool] = createPersonalDataToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeGoalTool).not.toHaveBeenCalled();
  });

  it('returns isError true when executePersonalDataTool fails', async () => {
    mocks.executePersonalDataTool.mockResolvedValueOnce({ success: false, error: 'not found' });
    const [tool] = createPersonalDataToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.isError).toBe(true);
    expect(out.content).toBe('not found');
  });

  it('returns "Unknown error" when failure has no error field', async () => {
    mocks.executePersonalDataTool.mockResolvedValueOnce({ success: false });
    const [tool] = createPersonalDataToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe('Unknown error');
  });

  it('forwards args to executePersonalDataTool', async () => {
    const args = { name: 'Buy groceries', due: '2026-03-01' };
    const [tool] = createPersonalDataToolProvider().getTools();
    await tool!.executor(args);
    expect(mocks.executePersonalDataTool).toHaveBeenCalledWith(expect.any(String), args, undefined);
  });

  it('multiple calls to getTools() return fresh arrays', () => {
    const provider = createPersonalDataToolProvider();
    expect(provider.getTools()).not.toBe(provider.getTools());
  });
});

// ===========================================================================
// 6. createTriggerToolProvider
// ===========================================================================

describe('createTriggerToolProvider', () => {
  it('returns a provider with name "trigger"', () => {
    expect(createTriggerToolProvider().name).toBe('trigger');
  });

  it('getTools returns the same number of entries as TRIGGER_TOOLS', () => {
    expect(createTriggerToolProvider().getTools()).toHaveLength(mocks.TRIGGER_TOOLS.length);
  });

  it('first tool definition matches first TRIGGER_TOOL definition', () => {
    const [first] = createTriggerToolProvider().getTools();
    expect(first!.definition).toBe(mocks.triggerToolDef1);
  });

  it('second tool definition matches second TRIGGER_TOOL definition', () => {
    const tools = createTriggerToolProvider().getTools();
    expect(tools[1]!.definition).toBe(mocks.triggerToolDef2);
  });

  it('executor calls executeTriggerTool', async () => {
    const [tool] = createTriggerToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeTriggerTool).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as userId since factory has no userId param', async () => {
    const [tool] = createTriggerToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeTriggerTool).toHaveBeenCalledWith(
      mocks.triggerToolDef1.name,
      {},
      undefined
    );
  });

  it('does not call executeMemoryTool, executeGoalTool, etc.', async () => {
    const [tool] = createTriggerToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).not.toHaveBeenCalled();
    expect(mocks.executeGoalTool).not.toHaveBeenCalled();
    expect(mocks.executeCustomDataTool).not.toHaveBeenCalled();
    expect(mocks.executePersonalDataTool).not.toHaveBeenCalled();
    expect(mocks.executePlanTool).not.toHaveBeenCalled();
  });

  it('returns JSON-stringified object result on success', async () => {
    const data = { triggerId: 'abc', status: 'created' };
    mocks.executeTriggerTool.mockResolvedValueOnce({ success: true, result: data });
    const [tool] = createTriggerToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe(JSON.stringify(data, null, 2));
  });

  it('returns isError true on trigger executor failure', async () => {
    mocks.executeTriggerTool.mockResolvedValueOnce({ success: false, error: 'trigger error' });
    const [tool] = createTriggerToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.isError).toBe(true);
    expect(out.content).toBe('trigger error');
  });

  it('uses correct toolName for the second trigger tool', async () => {
    const tools = createTriggerToolProvider().getTools();
    await tools[1]!.executor({});
    // The third argument is undefined (no userId) — expect.anything() does not match undefined
    // so we assert the toolName directly via the first call argument.
    const [calledName] = mocks.executeTriggerTool.mock.calls[0]!;
    expect(calledName).toBe(mocks.triggerToolDef2.name);
  });

  it('multiple calls to getTools() return fresh arrays', () => {
    const provider = createTriggerToolProvider();
    expect(provider.getTools()).not.toBe(provider.getTools());
  });
});

// ===========================================================================
// 7. createPlanToolProvider
// ===========================================================================

describe('createPlanToolProvider', () => {
  it('returns a provider with name "plan"', () => {
    expect(createPlanToolProvider().name).toBe('plan');
  });

  it('getTools returns the same number of entries as PLAN_TOOLS', () => {
    expect(createPlanToolProvider().getTools()).toHaveLength(mocks.PLAN_TOOLS.length);
  });

  it('first tool definition matches first PLAN_TOOL definition', () => {
    const [first] = createPlanToolProvider().getTools();
    expect(first!.definition).toBe(mocks.planToolDef1);
  });

  it('second tool definition matches second PLAN_TOOL definition', () => {
    const tools = createPlanToolProvider().getTools();
    expect(tools[1]!.definition).toBe(mocks.planToolDef2);
  });

  it('executor calls executePlanTool', async () => {
    const [tool] = createPlanToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executePlanTool).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as userId since factory has no userId param', async () => {
    const [tool] = createPlanToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executePlanTool).toHaveBeenCalledWith(mocks.planToolDef1.name, {}, undefined);
  });

  it('does not call executeMemoryTool, executeTriggerTool, etc.', async () => {
    const [tool] = createPlanToolProvider().getTools();
    await tool!.executor({});
    expect(mocks.executeMemoryTool).not.toHaveBeenCalled();
    expect(mocks.executeGoalTool).not.toHaveBeenCalled();
    expect(mocks.executeCustomDataTool).not.toHaveBeenCalled();
    expect(mocks.executePersonalDataTool).not.toHaveBeenCalled();
    expect(mocks.executeTriggerTool).not.toHaveBeenCalled();
  });

  it('returns JSON-stringified object result on success', async () => {
    const data = { planId: 'xyz', steps: ['step1', 'step2'] };
    mocks.executePlanTool.mockResolvedValueOnce({ success: true, result: data });
    const [tool] = createPlanToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe(JSON.stringify(data, null, 2));
  });

  it('returns string result directly on success', async () => {
    mocks.executePlanTool.mockResolvedValueOnce({ success: true, result: 'Plan created.' });
    const [tool] = createPlanToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe('Plan created.');
  });

  it('returns isError true on plan executor failure', async () => {
    mocks.executePlanTool.mockResolvedValueOnce({ success: false, error: 'plan error' });
    const [tool] = createPlanToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.isError).toBe(true);
    expect(out.content).toBe('plan error');
  });

  it('returns "Unknown error" when plan failure has no message', async () => {
    mocks.executePlanTool.mockResolvedValueOnce({ success: false });
    const [tool] = createPlanToolProvider().getTools();
    const out = await tool!.executor({});
    expect(out.content).toBe('Unknown error');
  });

  it('uses correct toolName for the second plan tool', async () => {
    const tools = createPlanToolProvider().getTools();
    await tools[1]!.executor({});
    // The third argument is undefined (no userId) — expect.anything() does not match undefined
    // so we assert the toolName directly via the first call argument.
    const [calledName] = mocks.executePlanTool.mock.calls[0]!;
    expect(calledName).toBe(mocks.planToolDef2.name);
  });

  it('multiple calls to getTools() return fresh arrays', () => {
    const provider = createPlanToolProvider();
    expect(provider.getTools()).not.toBe(provider.getTools());
  });
});

// ===========================================================================
// 8. Edge cases and cross-provider isolation
// ===========================================================================

describe('cross-provider isolation', () => {
  it('invoking memory executor does not pollute goal mock call count', async () => {
    const [memTool] = createMemoryToolProvider('u1').getTools();
    await memTool!.executor({});
    expect(mocks.executeGoalTool).toHaveBeenCalledTimes(0);
  });

  it('two separate providers can each be invoked without interfering', async () => {
    const [memTool] = createMemoryToolProvider('u1').getTools();
    const [goalTool] = createGoalToolProvider('u2').getTools();

    await memTool!.executor({});
    await goalTool!.executor({});

    expect(mocks.executeMemoryTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeGoalTool).toHaveBeenCalledTimes(1);
  });

  it('creating two memory providers with different userIds each pass their own userId', async () => {
    mocks.executeMemoryTool
      .mockResolvedValueOnce({ success: true, result: {} })
      .mockResolvedValueOnce({ success: true, result: {} });

    const [toolX] = createMemoryToolProvider('x').getTools();
    const [toolY] = createMemoryToolProvider('y').getTools();

    await toolX!.executor({});
    await toolY!.executor({});

    expect(mocks.executeMemoryTool.mock.calls[0]![2]).toBe('x');
    expect(mocks.executeMemoryTool.mock.calls[1]![2]).toBe('y');
  });

  it('all nine providers have distinct names', () => {
    const names = [
      createMemoryToolProvider('u').name,
      createGoalToolProvider('u').name,
      createCustomDataToolProvider().name,
      createPersonalDataToolProvider().name,
      createTriggerToolProvider().name,
      createPlanToolProvider().name,
      createConfigToolProvider().name,
      createHeartbeatToolProvider('u').name,
      createExtensionToolProvider('u').name,
    ];
    const unique = new Set(names);
    expect(unique.size).toBe(9);
  });

  it('all nine getTools() results are non-empty arrays', () => {
    const allTools = [
      createMemoryToolProvider('u').getTools(),
      createGoalToolProvider('u').getTools(),
      createCustomDataToolProvider().getTools(),
      createPersonalDataToolProvider().getTools(),
      createTriggerToolProvider().getTools(),
      createPlanToolProvider().getTools(),
      createConfigToolProvider().getTools(),
      createHeartbeatToolProvider('u').getTools(),
      createExtensionToolProvider('u').getTools(),
    ];
    for (const tools of allTools) {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it('each tool entry across all providers has both definition and executor', () => {
    const allTools = [
      ...createMemoryToolProvider('u').getTools(),
      ...createGoalToolProvider('u').getTools(),
      ...createCustomDataToolProvider().getTools(),
      ...createPersonalDataToolProvider().getTools(),
      ...createTriggerToolProvider().getTools(),
      ...createPlanToolProvider().getTools(),
      ...createConfigToolProvider().getTools(),
      ...createHeartbeatToolProvider('u').getTools(),
      ...createExtensionToolProvider('u').getTools(),
    ];
    for (const tool of allTools) {
      expect(tool).toHaveProperty('definition');
      expect(tool).toHaveProperty('executor');
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('all definition objects have a name and description string', () => {
    const allTools = [
      ...createMemoryToolProvider('u').getTools(),
      ...createGoalToolProvider('u').getTools(),
      ...createCustomDataToolProvider().getTools(),
      ...createPersonalDataToolProvider().getTools(),
      ...createTriggerToolProvider().getTools(),
      ...createPlanToolProvider().getTools(),
      ...createConfigToolProvider().getTools(),
      ...createHeartbeatToolProvider('u').getTools(),
      ...createExtensionToolProvider('u').getTools(),
    ];
    for (const tool of allTools) {
      expect(typeof tool.definition.name).toBe('string');
      expect(tool.definition.name.length).toBeGreaterThan(0);
      expect(typeof tool.definition.description).toBe('string');
    }
  });

  it('vi.clearAllMocks() in beforeEach resets mock call counts between tests', () => {
    // This test verifies test isolation: executeMemoryTool should have 0 calls
    // at the start of every test (beforeEach clears mocks).
    expect(mocks.executeMemoryTool).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// 9. Async behaviour
// ===========================================================================

describe('async executor behaviour', () => {
  it('resolves even when executor is awaited and success is true', async () => {
    mocks.executePlanTool.mockResolvedValueOnce({ success: true, result: 'done' });
    const [tool] = createPlanToolProvider().getTools();
    await expect(tool!.executor({})).resolves.toMatchObject({ content: 'done' });
  });

  it('resolves (not rejects) when the gateway signals a logical failure', async () => {
    mocks.executeTriggerTool.mockResolvedValueOnce({ success: false, error: 'oops' });
    const [tool] = createTriggerToolProvider().getTools();
    // wrapGatewayExecutor always resolves — it maps errors to { content, isError } rather than rejecting
    await expect(tool!.executor({})).resolves.toMatchObject({ isError: true, content: 'oops' });
  });

  it('catches executor rejection and returns structured error', async () => {
    mocks.executeMemoryTool.mockRejectedValueOnce(new Error('network failure'));
    const [tool] = createMemoryToolProvider('u1').getTools();
    await expect(tool!.executor({})).resolves.toMatchObject({
      isError: true,
      content: 'network failure',
    });
  });

  it('handles concurrent executor calls without cross-contamination', async () => {
    mocks.executeMemoryTool
      .mockResolvedValueOnce({ success: true, result: 'first' })
      .mockResolvedValueOnce({ success: true, result: 'second' });

    const tools = createMemoryToolProvider('u1').getTools();
    const [resultA, resultB] = await Promise.all([
      tools[0]!.executor({ id: 'a' }),
      tools[0]!.executor({ id: 'b' }),
    ]);

    expect(resultA.content).toBe('first');
    expect(resultB.content).toBe('second');
  });

  it('multiple sequential executor invocations each call the gateway', async () => {
    mocks.executeGoalTool
      .mockResolvedValueOnce({ success: true, result: 'r1' })
      .mockResolvedValueOnce({ success: true, result: 'r2' })
      .mockResolvedValueOnce({ success: true, result: 'r3' });

    const [tool] = createGoalToolProvider('u1').getTools();
    await tool!.executor({});
    await tool!.executor({});
    await tool!.executor({});

    expect(mocks.executeGoalTool).toHaveBeenCalledTimes(3);
  });
});
