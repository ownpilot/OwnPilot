/**
 * Browser Routes
 *
 * REST API for headless browser automation and workflow management.
 *
 * Trust boundary: Browser automation tasks carry a flexible task config payload; casts below read typed fields off the validated body. Zod schema validation is the trust boundary above these casts.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getBrowserService,
  type BrowserAction,
  type FormField,
} from '../services/browser-service.js';
import { getTriggerService } from '../services/index.js';
import {
  BrowserWorkflowsRepository,
  type WorkflowParameter,
} from '../db/repositories/browser-workflows.js';
import { apiResponse, apiError, ERROR_CODES, getPaginationParams } from './helpers.js';
import { getErrorMessage } from '@ownpilot/core/services';
import {
  validateBody,
  browserNavigateSchema,
  browserActionSchema,
  createBrowserWorkflowSchema,
} from '../middleware/validation.js';

const screenshotSchema = z.object({
  fullPage: z.boolean().optional(),
  selector: z.string().max(500).optional(),
});

const updateBrowserWorkflowSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  steps: z.array(z.unknown()).max(1000).optional(),
  parameters: z.array(z.unknown()).max(100).optional(),
  triggerId: z.string().max(200).nullable().optional(),
});

export const browserRoutes = new Hono();

const WORKFLOW_ACTION_TYPES = new Set<BrowserAction['type']>([
  'navigate',
  'click',
  'type',
  'screenshot',
  'extract',
  'wait',
  'scroll',
  'select',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFormFields(value: unknown): FormField[] | null {
  if (!Array.isArray(value)) return null;
  const fields: FormField[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.selector !== 'string' || typeof item.value !== 'string') {
      return null;
    }
    fields.push({ selector: item.selector, value: item.value });
  }
  return fields;
}

function toBrowserAction(value: Record<string, unknown>): BrowserAction | null {
  const type = value.type;
  if (typeof type !== 'string' || !WORKFLOW_ACTION_TYPES.has(type as BrowserAction['type'])) {
    return null;
  }

  const action: BrowserAction = { type: type as BrowserAction['type'] };
  if (typeof value.selector === 'string') action.selector = value.selector;
  if (typeof value.url === 'string') action.url = value.url;
  if (typeof value.text === 'string') action.text = value.text;
  if (typeof value.value === 'string') action.value = value.value;
  if (typeof value.timeout === 'number') action.timeout = value.timeout;
  return action;
}

function toBrowserActions(value: Array<Record<string, unknown>>): BrowserAction[] | null {
  const actions: BrowserAction[] = [];
  for (const item of value) {
    const action = toBrowserAction(item);
    if (!action) return null;
    actions.push(action);
  }
  return actions;
}

function toWorkflowParameters(value: unknown): WorkflowParameter[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        name: typeof record.name === 'string' ? record.name : '',
        type: typeof record.type === 'string' ? record.type : 'string',
        description: typeof record.description === 'string' ? record.description : '',
      };
    });
  }
  if (!isRecord(value)) return undefined;
  return Object.entries(value).map(([name, raw]) => {
    const record = isRecord(raw) ? raw : null;
    return {
      name,
      type:
        typeof raw === 'string' ? raw : typeof record?.type === 'string' ? record.type : 'string',
      description: typeof record?.description === 'string' ? record.description : '',
    };
  });
}

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
    const userId = LOCAL_OWNER_ID;
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
    const userId = LOCAL_OWNER_ID;
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
        const fields = toFormFields(body.fields);
        if (!fields)
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: 'fields array is required for fill_form',
            },
            400
          );
        const result = await service.fillForm(userId, fields);
        return apiResponse(c, result);
      }
      case 'extract': {
        if (body.dataSelectors) {
          const result = await service.extractData(
            userId,
            body.dataSelectors as Record<string, string>
          );
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
    const userId = LOCAL_OWNER_ID;
    const raw = await c.req.json().catch(() => ({}));
    const body = validateBody(screenshotSchema, raw);
    const service = getBrowserService();
    const result = await service.screenshot(userId, {
      fullPage: body.fullPage,
      selector: body.selector,
    });
    return apiResponse(c, result);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.delete('/session', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
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
    const userId = LOCAL_OWNER_ID;
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
    const userId = LOCAL_OWNER_ID;
    const body = validateBody(createBrowserWorkflowSchema, await c.req.json());
    const steps = toBrowserActions(body.steps);
    if (!steps) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'steps contain an invalid browser action' },
        400
      );
    }

    const repo = getWorkflowRepo();
    const workflow = await repo.create(userId, {
      name: body.name,
      description: body.description,
      steps,
      parameters: toWorkflowParameters(body.parameters),
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
    const userId = LOCAL_OWNER_ID;
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
    const userId = LOCAL_OWNER_ID;
    const id = c.req.param('id');
    const body = validateBody(updateBrowserWorkflowSchema, await c.req.json());
    const repo = getWorkflowRepo();
    const workflow = await repo.update(
      id,
      userId,
      body as Parameters<BrowserWorkflowsRepository['update']>[2]
    );

    if (!workflow) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }
    return apiResponse(c, workflow);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

browserRoutes.delete('/workflows/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = c.req.param('id');
    const repo = getWorkflowRepo();

    // Fetch to get triggerId before deleting (heartbeat pattern)
    const existing = await repo.getById(id, userId);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }

    // Delete associated trigger if present
    if (existing.triggerId) {
      const triggerService = getTriggerService();
      await triggerService.deleteTrigger(userId, existing.triggerId);
    }

    const deleted = await repo.delete(id, userId);
    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Workflow ${id} not found` }, 404);
    }
    return apiResponse(c, { message: `Workflow ${id} deleted` });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
