/**
 * Audit Log Routes
 *
 * Provides API endpoints for viewing and querying audit logs.
 * All agent activities, tool executions, and system events are logged.
 */

import { Hono } from 'hono';
import { getAuditLogger } from '../audit/index.js';
import type { AuditSeverity } from '@ownpilot/core';
import { apiResponse, apiError, getIntParam, ERROR_CODES, validateQueryEnum } from './helpers.js';

const app = new Hono();

/**
 * GET /audit - Query audit events with filters
 *
 * Query params:
 * - types: comma-separated event types (e.g., "tool.success,tool.error")
 * - actorId: filter by actor ID
 * - actorType: filter by actor type (agent, user, system)
 * - resourceId: filter by resource ID
 * - resourceType: filter by resource type (tool, session, agent)
 * - minSeverity: minimum severity level (debug, info, warn, error, critical)
 * - outcome: filter by outcome (success, failure)
 * - from: start date (ISO 8601)
 * - to: end date (ISO 8601)
 * - correlationId: filter by correlation/request ID
 * - limit: max events to return (default 100)
 * - offset: pagination offset
 * - order: asc or desc (default desc)
 */
app.get('/', async (c) => {
  const logger = getAuditLogger();
  await logger.initialize();

  // Parse query params
  const typesParam = c.req.query('types');
  const types = typesParam ? typesParam.split(',') : undefined;

  const from = c.req.query('from');
  const to = c.req.query('to');

  const result = await logger.query({
    types: types as import('@ownpilot/core').AuditEventType[] | undefined,
    actorId: c.req.query('actorId'),
    actorType: validateQueryEnum(c.req.query('actorType'), ['user', 'agent', 'system'] as const),
    resourceId: c.req.query('resourceId'),
    resourceType: c.req.query('resourceType'),
    minSeverity: validateQueryEnum(c.req.query('minSeverity'), ['debug', 'info', 'warn', 'error', 'critical'] as const),
    outcome: validateQueryEnum(c.req.query('outcome'), ['success', 'failure', 'unknown'] as const),
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    correlationId: c.req.query('correlationId'),
    limit: getIntParam(c, 'limit', 100, 1, 1000),
    offset: getIntParam(c, 'offset', 0, 0),
    order: validateQueryEnum(c.req.query('order'), ['asc', 'desc'] as const),
  });

  if (!result.ok) {
    return apiError(c, { code: ERROR_CODES.AUDIT_QUERY_ERROR, message: result.error.message }, 500);
  }

  const stats = logger.getStats();

  return apiResponse(c, {
      events: result.value,
      count: result.value.length,
      total: stats.eventCount,
    });
});

/**
 * GET /audit/stats - Get audit log statistics
 */
app.get('/stats', async (c) => {
  const logger = getAuditLogger();
  await logger.initialize();

  const stats = logger.getStats();
  const eventCount = await logger.countEvents();

  return apiResponse(c, {
      eventCount,
      lastChecksum: stats.lastChecksum,
    });
});

/**
 * GET /audit/tools - Get tool execution logs
 */
app.get('/tools', async (c) => {
  const logger = getAuditLogger();
  await logger.initialize();

  const result = await logger.query({
    types: ['tool.execute', 'tool.success', 'tool.error'],
    limit: getIntParam(c, 'limit', 50, 1, 1000),
    offset: getIntParam(c, 'offset', 0, 0),
    order: 'desc',
  });

  if (!result.ok) {
    return apiError(c, { code: ERROR_CODES.AUDIT_QUERY_ERROR, message: result.error.message }, 500);
  }

  return apiResponse(c, {
      events: result.value,
      count: result.value.length,
    });
});

/**
 * GET /audit/sessions - Get session/conversation logs
 */
app.get('/sessions', async (c) => {
  const logger = getAuditLogger();
  await logger.initialize();

  const result = await logger.query({
    types: ['session.create', 'session.destroy', 'message.receive', 'message.send', 'system.error'],
    limit: getIntParam(c, 'limit', 50, 1, 1000),
    offset: getIntParam(c, 'offset', 0, 0),
    order: 'desc',
  });

  if (!result.ok) {
    return apiError(c, { code: ERROR_CODES.AUDIT_QUERY_ERROR, message: result.error.message }, 500);
  }

  return apiResponse(c, {
      events: result.value,
      count: result.value.length,
    });
});

/**
 * GET /audit/errors - Get error logs
 */
app.get('/errors', async (c) => {
  const logger = getAuditLogger();
  await logger.initialize();

  const result = await logger.query({
    minSeverity: 'error',
    limit: getIntParam(c, 'limit', 50, 1, 1000),
    offset: getIntParam(c, 'offset', 0, 0),
    order: 'desc',
  });

  if (!result.ok) {
    return apiError(c, { code: ERROR_CODES.AUDIT_QUERY_ERROR, message: result.error.message }, 500);
  }

  return apiResponse(c, {
      events: result.value,
      count: result.value.length,
    });
});

/**
 * GET /audit/request/:requestId - Get all events for a specific request
 */
app.get('/request/:requestId', async (c) => {
  const requestId = c.req.param('requestId');
  const logger = getAuditLogger();
  await logger.initialize();

  const result = await logger.query({
    correlationId: requestId,
    order: 'asc', // Chronological order for request trace
  });

  if (!result.ok) {
    return apiError(c, { code: ERROR_CODES.AUDIT_QUERY_ERROR, message: result.error.message }, 500);
  }

  return apiResponse(c, {
      requestId,
      events: result.value,
      count: result.value.length,
    });
});

export const auditRoutes = app;
