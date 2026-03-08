/**
 * Orchestra Routes
 *
 * REST API for multi-agent orchestra plan execution and history.
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, getPaginationParams } from './helpers.js';
import { getOrchestraEngine } from '../services/orchestra-engine.js';
import { OrchestraRepository } from '../db/repositories/orchestra.js';

export const orchestraRoutes = new Hono();

// =============================================================================
// GET / - List executions for a parent (conversation)
// =============================================================================

orchestraRoutes.get('/', async (c) => {
  try {
    const parentId = c.req.query('parentId');
    if (!parentId) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'parentId query parameter is required' },
        400
      );
    }

    const engine = getOrchestraEngine();
    const executions = engine.listByParent(parentId);

    return apiResponse(c, executions);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// GET /history - Get execution history for current user
// =============================================================================

orchestraRoutes.get('/history', async (c) => {
  try {
    const userId = c.get('userId') ?? 'default';
    const { limit, offset } = getPaginationParams(c);

    const repo = new OrchestraRepository();
    const result = await repo.getHistory(userId, limit, offset);

    return apiResponse(c, result);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// GET /:id - Get a specific execution
// =============================================================================

orchestraRoutes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Try in-memory first
    const engine = getOrchestraEngine();
    const live = engine.getExecution(id);
    if (live) {
      return apiResponse(c, live);
    }

    // Fallback to DB
    const repo = new OrchestraRepository();
    const stored = await repo.getById(id);
    if (!stored) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Execution not found' }, 404);
    }

    return apiResponse(c, stored);
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Cancel a running execution
// =============================================================================

orchestraRoutes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const engine = getOrchestraEngine();

    const execution = engine.getExecution(id);
    if (!execution) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Execution not found' }, 404);
    }

    if (execution.state !== 'running') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Execution is not running' },
        400
      );
    }

    engine.cancel(id);
    return apiResponse(c, { cancelled: true });
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});
