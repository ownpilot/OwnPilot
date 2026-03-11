/**
 * Agent Messages Routes — inter-agent communication API
 */

import { Hono } from 'hono';
import type { AgentMessageType } from '@ownpilot/core';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getPaginationParams,
} from './helpers.js';
import { validateBody, sendAgentMessageSchema } from '../middleware/validation.js';

export const agentMessageRoutes = new Hono();

// ── GET / — list all messages (paginated) ───────────

agentMessageRoutes.get('/', async (c) => {
  try {
    const { limit, offset } = getPaginationParams(c);
    const repo = getAgentMessagesRepository();
    const [messages, total] = await Promise.all([repo.list(limit, offset), repo.count()]);
    return apiResponse(c, { items: messages, total, limit, offset });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /agent/:id — messages for a specific agent ──

agentMessageRoutes.get('/agent/:id', async (c) => {
  try {
    const agentId = c.req.param('id');
    const { limit, offset } = getPaginationParams(c);
    const messages = await getAgentMessagesRepository().listByAgent(agentId, limit, offset);
    return apiResponse(c, messages);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /thread/:id — thread messages ───────────────

agentMessageRoutes.get('/thread/:id', async (c) => {
  try {
    const threadId = c.req.param('id');
    const messages = await getAgentMessagesRepository().findByThread(threadId);
    return apiResponse(c, messages);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── GET /crew/:id — crew messages ───────────────────

agentMessageRoutes.get('/crew/:id', async (c) => {
  try {
    const crewId = c.req.param('id');
    const { limit, offset } = getPaginationParams(c);
    const messages = await getAgentMessagesRepository().listByCrew(crewId, limit, offset);
    return apiResponse(c, messages);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ── POST / — send a message (user → agent) ──────────

agentMessageRoutes.post('/', async (c) => {
  try {
    const body = validateBody(sendAgentMessageSchema, await c.req.json());

    const message = {
      id: crypto.randomUUID(),
      from: body.from || 'user',
      to: body.to,
      type: (body.type || 'coordination') as AgentMessageType,
      subject: body.subject || '',
      content: body.content,
      attachments: body.attachments || [],
      priority: body.priority || 'normal',
      threadId: body.threadId,
      requiresResponse: body.requiresResponse ?? false,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      status: 'sent' as const,
      crewId: body.crewId,
      createdAt: new Date(),
      readAt: undefined,
    };

    await getAgentMessagesRepository().create(message);
    return apiResponse(c, message, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
