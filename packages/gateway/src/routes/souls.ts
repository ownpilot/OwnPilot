/**
 * Soul Routes — CRUD + evolution + versioning
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:agentId/versions, /:agentId/feedback, etc.)
 * 3. Generic dynamic route (/:agentId) - MUST be last
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { AgentSoul } from '@ownpilot/core';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { agentsRepo } from '../db/repositories/agents.js';
import { createTriggersRepository } from '../db/repositories/triggers.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { runAgentHeartbeat } from '../services/soul-heartbeat-service.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';

export const soulRoutes = new Hono();

// ── GET / — list all souls ──────────────────────────

soulRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const rawUserId = c.get('userId') as string | undefined;
    // 'default' is the no-auth fallback — souls have workspace_id=null, so treat it as no filter
    const userId = rawUserId && rawUserId !== 'default' ? rawUserId : null;
    const repo = getSoulsRepository();
    const [souls, total] = await Promise.all([
      repo.list(userId, limit, offset),
      repo.count(userId),
    ]);
    return apiResponse(c, { items: souls, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST / — create soul ────────────────────────────

soulRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();
    if (
      !body.agentId ||
      !body.identity ||
      !body.purpose ||
      !body.autonomy ||
      !body.heartbeat ||
      !body.evolution
    ) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message:
            'Missing required fields: agentId, identity, purpose, autonomy, heartbeat, evolution',
        },
        400
      );
    }
    // Validate autonomy.level range
    const autonomyLevel = (body as Record<string, unknown> & { autonomy?: { level?: unknown } })
      .autonomy?.level;
    if (
      autonomyLevel !== undefined &&
      (typeof autonomyLevel !== 'number' ||
        !Number.isInteger(autonomyLevel) ||
        autonomyLevel < 0 ||
        autonomyLevel > 4)
    ) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'autonomy.level must be an integer 0–4' },
        400
      );
    }

    // Only pass known soul fields — prevent mass assignment of internal DB columns
    const soulData = {
      agentId: body.agentId as string,
      identity: body.identity,
      purpose: body.purpose,
      autonomy: body.autonomy,
      heartbeat: body.heartbeat,
      relationships: body.relationships,
      evolution: body.evolution,
      bootSequence: body.bootSequence,
      provider: body.provider,
      skillAccess: body.skillAccess,
    };
    const soul = await getSoulsRepository().create(soulData);
    return apiResponse(c, soul, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /deploy — atomic agent + soul + trigger creation ─────────────────

soulRoutes.post('/deploy', async (c) => {
  try {
    const body = await c.req.json<{
      identity: {
        name: string;
        emoji?: string;
        role?: string;
        personality?: string;
        voice?: { tone?: string; language?: string; quirks?: string[] };
        boundaries?: string[];
      };
      purpose?: {
        mission?: string;
        goals?: string[];
        expertise?: string[];
        toolPreferences?: string[];
      };
      autonomy?: {
        level?: number;
        allowedActions?: string[];
        blockedActions?: string[];
        requiresApproval?: string[];
        maxCostPerCycle?: number;
        maxCostPerDay?: number;
        maxCostPerMonth?: number;
      };
      heartbeat?: {
        enabled?: boolean;
        interval?: string;
        checklist?: unknown[];
        selfHealingEnabled?: boolean;
        maxDurationMs?: number;
      };
      relationships?: {
        delegates?: string[];
        peers?: string[];
        channels?: string[];
      };
      evolution?: {
        evolutionMode?: 'manual' | 'supervised' | 'autonomous';
        coreTraits?: string[];
        mutableTraits?: string[];
      };
      bootSequence?: {
        onStart?: string[];
        onHeartbeat?: string[];
        onMessage?: string[];
      };
      provider?: string;
      model?: string;
      skillAccess?: {
        allowed: string[];
        blocked?: string[];
      };
    }>();

    // Validate autonomy.level range
    const autonomyLevel = body.autonomy?.level;
    if (
      autonomyLevel !== undefined &&
      (typeof autonomyLevel !== 'number' ||
        !Number.isInteger(autonomyLevel) ||
        autonomyLevel < 0 ||
        autonomyLevel > 4)
    ) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'autonomy.level must be an integer 0–4' },
        400
      );
    }

    // Get default provider/model if not specified
    // Note: settings are loaded from cache synchronously
    const { settingsRepo } = await import('../db/repositories/index.js');
    const defaultProvider = settingsRepo.get<string>('default_ai_provider');
    const defaultModel = settingsRepo.get<string>('default_ai_model');

    const agentProvider = body.provider || defaultProvider || 'default';
    const agentModel = body.model || defaultModel || 'default';

    const agentId = randomUUID();
    let agentName = body.identity?.name ?? 'Unnamed Agent';

    // 1+2. Create agent + soul atomically in a DB transaction.
    // Retries up to 5 times on duplicate name conflict — the whole transaction is
    // retried with an incremented suffix, so no partial state can be left behind.
    let soul;
    let attempts = 0;
    let lastError: unknown = null;
    const adapter = getAdapterSync();

    while (!soul && attempts < 5) {
      try {
        const soulRepo = getSoulsRepository();
        soul = await adapter.transaction(async () => {
          await agentsRepo.create({
            id: agentId,
            name: agentName,
            systemPrompt: '',
            provider: agentProvider,
            model: agentModel,
          });
          return soulRepo.create({
            agentId,
            identity: {
              name: agentName,
              emoji: body.identity?.emoji ?? '🤖',
              role: body.identity?.role ?? 'Agent',
              personality: body.identity?.personality ?? 'Helpful and professional',
              voice: {
                tone: body.identity?.voice?.tone ?? 'neutral',
                language: (body.identity?.voice?.language as 'en' | 'tr' | 'both') ?? 'en',
                quirks: body.identity?.voice?.quirks ?? [],
              },
              boundaries: body.identity?.boundaries ?? [],
            },
            purpose: {
              mission: body.purpose?.mission ?? 'Assist with tasks',
              goals: body.purpose?.goals ?? [],
              expertise: body.purpose?.expertise ?? [],
              toolPreferences: body.purpose?.toolPreferences ?? [],
            },
            autonomy: {
              level: (body.autonomy?.level as 0 | 1 | 2 | 3 | 4) ?? 3,
              allowedActions: body.autonomy?.allowedActions ?? [
                'search_web',
                'create_note',
                'read_url',
                'search_memories',
              ],
              blockedActions: body.autonomy?.blockedActions ?? ['delete_data', 'execute_code'],
              requiresApproval: body.autonomy?.requiresApproval ?? ['send_message_to_user'],
              maxCostPerCycle: body.autonomy?.maxCostPerCycle ?? 0.5,
              maxCostPerDay: body.autonomy?.maxCostPerDay ?? 5.0,
              maxCostPerMonth: body.autonomy?.maxCostPerMonth ?? 100.0,
              pauseOnConsecutiveErrors: 5,
              pauseOnBudgetExceeded: true,
              notifyUserOnPause: true,
            },
            heartbeat: {
              enabled: body.heartbeat?.enabled ?? false,
              interval: body.heartbeat?.interval ?? '0 */6 * * *',
              checklist: (body.heartbeat?.checklist as []) ?? [],
              selfHealingEnabled: body.heartbeat?.selfHealingEnabled ?? false,
              maxDurationMs: body.heartbeat?.maxDurationMs ?? 120000,
            },
            relationships: {
              delegates: body.relationships?.delegates ?? [],
              peers: body.relationships?.peers ?? [],
              channels: body.relationships?.channels ?? [],
            },
            evolution: {
              version: 1,
              evolutionMode: body.evolution?.evolutionMode ?? 'supervised',
              coreTraits: body.evolution?.coreTraits ?? [],
              mutableTraits: body.evolution?.mutableTraits ?? [],
              learnings: [],
              feedbackLog: [],
            },
            bootSequence: {
              onStart: body.bootSequence?.onStart ?? [],
              onHeartbeat: body.bootSequence?.onHeartbeat ?? ['read_inbox'],
              onMessage: body.bootSequence?.onMessage ?? [],
            },
            provider: {
              providerId: agentProvider,
              modelId: agentModel,
            },
            skillAccess: {
              allowed: body.skillAccess?.allowed ?? [],
              blocked: body.skillAccess?.blocked ?? [],
            },
          });
        });
      } catch (txErr) {
        lastError = txErr;
        const errorMessage = getErrorMessage(txErr).toLowerCase();
        if (errorMessage.includes('duplicate') && errorMessage.includes('name')) {
          attempts++;
          const randomSuffix = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0');
          agentName = `${body.identity?.name ?? 'Unnamed Agent'} (${randomSuffix})`;
        } else {
          break; // Non-name error — don't retry
        }
      }
    }

    if (!soul) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: `Failed to deploy agent: ${getErrorMessage(lastError)}`,
        },
        500
      );
    }

    // 3. Create heartbeat trigger if enabled and interval is valid
    const CRON_REGEX =
      /^[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+$/;
    if (
      body.heartbeat?.enabled &&
      body.heartbeat?.interval &&
      !CRON_REGEX.test(body.heartbeat.interval.trim())
    ) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'heartbeat.interval must be a valid cron expression (e.g. "0 */6 * * *")',
        },
        400
      );
    }

    let triggerCreated = false;
    if (body.heartbeat?.enabled && body.heartbeat?.interval?.trim()) {
      const triggerRepo = createTriggersRepository();
      try {
        await triggerRepo.create({
          name: `${agentName} Heartbeat`,
          type: 'schedule' as never,
          config: { expression: body.heartbeat.interval } as never,
          action: { type: 'run_heartbeat', agentId } as never,
          enabled: true,
        });
        triggerCreated = true;
      } catch (triggerError) {
        // Trigger creation failure is non-fatal — agent still deployed
      }
    }

    return apiResponse(
      c,
      {
        agentId,
        soul,
        provider: agentProvider,
        model: agentModel,
        triggerCreated,
      },
      201
    );
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SPECIFIC SUB-ROUTES (must come BEFORE /:agentId)
// ═══════════════════════════════════════════════════════════════════════════

