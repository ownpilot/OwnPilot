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
    config({ path: envPath });
    console.log(`[Config] Loaded .env from: ${envPath}`);
    break;
  }
}

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import type { GatewayConfig } from './types/index.js';
import { wsGateway } from './ws/index.js';
import { initializeChannelFactories } from './channels/index.js';
import { initializeAdapter } from './db/adapters/index.js';
import { loadApiKeysToEnvironment } from './routes/settings.js';
import { initializeFileWorkspace } from './workspace/index.js';
import { settingsRepo, initializeSettingsRepo } from './db/repositories/settings.js';
import { initializeDataDirectories, getDataDirectoryInfo } from './paths/index.js';
import { autoMigrateIfNeeded } from './paths/migration.js';
import { initializePlugins } from './plugins/index.js';
import { initializeConfigServicesRepo } from './db/repositories/config-services.js';
import { initializePluginsRepo } from './db/repositories/plugins.js';
import { seedConfigServices } from './db/seeds/config-services-seed.js';
import { gatewayConfigCenter } from './services/config-center-impl.js';

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

  // Auth type from database or ENV
  const authType = (dbAuthType ?? process.env.AUTH_TYPE ?? 'none') as 'none' | 'api-key' | 'jwt';

  // API keys and JWT secret from database or ENV
  const apiKeys = dbApiKeys?.split(',').filter(Boolean) ?? process.env.API_KEYS?.split(',');
  const jwtSecret = dbJwtSecret ?? process.env.JWT_SECRET;

  // Rate limit settings from database or ENV
  const dbRateLimitWindow = settingsRepo.get<number>(GATEWAY_RATE_LIMIT_WINDOW_KEY);
  const dbRateLimitMax = settingsRepo.get<number>(GATEWAY_RATE_LIMIT_MAX_KEY);

  const rateLimitWindowMs = dbRateLimitWindow ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
  const rateLimitMax = dbRateLimitMax ?? parseInt(process.env.RATE_LIMIT_MAX ?? '1000', 10);

  return {
    port: parseInt(process.env.PORT ?? '8080', 10),
    host: process.env.HOST ?? '0.0.0.0',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['*'],
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
  // Log PostgreSQL configuration
  console.log(`[Config] Database: PostgreSQL`);
  console.log(`[Config] POSTGRES_HOST=${process.env.POSTGRES_HOST || 'localhost'}`);
  console.log(`[Config] POSTGRES_PORT=${process.env.POSTGRES_PORT || '5432'}`);
  console.log(`[Config] POSTGRES_DB=${process.env.POSTGRES_DB || 'ownpilot'}`);

  // Initialize data directories (creates platform-specific directories)
  const dataPaths = initializeDataDirectories();
  const dataInfo = getDataDirectoryInfo();

  console.log(`Data directory: ${dataInfo.root}`);

  // Auto-migrate legacy data if needed
  autoMigrateIfNeeded();

  // Initialize PostgreSQL database adapter (REQUIRED)
  console.log('[Startup] Initializing PostgreSQL database...');
  try {
    const dbAdapter = await initializeAdapter();
    console.log(`[Startup] PostgreSQL connected: ${dbAdapter.isConnected()}`);
  } catch (error) {
    console.error('[Startup] PostgreSQL connection failed:', error);
    console.error('[Startup] Make sure PostgreSQL is running and configured correctly.');
    console.error('[Startup] Start PostgreSQL with: docker compose -f docker-compose.db.yml up -d');
    process.exit(1);
  }

  // Initialize settings repository (creates table and loads cache)
  console.log('[Startup] Initializing settings...');
  await initializeSettingsRepo();

  // Load saved API keys from database into environment
  loadApiKeysToEnvironment();

  // Initialize Config Center (centralized config management)
  console.log('[Startup] Initializing Config Center...');
  await initializeConfigServicesRepo();
  await seedConfigServices();

  // Initialize Plugins repository
  console.log('[Startup] Initializing Plugins repository...');
  await initializePluginsRepo();

  // Initialize file workspace directories (for AI-generated code isolation)
  const workspace = initializeFileWorkspace();

  const config = loadConfig();
  const app = createApp(config);

  const port = config.port ?? 3000;
  const host = config.host ?? '0.0.0.0';

  // Initialize channel adapters
  console.log('[Startup] Initializing channel factories...');
  await initializeChannelFactories();
  console.log('[Startup] Channel factories initialized.');

  // Initialize plugins (registers built-in plugins)
  console.log('[Startup] Initializing plugins...');
  await initializePlugins();
  console.log('[Startup] Plugins initialized.');

  console.log(`Starting OwnPilot...`);
  console.log(`  Port: ${port}`);
  console.log(`  Host: ${host}`);
  console.log(`  Auth: ${config.auth?.type ?? 'none'}`);
  console.log(`  Rate limit: ${config.rateLimit ? `${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms` : 'disabled'}`);
  console.log(`  Workspace: ${workspace.workspaceDir}`);
  console.log(`  Settings: Stored in PostgreSQL database`);

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    console.log(`\nServer running at http://${info.address}:${info.port}`);
    console.log(`API documentation: http://${info.address}:${info.port}/api/v1`);
    console.log(`Health check: http://${info.address}:${info.port}/health`);
    console.log(`Settings UI: http://${info.address}:${info.port}/settings`);
  });

  // Attach WebSocket gateway to HTTP server
  wsGateway.attachToServer(server as Server);
  console.log(`WebSocket Gateway attached at ws://${host}:${port}/ws`);
}

// Run server
main().catch(console.error);
