import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateBody,
  createAgentSchema,
  updateAgentSchema,
  chatMessageSchema,
  createTriggerSchema,
  createPlanSchema,
  updatePlanSchema,
  createPlanStepSchema,
  autonomyConfigSchema,
  autonomyLevelSchema,
  autonomyBudgetSchema,
  createCustomToolSchema,
  updateCustomToolSchema,
  autonomyDecisionSchema,
  autonomyApproveRejectSchema,
  createGoalSchema,
  updateGoalSchema,
  createGoalStepSchema,
  createGoalStepsSchema,
  updateGoalStepSchema,
  createMemorySchema,
  updateMemorySchema,
  boostMemorySchema,
  decayMemoriesSchema,
  cleanupMemoriesSchema,
  createExpenseSchema,
  updateExpenseSchema,
  mediaSettingsSchema,
  createCustomTableSchema,
  updateCustomTableSchema,
  createCustomRecordSchema,
  updateCustomRecordSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  autonomyToolPermissionSchema,
  autonomyAssessSchema,
  autonomyApprovalRequestSchema,
  completeGoalStepSchema,
} from './validation.js';

// ─── validateBody Helper ──────────────────────────────────────────

describe('validateBody', () => {
  const simpleSchema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  });

  it('returns parsed data for valid input', () => {
    const result = validateBody(simpleSchema, { name: 'Alice', age: 30 });
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('throws Error with descriptive message for invalid input', () => {
    expect(() => validateBody(simpleSchema, { name: '', age: -1 })).toThrow(Error);
    expect(() => validateBody(simpleSchema, { name: '', age: -1 })).toThrow('Validation failed');
  });

  it('message includes field path and Zod issue description', () => {
    try {
      validateBody(simpleSchema, { name: '', age: -1 });
      expect.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('name');
      expect(message).toContain('age');
    }
  });

  it('message includes nested field paths with dot notation', () => {
    const nested = z.object({ config: z.object({ level: z.number().min(0) }) });
    try {
      validateBody(nested, { config: { level: -1 } });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('config.level');
    }
  });

  it('throws for completely wrong types', () => {
    expect(() => validateBody(simpleSchema, null)).toThrow('Validation failed');
    expect(() => validateBody(simpleSchema, 'string')).toThrow('Validation failed');
    expect(() => validateBody(simpleSchema, 42)).toThrow('Validation failed');
  });
});

// ─── Agent Schemas ────────────────────────────────────────────────

