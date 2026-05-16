/**
 * Agent-stack request schemas.
 *
 * Covers everything that interacts with running agents:
 *  - agent CRUD              (createAgentSchema, updateAgentSchema)
 *  - direct chat             (chatMessageSchema)
 *  - autonomy policy + caps  (autonomyConfig/Level/Budget, pulseSettings)
 *  - autonomy decision flow  (autonomyDecision, approve/reject, assess,
 *                             approvalRequest, toolPermission)
 *  - command center          (agentCommand, deployFleet, agentMission,
 *                             agentExecute, agentToolsBatchUpdate)
 *  - inter-agent messaging   (sendAgentMessage)
 *  - subagent spawning       (spawnSubagent)
 */

import { z } from 'zod';

// ─── Agent CRUD ──────────────────────────────────────────────────

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

// ─── Chat ────────────────────────────────────────────────────────

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
  pageContext: z
    .object({
      pageType: z.string(),
      entityId: z.string().optional(),
      path: z.string().optional(),
      contextData: z.record(z.string(), z.unknown()).optional(),
      systemPromptHint: z.string().optional(),
    })
    .optional(),
});

// ─── Autonomy ────────────────────────────────────────────────────

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

// ─── Autonomy Decision ───────────────────────────────────────────

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

// ─── Agent Command Center ────────────────────────────────────────

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

// ─── Agent Messages ──────────────────────────────────────────────

const agentAttachmentSchema = z.object({
  type: z.enum(['note', 'task', 'memory', 'data', 'artifact']),
  id: z.string().min(1).max(200),
  title: z.string().max(500).optional(),
});

export const sendAgentMessageSchema = z.object({
  to: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  from: z.string().max(200).optional(),
  type: z
    .enum([
      'task_delegation',
      'task_result',
      'status_update',
      'question',
      'feedback',
      'alert',
      'coordination',
      'knowledge_share',
    ])
    .optional(),
  subject: z.string().max(500).optional(),
  attachments: z.array(agentAttachmentSchema).max(20).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  threadId: z.string().max(200).optional(),
  requiresResponse: z.boolean().optional(),
  deadline: z.string().max(100).optional(),
  crewId: z.string().max(200).optional(),
});

// ─── Subagents ───────────────────────────────────────────────────

export const spawnSubagentSchema = z.object({
  name: z.string().min(1).max(200),
  task: z.string().min(1).max(50000),
  parentId: z.string().max(200).optional(),
  parentType: z.enum(['chat', 'claw', 'subagent']).optional(),
  context: z.string().max(50000).optional(),
  allowedTools: z.array(z.string().max(200)).max(200).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  limits: z
    .object({
      maxTokens: z.number().int().min(1).max(128000).optional(),
      maxTurns: z.number().int().min(1).max(100).optional(),
      maxToolCalls: z.number().int().min(1).max(500).optional(),
      timeout: z.number().int().min(1000).max(600000).optional(),
    })
    .optional(),
});
