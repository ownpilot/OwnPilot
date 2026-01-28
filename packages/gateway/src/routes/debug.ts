/**
 * Debug routes - view AI request/response logs and debug info
 */

import { Hono } from 'hono';
import { getDebugInfo, debugLog } from '@ownpilot/core';
import type { ApiResponse } from '../types/index.js';

export const debugRoutes = new Hono();

/**
 * Get debug log entries
 */
debugRoutes.get('/', async (c) => {
  const count = parseInt(c.req.query('count') ?? '50', 10);
  const debugInfo = getDebugInfo();

  const response: ApiResponse = {
    success: true,
    data: {
      enabled: debugInfo.enabled,
      summary: debugInfo.summary,
      entries: debugInfo.entries.slice(-count),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get recent entries only
 */
debugRoutes.get('/recent', async (c) => {
  const count = parseInt(c.req.query('count') ?? '10', 10);
  const entries = debugLog.getRecent(count);

  const response: ApiResponse = {
    success: true,
    data: {
      count: entries.length,
      entries,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Clear debug log
 */
debugRoutes.delete('/', async (c) => {
  debugLog.clear();

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Debug log cleared',
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Enable/disable debug logging
 */
debugRoutes.post('/toggle', async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled ?? !debugLog.isEnabled();

  debugLog.setEnabled(enabled);

  const response: ApiResponse = {
    success: true,
    data: {
      enabled: debugLog.isEnabled(),
      message: enabled ? 'Debug logging enabled' : 'Debug logging disabled',
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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

  const response: ApiResponse = {
    success: true,
    data: {
      count: errors.length,
      entries: errors,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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

  const response: ApiResponse = {
    success: true,
    data: {
      count: requests.length,
      entries: requests,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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

  const response: ApiResponse = {
    success: true,
    data: {
      count: toolCalls.length,
      entries: toolCalls,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});
