/**
 * Integration & infrastructure schemas — everything that wires the platform
 * to the outside world or to long-running identity:
 *
 *  - bridges               (updateBridge)
 *  - browser automation    (browserNavigate, browserAction, createBrowserWorkflow)
 *  - config services       (createConfigService)
 *  - costs                 (costEstimate, costBudget, costRecord)
 *  - crews                 (crewDeploy, crewMessage, crewDelegate, crewSync)
 *  - edge devices          (createEdgeDevice, edgeDeviceCommand)
 *  - local providers       (create/updateLocalProvider)
 *  - provider config       (providerConfig)
 *  - MCP                   (mcpToolCall, createMcpServer, mcpToolSettings)
 *  - plugins               (pluginSettings)
 *  - settings              (default provider/model, api key, allowed dirs,
 *                           tool groups)
 *  - souls                 (createSoul, soulGoal, soulMission, soulTools,
 *                           soulCommand, soulFeedback)
 *  - voice                 (synthesizeVoice)
 *  - notifications         (sendNotification, sendChannelNotification,
 *                           broadcastNotification, notificationPreferences)
 */

import { z } from 'zod';

// ─── Bridges ─────────────────────────────────────────────────────

const bridgeDirectionEnum = z.enum(['source_to_target', 'target_to_source', 'both']);

const validRegex = (val: string, ctx: z.RefinementCtx) => {
  try {
    new RegExp(val);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid filter pattern (must be valid regex)',
    });
  }
};

export const createBridgeSchema = z
  .object({
    sourceChannelId: z.string().min(1).max(200),
    targetChannelId: z.string().min(1).max(200),
    direction: bridgeDirectionEnum.optional(),
    filterPattern: z.string().max(1000).superRefine(validRegex).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.sourceChannelId !== v.targetChannelId, {
    message: 'Cannot bridge a channel to itself',
    path: ['targetChannelId'],
  });

export const updateBridgeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceChannelId: z.string().max(200).optional(),
  targetChannelId: z.string().max(200).optional(),
  direction: bridgeDirectionEnum.optional(),
  filterPattern: z.string().max(1000).superRefine(validRegex).optional(),
  enabled: z.boolean().optional(),
});

// ─── Browser ─────────────────────────────────────────────────────

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

// ─── Config Services ─────────────────────────────────────────────

export const createConfigServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Must start with lowercase letter, only lowercase/numbers/underscores'
    ),
  displayName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  configSchema: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        label: z.string().max(200).optional(),
        type: z.enum(['string', 'secret', 'url', 'number', 'boolean', 'select', 'json']),
        description: z.string().max(1000).optional(),
        required: z.boolean().optional(),
        defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
        envVar: z.string().max(200).optional(),
        placeholder: z.string().max(500).optional(),
        options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        order: z.number().int().min(0).max(1000).optional(),
      })
    )
    .max(50)
    .optional(),
  requiredBy: z.array(z.string().max(200)).optional(),
  docsUrl: z.string().max(2000).optional(),
});

const configFieldDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  type: z.enum(['string', 'secret', 'url', 'number', 'boolean', 'select', 'json']),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  envVar: z.string().max(200).optional(),
  placeholder: z.string().max(500).optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  order: z.number().int().min(0).max(1000).optional(),
});

export const updateConfigServiceSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  docsUrl: z.string().max(2000).optional(),
  configSchema: z.array(configFieldDefinitionSchema).max(50).optional(),
  multiEntry: z.boolean().optional(),
});

export const createConfigEntrySchema = z.object({
  label: z.string().max(200).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateConfigEntrySchema = z.object({
  label: z.string().max(200).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ─── Costs ───────────────────────────────────────────────────────

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

// ─── Crews ───────────────────────────────────────────────────────

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

// ─── Edge devices ────────────────────────────────────────────────

export const createEdgeDeviceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateEdgeDeviceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).max(100).optional(),
  protocol: z.string().min(1).max(100).optional(),
  sensors: z.array(z.unknown()).max(500).optional(),
  actuators: z.array(z.unknown()).max(500).optional(),
  firmwareVersion: z.string().max(100).optional(),
  firmware_version: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const edgeDeviceCommandSchema = z.object({
  commandType: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
  timeout: z.number().int().positive().max(120000).optional(),
});

// ─── Local providers ─────────────────────────────────────────────

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

// ─── Provider config ─────────────────────────────────────────────

export const providerConfigSchema = z.object({
  baseUrl: z.string().max(2048).optional(),
  providerType: z.string().max(100).optional(),
  isEnabled: z.boolean().optional(),
  apiKeyEnv: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  billingType: z.enum(['pay-per-use', 'subscription', 'free']).optional(),
  subscriptionCostUsd: z.number().min(0).max(10000).optional(),
  subscriptionPlan: z.string().max(200).optional(),
});

// ─── MCP ─────────────────────────────────────────────────────────

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

// ─── Plugins ─────────────────────────────────────────────────────

export const pluginSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

// ─── Settings ────────────────────────────────────────────────────

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

// ─── Souls ───────────────────────────────────────────────────────

export const createSoulSchema = z.object({
  agentId: z.string().min(1).max(200),
  identity: z.record(z.string(), z.unknown()),
  purpose: z.record(z.string(), z.unknown()),
  autonomy: z
    .object({
      level: z.number().int().min(0).max(4).optional(),
    })
    .passthrough(),
  heartbeat: z.object({
    enabled: z.boolean(),
    interval: z.string().min(1).max(100),
    checklist: z
      .array(
        z
          .object({
            id: z.string().optional(),
            task: z.string().min(1),
            type: z.string().optional(),
            priority: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
    quietHours: z
      .object({
        start: z.string(),
        end: z.string(),
        timezone: z.string().optional(),
      })
      .optional(),
    selfHealingEnabled: z.boolean().default(false),
    maxDurationMs: z.number().int().positive().default(120000),
  }),
  evolution: z.record(z.string(), z.unknown()),
  relationships: z.record(z.string(), z.unknown()).optional(),
  bootSequence: z.record(z.string(), z.unknown()).optional(),
});

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

// ─── Voice ───────────────────────────────────────────────────────

export const synthesizeVoiceSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().max(100).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  format: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac']).optional(),
});

// ─── Notifications ───────────────────────────────────────────────

const notificationPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);

export const sendNotificationSchema = z.object({
  userId: z.string().max(200).optional(),
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(10_000),
  priority: notificationPriorityEnum.optional(),
  source: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const sendChannelNotificationSchema = z.object({
  channelId: z.string().min(1).max(200),
  chatId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(10_000),
  priority: notificationPriorityEnum.optional(),
  source: z.string().max(200).optional(),
});

export const broadcastNotificationSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(10_000),
  priority: notificationPriorityEnum.optional(),
  source: z.string().max(200).optional(),
});

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationPreferencesSchema = z.object({
  channelPriority: z.array(z.string().max(200)).max(100).optional(),
  quietHoursStart: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
  quietHoursEnd: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
  quietHoursMinPriority: notificationPriorityEnum.optional(),
  minPriority: notificationPriorityEnum.optional(),
});
