/**
 * Claws Routes
 *
 * REST API for managing Claw agents (unified autonomous runtime).
 *
 * Route order matters in Hono:
 * 1. Static routes first (/)
 * 2. Specific sub-routes (/:id/start, /:id/history, etc.)
 * 3. Generic dynamic route (/:id) - MUST be last
 */

import { Hono } from 'hono';
import type { z } from 'zod';
import type {
  ClawAutonomyPolicy,
  ClawConfig,
  ClawHealthStatus,
  ClawMissionContract,
  ClawMode,
  ClawSession,
  UpdateClawInput,
} from '@ownpilot/core';
import { getClawService } from '../services/claw-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { validateBody, createClawSchema, updateClawSchema } from '../middleware/validation.js';

export const clawRoutes = new Hono();

const CLAW_PRESETS = [
  {
    id: 'research',
    name: 'Research Agent',
    icon: 'search',
    description: 'Web research with final report',
    mission:
      'Research the given topic thoroughly using web search, browse relevant pages, extract key information, and compile a comprehensive report with sources.',
    mode: 'single-shot' as const,
    sandbox: 'auto' as const,
    successCriteria: ['Relevant sources reviewed', 'Findings are synthesized, not copied'],
    deliverables: ['Report with source links', 'Open questions and confidence notes'],
    constraints: ['Do not invent citations', 'Separate facts from interpretation'],
  },
  {
    id: 'code-review',
    name: 'Code Reviewer',
    icon: 'review',
    description: 'Deep code review with CLI tools',
    mission:
      'Review the codebase for quality issues, security vulnerabilities, performance problems, and best practice violations. Use CLI tools and coding agents to analyze. Produce a detailed review report.',
    mode: 'single-shot' as const,
    sandbox: 'local' as const,
    codingAgentProvider: 'claude-code',
    successCriteria: ['Findings are actionable', 'Claims reference files, tests, or commands'],
    deliverables: ['Severity-ranked findings', 'Verification commands'],
    constraints: ['Avoid style-only nitpicks', 'Do not change files unless explicitly asked'],
  },
  {
    id: 'bug-reproducer',
    name: 'Bug Reproducer',
    icon: 'bug',
    description: 'Reproduce, isolate, and document bugs',
    mission:
      'Reproduce the reported bug, isolate the smallest failing path, capture evidence, and propose the safest fix path with verification steps.',
    mode: 'single-shot' as const,
    sandbox: 'local' as const,
    codingAgentProvider: 'codex',
    successCriteria: [
      'Bug is reproduced or clearly ruled out',
      'Root cause hypothesis is evidence-backed',
    ],
    deliverables: ['Reproduction steps', 'Root cause notes', 'Suggested fix and tests'],
    constraints: ['Do not apply broad refactors', 'Preserve unrelated user changes'],
  },
  {
    id: 'monitor',
    name: 'Monitor & Alert',
    icon: 'monitor',
    description: 'Periodic health checks with alerts',
    mission:
      'Periodically check the specified URLs/APIs for availability, response time, and content changes. Send alerts via claw_send_output when issues are detected.',
    mode: 'interval' as const,
    sandbox: 'auto' as const,
    successCriteria: ['Failures are detected quickly', 'False positives are minimized'],
    deliverables: ['Status updates', 'Incident summary when issues occur'],
    constraints: ['Escalate before destructive remediation'],
  },
  {
    id: 'event-reactor',
    name: 'Event Reactor',
    icon: 'event',
    description: 'Event-driven reactive automation',
    mission:
      'Listen for system events and react intelligently. Process incoming data, make decisions, update goals, and coordinate with other claws via messaging.',
    mode: 'event' as const,
    sandbox: 'auto' as const,
    successCriteria: [
      'Only relevant events trigger action',
      'Actions are idempotent where possible',
    ],
    deliverables: ['Action log', 'Escalation when event data is ambiguous'],
    constraints: ['Ignore events outside configured filters'],
  },
];

type UpdateClawBody = z.infer<typeof updateClawSchema>;

