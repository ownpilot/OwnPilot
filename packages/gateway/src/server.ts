/**
 * HTTP Server entry point
 *
 * All settings are loaded from the PostgreSQL database.
 * Data is stored in platform-specific application data directory.
 *
 * Trust boundary: The HTTP server reads request bodies as unknown and passes them through zod validation at the route handler; the casts below are server-startup-only config reads where the source is a hardcoded schema. Config files are the trust boundary.
 */

// Load .env file FIRST before any other imports
// Use explicit path to find .env in monorepo root (2 levels up from packages/gateway/src)
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple locations for .env file (load all found, later override earlier)
const envPaths = [
  resolve(__dirname, '..', '..', '..', '.env'), // monorepo root from src/
  resolve(__dirname, '..', '..', '.env'), // packages/gateway/.env
  resolve(process.cwd(), '.env'), // current working directory
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, quiet: true });
    // Use getLog after dotenv is loaded but before heavy imports
    const { getLog } = await import('./services/log.js');
    getLog('Config').info(`Loaded .env from: ${envPath}`);
    // Do NOT break — load all env files so gateway-specific vars override root vars
  }
}

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp, sanitizeCorsOriginsFromEnv } from './app.js';
import type { GatewayConfig } from './types/index.js';
import { wsGateway } from './ws/index.js';
import { initializeAdapter } from './db/adapters/index.js';
import { getDatabaseConfig, DEFAULT_POSTGRES_PASSWORD } from './db/adapters/types.js';
import { loadApiKeysToEnvironment } from './services/app-settings.js';
import { initializeFileWorkspace } from './workspace/index.js';
import { settingsRepo, initializeSettingsRepo } from './db/repositories/settings/index.js';
import { initializeDataDirectories, getDataDirectoryInfo } from './paths/index.js';
import { autoMigrateIfNeeded } from './paths/migration.js';
import { initializePlugins, getDefaultPluginRegistry } from './plugins/index.js';
import { initializeConfigServicesRepo } from './db/repositories/config-services.js';
import { initializePluginsRepo } from './db/repositories/plugins.js';
import { initializeLocalProvidersRepo } from './db/repositories/local-providers.js';
import { initializeUISessionsRepo } from './db/repositories/ui-sessions.js';
import { seedConfigServices } from './db/seeds/config-services-seed.js';
import { gatewayConfigCenter } from './services/config/center.js';
import {
  startTriggerEngine,
  stopTriggerEngine,
  initializeDefaultTriggers,
} from './triggers/index.js';
import { seedExamplePlans } from './db/seeds/plans-seed.js';
import { createChannelServiceImpl } from './channels/service-impl.js';
import { initServiceRegistry, Services, type ServiceToken } from '@ownpilot/core/services';
import { setModuleResolver } from '@ownpilot/core/agent';
import { enforceSecurityConfig } from '@ownpilot/core/security';
import { getEventSystem } from '@ownpilot/core/events';
import { createLogService } from './services/log-service.js';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './config/defaults.js';
import { createSessionService } from './services/session-service.js';
import { createMessageBus } from './services/message-bus.js';
import { registerPipelineMiddleware } from './services/middleware/index.js';
import { createToolService } from './services/tool/service.js';
import { createProviderService } from './services/provider/service.js';
import { createAuditService } from './services/audit-service.js';
import { getCustomDataService } from './services/custom/data-service.js';
import { createPluginService } from './services/plugin-service.js';
import { getMemoryService } from './services/memory-service.js';
import { createWorkspaceServiceImpl } from './services/workspace-service.js';
import { getGoalService } from './services/goal-service.js';
import { getTriggerService } from './services/trigger-service.js';
import { getPlanService } from './services/plan-service.js';
import { createResourceServiceImpl } from './services/resource/service.js';
import { stopAllRateLimiters } from './middleware/rate-limit.js';
import { getApprovalManager } from './autonomy/approvals.js';
import { getLog } from './services/log.js';
import { getErrorMessage } from './utils/common.js';

const log = getLog('Server');

// Database settings keys for gateway config
const GATEWAY_API_KEYS_KEY = 'gateway_api_keys';
const GATEWAY_JWT_SECRET_KEY = 'gateway_jwt_secret';
const GATEWAY_RATE_LIMIT_MAX_KEY = 'gateway_rate_limit_max';
const GATEWAY_RATE_LIMIT_WINDOW_KEY = 'gateway_rate_limit_window_ms';
const GATEWAY_AUTH_TYPE_KEY = 'gateway_auth_type';

