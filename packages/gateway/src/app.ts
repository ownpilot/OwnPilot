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
import {
  healthRoutes,
  agentRoutes,
  chatRoutes,
  toolsRoutes,
  settingsRoutes,
  channelRoutes,
  costRoutes,
  modelsRoutes,
  providersRoutes,
  profileRoutes,
  personalDataRoutes,
  customDataRoutes,
  memoriesRoutes,
  goalsRoutes,
  triggersRoutes,
  plansRoutes,
  autonomyRoutes,
  auditRoutes,
  workspaceRoutes,
  fileWorkspaceRoutes,
  pluginsRoutes,
  productivityRoutes,
  modelConfigsRoutes,
  dashboardRoutes,
  customToolsRoutes,
  databaseRoutes,
  expensesRoutes,
  configServicesRoutes,
  localProvidersRoutes,
  channelAuthRoutes,
  debugRoutes,
  executionPermissionsRoutes,
  heartbeatsRoutes,
  extensionsRoutes,
  mcpRoutes,
  webhookRoutes,
  workflowRoutes,
  composioRoutes,
  uiAuthRoutes,
  modelRoutingRoutes,
  codingAgentsRoutes,
  cliProvidersRoutes,
} from './routes/index.js';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_BURST,
  SECONDS_PER_DAY,
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

  // Security headers (includes HSTS for HTTPS deployments)
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    })
  );

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
  const maxBodySize = parseInt(process.env.BODY_SIZE_LIMIT ?? '1048576', 10) || 1048576;
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
          413
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

  // UI session authentication (before API auth — valid session bypasses api-key/jwt)
  app.use('/api/v1/*', uiSessionMiddleware);

  // Authentication (skip health routes)
  if (fullConfig.auth && fullConfig.auth.type !== 'none') {
    app.use('/api/v1/*', createAuthMiddleware(fullConfig.auth));
  }

  // Audit logging (fire-and-forget, logs method/path/status/duration)
  app.use('/api/*', auditMiddleware);

  // Mount routes

  // Webhooks - mounted outside /api/v1 since external services (e.g. Telegram) cannot send API keys.
  // Secret path segment provides authentication.
  app.route('/webhooks', webhookRoutes);

  app.route('/health', healthRoutes);
  app.route('/api/v1/auth', uiAuthRoutes);
  app.route('/api/v1/health', healthRoutes); // Also mount at /api/v1 for API consistency
  app.route('/api/v1/agents', agentRoutes);
  app.route('/api/v1/chat', chatRoutes);
  app.route('/api/v1/tools', toolsRoutes);
  app.route('/api/v1/settings', settingsRoutes);
  app.route('/api/v1/channels', channelRoutes);
  app.route('/api/v1/channels/auth', channelAuthRoutes);
  app.route('/api/v1/costs', costRoutes);
  app.route('/api/v1/models', modelsRoutes);
  app.route('/api/v1/providers', providersRoutes);
  app.route('/api/v1/profile', profileRoutes);

  // Personal data routes (tasks, bookmarks, notes, calendar, contacts)
  app.route('/api/v1', personalDataRoutes);

  // Custom data routes (dynamic tables with AI-decided schemas)
  app.route('/api/v1/custom-data', customDataRoutes);

  // Memory routes (persistent AI memory)
  app.route('/api/v1/memories', memoriesRoutes);

  // Goals routes (long-term objectives tracking)
  app.route('/api/v1/goals', goalsRoutes);

  // Triggers routes (proactive automation)
  app.route('/api/v1/triggers', triggersRoutes);

  // Plans routes (autonomous plan execution)
  app.route('/api/v1/plans', plansRoutes);

  // Autonomy routes (risk assessment, approvals)
  app.route('/api/v1/autonomy', autonomyRoutes);

  // Audit logs (tool executions, agent activities, errors)
  app.route('/api/v1/audit', auditRoutes);

  // Debug info (AI request/response logs, tool calls)
  app.route('/api/v1/debug', debugRoutes);

  // Workspaces (isolated user sandboxes)
  app.route('/api/v1/workspaces', workspaceRoutes);

  // File Workspaces (session-based file storage)
  app.route('/api/v1/file-workspaces', fileWorkspaceRoutes);

  // Plugins (extensible plugin system)
  app.route('/api/v1/plugins', pluginsRoutes);

  // Productivity (Pomodoro, Habits, Captures)
  app.route('/api/v1', productivityRoutes);

  // AI Model Configs (model management, custom providers)
  app.route('/api/v1/model-configs', modelConfigsRoutes);
  app.route('/api/v1/model-routing', modelRoutingRoutes);

  // Dashboard (AI-powered daily briefing)
  app.route('/api/v1/dashboard', dashboardRoutes);

  // Custom Tools (LLM-created and user-defined tools)
  app.route('/api/v1/custom-tools', customToolsRoutes);

  // Database Admin (migration, status)
  app.route('/api/v1/database', databaseRoutes);

  // Expenses
  app.route('/api/v1/expenses', expensesRoutes);

  // Config Center (centralized config management)
  app.route('/api/v1/config-services', configServicesRoutes);

  // Execution Permissions (granular code execution security)
  app.route('/api/v1/execution-permissions', executionPermissionsRoutes);

  // Heartbeats (NL-to-cron periodic tasks)
  app.route('/api/v1/heartbeats', heartbeatsRoutes);

  // User Extensions (shareable tool + prompt + trigger bundles)
  app.route('/api/v1/extensions', extensionsRoutes);

  // MCP (Model Context Protocol — external server connections + tool exposure)
  app.route('/api/v1/mcp', mcpRoutes);

  // Local AI Providers (LM Studio, Ollama, etc.)
  app.route('/api/v1/local-providers', localProvidersRoutes);

  // Workflows (visual DAG tool pipelines)
  app.route('/api/v1/workflows', workflowRoutes);

  // Composio (OAuth app integrations — Gmail, GitHub, Slack, etc.)
  app.route('/api/v1/composio', composioRoutes);

  // Coding Agents (external AI coding CLI orchestration)
  app.route('/api/v1/coding-agents', codingAgentsRoutes);

  // CLI Providers (custom coding agent provider registry)
  app.route('/api/v1/cli-providers', cliProvidersRoutes);

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
          c.header('Cache-Control', 'public, immutable, max-age=31536000');
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
