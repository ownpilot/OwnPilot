/**
 * HTTP Server entry point
 *
 * All settings are loaded from the PostgreSQL database.
 * Data is stored in platform-specific application data directory.
 */

// Load .env file FIRST before any other imports
// Use explicit path to find .env in monorepo root (2 levels up from packages/gateway/src)
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple locations for .env file
const envPaths = [
  resolve(__dirname, '..', '..', '..', '.env'),  // monorepo root from src/
  resolve(__dirname, '..', '..', '.env'),         // packages/gateway/.env
  resolve(process.cwd(), '.env'),                 // current working directory
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, quiet: true });
    console.log(`[Config] Loaded .env from: ${envPath}`);
    break;
  }
}

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import type { GatewayConfig } from './types/index.js';
import { wsGateway } from './ws/index.js';
import { initializeAdapter } from './db/adapters/index.js';
import { loadApiKeysToEnvironment } from './routes/settings.js';
import { initializeFileWorkspace } from './workspace/index.js';
import { settingsRepo, initializeSettingsRepo } from './db/repositories/settings.js';
import { initializeDataDirectories, getDataDirectoryInfo } from './paths/index.js';
import { autoMigrateIfNeeded } from './paths/migration.js';
import { initializePlugins, getDefaultPluginRegistry } from './plugins/index.js';
import { initializeConfigServicesRepo } from './db/repositories/config-services.js';
import { initializePluginsRepo } from './db/repositories/plugins.js';
import { initializeLocalProvidersRepo } from './db/repositories/local-providers.js';
import { seedConfigServices } from './db/seeds/config-services-seed.js';
import { gatewayConfigCenter } from './services/config-center-impl.js';
import { startTriggerEngine, stopTriggerEngine, initializeDefaultTriggers } from './triggers/index.js';
import { seedExamplePlans } from './db/seeds/plans-seed.js';
import { createChannelServiceImpl } from './channels/service-impl.js';
import { randomUUID } from 'node:crypto';
import { initServiceRegistry, Services, getEventSystem, setChannelService, setModuleResolver } from '@ownpilot/core';
import type { NormalizedMessage, IMessageBus } from '@ownpilot/core';
import { createLogService } from './services/log-service-impl.js';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './config/defaults.js';
import { createSessionService } from './services/session-service-impl.js';
import { createMessageBus } from './services/message-bus-impl.js';
import { registerPipelineMiddleware } from './services/middleware/index.js';
import { createToolService } from './services/tool-service-impl.js';
import { createProviderService } from './services/provider-service-impl.js';
import { createAuditService } from './services/audit-service-impl.js';
import { createDatabaseServiceImpl } from './services/database-service-impl.js';
import { createPluginService } from './services/plugin-service-impl.js';
import { createMemoryServiceImpl } from './services/memory-service-impl.js';
import { createWorkspaceServiceImpl } from './services/workspace-service-impl.js';
import { createGoalServiceImpl } from './services/goal-service-impl.js';
import { createTriggerServiceImpl } from './services/trigger-service-impl.js';
import { createPlanServiceImpl } from './services/plan-service-impl.js';
import { createResourceServiceImpl } from './services/resource-service-impl.js';
import { stopAllRateLimiters } from './middleware/rate-limit.js';
import { getAdapterSync } from './db/adapters/index.js';
import { getApprovalManager } from './autonomy/approvals.js';
import { getLog } from './services/log.js';
import { getErrorMessage } from './routes/helpers.js';

const log = getLog('Server');

// Database settings keys for gateway config
const GATEWAY_API_KEYS_KEY = 'gateway_api_keys';
const GATEWAY_JWT_SECRET_KEY = 'gateway_jwt_secret';
const GATEWAY_RATE_LIMIT_MAX_KEY = 'gateway_rate_limit_max';
const GATEWAY_RATE_LIMIT_WINDOW_KEY = 'gateway_rate_limit_window_ms';
const GATEWAY_AUTH_TYPE_KEY = 'gateway_auth_type';

/**
 * Load configuration from database (with ENV fallback for backward compatibility)
 */