/**
 * Load configuration from database (with ENV fallback for backward compatibility)
 *
 * Trust boundary: The HTTP server reads request bodies as unknown and passes them through zod validation at the route handler; the casts below are server-startup-only config reads where the source is a hardcoded schema. Config files are the trust boundary.
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

  const rateLimitWindowMs =
    dbRateLimitWindow ??
    (parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(RATE_LIMIT_WINDOW_MS), 10) ||
      RATE_LIMIT_WINDOW_MS);
  const rateLimitMax =
    dbRateLimitMax ??
    (parseInt(process.env.RATE_LIMIT_MAX ?? String(RATE_LIMIT_MAX_REQUESTS), 10) ||
      RATE_LIMIT_MAX_REQUESTS);

  return {
    port: parseInt(process.env.PORT ?? '8080', 10) || 8080,
    host: process.env.HOST ?? '127.0.0.1',
    // CORS-001: filter wildcard and non-http(s) origins so loadConfig()
    // honors the same gate as DEFAULT_CONFIG. Returning `undefined` when
    // CORS_ORIGINS isn't set keeps DEFAULT_CONFIG's localhost fallback.
    corsOrigins: process.env.CORS_ORIGINS
      ? sanitizeCorsOriginsFromEnv(process.env.CORS_ORIGINS)
      : undefined,
    rateLimit:
      process.env.RATE_LIMIT_DISABLED !== 'true'
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
 *
 * Trust boundary: The HTTP server reads request bodies as unknown and passes them through zod validation at the route handler; the casts below are server-startup-only config reads where the source is a hardcoded schema. Config files are the trust boundary.
 */
