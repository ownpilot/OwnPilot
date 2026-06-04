/**
 * Extensions Scanner Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockScanDirectory, mockGetServiceRegistry, mockGetExtensionService } = vi.hoisted(() => ({
  mockScanDirectory: vi.fn(),
  mockGetServiceRegistry: vi.fn(),
  mockGetExtensionService: vi.fn(),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: mockGetServiceRegistry,
    getExtensionService: mockGetExtensionService,
  };
});

const { scannerRoutes } = await import('./scanner.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'default');
    await next();
  });
  app.route('/extensions', scannerRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions Scanner Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    const fakeExtService = { scanDirectory: mockScanDirectory };
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn(() => fakeExtService),
    });
    mockGetExtensionService.mockReturnValue(fakeExtService);
  });

  describe('POST /extensions/scan', () => {
    it('scans directory and returns result', async () => {
      const scanResult = {
        found: 3,
        packages: [
          { name: 'pkg-1', path: '/tmp/pkg-1' },
          { name: 'pkg-2', path: '/tmp/pkg-2' },
        ],
      };
      mockScanDirectory.mockResolvedValueOnce(scanResult);

      const res = await app.request('/extensions/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/tmp/packages' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(scanResult);
      expect(mockScanDirectory).toHaveBeenCalledWith('/tmp/packages', 'default');
    });

    it('scans without directory (uses default)', async () => {
      mockScanDirectory.mockResolvedValueOnce({ found: 0, packages: [] });

      const res = await app.request('/extensions/scan', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(mockScanDirectory).toHaveBeenCalledWith(undefined, 'default');
    });

    it('returns 500 when scan fails', async () => {
      mockScanDirectory.mockRejectedValueOnce(new Error('Permission denied'));

      const res = await app.request('/extensions/scan', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Permission denied');
    });

    it('returns 500 when extension service accessor throws', async () => {
      mockGetExtensionService.mockImplementationOnce(() => {
        throw new Error('ExtensionService not initialized');
      });

      const res = await app.request('/extensions/scan', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
