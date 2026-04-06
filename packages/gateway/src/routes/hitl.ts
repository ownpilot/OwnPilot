/**
 * HITL (Human-in-the-Loop) API Routes
 */
import { Hono } from 'hono';
import { getUserId, apiResponse, apiError, getPaginationParams, ERROR_CODES } from './helpers.js';
import { getHitlService } from '../services/hitl-service.js';

const app = new Hono();

// POST /hitl/requests — Create HITL request
app.post('/requests', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();
  const request = await getHitlService().createRequest(userId, body);
  return apiResponse(c, request, 201);
});

// GET /hitl/requests/pending — List pending requests
app.get('/requests/pending', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c);
  const workflowId = c.req.query('workflowId') ?? undefined;
  const result = await getHitlService().listPending(userId, { workflowId, limit, offset });
  return apiResponse(c, result);
});

// GET /hitl/requests/:id
app.get('/requests/:id', async (c) => {
  const userId = getUserId(c);
  const request = await getHitlService().getRequest(c.req.param('id'), userId);
  if (!request) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'HITL request not found' }, 404);
  return apiResponse(c, request);
});

// POST /hitl/requests/:id/resolve — Approve/reject/modify
app.post('/requests/:id/resolve', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();
  if (!body.decision) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'decision is required' }, 400);
  try {
    const request = await getHitlService().resolve(c.req.param('id'), userId, body);
    return apiResponse(c, request);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resolve';
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message }, 400);
  }
});

// POST /hitl/requests/cancel-workflow — Cancel all pending for a workflow
app.post('/requests/cancel-workflow', async (c) => {
  const userId = getUserId(c);
  const { workflowLogId } = await c.req.json();
  if (!workflowLogId) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'workflowLogId is required' }, 400);
  const count = await getHitlService().cancelForWorkflow(workflowLogId, userId);
  return apiResponse(c, { cancelled: count });
});

// POST /hitl/expire — Expire stale requests (can be called by cron)
app.post('/expire', async (c) => {
  const count = await getHitlService().expireStale();
  return apiResponse(c, { expired: count });
});

export const hitlRoutes = app;
