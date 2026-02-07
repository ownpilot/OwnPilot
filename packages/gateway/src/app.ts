/**
 * Hono application setup
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import type { GatewayConfig } from './types/index.js';
import {
  requestId,
  timing,
  createAuthMiddleware,
  createRateLimitMiddleware,
  errorHandler,
  notFoundHandler,
  auditMiddleware,
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
  authRoutes,
  integrationsRoutes,

  modelConfigsRoutes,
  dashboardRoutes,
  customToolsRoutes,
  databaseRoutes,
  expensesRoutes,
  configServicesRoutes,
  localProvidersRoutes,
  channelAuthRoutes,
  debugRoutes,
} from './routes/index.js';

/**
 * Default configuration
 * NOTE: For self-hosted deployment, configure corsOrigins with your actual domain(s)
 */
const DEFAULT_CONFIG: GatewayConfig = {
  port: 8080,
  host: '0.0.0.0',
  // Default to localhost only. In production, set the CORS_ORIGINS env var
  // (comma-separated list of allowed origins, e.g. "https://my-domain.com,https://app.my-domain.com")
  corsOrigins: (() => {
    const uiPort = process.env.UI_PORT || '5173';
    return [
      `http://localhost:${uiPort}`,
      `http://127.0.0.1:${uiPort}`,
      ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : []),
    ];
  })(),
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 500, // More relaxed for self-hosted
    burstLimit: 750, // Allow 50% burst
    softLimit: false, // Enforce rate limits
    excludePaths: ['/health', '/api/v1/health', '/api/v1/chat/stream'],
  },
  auth: {
    type: 'none',
  },
};

/**
 * Create the Hono application
 */
export function createApp(config: Partial<GatewayConfig> = {}): Hono {
  const fullConfig: GatewayConfig = { ...DEFAULT_CONFIG, ...config };

  const app = new Hono();

  // Security headers
  app.use('*', secureHeaders());

  // CORS - Never default to wildcard for security
  app.use(
    '*',
    cors({
      origin: fullConfig.corsOrigins ?? [],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
      exposeHeaders: ['X-Request-ID', 'X-Response-Time', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
      maxAge: 86400,
      credentials: true,
    })
  );

  // Body size limit (configurable via BODY_SIZE_LIMIT env var, default 1 MB)
  const maxBodySize = parseInt(process.env.BODY_SIZE_LIMIT ?? '1048576', 10);
  app.use('/api/*', bodyLimit({
    maxSize: maxBodySize,
    onError: (c) => c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${Math.round(maxBodySize / 1024 / 1024)} MB limit` } }, 413),
  }));

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

  // Authentication (skip health routes)
  if (fullConfig.auth && fullConfig.auth.type !== 'none') {
    app.use('/api/v1/*', createAuthMiddleware(fullConfig.auth));
  }

  // Audit logging (fire-and-forget, logs method/path/status/duration)
  app.use('/api/*', auditMiddleware);

  // Mount routes
  app.route('/health', healthRoutes);
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

  // OAuth Authentication (Google, Microsoft)
  app.route('/api/v1/auth', authRoutes);

  // Integrations (Gmail, Calendar, Drive)
  app.route('/api/v1/integrations', integrationsRoutes);


  // AI Model Configs (model management, custom providers)
  app.route('/api/v1/model-configs', modelConfigsRoutes);

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

  // Local AI Providers (LM Studio, Ollama, etc.)
  app.route('/api/v1/local-providers', localProvidersRoutes);

  // Root route
  app.get('/', (c) => {
    return c.json({
      name: 'OwnPilot',
      version: '0.1.0',
      documentation: '/api/v1',
    });
  });

  // API info
  app.get('/api/v1', (c) => {
    return c.json({
      version: 'v1',
      endpoints: {
        health: '/health',
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
        // OAuth Authentication
        auth: '/api/v1/auth',
        // Integrations (Gmail, Calendar, Drive)
        integrations: '/api/v1/integrations',

        // AI Model Configs (model management)
        modelConfigs: '/api/v1/model-configs',
        // Dashboard (AI-powered daily briefing)
        dashboard: '/api/v1/dashboard',
        // Custom Tools (LLM-created and user-defined tools)
        customTools: '/api/v1/custom-tools',
        // Config Center (centralized config management)
        configServices: '/api/v1/config-services',
        // Local AI Providers (LM Studio, Ollama)
        localProviders: '/api/v1/local-providers',
      },
    });
  });

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
  }
}
