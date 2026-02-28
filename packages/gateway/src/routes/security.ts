/**
 * Security Routes
 *
 * Unified security scanning across all platform components.
 *
 * POST /scan              — Full platform security scan
 * POST /scan/custom-tool  — Single custom tool security scan
 * POST /scan/trigger      — Single trigger security scan
 * POST /scan/workflow     — Single workflow security scan
 */

import { Hono } from 'hono';
import { analyzeToolCode, calculateSecurityScore } from '@ownpilot/core';
import {
  scanPlatform,
  scanExtensions,
  scanCustomTools,
  scanTriggers,
  scanWorkflows,
  scanCliPolicies,
} from '../services/security-scanner.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  parseJsonBody,
  notFoundError,
} from './helpers.js';
import { createTriggersRepository, createWorkflowsRepository } from '../db/repositories/index.js';

export const securityRoutes = new Hono();

// =============================================================================
// POST /scan — Full platform security scan
// =============================================================================

securityRoutes.post('/scan', async (c) => {
  const userId = getUserId(c);
  const result = await scanPlatform(userId);
  return apiResponse(c, result);
});

// =============================================================================
// POST /scan/extensions — Scan all extensions
// =============================================================================

securityRoutes.post('/scan/extensions', (c) => {
  const userId = getUserId(c);
  const result = scanExtensions(userId);
  return apiResponse(c, result);
});

// =============================================================================
// POST /scan/custom-tools — Scan all custom tools
// =============================================================================

securityRoutes.post('/scan/custom-tools', async (c) => {
  const userId = getUserId(c);
  const result = await scanCustomTools(userId);
  return apiResponse(c, result);
});

// =============================================================================
// POST /scan/custom-tool — Single custom tool scan
// =============================================================================

securityRoutes.post('/scan/custom-tool', async (c) => {
  const body = (await parseJsonBody(c)) as {
    code: string;
    name?: string;
    permissions?: string[];
  } | null;

  if (!body?.code || typeof body.code !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'code is required' }, 400);
  }

  const analysis = analyzeToolCode(body.code, body.permissions);
  const secScore = calculateSecurityScore(body.code, body.permissions);

  return apiResponse(c, {
    name: body.name ?? 'unnamed',
    score: secScore.score,
    category: secScore.category,
    valid: analysis.valid,
    errors: analysis.errors,
    warnings: analysis.warnings,
    dataFlowRisks: analysis.dataFlowRisks,
    bestPractices: analysis.bestPractices,
    suggestedPermissions: analysis.suggestedPermissions,
  });
});

// =============================================================================
// POST /scan/triggers — Scan all triggers
// =============================================================================

securityRoutes.post('/scan/triggers', async (c) => {
  const userId = getUserId(c);
  const result = await scanTriggers(userId);
  return apiResponse(c, result);
});

// =============================================================================
// POST /scan/trigger — Single trigger scan
// =============================================================================

securityRoutes.post('/scan/trigger', async (c) => {
  const userId = getUserId(c);
  const body = (await parseJsonBody(c)) as { triggerId: string } | null;

  if (!body?.triggerId) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'triggerId is required' }, 400);
  }

  const repo = createTriggersRepository(userId);
  const trigger = await repo.get(body.triggerId);
  if (!trigger) {
    return notFoundError(c, 'Trigger', body.triggerId);
  }

  // Run scan on all triggers and find the specific one
  const result = await scanTriggers(userId);
  const item = result.items.find((i) => i.id === body.triggerId);

  return apiResponse(c, item ?? { id: body.triggerId, score: 100, risks: [] });
});

// =============================================================================
// POST /scan/workflows — Scan all workflows
// =============================================================================

securityRoutes.post('/scan/workflows', async (c) => {
  const userId = getUserId(c);
  const result = await scanWorkflows(userId);
  return apiResponse(c, result);
});

// =============================================================================
// POST /scan/workflow — Single workflow scan
// =============================================================================

securityRoutes.post('/scan/workflow', async (c) => {
  const userId = getUserId(c);
  const body = (await parseJsonBody(c)) as { workflowId: string } | null;

  if (!body?.workflowId) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'workflowId is required' }, 400);
  }

  const repo = createWorkflowsRepository(userId);
  const wf = await repo.get(body.workflowId);
  if (!wf) {
    return notFoundError(c, 'Workflow', body.workflowId);
  }

  // Run scan on all workflows and find the specific one
  const result = await scanWorkflows(userId);
  const item = result.items.find((i) => i.id === body.workflowId);

  return apiResponse(c, item ?? { id: body.workflowId, score: 100, riskyNodes: [] });
});

// =============================================================================
// POST /scan/cli-tools — Scan CLI tool policies
// =============================================================================

securityRoutes.post('/scan/cli-tools', async (c) => {
  const userId = getUserId(c);
  const result = await scanCliPolicies(userId);
  return apiResponse(c, result);
});
