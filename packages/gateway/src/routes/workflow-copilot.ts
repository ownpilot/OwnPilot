/**
 * Workflow Copilot — SSE streaming endpoint.
 *
 * Lightweight AI chat for generating/editing workflow JSON definitions.
 * Uses the shared runtime provider resolver — no agent infrastructure needed.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { apiError, getErrorMessage, parseJsonBody } from './helpers.js';
import { ERROR_CODES } from './error-codes.js';
import { validateBody, workflowCopilotSchema } from '../middleware/validation.js';
import type { Message } from '@ownpilot/core';
import { buildCopilotSystemPrompt } from './workflow-copilot-prompt.js';
import { getLog } from '../services/log.js';
import { resolveRuntimeProvider } from '../services/model-execution.js';

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
  const resolved = await resolveRuntimeProvider(body.provider, body.model);
  if (!resolved.providerId || !resolved.model || !resolved.instance) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PROVIDER_NOT_FOUND,
        message: 'No AI provider configured. Set up a provider in Settings.',
      },
      400
    );
  }

  const provider = resolved.instance;
  const model = resolved.model;

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
          model,
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
