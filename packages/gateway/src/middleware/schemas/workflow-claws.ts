/**
 * Schemas for the autonomous-execution surface:
 *
 *  - triggers          (createTrigger, TRIGGER_MIN_INTERVAL_MS)
 *  - custom tools      (create/updateCustomTool)
 *  - workflows         (workflowNode/Edge/inputParameter, create/update,
 *                       workflowCopilot)
 *  - claws             (clawMissionContract, clawAutonomyPolicy, clawLimits,
 *                       create/updateClaw)
 *  - artifacts         (create/updateArtifact)
 *  - pulse directives  (pulseDirectives)
 *  - tool execution    (executeTool, batchExecuteTools)
 */

import { z } from 'zod';

// ─── Triggers ────────────────────────────────────────────────────

/**
 * Minimum interval for `schedule`-type triggers in milliseconds (BIZ-003).
 * Anything tighter is a cost-runaway vector — a 1-second interval that fires
 * a chat or workflow action burns wallet at provider-rate-limit speed.
 */
const TRIGGER_MIN_INTERVAL_MS = 60_000;

/**
 * Refine that rejects schedule triggers with sub-minute intervals or
 * obviously hostile cron expressions ("* * * * *"). The full config object
 * remains a record because trigger config shape varies by trigger plugin —
 * only the cost-impacting fields are bounded here.
 */
const triggerConfigRefinement = (
  data: { type: string; config: Record<string, unknown> },
  ctx: z.RefinementCtx
) => {
  if (data.type !== 'schedule') return;
  const cfg = data.config ?? {};
  const intervalRaw = (cfg as { interval_ms?: unknown; intervalMs?: unknown }).interval_ms;
  const intervalCamel = (cfg as { intervalMs?: unknown }).intervalMs;
  const interval =
    typeof intervalRaw === 'number'
      ? intervalRaw
      : typeof intervalCamel === 'number'
        ? intervalCamel
        : null;
  if (interval !== null && interval < TRIGGER_MIN_INTERVAL_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'interval_ms'],
      message: `interval_ms must be >= ${TRIGGER_MIN_INTERVAL_MS} (1 minute) — sub-minute schedules cause cost runaway`,
    });
  }
  const cron = (cfg as { cron?: unknown }).cron;
  if (typeof cron === 'string' && /^\*\s+\*\s+\*\s+\*\s+\*\s*$/.test(cron.trim())) {
    ctx.addIssue({
      code: 'custom',
      path: ['config', 'cron'],
      message:
        '"* * * * *" cron fires every minute — set an explicit minute field if that is intended',
    });
  }
};

/** Max length of a pre-run gating script (chars). */
const MAX_PRERUN_CODE_LENGTH = 10000;

/**
 * Validate the optional zero-token gating / chaining fields on action when
 * present. `action` stays a loose record (payload shape varies by type), so
 * these checks are additive and never reject existing triggers.
 */
const triggerActionRefinement = (
  data: { action?: Record<string, unknown> },
  ctx: z.RefinementCtx
): void => {
  const action = data.action;
  if (!action) return;

  if (action.preRun !== undefined) {
    const preRun = action.preRun as Record<string, unknown> | null;
    if (typeof preRun !== 'object' || preRun === null || typeof preRun.code !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['action', 'preRun'],
        message: 'preRun must be an object with a string "code" field',
      });
    } else {
      if (preRun.code.length > MAX_PRERUN_CODE_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['action', 'preRun', 'code'],
          message: `preRun.code exceeds ${MAX_PRERUN_CODE_LENGTH} characters`,
        });
      }
      if (preRun.timeoutMs !== undefined && typeof preRun.timeoutMs !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['action', 'preRun', 'timeoutMs'],
          message: 'preRun.timeoutMs must be a number',
        });
      }
    }
  }

  if (action.contextFrom !== undefined && typeof action.contextFrom !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['action', 'contextFrom'],
      message: 'contextFrom must be a trigger id string',
    });
  }

  if (action.noAgentMode !== undefined && typeof action.noAgentMode !== 'boolean') {
    ctx.addIssue({
      code: 'custom',
      path: ['action', 'noAgentMode'],
      message: 'noAgentMode must be a boolean',
    });
  }
};

