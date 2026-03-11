/**
 * Hono application setup
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import { VERSION } from '@ownpilot/core';
import type { GatewayConfig } from './types/index.js';
import {
  requestId,
  timing,
  createAuthMiddleware,
  createRateLimitMiddleware,
  errorHandler,
  notFoundHandler,
  auditMiddleware,
  uiSessionMiddleware,
} from './middleware/index.js';
import { registerPlatformRoutes } from './routes/register-platform-routes.js';
import { registerAgentRoutes } from './routes/register-agent-routes.js';
import { registerDataRoutes } from './routes/register-data-routes.js';
import { registerAutomationRoutes } from './routes/register-automation-routes.js';
import { registerIntegrationRoutes } from './routes/register-integration-routes.js';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_BURST,
  SECONDS_PER_DAY,
  HSTS_MAX_AGE_PRELOAD,
  HSTS_MAX_AGE,
  DEFAULT_BODY_LIMIT_BYTES,
  HTTP_PAYLOAD_TOO_LARGE,
  STATIC_ASSET_MAX_AGE,
} from './config/defaults.js';

// Resolve UI dist path relative to this file (works in both dev and Docker)
const __appDirname = dirname(fileURLToPath(import.meta.url));
const UI_DIST_PATH = resolve(__appDirname, '../../ui/dist');
const UI_AVAILABLE = existsSync(resolve(UI_DIST_PATH, 'index.html'));
const INDEX_HTML = UI_AVAILABLE ? readFileSync(resolve(UI_DIST_PATH, 'index.html'), 'utf-8') : '';

/**
 * Default configuration
 * NOTE: For self-hosted deployment, configure corsOrigins with your actual domain(s)
 */
const DEFAULT_CONFIG: GatewayConfig = {
  port: 8080,
  host: '127.0.0.1',
  // Default to localhost only. In production, set the CORS_ORIGINS env var
  // (comma-separated list of allowed origins, e.g. "https://my-domain.com,https://app.my-domain.com")
  corsOrigins: (() => {
    const uiPort = process.env.UI_PORT || '5173';
    return [
      `http://localhost:${uiPort}`,
      `http://127.0.0.1:${uiPort}`,
      ...(process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []),
    ];
  })(),
  rateLimit: {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
    burstLimit: RATE_LIMIT_BURST,
    softLimit: false, // Enforce rate limits
    excludePaths: ['/health', '/api/v1/health'],
  },
  auth: {
    type: 'api-key',
  },
};

/**
 * Create the Hono application
 */
