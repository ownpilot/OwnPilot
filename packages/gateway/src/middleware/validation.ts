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
  thinking: z
    .object({
      type: z.enum(['enabled', 'adaptive']),
      budgetTokens: z.number().int().min(1024).max(128000).optional(),
      effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
    })
    .optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file']),
        data: z.string().max(20_000_000),
        mimeType: z.string().max(100),
        filename: z.string().max(255).optional(),
      })
    )
    .max(5)
    .optional(),
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
  type: z.enum([
    'tool_call',
    'llm_decision',
    'user_input',
    'condition',
    'parallel',
    'loop',
    'sub_plan',
  ]),
  orderNum: z.number().int().min(0).max(1000),
  description: z.string().max(5000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

export const updatePlanStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  type: z
    .enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan'])
    .optional(),
  status: z
    .enum(['pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting'])
    .optional(),
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

export const pulseSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  minIntervalMs: z.number().int().min(60000).max(3600000).optional(),
  maxIntervalMs: z.number().int().min(60000).max(7200000).optional(),
  maxActions: z.number().int().min(1).max(20).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
});

// ─── Pulse Directives Schema ─────────────────────────────────────

const ruleThresholdsSchema = z
  .object({
    staleDays: z.number().int().min(1).max(30).optional(),
    deadlineDays: z.number().int().min(1).max(30).optional(),
    activityDays: z.number().int().min(1).max(30).optional(),
    lowProgressPct: z.number().int().min(1).max(100).optional(),
    memoryMaxCount: z.number().int().min(50).max(10000).optional(),
    memoryMinImportance: z.number().min(0).max(1).optional(),
    triggerErrorMin: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const actionCooldownsSchema = z
  .object({
    create_memory: z.number().int().min(0).max(1440).optional(),
    update_goal_progress: z.number().int().min(0).max(1440).optional(),
    send_notification: z.number().int().min(0).max(1440).optional(),
    run_memory_cleanup: z.number().int().min(0).max(1440).optional(),
  })
  .optional();

export const pulseDirectivesSchema = z.object({
  disabledRules: z.array(z.string().max(50)).max(20).optional(),
  blockedActions: z.array(z.string().max(50)).max(10).optional(),
  customInstructions: z.string().max(2000).optional(),
  template: z.string().max(50).optional(),
  ruleThresholds: ruleThresholdsSchema,
  actionCooldowns: actionCooldownsSchema,
});

// ─── Custom Tool Schemas ─────────────────────────────────────────

const toolPermissionValues = [
  'network',
  'filesystem',
  'database',
  'shell',
  'email',
  'scheduling',
  'local',
] as const;

export const createCustomToolSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores'),
  description: z.string().min(1).max(2000),
  code: z.string().min(1).max(50000),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(7).optional(),
  requiresApproval: z.boolean().optional(),
  createdBy: z.enum(['user', 'llm']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiredApiKeys: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        displayName: z.string().max(200).optional(),
        description: z.string().max(500).optional(),
        category: z.string().max(50).optional(),
        docsUrl: z.string().url().max(2000).optional(),
      })
    )
    .max(10)
    .optional(),
});

export const updateCustomToolSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores')
    .optional(),
  description: z.string().min(1).max(2000).optional(),
  code: z.string().min(1).max(50000).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(7).optional(),
  requiresApproval: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiredApiKeys: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        displayName: z.string().max(200).optional(),
        description: z.string().max(500).optional(),
        category: z.string().max(50).optional(),
        docsUrl: z.string().url().max(2000).optional(),
      })
    )
    .max(10)
    .optional(),
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
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          description: z.string().max(5000).optional(),
          orderNum: z.number().int().min(0).max(10000).optional(),
          dependencies: z.array(z.string().max(200)).max(50).optional(),
        })
      )
      .min(1)
      .max(100),
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
  'food',
  'transport',
  'utilities',
  'entertainment',
  'shopping',
  'health',
  'education',
  'travel',
  'subscription',
  'housing',
  'other',
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
  content: z.string().max(10_000_000),
});

