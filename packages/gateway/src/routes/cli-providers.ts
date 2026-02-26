/**
 * CLI Providers Routes
 *
 * CRUD for user-registered CLI tools as coding agent providers.
 * These appear in the coding agents system as 'custom:{name}'.
 */

import { execFileSync } from 'node:child_process';
import { Hono } from 'hono';
import { cliProvidersRepo } from '../db/repositories/cli-providers.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';

export const cliProvidersRoutes = new Hono();

// =============================================================================
// GET / - List all CLI providers for the user
// =============================================================================

cliProvidersRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  try {
    const providers = await cliProvidersRepo.list(userId);
    return apiResponse(c, providers);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST / - Create a new CLI provider
// =============================================================================

cliProvidersRoutes.post('/', async (c) => {
  const userId = getUserId(c);

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' }, 400);
  }
  if (!b.display_name || typeof b.display_name !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'display_name is required' },
      400
    );
  }
  if (!b.binary || typeof b.binary !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'binary is required' }, 400);
  }

  // Validate name format: lowercase alphanumeric + hyphens
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(b.name) && b.name.length > 1) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'name must be lowercase alphanumeric with hyphens (e.g., "prettier", "my-tool")',
      },
      400
    );
  }

  try {
    // Check for duplicates
    const existing = await cliProvidersRepo.getByName(b.name as string, userId);
    if (existing) {
      return apiError(
        c,
        { code: ERROR_CODES.ALREADY_EXISTS, message: `Provider '${b.name}' already exists` },
        409
      );
    }

    const provider = await cliProvidersRepo.create({
      name: b.name as string,
      displayName: b.display_name as string,
      description: (b.description as string) ?? undefined,
      binary: b.binary as string,
      category: (b.category as string) ?? undefined,
      icon: (b.icon as string) ?? undefined,
      color: (b.color as string) ?? undefined,
      authMethod: (b.auth_method as 'none' | 'config_center' | 'env_var') ?? undefined,
      configServiceName: (b.config_service_name as string) ?? undefined,
      apiKeyEnvVar: (b.api_key_env_var as string) ?? undefined,
      defaultArgs: (b.default_args as string[]) ?? undefined,
      promptTemplate: (b.prompt_template as string) ?? undefined,
      outputFormat: (b.output_format as 'text' | 'json' | 'stream-json') ?? undefined,
      defaultTimeoutMs: (b.default_timeout_ms as number) ?? undefined,
      maxTimeoutMs: (b.max_timeout_ms as number) ?? undefined,
      userId,
    });

    return apiResponse(c, provider, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// PUT /:id - Update a CLI provider
// =============================================================================

cliProvidersRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');

  const body = await parseJsonBody(c);
  if (!body) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);
  }

  const b = body as Record<string, unknown>;

  try {
    const updated = await cliProvidersRepo.update(id, {
      name: b.name as string | undefined,
      displayName: b.display_name as string | undefined,
      description: b.description as string | undefined,
      binary: b.binary as string | undefined,
      category: b.category as string | undefined,
      icon: b.icon as string | undefined,
      color: b.color as string | undefined,
      authMethod: b.auth_method as 'none' | 'config_center' | 'env_var' | undefined,
      configServiceName: b.config_service_name as string | undefined,
      apiKeyEnvVar: b.api_key_env_var as string | undefined,
      defaultArgs: b.default_args as string[] | undefined,
      promptTemplate: b.prompt_template as string | undefined,
      outputFormat: b.output_format as 'text' | 'json' | 'stream-json' | undefined,
      defaultTimeoutMs: b.default_timeout_ms as number | undefined,
      maxTimeoutMs: b.max_timeout_ms as number | undefined,
      isActive: b.is_active as boolean | undefined,
    });

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
    }

    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Delete a CLI provider
// =============================================================================

cliProvidersRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const deleted = await cliProvidersRepo.delete(id);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
    }
    return apiResponse(c, { deleted: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/test - Test if binary is installed and get version
// =============================================================================

cliProvidersRoutes.post('/:id/test', async (c) => {
  const id = c.req.param('id');

  try {
    const provider = await cliProvidersRepo.getById(id);
    if (!provider) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' }, 404);
    }

    let installed = false;
    let version: string | undefined;

    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(cmd, [provider.binary], { stdio: 'pipe', timeout: 5000 });
      installed = true;
    } catch {
      // Not installed
    }

    if (installed) {
      try {
        const output = execFileSync(provider.binary, ['--version'], {
          stdio: 'pipe',
          timeout: 10000,
          encoding: 'utf8',
        });
        version = output.trim().split('\n')[0];
      } catch {
        // Version check failed — binary exists but no --version flag
      }
    }

    return apiResponse(c, { installed, version, binary: provider.binary });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