function mapUpdateBody(body: UpdateClawBody): UpdateClawInput {
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.mission !== undefined) updates.mission = body.mission;
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.allowed_tools !== undefined) updates.allowedTools = body.allowed_tools;
  if (body.allowedTools !== undefined) updates.allowedTools = body.allowedTools;
  if (body.limits !== undefined) updates.limits = body.limits as Record<string, number>;
  if (body.interval_ms !== undefined && body.interval_ms !== null)
    updates.intervalMs = body.interval_ms;
  if (body.intervalMs !== undefined && body.intervalMs !== null)
    updates.intervalMs = body.intervalMs;
  if (body.event_filters !== undefined) updates.eventFilters = body.event_filters;
  if (body.eventFilters !== undefined) updates.eventFilters = body.eventFilters;
  if (body.auto_start !== undefined) updates.autoStart = body.auto_start;
  if (body.autoStart !== undefined) updates.autoStart = body.autoStart;
  if (body.stop_condition !== undefined) updates.stopCondition = body.stop_condition;
  if (body.stopCondition !== undefined) updates.stopCondition = body.stopCondition;
  if (body.provider !== undefined) updates.provider = body.provider;
  if (body.model !== undefined) updates.model = body.model;
  if (body.soul_id !== undefined) updates.soulId = body.soul_id;
  if (body.soulId !== undefined) updates.soulId = body.soulId;
  if (body.sandbox !== undefined) updates.sandbox = body.sandbox;
  if (body.coding_agent_provider !== undefined) {
    updates.codingAgentProvider = body.coding_agent_provider;
  }
  if (body.codingAgentProvider !== undefined)
    updates.codingAgentProvider = body.codingAgentProvider;
  if (body.skills !== undefined) updates.skills = body.skills;
  if (body.preset !== undefined) updates.preset = body.preset;
  if (body.mission_contract !== undefined) updates.missionContract = body.mission_contract;
  if (body.missionContract !== undefined) updates.missionContract = body.missionContract;
  if (body.autonomy_policy !== undefined) updates.autonomyPolicy = body.autonomy_policy;
  if (body.autonomyPolicy !== undefined) updates.autonomyPolicy = body.autonomyPolicy;

  return updates as UpdateClawInput;
}

function scoreContract(config: ClawConfig): number {
  let score = 0;
  if (config.missionContract?.successCriteria?.length) score += 35;
  if (config.missionContract?.deliverables?.length) score += 25;
  if (config.missionContract?.constraints?.length) score += 15;
  if (config.missionContract?.evidenceRequired) score += 15;
  if (config.stopCondition) score += 10;
  return Math.min(score, 100);
}

