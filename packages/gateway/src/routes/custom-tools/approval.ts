/**
 * Custom Tools Approval Routes
 *
 * Approval workflow for pending custom tools.
 * Endpoints: POST /:id/approve, POST /:id/reject
 */

import { Hono } from 'hono';
import { createCustomToolsRepo } from '../../db/repositories/custom-tools.js';
import { invalidateAgentCache } from '../agents.js';
import { syncToolToRegistry } from '../../services/custom-tool-registry.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';

export const approvalRoutes = new Hono();

/**
 * Approve a pending tool
 */
approvalRoutes.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'pending_approval') {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `Tool is not pending approval. Current status: ${tool.status}`,
      },
      400
    );
  }

  const approved = await repo.approve(id);
  if (approved) {
    syncToolToRegistry(approved);
    // Invalidate agent cache so approved tool becomes available
    invalidateAgentCache();
    wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'updated', id });
  }

  return apiResponse(c, approved);
});

/**
 * Reject a pending tool
 */
approvalRoutes.post('/:id/reject', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'pending_approval') {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `Tool is not pending approval. Current status: ${tool.status}`,
      },
      400
    );
  }

  const rejected = await repo.reject(id);

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'updated', id });

  return apiResponse(c, rejected);
});
