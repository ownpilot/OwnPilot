/**
 * Request validation middleware using Zod
 *
 * Provides reusable validation schemas for critical API endpoints.
 * Only validates fields that pose security or data integrity risks.
 */

import { z } from 'zod';

// ─── Agent Schemas ───────────────────────────────────────────────

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  systemPrompt: z.string().min(1).max(50000),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  maxToolCalls: z.number().int().min(1).max(500).optional(),
  category: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
  tools: z.array(z.string().max(100)).max(200).optional(),
  toolGroups: z.array(z.string().max(100)).max(50).optional(),
  isDefault: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

// ─── Chat Schemas ────────────────────────────────────────────────

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(100000),
  conversationId: z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  agentId: z.string().max(200).optional(),
  workspaceId: z.string().max(200).optional(),
  directTools: z.array(z.string().max(100)).optional(),
  historyLength: z.number().int().min(0).optional(),
  stream: z.boolean().optional(),
  streamingMode: z.enum(['auto', 'always', 'never']).optional(),
  maxToolCalls: z.number().int().min(0).max(1000).optional(),
});

// ─── Trigger Schemas ─────────────────────────────────────────────

export const createTriggerSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['schedule', 'event', 'condition', 'webhook']),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: z.record(z.string(), z.unknown()),
  action: z.record(z.string(), z.unknown()),
});

// ─── Plan Schemas ────────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  goal: z.string().min(1).max(5000),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  goal: z.string().max(5000).optional(),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
});

export const createPlanStepSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan']),
  orderNum: z.number().int().min(0).max(1000),
  description: z.string().max(5000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

export const updatePlanStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting']).optional(),
  orderNum: z.number().int().min(0).max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

// ─── Autonomy Schemas ────────────────────────────────────────────

export const autonomyConfigSchema = z.object({
  level: z.number().int().min(0).max(5).optional(),
  allowedTools: z.array(z.string().max(100)).optional(),
  blockedTools: z.array(z.string().max(100)).optional(),
  requireApproval: z.boolean().optional(),
  maxCostPerAction: z.number().min(0).max(1000).optional(),
  dailyBudget: z.number().min(0).max(10000).optional(),
});

export const autonomyLevelSchema = z.object({
  level: z.number().int().min(0).max(5),
});

export const autonomyBudgetSchema = z.object({
  dailyBudget: z.number().min(0).max(10000).optional(),
  maxCostPerAction: z.number().min(0).max(1000).optional(),
});

// ─── Custom Tool Schemas ─────────────────────────────────────────

const toolPermissionValues = ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling', 'local'] as const;

export const createCustomToolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores'),
  description: z.string().min(1).max(2000),
  code: z.string().min(1).max(50000),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(7).optional(),
  requiresApproval: z.boolean().optional(),
  createdBy: z.enum(['user', 'llm']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiredApiKeys: z.array(z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
    docsUrl: z.string().url().max(2000).optional(),
  })).max(10).optional(),
});

export const updateCustomToolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores').optional(),
  description: z.string().min(1).max(2000).optional(),
  code: z.string().min(1).max(50000).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(7).optional(),
  requiresApproval: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiredApiKeys: z.array(z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
    docsUrl: z.string().url().max(2000).optional(),
  })).max(10).optional(),
});

// ─── Autonomy Decision Schemas ───────────────────────────────────

export const autonomyDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'modify']),
  reason: z.string().max(2000).optional(),
  remember: z.boolean().optional(),
  modifications: z.record(z.string(), z.unknown()).optional(),
});

export const autonomyApproveRejectSchema = z.object({
  reason: z.string().max(2000).optional(),
  remember: z.boolean().optional(),
});

export const autonomyToolPermissionSchema = z.object({
  tool: z.string().min(1).max(200),
});

