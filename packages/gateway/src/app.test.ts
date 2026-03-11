/**
 * App Tests
 *
 * Tests the Hono application setup including middleware chain,
 * route mounting, security headers, and configuration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock middleware modules
const mockRequestId = vi.fn().mockImplementation((c, next) => next());
const mockTiming = vi.fn().mockImplementation((c, next) => next());
const mockCreateAuthMiddleware = vi.fn().mockImplementation(() => (c, next) => next());
const mockCreateRateLimitMiddleware = vi.fn().mockImplementation(() => (c, next) => next());
const mockErrorHandler = vi.fn().mockImplementation((err, c) => c.json({ error: 'test' }, 500));
const mockNotFoundHandler = vi.fn().mockImplementation((c) => c.json({ error: 'Not found' }, 404));
const mockAuditMiddleware = vi.fn().mockImplementation((c, next) => next());
const mockUiSessionMiddleware = vi.fn().mockImplementation((c, next) => next());

vi.mock('./middleware/index.js', () => ({
  requestId: mockRequestId,
  timing: mockTiming,
  createAuthMiddleware: mockCreateAuthMiddleware,
  createRateLimitMiddleware: mockCreateRateLimitMiddleware,
  errorHandler: mockErrorHandler,
  notFoundHandler: mockNotFoundHandler,
  auditMiddleware: mockAuditMiddleware,
  uiSessionMiddleware: mockUiSessionMiddleware,
}));

// Mock route modules - use a factory pattern for proper hoisting
const createMockRoutes = () => {
  const { Hono } = require('hono');
  const app = new Hono();
  app.get('/', (c) => c.json({ ok: true }));
  return app;
};

vi.mock('./routes/index.js', () => ({
  healthRoutes: createMockRoutes(),
  agentRoutes: createMockRoutes(),
  chatRoutes: createMockRoutes(),
  toolsRoutes: createMockRoutes(),
  settingsRoutes: createMockRoutes(),
  channelRoutes: createMockRoutes(),
  costRoutes: createMockRoutes(),
  modelsRoutes: createMockRoutes(),
  providersRoutes: createMockRoutes(),
  profileRoutes: createMockRoutes(),
  personalDataRoutes: createMockRoutes(),
  customDataRoutes: createMockRoutes(),
  memoriesRoutes: createMockRoutes(),
  goalsRoutes: createMockRoutes(),
  triggersRoutes: createMockRoutes(),
  plansRoutes: createMockRoutes(),
  autonomyRoutes: createMockRoutes(),
  auditRoutes: createMockRoutes(),
  workspaceRoutes: createMockRoutes(),
  fileWorkspaceRoutes: createMockRoutes(),
  pluginsRoutes: createMockRoutes(),
  productivityRoutes: createMockRoutes(),
  modelConfigsRoutes: createMockRoutes(),
  dashboardRoutes: createMockRoutes(),
  customToolsRoutes: createMockRoutes(),
  databaseRoutes: createMockRoutes(),
  expensesRoutes: createMockRoutes(),
  configServicesRoutes: createMockRoutes(),
  localProvidersRoutes: createMockRoutes(),
  channelAuthRoutes: createMockRoutes(),
  debugRoutes: createMockRoutes(),
  executionPermissionsRoutes: createMockRoutes(),
  heartbeatsRoutes: createMockRoutes(),
  extensionsRoutes: createMockRoutes(),
  mcpRoutes: createMockRoutes(),
  webhookRoutes: createMockRoutes(),
  workflowRoutes: createMockRoutes(),
  composioRoutes: createMockRoutes(),
  uiAuthRoutes: createMockRoutes(),
  modelRoutingRoutes: createMockRoutes(),
  codingAgentsRoutes: createMockRoutes(),
  cliProvidersRoutes: createMockRoutes(),
  cliToolsRoutes: createMockRoutes(),
  cliChatRoutes: createMockRoutes(),
  securityRoutes: createMockRoutes(),
  backgroundAgentsRoutes: createMockRoutes(),
  subagentRoutes: createMockRoutes(),
  bridgeRoutes: createMockRoutes(),
  orchestraRoutes: createMockRoutes(),
  artifactsRoutes: createMockRoutes(),
  voiceRoutes: createMockRoutes(),
  browserRoutes: createMockRoutes(),
  skillsRoutes: createMockRoutes(),
  edgeRoutes: createMockRoutes(),
  soulRoutes: createMockRoutes(),
  crewRoutes: createMockRoutes(),
  agentMessageRoutes: createMockRoutes(),
  heartbeatLogRoutes: createMockRoutes(),
  agentCommandCenterRoutes: createMockRoutes(),
}));

// Mock defaults
vi.mock('./config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 100,
    RATE_LIMIT_BURST: 10,
    SECONDS_PER_DAY: 86400,
  };
});

// Mock core VERSION
vi.mock('@ownpilot/core', () => ({
  VERSION: '1.0.0-test',
}));

// Import after mocks
const { createApp } = await import('./app.js');

describe('createApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
    delete process.env.UI_PORT;
    delete process.env.CORS_ORIGINS;
    delete process.env.HTTPS_ONLY;
    delete process.env.BODY_SIZE_LIMIT;
  });

  describe('basic setup', () => {
    it('returns a Hono app instance', () => {
      const app = createApp();
      expect(app).toBeDefined();
      expect(typeof app.request).toBe('function');
    });

    it('uses default configuration', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
    });

    it('merges custom config with defaults', async () => {
      const customConfig = {
        port: 3000,
        host: '0.0.0.0',
      };
      const app = createApp(customConfig);
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
    });
  });

  describe('security headers middleware', () => {
    it('applies X-Content-Type-Options header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('applies X-Frame-Options header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('applies X-XSS-Protection header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('removes X-Powered-By header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      // Header is either null or empty string when removed
      const header = res.headers.get('X-Powered-By');
      expect(header === null || header === '').toBe(true);
    });

    it('removes Server header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      // Header is either null or empty string when removed
      const header = res.headers.get('Server');
      expect(header === null || header === '').toBe(true);
    });

    it('applies CSP header to API routes', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      const csp = res.headers.get('Content-Security-Policy');
      // CSP is applied (either general or API-specific)
      expect(csp).toBeTruthy();
      expect(csp).toContain('default-src');
    });

    it('applies HSTS with preload when HTTPS_ONLY=true', async () => {
      process.env.HTTPS_ONLY = 'true';
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      const hsts = res.headers.get('Strict-Transport-Security');
      expect(hsts).toContain('preload');
    });

    it('applies HSTS without preload by default', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      const hsts = res.headers.get('Strict-Transport-Security');
      expect(hsts).not.toContain('preload');
    });
  });

  describe('cache control headers', () => {
    it('adds no-cache headers to API responses by default', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      const cacheControl = res.headers.get('Cache-Control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('no-cache');
      expect(cacheControl).toContain('must-revalidate');
    });

    it('adds Pragma header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.headers.get('Pragma')).toBe('no-cache');
    });

    it('adds Expires header', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.headers.get('Expires')).toBe('0');
    });
  });

  describe('body size limit', () => {
    it('uses default body size limit (1MB)', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
    });

    it('respects BODY_SIZE_LIMIT env var', async () => {
      process.env.BODY_SIZE_LIMIT = '2097152'; // 2MB
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
    });
  });

  describe('middleware factory calls', () => {
    it('calls createRateLimitMiddleware when rateLimit config provided', () => {
      vi.clearAllMocks();
      createApp({ rateLimit: { windowMs: 60000, maxRequests: 100 } });
      expect(mockCreateRateLimitMiddleware).toHaveBeenCalled();
    });

    it('calls createAuthMiddleware when auth type is not none', () => {
      vi.clearAllMocks();
      createApp({ auth: { type: 'api-key' } });
      expect(mockCreateAuthMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'api-key' })
      );
    });

    it('does not call createAuthMiddleware when auth type is none', () => {
      vi.clearAllMocks();
      createApp({ auth: { type: 'none' } });
      expect(mockCreateAuthMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('route mounting', () => {
    it('mounts health routes at /health', async () => {
      const app = createApp();
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts health routes at /api/v1/health', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts webhook routes at /webhooks', async () => {
      const app = createApp();
      const res = await app.request('/webhooks');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts auth routes at /api/v1/auth', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/auth');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts agents routes at /api/v1/agents', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts chat routes at /api/v1/chat', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/chat');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts tools routes at /api/v1/tools', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/tools');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts channels routes at /api/v1/channels', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/channels');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts memories routes at /api/v1/memories', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/memories');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts goals routes at /api/v1/goals', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/goals');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts triggers routes at /api/v1/triggers', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/triggers');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('mounts plans routes at /api/v1/plans', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/plans');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });

  describe('error handling', () => {
    it('registers error handler', () => {
      const app = createApp();
      expect(app.errorHandler).toBeDefined();
    });

    it('registers not found handler', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/non-existent-route-12345');
      expect(res).toBeDefined();
    });
  });

  describe('Hono context type extensions', () => {
    it('app accepts requests with extended context', async () => {
      const app = createApp();
      const res = await app.request('/api/v1/agents', {
        headers: {
          'X-Request-ID': 'test-request-id',
        },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('complex configuration scenarios', () => {
    it('handles production-like config with all features enabled', () => {
      const config = {
        port: 8080,
        host: '0.0.0.0',
        corsOrigins: ['https://app.example.com'],
        rateLimit: {
          windowMs: 60000,
          maxRequests: 1000,
          burstLimit: 50,
          softLimit: false,
          excludePaths: ['/health'],
        },
        auth: {
          type: 'jwt' as const,
          jwtSecret: 'test-secret',
        },
      };
      const app = createApp(config);
      expect(app).toBeDefined();
    });

    it('handles minimal config with auth disabled', () => {
      const config = {
        auth: {
          type: 'none' as const,
        },
        rateLimit: undefined,
      };
      const app = createApp(config);
      expect(app).toBeDefined();
    });

    it('handles empty corsOrigins array', async () => {
      const app = createApp({ corsOrigins: [] });
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);
    });
  });
});