// Helper to check if a string looks like a UUID or is a reserved keyword
const RESERVED_KEYWORDS = [
  'test',
  'tools',
  'stats',
  'command',
  'deploy',
  'logs',
  'memories',
  'goals',
  'tasks',
];

/**
 * Validate and protect core traits during soul evolution.
 * AGENT-HIGH-005: Core trait protection - prevents modification of core DNA.
 */
function validateEvolutionChanges(
  existing: AgentSoul,
  updates: Partial<AgentSoul>
): { valid: true } | { valid: false; error: string } {
  // If no evolution updates, it's valid
  if (!updates.evolution) {
    return { valid: true };
  }

  const newCoreTraits = updates.evolution.coreTraits;
  const oldCoreTraits = existing.evolution.coreTraits;

  // Check if coreTraits is being modified
  if (newCoreTraits !== undefined) {
    // Core traits can only be set during creation (when existing is empty)
    // or if they remain exactly the same
    const isSame =
      newCoreTraits.length === oldCoreTraits.length &&
      newCoreTraits.every((trait: string, i: number) => trait === oldCoreTraits[i]);

    if (!isSame && oldCoreTraits.length > 0) {
      return {
        valid: false,
        error:
          'Core traits (DNA) cannot be modified after creation. Use mutableTraits for evolution.',
      };
    }
  }

  // Validate evolution mode transitions
  const oldMode = existing.evolution.evolutionMode;
  const newMode = updates.evolution.evolutionMode;

  if (newMode && newMode !== oldMode) {
    // Prevent direct transition from manual to autonomous (must go through supervised)
    if (oldMode === 'manual' && newMode === 'autonomous') {
      return {
        valid: false,
        error:
          'Cannot transition directly from manual to autonomous evolution. Use supervised first.',
      };
    }
  }

  return { valid: true };
}

