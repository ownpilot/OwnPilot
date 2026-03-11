/**
 * Browser Routes
 *
 * REST API for headless browser automation and workflow management.
 */

import { Hono } from 'hono';
import { getBrowserService } from '../services/browser-service.js';
import { BrowserWorkflowsRepository } from '../db/repositories/browser-workflows.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getPaginationParams } from './helpers.js';
import { getErrorMessage } from '@ownpilot/core';
import {
  validateBody,
  browserNavigateSchema,
  browserActionSchema,
  createBrowserWorkflowSchema,
} from '../middleware/validation.js';

export const browserRoutes = new Hono();

function getWorkflowRepo(): BrowserWorkflowsRepository {
  return new BrowserWorkflowsRepository();
}

// ============================================================================
// Browser Config
// ============================================================================

browserRoutes.get('/config', async (c) => {
  try {
    const service = getBrowserService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// Browser Actions
// ============================================================================

browserRoutes.post('/navigate', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(browserNavigateSchema, await c.req.json());

    const service = getBrowserService();
    const result = await service.navigate(userId, body.url);
    return apiResponse(c, result);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.post('/action', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(browserActionSchema, await c.req.json());

    const service = getBrowserService();

    switch (body.type) {
      case 'click': {
        if (!body.selector)
          return apiError(
            c,
            { code: ERROR_CODES.VALIDATION_ERROR, message: 'selector is required for click' },
            400
          );
        const result = await service.click(userId, body.selector);
        return apiResponse(c, result);
      }
      case 'type': {
        if (!body.selector || !body.text)
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: 'selector and text are required for type',
            },
            400
          );
        const result = await service.type(userId, body.selector, body.text);
        return apiResponse(c, result);
      }
      case 'scroll': {
        const result = await service.scroll(
          userId,
          (body.direction ?? 'down') as 'up' | 'down',
          body.pixels as number | undefined
        );
        return apiResponse(c, result);
      }
      case 'select': {
        if (!body.selector || !body.value)
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: 'selector and value are required for select',
            },
            400
          );
        const result = await service.select(userId, body.selector, body.value);
        return apiResponse(c, result);
      }
      case 'wait': {
        const result = await service.wait(
          userId,
          body.selector as string | undefined,
          body.timeout as number | undefined
        );
        return apiResponse(c, result);
      }
      case 'fill_form': {
        if (!Array.isArray(body.fields))
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: 'fields array is required for fill_form',
            },
            400
          );
        const result = await service.fillForm(userId, body.fields as unknown as import('../services/browser-service.js').FormField[]);
        return apiResponse(c, result);
      }
      case 'extract': {
        if (body.dataSelectors) {
          const result = await service.extractData(userId, body.dataSelectors as Record<string, string>);
          return apiResponse(c, result);
        }
        const result = await service.extractText(userId, body.selector);
        return apiResponse(c, result);
      }
      default:
        return apiError(
          c,
          { code: ERROR_CODES.VALIDATION_ERROR, message: `Unknown action type: ${body.type}` },
          400
        );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.post('/screenshot', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json().catch(() => ({}));
    const service = getBrowserService();
    const result = await service.screenshot(userId, {
      fullPage: body.fullPage as boolean | undefined,
      selector: body.selector as string | undefined,
    });
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.delete('/session', async (c) => {
  try {
    const userId = getUserId(c);
    const service = getBrowserService();
    const closed = await service.closePage(userId);
    return apiResponse(c, { closed });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// Browser Workflows CRUD
// ============================================================================

browserRoutes.get('/workflows', async (c) => {
  try {
    const userId = getUserId(c);
    const { limit, offset } = getPaginationParams(c);
    const repo = getWorkflowRepo();
    const result = await repo.listByUser(userId, limit, offset);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.post('/workflows', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(createBrowserWorkflowSchema, await c.req.json());

    const repo = getWorkflowRepo();
    const workflow = await repo.create(userId, {
      name: body.name,
      description: body.description,
      steps: body.steps as unknown as import('../services/browser-service.js').BrowserAction[],
      parameters: body.parameters as unknown as import('../db/repositories/browser-workflows.js').WorkflowParameter[] | undefined,
      triggerId: body.triggerId,
    });
    return apiResponse(c, workflow, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.get('/workflows/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const repo = getWorkflowRepo();
    const workflow = await repo.getById(id, userId);

    if (!workflow) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }
    return apiResponse(c, workflow);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.patch('/workflows/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const body = await c.req.json();
    const repo = getWorkflowRepo();
    const workflow = await repo.update(id, userId, body);

    if (!workflow) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }
    return apiResponse(c, workflow);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.delete('/workflows/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const repo = getWorkflowRepo();
    const deleted = await repo.delete(id, userId);

    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }
    return apiResponse(c, { message: `Workflow ${id} deleted` });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