function buildHealthStatus(config: ClawConfig, session: ClawSession | null): ClawHealthStatus {
  const contractScore = scoreContract(config);
  const signals: string[] = [];
  const recommendations: string[] = [];
  const policyWarnings: string[] = [];

  if (contractScore < 60) {
    signals.push('weak mission contract');
    recommendations.push('Add success criteria, deliverables, constraints, and a stop condition');
  }
  if (config.autonomyPolicy?.destructiveActionPolicy === 'allow') {
    policyWarnings.push('destructive actions are allowed');
    recommendations.push('Use ask or block for destructive actions unless this claw is trusted');
  }
  if (config.autonomyPolicy?.allowSelfModify) {
    policyWarnings.push('self-modification is enabled');
  }
  if (config.mode === 'event' && (config.eventFilters?.length ?? 0) === 0) {
    signals.push('event mode without filters');
    recommendations.push('Add event filters or switch to interval mode');
  }

  if (!session) {
    return {
      score: Math.max(35, Math.min(80, 65 + Math.floor((contractScore - 60) / 4))),
      status: contractScore < 60 ? 'watch' : 'idle',
      signals: signals.length ? signals : ['not running'],
      recommendations: recommendations.length ? recommendations : ['Start the claw when ready'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.state === 'failed') {
    return {
      score: 10,
      status: 'failed',
      signals: ['failed', ...signals],
      recommendations: [
        'Open history and fix the last failure before restarting',
        ...recommendations,
      ],
      contractScore,
      policyWarnings,
    };
  }
  if (session.lastCycleError) {
    return {
      score: 35,
      status: 'watch',
      signals: [`last error: ${session.lastCycleError}`, ...signals],
      recommendations: ['Inspect the last cycle error and adjust tools, model, or permissions'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.totalCostUsd >= (session.config.limits?.totalBudgetUsd ?? Infinity)) {
    return {
      score: 25,
      status: 'expensive',
      signals: ['budget cap reached', ...signals],
      recommendations: ['Raise the budget, narrow the mission, or stop the claw'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.state === 'waiting') {
    return {
      score: contractScore < 60 ? 55 : 75,
      status: contractScore < 60 ? 'watch' : 'idle',
      signals: ['waiting for event', ...signals],
      recommendations: recommendations.length ? recommendations : ['No action needed'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.cyclesCompleted > 0 && session.totalToolCalls === 0) {
    return {
      score: 45,
      status: 'stuck',
      signals: ['cycles completed without tool calls', ...signals],
      recommendations: ['Review tool access, mission clarity, and model routing'],
      contractScore,
      policyWarnings,
    };
  }

  return {
    score: contractScore < 60 ? 68 : 92,
    status: contractScore < 60 ? 'watch' : 'healthy',
    signals: signals.length ? signals : ['active'],
    recommendations: recommendations.length ? recommendations : ['No action needed'],
    contractScore,
    policyWarnings,
  };
}

function getHealthForConfig(config: ClawConfig, sessions: ClawSession[]): ClawHealthStatus {
  return buildHealthStatus(config, sessions.find((s) => s.config.id === config.id) ?? null);
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findPreset(config: ClawConfig): (typeof CLAW_PRESETS)[number] | undefined {
  return CLAW_PRESETS.find((preset) => preset.id === config.preset);
}

function buildSafeFixPatch(config: ClawConfig): {
  patch: UpdateClawInput;
  applied: string[];
  skipped: string[];
} {
  const patch: UpdateClawInput = {};
  const applied: string[] = [];
  const skipped: string[] = [];
  const preset = findPreset(config);
  const currentContract = config.missionContract;

  const missionContract: ClawMissionContract = {
    successCriteria: currentContract?.successCriteria?.length
      ? currentContract.successCriteria
      : (preset?.successCriteria ?? ['Mission outcome is complete, specific, and verifiable']),
    deliverables: currentContract?.deliverables?.length
      ? currentContract.deliverables
      : (preset?.deliverables ?? ['Final artifact or report with decisions and evidence']),
    constraints: currentContract?.constraints?.length
      ? currentContract.constraints
      : (preset?.constraints ?? ['Do not perform destructive actions without approval']),
    escalationRules: currentContract?.escalationRules?.length
      ? currentContract.escalationRules
      : [
          'Escalate when permissions, budget, missing context, or destructive actions block progress',
        ],
    evidenceRequired: true,
    minConfidence: Math.max(currentContract?.minConfidence ?? 0.8, 0.8),
  };

  const contractChanged =
    !currentContract ||
    !arraysEqual(currentContract.successCriteria, missionContract.successCriteria) ||
    !arraysEqual(currentContract.deliverables, missionContract.deliverables) ||
    !arraysEqual(currentContract.constraints, missionContract.constraints) ||
    !arraysEqual(currentContract.escalationRules, missionContract.escalationRules) ||
    currentContract.evidenceRequired !== missionContract.evidenceRequired ||
    currentContract.minConfidence !== missionContract.minConfidence;

  if (contractChanged) {
    patch.missionContract = missionContract;
    applied.push('mission_contract');
  }

  if (!config.stopCondition) {
    patch.stopCondition = config.mode === 'single-shot' ? 'on_report' : 'idle:3';
    applied.push('stop_condition');
  }

  const currentPolicy = config.autonomyPolicy;
  const autonomyPolicy: ClawAutonomyPolicy = {
    allowSelfModify: false,
    allowSubclaws: currentPolicy?.allowSubclaws ?? true,
    requireEvidence: true,
    destructiveActionPolicy:
      currentPolicy?.destructiveActionPolicy === 'allow'
        ? 'ask'
        : (currentPolicy?.destructiveActionPolicy ?? 'ask'),
    filesystemScopes: currentPolicy?.filesystemScopes ?? [],
    maxCostUsdBeforePause: currentPolicy?.maxCostUsdBeforePause,
  };

  const policyChanged =
    !currentPolicy ||
    currentPolicy.allowSelfModify !== autonomyPolicy.allowSelfModify ||
    currentPolicy.allowSubclaws !== autonomyPolicy.allowSubclaws ||
    currentPolicy.requireEvidence !== autonomyPolicy.requireEvidence ||
    currentPolicy.destructiveActionPolicy !== autonomyPolicy.destructiveActionPolicy ||
    !arraysEqual(currentPolicy.filesystemScopes, autonomyPolicy.filesystemScopes) ||
    currentPolicy.maxCostUsdBeforePause !== autonomyPolicy.maxCostUsdBeforePause;

  if (policyChanged) {
    patch.autonomyPolicy = autonomyPolicy;
    applied.push('autonomy_policy');
  }

  if (config.mode === 'event' && (config.eventFilters?.length ?? 0) === 0) {
    skipped.push('event_filters requires a project-specific event source');
  }

  return { patch, applied, skipped };
}

// =============================================================================
// 1. STATIC ROUTES
// =============================================================================

// GET /presets - Productized claw loadouts
clawRoutes.get('/presets', (c) => {
  return apiResponse(c, { presets: CLAW_PRESETS });
});

// GET /recommendations - Operational recommendations for claws that need attention
clawRoutes.get('/recommendations', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getClawService();
    const configs = await service.listClaws(userId);
    const sessions = service.listSessions(userId);

    const recommendations = configs
      .map((config) => {
        const health = getHealthForConfig(config, sessions);
        return {
          clawId: config.id,
          name: config.name,
          status: health.status,
          score: health.score,
          signals: health.signals,
          recommendations: health.recommendations,
        };
      })
      .filter((item) => item.status !== 'healthy' || item.score < 80)
      .sort((a, b) => a.score - b.score);

    return apiResponse(c, { recommendations });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /recommendations/apply - Apply conservative fixes to attention claws
clawRoutes.post('/recommendations/apply', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.ids)
      ? new Set(body.ids.filter((id: unknown): id is string => typeof id === 'string'))
      : null;
    const service = getClawService();
    const configs = await service.listClaws(userId);
    const sessions = service.listSessions(userId);
    const { getClawManager } = await import('../services/claw-manager.js');

    const targets = configs.filter((config) => {
      if (requestedIds && !requestedIds.has(config.id)) return false;
      const health = getHealthForConfig(config, sessions);
      return health.status !== 'healthy' || health.score < 80;
    });

    const results: Array<{
      clawId: string;
      name: string;
      applied: string[];
      skipped: string[];
    }> = [];
    for (const config of targets) {
      const fixes = buildSafeFixPatch(config);
      if (fixes.applied.length === 0) {
        results.push({
          clawId: config.id,
          name: config.name,
          applied: [],
          skipped: fixes.skipped,
        });
        continue;
      }

      const updated = await service.updateClaw(config.id, userId, fixes.patch);
      if (!updated) {
        results.push({
          clawId: config.id,
          name: config.name,
          applied: [],
          skipped: ['claw was not found during update'],
        });
        continue;
      }

      getClawManager().updateClawConfig(config.id, updated);
      results.push({
        clawId: config.id,
        name: config.name,
        applied: fixes.applied,
        skipped: fixes.skipped,
      });
    }

    return apiResponse(c, {
      results,
      updated: results.filter((result) => result.applied.length > 0).length,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET / - List all claws
clawRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getClawService();

    const configs = await service.listClaws(userId);
    const sessions = service.listSessions(userId);

    const claws = configs.map((config) => {
      const session = sessions.find((s) => s.config.id === config.id);
      return {
        ...config,
        health: buildHealthStatus(config, session ?? null),
        session: session
          ? {
              state: session.state,
              cyclesCompleted: session.cyclesCompleted,
              totalToolCalls: session.totalToolCalls,
              totalCostUsd: session.totalCostUsd,
              lastCycleAt: session.lastCycleAt,
              lastCycleDurationMs: session.lastCycleDurationMs,
              lastCycleError: session.lastCycleError,
              startedAt: session.startedAt,
              stoppedAt: session.stoppedAt,
              artifacts: session.artifacts,
              pendingEscalation: session.pendingEscalation,
            }
          : null,
      };
    });

    return apiResponse(c, claws);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /stats - Aggregate claw statistics
clawRoutes.get('/stats', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getClawService();
    const configs = await service.listClaws(userId);
    const sessions = service.listSessions(userId);

    const totalCost = sessions.reduce((s, ses) => s + ses.totalCostUsd, 0);
    const totalCycles = sessions.reduce((s, ses) => s + ses.cyclesCompleted, 0);
    const totalToolCalls = sessions.reduce((s, ses) => s + ses.totalToolCalls, 0);

    const byMode: Record<string, number> = {};
    const byState: Record<string, number> = {};
    const byHealth: Record<string, number> = {};
    for (const c of configs) {
      byMode[c.mode] = (byMode[c.mode] ?? 0) + 1;
      const state = sessions.find((s) => s.config.id === c.id)?.state ?? 'stopped';
      byState[state] = (byState[state] ?? 0) + 1;
      const health = getHealthForConfig(c as ClawConfig, sessions).status;
      byHealth[health] = (byHealth[health] ?? 0) + 1;
    }

    return apiResponse(c, {
      total: configs.length,
      running: sessions.filter((s) => ['running', 'starting', 'waiting'].includes(s.state)).length,
      needsAttention: configs.filter((cfg) =>
        ['watch', 'stuck', 'expensive', 'failed'].includes(getHealthForConfig(cfg, sessions).status)
      ).length,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalCycles,
      totalToolCalls,
      byMode,
      byState,
      byHealth,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST / - Create a new claw
clawRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(createClawSchema, await c.req.json());

    const service = getClawService();

    const config = await service.createClaw({
      userId,
      name: body.name,
      mission: body.mission,
      mode: (body.mode as ClawMode) ?? 'continuous',
      allowedTools: body.allowed_tools,
      limits: body.limits as Record<string, number> | undefined,
      intervalMs: body.interval_ms,
      eventFilters: body.event_filters,
      autoStart: body.auto_start ?? false,
      stopCondition: body.stop_condition,
      provider: body.provider,
      model: body.model,
      soulId: body.soul_id,
      sandbox: body.sandbox as 'docker' | 'local' | 'auto' | undefined,
      codingAgentProvider: body.coding_agent_provider,
      skills: body.skills,
      preset: body.preset,
      missionContract: body.mission_contract ?? body.missionContract,
      autonomyPolicy: body.autonomy_policy ?? body.autonomyPolicy,
    });

    return apiResponse(c, config, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 2. SUB-ROUTES (before /:id)
// =============================================================================

// GET /:id/doctor - Preview safe operational fixes for a claw
clawRoutes.get('/:id/doctor', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const config = await service.getClaw(id, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    const session = service.getSession(id, userId);
    const health = buildHealthStatus(config, session);
    const fixes = buildSafeFixPatch(config);

    return apiResponse(c, {
      health,
      patch: fixes.patch,
      applied: fixes.applied,
      skipped: fixes.skipped,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/apply-recommendations - Apply conservative config fixes
clawRoutes.post('/:id/apply-recommendations', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const config = await service.getClaw(id, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    const fixes = buildSafeFixPatch(config);
    if (fixes.applied.length === 0) {
      return apiResponse(c, {
        applied: [],
        skipped: fixes.skipped,
        claw: config,
        health: buildHealthStatus(config, service.getSession(id, userId)),
      });
    }

    const updated = await service.updateClaw(id, userId, fixes.patch);
    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    const { getClawManager } = await import('../services/claw-manager.js');
    getClawManager().updateClawConfig(id, updated);

    return apiResponse(c, {
      applied: fixes.applied,
      skipped: fixes.skipped,
      claw: updated,
      health: buildHealthStatus(updated, service.getSession(id, userId)),
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/start
clawRoutes.post('/:id/start', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const session = await service.startClaw(id, userId);
    return apiResponse(c, { state: session.state, startedAt: session.startedAt });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/pause
clawRoutes.post('/:id/pause', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const paused = await service.pauseClaw(id, userId);
    if (!paused) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Claw not running or not found' },
        404
      );
    }
    return apiResponse(c, { paused: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/resume
clawRoutes.post('/:id/resume', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const resumed = await service.resumeClaw(id, userId);
    if (!resumed) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Claw not paused or not found' },
        404
      );
    }
    return apiResponse(c, { resumed: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/stop
clawRoutes.post('/:id/stop', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const stopped = await service.stopClaw(id, userId);
    if (!stopped) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Claw not running or not found' },
        404
      );
    }
    return apiResponse(c, { stopped: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/execute
clawRoutes.post('/:id/execute', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const result = await service.executeNow(id, userId);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/message
clawRoutes.post('/:id/message', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const body = await c.req.json();

    if (!body.message || typeof body.message !== 'string') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'message is required' },
        400
      );
    }

    const service = getClawService();
    await service.sendMessage(id, userId, body.message);
    return apiResponse(c, { sent: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/history
clawRoutes.get('/:id/history', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const { limit, offset } = getPaginationParams(c);
    const service = getClawService();

    const { entries, total } = await service.getHistory(id, userId, limit, offset);
    return apiResponse(c, { entries, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:id/audit — Get audit log (per-tool-call tracking)
clawRoutes.get('/:id/audit', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const { limit, offset } = getPaginationParams(c);
    const category = c.req.query('category');

    // F-003: Enforce ownership — audit log is only accessible to the claw owner
    const service = getClawService();
    const config = await service.getClaw(id, userId);
    if (!config) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' },
        404
      );
    }

    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    const result = await repo.getAuditLog(id, limit, offset, category || undefined);

    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/approve-escalation
clawRoutes.post('/:id/approve-escalation', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const approved = await service.approveEscalation(id, userId);
    if (!approved) {
      return apiError(
        c,
        {
          code: ERROR_CODES.NOT_FOUND,
          message: 'No pending escalation or claw not found',
        },
        404
      );
    }
    return apiResponse(c, { approved: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:id/deny-escalation
clawRoutes.post('/:id/deny-escalation', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    const service = getClawService();

    const denied = await service.denyEscalation(id, userId, reason);
    if (!denied) {
      return apiError(
        c,
        {
          code: ERROR_CODES.NOT_FOUND,
          message: 'No pending escalation or claw not found',
        },
        404
      );
    }
    return apiResponse(c, { denied: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// 3. GENERIC DYNAMIC ROUTE (must be last)
// =============================================================================

// GET /:id
clawRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const config = await service.getClaw(id, userId);
    if (!config) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    const session = service.getSession(id, userId);

    return apiResponse(c, {
      ...config,
      health: buildHealthStatus(config, session),
      session: session
        ? {
            state: session.state,
            cyclesCompleted: session.cyclesCompleted,
            totalToolCalls: session.totalToolCalls,
            totalCostUsd: session.totalCostUsd,
            lastCycleAt: session.lastCycleAt,
            lastCycleDurationMs: session.lastCycleDurationMs,
            lastCycleError: session.lastCycleError,
            startedAt: session.startedAt,
            stoppedAt: session.stoppedAt,
            artifacts: session.artifacts,
            pendingEscalation: session.pendingEscalation,
          }
        : null,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /:id
clawRoutes.put('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const body = validateBody(updateClawSchema, await c.req.json());
    const service = getClawService();

    const updated = await service.updateClaw(id, userId, mapUpdateBody(body));
    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }

    // Hot-reload in-memory config so changes take effect without restart
    const { getClawManager } = await import('../services/claw-manager.js');
    getClawManager().updateClawConfig(id, updated);

    return apiResponse(c, updated);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:id
clawRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const { id } = c.req.param();
    const service = getClawService();

    const deleted = await service.deleteClaw(id, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Claw not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
