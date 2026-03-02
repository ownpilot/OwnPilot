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
    const body = await c.req.json();
    const url = body.url as string;

    if (!url) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'url is required' }, 400);
    }

    const service = getBrowserService();
    const result = await service.navigate(userId, url);
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.post('/action', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();
    const actionType = body.type as string;

    if (!actionType) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'type is required' },
        400
      );
    }

    const service = getBrowserService();

    switch (actionType) {
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
          body.direction ?? 'down',
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
            { code: ERROR_CODES.VALIDATION_ERROR, message: 'fields array is required for fill_form' },
            400
          );
        const result = await service.fillForm(userId, body.fields);
        return apiResponse(c, result);
      }
      case 'extract': {
        if (body.dataSelectors) {
          const result = await service.extractData(userId, body.dataSelectors);
          return apiResponse(c, result);
        }
        const result = await service.extractText(userId, body.selector);
        return apiResponse(c, result);
      }
      default:
        return apiError(
          c,
          { code: ERROR_CODES.VALIDATION_ERROR, message: `Unknown action type: ${actionType}` },
          400
        );
    }
  } catch (err) {
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
    const body = await c.req.json();

    if (!body.name) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' },
        400
      );
    }
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'steps array is required and must not be empty' },
        400
      );
    }

    const repo = getWorkflowRepo();
    const workflow = await repo.create(userId, {
      name: body.name,
      description: body.description,
      steps: body.steps,
      parameters: body.parameters,
      triggerId: body.triggerId,
    });
    return apiResponse(c, workflow, 201);
  } catch (err) {
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
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` },
        404
      );
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
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` },
        404
      );
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
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` },
        404
      );
    }
    return apiResponse(c, { message: `Workflow ${id} deleted` });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
