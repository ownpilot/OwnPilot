/**
 * CLI Tools Routes
 *
 * REST API for discovering, managing policies, and installing CLI tools.
 * Execution happens via AI tool calling (run_cli_tool), not via these routes.
 */

import { Hono } from 'hono';
import { getCliToolService } from '../services/cli-tool-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import type { CliToolPolicy, CliInstallMethod, CliToolRiskLevel } from '@ownpilot/core';
import { CLI_TOOLS_BY_NAME } from '../services/cli-tools-catalog.js';
import { cliProvidersRepo } from '../db/repositories/cli-providers.js';
import { cliToolPoliciesRepo } from '../db/repositories/cli-tool-policies.js';
import { clearDiscoveryCache } from '../services/cli-tools-discovery.js';

const VALID_POLICIES = ['allowed', 'prompt', 'blocked'];
const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const VALID_CATEGORIES = [
  'linter', 'formatter', 'build', 'test', 'package-manager',
  'container', 'version-control', 'coding-agent', 'utility', 'security', 'database',
];

export const cliToolsRoutes = new Hono();

// =============================================================================
// GET / - List all CLI tools with status
// =============================================================================

cliToolsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  try {
    const service = getCliToolService();
    const tools = await service.listTools(userId);
    return apiResponse(c, tools);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /policies - Get user's per-tool policies
// =============================================================================

cliToolsRoutes.get('/policies', async (c) => {
  const userId = getUserId(c);
  try {
    const service = getCliToolService();
    const tools = await service.listTools(userId);
    const policies = tools.map((t) => ({
      name: t.name,
      displayName: t.displayName,
      category: t.category,
      riskLevel: t.riskLevel,
      policy: t.policy,
      source: t.source,
    }));
    return apiResponse(c, policies);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// PUT /policies/:toolName - Update a tool's execution policy
// =============================================================================

cliToolsRoutes.put('/policies/:toolName', async (c) => {
  const userId = getUserId(c);
  const toolName = c.req.param('toolName');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const policy = b.policy as string;

  if (!policy || !['allowed', 'prompt', 'blocked'].includes(policy)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "policy must be 'allowed', 'prompt', or 'blocked'",
      },
      400
    );
  }

  try {
    const service = getCliToolService();
    await service.setToolPolicy(toolName, policy as CliToolPolicy, userId);
    const updatedPolicy = await service.getToolPolicy(toolName, userId);
    return apiResponse(c, { toolName, policy: updatedPolicy });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:name/install - Install a CLI tool
// =============================================================================

cliToolsRoutes.post('/:name/install', async (c) => {
  const userId = getUserId(c);
  const name = c.req.param('name');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const method = (b.method as string) ?? 'npm-global';

  if (!['npm-global', 'pnpm-global'].includes(method)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "method must be 'npm-global' or 'pnpm-global'",
      },
      400
    );
  }

  try {
    const service = getCliToolService();
    const result = await service.installTool(name, method as CliInstallMethod, userId);
    return apiResponse(c, result, result.success ? 200 : 422);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /refresh - Clear discovery cache and re-scan
// =============================================================================

cliToolsRoutes.post('/refresh', async (c) => {
  try {
    const service = getCliToolService();
    await service.refreshDiscovery();
    return apiResponse(c, { refreshed: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /policies/batch - Batch update policies by risk level or tool list
// =============================================================================

cliToolsRoutes.post('/policies/batch', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const policy = b.policy as string;
  const riskLevel = b.riskLevel as string | undefined;
  const toolNames = b.tools as string[] | undefined;

  if (!policy || !VALID_POLICIES.includes(policy)) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "policy must be 'allowed', 'prompt', or 'blocked'",
    }, 400);
  }

  if (!riskLevel && !toolNames) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Provide 'riskLevel' or 'tools' array",
    }, 400);
  }

  try {
    const service = getCliToolService();
    const tools = await service.listTools(userId);
    let targets: string[];

    if (riskLevel && VALID_RISK_LEVELS.includes(riskLevel)) {
      targets = tools
        .filter((t) => t.riskLevel === riskLevel)
        .map((t) => t.name);
    } else if (toolNames && Array.isArray(toolNames)) {
      targets = toolNames;
    } else {
      targets = [];
    }

    if (targets.length > 0) {
      await cliToolPoliciesRepo.batchSetPolicies(
        targets.map((t) => ({ toolName: t, policy: policy as CliToolPolicy })),
        userId
      );
      clearDiscoveryCache(userId);
    }

    return apiResponse(c, { updated: targets.length, policy });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /custom - Register a custom CLI tool
// =============================================================================

cliToolsRoutes.post('/custom', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;
  const name = (b.name as string)?.trim();
  const displayName = (b.displayName as string)?.trim();
  const binaryName = (b.binaryName as string)?.trim();
  const description = (b.description as string)?.trim() || '';
  const category = (b.category as string) || 'utility';
  const riskLevel = (b.riskLevel as string) || 'medium';

  if (!name || !displayName || !binaryName) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'name, displayName, and binaryName are required',
    }, 400);
  }

  if (!/^[a-z0-9_-]+$/.test(name)) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'name must be lowercase alphanumeric with hyphens/underscores',
    }, 400);
  }

  // Prevent collision with catalog tools
  if (CLI_TOOLS_BY_NAME.has(name)) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Tool '${name}' already exists in the catalog`,
    }, 400);
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
    }, 400);
  }

  if (!VALID_RISK_LEVELS.includes(riskLevel)) {
    return apiError(c, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid riskLevel. Must be one of: ${VALID_RISK_LEVELS.join(', ')}`,
    }, 400);
  }

  try {
    // Register as a CLI provider with minimal settings
    const provider = await cliProvidersRepo.create({
      name,
      displayName,
      binary: binaryName,
      description,
      category,
      authMethod: 'none',
      userId,
    });

    // Set default policy based on risk level
    const defaultPolicy: CliToolPolicy =
      riskLevel === 'low' ? 'allowed' : riskLevel === 'high' || riskLevel === 'critical' ? 'blocked' : 'prompt';
    await cliToolPoliciesRepo.setPolicy(`custom:${name}`, defaultPolicy, userId);

    clearDiscoveryCache(userId);
    return apiResponse(c, {
      name: `custom:${name}`,
      displayName,
      binaryName,
      category,
      riskLevel,
      policy: defaultPolicy,
      providerId: provider.id,
    }, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// DELETE /custom/:name - Remove a custom CLI tool
// =============================================================================

cliToolsRoutes.delete('/custom/:name', async (c) => {
  const userId = getUserId(c);
  const name = c.req.param('name');

  try {
    const provider = await cliProvidersRepo.getByName(name, userId);
    if (!provider) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Custom tool '${name}' not found` }, 404);
    }

    await cliProvidersRepo.delete(provider.id);
    // Also clean up the policy entry
    try { await cliToolPoliciesRepo.deletePolicy(`custom:${name}`, userId); } catch { /* ok */ }
    clearDiscoveryCache(userId);
    return apiResponse(c, { deleted: true, name: `custom:${name}` });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
