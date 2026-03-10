/**
 * CLI Chat Provider Routes
 *
 * API endpoints for discovering and testing CLI-based chat providers.
 * These providers allow users to use their existing CLI subscriptions
 * (Claude Max, ChatGPT Pro, Google One AI Premium) for chat.
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import {
  detectCliChatProviders,
  isCliChatProvider,
  getCliBinaryFromProviderId,
  getCliChatProviderDefinition,
  createCliChatProvider,
} from '../services/cli-chat-provider.js';
import { isBinaryInstalled, getBinaryVersion } from '../services/binary-utils.js';

const app = new Hono();

/**
 * GET /cli-chat/providers
 * List all CLI chat providers with their installation status.
 */
app.get('/providers', (_c) => {
  const providers = detectCliChatProviders();
  return apiResponse(_c, providers);
});

/**
 * GET /cli-chat/providers/:id
 * Get details for a specific CLI chat provider.
 */
app.get('/providers/:id', (c) => {
  const id = c.req.param('id');
  const def = getCliChatProviderDefinition(id);
  if (!def) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: `Unknown CLI chat provider: ${id}` },
      404
    );
  }

  const version = def.installed ? getBinaryVersion(def.binary) : undefined;
  return apiResponse(c, { ...def, version });
});

/**
 * POST /cli-chat/test/:id
 * Test a CLI chat provider by sending a simple prompt.
 * Used to verify auth and connectivity.
 */
app.post('/test/:id', async (c) => {
  const id = c.req.param('id');

  if (!isCliChatProvider(id)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `Not a CLI chat provider: ${id}` },
      400
    );
  }

  const binary = getCliBinaryFromProviderId(id);
  if (!binary) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: `Unknown CLI chat provider: ${id}` },
      404
    );
  }

  if (!isBinaryInstalled(binary)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `CLI binary "${binary}" is not installed. Install it first.`,
      },
      400
    );
  }

  const def = getCliChatProviderDefinition(id);
  if (!def) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: `Unknown CLI chat provider: ${id}` },
      404
    );
  }

  try {
    const provider = createCliChatProvider({
      binary,
      model: def.defaultModel,
      timeout: 30_000,
    });

    const result = await provider.complete({
      messages: [
        {
          role: 'user' as const,
          content: 'Say "CLI chat provider test successful" and nothing else.',
        },
      ],
      model: { model: def.defaultModel },
    });

    if (result.ok) {
      return apiResponse(c, {
        success: true,
        response: result.value.content,
        model: result.value.model,
        provider: id,
      });
    } else {
      return apiResponse(c, {
        success: false,
        error: result.error.message,
        provider: id,
      });
    }
  } catch (error) {
    return apiResponse(c, {
      success: false,
      error: getErrorMessage(error),
      provider: id,
    });
  }
});

/**
 * GET /cli-chat/models/:id
 * List available models for a CLI chat provider.
 */
app.get('/models/:id', (c) => {
  const id = c.req.param('id');
  const def = getCliChatProviderDefinition(id);
  if (!def) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: `Unknown CLI chat provider: ${id}` },
      404
    );
  }

  return apiResponse(
    c,
    def.models.map((modelId) => ({
      id: modelId,
      name: modelId,
      provider: id,
      isDefault: modelId === def.defaultModel,
    }))
  );
});

export const cliChatRoutes = app;
