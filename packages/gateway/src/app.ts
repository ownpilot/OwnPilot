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

import { VERSION } from '@ownpilot/core/version';
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
import { registerPlatformRoutes } from './routes/register/platform.js';
import { registerAgentRoutes } from './routes/register/agent.js';
import { registerDataRoutes } from './routes/register/data.js';
import { registerAutomationRoutes } from './routes/register/automation.js';
import { registerIntegrationRoutes } from './routes/register/integration.js';
import { registerOpenApiRoutes } from './routes/openapi.js';
import { registerV2Routes } from './routes/register/v2.js';
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

// Re-export so existing callers (server.ts) keep working; the
// implementation lives in utils/cors-origin.ts to avoid the
// app.ts ↔ ws/server.ts circular dependency that wsGateway already
// creates from the other direction.
export { sanitizeCorsOriginsFromEnv } from './utils/cors-origin.js';
import { sanitizeCorsOriginsFromEnv as _sanitizeCorsOriginsFromEnv } from './utils/cors-origin.js';

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
  // (comma-separated list of allowed origins, e.g. "https://my-domain.com,https://app.my-domain.com").
  // The filter logic lives in sanitizeCorsOriginsFromEnv() below so it
  // also applies to the loadConfig() path in server.ts, which previously
  // bypassed the wildcard/scheme filter when CORS_ORIGINS was set.
  corsOrigins: (() => {
    const uiPort = process.env.UI_PORT || '8199';
    return [
      `http://localhost:${uiPort}`,
      `http://127.0.0.1:${uiPort}`,
      ..._sanitizeCorsOriginsFromEnv(process.env.CORS_ORIGINS),
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
      // Content Security Policy for everything served by the gateway
      // (including the React SPA bundle). API routes are tightened
      // further below.
      // connect-src includes ws/wss so the SPA can open its WebSocket
      // session against same-origin (`new WebSocket(...)` in
      // useWebSocket.tsx). frame-ancestors blocks clickjacking; meta-tag
      // CSP cannot set this so it must live on the HTTP header.
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
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

  // HTTP→HTTPS redirect (HTTPS-001). When HTTPS_ONLY=true, any plain-HTTP
  // request is redirected to its HTTPS equivalent with a 301. Respects
  // X-Forwarded-Proto for reverse-proxy deployments that terminate TLS
  // upstream and forward to the gateway over plain HTTP. When the proxy
  // sends X-Forwarded-Proto: https, no redirect happens.
  //
  // Must run after the security-headers middleware (which sets HSTS) so
  // the HSTS header is present on the redirect response. The same env var
  // (HTTPS_ONLY) controls both — they're always paired.
  if (process.env.HTTPS_ONLY === 'true') {
    app.use('*', async (c, next) => {
      const fwdProto = c.req.header('X-Forwarded-Proto') ?? c.req.header('X-Forwarded-Scheme');
      if (fwdProto === 'https') return next();

      const url = new URL(c.req.url);
      if (url.protocol === 'http:') {
        url.protocol = 'https:';
        const httpsPort = process.env.HTTPS_PORT ?? process.env.PORT ?? '443';
        if (httpsPort !== '443') url.port = httpsPort;
        else url.port = '';
        return c.redirect(url.toString(), 301);
      }
      return next();
    });
  }

  // Remove server fingerprinting headers
  app.use('*', async (c, next) => {
    await next();
    // Remove headers that reveal server information
    c.header('X-Powered-By', '');
    c.header('Server', '');
  });

  // Prevent caching of sensitive API responses (all API versions)
  app.use('/api/*', async (c, next) => {
    await next();
    // Only add cache control if not already set
    if (!c.res.headers.get('Cache-Control')) {
      // Default: no cache for API responses
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
    }
  });

  // CORS - Scoped to API routes only. Webhooks use HMAC auth, not CORS.
  // Never default to wildcard for security.
  app.use(
    '/api/*',
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
      exposeHeaders: ['X-Request-ID', 'X-Response-Time'],
      maxAge: SECONDS_PER_DAY,
      credentials: true,
    })
  );

  // Body size limit (configurable via BODY_SIZE_LIMIT env var, default 1 MB).
  // Applies to BOTH /api/* and /webhooks/* — webhook signature checks happen
  // after body parsing, so an unbounded webhook body is a pre-auth DoS vector.
  const maxBodySize =
    parseInt(process.env.BODY_SIZE_LIMIT ?? String(DEFAULT_BODY_LIMIT_BYTES), 10) ||
    DEFAULT_BODY_LIMIT_BYTES;
  const bodyLimiter = bodyLimit({
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
  });
  app.use('/api/*', bodyLimiter);
  app.use('/webhooks/*', bodyLimiter);

  // Request ID
  app.use('*', requestId);

  // Timing
  app.use('*', timing);

  // Logger (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    app.use('*', logger());
  }

  // Rate limiting — webhooks too (brute-force / abuse protection on external endpoints)
  if (fullConfig.rateLimit) {
    app.use('/api/*', createRateLimitMiddleware(fullConfig.rateLimit));
    app.use('/webhooks/*', createRateLimitMiddleware(fullConfig.rateLimit));
  }

  // ORDER MATTERS - Authentication middleware sequence:
  // 1. UI session (bypasses API auth for logged-in web UI users)
  // 2. API auth (api-key/jwt - skipped if session authenticated)
  // 3. Audit (logs all authenticated requests)
  // Do not reorder - session auth must come before API auth to enable bypass

  // UI session authentication (before API auth — valid session bypasses api-key/jwt)
  // Scoped to ALL versioned API paths (/api/*), not just /api/v1/*, so the v2
  // mirror (registerV2Routes) is covered too. The unprefixed /health route is
  // not under /api/* and stays public for container health checks.
  app.use('/api/*', uiSessionMiddleware);

  // Authentication (skip health routes)
  if (fullConfig.auth && fullConfig.auth.type !== 'none') {
    app.use('/api/*', createAuthMiddleware(fullConfig.auth));
  }

  // Audit logging (fire-and-forget, logs method/path/status/duration)
  app.use('/api/*', auditMiddleware);

  // Mount routes via registry — programmatically inspectable, harder to typo
  const routeRegistry = [
    { register: registerPlatformRoutes },
    { register: registerAgentRoutes },
    { register: registerDataRoutes },
    { register: registerAutomationRoutes },
    { register: registerIntegrationRoutes },
  ] as const;

  for (const { register } of routeRegistry) {
    register(app);
  }

  // v2 API (side-by-side with v1 — same handlers, new routes for future breaking changes)
  registerV2Routes(app);

  // OpenAPI spec + Swagger UI (must register after all routes are mounted so
  // the generator's app.routes walk picks everything up — Hono fires handlers
  // lazily, so registration order here is fine).
  registerOpenApiRoutes(app);

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
      documentation: '/openapi.json',
      explorer: '/docs',
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
        // Agent Command Center (unified overview of all agents)
        agentsOverview: '/api/v1/agent-command/overview',
        // Claws (unified autonomous agent runtime)
        claws: '/api/v1/claws',
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

  // v2 API info (side-by-side with v1 — same endpoints at /api/v2/*)
  app.get('/api/v2', (c) => {
    return c.json({
      version: 'v2',
      status: 'active',
      documentation: '/openapi.json',
      explorer: '/docs',
      note: 'v2 mounts the same routes as v1 and is reserved for breaking changes. v1 remains the primary, supported API; no end-of-life is planned.',
      endpoints: {
        health: '/health',
        auth: '/api/v2/auth',
        agents: '/api/v2/agents',
        chat: '/api/v2/chat',
        tools: '/api/v2/tools',
        settings: '/api/v2/settings',
        channels: '/api/v2/channels',
        channelAuth: '/api/v2/channels/auth',
        costs: '/api/v2/costs',
        models: '/api/v2/models',
        providers: '/api/v2/providers',
        profile: '/api/v2/profile',
        tasks: '/api/v2/tasks',
        bookmarks: '/api/v2/bookmarks',
        notes: '/api/v2/notes',
        calendar: '/api/v2/calendar',
        contacts: '/api/v2/contacts',
        summary: '/api/v2/summary',
        customData: '/api/v2/custom-data',
        memories: '/api/v2/memories',
        goals: '/api/v2/goals',
        triggers: '/api/v2/triggers',
        plans: '/api/v2/plans',
        autonomy: '/api/v2/autonomy',
        debug: '/api/v2/debug',
        workspaces: '/api/v2/workspaces',
        fileWorkspaces: '/api/v2/file-workspaces',
        plugins: '/api/v2/plugins',
        pomodoro: '/api/v2/pomodoro',
        habits: '/api/v2/habits',
        captures: '/api/v2/captures',
        modelConfigs: '/api/v2/model-configs',
        dashboard: '/api/v2/dashboard',
        customTools: '/api/v2/custom-tools',
        configServices: '/api/v2/config-services',
        heartbeats: '/api/v2/heartbeats',
        extensions: '/api/v2/extensions',
        localProviders: '/api/v2/local-providers',
        workflows: '/api/v2/workflows',
        composio: '/api/v2/composio',
        codingAgents: '/api/v2/coding-agents',
        cliProviders: '/api/v2/cli-providers',
        cliTools: '/api/v2/cli-tools',
        cliChat: '/api/v2/cli-chat',
        security: '/api/v2/security',
        claws: '/api/v2/claws',
        artifacts: '/api/v2/artifacts',
        voice: '/api/v2/voice',
        browser: '/api/v2/browser',
        skills: '/api/v2/skills',
        edge: '/api/v2/edge',
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
      // Never serve HTML for a missing static asset — that produces a MIME
      // mismatch in the browser. A miss here means a stale/renamed hashed file
      // (e.g. after a UI rebuild); return a clean 404 instead.
      if (path.startsWith('/assets/')) {
        return c.notFound();
      }
      // Read index.html fresh so UI rebuilds are picked up without a gateway
      // restart; fall back to the boot-time copy if the read fails. Served
      // no-cache so browsers always revalidate and pick up new asset hashes.
      let html = INDEX_HTML;
      try {
        html = readFileSync(resolve(UI_DIST_PATH, 'index.html'), 'utf-8');
      } catch {
        // keep boot-time copy
      }
      c.header('Cache-Control', 'no-cache, must-revalidate');
      return c.html(html);
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
