/**
 * Orchestra Routes
 *
 * REST API for multi-agent orchestra plan execution and history.
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { getOrchestraEngine } from '../services/orchestra-engine.js';
import { OrchestraRepository } from '../db/repositories/orchestra.js';
import type { OrchestraExecution } from '@ownpilot/core';

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
// GET /stats — Aggregate orchestra statistics
// =============================================================================

orchestraRoutes.get('/stats', async (c) => {
  try {
    const userId = c.get('userId') ?? 'default';
    const repo = new OrchestraRepository();
    const dbStats = await repo.getStats(userId);

    return apiResponse(c, {
      total: dbStats.total,
      active: dbStats.active,
      successRate: dbStats.successRate,
      avgDuration: dbStats.avgDuration,
      totalCost: dbStats.totalCost,
      errorRate: dbStats.errorRate,
      byState: dbStats.byState,
      tasksSucceeded: dbStats.tasksSucceeded,
      tasksFailed: dbStats.tasksFailed,
    });
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(e) }, 500);
  }
});

// =============================================================================
// GET /health — Orchestra health indicators
// =============================================================================

orchestraRoutes.get('/health', async (c) => {
  try {
    const engine = getOrchestraEngine();

    const running: OrchestraExecution[] = [];
    for (const exec of (engine as unknown as { executions: Map<string, OrchestraExecution> }).executions?.values() ?? []) {
      if (exec.state === 'running') running.push(exec);
    }

    const signals: string[] = [];
    const recommendations: string[] = [];

    let score = 80;
    let status: 'healthy' | 'watch' | 'stuck' | 'failed' = 'healthy';

    if (running.length === 0) {
      signals.push('no running executions');
      score = 60;
      status = 'watch';
    }

    const stale = running.filter(
      (ex) => ex.startedAt && Date.now() - ex.startedAt.getTime() > 30 * 60 * 1000 && ex.taskResults.length === 0
    );
    if (stale.length > 0) {
      signals.push(`${stale.length} executions with no progress`);
      recommendations.push('Check orchestration strategy and agent availability');
      score = Math.min(score, 35);
      status = 'stuck';
    }

    return apiResponse(c, { status, score, signals, recommendations });
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