export const createTriggerSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(['schedule', 'event', 'condition', 'webhook']),
    description: z.string().max(2000).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    config: z.record(z.string(), z.unknown()),
    action: z.record(z.string(), z.unknown()),
  })
  .superRefine(triggerConfigRefinement)
  .superRefine(triggerActionRefinement);

// ─── Pulse directives ────────────────────────────────────────────

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

// ─── Custom Tools ────────────────────────────────────────────────

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

// ─── Workflows ───────────────────────────────────────────────────

// Node data uses a permissive record — structural validation is handled by
// validateWorkflowSemantics() which checks per-type required fields.
// A z.union of per-type schemas cannot work here because schemas with fewer
// required fields (e.g. conditionNode: label+expression) match first and
// strip extra keys (e.g. switch node's `cases`), silently losing data.
const workflowNodeDataSchema = z.record(z.string(), z.unknown());
const WORKFLOW_NODE_LIMIT = 500;
const WORKFLOW_EDGE_LIMIT = 500;

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
  nodes: z.array(workflowNodeSchema).max(WORKFLOW_NODE_LIMIT).default([]),
  edges: z.array(workflowEdgeSchema).max(WORKFLOW_EDGE_LIMIT).default([]),
  status: z.enum(['active', 'inactive']).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  inputSchema: z.array(inputParameterSchema).max(20).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  nodes: z.array(workflowNodeSchema).max(WORKFLOW_NODE_LIMIT).optional(),
  edges: z.array(workflowEdgeSchema).max(WORKFLOW_EDGE_LIMIT).optional(),
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

// ─── Artifacts ───────────────────────────────────────────────────

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

export const updateArtifactSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(500000).optional(),
  dataBindings: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  pinned: z.boolean().optional(),
  dashboardPosition: z.number().int().min(0).optional(),
  dashboardSize: z.string().max(50).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

// ─── Claws ───────────────────────────────────────────────────────

