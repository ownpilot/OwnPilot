/**
 * Canvas Tools
 *
 * LLM tools for the Live Canvas — an agent-driven spatial visual workspace.
 * The agent places, moves, updates, and removes elements; every operation is
 * broadcast over WebSocket so the UI canvas updates live.
 */

import { type ToolDefinition, getErrorMessage } from '@ownpilot/core';
import type { CanvasElementType } from '@ownpilot/core';
import { getCanvasServiceImpl } from '../services/canvas/service.js';

const ELEMENT_TYPES: CanvasElementType[] = [
  'text',
  'note',
  'heading',
  'image',
  'shape',
  'markdown',
  'html',
];

// =============================================================================
// Tool Definitions
// =============================================================================

const addElementDef: ToolDefinition = {
  name: 'canvas_add_element',
  workflowUsable: false,
  description: `Add an element to the Live Canvas — a spatial visual workspace the user sees update in real time.

Use this to build up a visual layout: sticky notes, headings, text blocks, images (by URL), shapes, or rendered markdown/HTML snippets. Position elements with x/y (top-left origin, pixels) and size with w/h. Use z to control stacking order.`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ELEMENT_TYPES,
        description: 'Element type',
      },
      content: {
        type: 'string',
        description:
          'Element content — text for text/note/heading, image URL for image, markdown/html source, or a shape name (rect/ellipse) for shape',
      },
      x: { type: 'number', description: 'X position in pixels (default 0)' },
      y: { type: 'number', description: 'Y position in pixels (default 0)' },
      w: { type: 'number', description: 'Width in pixels (default 200)' },
      h: { type: 'number', description: 'Height in pixels (default 120)' },
      z: { type: 'number', description: 'Stacking order (default 0)' },
      style: {
        type: 'object',
        description:
          'Optional style overrides (e.g. {"background":"#fef3c7","color":"#000","fontSize":18})',
      },
      canvas_id: { type: 'string', description: 'Canvas to target (default "main")' },
    },
    required: ['type'],
  },
  category: 'Canvas',
};

const updateElementDef: ToolDefinition = {
  name: 'canvas_update_element',
  workflowUsable: false,
  description:
    'Update an existing canvas element — change its content, size, position, stacking, or style.',
  parameters: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'ID of the element to update' },
      type: { type: 'string', enum: ELEMENT_TYPES, description: 'New element type' },
      content: { type: 'string', description: 'New content' },
      x: { type: 'number', description: 'New X position' },
      y: { type: 'number', description: 'New Y position' },
      w: { type: 'number', description: 'New width' },
      h: { type: 'number', description: 'New height' },
      z: { type: 'number', description: 'New stacking order' },
      style: { type: 'object', description: 'New style overrides' },
    },
    required: ['element_id'],
  },
  category: 'Canvas',
};

const moveElementDef: ToolDefinition = {
  name: 'canvas_move_element',
  workflowUsable: false,
  description: 'Move a canvas element to a new (x, y) position.',
  parameters: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'ID of the element to move' },
      x: { type: 'number', description: 'New X position in pixels' },
      y: { type: 'number', description: 'New Y position in pixels' },
    },
    required: ['element_id', 'x', 'y'],
  },
  category: 'Canvas',
};

const removeElementDef: ToolDefinition = {
  name: 'canvas_remove_element',
  workflowUsable: false,
  description: 'Remove a single element from the canvas.',
  parameters: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'ID of the element to remove' },
    },
    required: ['element_id'],
  },
  category: 'Canvas',
};

const listElementsDef: ToolDefinition = {
  name: 'canvas_list_elements',
  workflowUsable: false,
  description: 'List all elements currently on a canvas, with their positions and content.',
  parameters: {
    type: 'object',
    properties: {
      canvas_id: { type: 'string', description: 'Canvas to list (default "main")' },
    },
  },
  category: 'Canvas',
};

const clearCanvasDef: ToolDefinition = {
  name: 'canvas_clear',
  workflowUsable: false,
  description: 'Remove all elements from a canvas. Use sparingly — this is destructive.',
  parameters: {
    type: 'object',
    properties: {
      canvas_id: { type: 'string', description: 'Canvas to clear (default "main")' },
    },
  },
  category: 'Canvas',
};

export const CANVAS_TOOLS: ToolDefinition[] = [
  addElementDef,
  updateElementDef,
  moveElementDef,
  removeElementDef,
  listElementsDef,
  clearCanvasDef,
];

export const CANVAS_TOOL_NAMES = CANVAS_TOOLS.map((t) => t.name);

// =============================================================================
// Executor
// =============================================================================

export async function executeCanvasTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getCanvasServiceImpl();

  try {
    switch (toolName) {
      case 'canvas_add_element': {
        const element = await service.addElement(userId, {
          canvasId: args.canvas_id as string | undefined,
          type: args.type as CanvasElementType,
          content: args.content as string | undefined,
          x: args.x as number | undefined,
          y: args.y as number | undefined,
          w: args.w as number | undefined,
          h: args.h as number | undefined,
          z: args.z as number | undefined,
          style: (args.style as Record<string, unknown> | undefined) ?? null,
        });
        return {
          success: true,
          result: {
            id: element.id,
            type: element.type,
            x: element.x,
            y: element.y,
            message: `Added ${element.type} element ${element.id} at (${element.x}, ${element.y}).`,
          },
        };
      }

      case 'canvas_update_element': {
        const id = args.element_id as string;
        const element = await service.updateElement(userId, id, {
          type: args.type as CanvasElementType | undefined,
          content: args.content as string | undefined,
          x: args.x as number | undefined,
          y: args.y as number | undefined,
          w: args.w as number | undefined,
          h: args.h as number | undefined,
          z: args.z as number | undefined,
          style: args.style as Record<string, unknown> | undefined,
        });
        if (!element) return { success: false, error: `Canvas element not found: ${id}` };
        return { success: true, result: { id: element.id, message: `Updated element ${id}.` } };
      }

      case 'canvas_move_element': {
        const id = args.element_id as string;
        const element = await service.moveElement(userId, id, args.x as number, args.y as number);
        if (!element) return { success: false, error: `Canvas element not found: ${id}` };
        return {
          success: true,
          result: {
            id: element.id,
            x: element.x,
            y: element.y,
            message: `Moved element ${id} to (${element.x}, ${element.y}).`,
          },
        };
      }

      case 'canvas_remove_element': {
        const id = args.element_id as string;
        const removed = await service.removeElement(userId, id);
        if (!removed) return { success: false, error: `Canvas element not found: ${id}` };
        return { success: true, result: { id, message: `Removed element ${id}.` } };
      }

      case 'canvas_list_elements': {
        const canvasId = (args.canvas_id as string) ?? 'main';
        const elements = await service.listElements(userId, canvasId);
        return {
          success: true,
          result: {
            canvasId,
            total: elements.length,
            elements: elements.map((e) => ({
              id: e.id,
              type: e.type,
              content: e.content,
              x: e.x,
              y: e.y,
              w: e.w,
              h: e.h,
              z: e.z,
            })),
          },
        };
      }

      case 'canvas_clear': {
        const canvasId = (args.canvas_id as string) ?? 'main';
        const count = await service.clearCanvas(userId, canvasId);
        return {
          success: true,
          result: { canvasId, removed: count, message: `Cleared ${count} elements.` },
        };
      }

      default:
        return { success: false, error: `Unknown canvas tool: ${toolName}` };
    }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) };
  }
}
