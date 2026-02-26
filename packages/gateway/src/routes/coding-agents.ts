/**
 * Coding Agents Routes
 *
 * API for managing and running external AI coding agents
 * (Claude Code, OpenAI Codex, Google Gemini CLI).
 */

import { Hono } from 'hono';
import type { CodingAgentProvider } from '@ownpilot/core';
import { isBuiltinProvider } from '@ownpilot/core';
import { getCodingAgentService } from '../services/coding-agent-service.js';
import { codingAgentResultsRepo } from '../db/repositories/coding-agent-results.js';
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
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'provider is required (claude-code, codex, gemini-cli)' }, 400);
  }

  if (!prompt || typeof prompt !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'prompt is required' }, 400);
  }

  if (!isValidProvider(provider)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `Invalid provider "${provider}". Must be a built-in (${VALID_BUILTIN_PROVIDERS.join(', ')}) or custom:name` },
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
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'provider is required' }, 400);
  }

  if (!isValidProvider(provider)) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: `Invalid provider: ${provider}` }, 400);
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

  const { provider, prompt, cwd, model, mode, timeout_seconds, max_turns, max_budget_usd } =
    body as Record<string, unknown>;

  if (!provider || typeof provider !== 'string' || !isValidProvider(provider)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `provider must be a built-in (${VALID_BUILTIN_PROVIDERS.join(', ')}) or custom:name` },
      400
    );
  }

  if (!prompt || typeof prompt !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'prompt is required' }, 400);
  }

  if (mode && mode !== 'auto' && mode !== 'interactive') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'mode must be "auto" or "interactive"' }, 400);
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
    if (message.includes('not installed') || message.includes('CLI not found') || message.includes('node-pty')) {
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
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: '"data" string is required' }, 400);
  }

  const service = getCodingAgentService();
  const success = service.writeToSession(sessionId, userId, (body as Record<string, unknown>).data as string);
  if (!success) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' }, 404);
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
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: '"cols" and "rows" must be positive numbers' }, 400);
  }

  const service = getCodingAgentService();
  const success = service.resizeSession(sessionId, userId, cols, rows);
  if (!success) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found or not running' }, 404);
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
