/**
 * Coding Agents Routes
 *
 * API for managing and running external AI coding agents
 * (Claude Code, OpenAI Codex, Google Gemini CLI).
 */

import { Hono } from 'hono';
import type { CodingAgentProvider } from '@ownpilot/core';
import { getCodingAgentService } from '../services/coding-agent-service.js';
import {
  startOrchestration,
  continueOrchestration,
  cancelOrchestration,
  getOrchestration,
  listOrchestrations,
} from '../services/coding-agent-orchestrator.js';
import { codingAgentResultsRepo } from '../db/repositories/coding-agent-results.js';
import { orchestrationRunsRepo } from '../db/repositories/orchestration-runs.js';
import { codingAgentPermissionsRepo } from '../db/repositories/coding-agent-permissions.js';
import { codingAgentSkillAttachmentsRepo } from '../db/repositories/coding-agent-skill-attachments.js';
import { codingAgentSubscriptionsRepo } from '../db/repositories/coding-agent-subscriptions.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
  getPaginationParams,
} from './helpers.js';

const VALID_BUILTIN_PROVIDERS = ['claude-code', 'codex', 'gemini-cli'];

/** Validate provider string: built-in name or 'custom:name' */
function isValidProvider(p: string): boolean {
  return VALID_BUILTIN_PROVIDERS.includes(p) || p.startsWith('custom:');
}

export const codingAgentsRoutes = new Hono();

// =============================================================================
// GET /status - List all provider statuses
// =============================================================================