async function main() {
  // ── Config Validation (fail-fast before any heavy initialization) ─────────
  const { assertBootConfig } = await import('./config/validation.js');
  assertBootConfig();

  // ── Security enforcement (fail-fast) ──────────────────────────────────────
  // Throws in production on insecure config: dangerous env vars
  // (DOCKER_SANDBOX_RELAXED_SECURITY / ALLOW_HOME_DIR_ACCESS) always block;
  // Docker is only required when EXECUTION_MODE=docker. Logs the security
  // posture in all environments.
  await enforceSecurityConfig();

  // ── Module resolver (allows core tools to import gateway's npm packages) ──
  setModuleResolver((name) => import(name));

  // ── ServiceRegistry ──────────────────────────────────────────────────────
  const registry = initServiceRegistry();

  // ── R1: pre-import all the core setter functions so we can install services
  // with a single line below. The previous pattern was:
  //   {
  //     const memory = getMemoryService();
  //     registry.register(Services.Memory, memory);
  //     const { setMemoryService } = await import('@ownpilot/core');
  //     setMemoryService(memory);
  //   }
  // — repeated 14+ times. `installService` collapses this to one line per
  // service. The setXService setters are sync (`void`), so importing them
  // once at the top of main() doesn't block startup any more than the
  // per-block imports did.
  const {
    setConfigCenter,
    setEmbeddingService,
    setDatabaseService,
    setResourceService,
    setExtensionService,
    setMcpClientService,
    setChannelService,
    setPluginService,
    setMemoryService,
    setGoalService,
    setTriggerService,
    setPlanService,
    setToolService,
    setProviderService,
    setAuditService,
    setWorkspaceService,
    setWorkflowService,
    setHeartbeatService,
    setCodingAgentService,
    setArtifactService,
    setSessionService,
    setMessageBus,
  } = await import('@ownpilot/core');

  /**
   * Register a service in the ServiceRegistry AND install it on the core
   * capability singleton in one call. Both have to happen on every service
   * (registry is for ctx-based lookups; the singleton is for the
   * `getXService()` helpers used by older code paths). Doing them together
   * keeps them from drifting out of sync.
   */
  function installService<T>(
    token: import('@ownpilot/core').ServiceToken<T>,
    instance: T,
    setter: (instance: T) => void
  ): void {
    registry.register(token, instance);
    setter(instance);
  }

  // 1. Log service (first — everything else can use it)
  const logLevel = (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
  const logService = createLogService({ level: logLevel });
  registry.register(Services.Log, logService);
  const log = logService;

  // 2. Event system (register existing singleton)
  registry.register(Services.Event, getEventSystem());

  // 3. Session service (unified session management) — also installed on the core capability singleton
  installService(Services.Session, createSessionService(), setSessionService);

  // 4. Message bus (unified message processing pipeline) — also installed on the core capability singleton
  {
    const messageBus = createMessageBus();
    registerPipelineMiddleware(messageBus);
    installService(Services.Message, messageBus, setMessageBus);
  }

  log.info('ServiceRegistry initialized', { services: registry.list() });

  // Log PostgreSQL configuration
  log.info('Database: PostgreSQL');
  log.info(`POSTGRES_HOST=${process.env.POSTGRES_HOST || 'localhost'}`);
  log.info(`POSTGRES_PORT=${process.env.POSTGRES_PORT || '25432'}`);
  log.info(`POSTGRES_DB=${process.env.POSTGRES_DB || 'ownpilot'}`);

  // Initialize data directories (creates platform-specific directories)
  initializeDataDirectories();
  const dataInfo = getDataDirectoryInfo();

  log.info(`Data directory: ${dataInfo.root}`);

  // Auto-migrate legacy data if needed
  autoMigrateIfNeeded();

  // Initialize PostgreSQL database adapter (REQUIRED)
  log.info('Initializing PostgreSQL database...');
  // Soft warning in non-production when the operator hasn't changed the
  // documented default password (production path throws in getDatabaseConfig).
  try {
    const cfg = getDatabaseConfig();
    if (
      cfg.postgresPassword === DEFAULT_POSTGRES_PASSWORD &&
      process.env.NODE_ENV !== 'production'
    ) {
      log.warn(
        'POSTGRES_PASSWORD is set to the documented default ("ownpilot_secret"). ' +
          'Change it before deploying with NODE_ENV=production.'
      );
    }
  } catch (cfgErr) {
    log.error('Invalid database configuration', { error: String(cfgErr) });
    process.exit(1);
  }
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

  // Reconcile orphaned sessions from any previous crash/unclean shutdown
  log.info('Running orphan session reconciliation...');
  const { reconcileOrphanedSessions } = await import('./services/orphan-reconciliation.js');
  const reconcileResults = await reconcileOrphanedSessions();
  const totalOrphaned = reconcileResults.reduce((sum, r) => sum + r.orphaned, 0);
  if (totalOrphaned > 0) {
    log.warn(`Orphan reconciliation found ${totalOrphaned} orphaned sessions`);
  }

  // Run provider health checks at boot to detect unavailable providers early
  log.info('Running provider health checks...');
  const { runProviderHealthChecks } = await import('./services/provider/health.js');
  await runProviderHealthChecks();

  // Start metrics service for Prometheus endpoint
  log.info('Starting metrics service...');
  const { startMetricsService } = await import('./services/metric/service.js');
  startMetricsService();

  // Load saved API keys from database into environment
  loadApiKeysToEnvironment();

  // Initialize UI sessions before auth middleware/session cleanup can query it.
  log.info('Initializing UI sessions...');
  await initializeUISessionsRepo();

  // Start UI session cleanup (purge expired sessions hourly)
  const { startCleanup: startSessionCleanup } = await import('./services/ui-session.js');
  startSessionCleanup();

  // Initialize Config Center (centralized config management)
  log.info('Initializing Config Center...');
  await initializeConfigServicesRepo();
  await seedConfigServices();

  // 5. Config Center — also installed on the core capability singleton so
  // callers can use getConfigCenter() from @ownpilot/core without going
  // through the registry on every call.
  installService(Services.Config, gatewayConfigCenter, setConfigCenter);

  // 5b. LLM Router (matches the channel + config pattern — capability lives in
  // core, gateway provides the impl during boot)
  const { installLLMRouter } = await import('./services/llm/router.js');
  installLLMRouter();

  // 5c. Permission Gate (unified tool-call authorization — covers the
  // per-call filters previously inlined in soul-heartbeat's onBeforeToolCall;
  // approval middleware + claw autonomy policy migrate in a later phase)
  const { installPermissionGate } = await import('./services/permission/gate.js');
  installPermissionGate();

  // Start embedding queue (background embedding generation for memories)
  const { getEmbeddingQueue } = await import('./services/embedding/queue.js');
  getEmbeddingQueue().start();

  // 6. Embedding Service — also installed on the core capability singleton
  {
    const { getEmbeddingService } = await import('./services/embedding/service.js');
    installService(Services.Embedding, getEmbeddingService(), setEmbeddingService);
  }

  // 7. Database Service — also installed on the core capability singleton
  installService(Services.Database, getCustomDataService(), setDatabaseService);

  // 7. Resource Service (wraps ResourceRegistry) — also installed on the core capability singleton
  installService(Services.Resource, createResourceServiceImpl(), setResourceService);

  // Initialize Extensions repository + scan for new extensions
  log.info('Initializing Extensions...');
  try {
    const { initializeExtensionsRepo } = await import('./db/repositories/extensions.js');
    await initializeExtensionsRepo();

    const { getExtensionService } = await import('./services/extension/service.js');
    const extService = getExtensionService();
    const scanResult = await extService.scanDirectory(undefined, 'default');
    const totalExtensions = extService.getAll().length;
    if (scanResult.installed > 0) {
      log.info(`Extensions: ${totalExtensions} total, ${scanResult.installed} newly installed`);
    } else if (totalExtensions > 0) {
      log.info(`Extensions: ${totalExtensions} installed`);
    }

    // Clean up orphan triggers from uninstalled extensions
    await extService.cleanupOrphanTriggers('default');

    // 8. Extension Service — also installed on the core capability singleton
    installService(Services.Extension, extService, setExtensionService);
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
      log.info(
        `Boot cleanup: removed ${cleanup.deleted} workspaces (${cleanup.deletedEmpty} empty, ${cleanup.deletedOld} old)`
      );
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
    log.warn(
      '⚠ WARNING: Server bound to 0.0.0.0 with AUTH_TYPE=none — API is exposed without authentication!'
    );
    log.warn('Set AUTH_TYPE=api-key or AUTH_TYPE=jwt, or bind to 127.0.0.1 for local-only access.');
  }

  // Initialize plugins (registers built-in plugins)
  log.info('Initializing plugins...');
  await initializePlugins();
  log.info('Plugins initialized.');

  // Initialize MCP Client Service — auto-connect configured external MCP servers
  try {
    const { mcpClientService } = await import('./services/mcp/client.js');
    await mcpClientService.autoConnect();

    // 9. MCP Client Service — also installed on the core capability singleton
    installService(Services.McpClient, mcpClientService, setMcpClientService);
  } catch (err) {
    log.warn('MCP auto-connect had errors', { error: String(err) });
  }

  // Initialize Channel Service (unified channel access via plugin registry)
  log.info('Initializing Channel Service...');
  const pluginRegistry = await getDefaultPluginRegistry();
  const channelService = createChannelServiceImpl(pluginRegistry);

  // 8. Channel Service (unified channel access via plugin registry)
  installService(Services.Channel, channelService, setChannelService);
  log.info('Channel Service initialized.');

  // Wire cross-channel bridges into the live pipeline (forwards inbound
  // messages between the owner's channels per configured bridges).
  try {
    const { initChannelBridges } = await import('./channels/bridge-runtime.js');
    await initChannelBridges(channelService);
  } catch (err) {
    log.warn('Channel bridge init failed', { error: String(err) });
  }

  // Auto-connect channels that have valid configuration
  channelService.autoConnectChannels().catch((err) => {
    log.warn('Channel auto-connect had errors', { error: String(err) });
  });

  // Print pairing banners for unclaimed channels
  try {
    const { getPairingKey, printPairingBanner, getOwnerUserId } =
      await import('./services/pairing-service.js');
    const channels = channelService.listChannels();
    for (const ch of channels) {
      const owner = await getOwnerUserId(ch.platform);
      if (!owner) {
        const key = await getPairingKey(ch.pluginId);
        printPairingBanner(ch.name, key);
      }
    }
  } catch (err) {
    log.warn('Could not check owner/pairing state', { error: String(err) });
  }

  // 9. Plugin Service (wraps PluginRegistry) — also installed on the core capability singleton
  installService(Services.Plugin, await createPluginService(), setPluginService);

  // 10. Memory Service — also installed on the core capability singleton so
  // runtimes can consume it through `ctx.memory.*` (RuntimeContext bundle)
  // without going through the registry on every call.
  installService(Services.Memory, getMemoryService(), setMemoryService);

  // 11. Goal Service — also installed on the core capability singleton so
  // runtimes can consume it via `getGoalService()` from @ownpilot/core
  // without going through the registry.
  installService(Services.Goal, getGoalService(), setGoalService);

  // 12. Trigger Service — also installed on the core capability singleton
  installService(Services.Trigger, getTriggerService(), setTriggerService);

  // 13. Plan Service — also installed on the core capability singleton
  installService(Services.Plan, getPlanService(), setPlanService);

  // 14. Tool Service (wraps ToolRegistry) — also installed on the core capability singleton
  installService(Services.Tool, createToolService(), setToolService);

  // 15. Provider Service — also installed on the core capability singleton
  installService(Services.Provider, createProviderService(), setProviderService);

  // 16. Audit Service — also installed on the core capability singleton so
  // runtimes can consume it through `ctx.audit.*` (RuntimeContext bundle)
  // without going through the registry on every call.
  installService(Services.Audit, createAuditService(), setAuditService);

  // 17. Workspace Service (wraps WorkspaceManager) — also installed on the core capability singleton
  installService(Services.Workspace, createWorkspaceServiceImpl(), setWorkspaceService);

  // 18. Workflow Service — also installed on the core capability singleton
  {
    const { getWorkflowService } = await import('./services/workflow/index.js');
    installService(Services.Workflow, getWorkflowService(), setWorkflowService);
  }

  // 18.1. Workflow Node Job Worker (gap 24.1 Phase 2 — persistent job queue for nodes)
  log.info('Starting Workflow Node Job Worker...');
  let stopWorkflowWorker: (() => void) | null = null;
  try {
    const { registerWorkflowNodeWorker, resumeWorkflowFromRecovery } =
      await import('./services/workflow/workflow-node-job-handler.js');
    stopWorkflowWorker = registerWorkflowNodeWorker();

    // Recover orphaned workflows at boot (gap 24.1 Phase 2 crash recovery)
    try {
      const { createWorkflowsRepository } = await import('./db/repositories/workflows/index.js');
      const recoveryRepo = createWorkflowsRepository('default');
      const runningLogs = await recoveryRepo.listRunningLogs();
      if (runningLogs.length > 0) {
        log.info(`Recovering ${runningLogs.length} orphaned workflow runs...`);
        for (const log of runningLogs) {
          await resumeWorkflowFromRecovery(log.id, log.userId);
        }
        log.info(`Workflow recovery complete.`);
      }
    } catch (recoveryError) {
      log.warn('Workflow recovery error', { error: String(recoveryError) });
    }

    log.info('Workflow Node Job Worker started.');
  } catch (error) {
    log.warn('Workflow Node Job Worker failed to start', { error: String(error) });
  }

  // 18.2. Retention Cleanup Worker (gap 24.3 — nightly cleanup via JobQueueService)
  try {
    const { registerRetentionCleanupWorker, scheduleRetentionCleanup } =
      await import('./services/retention-service.js');
    registerRetentionCleanupWorker();
    scheduleRetentionCleanup();
    log.info('Retention Cleanup Worker started.');
  } catch (error) {
    log.warn('Retention Cleanup Worker failed to start', { error: String(error) });
  }

  // 19. Heartbeat Service — also installed on the core capability singleton
  {
    const { getHeartbeatService } = await import('./services/heartbeat/service.js');
    installService(Services.Heartbeat, getHeartbeatService(), setHeartbeatService);
  }

  // 19b. Pulse Metrics Service (claw + soul monitoring) — registered in the ServiceRegistry
  // so event subscriptions can be cleaned up via resetPulseMetricsService() on shutdown.
  const { getPulseMetricsServiceForRegistry } = await import('./services/metric/pulse.js');
  registry.registerFactory(
    // Services.Pulse intentionally holds the PulseMetricsService instance (see
    // comment above); the token is typed for IPulseService, so bridge via unknown.
    Services.Pulse as unknown as ServiceToken<
      import('./services/metric/pulse.js').PulseMetricsService
    >,
    () => getPulseMetricsServiceForRegistry()
  );
  // Start after registry registration so .start() is called once
  getPulseMetricsServiceForRegistry().start();

  // 20. Coding Agent Service (external AI coding CLI orchestration) — also installed on the core capability singleton
  {
    const { getCodingAgentService } = await import('./services/coding-agent/service.js');
    installService(Services.CodingAgent, getCodingAgentService(), setCodingAgentService);
  }

  // 24. Artifact Service (AI-generated interactive content) — also installed on the core capability singleton
  {
    const { getArtifactService } = await import('./services/artifact/service.js');
    installService(Services.Artifact, getArtifactService(), setArtifactService);
  }

  // 24b. Canvas Service (Live Canvas — agent-driven spatial workspace)
  {
    const { getCanvasServiceImpl } = await import('./services/canvas/service.js');
    const { setCanvasService } = await import('@ownpilot/core');
    setCanvasService(getCanvasServiceImpl());
  }

  // 25. CLI Tool Service — installed on the core capability singleton so
  // consumers can resolve via getCliToolService() without going through the
  // gateway-local accessor. CliTool is not in the service registry; the core
  // singleton is the canonical access path for cross-package consumers.
  {
    const { getCliToolService: getLocalCliToolService } =
      await import('./services/cli/tool-service.js');
    const { setCliToolService } = await import('@ownpilot/core');
    setCliToolService(getLocalCliToolService());
  }

  // 26. Edge Service (IoT/MQTT device management) — installed on the core
  // capability singleton. Same pattern as CliTool: not registry-registered,
  // but exposed through the core accessor for cross-package consumers.
  {
    const { getEdgeService: getLocalEdgeService } = await import('./services/edge/service.js');
    const { setEdgeService } = await import('@ownpilot/core');
    setEdgeService(getLocalEdgeService());
  }

  // Start trigger engine (proactive automation)
  log.info('Starting Trigger Engine...');
  try {
    const triggerEngine = startTriggerEngine({ userId: 'default' });

    // Wire chat + built-in action handlers (workflow, run_heartbeat,
    // profile_learn, memory_extract, memory_consolidate). Logic lives in
    // triggers/action-handlers.ts; boot only wires it up.
    const { registerTriggerActionHandlers } = await import('./triggers/action-handlers.js');
    registerTriggerActionHandlers(triggerEngine);

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

  // Start Autonomy Engine (Pulse System)
  try {
    const { getAutonomyEngine, createPulseServiceAdapter } = await import('./autonomy/engine.js');
    const pulseEngine = getAutonomyEngine({ userId: 'default' });

    const pulse = createPulseServiceAdapter(pulseEngine);
    registry.register(Services.Pulse, pulse);
    const { setPulseService } = await import('@ownpilot/core');
    setPulseService(pulse);
    pulseEngine.start();
    log.info('Autonomy Engine started.');
  } catch (error) {
    log.warn('Autonomy Engine failed to start', { error: String(error) });
  }

  // Start always-on personal-memory retention (daily decay + cleanup). Pure
  // hygiene — no LLM, no conversation extraction — so it runs by default,
  // unlike the opt-in memory_extract / memory_consolidate triggers.
  try {
    const { startMemoryRetention } = await import('./services/memory/retention.js');
    startMemoryRetention('default');
  } catch (error) {
    log.warn('Memory retention scheduler failed to start', { error: String(error) });
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
    rateLimit: config.rateLimit
      ? `${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms`
      : 'disabled',
    workspace: workspace.workspaceDir,
    registeredServices: registry.list(),
  });

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      log.info(`Server running at http://${info.address}:${info.port}`);
      log.info(`API docs: http://${info.address}:${info.port}/api/v1`);
      log.info(`Health: http://${info.address}:${info.port}/health`);
    }
  );

  // Attach WebSocket gateway to HTTP server
  wsGateway.attachToServer(server as Server);
  log.info(`WebSocket Gateway attached at ws://${host}:${port}/ws`);

  // Start EventBusBridge (bidirectional EventBus ↔ WebSocket)
  wsGateway.startEventBridge();
  log.info('EventBusBridge started — WS clients can subscribe/publish events');

  // Initialize WebChat handler (bridges WS webchat events to channel system)
  try {
    const { initWebChatHandler } = await import('./ws/webchat-handler.js');
    initWebChatHandler();
    log.info('WebChat handler initialized.');
  } catch (error) {
    log.warn('WebChat handler failed to initialize', { error: String(error) });
  }

  // Wire debug log entries to WebSocket broadcast
  const { debugLog } = await import('@ownpilot/core');
  debugLog.onEntry = (entry) => {
    wsGateway.broadcast(
      'debug:entry',
      entry as import('./ws/types.js').ServerEvents['debug:entry']
    );
  };

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info(`Received ${signal}, shutting down gracefully...`);

    // 1. Stop accepting new HTTP connections
    (server as Server).close();

    // 2. Stop WebSocket gateway
    try {
      await wsGateway.stop();
    } catch (e) {
      log.warn('WS shutdown error', { error: String(e) });
    }

    // 2.5. Disconnect MCP clients
    try {
      const { mcpClientService } = await import('./services/mcp/client.js');
      await mcpClientService.disconnectAll();
    } catch (e) {
      log.warn('MCP disconnect error', { error: String(e) });
    }

    // 3. Stop trigger engine
    try {
      stopTriggerEngine();
    } catch (e) {
      log.warn('Trigger engine stop error', { error: String(e) });
    }

    // 4. Stop rate limiter cleanup intervals
    stopAllRateLimiters();

    // 4.5. Stop UI session cleanup
    try {
      const { stopCleanup: stopSessionCleanup } = await import('./services/ui-session.js');
      stopSessionCleanup();
    } catch (e) {
      log.warn('UI session cleanup stop error', { error: String(e) });
    }

    // 5. Stop approval manager cleanup
    try {
      getApprovalManager().stop();
    } catch (e) {
      log.warn('ApprovalManager stop error', { error: String(e) });
    }

    // 5.1. Stop autonomy engine
    try {
      const { stopAutonomyEngine } = await import('./autonomy/engine.js');
      stopAutonomyEngine();
    } catch (e) {
      log.warn('Autonomy engine stop error', { error: String(e) });
    }

    // 5.2. Stop scheduler
    try {
      const { stopScheduler } = await import('./scheduler/index.js');
      stopScheduler();
    } catch (e) {
      log.warn('Scheduler stop error', { error: String(e) });
    }

    // 5.2.1. Stop Job Queue Service (gap 24.1 Phase 2)
    try {
      const { JobQueueService } = await import('./services/job-queue-service.js');
      JobQueueService.getInstance().shutdown();
    } catch (e) {
      log.warn('Job Queue Service stop error', { error: String(e) });
    }

    // 5.2.2. Stop Workflow Node Job Worker
    try {
      if (stopWorkflowWorker) stopWorkflowWorker();
    } catch (e) {
      log.warn('Workflow Node Job Worker stop error', { error: String(e) });
    }

    // 5.3. Stop embedding queue
    try {
      const { resetEmbeddingQueue } = await import('./services/embedding/queue.js');
      resetEmbeddingQueue();
    } catch (e) {
      log.warn('Embedding queue stop error', { error: String(e) });
    }

    // 5.4. Stop heartbeat runner
    try {
      const { resetHeartbeatRunner } = await import('./services/heartbeat/soul-service.js');
      resetHeartbeatRunner();
    } catch (e) {
      log.warn('Heartbeat runner stop error', { error: String(e) });
    }

    // 5.4b. Stop Pulse Metrics Service (cleanup event subscriptions + timers)
    try {
      const { resetPulseMetricsService } = await import('./services/metric/pulse.js');
      resetPulseMetricsService();
    } catch (e) {
      log.warn('Pulse metrics service stop error', { error: String(e) });
    }

    // 5.5. Stop circuit breaker cleanup intervals
    try {
      const { stopAllCircuitBreakers } = await import('./middleware/circuit-breaker.js');
      stopAllCircuitBreakers();
    } catch (e) {
      log.warn('Circuit breaker stop error', { error: String(e) });
    }

    // 5.6. Stop coding agent sessions (terminate PTY processes and ACP clients)
    try {
      const { getCodingAgentSessionManager } = await import('./services/coding-agent/sessions.js');
      getCodingAgentSessionManager().stop();
    } catch (e) {
      log.warn('Coding agent sessions stop error', { error: String(e) });
    }

    // 5.6b. Reset coding agent service singleton
    try {
      const { resetCodingAgentSessionManager } =
        await import('./services/coding-agent/sessions.js');
      resetCodingAgentSessionManager();
    } catch (e) {
      log.warn('Coding agent session manager reset error', { error: String(e) });
    }

    // 5.6c. Reset heartbeat service
    try {
      const { resetHeartbeatService } = await import('./services/heartbeat/service.js');
      resetHeartbeatService();
    } catch (e) {
      log.warn('Heartbeat service reset error', { error: String(e) });
    }

    // 5.6c-mem. Stop the personal-memory retention scheduler
    try {
      const { stopMemoryRetention } = await import('./services/memory/retention.js');
      stopMemoryRetention();
    } catch (e) {
      log.warn('Memory retention stop error', { error: String(e) });
    }

    // 5.6d. Reset memory service
    try {
      const { resetMemoryService } = await import('./services/memory-service.js');
      resetMemoryService();
    } catch (e) {
      log.warn('Memory service reset error', { error: String(e) });
    }

    // 5.6e. Reset goal service
    try {
      const { resetGoalService } = await import('./services/goal-service.js');
      resetGoalService();
    } catch (e) {
      log.warn('Goal service reset error', { error: String(e) });
    }

    // 5.6f. Reset plan service
    try {
      const { resetPlanService } = await import('./services/plan-service.js');
      resetPlanService();
    } catch (e) {
      log.warn('Plan service reset error', { error: String(e) });
    }

    // 5.6g. Reset extension service
    try {
      const { resetExtensionService } = await import('./services/extension/service.js');
      resetExtensionService();
    } catch (e) {
      log.warn('Extension service reset error', { error: String(e) });
    }

    // 5.6h. Reset CLI tool service
    try {
      const { resetCliToolService } = await import('./services/cli/tool-service.js');
      resetCliToolService();
    } catch (e) {
      log.warn('CLI tool service reset error', { error: String(e) });
    }

    // 5.6i. Reset coding agent service singleton
    try {
      const { resetCodingAgentService } = await import('./services/coding-agent/service.js');
      resetCodingAgentService();
    } catch (e) {
      log.warn('Coding agent service reset error', { error: String(e) });
    }

    // 6. Cleanup webhook handler (if Telegram is in webhook mode)
    try {
      const { getWebhookHandler, unregisterWebhookHandler } =
        await import('./channels/plugins/telegram/webhook.js');
      if (getWebhookHandler()) {
        unregisterWebhookHandler();
      }
    } catch {
      /* webhook module not loaded */
    }

    // 6.1. Stop tunnel (cloudflared process)
    try {
      const { getTunnelService } = await import('./services/tunnel-service.js');
      await getTunnelService().stop();
    } catch {
      /* tunnel service not loaded */
    }

    // 7. Dispose session service (cleanup intervals)
    try {
      const { hasSessionService, getSessionService } = await import('@ownpilot/core');
      if (hasSessionService()) {
        const sessionSvc = getSessionService() as unknown as { dispose?: () => void };
        if (sessionSvc.dispose) sessionSvc.dispose();
      }
    } catch (e) {
      log.warn('Session service dispose error', { error: String(e) });
    }

    // 8. Reset all registered services via centralized cleanup module
    // (previously 13 individual try/catch blocks — now one call)
    try {
      const { shutdownAllServices } = await import('./services/shutdown-cleanup.js');
      await shutdownAllServices(log);
    } catch (e) {
      log.warn('Service shutdown error', { error: String(e) });
    }

    // 9. Close DB connection pool
    try {
      const { closeAdapter } = await import('./db/adapters/index.js');
      await closeAdapter();
    } catch (e) {
      log.warn('DB close error', { error: String(e) });
    }

    log.info('Cleanup complete, exiting.');

    // Force exit after 5s if something hangs
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // ── Global Error Handlers ─────────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Promise Rejection', {
      reason: String(reason),
      name: reason instanceof Error ? reason.name : undefined,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (error) => {
    // Print synchronously to stderr FIRST. The structured logger flushes
    // asynchronously, so an async logger write loses the message when the
    // process exits during the shutdown below — leaving an "Uncaught
    // Exception" crash with no visible cause. console.error is synchronous.

    console.error('\n=== UNCAUGHT EXCEPTION — shutting down ===\n', error);
    log.error('Uncaught Exception — shutting down', {
      error: error.message,
      name: error.name,
      stack: error.stack,
    });
    gracefulShutdown('uncaughtException').finally(() => process.exit(1));
  });
}

// Run server
main().catch((err) => {
  log.error('Fatal: server startup failed', {
    error: getErrorMessage(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
