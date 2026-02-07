/**
 * Execution Permissions Routes
 *
 * REST API for managing per-category code execution permissions.
 * Also handles resolving real-time approval requests.
 */

import { Hono } from 'hono';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { resolveApproval } from '../services/execution-approval.js';
import { apiResponse, apiError, getUserId, ERROR_CODES } from './helpers.js';
import type { ExecutionPermissions, PermissionMode } from '@ownpilot/core';

const VALID_MODES: ReadonlySet<string> = new Set(['blocked', 'prompt', 'allowed']);
const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'execute_javascript', 'execute_python', 'execute_shell', 'compile_code', 'package_manager',
]);

const app = new Hono();

/**
 * GET / — Get current execution permissions
 */
app.get('/', async (c) => {
  const userId = getUserId(c);
  const permissions = await executionPermissionsRepo.get(userId);
  return apiResponse(c, permissions);
});

/**
 * PUT / — Update execution permissions (partial merge)
 */
app.put('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<Partial<ExecutionPermissions>>();

  // Validate: only accept known categories with valid modes
  const cleaned: Partial<ExecutionPermissions> = {};
  for (const [key, value] of Object.entries(body)) {
    if (VALID_CATEGORIES.has(key) && typeof value === 'string' && VALID_MODES.has(value)) {
      (cleaned as Record<string, PermissionMode>)[key] = value as PermissionMode;
    }
  }

  if (Object.keys(cleaned).length === 0) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'No valid permission changes provided' }, 400);
  }

  const updated = await executionPermissionsRepo.set(userId, cleaned);
  return apiResponse(c, updated);
});

/**
 * POST /reset — Reset permissions to all-blocked defaults
 */
app.post('/reset', async (c) => {
  const userId = getUserId(c);
  await executionPermissionsRepo.reset(userId);
  return apiResponse(c, { reset: true });
});

/**
 * POST /approvals/:id/resolve — Resolve a pending approval request
 */
app.post('/approvals/:id/resolve', async (c) => {
  const approvalId = c.req.param('id');
  const body = await c.req.json<{ approved: boolean }>();

  if (typeof body.approved !== 'boolean') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'approved field must be a boolean' }, 400);
  }

  const resolved = resolveApproval(approvalId, body.approved);
  if (!resolved) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Approval request not found or already expired' }, 404);
  }

  return apiResponse(c, { resolved: true, approved: body.approved });
});

export const executionPermissionsRoutes = app;
