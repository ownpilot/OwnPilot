/**
 * Canvas Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// Create mock service at module level with vi.fn() implementations
const mockService = {
  listCanvases: vi.fn<() => Promise<any>>(),
  listElements: vi.fn<() => Promise<any>>(),
  addElement: vi.fn<() => Promise<any>>(),
  updateElement: vi.fn<() => Promise<any>>(),
  moveElement: vi.fn<() => Promise<any>>(),
  removeElement: vi.fn<() => Promise<any>>(),
  clearCanvas: vi.fn<() => Promise<any>>(),
};

// Mock the service module — getCanvasServiceImpl returns mockService
vi.mock('../services/canvas/service.js', () => ({
  getCanvasServiceImpl: () => mockService,
}));

// Named imports must match the named exports
const { canvasRoutes } = await import('./canvas.js');

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/canvas', canvasRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleElement = {
  id: 'canv-1',
  userId: 'user-1',
  canvasId: 'main',
  type: 'note',
  content: 'hello',
  x: 99,
  y: 88,
  w: 200,
  h: 120,
  z: 0,
  style: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Canvas Routes', () => {
  let app: Hono;

  beforeEach(() => {
    // Do NOT call vi.clearAllMocks() — it clears the mockResolvedValue queue
    // for vi.fn() mocks created with an initial implementation
    mockService.listCanvases.mockClear();
    mockService.listElements.mockClear();
    mockService.addElement.mockClear();
    mockService.updateElement.mockClear();
    mockService.moveElement.mockClear();
    mockService.removeElement.mockClear();
    mockService.clearCanvas.mockClear();
    mockService.listCanvases.mockResolvedValue([{ canvasId: 'main', count: 1 }]);
    mockService.listElements.mockResolvedValue([sampleElement]);
    mockService.addElement.mockResolvedValue(sampleElement);
    mockService.updateElement.mockResolvedValue(sampleElement);
    mockService.moveElement.mockResolvedValue(sampleElement);
    mockService.removeElement.mockResolvedValue(true);
    mockService.clearCanvas.mockResolvedValue(2);
    app = createApp();
  });

  describe('GET / (list canvases)', () => {
    it('returns the list of canvases', async () => {
      const res = await app.request('/canvas');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.canvases).toEqual([{ canvasId: 'main', count: 1 }]);
    });
  });

  describe('POST /:canvasId/elements (create)', () => {
    it('creates an element and returns 201', async () => {
      const res = await app.request('/canvas/main/elements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', content: 'hi', x: 10, y: 20 }),
      });
      expect(res.status).toBe(201);
      expect(mockService.addElement).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ canvasId: 'main', type: 'note', content: 'hi', x: 10, y: 20 })
      );
    });

    it('rejects an invalid type with 400', async () => {
      const res = await app.request('/canvas/main/elements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'bogus' }),
      });
      expect(res.status).toBe(400);
      expect(mockService.addElement).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:canvasId/elements/:id (update)', () => {
    it('updates an element', async () => {
      const res = await app.request('/canvas/main/elements/canv-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'new', w: 300 }),
      });
      expect(res.status).toBe(200);
      expect(mockService.updateElement).toHaveBeenCalledWith(
        'user-1',
        'canv-1',
        expect.objectContaining({ content: 'new', w: 300 })
      );
    });

    it('returns 404 when missing', async () => {
      mockService.updateElement.mockResolvedValue(null);
      const res = await app.request('/canvas/main/elements/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:canvasId/elements/:id (remove)', () => {
    it('removes an element', async () => {
      const res = await app.request('/canvas/main/elements/canv-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.removed).toBe(true);
      expect(mockService.removeElement).toHaveBeenCalledWith('user-1', 'canv-1');
    });

    it('returns 404 when missing', async () => {
      mockService.removeElement.mockResolvedValue(false);
      const res = await app.request('/canvas/main/elements/missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:canvasId/elements', () => {
    it('returns the canvas elements', async () => {
      const res = await app.request('/canvas/main/elements');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.canvasId).toBe('main');
      expect(body.data.elements).toHaveLength(1);
      expect(mockService.listElements).toHaveBeenCalledWith('user-1', 'main');
    });
  });

  describe('POST /:canvasId/elements/:id/move', () => {
    it('moves an element and returns it', async () => {
      const res = await app.request('/canvas/main/elements/canv-1/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 99, y: 88 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.x).toBe(99);
      expect(mockService.moveElement).toHaveBeenCalledWith('user-1', 'canv-1', 99, 88);
    });

    it('rejects non-numeric coordinates with 400', async () => {
      const res = await app.request('/canvas/main/elements/canv-1/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 'nope', y: 1 }),
      });
      expect(res.status).toBe(400);
      expect(mockService.moveElement).not.toHaveBeenCalled();
    });

    it('returns 404 when the element does not exist', async () => {
      mockService.moveElement.mockResolvedValue(null);
      const res = await app.request('/canvas/main/elements/missing/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 1, y: 2 }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:canvasId', () => {
    it('clears the canvas and returns the removed count', async () => {
      const res = await app.request('/canvas/main', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.removed).toBe(2);
      expect(mockService.clearCanvas).toHaveBeenCalledWith('user-1', 'main');
    });
  });
});
