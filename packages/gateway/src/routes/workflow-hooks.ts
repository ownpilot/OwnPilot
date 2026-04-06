/**
 * Workflow Hooks API Routes
 */
import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js';
import { getWorkflowHooksService } from '../services/workflow-hooks-service.js';
import type { WorkflowHookType } from '@ownpilot/core';

const app = new Hono();

// GET /workflow-hooks/:workflowId — List hooks for a workflow
app.get('/:workflowId', async (c) => {
  const hooks = await getWorkflowHooksService().getHooks(c.req.param('workflowId'));
  return apiResponse(c, hooks);
});

// POST /workflow-hooks/:workflowId — Create/update a hook
app.post('/:workflowId', async (c) => {
  const { hookType, config, enabled } = await c.req.json();
  if (!hookType) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'hookType is required' }, 400);
  const hook = await getWorkflowHooksService().upsertHook(
    c.req.param('workflowId'), hookType as WorkflowHookType, config ?? {}, enabled
  );
  return apiResponse(c, hook, 201);
});

// DELETE /workflow-hooks/hook/:id — Delete a hook
app.delete('/hook/:id', async (c) => {
  await getWorkflowHooksService().deleteHook(c.req.param('id'));
  return apiResponse(c, { deleted: true });
});

// PATCH /workflow-hooks/hook/:id/toggle — Enable/disable
app.patch('/hook/:id/toggle', async (c) => {
  const { enabled } = await c.req.json();
  if (enabled === undefined) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'enabled is required' }, 400);
  const hook = await getWorkflowHooksService().toggleHook(c.req.param('id'), enabled);
  return apiResponse(c, hook);
});

export const workflowHooksRoutes = app;
