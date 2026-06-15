/**
 * Agentic Routes
 *
 * REST API for the Agentic Capability Layer — unified task execution
 * across all agent types (claws, souls, crews, coding agents, workflows,
 * triggers, channels, direct LLM, sandbox, tools).
 *
 * Endpoints:
 *   POST   /agentic/execute      — Execute a task (auto-routed to best executor)
 *   GET    /agentic/executions   — List recent executions with pagination
 *   GET    /agentic/stats        — Aggregated execution statistics
 *   GET    /agentic/executions/:id  — Get a single execution report
 *   POST   /agentic/executions/:id/cancel  — Cancel a running execution
 *   GET    /agentic/capabilities — List all registered capabilities
 *   POST   /agentic/plan         — Analyze + plan without executing
 *
 * Route order matters in Hono:
 * 1. Static routes first (/, /executions, /stats, /capabilities, /plan)
 * 2. Dynamic sub-routes (/:id/cancel)
 * 3. Generic dynamic route (/:id) — MUST be last
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { getCapabilityRegistry, AgenticRouter } from '@ownpilot/core/agentic';
import { getAgenticExecutor } from '../agentic/agentic-executor.js';
import { AgenticOrchestrator } from '@ownpilot/core/agentic';
import type { StepDispatchFn, AgenticReport } from '@ownpilot/core/agentic';
import type { ExecutionStep } from '@ownpilot/core/agentic';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getIntParam,
} from './helpers.js';
import { pagination } from '../middleware/pagination.js';

export const agenticRoutes = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const executeTaskSchema = z.object({
  name: z.string().min(1, 'Task name is required').max(200),
  description: z.string().min(1, 'Task description is required').max(50_000),
  expectedOutput: z.string().max(1000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  trigger: z
    .object({
      type: z.enum(['immediate', 'scheduled', 'interval', 'continuous', 'event', 'condition', 'webhook']),
      cron: z.string().optional(),
      intervalMs: z.number().int().min(1000).optional(),
      eventType: z.string().optional(),
      condition: z.string().optional(),
      timezone: z.string().optional(),
      minDelayMs: z.number().int().optional(),
      idleDelayMs: z.number().int().optional(),
    })
    .optional(),
  constraints: z
    .object({
      maxCostUsd: z.number().min(0).optional(),
      timeoutMs: z.number().int().min(1000).optional(),
      maxTurns: z.number().int().min(1).optional(),
      maxToolCalls: z.number().int().min(1).optional(),
      allowCodeExecution: z.boolean().optional(),
      allowNetwork: z.boolean().optional(),
    })
    .optional(),
  outputRouting: z
    .object({
      memory: z.boolean().optional(),
      artifact: z
        .object({
          name: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

const planTaskSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(50_000),
  expectedOutput: z.string().max(1000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  trigger: z
    .object({
      type: z.enum(['immediate', 'scheduled', 'interval', 'continuous', 'event', 'condition', 'webhook']),
      cron: z.string().optional(),
      intervalMs: z.number().int().min(1000).optional(),
    })
    .optional(),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a gateway-wired orchestrator for each request.
 * Injects the real AgenticGatewayExecutor as the step dispatch handler.
 */
function createOrchestrator(): AgenticOrchestrator {
  const handler: StepDispatchFn = async (step: ExecutionStep, signal?: AbortSignal) => {
    const result = await getAgenticExecutor().dispatch(step, signal);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      costUsd: result.costUsd,
    };
  };
  return new AgenticOrchestrator(undefined, handler);
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST / — Execute a task
 *
 * Accepts a natural-language task description, auto-routes to the optimal
 * executor (claw, coding agent, direct LLM, etc.), executes it, and
 * returns the full AgenticReport.
 */
