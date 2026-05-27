/**
 * Canvas Tools Tests
 *
 * Tests the executeCanvasTool function and CANVAS_TOOLS definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCanvasService = {
  addElement: vi.fn(),
  updateElement: vi.fn(),
  moveElement: vi.fn(),
  removeElement: vi.fn(),
  listElements: vi.fn(),
  clearCanvas: vi.fn(),
};

vi.mock('../services/canvas/service.js', () => ({
  getCanvasServiceImpl: () => mockCanvasService,
}));

import { CANVAS_TOOLS, CANVAS_TOOL_NAMES, executeCanvasTool } from './canvas-tools.js';

const makeElement = (overrides: Record<string, unknown> = {}) => ({
  id: 'canv-1',
  userId: 'user-1',
  canvasId: 'main',
  type: 'note' as const,
  content: 'hello',
  x: 10,
  y: 20,
  w: 200,
  h: 120,
  z: 0,
  style: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ...overrides,
});

describe('Canvas Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CANVAS_TOOLS', () => {
    it('exports 6 tool definitions', () => {
      expect(CANVAS_TOOLS).toHaveLength(6);
    });

    it('exports matching CANVAS_TOOL_NAMES', () => {
      expect(CANVAS_TOOL_NAMES).toEqual(CANVAS_TOOLS.map((t) => t.name));
    });

    it('contains expected tool names', () => {
      expect(CANVAS_TOOL_NAMES).toEqual([
        'canvas_add_element',
        'canvas_update_element',
        'canvas_move_element',
        'canvas_remove_element',
        'canvas_list_elements',
        'canvas_clear',
      ]);
    });

    it('all tools are Canvas category and not workflow-usable', () => {
      for (const tool of CANVAS_TOOLS) {
        expect(tool.category).toBe('Canvas');
        expect(tool.workflowUsable).toBe(false);
        expect(tool.description).toBeTruthy();
      }
    });
  });

  describe('canvas_add_element', () => {
    it('adds an element and returns id/type/position', async () => {
      mockCanvasService.addElement.mockResolvedValue(makeElement());

      const result = await executeCanvasTool(
        'canvas_add_element',
        { type: 'note', content: 'hello', x: 10, y: 20 },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('canv-1');
      expect(r.type).toBe('note');
      expect(r.x).toBe(10);
    });

    it('passes input fields through to the service', async () => {
      mockCanvasService.addElement.mockResolvedValue(makeElement());

      await executeCanvasTool(
        'canvas_add_element',
        { type: 'heading', content: 'Title', x: 5, y: 6, w: 300, h: 50, z: 2, canvas_id: 'board2' },
        'user-1'
      );

      expect(mockCanvasService.addElement).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          type: 'heading',
          content: 'Title',
          x: 5,
          y: 6,
          w: 300,
          h: 50,
          z: 2,
          canvasId: 'board2',
        })
      );
    });

    it('returns error on service failure', async () => {
      mockCanvasService.addElement.mockRejectedValue(new Error('DB down'));

      const result = await executeCanvasTool('canvas_add_element', { type: 'note' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB down');
    });
  });

  describe('canvas_update_element', () => {
    it('updates and returns id', async () => {
      mockCanvasService.updateElement.mockResolvedValue(makeElement({ content: 'updated' }));

      const result = await executeCanvasTool(
        'canvas_update_element',
        { element_id: 'canv-1', content: 'updated' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).id).toBe('canv-1');
    });

    it('returns error when not found', async () => {
      mockCanvasService.updateElement.mockResolvedValue(null);

      const result = await executeCanvasTool(
        'canvas_update_element',
        { element_id: 'missing' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing');
    });
  });

  describe('canvas_move_element', () => {
    it('moves and returns new position', async () => {
      mockCanvasService.moveElement.mockResolvedValue(makeElement({ x: 99, y: 88 }));

      const result = await executeCanvasTool(
        'canvas_move_element',
        { element_id: 'canv-1', x: 99, y: 88 },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.x).toBe(99);
      expect(r.y).toBe(88);
      expect(mockCanvasService.moveElement).toHaveBeenCalledWith('user-1', 'canv-1', 99, 88);
    });

    it('returns error when not found', async () => {
      mockCanvasService.moveElement.mockResolvedValue(null);

      const result = await executeCanvasTool(
        'canvas_move_element',
        { element_id: 'missing', x: 1, y: 2 },
        'user-1'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('canvas_remove_element', () => {
    it('removes and returns id', async () => {
      mockCanvasService.removeElement.mockResolvedValue(true);

      const result = await executeCanvasTool(
        'canvas_remove_element',
        { element_id: 'canv-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).id).toBe('canv-1');
    });

    it('returns error when not found', async () => {
      mockCanvasService.removeElement.mockResolvedValue(false);

      const result = await executeCanvasTool(
        'canvas_remove_element',
        { element_id: 'missing' },
        'user-1'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('canvas_list_elements', () => {
    it('lists elements with total and canvasId', async () => {
      mockCanvasService.listElements.mockResolvedValue([
        makeElement({ id: 'a' }),
        makeElement({ id: 'b' }),
      ]);

      const result = await executeCanvasTool('canvas_list_elements', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.canvasId).toBe('main');
      expect(r.total).toBe(2);
      expect((r.elements as unknown[]).length).toBe(2);
    });

    it('passes a custom canvas_id', async () => {
      mockCanvasService.listElements.mockResolvedValue([]);

      await executeCanvasTool('canvas_list_elements', { canvas_id: 'board2' }, 'user-1');

      expect(mockCanvasService.listElements).toHaveBeenCalledWith('user-1', 'board2');
    });
  });

  describe('canvas_clear', () => {
    it('clears and returns removed count', async () => {
      mockCanvasService.clearCanvas.mockResolvedValue(3);

      const result = await executeCanvasTool('canvas_clear', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.removed).toBe(3);
      expect(mockCanvasService.clearCanvas).toHaveBeenCalledWith('user-1', 'main');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeCanvasTool('nonexistent', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown canvas tool');
    });
  });
});
