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
}).passthrough();

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
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
  }).passthrough()).optional(),
}).passthrough();

// ─── Trigger Schemas ─────────────────────────────────────────────

export const createTriggerSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['schedule', 'event', 'condition', 'webhook']),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: z.record(z.string(), z.unknown()),
  action: z.record(z.string(), z.unknown()),
}).passthrough();

// ─── Plan Schemas ────────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  goal: z.string().min(1).max(5000),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
}).passthrough();

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  goal: z.string().max(5000).optional(),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
}).passthrough();

export const createPlanStepSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan']),
  orderNum: z.number().int().min(0).max(1000),
  description: z.string().max(5000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const updatePlanStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting']).optional(),
  orderNum: z.number().int().min(0).max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

// ─── Autonomy Schemas ────────────────────────────────────────────

export const autonomyConfigSchema = z.object({
  level: z.number().int().min(0).max(5).optional(),
  allowedTools: z.array(z.string().max(100)).optional(),
  blockedTools: z.array(z.string().max(100)).optional(),
  requireApproval: z.boolean().optional(),
  maxCostPerAction: z.number().min(0).max(1000).optional(),
  dailyBudget: z.number().min(0).max(10000).optional(),
}).passthrough();

export const autonomyLevelSchema = z.object({
  level: z.number().int().min(0).max(5),
});

export const autonomyBudgetSchema = z.object({
  dailyBudget: z.number().min(0).max(10000).optional(),
  maxCostPerAction: z.number().min(0).max(1000).optional(),
});

// ─── Custom Tool Schemas ─────────────────────────────────────────

const toolPermissionValues = ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling'] as const;

export const createCustomToolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores'),
  description: z.string().min(1).max(2000),
  code: z.string().min(1).max(50000),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(6).optional(),
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
}).passthrough();

export const updateCustomToolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Tool name must be lowercase with underscores').optional(),
  description: z.string().min(1).max(2000).optional(),
  code: z.string().min(1).max(50000).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  category: z.string().max(50).optional(),
  permissions: z.array(z.enum(toolPermissionValues)).max(6).optional(),
  requiresApproval: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requiredApiKeys: z.array(z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
    docsUrl: z.string().url().max(2000).optional(),
  })).max(10).optional(),
}).passthrough();

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