agenticRoutes.post('/execute', async (c) => {
  const userId = LOCAL_OWNER_ID;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }

  const parsed = executeTaskSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      400
    );
  }

  const input = parsed.data;
  const orchestrator = createOrchestrator();

  try {
    const report = await orchestrator.execute({
      name: input.name,
      description: input.description,
      expectedOutput: input.expectedOutput,
      priority: input.priority,
      trigger: input.trigger
        ? {
            type: input.trigger.type,
            ...(input.trigger.cron ? { cron: input.trigger.cron } : {}),
            ...(input.trigger.intervalMs ? { intervalMs: input.trigger.intervalMs } : {}),
            ...(input.trigger.eventType ? { eventType: input.trigger.eventType } : {}),
            ...(input.trigger.condition ? { condition: input.trigger.condition } : {}),
            ...(input.trigger.timezone ? { timezone: input.trigger.timezone } : {}),
            ...(input.trigger.minDelayMs ? { minDelayMs: input.trigger.minDelayMs } : {}),
            ...(input.trigger.idleDelayMs ? { idleDelayMs: input.trigger.idleDelayMs } : {}),
          }
        : undefined,
      constraints: input.constraints,
      outputRouting: input.outputRouting,
    });

    const status = report.status === 'completed' ? 201 : 202;

    return apiResponse(
      c,
      {
        id: report.id,
        status: report.status,
        summary: report.summary,
        totalCostUsd: report.totalCostUsd,
        totalDurationMs: report.totalDurationMs,
        stepCount: report.stepResults.length,
        completedSteps: report.stepResults.filter((r) => r.status === 'completed').length,
        error: report.error,
        steps: report.stepResults.map((r) => ({
          index: r.step.index,
          executorKind: r.step.executorKind,
          capabilityId: r.step.capabilityId,
          status: r.status,
          durationMs: r.durationMs,
          costUsd: r.costUsd,
          error: r.error,
        })),
        startedAt: report.startedAt.toISOString(),
        completedAt: report.completedAt?.toISOString() ?? null,
      },
      status
    );
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Task execution failed'),
      },
      500
    );
  }
});

/**
 * POST /plan — Analyze a task and produce an execution plan without executing
 */
agenticRoutes.post('/plan', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON body' }, 400);
  }

  const parsed = planTaskSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      400
    );
  }

  const input = parsed.data;
  const router = new AgenticRouter();

  try {
    const { analysis, plan } = await router.route({
      name: input.name,
      description: input.description,
      expectedOutput: input.expectedOutput,
      priority: input.priority,
      trigger: input.trigger
        ? {
            type: input.trigger.type,
            ...(input.trigger.cron ? { cron: input.trigger.cron } : {}),
            ...(input.trigger.intervalMs ? { intervalMs: input.trigger.intervalMs } : {}),
          }
        : undefined,
    });

    return apiResponse(c, {
      analysis: {
        suggestedKinds: analysis.suggestedKinds,
        requiresOrchestration: analysis.requiresOrchestration,
        likelyNeedsCodeExecution: analysis.likelyNeedsCodeExecution,
        likelyNeedsExternalData: analysis.likelyNeedsExternalData,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
      },
      plan: {
        steps: plan.steps.map((s) => ({
          index: s.index,
          executorKind: s.executorKind,
          capabilityId: s.capabilityId,
          providerId: s.providerId,
          dependsOn: s.dependsOn,
          timeoutMs: s.timeoutMs,
          retryOnFailure: s.retryOnFailure,
        })),
        estimatedCostUsd: plan.estimatedCostUsd,
        estimatedDurationMs: plan.estimatedDurationMs,
        requiresApproval: plan.requiresApproval,
        fallbackStrategy: plan.fallbackStrategy,
      },
    });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Task analysis failed'),
      },
      500
    );
  }
});

/**
 * GET /executions — List recent executions with pagination
 */
