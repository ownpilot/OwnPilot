/**
 * Workflow Copilot — SSE streaming endpoint.
 *
 * Lightweight AI chat for generating/editing workflow JSON definitions.
 * Uses createProvider().stream() directly — no agent infrastructure needed.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getUserId, apiError, getErrorMessage, parseJsonBody } from './helpers.js';
import { ERROR_CODES } from './error-codes.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from './agent-cache.js';
import { resolveProviderAndModel } from './settings.js';
import { validateBody, workflowCopilotSchema } from '../middleware/validation.js';
import { createProvider, type ProviderConfig, type Message } from '@ownpilot/core';
import { buildCopilotSystemPrompt } from './workflow-copilot-prompt.js';
import { getLog } from '../services/log.js';

const log = getLog('WorkflowCopilot');

interface CopilotBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow?: {
    name: string;
    nodes: unknown[];
    edges: unknown[];
    variables?: Record<string, unknown>;
  };
  availableTools?: string[];
  provider?: string;
  model?: string;
}

export const workflowCopilotRoute = new Hono();

workflowCopilotRoute.post('/', async (c) => {
  const _userId = getUserId(c);

  const rawBody = await parseJsonBody(c);
  if (!rawBody)
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid JSON body' }, 400);

  let body: CopilotBody;
  try {
    body = validateBody(workflowCopilotSchema, rawBody) as CopilotBody;
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(error) },
      400
    );
  }

  // Resolve provider and model (fall back to user defaults)
  const { provider: resolvedProvider, model: resolvedModel } = await resolveProviderAndModel(
    body.provider ?? 'default',
    body.model ?? 'default'
  );

  if (!resolvedProvider) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PROVIDER_NOT_FOUND,
        message: 'No AI provider configured. Set up a provider in Settings.',
      },
      400
    );
  }

  const apiKey = await getProviderApiKey(resolvedProvider);
  if (!apiKey) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PROVIDER_NOT_FOUND,
        message: `API key not configured for provider: ${resolvedProvider}`,
      },
      400
    );
  }

  // Resolve base URL for custom/local providers
  let baseUrl: string | undefined;
  const config = loadProviderConfig(resolvedProvider);
  if (config?.baseUrl) baseUrl = config.baseUrl;

  const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';

  const provider = createProvider({
    provider: providerType as ProviderConfig['provider'],
    apiKey,
    baseUrl,
    headers: config?.headers,
  });

  // Build system prompt
  const systemPrompt = buildCopilotSystemPrompt(body.currentWorkflow, body.availableTools);

  // Construct messages array
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...body.messages.map((m) => ({ role: m.role as Message['role'], content: m.content })),
  ];

  return streamSSE(c, async (stream) => {
    try {
      let accumulated = '';

      const generator = provider.stream({
        messages,
        model: {
          model: resolvedModel ?? 'gpt-4o',
          maxTokens: 8192,
          temperature: 0.7,
        },
      });

      for await (const result of generator) {
        if (!result.ok) {
          log.error('Stream error:', result.error.message);
          await stream.writeSSE({
            data: JSON.stringify({ error: result.error.message }),
          });
          return;
        }

        const chunk = result.value;
        if (chunk.content) {
          accumulated += chunk.content;
          await stream.writeSSE({
            data: JSON.stringify({ delta: chunk.content }),
          });
        }

        if (chunk.done) {
          await stream.writeSSE({
            data: JSON.stringify({ done: true, content: accumulated }),
          });
        }
      }
    } catch (error) {
      log.error('Copilot stream failed:', getErrorMessage(error));
      await stream.writeSSE({
        data: JSON.stringify({ error: getErrorMessage(error, 'Copilot stream failed') }),
      });
    }
  });
});
