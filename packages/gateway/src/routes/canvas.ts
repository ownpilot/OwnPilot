/**
 * Canvas Routes
 *
 * REST API for the Live Canvas. Both the agent (via tools) and the UI mutate
 * the canvas through the service, which broadcasts every change over the
 * `canvas:op` WS event so all open boards update live.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { getCanvasServiceImpl } from '../services/canvas/service.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  zodValidationError,
} from './helpers.js';
import {
  validateBody,
  ValidationError,
  createCanvasElementSchema,
  updateCanvasElementSchema,
  moveCanvasElementSchema,
} from '../middleware/validation.js';

export const canvasRoutes = new Hono();

// GET / - List canvases (distinct canvas ids + element counts)
canvasRoutes.get('/', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const canvases = await getCanvasServiceImpl().listCanvases(userId);
    return apiResponse(c, { canvases });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:canvasId/elements - List elements on a canvas
canvasRoutes.get('/:canvasId/elements', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const canvasId = c.req.param('canvasId') || 'main';
    const elements = await getCanvasServiceImpl().listElements(userId, canvasId);
    return apiResponse(c, { canvasId, elements });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:canvasId/elements - Create an element (UI add)
canvasRoutes.post('/:canvasId/elements', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const canvasId = c.req.param('canvasId') || 'main';
    const body = validateBody(createCanvasElementSchema, await c.req.json());
    const element = await getCanvasServiceImpl().addElement(userId, {
      canvasId,
      type: body.type,
      content: body.content,
      x: body.x,
      y: body.y,
      w: body.w,
      h: body.h,
      z: body.z,
      style: body.style ?? null,
    });
    return apiResponse(c, element, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return zodValidationError(c, err.issues);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PATCH /:canvasId/elements/:id - Update an element (content/size/position/style)
canvasRoutes.patch('/:canvasId/elements/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = c.req.param('id');
    const body = validateBody(updateCanvasElementSchema, await c.req.json());
    const element = await getCanvasServiceImpl().updateElement(userId, id, {
      type: body.type,
      content: body.content,
      x: body.x,
      y: body.y,
      w: body.w,
      h: body.h,
      z: body.z,
      style: body.style === undefined ? undefined : (body.style ?? null),
    });
    if (!element) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Canvas element not found: ${id}` },
        404
      );
    }
    return apiResponse(c, element);
  } catch (err) {
    if (err instanceof ValidationError) {
      return zodValidationError(c, err.issues);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:canvasId/elements/:id/move - Move an element (user drag persistence)
canvasRoutes.post('/:canvasId/elements/:id/move', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = c.req.param('id');
    const body = validateBody(moveCanvasElementSchema, await c.req.json());
    const element = await getCanvasServiceImpl().moveElement(userId, id, body.x, body.y);
    if (!element) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Canvas element not found: ${id}` },
        404
      );
    }
    return apiResponse(c, element);
  } catch (err) {
    if (err instanceof ValidationError) {
      return zodValidationError(c, err.issues);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:canvasId/elements/:id - Remove a single element
canvasRoutes.delete('/:canvasId/elements/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const id = c.req.param('id');
    const removed = await getCanvasServiceImpl().removeElement(userId, id);
    if (!removed) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Canvas element not found: ${id}` },
        404
      );
    }
    return apiResponse(c, { id, removed: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:canvasId - Clear all elements on a canvas
canvasRoutes.delete('/:canvasId', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const canvasId = c.req.param('canvasId') || 'main';
    const removed = await getCanvasServiceImpl().clearCanvas(userId, canvasId);
    return apiResponse(c, { canvasId, removed });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