export function createApp(config: Partial<GatewayConfig> = {}): Hono {
  const fullConfig: GatewayConfig = { ...DEFAULT_CONFIG, ...config };

  const app = new Hono();

  // Security headers (comprehensive protection against common attacks)
  app.use(
    '*',
    secureHeaders({
      // HSTS - force HTTPS. The `preload` directive opts into browser preload lists,
      // which is inappropriate for self-hosted instances where HTTPS may not be used.
      // Only add preload when HTTPS_ONLY=true is explicitly set.
      strictTransportSecurity:
        process.env.HTTPS_ONLY === 'true'
          ? `max-age=${HSTS_MAX_AGE_PRELOAD}; includeSubDomains; preload`
          : `max-age=${HSTS_MAX_AGE}; includeSubDomains`,
      // Prevent MIME type sniffing
      xContentTypeOptions: 'nosniff',
      // Prevent clickjacking - only allow same origin framing
      xFrameOptions: 'SAMEORIGIN',
      // XSS protection for legacy browsers
      xXssProtection: '1; mode=block',
      // Control referrer information - only send origin to cross-origin
      referrerPolicy: 'strict-origin-when-cross-origin',
      // Permissions Policy - restrict browser features
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
        usb: [],
        magnetometer: [],
        gyroscope: [],
      },
      // Content Security Policy for API (restrictive default)
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    })
  );

  // Relaxed CSP for API routes that serve no HTML content
  app.use('/api/*', async (c, next) => {
    // API endpoints don't serve HTML, so we use a very restrictive CSP
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    await next();
  });

  // Remove server fingerprinting headers
  app.use('*', async (c, next) => {
    await next();
    // Remove headers that reveal server information
    c.header('X-Powered-By', '');
    c.header('Server', '');
  });

  // Prevent caching of sensitive API responses
  app.use('/api/v1/*', async (c, next) => {
    await next();
    // Only add cache control if not already set
    if (!c.res.headers.get('Cache-Control')) {
      // Default: no cache for API responses
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
    }
  });

  // CORS - Never default to wildcard for security
  app.use(
    '*',
    cors({
      origin: fullConfig.corsOrigins ?? [],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Request-ID',
        'X-Session-Token',
      ],
      exposeHeaders: [
        'X-Request-ID',
        'X-Response-Time',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
      ],
      maxAge: SECONDS_PER_DAY,
      credentials: true,
    })
  );

  // Body size limit (configurable via BODY_SIZE_LIMIT env var, default 1 MB)
  const maxBodySize =
    parseInt(process.env.BODY_SIZE_LIMIT ?? String(DEFAULT_BODY_LIMIT_BYTES), 10) ||
    DEFAULT_BODY_LIMIT_BYTES;
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: maxBodySize,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Request body exceeds ${Math.round(maxBodySize / 1024 / 1024)} MB limit`,
            },
          },
          HTTP_PAYLOAD_TOO_LARGE
        ),
    })
  );

  // Request ID
  app.use('*', requestId);

  // Timing
  app.use('*', timing);

  // Logger (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    app.use('*', logger());
  }

  // Rate limiting
  if (fullConfig.rateLimit) {
    app.use('/api/*', createRateLimitMiddleware(fullConfig.rateLimit));
  }

  // ORDER MATTERS - Authentication middleware sequence:
  // 1. UI session (bypasses API auth for logged-in web UI users)
  // 2. API auth (api-key/jwt - skipped if session authenticated)
  // 3. Audit (logs all authenticated requests)
  // Do not reorder - session auth must come before API auth to enable bypass

  // UI session authentication (before API auth — valid session bypasses api-key/jwt)
  app.use('/api/v1/*', uiSessionMiddleware);

  // Authentication (skip health routes)
  if (fullConfig.auth && fullConfig.auth.type !== 'none') {
    app.use('/api/v1/*', createAuthMiddleware(fullConfig.auth));
  }

  // Audit logging (fire-and-forget, logs method/path/status/duration)
  app.use('/api/*', auditMiddleware);

  // Mount routes (grouped by domain — see register-*-routes.ts files)
  registerPlatformRoutes(app);
  registerAgentRoutes(app);
  registerDataRoutes(app);
  registerAutomationRoutes(app);
  registerIntegrationRoutes(app);

  // Root route (API-only mode, when UI is not bundled)
  if (!UI_AVAILABLE) {
    app.get('/', (c) => {
      return c.json({
        name: 'OwnPilot',
        version: VERSION,
        documentation: '/api/v1',
      });
    });
  }

  // API info
  app.get('/api/v1', (c) => {
    return c.json({
      version: 'v1',
      endpoints: {
        health: '/health',
        auth: '/api/v1/auth',
        agents: '/api/v1/agents',
        chat: '/api/v1/chat',
        tools: '/api/v1/tools',
        settings: '/api/v1/settings',
        channels: '/api/v1/channels',
        channelAuth: '/api/v1/channels/auth',
        costs: '/api/v1/costs',
        models: '/api/v1/models',
        providers: '/api/v1/providers',
        profile: '/api/v1/profile',
        // Personal data
        tasks: '/api/v1/tasks',
        bookmarks: '/api/v1/bookmarks',
        notes: '/api/v1/notes',
        calendar: '/api/v1/calendar',
        contacts: '/api/v1/contacts',
        summary: '/api/v1/summary',
        // Custom data (dynamic schemas)
        customData: '/api/v1/custom-data',
        // Persistent AI memory
        memories: '/api/v1/memories',
        // Goals (long-term objectives)
        goals: '/api/v1/goals',
        // Triggers (proactive automation)
        triggers: '/api/v1/triggers',
        // Plans (autonomous execution)
        plans: '/api/v1/plans',
        // Autonomy (risk assessment, approvals)
        autonomy: '/api/v1/autonomy',
        // Debug info (AI request/response logs)
        debug: '/api/v1/debug',
        // Workspaces (isolated user sandboxes)
        workspaces: '/api/v1/workspaces',
        // File Workspaces (session-based file storage)
        fileWorkspaces: '/api/v1/file-workspaces',
        // Plugins (extensible plugin system)
        plugins: '/api/v1/plugins',
        // Productivity (Pomodoro, Habits, Captures)
        pomodoro: '/api/v1/pomodoro',
        habits: '/api/v1/habits',
        captures: '/api/v1/captures',
        // AI Model Configs (model management)
        modelConfigs: '/api/v1/model-configs',
        // Dashboard (AI-powered daily briefing)
        dashboard: '/api/v1/dashboard',
        // Custom Tools (LLM-created and user-defined tools)
        customTools: '/api/v1/custom-tools',
        // Config Center (centralized config management)
        configServices: '/api/v1/config-services',
        // Heartbeats (NL-to-cron periodic tasks)
        heartbeats: '/api/v1/heartbeats',
        // User Extensions (shareable tool bundles)
        extensions: '/api/v1/extensions',
        // Local AI Providers (LM Studio, Ollama)
        localProviders: '/api/v1/local-providers',
        // Workflows (visual DAG tool pipelines)
        workflows: '/api/v1/workflows',
        // Composio (OAuth app integrations)
        composio: '/api/v1/composio',
        // Coding Agents (CLI orchestration)
        codingAgents: '/api/v1/coding-agents',
        cliProviders: '/api/v1/cli-providers',
        // CLI Tools (discovery, policies, installation)
        cliTools: '/api/v1/cli-tools',
        // CLI Chat (use CLI subscriptions as chat providers)
        cliChat: '/api/v1/cli-chat',
        // Security Scanner (unified vulnerability analysis)
        security: '/api/v1/security',
        // Background Agents (persistent autonomous agents)
        backgroundAgents: '/api/v1/background-agents',
        subagents: '/api/v1/subagents',
        // Agent Orchestra (multi-agent collaboration)
        orchestra: '/api/v1/orchestra',
        // Artifacts (AI-generated interactive content)
        artifacts: '/api/v1/artifacts',
        voice: '/api/v1/voice',
        // Browser (headless browser automation)
        browser: '/api/v1/browser',
        // Skills (npm discovery, install, permissions)
        skills: '/api/v1/skills',
        // Edge devices (IoT/MQTT delegation)
        edge: '/api/v1/edge',
        // Webhooks (external service callbacks, no auth required)
        webhooks: '/webhooks/telegram/:secret',
      },
    });
  });

  // Serve bundled UI static files (SPA)
  if (UI_AVAILABLE) {
    // Vite hashed assets — immutable, 1-year cache
    app.use(
      '/assets/*',
      serveStatic({
        root: UI_DIST_PATH,
        onFound: (_path, c) => {
          c.header('Cache-Control', `public, immutable, max-age=${STATIC_ASSET_MAX_AGE}`);
        },
      })
    );

    // Other static files (favicon, logos) — falls through on miss
    app.use('*', serveStatic({ root: UI_DIST_PATH }));

    // SPA fallback — serve index.html for non-API GET requests
    app.get('*', (c) => {
      const path = c.req.path;
      if (
        path.startsWith('/api/') ||
        path.startsWith('/health') ||
        path.startsWith('/webhooks/') ||
        path.startsWith('/ws') ||
        path.startsWith('/mcp')
      ) {
        return c.notFound();
      }
      return c.html(INDEX_HTML);
    });
  }

  // Error handling
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

/**
 * Export types for Hono context
 */
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    startTime: number;
    userId?: string;
    jwtPayload?: Record<string, unknown>;
    sessionAuthenticated?: boolean;
    pagination?: import('./middleware/pagination.js').PaginationParams;
  }
}