export const workspaceExecuteCodeSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum(['python', 'javascript', 'shell']),
  timeout: z.number().int().min(1000).max(120000).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(1000000),
      })
    )
    .max(50)
    .optional(),
});

// ─── Workflow Schemas ──────────────────────────────────────────

// Node data uses a permissive record — structural validation is handled by
// validateWorkflowSemantics() which checks per-type required fields.
// A z.union of per-type schemas cannot work here because schemas with fewer
// required fields (e.g. conditionNode: label+expression) match first and
// strip extra keys (e.g. switch node's `cases`), silently losing data.
const workflowNodeDataSchema = z.record(z.string(), z.unknown());

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

const inputParameterSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'boolean', 'json']),
  required: z.boolean(),
  defaultValue: z.string().max(5000).optional(),
  description: z.string().max(500).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  nodes: z.array(workflowNodeSchema).max(100).default([]),
  edges: z.array(workflowEdgeSchema).max(500).default([]),
  status: z.enum(['active', 'inactive']).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  inputSchema: z.array(inputParameterSchema).max(20).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  nodes: z.array(workflowNodeSchema).max(100).optional(),
  edges: z.array(workflowEdgeSchema).max(500).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  inputSchema: z.array(inputParameterSchema).max(20).optional(),
});

export const workflowCopilotSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(50000),
      })
    )
    .min(1)
    .max(30),
  currentWorkflow: z
    .object({
      name: z.string(),
      nodes: z.array(z.unknown()),
      edges: z.array(z.unknown()),
      variables: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  availableTools: z.array(z.string()).max(500).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
});

// ─── Agent Command Center Schemas ───────────────────────────────

const commandTargetSchema = z.object({
  type: z.enum(['soul', 'background', 'crew']),
  id: z.string().min(1).max(200),
});

export const agentCommandSchema = z.object({
  targets: z.array(commandTargetSchema).min(1).max(100),
  command: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

export const deployFleetSchema = z.object({
  name: z.string().min(1).max(200),
  mission: z.string().min(1).max(5000),
  agentCount: z.number().int().min(1).max(10).optional(),
  roles: z.array(z.string().max(100)).max(10).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  coordinationPattern: z.enum(['hub_spoke', 'peer_to_peer', 'pipeline']).optional(),
});

export const agentMissionSchema = z.object({
  agentIds: z.array(z.string().max(200)).max(100).optional(),
  crewIds: z.array(z.string().max(200)).max(50).optional(),
  mission: z.string().min(1).max(5000),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  deadline: z.string().max(100).optional(),
});

const executeTargetSchema = z.object({
  type: z.enum(['soul', 'background']),
  id: z.string().min(1).max(200),
  task: z.string().max(5000).optional(),
});

export const agentExecuteSchema = z.object({
  targets: z.array(executeTargetSchema).min(1).max(100),
  parallel: z.boolean().optional(),
});

export const agentToolsBatchUpdateSchema = z.object({
  agentIds: z.array(z.string().max(200)).min(1).max(100),
  addAllowed: z.array(z.string().max(200)).max(200).optional(),
  addBlocked: z.array(z.string().max(200)).max(200).optional(),
  removeAllowed: z.array(z.string().max(200)).max(200).optional(),
  removeBlocked: z.array(z.string().max(200)).max(200).optional(),
});

// ─── Agent Message Schemas ──────────────────────────────────────

const agentAttachmentSchema = z.object({
  type: z.enum(['note', 'task', 'memory', 'data', 'artifact']),
  id: z.string().min(1).max(200),
  title: z.string().max(500).optional(),
});

export const sendAgentMessageSchema = z.object({
  to: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  from: z.string().max(200).optional(),
  type: z.enum(['task_delegation', 'task_result', 'status_update', 'question', 'feedback', 'alert', 'coordination', 'knowledge_share']).optional(),
  subject: z.string().max(500).optional(),
  attachments: z.array(agentAttachmentSchema).max(20).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  threadId: z.string().max(200).optional(),
  requiresResponse: z.boolean().optional(),
  deadline: z.string().max(100).optional(),
  crewId: z.string().max(200).optional(),
});

// ─── Artifact Schemas ───────────────────────────────────────────

export const createArtifactSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(['html', 'svg', 'markdown', 'form', 'chart', 'react']),
  content: z.string().min(1).max(500000),
  conversationId: z.string().max(200).optional(),
  dataBindings: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  pinToDashboard: z.boolean().optional(),
  dashboardSize: z.string().max(50).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

// ─── Browser Schemas ────────────────────────────────────────────

export const browserNavigateSchema = z.object({
  url: z.string().min(1).max(2048),
});

export const browserActionSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'select', 'wait', 'fill_form', 'extract']),
  selector: z.string().max(2000).optional(),
  text: z.string().max(50000).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  pixels: z.number().int().positive().max(10000).optional(),
  value: z.string().max(5000).optional(),
  fields: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
  dataSelectors: z.record(z.string(), z.unknown()).optional(),
  timeout: z.number().int().positive().max(60000).optional(),
});

