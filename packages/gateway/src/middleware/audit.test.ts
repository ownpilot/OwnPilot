/**
 * Audit Middleware Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockLogAudit, mockHasServiceRegistry, mockGetServiceRegistry } = vi.hoisted(() => ({
  mockLogAudit: vi.fn(),
  mockHasServiceRegistry: vi.fn(),
  mockGetServiceRegistry: vi.fn(),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hasServiceRegistry: mockHasServiceRegistry,
    getServiceRegistry: mockGetServiceRegistry,
  };
});

import { auditMiddleware } from './audit.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp(userId?: string) {
  const app = new Hono();
  if (userId) {
    app.use('*', async (c, next) => {
      c.set('userId', userId);
      await next();
    });
  }
  app.use('*', auditMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/api/v1/health', (c) => c.json({ ok: true }));
  return app;
}

const savedEnv = process.env.TRUSTED_PROXY;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRUSTED_PROXY;

    // Default: registry IS available with audit service
    mockHasServiceRegistry.mockReturnValue(true);
    mockGetServiceRegistry.mockReturnValue({
      tryGet: vi.fn(() => ({ logAudit: mockLogAudit })),
    });
  });

  afterEach(() => {
    if (savedEnv !== undefined) process.env.TRUSTED_PROXY = savedEnv;
    else delete process.env.TRUSTED_PROXY;
  });

  it('calls audit.logAudit for a normal request', async () => {
    const app = createApp('user-1');
    await app.request('/test');
    expect(mockLogAudit).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'GET /test',
        resource: 'api',
        resourceId: '/test',
      })
    );
  });

  it('skips audit when ServiceRegistry is not initialized', async () => {
    mockHasServiceRegistry.mockReturnValue(false);
    const app = createApp();
    await app.request('/test');
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('skips audit when audit service is not registered', async () => {
    mockGetServiceRegistry.mockReturnValue({
      tryGet: vi.fn(() => null),
    });
    const app = createApp();
    await app.request('/test');
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('skips audit for /health path', async () => {
    const app = createApp();
    await app.request('/health');
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('skips audit for /api/v1/health path', async () => {
    const app = createApp();
    await app.request('/api/v1/health');
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('includes method, path, status, durationMs in details', async () => {
    const app = createApp();
    await app.request('/test');
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          method: 'GET',
          path: '/test',
          status: 200,
          durationMs: expect.any(Number),
        }),
      })
    );
  });

  it('uses "default" when no userId in context', async () => {
    const app = createApp(); // no userId middleware
    await app.request('/test');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'default' }));
  });

  it('uses ip="direct" when TRUSTED_PROXY is not set', async () => {
    const app = createApp('user-1');
    await app.request('/test');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ ip: 'direct' }));
  });

  it('uses x-forwarded-for header when TRUSTED_PROXY=true', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const app = createApp('user-1');
    await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ ip: '192.168.1.1' }));
  });

  it('uses x-real-ip when TRUSTED_PROXY=true and no x-forwarded-for', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const app = createApp();
    await app.request('/test', {
      headers: { 'x-real-ip': '10.0.0.5' },
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ ip: '10.0.0.5' }));
  });

  it('uses "unknown" when TRUSTED_PROXY=true but no IP headers', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const app = createApp();
    await app.request('/test');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ ip: 'unknown' }));
  });
});