describe('createAgentSchema', () => {
  const validAgent = {
    name: 'My Agent',
    systemPrompt: 'You are a helpful assistant.',
  };

  it('accepts valid agent with required fields only', () => {
    const result = createAgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('accepts valid agent with all optional fields', () => {
    const full = {
      ...validAgent,
      provider: 'openai',
      model: 'gpt-4',
      maxTokens: 4096,
      temperature: 0.7,
      maxTurns: 10,
      maxToolCalls: 50,
      category: 'general',
      description: 'A test agent',
      tools: ['tool_a', 'tool_b'],
      toolGroups: ['group_a'],
      isDefault: true,
    };
    const result = createAgentSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 characters', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts name at exactly 100 characters', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, name: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('rejects empty systemPrompt', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, systemPrompt: '' });
    expect(result.success).toBe(false);
  });

  it('rejects systemPrompt over 50000 characters', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, systemPrompt: 'x'.repeat(50001) });
    expect(result.success).toBe(false);
  });

  it('accepts systemPrompt at exactly 50000 characters', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, systemPrompt: 'x'.repeat(50000) });
    expect(result.success).toBe(true);
  });

  it('rejects maxTokens over 128000', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, maxTokens: 128001 });
    expect(result.success).toBe(false);
  });

  it('rejects maxTokens of 0', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, maxTokens: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxTokens', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, maxTokens: 100.5 });
    expect(result.success).toBe(false);
  });

  it('rejects temperature over 2', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, temperature: 2.1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative temperature', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, temperature: -0.1 });
    expect(result.success).toBe(false);
  });

  it('accepts temperature at boundaries 0 and 2', () => {
    expect(createAgentSchema.safeParse({ ...validAgent, temperature: 0 }).success).toBe(true);
    expect(createAgentSchema.safeParse({ ...validAgent, temperature: 2 }).success).toBe(true);
  });

  it('allows extra fields via passthrough', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, customField: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customField).toBe('hello');
    }
  });

  it('rejects tools array with strings over 100 chars', () => {
    const result = createAgentSchema.safeParse({ ...validAgent, tools: ['a'.repeat(101)] });
    expect(result.success).toBe(false);
  });

  it('rejects tools array over 200 items', () => {
    const result = createAgentSchema.safeParse({
      ...validAgent,
      tools: Array.from({ length: 201 }, (_, i) => `tool_${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('updateAgentSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateAgentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with only name', () => {
    const result = updateAgentSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('still validates constraints on provided fields', () => {
    const result = updateAgentSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('still rejects maxTokens over 128000', () => {
    const result = updateAgentSchema.safeParse({ maxTokens: 200000 });
    expect(result.success).toBe(false);
  });
});

// ─── Chat Schemas ─────────────────────────────────────────────────

describe('chatMessageSchema', () => {
  it('accepts minimal message', () => {
    const result = chatMessageSchema.safeParse({ message: 'Hello' });
    expect(result.success).toBe(true);
  });

  it('accepts full message with all optional fields', () => {
    const result = chatMessageSchema.safeParse({
      message: 'Hello',
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-4',
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      directTools: ['tool_a'],
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'system', content: 'You are helpful.' },
        { role: 'tool', content: 'result data' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = chatMessageSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects message over 100000 characters', () => {
    const result = chatMessageSchema.safeParse({ message: 'm'.repeat(100001) });
    expect(result.success).toBe(false);
  });

  it('accepts message at exactly 100000 characters', () => {
    const result = chatMessageSchema.safeParse({ message: 'm'.repeat(100000) });
    expect(result.success).toBe(true);
  });

  it('rejects history with invalid role', () => {
    const result = chatMessageSchema.safeParse({
      message: 'Hello',
      history: [{ role: 'admin', content: 'test' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects history entry missing content', () => {
    const result = chatMessageSchema.safeParse({
      message: 'Hello',
      history: [{ role: 'user' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows extra fields on history entries via passthrough', () => {
    const result = chatMessageSchema.safeParse({
      message: 'Hello',
      history: [{ role: 'user', content: 'Hi', toolCallId: 'tc-1' }],
    });
    expect(result.success).toBe(true);
  });
});

// ─── Trigger Schemas ──────────────────────────────────────────────

describe('createTriggerSchema', () => {
  const validTrigger = {
    name: 'Daily Backup',
    type: 'schedule' as const,
    config: { cron: '0 0 * * *' },
    action: { type: 'backup' },
  };

  it('accepts valid schedule trigger', () => {
    const result = createTriggerSchema.safeParse(validTrigger);
    expect(result.success).toBe(true);
  });

  it('accepts all valid type values', () => {
    for (const type of ['schedule', 'event', 'condition', 'webhook'] as const) {
      const result = createTriggerSchema.safeParse({ ...validTrigger, type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing name', () => {
    const { name: _, ...noName } = validTrigger;
    const result = createTriggerSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createTriggerSchema.safeParse({ ...validTrigger, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 characters', () => {
    const result = createTriggerSchema.safeParse({ ...validTrigger, name: 'n'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type enum value', () => {
    const result = createTriggerSchema.safeParse({ ...validTrigger, type: 'cron' });
    expect(result.success).toBe(false);
  });

  it('rejects missing config', () => {
    const { config: _, ...noConfig } = validTrigger;
    const result = createTriggerSchema.safeParse(noConfig);
    expect(result.success).toBe(false);
  });

  it('rejects missing action', () => {
    const { action: _, ...noAction } = validTrigger;
    const result = createTriggerSchema.safeParse(noAction);
    expect(result.success).toBe(false);
  });
});

// ─── Plan Schemas ─────────────────────────────────────────────────

describe('createPlanSchema', () => {
  const validPlan = {
    name: 'Release v2',
    goal: 'Ship version 2 to production',
  };

  it('accepts minimal plan', () => {
    const result = createPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it('accepts plan with all optional fields', () => {
    const result = createPlanSchema.safeParse({
      ...validPlan,
      description: 'Full release plan',
      deadline: '2025-12-31',
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty goal', () => {
    const result = createPlanSchema.safeParse({ ...validPlan, goal: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createPlanSchema.safeParse({ ...validPlan, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority enum value', () => {
    const result = createPlanSchema.safeParse({ ...validPlan, priority: 'urgent' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid priority values', () => {
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      expect(createPlanSchema.safeParse({ ...validPlan, priority }).success).toBe(true);
    }
  });
});

describe('updatePlanSchema', () => {
  it('accepts empty object', () => {
    expect(updatePlanSchema.safeParse({}).success).toBe(true);
  });

  it('accepts status field not available on create', () => {
    const result = updatePlanSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status value', () => {
    const result = updatePlanSchema.safeParse({ status: 'archived' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const) {
      expect(updatePlanSchema.safeParse({ status }).success).toBe(true);
    }
  });
});

describe('createPlanStepSchema', () => {
  const validStep = {
    name: 'Deploy backend',
    type: 'tool_call' as const,
    orderNum: 0,
  };

  it('accepts valid step', () => {
    expect(createPlanStepSchema.safeParse(validStep).success).toBe(true);
  });

  it('accepts all valid type values', () => {
    const types = ['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan'] as const;
    for (const type of types) {
      expect(createPlanStepSchema.safeParse({ ...validStep, type }).success).toBe(true);
    }
  });

  it('rejects invalid type enum', () => {
    expect(createPlanStepSchema.safeParse({ ...validStep, type: 'api_call' }).success).toBe(false);
  });

  it('rejects orderNum over 1000', () => {
    expect(createPlanStepSchema.safeParse({ ...validStep, orderNum: 1001 }).success).toBe(false);
  });

  it('accepts orderNum at boundaries 0 and 1000', () => {
    expect(createPlanStepSchema.safeParse({ ...validStep, orderNum: 0 }).success).toBe(true);
    expect(createPlanStepSchema.safeParse({ ...validStep, orderNum: 1000 }).success).toBe(true);
  });

  it('rejects negative orderNum', () => {
    expect(createPlanStepSchema.safeParse({ ...validStep, orderNum: -1 }).success).toBe(false);
  });

  it('rejects non-integer orderNum', () => {
    expect(createPlanStepSchema.safeParse({ ...validStep, orderNum: 1.5 }).success).toBe(false);
  });
});

// ─── Autonomy Schemas ─────────────────────────────────────────────

describe('autonomyConfigSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(autonomyConfigSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full config', () => {
    const result = autonomyConfigSchema.safeParse({
      level: 3,
      allowedTools: ['web_search'],
      blockedTools: ['shell_exec'],
      requireApproval: true,
      maxCostPerAction: 5.0,
      dailyBudget: 50.0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects level 6', () => {
    expect(autonomyConfigSchema.safeParse({ level: 6 }).success).toBe(false);
  });

  it('rejects level -1', () => {
    expect(autonomyConfigSchema.safeParse({ level: -1 }).success).toBe(false);
  });

  it('accepts level at boundaries 0 and 5', () => {
    expect(autonomyConfigSchema.safeParse({ level: 0 }).success).toBe(true);
    expect(autonomyConfigSchema.safeParse({ level: 5 }).success).toBe(true);
  });

  it('rejects non-integer level', () => {
    expect(autonomyConfigSchema.safeParse({ level: 2.5 }).success).toBe(false);
  });

  it('rejects maxCostPerAction over 1000', () => {
    expect(autonomyConfigSchema.safeParse({ maxCostPerAction: 1001 }).success).toBe(false);
  });

  it('accepts maxCostPerAction at 1000', () => {
    expect(autonomyConfigSchema.safeParse({ maxCostPerAction: 1000 }).success).toBe(true);
  });

  it('rejects negative maxCostPerAction', () => {
    expect(autonomyConfigSchema.safeParse({ maxCostPerAction: -1 }).success).toBe(false);
  });

  it('rejects dailyBudget over 10000', () => {
    expect(autonomyConfigSchema.safeParse({ dailyBudget: 10001 }).success).toBe(false);
  });

  it('accepts dailyBudget at 10000', () => {
    expect(autonomyConfigSchema.safeParse({ dailyBudget: 10000 }).success).toBe(true);
  });

  it('allows extra fields via passthrough', () => {
    const result = autonomyConfigSchema.safeParse({ customSetting: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customSetting).toBe(true);
    }
  });
});

describe('autonomyLevelSchema', () => {
  it('accepts valid level', () => {
    expect(autonomyLevelSchema.safeParse({ level: 3 }).success).toBe(true);
  });

  it('rejects level 6', () => {
    expect(autonomyLevelSchema.safeParse({ level: 6 }).success).toBe(false);
  });

  it('rejects level -1', () => {
    expect(autonomyLevelSchema.safeParse({ level: -1 }).success).toBe(false);
  });

  it('rejects missing level', () => {
    expect(autonomyLevelSchema.safeParse({}).success).toBe(false);
  });
});

describe('autonomyBudgetSchema', () => {
  it('accepts empty object', () => {
    expect(autonomyBudgetSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid budget values', () => {
    expect(autonomyBudgetSchema.safeParse({ dailyBudget: 100, maxCostPerAction: 10 }).success).toBe(true);
  });

  it('rejects dailyBudget over 10000', () => {
    expect(autonomyBudgetSchema.safeParse({ dailyBudget: 10001 }).success).toBe(false);
  });

  it('rejects maxCostPerAction over 1000', () => {
    expect(autonomyBudgetSchema.safeParse({ maxCostPerAction: 1001 }).success).toBe(false);
  });
});

// ─── Custom Tool Schemas ──────────────────────────────────────────

describe('createCustomToolSchema', () => {
  const validTool = {
    name: 'my_tool',
    description: 'A custom tool',
    code: 'return 42;',
  };

  it('accepts valid minimal tool', () => {
    expect(createCustomToolSchema.safeParse(validTool).success).toBe(true);
  });

  it('accepts tool with all optional fields', () => {
    const full = {
      ...validTool,
      parameters: { input: { type: 'string' } },
      category: 'utilities',
      permissions: ['network', 'filesystem'] as const,
      requiresApproval: true,
      createdBy: 'user' as const,
      metadata: { version: '1.0' },
      requiredApiKeys: [
        {
          name: 'API_KEY',
          displayName: 'API Key',
          description: 'Main API key',
          category: 'auth',
          docsUrl: 'https://example.com/docs',
        },
      ],
    };
    expect(createCustomToolSchema.safeParse(full).success).toBe(true);
  });

  // Tool name regex: ^[a-z][a-z0-9_]*$
  it('rejects name starting with uppercase', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'MyTool' }).success).toBe(false);
  });

  it('rejects name with uppercase anywhere', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'my_Tool' }).success).toBe(false);
  });

  it('rejects name starting with a number', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: '1tool' }).success).toBe(false);
  });

  it('rejects name starting with underscore', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: '_tool' }).success).toBe(false);
  });

  it('rejects name with hyphens', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'my-tool' }).success).toBe(false);
  });

  it('rejects name with spaces', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'my tool' }).success).toBe(false);
  });

  it('rejects name with special characters', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'my@tool' }).success).toBe(false);
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'my.tool' }).success).toBe(false);
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'tool!' }).success).toBe(false);
  });

  it('accepts valid snake_case names', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'a' }).success).toBe(true);
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'web_search' }).success).toBe(true);
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'tool123' }).success).toBe(true);
    expect(createCustomToolSchema.safeParse({ ...validTool, name: 'a_b_c_1_2' }).success).toBe(true);
  });

  it('rejects code over 50000 characters', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, code: 'x'.repeat(50001) }).success).toBe(false);
  });

  it('accepts code at exactly 50000 characters', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, code: 'x'.repeat(50000) }).success).toBe(true);
  });

  it('rejects empty code', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, code: '' }).success).toBe(false);
  });

  it('rejects invalid permission enum value', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, permissions: ['admin'] }).success).toBe(false);
  });

  it('accepts all valid permission values', () => {
    const allPermissions = ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling'] as const;
    expect(createCustomToolSchema.safeParse({ ...validTool, permissions: [...allPermissions] }).success).toBe(true);
  });

  it('rejects permissions array over 6 items', () => {
    const tooMany = ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling', 'network'] as const;
    expect(createCustomToolSchema.safeParse({ ...validTool, permissions: [...tooMany] }).success).toBe(false);
  });

  it('rejects invalid createdBy value', () => {
    expect(createCustomToolSchema.safeParse({ ...validTool, createdBy: 'system' }).success).toBe(false);
  });

  it('rejects requiredApiKeys over 10 items', () => {
    const keys = Array.from({ length: 11 }, (_, i) => ({ name: `key_${i}` }));
    expect(createCustomToolSchema.safeParse({ ...validTool, requiredApiKeys: keys }).success).toBe(false);
  });

  it('rejects requiredApiKey with invalid docsUrl', () => {
    const result = createCustomToolSchema.safeParse({
      ...validTool,
      requiredApiKeys: [{ name: 'key', docsUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateCustomToolSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(updateCustomToolSchema.safeParse({}).success).toBe(true);
  });

  it('still validates name regex when provided', () => {
    expect(updateCustomToolSchema.safeParse({ name: 'InvalidName' }).success).toBe(false);
    expect(updateCustomToolSchema.safeParse({ name: 'valid_name' }).success).toBe(true);
  });
});

// ─── Autonomy Decision Schemas ────────────────────────────────────

describe('autonomyDecisionSchema', () => {
  it('accepts valid approve decision', () => {
    expect(autonomyDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
  });

  it('accepts valid reject decision with reason', () => {
    const result = autonomyDecisionSchema.safeParse({
      decision: 'reject',
      reason: 'Too expensive',
      remember: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts modify decision with modifications', () => {
    const result = autonomyDecisionSchema.safeParse({
      decision: 'modify',
      modifications: { maxCost: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid decision value', () => {
    expect(autonomyDecisionSchema.safeParse({ decision: 'deny' }).success).toBe(false);
    expect(autonomyDecisionSchema.safeParse({ decision: 'accept' }).success).toBe(false);
  });

  it('rejects missing decision', () => {
    expect(autonomyDecisionSchema.safeParse({}).success).toBe(false);
  });

  it('rejects reason over 2000 characters', () => {
    expect(autonomyDecisionSchema.safeParse({ decision: 'reject', reason: 'r'.repeat(2001) }).success).toBe(false);
  });
});

describe('autonomyApproveRejectSchema', () => {
  it('accepts empty object', () => {
    expect(autonomyApproveRejectSchema.safeParse({}).success).toBe(true);
  });

  it('accepts reason and remember', () => {
    const result = autonomyApproveRejectSchema.safeParse({
      reason: 'Looks good',
      remember: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects reason over 2000 characters', () => {
    expect(autonomyApproveRejectSchema.safeParse({ reason: 'r'.repeat(2001) }).success).toBe(false);
  });

  it('allows extra fields via passthrough', () => {
    const result = autonomyApproveRejectSchema.safeParse({ extra: 'data' });
    expect(result.success).toBe(true);
  });
});

describe('autonomyToolPermissionSchema', () => {
  it('accepts valid tool name', () => {
    expect(autonomyToolPermissionSchema.safeParse({ tool: 'web_search' }).success).toBe(true);
  });

  it('rejects empty tool name', () => {
    expect(autonomyToolPermissionSchema.safeParse({ tool: '' }).success).toBe(false);
  });

  it('rejects tool name over 200 characters', () => {
    expect(autonomyToolPermissionSchema.safeParse({ tool: 't'.repeat(201) }).success).toBe(false);
  });
});

describe('autonomyAssessSchema', () => {
  it('accepts valid assessment', () => {
    const result = autonomyAssessSchema.safeParse({
      category: 'system',
      actionType: 'file_write',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing category', () => {
    expect(autonomyAssessSchema.safeParse({ actionType: 'test' }).success).toBe(false);
  });

  it('rejects missing actionType', () => {
    expect(autonomyAssessSchema.safeParse({ category: 'test' }).success).toBe(false);
  });
});

describe('autonomyApprovalRequestSchema', () => {
  it('accepts valid request', () => {
    const result = autonomyApprovalRequestSchema.safeParse({
      category: 'system',
      actionType: 'file_delete',
      description: 'Delete temp files',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing description', () => {
    const result = autonomyApprovalRequestSchema.safeParse({
      category: 'system',
      actionType: 'file_delete',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description over 5000 characters', () => {
    const result = autonomyApprovalRequestSchema.safeParse({
      category: 'system',
      actionType: 'file_delete',
      description: 'd'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Goal Schemas ─────────────────────────────────────────────────

describe('createGoalSchema', () => {
  it('accepts valid minimal goal', () => {
    expect(createGoalSchema.safeParse({ title: 'Learn Rust' }).success).toBe(true);
  });

  it('accepts goal with all optional fields', () => {
    const result = createGoalSchema.safeParse({
      title: 'Learn Rust',
      description: 'Complete the Rust book',
      status: 'active',
      priority: 50,
      parentId: 'goal-parent',
      dueDate: '2025-12-31',
      metadata: { category: 'learning' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    expect(createGoalSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects title over 500 characters', () => {
    expect(createGoalSchema.safeParse({ title: 't'.repeat(501) }).success).toBe(false);
  });

  it('rejects priority over 100', () => {
    expect(createGoalSchema.safeParse({ title: 'Goal', priority: 101 }).success).toBe(false);
  });

  it('rejects negative priority', () => {
    expect(createGoalSchema.safeParse({ title: 'Goal', priority: -1 }).success).toBe(false);
  });

  it('accepts priority at boundaries 0 and 100', () => {
    expect(createGoalSchema.safeParse({ title: 'Goal', priority: 0 }).success).toBe(true);
    expect(createGoalSchema.safeParse({ title: 'Goal', priority: 100 }).success).toBe(true);
  });

  it('rejects non-integer priority', () => {
    expect(createGoalSchema.safeParse({ title: 'Goal', priority: 50.5 }).success).toBe(false);
  });

  it('rejects invalid status value', () => {
    expect(createGoalSchema.safeParse({ title: 'Goal', status: 'deleted' }).success).toBe(false);
  });

  it('accepts all valid status values', () => {
    for (const status of ['active', 'paused', 'completed', 'abandoned'] as const) {
      expect(createGoalSchema.safeParse({ title: 'Goal', status }).success).toBe(true);
    }
  });
});

describe('updateGoalSchema', () => {
  it('accepts empty object', () => {
    expect(updateGoalSchema.safeParse({}).success).toBe(true);
  });

  it('accepts progress field (not on create)', () => {
    expect(updateGoalSchema.safeParse({ progress: 75 }).success).toBe(true);
  });

  it('rejects progress over 100', () => {
    expect(updateGoalSchema.safeParse({ progress: 101 }).success).toBe(false);
  });

  it('rejects negative progress', () => {
    expect(updateGoalSchema.safeParse({ progress: -1 }).success).toBe(false);
  });
});

describe('createGoalStepSchema', () => {
  it('accepts valid step', () => {
    expect(createGoalStepSchema.safeParse({ title: 'Step 1' }).success).toBe(true);
  });

  it('accepts step with optional fields', () => {
    const result = createGoalStepSchema.safeParse({
      title: 'Step 1',
      description: 'First step',
      orderNum: 0,
      dependencies: ['step-0'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    expect(createGoalStepSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects orderNum over 10000', () => {
    expect(createGoalStepSchema.safeParse({ title: 'Step', orderNum: 10001 }).success).toBe(false);
  });

  it('rejects dependencies over 50 items', () => {
    const deps = Array.from({ length: 51 }, (_, i) => `dep-${i}`);
    expect(createGoalStepSchema.safeParse({ title: 'Step', dependencies: deps }).success).toBe(false);
  });
});

describe('createGoalStepsSchema', () => {
  it('accepts array form with steps field', () => {
    const result = createGoalStepsSchema.safeParse({
      steps: [{ title: 'Step 1' }, { title: 'Step 2' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts single step form', () => {
    const result = createGoalStepsSchema.safeParse({ title: 'Single Step' });
    expect(result.success).toBe(true);
  });

  it('rejects empty steps array', () => {
    expect(createGoalStepsSchema.safeParse({ steps: [] }).success).toBe(false);
  });

  it('rejects steps array over 100 items', () => {
    const steps = Array.from({ length: 101 }, (_, i) => ({ title: `Step ${i}` }));
    expect(createGoalStepsSchema.safeParse({ steps }).success).toBe(false);
  });
});

describe('updateGoalStepSchema', () => {
  it('accepts empty object', () => {
    expect(updateGoalStepSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid status values', () => {
    for (const status of ['pending', 'in_progress', 'completed', 'blocked', 'skipped'] as const) {
      expect(updateGoalStepSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects invalid status value', () => {
    expect(updateGoalStepSchema.safeParse({ status: 'done' }).success).toBe(false);
  });

  it('rejects result over 10000 characters', () => {
    expect(updateGoalStepSchema.safeParse({ result: 'r'.repeat(10001) }).success).toBe(false);
  });
});

describe('completeGoalStepSchema', () => {
  it('accepts empty object', () => {
    expect(completeGoalStepSchema.safeParse({}).success).toBe(true);
  });

  it('accepts result string', () => {
    expect(completeGoalStepSchema.safeParse({ result: 'Done successfully' }).success).toBe(true);
  });

  it('rejects result over 10000 characters', () => {
    expect(completeGoalStepSchema.safeParse({ result: 'r'.repeat(10001) }).success).toBe(false);
  });
});

// ─── Memory Schemas ───────────────────────────────────────────────

describe('createMemorySchema', () => {
  const validMemory = {
    type: 'fact' as const,
    content: 'The user prefers dark mode.',
  };

  it('accepts valid memory with required fields', () => {
    expect(createMemorySchema.safeParse(validMemory).success).toBe(true);
  });

  it('accepts all valid memory types', () => {
    for (const type of ['fact', 'preference', 'conversation', 'event', 'skill'] as const) {
      expect(createMemorySchema.safeParse({ ...validMemory, type }).success).toBe(true);
    }
  });

  it('rejects invalid memory type', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, type: 'note' }).success).toBe(false);
    expect(createMemorySchema.safeParse({ ...validMemory, type: 'document' }).success).toBe(false);
  });

  it('accepts memory with all optional fields', () => {
    const result = createMemorySchema.safeParse({
      ...validMemory,
      importance: 0.8,
      tags: ['ui', 'preference'],
      source: 'chat',
      sourceId: 'conv-123',
      metadata: { context: 'settings' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, content: '' }).success).toBe(false);
  });

  it('rejects content over 50000 characters', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, content: 'c'.repeat(50001) }).success).toBe(false);
  });

  it('rejects importance over 1', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, importance: 1.1 }).success).toBe(false);
  });

  it('rejects importance below 0', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, importance: -0.1 }).success).toBe(false);
  });

  it('accepts importance at boundaries 0 and 1', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, importance: 0 }).success).toBe(true);
    expect(createMemorySchema.safeParse({ ...validMemory, importance: 1 }).success).toBe(true);
  });

  it('accepts fractional importance', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, importance: 0.5 }).success).toBe(true);
    expect(createMemorySchema.safeParse({ ...validMemory, importance: 0.001 }).success).toBe(true);
  });

  it('rejects tags over 50 items', () => {
    const tags = Array.from({ length: 51 }, (_, i) => `tag${i}`);
    expect(createMemorySchema.safeParse({ ...validMemory, tags }).success).toBe(false);
  });

  it('rejects tag over 100 characters', () => {
    expect(createMemorySchema.safeParse({ ...validMemory, tags: ['t'.repeat(101)] }).success).toBe(false);
  });
});

describe('updateMemorySchema', () => {
  it('accepts empty object', () => {
    expect(updateMemorySchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial content update', () => {
    expect(updateMemorySchema.safeParse({ content: 'Updated content' }).success).toBe(true);
  });

  it('rejects empty content when provided', () => {
    expect(updateMemorySchema.safeParse({ content: '' }).success).toBe(false);
  });

  it('rejects importance out of range', () => {
    expect(updateMemorySchema.safeParse({ importance: 1.5 }).success).toBe(false);
    expect(updateMemorySchema.safeParse({ importance: -0.5 }).success).toBe(false);
  });
});

describe('boostMemorySchema', () => {
  it('accepts empty object', () => {
    expect(boostMemorySchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid amount', () => {
    expect(boostMemorySchema.safeParse({ amount: 0.5 }).success).toBe(true);
  });

  it('rejects amount over 1', () => {
    expect(boostMemorySchema.safeParse({ amount: 1.1 }).success).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(boostMemorySchema.safeParse({ amount: -0.1 }).success).toBe(false);
  });

  it('accepts amount at boundaries 0 and 1', () => {
    expect(boostMemorySchema.safeParse({ amount: 0 }).success).toBe(true);
    expect(boostMemorySchema.safeParse({ amount: 1 }).success).toBe(true);
  });
});

describe('decayMemoriesSchema', () => {
  it('accepts empty object', () => {
    expect(decayMemoriesSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid values', () => {
    expect(decayMemoriesSchema.safeParse({ daysThreshold: 30, decayFactor: 0.9 }).success).toBe(true);
  });

  it('rejects daysThreshold over 3650', () => {
    expect(decayMemoriesSchema.safeParse({ daysThreshold: 3651 }).success).toBe(false);
  });

  it('accepts daysThreshold at 3650', () => {
    expect(decayMemoriesSchema.safeParse({ daysThreshold: 3650 }).success).toBe(true);
  });

  it('rejects daysThreshold of 0', () => {
    expect(decayMemoriesSchema.safeParse({ daysThreshold: 0 }).success).toBe(false);
  });

  it('rejects non-integer daysThreshold', () => {
    expect(decayMemoriesSchema.safeParse({ daysThreshold: 30.5 }).success).toBe(false);
  });

  it('rejects decayFactor over 1', () => {
    expect(decayMemoriesSchema.safeParse({ decayFactor: 1.1 }).success).toBe(false);
  });

  it('rejects negative decayFactor', () => {
    expect(decayMemoriesSchema.safeParse({ decayFactor: -0.1 }).success).toBe(false);
  });
});

describe('cleanupMemoriesSchema', () => {
  it('accepts empty object', () => {
    expect(cleanupMemoriesSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid cleanup config', () => {
    expect(cleanupMemoriesSchema.safeParse({ maxAge: 365, minImportance: 0.1 }).success).toBe(true);
  });

  it('rejects maxAge over 3650', () => {
    expect(cleanupMemoriesSchema.safeParse({ maxAge: 3651 }).success).toBe(false);
  });

  it('rejects minImportance over 1', () => {
    expect(cleanupMemoriesSchema.safeParse({ minImportance: 1.1 }).success).toBe(false);
  });
});

// ─── Expense Schemas ──────────────────────────────────────────────

describe('createExpenseSchema', () => {
  const validExpense = {
    amount: 42.50,
    category: 'food' as const,
    description: 'Lunch',
  };

  it('accepts valid minimal expense', () => {
    expect(createExpenseSchema.safeParse(validExpense).success).toBe(true);
  });

  it('accepts expense with all optional fields', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      date: '2025-01-15',
      currency: 'USD',
      paymentMethod: 'credit_card',
      tags: ['meal', 'work'],
      notes: 'Business lunch',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid category values', () => {
    const categories = [
      'food', 'transport', 'utilities', 'entertainment', 'shopping',
      'health', 'education', 'travel', 'subscription', 'housing', 'other',
    ] as const;
    for (const category of categories) {
      expect(createExpenseSchema.safeParse({ ...validExpense, category }).success).toBe(true);
    }
  });

  it('rejects invalid category', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, category: 'groceries' }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...validExpense, category: 'misc' }).success).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, amount: -10 }).success).toBe(false);
  });

  it('rejects zero amount (positive required)', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, amount: 0 }).success).toBe(false);
  });

  it('accepts very small positive amount', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, amount: 0.01 }).success).toBe(true);
  });

  it('rejects empty description', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, description: '' }).success).toBe(false);
  });

  it('rejects description over 1000 characters', () => {
    expect(createExpenseSchema.safeParse({ ...validExpense, description: 'd'.repeat(1001) }).success).toBe(false);
  });

  it('rejects tags over 20 items', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    expect(createExpenseSchema.safeParse({ ...validExpense, tags }).success).toBe(false);
  });
});

describe('updateExpenseSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial update', () => {
    expect(updateExpenseSchema.safeParse({ amount: 99.99 }).success).toBe(true);
  });

  it('still rejects negative amount', () => {
    expect(updateExpenseSchema.safeParse({ amount: -5 }).success).toBe(false);
  });

  it('still rejects invalid category', () => {
    expect(updateExpenseSchema.safeParse({ category: 'invalid' }).success).toBe(false);
  });
});

// ─── Media Settings Schemas ───────────────────────────────────────

describe('mediaSettingsSchema', () => {
  it('accepts valid settings with provider', () => {
    expect(mediaSettingsSchema.safeParse({ provider: 'openai' }).success).toBe(true);
  });

  it('accepts settings with all fields', () => {
    const result = mediaSettingsSchema.safeParse({
      provider: 'openai',
      model: 'dall-e-3',
      config: { quality: 'hd' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty provider', () => {
    expect(mediaSettingsSchema.safeParse({ provider: '' }).success).toBe(false);
  });

  it('rejects missing provider', () => {
    expect(mediaSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects provider over 100 characters', () => {
    expect(mediaSettingsSchema.safeParse({ provider: 'p'.repeat(101) }).success).toBe(false);
  });

  it('allows extra fields via passthrough', () => {
    const result = mediaSettingsSchema.safeParse({ provider: 'test', customKey: 'value' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customKey).toBe('value');
    }
  });
});

// ─── Custom Data Schemas ──────────────────────────────────────────

describe('createCustomTableSchema', () => {
  const validTable = {
    name: 'contacts',
    displayName: 'Contacts',
    columns: [
      { name: 'email', type: 'text' as const },
    ],
  };

  it('accepts valid table with one column', () => {
    expect(createCustomTableSchema.safeParse(validTable).success).toBe(true);
  });

  it('accepts table with full column definitions', () => {
    const result = createCustomTableSchema.safeParse({
      name: 'inventory',
      displayName: 'Inventory Items',
      description: 'Product inventory',
      columns: [
        { name: 'product', type: 'text', required: true, description: 'Product name' },
        { name: 'count', type: 'number', required: false, defaultValue: 0 },
        { name: 'active', type: 'boolean', defaultValue: true },
        { name: 'created', type: 'date' },
        { name: 'updated', type: 'datetime' },
        { name: 'meta', type: 'json', defaultValue: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid column types', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'datetime', 'json'] as const) {
      const result = createCustomTableSchema.safeParse({
        ...validTable,
        columns: [{ name: 'col', type }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid column type', () => {
    const result = createCustomTableSchema.safeParse({
      ...validTable,
      columns: [{ name: 'col', type: 'binary' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty columns array', () => {
    expect(createCustomTableSchema.safeParse({ ...validTable, columns: [] }).success).toBe(false);
  });

  it('rejects columns array over 100 items', () => {
    const columns = Array.from({ length: 101 }, (_, i) => ({ name: `col_${i}`, type: 'text' as const }));
    expect(createCustomTableSchema.safeParse({ ...validTable, columns }).success).toBe(false);
  });

  it('rejects empty table name', () => {
    expect(createCustomTableSchema.safeParse({ ...validTable, name: '' }).success).toBe(false);
  });

  it('rejects empty displayName', () => {
    expect(createCustomTableSchema.safeParse({ ...validTable, displayName: '' }).success).toBe(false);
  });

  it('rejects column with empty name', () => {
    const result = createCustomTableSchema.safeParse({
      ...validTable,
      columns: [{ name: '', type: 'text' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows extra fields on columns via passthrough', () => {
    const result = createCustomTableSchema.safeParse({
      ...validTable,
      columns: [{ name: 'col', type: 'text', customMeta: true }],
    });
    expect(result.success).toBe(true);
  });
});

describe('updateCustomTableSchema', () => {
  it('accepts empty object', () => {
    expect(updateCustomTableSchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial update with displayName', () => {
    expect(updateCustomTableSchema.safeParse({ displayName: 'New Name' }).success).toBe(true);
  });

  it('still rejects empty columns when provided', () => {
    expect(updateCustomTableSchema.safeParse({ columns: [] }).success).toBe(false);
  });
});

describe('createCustomRecordSchema', () => {
  it('accepts valid record with data', () => {
    const result = createCustomRecordSchema.safeParse({
      data: { email: 'test@example.com', count: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty data object', () => {
    expect(createCustomRecordSchema.safeParse({ data: {} }).success).toBe(true);
  });

  it('rejects missing data field', () => {
    expect(createCustomRecordSchema.safeParse({}).success).toBe(false);
  });

  it('allows extra fields via passthrough', () => {
    const result = createCustomRecordSchema.safeParse({ data: {}, extra: 'field' });
    expect(result.success).toBe(true);
  });
});

describe('updateCustomRecordSchema', () => {
  it('accepts valid data', () => {
    expect(updateCustomRecordSchema.safeParse({ data: { field: 'value' } }).success).toBe(true);
  });

  it('rejects missing data', () => {
    expect(updateCustomRecordSchema.safeParse({}).success).toBe(false);
  });
});

// ─── Workspace Schemas ────────────────────────────────────────────

describe('createWorkspaceSchema', () => {
  it('accepts minimal workspace', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'dev' }).success).toBe(true);
  });

  it('accepts workspace with all fields', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'production',
      description: 'Production workspace',
      containerConfig: {
        memoryMB: 512,
        cpuCores: 2,
        storageGB: 5,
        timeoutMs: 30000,
        networkPolicy: 'restricted',
        allowedHosts: ['api.example.com'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(createWorkspaceSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name over 100 characters', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'n'.repeat(101) }).success).toBe(false);
  });

  it('rejects containerConfig with memoryMB over 2048', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { memoryMB: 2049 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects containerConfig with memoryMB below 64', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { memoryMB: 63 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts containerConfig with memoryMB at boundaries 64 and 2048', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { memoryMB: 64 },
    }).success).toBe(true);
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { memoryMB: 2048 },
    }).success).toBe(true);
  });

  it('rejects cpuCores over 4', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { cpuCores: 5 },
    }).success).toBe(false);
  });

  it('rejects cpuCores below 0.25', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { cpuCores: 0.1 },
    }).success).toBe(false);
  });

  it('rejects storageGB over 10', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { storageGB: 11 },
    }).success).toBe(false);
  });

  it('rejects storageGB below 1', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { storageGB: 0 },
    }).success).toBe(false);
  });

  it('rejects timeoutMs over 120000', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { timeoutMs: 120001 },
    }).success).toBe(false);
  });

  it('rejects timeoutMs below 5000', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { timeoutMs: 4999 },
    }).success).toBe(false);
  });

  it('rejects invalid networkPolicy value', () => {
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { networkPolicy: 'open' },
    }).success).toBe(false);
  });

  it('accepts all valid networkPolicy values', () => {
    for (const networkPolicy of ['none', 'restricted', 'full'] as const) {
      expect(createWorkspaceSchema.safeParse({
        name: 'ws',
        containerConfig: { networkPolicy },
      }).success).toBe(true);
    }
  });

  it('rejects allowedHosts over 50 items', () => {
    const allowedHosts = Array.from({ length: 51 }, (_, i) => `host${i}.com`);
    expect(createWorkspaceSchema.safeParse({
      name: 'ws',
      containerConfig: { allowedHosts },
    }).success).toBe(false);
  });
});

describe('updateWorkspaceSchema', () => {
  it('accepts empty object', () => {
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial update', () => {
    expect(updateWorkspaceSchema.safeParse({ name: 'new-name' }).success).toBe(true);
  });

  it('still validates containerConfig constraints', () => {
    expect(updateWorkspaceSchema.safeParse({
      containerConfig: { memoryMB: 99999 },
    }).success).toBe(false);
  });
});
