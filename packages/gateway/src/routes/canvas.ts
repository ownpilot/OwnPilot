/**
 * Canvas Routes
 *
 * REST API for the Live Canvas. Both the agent (via tools) and the UI mutate
 * the canvas through the service, which broadcasts every change over the
 * `canvas:op` WS event so all open boards update live.
 */

import { Hono } from 'hono';
import type { CanvasElementType } from '@ownpilot/core';
import { getCanvasServiceImpl } from '../services/canvas/service.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

export const canvasRoutes = new Hono();

const ELEMENT_TYPES: CanvasElementType[] = [
  'text',
  'note',
  'heading',
  'image',
  'shape',
  'markdown',
  'html',
];

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// GET / - List canvases (distinct canvas ids + element counts)
canvasRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const canvases = await getCanvasServiceImpl().listCanvases(userId);
    return apiResponse(c, { canvases });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// GET /:canvasId/elements - List elements on a canvas
canvasRoutes.get('/:canvasId/elements', async (c) => {
  try {
    const userId = getUserId(c);
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
    const userId = getUserId(c);
    const canvasId = c.req.param('canvasId') || 'main';
    const body = (await c.req.json()) as Record<string, unknown>;
    const type = body.type as CanvasElementType;
    if (!ELEMENT_TYPES.includes(type)) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `type must be one of: ${ELEMENT_TYPES.join(', ')}`,
        },
        400
      );
    }
    const element = await getCanvasServiceImpl().addElement(userId, {
      canvasId,
      type,
      content: typeof body.content === 'string' ? body.content : undefined,
      x: numOrUndef(body.x),
      y: numOrUndef(body.y),
      w: numOrUndef(body.w),
      h: numOrUndef(body.h),
      z: numOrUndef(body.z),
      style: (body.style as Record<string, unknown> | null | undefined) ?? null,
    });
    return apiResponse(c, element, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// PATCH /:canvasId/elements/:id - Update an element (content/size/position/style)
canvasRoutes.patch('/:canvasId/elements/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const body = (await c.req.json()) as Record<string, unknown>;
    const type = body.type as CanvasElementType | undefined;
    if (type !== undefined && !ELEMENT_TYPES.includes(type)) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'invalid type' }, 400);
    }
    const element = await getCanvasServiceImpl().updateElement(userId, id, {
      type,
      content: typeof body.content === 'string' ? body.content : undefined,
      x: numOrUndef(body.x),
      y: numOrUndef(body.y),
      w: numOrUndef(body.w),
      h: numOrUndef(body.h),
      z: numOrUndef(body.z),
      style: body.style === undefined ? undefined : (body.style as Record<string, unknown> | null),
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
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// POST /:canvasId/elements/:id/move - Move an element (user drag persistence)
canvasRoutes.post('/:canvasId/elements/:id/move', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const body = (await c.req.json()) as { x?: unknown; y?: unknown };
    const x = Number(body.x);
    const y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'x and y must be numbers' },
        400
      );
    }
    const element = await getCanvasServiceImpl().moveElement(userId, id, x, y);
    if (!element) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Canvas element not found: ${id}` },
        404
      );
    }
    return apiResponse(c, element);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// DELETE /:canvasId/elements/:id - Remove a single element
canvasRoutes.delete('/:canvasId/elements/:id', async (c) => {
  try {
    const userId = getUserId(c);
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
    const userId = getUserId(c);
    const canvasId = c.req.param('canvasId') || 'main';
    const removed = await getCanvasServiceImpl().clearCanvas(userId, canvasId);
    return apiResponse(c, { canvasId, removed });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
