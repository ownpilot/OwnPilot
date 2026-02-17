/**
 * Execution Permissions Routes
 *
 * REST API for managing per-category code execution permissions.
 * Also handles resolving real-time approval requests.
 */

import { Hono } from 'hono';
import { executionPermissionsRepo } from '../db/repositories/execution-permissions.js';
import { resolveApproval } from '../services/execution-approval.js';
import { apiResponse, apiError, getUserId, ERROR_CODES, notFoundError } from './helpers.js';
import type { ExecutionPermissions, PermissionMode } from '@ownpilot/core';

const VALID_PERM_MODES: ReadonlySet<string> = new Set(['blocked', 'prompt', 'allowed']);
const VALID_EXEC_MODES: ReadonlySet<string> = new Set(['local', 'docker', 'auto']);
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
  const body = await c.req.json<Record<string, unknown>>();

  // Validate: accept enabled (boolean), mode (string), and category permissions
  const cleaned: Partial<ExecutionPermissions> = {};

  if (typeof body.enabled === 'boolean') {
    (cleaned as Record<string, unknown>).enabled = body.enabled;
  }

  if (typeof body.mode === 'string' && VALID_EXEC_MODES.has(body.mode)) {
    (cleaned as Record<string, unknown>).mode = body.mode as 'local' | 'docker' | 'auto';
  }

  for (const [key, value] of Object.entries(body)) {
    if (VALID_CATEGORIES.has(key) && typeof value === 'string' && VALID_PERM_MODES.has(value)) {
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
    return notFoundError(c, 'Approval request', approvalId);
  }

  return apiResponse(c, { resolved: true, approved: body.approved });
});

/**
 * GET /test — Diagnostic endpoint to verify the permission chain
 * Loads permissions from DB and simulates checkExecutionPermission for each category.
 * Returns what would happen for each category without actually executing any code.
 */
app.get('/test', async (c) => {
  const userId = getUserId(c);
  const permissions = await executionPermissionsRepo.get(userId);

  const categories = [
    'execute_javascript', 'execute_python', 'execute_shell', 'compile_code', 'package_manager',
  ] as const;

  const results: Record<string, { mode: string; wouldAllow: boolean; reason: string }> = {};

  for (const cat of categories) {
    const catMode = permissions[cat] ?? 'blocked';

    if (!permissions.enabled) {
      results[cat] = { mode: catMode, wouldAllow: false, reason: 'Master switch is OFF (enabled=false)' };
    } else if (catMode === 'blocked') {
      results[cat] = { mode: catMode, wouldAllow: false, reason: 'Category is set to "blocked"' };
    } else if (catMode === 'prompt') {
      results[cat] = { mode: catMode, wouldAllow: false, reason: 'Would show approval dialog (SSE required)' };
    } else if (catMode === 'allowed') {
      results[cat] = { mode: catMode, wouldAllow: true, reason: 'Category is set to "allowed" — execution permitted' };
    } else {
      results[cat] = { mode: catMode, wouldAllow: false, reason: `Unknown mode: ${catMode}` };
    }
  }

  return apiResponse(c, {
    userId,
    permissions,
    executionMode: permissions.mode,
    masterSwitch: permissions.enabled,
    categoryResults: results,
    diagnosis: !permissions.enabled
      ? 'Master switch is OFF. Enable it in the Execution Security panel.'
      : Object.values(results).every(r => !r.wouldAllow && r.mode === 'blocked')
        ? 'All categories are "blocked". Set at least one to "allowed" or "ask".'
        : 'Permissions look correct. If execution still fails, check server logs for [ExecSecurity] entries.',
  });
});

export const executionPermissionsRoutes = app;