function loadConfig(): Partial<GatewayConfig> {
  // Get auth settings from database
  const dbAuthType = settingsRepo.get<string>(GATEWAY_AUTH_TYPE_KEY);
  const dbApiKeys = settingsRepo.get<string>(GATEWAY_API_KEYS_KEY);
  const dbJwtSecret = settingsRepo.get<string>(GATEWAY_JWT_SECRET_KEY);

  // Auth type from database or ENV (default: api-key for security)
  const authType = (dbAuthType ?? process.env.AUTH_TYPE ?? 'api-key') as 'none' | 'api-key' | 'jwt';

  // API keys and JWT secret from database or ENV
  const apiKeys = dbApiKeys?.split(',').filter(Boolean) ?? process.env.API_KEYS?.split(',');
  const jwtSecret = dbJwtSecret ?? process.env.JWT_SECRET;

  // Rate limit settings from database or ENV
  const dbRateLimitWindow = settingsRepo.get<number>(GATEWAY_RATE_LIMIT_WINDOW_KEY);
  const dbRateLimitMax = settingsRepo.get<number>(GATEWAY_RATE_LIMIT_MAX_KEY);

  const rateLimitWindowMs = dbRateLimitWindow ?? (parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(RATE_LIMIT_WINDOW_MS), 10) || RATE_LIMIT_WINDOW_MS);
  const rateLimitMax = dbRateLimitMax ?? (parseInt(process.env.RATE_LIMIT_MAX ?? String(RATE_LIMIT_MAX_REQUESTS), 10) || RATE_LIMIT_MAX_REQUESTS);

  return {
    port: parseInt(process.env.PORT ?? '8080', 10) || 8080,
    host: process.env.HOST ?? '127.0.0.1',
    corsOrigins: process.env.CORS_ORIGINS?.split(',').filter(Boolean),
    rateLimit: process.env.RATE_LIMIT_DISABLED !== 'true'
      ? {
          windowMs: rateLimitWindowMs,
          maxRequests: rateLimitMax,
        }
      : undefined,
    auth: {
      type: authType,
      apiKeys,
      jwtSecret,
    },
  };
}

/**
 * Start the server
 */