export const autonomyAssessSchema = z.object({
  category: z.string().min(1).max(100),
  actionType: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const autonomyApprovalRequestSchema = z.object({
  category: z.string().min(1).max(100),
  actionType: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  params: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ─── Goal Schemas ───────────────────────────────────────────────

export const createGoalSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(['active', 'paused', 'completed', 'abandoned']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  parentId: z.string().max(200).optional(),
  dueDate: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateGoalSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['active', 'paused', 'completed', 'abandoned']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  dueDate: z.string().max(100).optional(),
  progress: z.number().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createGoalStepSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  orderNum: z.number().int().min(0).max(10000).optional(),
  dependencies: z.array(z.string().max(200)).max(50).optional(),
});

export const createGoalStepsSchema = z.union([
  z.object({
    steps: z.array(z.object({
      title: z.string().min(1).max(500),
      description: z.string().max(5000).optional(),
      orderNum: z.number().int().min(0).max(10000).optional(),
      dependencies: z.array(z.string().max(200)).max(50).optional(),
    })).min(1).max(100),
  }),
  z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    orderNum: z.number().int().min(0).max(10000).optional(),
    dependencies: z.array(z.string().max(200)).max(50).optional(),
  }),
]);

export const updateGoalStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped']).optional(),
  result: z.string().max(10000).optional(),
});

export const completeGoalStepSchema = z.object({
  result: z.string().max(10000).optional(),
});

// ─── Memory Schemas ─────────────────────────────────────────────

export const createMemorySchema = z.object({
  type: z.enum(['fact', 'preference', 'conversation', 'event', 'skill']),
  content: z.string().min(1).max(50000),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  source: z.string().max(200).optional(),
  sourceId: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(50000).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

export const boostMemorySchema = z.object({
  amount: z.number().min(0).max(1).optional(),
});

export const decayMemoriesSchema = z.object({
  daysThreshold: z.number().int().min(1).max(3650).optional(),
  decayFactor: z.number().min(0).max(1).optional(),
});

export const cleanupMemoriesSchema = z.object({
  maxAge: z.number().int().min(1).max(3650).optional(),
  minImportance: z.number().min(0).max(1).optional(),
});

// ─── Expense Schemas ────────────────────────────────────────────

const expenseCategoryEnum = z.enum([
  'food', 'transport', 'utilities', 'entertainment', 'shopping',
  'health', 'education', 'travel', 'subscription', 'housing', 'other',
]);

export const createExpenseSchema = z.object({
  date: z.string().max(100).optional(),
  amount: z.number().positive(),
  currency: z.string().max(10).optional(),
  category: expenseCategoryEnum,
  description: z.string().min(1).max(1000),
  paymentMethod: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateExpenseSchema = z.object({
  date: z.string().max(100).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().max(10).optional(),
  category: expenseCategoryEnum.optional(),
  description: z.string().min(1).max(1000).optional(),
  paymentMethod: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});

// ─── Media Settings Schemas ─────────────────────────────────────

export const mediaSettingsSchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ─── Custom Data Schemas ────────────────────────────────────────

const columnDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'number', 'boolean', 'date', 'datetime', 'json']),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  description: z.string().max(500).optional(),
});

export const createCustomTableSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  columns: z.array(columnDefinitionSchema).min(1).max(100),
});

export const updateCustomTableSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  columns: z.array(columnDefinitionSchema).min(1).max(100).optional(),
});

export const createCustomRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const updateCustomRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

// ─── Workspace Schemas ──────────────────────────────────────────

const containerConfigSchema = z.object({
  memoryMB: z.number().min(64).max(2048).optional(),
  cpuCores: z.number().min(0.25).max(4).optional(),
  storageGB: z.number().min(1).max(10).optional(),
  timeoutMs: z.number().min(5000).max(120000).optional(),
  networkPolicy: z.enum(['none', 'restricted', 'full']).optional(),
  allowedHosts: z.array(z.string().max(500)).max(50).optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  containerConfig: containerConfigSchema.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  containerConfig: containerConfigSchema.optional(),
});

// ─── Local Provider Schemas ──────────────────────────────────────

export const createLocalProviderSchema = z.object({
  name: z.string().min(1).max(200),
  providerType: z.enum(['lmstudio', 'ollama', 'localai', 'vllm', 'custom']),
  baseUrl: z.string().min(1).max(2048),
  apiKey: z.string().max(500).optional(),
  discoveryEndpoint: z.string().max(500).optional(),
});

export const updateLocalProviderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().max(2048).optional(),
  apiKey: z.string().max(500).optional(),
  discoveryEndpoint: z.string().max(500).optional(),
  isEnabled: z.boolean().optional(),
});

