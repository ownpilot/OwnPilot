/**
 * Canvas (Live Canvas) schemas.
 *
 * The canvas is a shared visual workspace where agents and users collaborate
 * in real-time. Elements are broadcast via WebSocket on every mutation.
 */

import { z } from 'zod';

const elementStyleSchema = z.record(z.string(), z.unknown()).optional();

const baseElementSchema = z.object({
  type: z.enum(['text', 'note', 'heading', 'image', 'shape', 'markdown', 'html']),
  content: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  z: z.number().optional(),
  style: elementStyleSchema,
});

export const createCanvasElementSchema = baseElementSchema;

export const updateCanvasElementSchema = baseElementSchema.partial();

export const moveCanvasElementSchema = z.object({
  x: z.number(),
  y: z.number(),
});