const clawMissionContractSchema = z.object({
  successCriteria: z.array(z.string().max(1000)).max(20).optional(),
  deliverables: z.array(z.string().max(1000)).max(20).optional(),
  constraints: z.array(z.string().max(1000)).max(20).optional(),
  escalationRules: z.array(z.string().max(1000)).max(20).optional(),
  evidenceRequired: z.boolean().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

const autonomyDispositionSchema = z.enum(['ask', 'block', 'allow']);

const clawAutonomyPolicySchema = z.object({
  allowSelfModify: z.boolean().optional(),
  allowSubclaws: z.boolean().optional(),
  requireEvidence: z.boolean().optional(),
  destructiveActionPolicy: autonomyDispositionSchema.optional(),
  categoryPolicies: z
    .object({
      filesystem: autonomyDispositionSchema.optional(),
      communication: autonomyDispositionSchema.optional(),
      vcs: autonomyDispositionSchema.optional(),
      deploy: autonomyDispositionSchema.optional(),
      shell: autonomyDispositionSchema.optional(),
    })
    .optional(),
  filesystemScopes: z.array(z.string().max(500)).max(50).optional(),
  maxCostUsdBeforePause: z.number().min(0).optional(),
});

/**
 * Claw resource limits — strict ceilings to prevent cost runaway (BIZ-001).
 * Anything outside these bounds is rejected. All fields optional; the runtime
 * fills in `DEFAULT_CLAW_LIMITS` for missing keys.
 */
export const clawLimitsSchema = z
  .object({
    maxTurnsPerCycle: z.number().int().min(1).max(500).optional(),
    maxToolCallsPerCycle: z.number().int().min(1).max(5_000).optional(),
    // 360/h ≈ once every 10 seconds sustained. Generous but not unbounded.
    maxCyclesPerHour: z.number().int().min(1).max(360).optional(),
    // 1 second minimum, 1 hour maximum per cycle.
    cycleTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    // Hard ceiling on total spend. Operators who need higher caps should set
    // CLAW_MAX_BUDGET_USD env override (not yet implemented — request first).
    totalBudgetUsd: z.number().min(0).max(10_000).optional(),
  })
  .strict();

export const createClawSchema = z.object({
  name: z.string().min(1).max(200),
  mission: z.string().min(1).max(10000),
  mode: z.enum(['continuous', 'interval', 'event', 'single-shot']).optional(),
  allowed_tools: z.array(z.string().max(200)).max(500).optional(),
  limits: clawLimitsSchema.optional(),
  interval_ms: z.number().int().min(1000).optional(),
  event_filters: z.array(z.string().max(500)).max(100).optional(),
  auto_start: z.boolean().optional(),
  stop_condition: z.string().max(2000).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  soul_id: z.string().max(200).optional(),
  sandbox: z.enum(['auto', 'docker', 'local']).optional(),
  coding_agent_provider: z.string().max(100).optional(),
  skills: z.array(z.string().max(200)).max(100).optional(),
  preset: z.string().max(100).optional(),
  mission_contract: clawMissionContractSchema.optional(),
  missionContract: clawMissionContractSchema.optional(),
  autonomy_policy: clawAutonomyPolicySchema.optional(),
  autonomyPolicy: clawAutonomyPolicySchema.optional(),
  learn_skills: z.boolean().optional(),
  learnSkills: z.boolean().optional(),
});

export const updateClawSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mission: z.string().min(1).max(10000).optional(),
  mode: z.enum(['continuous', 'interval', 'event', 'single-shot']).optional(),
  allowed_tools: z.array(z.string().max(200)).max(500).optional(),
  allowedTools: z.array(z.string().max(200)).max(500).optional(),
  limits: clawLimitsSchema.optional(),
  interval_ms: z.number().int().min(1000).nullable().optional(),
  intervalMs: z.number().int().min(1000).nullable().optional(),
  event_filters: z.array(z.string().max(500)).max(100).optional(),
  eventFilters: z.array(z.string().max(500)).max(100).optional(),
  auto_start: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  stop_condition: z.string().max(2000).nullable().optional(),
  stopCondition: z.string().max(2000).nullable().optional(),
  provider: z.string().max(100).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  soul_id: z.string().max(200).nullable().optional(),
  soulId: z.string().max(200).nullable().optional(),
  sandbox: z.enum(['auto', 'docker', 'local']).optional(),
  coding_agent_provider: z.string().max(100).nullable().optional(),
  codingAgentProvider: z.string().max(100).nullable().optional(),
  skills: z.array(z.string().max(200)).max(100).optional(),
  preset: z.string().max(100).nullable().optional(),
  mission_contract: clawMissionContractSchema.nullable().optional(),
  missionContract: clawMissionContractSchema.nullable().optional(),
  autonomy_policy: clawAutonomyPolicySchema.nullable().optional(),
  autonomyPolicy: clawAutonomyPolicySchema.nullable().optional(),
  learn_skills: z.boolean().optional(),
  learnSkills: z.boolean().optional(),
});

// ─── Claw small actions ──────────────────────────────────────────

export const clawMessageSchema = z.object({
  message: z.string().min(1).max(10_000),
});

export const clawDenyEscalationSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const clawApplyRecommendationsSchema = z.object({
  ids: z.array(z.string().max(200)).max(500).optional(),
});

export const clawNextIntentSchema = z.object({
  intent: z.string().min(1).max(10_000),
});

// ─── Tool Execution ──────────────────────────────────────────────

export const executeToolSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const batchExecuteToolsSchema = z.object({
  executions: z
    .array(
      z.object({
        tool: z.string().min(1).max(200),
        arguments: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1)
    .max(20),
});