export const toggleEnabledSchema = z.object({
  enabled: z.boolean(),
});

// ─── Profile Schemas ────────────────────────────────────────────

export const profileSetDataSchema = z.object({
  category: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  value: z.unknown(),
  data: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(['user_stated', 'user_confirmed', 'ai_inferred', 'imported']).optional(),
  sensitive: z.boolean().optional(),
});

export const profileDeleteDataSchema = z.object({
  category: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
});

export const profileImportSchema = z.object({
  entries: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
});

export const profileQuickSetupSchema = z.object({
  name: z.string().max(200).optional(),
  nickname: z.string().max(200).optional(),
  location: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
  occupation: z.string().max(500).optional(),
  language: z.string().max(100).optional(),
  communicationStyle: z.string().max(200).optional(),
  autonomyLevel: z.string().max(100).optional(),
});

// ─── Provider Config Schemas ────────────────────────────────────

export const providerConfigSchema = z.object({
  baseUrl: z.string().max(2048).optional(),
  providerType: z.string().max(100).optional(),
  isEnabled: z.boolean().optional(),
  apiKeyEnv: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

// ─── Workspace File & Execute Schemas ───────────────────────────

export const workspaceWriteFileSchema = z.object({
  content: z.string(),
});

export const workspaceExecuteCodeSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum(['python', 'javascript', 'shell']),
  timeout: z.number().int().min(1000).max(120000).optional(),
  files: z.array(z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(1000000),
  })).max(50).optional(),
});

// ─── Workflow Schemas ──────────────────────────────────────────

const toolNodeDataSchema = z.object({
  toolName: z.string().min(1).max(200),
  toolArgs: z.record(z.string(), z.unknown()).default({}),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const triggerNodeDataSchema = z.object({
  triggerType: z.enum(['manual', 'schedule', 'event', 'condition', 'webhook']),
  label: z.string().min(1).max(200),
  cron: z.string().max(100).optional(),
  timezone: z.string().max(100).optional(),
  eventType: z.string().max(200).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  condition: z.string().max(200).optional(),
  threshold: z.number().optional(),
  checkInterval: z.number().optional(),
  webhookPath: z.string().max(500).optional(),
  webhookSecret: z.string().max(500).optional(),
  triggerId: z.string().max(100).optional(),
});

const llmNodeDataSchema = z.object({
  label: z.string().min(1).max(200),
  provider: z.string().max(100),
  model: z.string().max(200),
  systemPrompt: z.string().max(50000).optional(),
  userMessage: z.string().max(100000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(2048).optional(),
});

const conditionNodeDataSchema = z.object({
  label: z.string().min(1).max(200),
  expression: z.string().max(10000),
  description: z.string().max(2000).optional(),
});

const codeNodeDataSchema = z.object({
  label: z.string().min(1).max(200),
  language: z.enum(['javascript', 'python', 'shell']),
  code: z.string().max(100000),
  description: z.string().max(2000).optional(),
});

const transformerNodeDataSchema = z.object({
  label: z.string().min(1).max(200),
  expression: z.string().max(50000),
  description: z.string().max(2000).optional(),
});

const workflowNodeDataSchema = z.union([
  toolNodeDataSchema, triggerNodeDataSchema, llmNodeDataSchema,
  conditionNodeDataSchema, codeNodeDataSchema, transformerNodeDataSchema,
]);

const workflowNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().max(50).default('toolNode'),
  position: z.object({ x: z.number(), y: z.number() }),
  data: workflowNodeDataSchema,
});

const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  sourceHandle: z.string().max(100).optional(),
  targetHandle: z.string().max(100).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  nodes: z.array(workflowNodeSchema).max(100).default([]),
  edges: z.array(workflowEdgeSchema).max(500).default([]),
  status: z.enum(['active', 'inactive']).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  nodes: z.array(workflowNodeSchema).max(100).optional(),
  edges: z.array(workflowEdgeSchema).max(500).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

// ─── Validation Helper ──────────────────────────────────────────

/**
 * Validate request body against a Zod schema.
 * Returns parsed data on success, throws descriptive error on failure.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation failed: ${issues}`);
  }
  return result.data;
}
