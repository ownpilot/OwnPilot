/**
 * Debug routes - view AI request/response logs and debug info
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getDebugInfo, debugLog } from '@ownpilot/core';
import { apiResponse } from './helpers.js';

export const debugRoutes = new Hono();

// Debug endpoints are sensitive — require ADMIN_API_KEY or restrict to development
const requireDebugAccess = createMiddleware(async (c, next) => {
  // In production, require admin key
  if (process.env.NODE_ENV === 'production') {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      throw new HTTPException(503, { message: 'Debug endpoints require ADMIN_API_KEY in production' });
    }
    const providedKey = c.req.header('X-Admin-Key');
    if (!providedKey || providedKey !== adminKey) {
      throw new HTTPException(403, { message: 'Valid X-Admin-Key header required for debug endpoints' });
    }
  }
  await next();
});

debugRoutes.use('*', requireDebugAccess);

/**
 * Get debug log entries
 */
debugRoutes.get('/', async (c) => {
  const count = parseInt(c.req.query('count') ?? '50', 10);
  const debugInfo = getDebugInfo();

  return apiResponse(c, {
    enabled: debugInfo.enabled,
    summary: debugInfo.summary,
    entries: debugInfo.entries.slice(-count),
  });
});

/**
 * Get recent entries only
 */
debugRoutes.get('/recent', async (c) => {
  const count = parseInt(c.req.query('count') ?? '10', 10);
  const entries = debugLog.getRecent(count);

  return apiResponse(c, {
    count: entries.length,
    entries,
  });
});

/**
 * Clear debug log
 */
debugRoutes.delete('/', async (c) => {
  debugLog.clear();

  return apiResponse(c, {
    message: 'Debug log cleared',
  });
});

/**
 * Enable/disable debug logging
 */
debugRoutes.post('/toggle', async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled ?? !debugLog.isEnabled();

  debugLog.setEnabled(enabled);

  return apiResponse(c, {
    enabled: debugLog.isEnabled(),
    message: enabled ? 'Debug logging enabled' : 'Debug logging disabled',
  });
});

/**
 * Get errors only
 */
debugRoutes.get('/errors', async (c) => {
  const count = parseInt(c.req.query('count') ?? '20', 10);
  const allEntries = debugLog.getAll();
  const errors = allEntries
    .filter(e => e.type === 'error' || e.type === 'retry')
    .slice(-count);

  return apiResponse(c, {
    count: errors.length,
    entries: errors,
  });
});

/**
 * Get requests and responses only
 */
debugRoutes.get('/requests', async (c) => {
  const count = parseInt(c.req.query('count') ?? '20', 10);
  const allEntries = debugLog.getAll();
  const requests = allEntries
    .filter(e => e.type === 'request' || e.type === 'response')
    .slice(-count);

  return apiResponse(c, {
    count: requests.length,
    entries: requests,
  });
});

/**
 * Get tool calls only
 */
debugRoutes.get('/tools', async (c) => {
  const count = parseInt(c.req.query('count') ?? '20', 10);
  const allEntries = debugLog.getAll();
  const toolCalls = allEntries
    .filter(e => e.type === 'tool_call' || e.type === 'tool_result')
    .slice(-count);

  return apiResponse(c, {
    count: toolCalls.length,
    entries: toolCalls,
  });
});

/**
 * Get sandbox executions only (execute_shell, execute_python, execute_javascript)
 */
debugRoutes.get('/sandbox', async (c) => {
  const count = parseInt(c.req.query('count') ?? '20', 10);
  const allEntries = debugLog.getAll();
  const sandboxExecutions = allEntries
    .filter(e => e.type === 'sandbox_execution')
    .slice(-count);

  // Calculate summary statistics
  const stats = {
    total: sandboxExecutions.length,
    byLanguage: {
      javascript: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.language === 'javascript').length,
      python: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.language === 'python').length,
      shell: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.language === 'shell').length,
    },
    sandboxed: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.sandboxed === true).length,
    unsandboxed: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.sandboxed === false).length,
    successful: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.success === true).length,
    failed: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.success === false).length,
    timedOut: sandboxExecutions.filter(e => (e.data as Record<string, unknown>)?.timedOut === true).length,
  };

  return apiResponse(c, {
    count: sandboxExecutions.length,
    stats,
    entries: sandboxExecutions,
  });
});
