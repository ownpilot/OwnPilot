/**
 * Workflow Routes
 *
 * CRUD + execution endpoints for visual DAG tool pipelines.
 * Execution streams progress via SSE for real-time node visualization.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getServiceRegistry, Services } from '@ownpilot/core';
import {
  getUserId,
  apiResponse,
  apiError,
  notFoundError,
  getErrorMessage,
  sanitizeId,
  parseJsonBody,
} from './helpers.js';
import { ERROR_CODES } from './error-codes.js';
import { createWorkflowsRepository } from '../db/repositories/workflows.js';
import { topologicalSort } from '../services/workflow-service.js';
import { wsGateway } from '../ws/server.js';
import { validateBody } from '../middleware/validation.js';
import { createWorkflowSchema, updateWorkflowSchema } from '../middleware/validation.js';
import { workflowCopilotRoute } from './workflow-copilot.js';
import { pagination } from '../middleware/pagination.js';

export const workflowRoutes = new Hono();

// Mount copilot sub-route
workflowRoutes.route('/copilot', workflowCopilotRoute);

// ============================================================================
// List Workflows
// ============================================================================

workflowRoutes.get('/', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const [total, workflows] = await Promise.all([repo.count(), repo.getPage(limit, offset)]);

  return apiResponse(c, {
    workflows,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ============================================================================
// Create Workflow
// ============================================================================

workflowRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const rawBody = await parseJsonBody(c);
  if (!rawBody)
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid JSON body' }, 400);

  let body;
  try {
    body = validateBody(createWorkflowSchema, rawBody);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(error) },
      400
    );
  }

  // Validate DAG (no cycles) if nodes and edges are provided
  if (body.nodes.length > 0 && body.edges.length > 0) {
    try {
      topologicalSort(body.nodes, body.edges);
    } catch {
      return apiError(
        c,
        { code: ERROR_CODES.WORKFLOW_CYCLE_DETECTED, message: 'Workflow graph contains a cycle' },
        400
      );
    }
  }

  const repo = createWorkflowsRepository(userId);
  let workflow;
  try {
    workflow = await repo.create(body);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to create workflow'),
      },
      500
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'created', id: workflow.id });
  return apiResponse(c, workflow, 201);
});

// ============================================================================
// Recent Logs (must be before /:id to avoid route conflict)
// ============================================================================

workflowRoutes.get('/logs/recent', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const [total, logs] = await Promise.all([repo.countLogs(), repo.getRecentLogs(limit, offset)]);

  return apiResponse(c, {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ============================================================================
// Log Detail
// ============================================================================

workflowRoutes.get('/logs/:logId', async (c) => {
  const userId = getUserId(c);
  const logId = sanitizeId(c.req.param('logId'));

  const repo = createWorkflowsRepository(userId);
  const wfLog = await repo.getLog(logId);
  if (!wfLog) return notFoundError(c, 'WorkflowLog', logId);

  return apiResponse(c, wfLog);
});

// ============================================================================
// Active Tool Names (for workflow-usable toggle warnings)
// ============================================================================

workflowRoutes.get('/active-tool-names', async (c) => {
  const userId = getUserId(c);
  const repo = createWorkflowsRepository(userId);
  const workflows = await repo.getPage(1000, 0);

  const activeToolNames = new Set<string>();
  for (const wf of workflows) {
    if (wf.status !== 'active') continue;
    for (const node of wf.nodes) {
      if (node.type === 'tool' && (node.data as { toolName?: string }).toolName) {
        activeToolNames.add((node.data as { toolName: string }).toolName);
      }
    }
  }

  return apiResponse(c, [...activeToolNames]);
});

// ============================================================================
// Get Workflow
// ============================================================================

workflowRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  return apiResponse(c, workflow);
});

// ============================================================================
// Update Workflow
// ============================================================================

workflowRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const rawBody = await parseJsonBody(c);
  if (!rawBody)
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid JSON body' }, 400);

  let body;
  try {
    body = validateBody(updateWorkflowSchema, rawBody);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(error) },
      400
    );
  }

  // Re-validate DAG if nodes or edges changed
  if (body.nodes || body.edges) {
    const repo = createWorkflowsRepository(userId);
    const existing = await repo.get(id);
    if (!existing) return notFoundError(c, 'Workflow', id);

    const nodes = body.nodes ?? existing.nodes;
    const edges = body.edges ?? existing.edges;

    if (nodes.length > 0 && edges.length > 0) {
      try {
        topologicalSort(nodes, edges);
      } catch {
        return apiError(
          c,
          { code: ERROR_CODES.WORKFLOW_CYCLE_DETECTED, message: 'Workflow graph contains a cycle' },
          400
        );
      }
    }
  }

  const repo = createWorkflowsRepository(userId);
  const updated = await repo.update(id, body);
  if (!updated) return notFoundError(c, 'Workflow', id);

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'updated', id });
  return apiResponse(c, updated);
});

// ============================================================================
// Delete Workflow
// ============================================================================

workflowRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const deleted = await repo.delete(id);
  if (!deleted) return notFoundError(c, 'Workflow', id);

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'deleted', id });
  return apiResponse(c, { message: 'Workflow deleted' });
});

// ============================================================================
// Execute Workflow (SSE stream)
// ============================================================================

workflowRoutes.post('/:id/execute', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const service = getServiceRegistry().get(Services.Workflow);
  if (service.isRunning(id)) {
    return apiError(
      c,
      { code: ERROR_CODES.WORKFLOW_ALREADY_RUNNING, message: 'Workflow is already running' },
      409
    );
  }

  return streamSSE(c, async (stream) => {
    try {
      await service.executeWorkflow(id, userId, async (event) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      });
    } catch (error) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: getErrorMessage(error) }),
        event: 'error',
      });
    }
  });
});

// ============================================================================
// Cancel Workflow Execution
// ============================================================================

workflowRoutes.post('/:id/cancel', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  // Verify workflow ownership before allowing cancel
  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const service = getServiceRegistry().get(Services.Workflow);
  const cancelled = service.cancelExecution(id);

  if (!cancelled) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'No active execution found for this workflow' },
      404
    );
  }

  return apiResponse(c, { message: 'Execution cancelled' });
});

// ============================================================================
// Workflow Execution Logs
// ============================================================================

workflowRoutes.get('/:id/logs', pagination(), async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const [total, logs] = await Promise.all([
    repo.countLogsForWorkflow(id),
    repo.getLogsForWorkflow(id, limit, offset),
  ]);

  return apiResponse(c, {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});
