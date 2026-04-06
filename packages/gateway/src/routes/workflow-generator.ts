/**
 * Workflow Generator API Routes
 *
 * LLM-powered workflow generation with SSE progress streaming.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getUserId, apiResponse, apiError, getPaginationParams, ERROR_CODES } from './helpers.js';
import { getWorkflowGeneratorService } from '../services/workflow-generator-service.js';

const app = new Hono();

// POST /workflow-generator/generate — Generate workflow from goal (SSE)
app.post('/generate', async (c) => {
  const userId = getUserId(c);
  const { goal, provider, model, availableTools, maxDepth, maxNodes, includeReview } = await c.req.json();
  if (!goal) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'goal is required' }, 400);

  return streamSSE(c, async (stream) => {
    try {
      const result = await getWorkflowGeneratorService().generate(
        goal, userId,
        { provider, model, availableTools, maxDepth, maxNodes, includeReview },
        (event) => {
          void stream.writeSSE({ event: 'progress', data: JSON.stringify(event) });
        }
      );
      await stream.writeSSE({ event: 'result', data: JSON.stringify(result) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    }
  });
});

// POST /workflow-generator/decompose — Just decompose goal into subtasks
app.post('/decompose', async (c) => {
  const userId = getUserId(c);
  const { goal, provider, model, availableTools } = await c.req.json();
  if (!goal) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'goal is required' }, 400);
  const subtasks = await getWorkflowGeneratorService().decompose(goal, userId, { provider, model, availableTools });
  return apiResponse(c, subtasks);
});

// POST /workflow-generator/review — Review a generated workflow
app.post('/review', async (c) => {
  const userId = getUserId(c);
  const { workflow } = await c.req.json();
  if (!workflow) return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'workflow is required' }, 400);
  const result = await getWorkflowGeneratorService().review(workflow, userId);
  return apiResponse(c, result);
});

// GET /workflow-generator/history
app.get('/history', async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = getPaginationParams(c);
  const result = await getWorkflowGeneratorService().listHistory(userId, { limit, offset });
  return apiResponse(c, result);
});

export const workflowGeneratorRoutes = app;