// ── GET /:agentId/logs — get agent execution logs ─────────────────────────

soulRoutes.get('/:agentId/logs', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get recent heartbeat logs
    const logs = await hbRepo.listByAgent(agentId, limit, offset);
    const stats = await hbRepo.getStats(agentId);

    return apiResponse(c, {
      agentId,
      logs: logs.map((log) => ({
        id: log.id,
        timestamp: log.createdAt,
        durationMs: log.durationMs,
        cost: log.cost,
        tasksRun: log.tasksRun.length,
        tasksFailed: log.tasksFailed.length,
      })),
      stats: {
        totalCycles: stats?.totalCycles ?? 0,
        successRate: stats ? 1 - stats.failureRate : 0,
        avgCost: stats?.totalCost ? stats.totalCost / stats.totalCycles : 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/memories — get agent memories ───────────────────────────

soulRoutes.get('/:agentId/memories', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get memories for this agent
    const { getServiceRegistry, Services } = await import('@ownpilot/core');
    const registry = getServiceRegistry();
    const memorySvc = registry.get(Services.Memory);

    const memories = await memorySvc.listMemories(agentId, { limit, offset });

    return apiResponse(c, {
      agentId,
      memories: memories.map(
        (m: { id: string; content: string; source?: string; createdAt?: Date }) => ({
          id: m.id,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt,
        })
      ),
      learnings: soul.evolution.learnings.slice(-20),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/goals — get agent goals ─────────────────────────────────

soulRoutes.get('/:agentId/goals', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get goals from goal service
    const { getServiceRegistry, Services } = await import('@ownpilot/core');
    const registry = getServiceRegistry();
    const goalSvc = registry.get(Services.Goal);

    const goals = await goalSvc.listGoals(agentId);

    return apiResponse(c, {
      agentId,
      mission: soul.purpose.mission,
      goals: soul.purpose.goals,
      systemGoals: goals.map(
        (g: { id: string; title: string; status?: string; progress?: number }) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          progress: g.progress,
        })
      ),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/goals — add a goal to agent ────────────────────────────

soulRoutes.post('/:agentId/goals', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = await c.req.json<{ goal: string }>();
    if (!body.goal) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'goal is required' }, 400);
    }

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Add goal to soul
    soul.purpose.goals.push(body.goal);
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(
      c,
      {
        agentId,
        goals: soul.purpose.goals,
      },
      201
    );
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/tasks — get agent current tasks ─────────────────────────

soulRoutes.get('/:agentId/tasks', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get tasks from bootSequence and heartbeat checklist
    const bootTasks = soul.bootSequence?.onHeartbeat ?? [];
    const checklist = soul.heartbeat?.checklist ?? [];

    return apiResponse(c, {
      agentId,
      bootTasks,
      checklist,
      inboxUnread: 0, // Would need to fetch from messages repo
      isRunning: soul.heartbeat.enabled,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/mission — assign a high-level mission ──────────────────

soulRoutes.post('/:agentId/mission', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = await c.req.json<{
      mission: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      deadline?: string;
      autoPlan?: boolean;
    }>();

    if (!body.mission) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'mission is required' },
        400
      );
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Update mission
    soul.purpose.mission = body.mission;
    soul.updatedAt = new Date();

    // If autoPlan, generate tasks from mission (basic implementation)
    if (body.autoPlan) {
      soul.bootSequence.onHeartbeat = [
        'analyze_mission',
        'gather_context',
        'execute_plan',
        'report_results',
      ];
    }

    await repo.update(soul);

    return apiResponse(c, {
      agentId,
      mission: soul.purpose.mission,
      priority: body.priority ?? 'medium',
      status: 'accepted',
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/test — run agent test (immediate heartbeat) ────────────

soulRoutes.post('/:agentId/test', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Check if agent is enabled
    if (!soul.heartbeat.enabled) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Agent is paused. Resume before testing.' },
        400
      );
    }

    // Run heartbeat immediately, forcing all tasks regardless of schedule
    const result = await runAgentHeartbeat(agentId, true);

    if (result.success) {
      return apiResponse(c, {
        success: true,
        message: 'Test run complete. Check the Activity tab for results.',
        agentId,
        completedAt: new Date().toISOString(),
      });
    } else {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: result.error ?? 'Test run failed' },
        500
      );
    }
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/tools — get all tools with permission status ────────────

soulRoutes.get('/:agentId/tools', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get tool registry
    const toolRegistry = getSharedToolRegistry();

    if (!toolRegistry) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Tool registry not available' },
        500
      );
    }

    // Get all registered tools
    const allTools = toolRegistry.getAllTools();
    const allowedTools = new Set(soul.autonomy.allowedActions ?? []);
    const blockedTools = new Set(soul.autonomy.blockedActions ?? []);

    // Categorize tools
    const tools = allTools.map(({ definition }) => {
      const name = definition.name;
      let category = 'core';
      if (name.startsWith('mcp.')) category = 'mcp';
      else if (name.startsWith('custom.')) category = 'custom';
      else if (name.startsWith('ext.')) category = 'custom';
      else if (name.startsWith('skill.')) category = 'custom';
      else if (name.startsWith('plugin.')) category = 'mcp';

      let status: 'allowed' | 'blocked' | 'neutral' = 'neutral';
      if (blockedTools.has(name) || blockedTools.has(name.replace(/^.*?\./, ''))) {
        status = 'blocked';
      } else if (allowedTools.has(name) || allowedTools.has(name.replace(/^.*?\./, ''))) {
        status = 'allowed';
      }

      return {
        name,
        description: definition.description,
        category,
        status,
        provider: (definition as unknown as { providerName?: string }).providerName,
      };
    });

    return apiResponse(c, {
      tools,
      allowed: Array.from(allowedTools),
      blocked: Array.from(blockedTools),
      summary: {
        total: tools.length,
        allowed: tools.filter((t) => t.status === 'allowed').length,
        blocked: tools.filter((t) => t.status === 'blocked').length,
        neutral: tools.filter((t) => t.status === 'neutral').length,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── PUT /:agentId/tools — update tool permissions ─────────────────────────

soulRoutes.put('/:agentId/tools', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = await c.req.json<{ allowed?: string[]; blocked?: string[] }>();
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Update autonomy with new tool lists
    if (body.allowed !== undefined) {
      soul.autonomy.allowedActions = body.allowed;
    }
    if (body.blocked !== undefined) {
      soul.autonomy.blockedActions = body.blocked;
    }
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(c, {
      allowed: soul.autonomy.allowedActions,
      blocked: soul.autonomy.blockedActions,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/command — send direct command to agent ─────────────────

soulRoutes.post('/:agentId/command', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const body = await c.req.json<{ command: string; params?: Record<string, unknown> }>();

    if (!body.command) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing required field: command' },
        400
      );
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Log the command
    const commandLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      command: body.command,
      params: body.params ?? {},
      status: 'pending' as const,
    };

    // Execute known commands
    let result: unknown;
    switch (body.command) {
      case 'run_heartbeat':
        result = { message: 'Heartbeat triggered', agentId };
        break;
      case 'pause':
        await repo.setHeartbeatEnabled(agentId, false);
        soul.heartbeat.enabled = false;
        result = { message: 'Agent paused', agentId };
        break;
      case 'resume':
        await repo.setHeartbeatEnabled(agentId, true);
        soul.heartbeat.enabled = true;
        result = { message: 'Agent resumed', agentId };
        break;
      case 'reset_budget':
        result = { message: 'Budget counters reset (daily auto-reset)', agentId };
        break;
      default:
        result = { message: `Unknown command: ${body.command}`, agentId };
    }

    return apiResponse(c, {
      command: commandLog,
      result,
      agentId,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/stats — get agent statistics ────────────────────────────

soulRoutes.get('/:agentId/stats', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    if (RESERVED_KEYWORDS.includes(agentId)) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Invalid agent ID' }, 404);
    }

    const repo = getSoulsRepository();
    const hbRepo = getHeartbeatLogRepository();

    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Get heartbeat stats
    const stats = await hbRepo.getStats(agentId);
    const recentLogs = await hbRepo.listByAgent(agentId, 10, 0);
    const lastLog = recentLogs[0] ?? null;

    return apiResponse(c, {
      agentId,
      soulVersion: soul.evolution.version,
      heartbeat: {
        enabled: soul.heartbeat.enabled,
        interval: soul.heartbeat.interval,
        lastRunAt: lastLog?.createdAt ?? null,
      },
      stats: {
        totalCycles: stats?.totalCycles ?? 0,
        totalCost: stats?.totalCost ?? 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
        failureRate: stats?.failureRate ?? 0,
      },
      budget: {
        maxCostPerDay: soul.autonomy.maxCostPerDay,
        maxCostPerMonth: soul.autonomy.maxCostPerMonth,
      },
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/versions — version history ────────

soulRoutes.get('/:agentId/versions', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const { limit, offset } = getPaginationParams(c);
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    const versions = await repo.getVersions(soul.id, limit, offset);
    return apiResponse(c, versions);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /:agentId/versions/:v — specific version ────

soulRoutes.get('/:agentId/versions/:v', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const v = parseInt(c.req.param('v'), 10);
    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    const version = await repo.getVersion(soul.id, v);
    if (!version) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Version not found' }, 404);
    }
    return apiResponse(c, version);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST /:agentId/feedback — apply feedback ────────

soulRoutes.post('/:agentId/feedback', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const body = await c.req.json();
    if (!body.type || !body.content) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Missing required fields: type, content' },
        400
      );
    }

    const repo = getSoulsRepository();
    const soul = await repo.getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    // Create version snapshot
    await repo.createVersion(soul, body.content, body.source || 'user');

    // Apply feedback inline (lightweight — no evolution engine dependency)
    const feedback = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: body.type,
      content: body.content,
      appliedToVersion: soul.evolution.version,
      source: body.source || 'user',
    };

    switch (feedback.type) {
      case 'praise':
        soul.evolution.learnings.push(`Positive: ${feedback.content}`);
        break;
      case 'correction':
        soul.identity.boundaries.push(feedback.content);
        soul.evolution.learnings.push(`Correction: ${feedback.content}`);
        break;
      case 'directive':
        soul.purpose.goals.push(feedback.content);
        break;
      case 'personality_tweak':
        soul.evolution.mutableTraits.push(feedback.content);
        soul.evolution.learnings.push(`Personality: ${feedback.content}`);
        break;
    }

    if (soul.evolution.learnings.length > 50) {
      soul.evolution.learnings = soul.evolution.learnings.slice(-50);
    }
    soul.evolution.feedbackLog.push(feedback);
    if (soul.evolution.feedbackLog.length > 100) {
      soul.evolution.feedbackLog = soul.evolution.feedbackLog.slice(-100);
    }
    soul.evolution.version++;
    soul.updatedAt = new Date();
    await repo.update(soul);

    return apiResponse(c, soul);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC DYNAMIC ROUTES (/:agentId) - MUST be last
// These catch-all routes must come after all specific /:agentId/... routes
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /:agentId — get soul by agent ID ────────────

soulRoutes.get('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const soul = await getSoulsRepository().getByAgentId(agentId);
    if (!soul) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    return apiResponse(c, soul);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── PUT /:agentId — update soul ─────────────────────

soulRoutes.put('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const repo = getSoulsRepository();
    const existing = await repo.getByAgentId(agentId);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }

    const body = await c.req.json<Partial<AgentSoul>>();

    // AGENT-HIGH-005: Validate evolution changes protect core traits
    const validation = validateEvolutionChanges(existing, body);
    if (!validation.valid) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: validation.error }, 400);
    }

    // Only allow explicitly listed fields — prevent mass assignment of id, agentId, workspaceId, createdAt
    const allowedUpdates: Partial<AgentSoul> = {};
    if (body.identity !== undefined) allowedUpdates.identity = body.identity;
    if (body.purpose !== undefined) allowedUpdates.purpose = body.purpose;
    if (body.autonomy !== undefined) allowedUpdates.autonomy = body.autonomy;
    if (body.heartbeat !== undefined) allowedUpdates.heartbeat = body.heartbeat;
    if (body.relationships !== undefined) allowedUpdates.relationships = body.relationships;
    if (body.evolution !== undefined) allowedUpdates.evolution = body.evolution;
    if (body.bootSequence !== undefined) allowedUpdates.bootSequence = body.bootSequence;
    if (body.provider !== undefined) allowedUpdates.provider = body.provider;
    if (body.skillAccess !== undefined) allowedUpdates.skillAccess = body.skillAccess;

    const updated = {
      ...existing,
      ...allowedUpdates,
      agentId,
      id: existing.id,
      updatedAt: new Date(),
    };
    await repo.update(updated);
    const soul = await repo.getByAgentId(agentId);
    return apiResponse(c, soul);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── DELETE /:agentId — delete soul ──────────────────

soulRoutes.delete('/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const deleted = await getSoulsRepository().delete(agentId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Soul not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