agenticRoutes.get('/executions', pagination(), async (c) => {
  const limit = getIntParam(c, 'limit', 20, 1, 100);
  const offset = getIntParam(c, 'offset', 0, 0, 10_000);

  try {
    const orchestrator = createOrchestrator();
    const executions = await orchestrator.listExecutions(limit, offset);
    const stats = await orchestrator.getStats();

    return apiResponse(c, {
      executions: executions.map((e) => ({
        id: e.id,
        taskName: e.task.name,
        status: e.status,
        summary: e.summary,
        totalCostUsd: e.totalCostUsd,
        totalDurationMs: e.totalDurationMs,
        stepCount: e.stepResults.length,
        startedAt: e.startedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
      })),
      total: stats.totalExecutions,
      limit,
      offset,
    });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to list executions'),
      },
      500
    );
  }
});

/**
 * GET /stats — Aggregated execution statistics
 */
agenticRoutes.get('/stats', async (c) => {
  try {
    const orchestrator = createOrchestrator();
    const stats = await orchestrator.getStats();

    return apiResponse(c, {
      totalExecutions: stats.totalExecutions,
      activeExecutions: stats.activeExecutions,
      totalCostUsd: stats.totalCostUsd,
      successRate: stats.successRate,
      byExecutorKind: stats.byExecutorKind,
    });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to get stats'),
      },
      500
    );
  }
});

/**
 * GET /capabilities — List all registered capabilities
 */
agenticRoutes.get('/capabilities', async (c) => {
  const kind = c.req.query('kind');
  const search = c.req.query('search');
  const provider = c.req.query('provider');

  try {
    const registry = getCapabilityRegistry();
    let capabilities = registry.getAll();

    // Filter by executor kind
    if (kind) {
      const kinds = kind.split(',');
      capabilities = capabilities.filter((cap) => kinds.includes(cap.executorKind));
    }

    // Filter by search keywords
    if (search) {
      const keywords = search.toLowerCase().split(',').map((k) => k.trim());
      capabilities = capabilities.filter((cap) => {
        const searchText = `${cap.name} ${cap.description} ${cap.tags.join(' ')}`.toLowerCase();
        return keywords.some((kw) => searchText.includes(kw));
      });
    }

    // Filter by provider
    if (provider) {
      capabilities = capabilities.filter((cap) => cap.providerId === provider);
    }

    return apiResponse(c, {
      capabilities: capabilities.map((cap) => ({
        id: cap.id,
        name: cap.name,
        description: cap.description,
        executorKind: cap.executorKind,
        providerId: cap.providerId,
        costTier: cap.costTier,
        latencyTier: cap.latencyTier,
        tags: cap.tags,
        requiresApproval: cap.requiresApproval,
      })),
      total: capabilities.length,
    });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to list capabilities'),
      },
      500
    );
  }
});

/**
 * GET /executions/:id — Get a single execution report
 */
agenticRoutes.get('/executions/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Execution ID is required' }, 400);
  }

  try {
    const orchestrator = createOrchestrator();
    const report = await orchestrator.getReport(id);

    if (!report) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Execution not found' }, 404);
    }

    return apiResponse(c, {
      id: report.id,
      task: {
        name: report.task.name,
        description: report.task.description,
        expectedOutput: report.task.expectedOutput,
        priority: report.task.priority,
      },
      status: report.status,
      summary: report.summary,
      totalCostUsd: report.totalCostUsd,
      totalDurationMs: report.totalDurationMs,
      error: report.error,
      steps: report.stepResults.map((r) => ({
        index: r.step.index,
        executorKind: r.step.executorKind,
        capabilityId: r.step.capabilityId,
        status: r.status,
        durationMs: r.durationMs,
        costUsd: r.costUsd,
        error: r.error,
        output: r.output,
      })),
      startedAt: report.startedAt.toISOString(),
      completedAt: report.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to get execution report'),
      },
      500
    );
  }
});

/**
 * POST /executions/:id/cancel — Cancel a running execution
 */
agenticRoutes.post('/executions/:id/cancel', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Execution ID is required' }, 400);
  }

  try {
    const orchestrator = createOrchestrator();
    const cancelled = await orchestrator.cancel(id);

    if (!cancelled) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Execution not found or already completed' },
        404
      );
    }

    return apiResponse(c, { id, status: 'cancelled' });
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(err, 'Failed to cancel execution'),
      },
      500
    );
  }
});