codingAgentsRoutes.get('/status', async (c) => {
  try {
    const service = getCodingAgentService();
    const statuses = await service.getStatus();
    return apiResponse(c, statuses);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /run - Run a coding task
// =============================================================================

codingAgentsRoutes.post('/run', async (c) => {
  const userId = getUserId(c);

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const { provider, prompt, cwd, model, max_budget_usd, max_turns, timeout_seconds, mode } =
    body as Record<string, unknown>;

  if (!provider || typeof provider !== 'string') {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'provider is required (claude-code, codex, gemini-cli)',
      },
      400
    );
  }

  if (!prompt || typeof prompt !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'prompt is required' }, 400);
  }

  if (!isValidProvider(provider)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Invalid provider "${provider}". Must be a built-in (${VALID_BUILTIN_PROVIDERS.join(', ')}) or custom:name`,
      },
      400
    );
  }

  try {
    const service = getCodingAgentService();
    const timeoutSec = timeout_seconds as number | undefined;
    const result = await service.runTask(
      {
        provider: provider as CodingAgentProvider,
        prompt: prompt as string,
        cwd: cwd as string | undefined,
        model: model as string | undefined,
        maxBudgetUsd: max_budget_usd as number | undefined,
        maxTurns: max_turns as number | undefined,
        timeout: timeoutSec ? timeoutSec * 1000 : undefined,
        mode: mode as 'auto' | 'sdk' | 'pty' | undefined,
      },
      userId
    );

    return apiResponse(c, result, result.success ? 200 : 422);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /test - Quick connectivity test for a provider
// =============================================================================

codingAgentsRoutes.post('/test', async (c) => {
  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const { provider } = body as Record<string, unknown>;
  if (!provider || typeof provider !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'provider is required' },
      400
    );
  }

  if (!isValidProvider(provider)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `Invalid provider: ${provider}` },
      400
    );
  }

  try {
    const service = getCodingAgentService();
    const available = await service.isAvailable(provider as CodingAgentProvider);
    const statuses = await service.getStatus();
    const status = statuses.find((s) => s.provider === provider);

    return apiResponse(c, {
      provider,
      available,
      installed: status?.installed ?? false,
      configured: status?.configured ?? false,
      version: status?.version,
      ptyAvailable: status?.ptyAvailable ?? false,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /sessions - List active sessions for the authenticated user
// =============================================================================

codingAgentsRoutes.get('/sessions', (c) => {
  const userId = getUserId(c);
  const service = getCodingAgentService();
  const sessions = service.listSessions(userId);
  return apiResponse(c, sessions);
});

// =============================================================================
// POST /sessions - Create a new PTY session
// =============================================================================

codingAgentsRoutes.post('/sessions', async (c) => {
  const userId = getUserId(c);

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const {
    provider,
    prompt,
    cwd,
    model,
    mode,
    timeout_seconds,
    max_turns,
    max_budget_usd,
    skill_ids,
    permissions,
  } = body as Record<string, unknown>;

  if (!provider || typeof provider !== 'string' || !isValidProvider(provider)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `provider must be a built-in (${VALID_BUILTIN_PROVIDERS.join(', ')}) or custom:name`,
      },
      400
    );
  }

  if (!prompt || typeof prompt !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'prompt is required' }, 400);
  }

  if (mode && mode !== 'auto' && mode !== 'interactive') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'mode must be "auto" or "interactive"' },
      400
    );
  }

  try {
    const service = getCodingAgentService();
    const timeoutSec = timeout_seconds as number | undefined;
    const session = await service.createSession(
      {
        provider: provider as CodingAgentProvider,
        prompt: prompt as string,
        cwd: cwd as string | undefined,
        model: model as string | undefined,
        mode: (mode as 'auto' | 'interactive') ?? 'auto',
        timeout: timeoutSec ? timeoutSec * 1000 : undefined,
        maxTurns: max_turns as number | undefined,
        maxBudgetUsd: max_budget_usd as number | undefined,
        skillIds: Array.isArray(skill_ids) ? (skill_ids as string[]) : undefined,
        permissions: permissions as Record<string, unknown> | undefined
          ? {
              outputFormat: (permissions as Record<string, unknown>).output_format as string | undefined,
              fileAccess: (permissions as Record<string, unknown>).file_access as string | undefined,
              allowedPaths: (permissions as Record<string, unknown>).allowed_paths as string[] | undefined,
              networkAccess: (permissions as Record<string, unknown>).network_access as boolean | undefined,
              shellAccess: (permissions as Record<string, unknown>).shell_access as boolean | undefined,
              gitAccess: (permissions as Record<string, unknown>).git_access as boolean | undefined,
              autonomy: (permissions as Record<string, unknown>).autonomy as string | undefined,
              maxFileChanges: (permissions as Record<string, unknown>).max_file_changes as number | undefined,
            } as import('@ownpilot/core').CodingAgentPermissions
          : undefined,
      },
      userId
    );
    return apiResponse(c, session, 201);
  } catch (err) {
    const message = getErrorMessage(err);
    // Known user-actionable errors — return 422 instead of 500
    if (message.includes('Maximum')) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message }, 409);
    }
    if (
      message.includes('not installed') ||
      message.includes('CLI not found') ||
      message.includes('node-pty')
    ) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message }, 422);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message }, 500);
  }
});

// =============================================================================
// GET /sessions/:id - Get a specific session
// =============================================================================

codingAgentsRoutes.get('/sessions/:id', (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('id');
  const service = getCodingAgentService();
  const session = service.getSession(sessionId, userId);
  if (!session) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  }
  return apiResponse(c, session);
});

// =============================================================================
// DELETE /sessions/:id - Terminate a session
// =============================================================================

codingAgentsRoutes.delete('/sessions/:id', (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('id');
  const service = getCodingAgentService();
  const success = service.terminateSession(sessionId, userId);
  if (!success) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  }
  return apiResponse(c, { terminated: true });
});

// =============================================================================
// POST /sessions/:id/input - Send input to a session (REST fallback for WS)
// =============================================================================

codingAgentsRoutes.post('/sessions/:id/input', async (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('id');

  const body = await parseJsonBody(c);
  if (!body || typeof (body as Record<string, unknown>).data !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: '"data" string is required' },
      400
    );
  }

  const service = getCodingAgentService();
  const success = service.writeToSession(
    sessionId,
    userId,
    (body as Record<string, unknown>).data as string
  );
  if (!success) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' },
      404
    );
  }
  return apiResponse(c, { sent: true });
});

// =============================================================================
// POST /sessions/:id/resize - Resize terminal dimensions
// =============================================================================

// =============================================================================
// GET /sessions/:id/output - Get session output buffer (REST fallback for WS)
// =============================================================================

codingAgentsRoutes.get('/sessions/:id/output', (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('id');
  const service = getCodingAgentService();

  const session = service.getSession(sessionId, userId);
  if (!session) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  }

  const output = service.getOutputBuffer(sessionId, userId);
  return apiResponse(c, {
    sessionId,
    state: session.state,
    output: output ?? '',
    hasOutput: (output?.length ?? 0) > 0,
  });
});

codingAgentsRoutes.post('/sessions/:id/resize', async (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('id');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const { cols, rows } = body as Record<string, unknown>;
  if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 1 || rows < 1) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: '"cols" and "rows" must be positive numbers' },
      400
    );
  }

  const service = getCodingAgentService();
  const success = service.resizeSession(sessionId, userId, cols, rows);
  if (!success) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' },
      404
    );
  }
  return apiResponse(c, { resized: true });
});

// =============================================================================
// RESULT ENDPOINTS (persisted task outcomes)
// =============================================================================

// GET /results - List persisted coding agent results
codingAgentsRoutes.get('/results', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c);

  try {
    const [results, total] = await Promise.all([
      codingAgentResultsRepo.list(userId, limit, offset),
      codingAgentResultsRepo.count(userId),
    ]);
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    return apiResponse(c, { data: results, pagination: { page, limit, total, totalPages } });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /results/:id - Get a specific result
codingAgentsRoutes.get('/results/:id', async (c) => {
  const userId = getUserId(c);
  const resultId = c.req.param('id');

  try {
    const result = await codingAgentResultsRepo.getById(resultId, userId);
    if (!result) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Result not found' }, 404);
    }
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// PERMISSION ENDPOINTS (per-provider permission profiles)
// =============================================================================

// GET /permissions - List all permission profiles
codingAgentsRoutes.get('/permissions', async (c) => {
  const userId = getUserId(c);
  try {
    const perms = await codingAgentPermissionsRepo.list(userId);
    return apiResponse(c, perms);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /permissions/:providerRef - Get permission profile for a provider
codingAgentsRoutes.get('/permissions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  try {
    const perm = await codingAgentPermissionsRepo.getByProvider(providerRef, userId);
    if (!perm) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'No permissions configured' }, 404);
    }
    return apiResponse(c, perm);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /permissions/:providerRef - Upsert permission profile
codingAgentsRoutes.put('/permissions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;

  try {
    const record = await codingAgentPermissionsRepo.upsert(
      {
        providerRef,
        ioFormat: b.io_format as string | undefined,
        fsAccess: b.fs_access as string | undefined,
        allowedDirs: b.allowed_dirs as string[] | undefined,
        networkAccess: b.network_access as boolean | undefined,
        shellAccess: b.shell_access as boolean | undefined,
        gitAccess: b.git_access as boolean | undefined,
        autonomy: b.autonomy as string | undefined,
        maxFileChanges: b.max_file_changes as number | undefined,
      } as Parameters<typeof codingAgentPermissionsRepo.upsert>[0],
      userId
    );
    return apiResponse(c, record);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /permissions/:providerRef - Delete permission profile
codingAgentsRoutes.delete('/permissions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  try {
    const deleted = await codingAgentPermissionsRepo.delete(providerRef, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// SKILL ATTACHMENT ENDPOINTS
// =============================================================================

// GET /skills/:providerRef - List skill attachments for a provider
codingAgentsRoutes.get('/skills/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  try {
    const skills = await codingAgentSkillAttachmentsRepo.listByProvider(providerRef, userId);
    return apiResponse(c, skills);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /skills/:providerRef - Attach a skill
codingAgentsRoutes.post('/skills/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const type = b.type as string;
  if (type !== 'extension' && type !== 'inline') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'type must be "extension" or "inline"' },
      400
    );
  }

  try {
    const record = await codingAgentSkillAttachmentsRepo.create(
      {
        providerRef,
        type: type as 'extension' | 'inline',
        extensionId: b.extension_id as string | undefined,
        label: b.label as string | undefined,
        instructions: b.instructions as string | undefined,
        priority: b.priority as number | undefined,
      },
      userId
    );
    return apiResponse(c, record, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /skills/:providerRef/:id - Update a skill attachment
codingAgentsRoutes.put('/skills/:providerRef/:id', async (c) => {
  const userId = getUserId(c);
  const attachmentId = c.req.param('id');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;

  try {
    const record = await codingAgentSkillAttachmentsRepo.update(
      attachmentId,
      {
        label: b.label as string | undefined,
        instructions: b.instructions as string | undefined,
        priority: b.priority as number | undefined,
        active: b.active as boolean | undefined,
      },
      userId
    );
    if (!record) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill attachment not found' }, 404);
    }
    return apiResponse(c, record);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /skills/:providerRef/:id - Detach a skill
codingAgentsRoutes.delete('/skills/:providerRef/:id', async (c) => {
  const userId = getUserId(c);
  const attachmentId = c.req.param('id');

  try {
    const deleted = await codingAgentSkillAttachmentsRepo.delete(attachmentId, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// SUBSCRIPTION ENDPOINTS (budget/tier tracking)
// =============================================================================

// GET /subscriptions - List all subscriptions
codingAgentsRoutes.get('/subscriptions', async (c) => {
  const userId = getUserId(c);
  try {
    const subs = await codingAgentSubscriptionsRepo.list(userId);
    return apiResponse(c, subs);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /subscriptions/:providerRef - Get subscription for a provider
codingAgentsRoutes.get('/subscriptions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  try {
    const sub = await codingAgentSubscriptionsRepo.getByProvider(providerRef, userId);
    if (!sub) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'No subscription configured' }, 404);
    }
    return apiResponse(c, sub);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PUT /subscriptions/:providerRef - Upsert subscription
codingAgentsRoutes.put('/subscriptions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;

  try {
    const record = await codingAgentSubscriptionsRepo.upsert(
      {
        providerRef,
        tier: b.tier as string | undefined,
        monthlyBudgetUsd: b.monthly_budget_usd as number | undefined,
        currentSpendUsd: b.current_spend_usd as number | undefined,
        maxConcurrentSessions: b.max_concurrent_sessions as number | undefined,
        resetAt: b.reset_at as string | undefined,
      },
      userId
    );
    return apiResponse(c, record);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /subscriptions/:providerRef - Delete subscription
codingAgentsRoutes.delete('/subscriptions/:providerRef', async (c) => {
  const userId = getUserId(c);
  const providerRef = c.req.param('providerRef');

  try {
    const deleted = await codingAgentSubscriptionsRepo.delete(providerRef, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// ORCHESTRATION ROUTES
// =============================================================================

/**
 * POST /orchestrate - Start a new orchestration run
 */
codingAgentsRoutes.post('/orchestrate', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody<{
    goal: string;
    provider: string;
    cwd: string;
    model?: string;
    maxSteps?: number;
    autoMode?: boolean;
    skillIds?: string[];
    permissions?: Record<string, unknown>;
  }>(c);

  if (!body?.goal || !body?.provider || !body?.cwd) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'goal, provider, and cwd are required' },
      400
    );
  }

  if (!isValidProvider(body.provider)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `Invalid provider: ${body.provider}` },
      400
    );
  }

  try {
    const run = await startOrchestration(
      {
        goal: body.goal,
        provider: body.provider as CodingAgentProvider,
        cwd: body.cwd,
        model: body.model,
        maxSteps: body.maxSteps,
        autoMode: body.autoMode,
        skillIds: body.skillIds,
        permissions: body.permissions as never,
      },
      userId
    );
    return apiResponse(c, { run }, 201);
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.CREATE_FAILED, message: getErrorMessage(err, 'Failed to start orchestration') },
      500
    );
  }
});

/**
 * GET /orchestrate - List orchestration runs
 */
codingAgentsRoutes.get('/orchestrate', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c);
  const runs = await listOrchestrations(userId, limit, offset);
  return apiResponse(c, { runs, total: runs.length });
});

/**
 * GET /orchestrate/:id - Get a specific orchestration run
 */
codingAgentsRoutes.get('/orchestrate/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const run = await getOrchestration(id, userId);
  if (!run) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' }, 404);
  }
  return apiResponse(c, { run });
});

/**
 * POST /orchestrate/:id/continue - Continue a paused run with user input
 */
codingAgentsRoutes.post('/orchestrate/:id/continue', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await parseJsonBody<{ prompt: string }>(c);

  if (!body?.prompt) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'prompt is required' },
      400
    );
  }

  try {
    const run = await continueOrchestration(id, userId, body.prompt);
    if (!run) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: 'Run not found or not waiting for input' },
        404
      );
    }
    return apiResponse(c, { run });
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(err, 'Failed to continue') },
      500
    );
  }
});

/**
 * POST /orchestrate/:id/cancel - Cancel an orchestration run
 */
codingAgentsRoutes.post('/orchestrate/:id/cancel', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const cancelled = await cancelOrchestration(id, userId);
  if (!cancelled) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' }, 404);
  }
  return apiResponse(c, { cancelled: true });
});

/**
 * DELETE /orchestrate/:id - Delete an orchestration run
 */
codingAgentsRoutes.delete('/orchestrate/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const deleted = await orchestrationRunsRepo.delete(id, userId);
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Run not found' }, 404);
  }
  return apiResponse(c, { deleted: true });
});