export const createBrowserWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  parameters: z.record(z.string(), z.unknown()).optional(),
  triggerId: z.string().max(200).optional(),
});

// ─── Config Service Schemas ─────────────────────────────────────

export const createConfigServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z][a-z0-9_]*$/, 'Must start with lowercase letter, only lowercase/numbers/underscores'),
  displayName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  configSchema: z.array(z.record(z.string(), z.unknown())).optional(),
  requiredBy: z.array(z.string().max(200)).optional(),
  docsUrl: z.string().max(2000).optional(),
});

// ─── Cost Schemas ───────────────────────────────────────────────

export const costEstimateSchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  text: z.string().max(200000).optional(),
});

export const costBudgetSchema = z.object({
  dailyLimit: z.number().positive().optional(),
  weeklyLimit: z.number().positive().optional(),
  monthlyLimit: z.number().positive().optional(),
  alertThresholds: z.array(z.number().min(0).max(100)).max(10).optional(),
  limitAction: z.enum(['warn', 'block']).optional(),
});

export const costRecordSchema = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  totalTokens: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  requestType: z.enum(['chat', 'completion', 'embedding', 'image', 'audio', 'tool']).optional(),
  sessionId: z.string().max(200).optional(),
  cached: z.boolean().optional(),
  error: z.string().max(5000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Crew Schemas ───────────────────────────────────────────────

export const crewDeploySchema = z.object({
  templateId: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const crewMessageSchema = z.object({
  message: z.string().min(1).max(50000),
});

export const crewDelegateSchema = z.object({
  fromAgentId: z.string().min(1).max(200),
  toAgentId: z.string().min(1).max(200),
  task: z.string().min(1).max(5000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const crewSyncSchema = z.object({
  context: z.string().min(1).max(50000),
});

// ─── Edge Device Schemas ────────────────────────────────────────

export const createEdgeDeviceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const edgeDeviceCommandSchema = z.object({
  commandType: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
  timeout: z.number().int().positive().max(120000).optional(),
});

// ─── MCP Schemas ────────────────────────────────────────────────

export const mcpToolCallSchema = z.object({
  tool_name: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const createMcpServerSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  transport: z.enum(['stdio', 'sse', 'streamable-http']),
  command: z.string().max(2000).optional(),
  args: z.array(z.string().max(2000)).max(50).optional(),
  url: z.string().max(2048).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().max(5000).optional(),
  autoConnect: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const mcpToolSettingsSchema = z.object({
  toolName: z.string().min(1).max(200),
  workflowUsable: z.boolean(),
});

// ─── Plugin Schemas ─────────────────────────────────────────────

export const pluginSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

// ─── Productivity Schemas ───────────────────────────────────────

export const startPomodoroSchema = z.object({
  type: z.enum(['work', 'short_break', 'long_break']),
  durationMinutes: z.number().int().min(1).max(120),
  taskDescription: z.string().max(500).optional(),
});

export const createHabitSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  frequency: z.enum(['daily', 'weekly', 'weekdays', 'custom']).optional(),
  targetDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  targetCount: z.number().int().min(1).max(100).optional(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  icon: z.string().max(50).optional(),
  reminderTime: z.string().max(10).optional(),
});

export const createCaptureSchema = z.object({
  content: z.string().min(1).max(50000),
  type: z.enum(['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other']).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  source: z.string().max(200).optional(),
});

export const processCaptureSchema = z.object({
  processedAsType: z.enum(['note', 'task', 'bookmark', 'discarded']),
  processedAsId: z.string().max(200).optional(),
});

// ─── Settings Schemas ───────────────────────────────────────────

export const setDefaultProviderSchema = z.object({
  provider: z.string().min(1).max(64),
});

export const setDefaultModelSchema = z.object({
  model: z.string().min(1).max(128),
});

export const setApiKeySchema = z.object({
  provider: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(1000),
});

export const setAllowedDirsSchema = z.object({
  dirs: z.array(z.string().max(1000)).min(1).max(50),
});

export const setToolGroupsSchema = z.object({
  enabledGroupIds: z.array(z.string().max(200)).max(100),
});

// ─── Soul Schemas ───────────────────────────────────────────────

export const createSoulSchema = z.object({
  agentId: z.string().min(1).max(200),
  identity: z.record(z.string(), z.unknown()),
  purpose: z.record(z.string(), z.unknown()),
  autonomy: z.object({
    level: z.number().int().min(0).max(4).optional(),
  }).passthrough(),
  heartbeat: z.object({
    enabled: z.boolean(),
    interval: z.string().min(1).max(100),
    checklist: z.array(z.object({
      id: z.string().optional(),
      task: z.string().min(1),
      type: z.string().optional(),
      priority: z.string().optional(),
    }).passthrough()).default([]),
    quietHours: z.object({
      start: z.string(),
      end: z.string(),
      timezone: z.string().optional(),
    }).optional(),
    selfHealingEnabled: z.boolean().default(false),
    maxDurationMs: z.number().int().positive().default(120000),
  }),
  evolution: z.record(z.string(), z.unknown()),
  relationships: z.record(z.string(), z.unknown()).optional(),
  bootSequence: z.record(z.string(), z.unknown()).optional(),
});

// ─── Soul Agent Sub-Route Schemas ───────────────────────────────

export const soulGoalSchema = z.object({
  goal: z.string().min(1).max(5000),
});

export const soulMissionSchema = z.object({
  mission: z.string().min(1).max(5000),
});

export const soulToolsSchema = z.object({
  allowed: z.array(z.string().max(200)).max(200).optional(),
  blocked: z.array(z.string().max(200)).max(200).optional(),
});

export const soulCommandSchema = z.object({
  command: z.string().min(1).max(5000),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const soulFeedbackSchema = z.object({
  type: z.enum(['praise', 'correction', 'directive', 'personality_tweak']),
  content: z.string().min(1).max(5000),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ─── Subagent Schemas ───────────────────────────────────────────

export const spawnSubagentSchema = z.object({
  name: z.string().min(1).max(200),
  task: z.string().min(1).max(50000),
  parentId: z.string().max(200).optional(),
  parentType: z.enum(['chat', 'background-agent', 'subagent']).optional(),
  context: z.string().max(50000).optional(),
  allowedTools: z.array(z.string().max(200)).max(200).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  limits: z.object({
    maxTokens: z.number().int().min(1).max(128000).optional(),
    maxTurns: z.number().int().min(1).max(100).optional(),
    maxToolCalls: z.number().int().min(1).max(500).optional(),
    timeout: z.number().int().min(1000).max(600000).optional(),
  }).optional(),
});

// ─── Tool Execution Schemas ─────────────────────────────────────

export const executeToolSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const batchExecuteToolsSchema = z.object({
  executions: z.array(z.object({
    tool: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(20),
});

// ─── Voice Schemas ──────────────────────────────────────────────

export const synthesizeVoiceSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().max(100).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  format: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac']).optional(),
});

// ─── Validation Helper ──────────────────────────────────────────

/**
 * Validate request body against a Zod schema.
 * Returns parsed data on success, throws descriptive error on failure.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation failed: ${issues}`);
  }
  return result.data;
}
