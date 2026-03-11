/**
 * Browser Routes Tests
 *
 * Integration tests for the headless browser automation and workflow management API.
 * Mocks getBrowserService and BrowserWorkflowsRepository to keep tests fast and DB-free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock: BrowserService singleton factory
// ---------------------------------------------------------------------------

const mockBrowserService = {
  getConfig: vi.fn(),
  navigate: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  scroll: vi.fn(),
  select: vi.fn(),
  wait: vi.fn(),
  fillForm: vi.fn(),
  extractData: vi.fn(),
  extractText: vi.fn(),
  screenshot: vi.fn(),
  closePage: vi.fn(),
};

vi.mock('../services/browser-service.js', () => ({
  getBrowserService: vi.fn(() => mockBrowserService),
}));

// ---------------------------------------------------------------------------
// Mock: BrowserWorkflowsRepository (class-based, instantiated per-request)
// ---------------------------------------------------------------------------

const mockWorkflowRepo = {
  listByUser: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../db/repositories/browser-workflows.js', () => ({
  BrowserWorkflowsRepository: vi.fn(function () {
    return mockWorkflowRepo;
  }),
}));

// ---------------------------------------------------------------------------
// Import route after mocks
// ---------------------------------------------------------------------------

const { browserRoutes } = await import('./browser.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/browser', browserRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bwf-1',
    userId: 'default',
    name: 'Login Flow',
    description: 'Automated login workflow',
    steps: [{ type: 'navigate', url: 'https://example.com' }],
    parameters: [],
    triggerId: null,
    lastExecutedAt: null,
    executionCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeBrowserResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    url: 'https://example.com',
    title: 'Example Domain',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Browser Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // =========================================================================
  // GET /browser/config
  // =========================================================================

  describe('GET /browser/config', () => {
    it('returns browser configuration', async () => {
      const config = {
        available: true,
        executablePath: '/usr/bin/chromium',
        allowedDomains: [],
        maxPagesPerUser: 5,
      };
      mockBrowserService.getConfig.mockResolvedValue(config);

      const res = await app.request('/browser/config');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.available).toBe(true);
      expect(json.data.maxPagesPerUser).toBe(5);
      expect(mockBrowserService.getConfig).toHaveBeenCalledOnce();
    });

    it('returns 500 when service throws', async () => {
      mockBrowserService.getConfig.mockRejectedValue(new Error('Browser unavailable'));

      const res = await app.request('/browser/config');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('Browser unavailable');
    });
  });

  // =========================================================================
  // POST /browser/navigate
  // =========================================================================

  describe('POST /browser/navigate', () => {
    it('navigates to a URL and returns result', async () => {
      const result = makeBrowserResult({ url: 'https://example.com', title: 'Example' });
      mockBrowserService.navigate.mockResolvedValue(result);

      const res = await app.request('/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.url).toBe('https://example.com');
      expect(mockBrowserService.navigate).toHaveBeenCalledWith('default', 'https://example.com');
    });

    it('returns 400 when url is missing', async () => {
      const res = await app.request('/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 500 when service throws', async () => {
      mockBrowserService.navigate.mockRejectedValue(new Error('Navigation timeout'));

      const res = await app.request('/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Navigation timeout');
    });
  });

  // =========================================================================
  // POST /browser/action
  // =========================================================================

  describe('POST /browser/action', () => {
    it('returns 400 when type is missing', async () => {
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Validation failed');
    });

    it('performs click action with selector', async () => {
      const result = makeBrowserResult();
      mockBrowserService.click.mockResolvedValue(result);

      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click', selector: '#submit-btn' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockBrowserService.click).toHaveBeenCalledWith('default', '#submit-btn');
    });

    it('returns 400 for click without selector', async () => {
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('selector is required for click');
    });

    it('performs type action', async () => {
      const result = makeBrowserResult();
      mockBrowserService.type.mockResolvedValue(result);

      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'type', selector: '#email', text: 'user@example.com' }),
      });

      expect(res.status).toBe(200);
      expect(mockBrowserService.type).toHaveBeenCalledWith('default', '#email', 'user@example.com');
    });

    it('returns 400 for type without selector or text', async () => {
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'type', selector: '#email' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('selector and text are required for type');
    });

    it('performs scroll action with defaults', async () => {
      const result = makeBrowserResult();
      mockBrowserService.scroll.mockResolvedValue(result);

      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scroll' }),
      });

      expect(res.status).toBe(200);
      expect(mockBrowserService.scroll).toHaveBeenCalledWith('default', 'down', undefined);
    });

    it('performs fill_form action', async () => {
      const result = makeBrowserResult();
      mockBrowserService.fillForm.mockResolvedValue(result);

      const fields = [{ selector: '#email', value: 'a@b.com' }];
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fill_form', fields }),
      });

      expect(res.status).toBe(200);
      expect(mockBrowserService.fillForm).toHaveBeenCalledWith('default', fields);
    });

    it('returns 400 for fill_form without fields array', async () => {
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fill_form', fields: 'not-an-array' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 for unknown action type', async () => {
      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'teleport' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 500 when service throws during action', async () => {
      mockBrowserService.click.mockRejectedValue(new Error('Page closed'));

      const res = await app.request('/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click', selector: '#btn' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Page closed');
    });
  });

  // =========================================================================
  // POST /browser/screenshot
  // =========================================================================

  describe('POST /browser/screenshot', () => {
    it('takes a screenshot and returns result', async () => {
      const result = makeBrowserResult({ screenshot: 'base64data==' });
      mockBrowserService.screenshot.mockResolvedValue(result);

      const res = await app.request('/browser/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullPage: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.screenshot).toBe('base64data==');
      expect(mockBrowserService.screenshot).toHaveBeenCalledWith('default', {
        fullPage: true,
        selector: undefined,
      });
    });

    it('works with empty body (no Content-Type needed)', async () => {
      const result = makeBrowserResult();
      mockBrowserService.screenshot.mockResolvedValue(result);

      const res = await app.request('/browser/screenshot', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(mockBrowserService.screenshot).toHaveBeenCalledOnce();
    });

    it('returns 500 when service throws', async () => {
      mockBrowserService.screenshot.mockRejectedValue(new Error('No active page'));

      const res = await app.request('/browser/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('No active page');
    });
  });

  // =========================================================================
  // DELETE /browser/session
  // =========================================================================

  describe('DELETE /browser/session', () => {
    it('closes the session and returns closed: true', async () => {
      mockBrowserService.closePage.mockResolvedValue(true);

      const res = await app.request('/browser/session', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.closed).toBe(true);
      expect(mockBrowserService.closePage).toHaveBeenCalledWith('default');
    });

    it('returns closed: false when no session was open', async () => {
      mockBrowserService.closePage.mockResolvedValue(false);

      const res = await app.request('/browser/session', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.closed).toBe(false);
    });

    it('returns 500 when service throws', async () => {
      mockBrowserService.closePage.mockRejectedValue(new Error('Close error'));

      const res = await app.request('/browser/session', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // GET /browser/workflows
  // =========================================================================

  describe('GET /browser/workflows', () => {
    it('returns list of workflows with total', async () => {
      const workflows = [makeWorkflow({ id: 'bwf-1' }), makeWorkflow({ id: 'bwf-2' })];
      mockWorkflowRepo.listByUser.mockResolvedValue({ workflows, total: 2 });

      const res = await app.request('/browser/workflows');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.workflows).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(mockWorkflowRepo.listByUser).toHaveBeenCalledWith('default', 20, 0);
    });

    it('respects pagination params', async () => {
      mockWorkflowRepo.listByUser.mockResolvedValue({ workflows: [], total: 0 });

      await app.request('/browser/workflows?limit=5&offset=10');

      expect(mockWorkflowRepo.listByUser).toHaveBeenCalledWith('default', 5, 10);
    });

    it('returns 500 on repository error', async () => {
      mockWorkflowRepo.listByUser.mockRejectedValue(new Error('DB connection lost'));

      const res = await app.request('/browser/workflows');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // POST /browser/workflows
  // =========================================================================

  describe('POST /browser/workflows', () => {
    it('creates a workflow and returns 201', async () => {
      const workflow = makeWorkflow({ id: 'bwf-new', name: 'My Flow' });
      mockWorkflowRepo.create.mockResolvedValue(workflow);

      const res = await app.request('/browser/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Flow',
          steps: [{ type: 'navigate', url: 'https://example.com' }],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('bwf-new');
      expect(json.data.name).toBe('My Flow');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/browser/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: [{ type: 'navigate', url: 'https://example.com' }] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 when steps is empty', async () => {
      const res = await app.request('/browser/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Flow', steps: [] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 when steps is not an array', async () => {
      const res = await app.request('/browser/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Flow', steps: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 500 on repository error', async () => {
      mockWorkflowRepo.create.mockRejectedValue(new Error('Insert failed'));

      const res = await app.request('/browser/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Flow',
          steps: [{ type: 'navigate', url: 'https://example.com' }],
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Insert failed');
    });
  });

  // =========================================================================
  // GET /browser/workflows/:id
  // =========================================================================

  describe('GET /browser/workflows/:id', () => {
    it('returns workflow when found', async () => {
      const workflow = makeWorkflow({ id: 'bwf-42' });
      mockWorkflowRepo.getById.mockResolvedValue(workflow);

      const res = await app.request('/browser/workflows/bwf-42');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('bwf-42');
      expect(mockWorkflowRepo.getById).toHaveBeenCalledWith('bwf-42', 'default');
    });

    it('returns 404 when workflow not found', async () => {
      mockWorkflowRepo.getById.mockResolvedValue(null);

      const res = await app.request('/browser/workflows/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('Workflow nonexistent not found');
    });

    it('returns 500 on repository error', async () => {
      mockWorkflowRepo.getById.mockRejectedValue(new Error('Read failed'));

      const res = await app.request('/browser/workflows/bwf-1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // PATCH /browser/workflows/:id
  // =========================================================================

  describe('PATCH /browser/workflows/:id', () => {
    it('updates a workflow and returns it', async () => {
      const updated = makeWorkflow({ id: 'bwf-1', name: 'Updated Flow' });
      mockWorkflowRepo.update.mockResolvedValue(updated);

      const res = await app.request('/browser/workflows/bwf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Flow' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Flow');
      expect(mockWorkflowRepo.update).toHaveBeenCalledWith('bwf-1', 'default', {
        name: 'Updated Flow',
      });
    });

    it('returns 404 when workflow not found', async () => {
      mockWorkflowRepo.update.mockResolvedValue(null);

      const res = await app.request('/browser/workflows/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 on repository error', async () => {
      mockWorkflowRepo.update.mockRejectedValue(new Error('Update failed'));

      const res = await app.request('/browser/workflows/bwf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // DELETE /browser/workflows/:id
  // =========================================================================

  describe('DELETE /browser/workflows/:id', () => {
    it('deletes a workflow and returns success message', async () => {
      mockWorkflowRepo.delete.mockResolvedValue(true);

      const res = await app.request('/browser/workflows/bwf-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('bwf-1 deleted');
      expect(mockWorkflowRepo.delete).toHaveBeenCalledWith('bwf-1', 'default');
    });

    it('returns 404 when workflow not found', async () => {
      mockWorkflowRepo.delete.mockResolvedValue(false);

      const res = await app.request('/browser/workflows/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('Workflow nonexistent not found');
    });

    it('returns 500 on repository error', async () => {
      mockWorkflowRepo.delete.mockRejectedValue(new Error('Delete failed'));

      const res = await app.request('/browser/workflows/bwf-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // Response format
  // =========================================================================

  describe('Response format', () => {
    it('success responses include meta.timestamp', async () => {
      mockWorkflowRepo.listByUser.mockResolvedValue({ workflows: [], total: 0 });

      const res = await app.request('/browser/workflows');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
      expect(new Date(json.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('error responses include meta.timestamp', async () => {
      mockWorkflowRepo.getById.mockResolvedValue(null);

      const res = await app.request('/browser/workflows/missing');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});