async function main() {
  // ── Module resolver (allows core tools to import gateway's npm packages) ──
  setModuleResolver((name) => import(name));

  // ── ServiceRegistry ──────────────────────────────────────────────────────
  const registry = initServiceRegistry();

  // 1. Log service (first — everything else can use it)
  const logLevel = (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
  const logService = createLogService({ level: logLevel });
  registry.register(Services.Log, logService);
  const log = logService;

  // 2. Event system (register existing singleton)
  registry.register(Services.Event, getEventSystem());

  // 3. Session service (unified session management)
  registry.register(Services.Session, createSessionService());

  // 4. Message bus (unified message processing pipeline)
  const messageBus = createMessageBus();
  registerPipelineMiddleware(messageBus);
  registry.register(Services.Message, messageBus);

  log.info('ServiceRegistry initialized', { services: registry.list() });

  // Log PostgreSQL configuration
  log.info('Database: PostgreSQL');
  log.info(`POSTGRES_HOST=${process.env.POSTGRES_HOST || 'localhost'}`);
  log.info(`POSTGRES_PORT=${process.env.POSTGRES_PORT || '25432'}`);
  log.info(`POSTGRES_DB=${process.env.POSTGRES_DB || 'ownpilot'}`);

  // Initialize data directories (creates platform-specific directories)
  const _dataPaths = initializeDataDirectories();
  const dataInfo = getDataDirectoryInfo();

  log.info(`Data directory: ${dataInfo.root}`);

  // Auto-migrate legacy data if needed
  autoMigrateIfNeeded();

  // Initialize PostgreSQL database adapter (REQUIRED)
  log.info('Initializing PostgreSQL database...');
  try {
    const dbAdapter = await initializeAdapter();
    log.info(`PostgreSQL connected: ${dbAdapter.isConnected()}`);
  } catch (error) {
    log.error('PostgreSQL connection failed', { error: String(error) });
    log.error('Make sure PostgreSQL is running and configured correctly.');
    log.error('Start PostgreSQL with: docker compose -f docker-compose.db.yml up -d');
    process.exit(1);
  }

  // Initialize settings repository (creates table and loads cache)
  log.info('Initializing settings...');
  await initializeSettingsRepo();

  // Load saved API keys from database into environment
  loadApiKeysToEnvironment();

  // Initialize Config Center (centralized config management)
  log.info('Initializing Config Center...');
  await initializeConfigServicesRepo();
  await seedConfigServices();

  // 5. Config Center
  registry.register(Services.Config, gatewayConfigCenter);

  // Start embedding queue (background embedding generation for memories)
  const { getEmbeddingQueue } = await import('./services/embedding-queue.js');
  getEmbeddingQueue().start();

  // 6. Database Service (wraps CustomDataService)
  registry.register(Services.Database, createDatabaseServiceImpl());

  // 7. Resource Service (wraps ResourceRegistry)
  registry.register(Services.Resource, createResourceServiceImpl());

  // Initialize Extensions repository + scan for new extensions
  log.info('Initializing Extensions...');
  try {
    const { initializeExtensionsRepo } = await import('./db/repositories/extensions.js');
    await initializeExtensionsRepo();

    const { getExtensionService } = await import('./services/extension-service.js');
    const extService = getExtensionService();
    const scanResult = await extService.scanDirectory(undefined, 'default');
    const totalExtensions = extService.getAll().length;
    if (scanResult.installed > 0) {
      log.info(`Extensions: ${totalExtensions} total, ${scanResult.installed} newly installed`);
    } else if (totalExtensions > 0) {
      log.info(`Extensions: ${totalExtensions} installed`);
    }
  } catch (error) {
    log.warn('Extensions initialization failed', { error: String(error) });
  }

  // Initialize Plugins repository
  log.info('Initializing Plugins repository...');
  await initializePluginsRepo();

  // Initialize Local Providers repository
  log.info('Initializing Local Providers...');
  await initializeLocalProvidersRepo();

  // Initialize file workspace directories (for AI-generated code isolation)
  const workspace = initializeFileWorkspace();

  // Auto-cleanup stale/empty workspaces (fire-and-forget)
  try {
    const { smartCleanupSessionWorkspaces } = await import('./workspace/file-workspace.js');
    const cleanup = smartCleanupSessionWorkspaces('both', 30);
    if (cleanup.deleted > 0) {
      log.info(`Boot cleanup: removed ${cleanup.deleted} workspaces (${cleanup.deletedEmpty} empty, ${cleanup.deletedOld} old)`);
    }
  } catch (err) {
    log.warn('Workspace auto-cleanup failed', { error: String(err) });
  }

  const config = loadConfig();
  const app = createApp(config);

  const port = config.port ?? 8080;
  const host = config.host ?? '0.0.0.0';

  // Security: warn if binding to all interfaces without authentication
  if (host === '0.0.0.0' && config.auth?.type === 'none') {
    log.warn('⚠ WARNING: Server bound to 0.0.0.0 with AUTH_TYPE=none — API is exposed without authentication!');
    log.warn('Set AUTH_TYPE=api-key or AUTH_TYPE=jwt, or bind to 127.0.0.1 for local-only access.');
  }

  // Initialize plugins (registers built-in plugins)
  log.info('Initializing plugins...');
  await initializePlugins();
  log.info('Plugins initialized.');

  // Initialize MCP Client Service — auto-connect configured external MCP servers
  try {
    const { mcpClientService } = await import('./services/mcp-client-service.js');
    await mcpClientService.autoConnect();
  } catch (err) {
    log.warn('MCP auto-connect had errors', { error: String(err) });
  }

  // Initialize Channel Service (unified channel access via plugin registry)
  log.info('Initializing Channel Service...');
  const pluginRegistry = await getDefaultPluginRegistry();
  const channelService = createChannelServiceImpl(pluginRegistry);

  // 8. Channel Service (unified channel access via plugin registry)
  setChannelService(channelService);
  registry.register(Services.Channel, channelService);
  log.info('Channel Service initialized.');

  // Auto-connect channels that have valid configuration
  channelService.autoConnectChannels().catch((err) => {
    log.warn('Channel auto-connect had errors', { error: String(err) });
  });

  // 9. Plugin Service (wraps PluginRegistry)
  registry.register(Services.Plugin, await createPluginService());

  // 10. Memory Service (wraps MemoryService)
  registry.register(Services.Memory, createMemoryServiceImpl());

  // 11. Goal Service (wraps GoalService)
  registry.register(Services.Goal, createGoalServiceImpl());

  // 12. Trigger Service (wraps TriggerService)
  registry.register(Services.Trigger, createTriggerServiceImpl());

  // 13. Plan Service (wraps PlanService)
  registry.register(Services.Plan, createPlanServiceImpl());

  // 14. Tool Service (wraps ToolRegistry)
  registry.register(Services.Tool, createToolService());

  // 15. Provider Service
  registry.register(Services.Provider, createProviderService());

  // 16. Audit Service
  registry.register(Services.Audit, createAuditService());

  // 17. Workspace Service (wraps WorkspaceManager)
  registry.register(Services.Workspace, createWorkspaceServiceImpl());

  // Start trigger engine (proactive automation)
  log.info('Starting Trigger Engine...');
  try {
    const triggerEngine = startTriggerEngine({ userId: 'default' });

    // Wire up the broadcaster for real-time WS events
    triggerEngine.setBroadcaster((_event, data) =>
      wsGateway.broadcast('trigger:executed', data as import('./ws/types.js').ServerEvents['trigger:executed']),
    );

    // Wire up the chat handler once agent system is available.
    // Routes through the MessageBus pipeline so trigger-initiated chats get
    // context injection, persistence, audit logging, and post-processing.
    triggerEngine.setChatHandler(async (message, _payload) => {
      const { getOrCreateChatAgent } = await import('./routes/agents.js');
      const { resolveProviderAndModel } = await import('./routes/settings.js');
      const resolved = await resolveProviderAndModel('default', 'default');
      const provider = resolved.provider ?? 'openai';
      const model = resolved.model ?? 'gpt-4o-mini';
      const agent = await getOrCreateChatAgent(provider, model);

      const bus = registry.get<IMessageBus>(Services.Message);
      const conversationId = agent.getConversation().id;
      const normalized: NormalizedMessage = {
        id: randomUUID(),
        sessionId: conversationId,
        role: 'user',
        content: message,
        metadata: { source: 'scheduler', provider, model },
        timestamp: new Date(),
      };

      const result = await bus.process(normalized, {
        context: {
          agent,
          userId: 'default',
          agentId: 'chat',
          provider,
          model,
          conversationId,
        },
      });

      return {
        content: result.response.content,
        toolCalls: result.response.metadata?.toolCalls?.length ?? 0,
      };
    });

    // Register 'workflow' action handler
    triggerEngine.registerActionHandler('workflow', async (payload) => {
      const { getWorkflowService } = await import('./services/workflow-service.js');
      const workflowId = payload.workflowId as string;
      if (!workflowId) return { success: false, error: 'Missing workflowId in payload' };
      const service = getWorkflowService();
      if (service.isRunning(workflowId)) return { success: false, error: 'Workflow already running' };
      try {
        const wfLog = await service.executeWorkflow(workflowId, 'default');
        return {
          success: wfLog.status === 'completed',
          message: `Workflow ${wfLog.status}`,
          data: { logId: wfLog.id, status: wfLog.status, durationMs: wfLog.durationMs },
          error: wfLog.error ?? undefined,
        };
      } catch (err) {
        return { success: false, error: getErrorMessage(err, 'Workflow execution failed') };
      }
    });

    // Seed default triggers (only creates if not already present)
    const triggerSeed = await initializeDefaultTriggers('default');
    if (triggerSeed.created > 0) {
      log.info(`Seeded ${triggerSeed.created} default triggers.`);
    }

    log.info('Trigger Engine started.');
  } catch (error) {
    log.warn('Trigger Engine failed to start', { error: String(error) });
    log.warn('Triggers will be available but engine is not running.');
  }

  // Seed example plans (only creates if not already present)
  try {
    const planSeed = await seedExamplePlans('default');
    if (planSeed.created > 0) {
      log.info(`Seeded ${planSeed.created} example plans.`);
    }
  } catch (error) {
    log.warn('Failed to seed example plans', { error: String(error) });
  }

  // Security warnings at startup
  if (config.auth?.type === 'none' || !config.auth?.type) {
    const isExposed = host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
    if (isExposed) {
      log.warn('==========================================================');
      log.warn('  SECURITY WARNING: Auth DISABLED on a network interface!');
      log.warn(`  HOST=${host} — anyone on the network can access all APIs.`);
      log.warn('  Set AUTH_TYPE=api-key and API_KEYS=your-secret-key,');
      log.warn('  or change HOST=127.0.0.1 to restrict to localhost only.');
      log.warn('==========================================================');
    } else {
      log.warn('Authentication is DISABLED (AUTH_TYPE=none).');
      log.warn('Only localhost can access the API. Set AUTH_TYPE=api-key for remote access.');
    }
  }
  if (config.corsOrigins?.includes('*')) {
    log.warn('CORS is set to wildcard (*). Any website can make API requests.');
    log.warn('Set CORS_ORIGINS=http://localhost:3000 to restrict access.');
  }

  log.info('Starting OwnPilot...', {
    port,
    host,
    auth: config.auth?.type ?? 'none',
    rateLimit: config.rateLimit ? `${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms` : 'disabled',
    workspace: workspace.workspaceDir,
    registeredServices: registry.list(),
  });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    log.info(`Server running at http://${info.address}:${info.port}`);
    log.info(`API docs: http://${info.address}:${info.port}/api/v1`);
    log.info(`Health: http://${info.address}:${info.port}/health`);
  });

  // Attach WebSocket gateway to HTTP server
  wsGateway.attachToServer(server as Server);
  log.info(`WebSocket Gateway attached at ws://${host}:${port}/ws`);

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info(`Received ${signal}, shutting down gracefully...`);

    // 1. Stop accepting new HTTP connections
    (server as Server).close();

    // 2. Stop WebSocket gateway
    try { await wsGateway.stop(); } catch (e) { log.warn('WS shutdown error', { error: String(e) }); }

    // 2.5. Disconnect MCP clients
    try {
      const { mcpClientService } = await import('./services/mcp-client-service.js');
      await mcpClientService.disconnectAll();
    } catch (e) { log.warn('MCP disconnect error', { error: String(e) }); }

    // 3. Stop trigger engine
    try { stopTriggerEngine(); } catch (e) { log.warn('Trigger engine stop error', { error: String(e) }); }

    // 4. Stop rate limiter cleanup intervals
    stopAllRateLimiters();

    // 5. Stop approval manager cleanup
    try { getApprovalManager().stop(); } catch (e) { log.warn('ApprovalManager stop error', { error: String(e) }); }

    // 6. Cleanup webhook handler (if Telegram is in webhook mode)
    try {
      const { getWebhookHandler, unregisterWebhookHandler } = await import('./channels/plugins/telegram/webhook.js');
      if (getWebhookHandler()) {
        unregisterWebhookHandler();
      }
    } catch { /* webhook module not loaded */ }

    // 7. Dispose session service (cleanup intervals)
    try {
      const sessionSvc = registry.tryGet(Services.Session);
      if (sessionSvc && 'dispose' in sessionSvc) (sessionSvc as { dispose(): void }).dispose();
    } catch (e) { log.warn('Session service dispose error', { error: String(e) }); }

    // 8. Invalidate MCP server (close sessions, stop cleanup timer)
    try {
      const { invalidateMcpServer } = await import('./services/mcp-server-service.js');
      invalidateMcpServer();
    } catch (e) { log.warn('MCP server cleanup error', { error: String(e) }); }

    // 9. Close DB connection pool
    try {
      const adapter = getAdapterSync();
      await adapter.close();
    } catch (e) { log.warn('DB close error', { error: String(e) }); }

    log.info('Cleanup complete, exiting.');

    // Force exit after 5s if something hangs
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // ── Global Error Handlers ─────────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Promise Rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception — shutting down', { error: error.message, stack: error.stack });
    gracefulShutdown('uncaughtException').finally(() => process.exit(1));
  });
}

// Run server
main().catch((err) => {
  log.error('Fatal: server startup failed', { error: getErrorMessage(err), stack: err instanceof Error ? err.stack : undefined });
  process.exit(1);
});
