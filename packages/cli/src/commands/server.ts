/**
 * Server command - starts the HTTP API server
 *
 * All settings are loaded from the database.
 */

import { serve } from '@hono/node-server';
import {
  createApp,
  type GatewayConfig,
  initializeScheduler,
  initializeAdapter,
  loadApiKeysToEnvironment,
  settingsRepo,
  initializePlugins,
} from '@ownpilot/gateway';

// Database settings keys for gateway config
const GATEWAY_API_KEYS_KEY = 'gateway_api_keys';
const GATEWAY_JWT_SECRET_KEY = 'gateway_jwt_secret';
const GATEWAY_RATE_LIMIT_MAX_KEY = 'gateway_rate_limit_max';
const GATEWAY_RATE_LIMIT_WINDOW_KEY = 'gateway_rate_limit_window_ms';

interface ServerOptions {
  port: string;
  host: string;
  auth?: boolean;
  rateLimit?: boolean;
}

export async function startServer(options: ServerOptions): Promise<void> {
  // Initialize PostgreSQL database first
  await initializeAdapter();

  // Load saved API keys from database into environment (for SDKs)
  await loadApiKeysToEnvironment();

  const port = parseInt(options.port, 10);
  const host = options.host;

  const config: Partial<GatewayConfig> = {
    port,
    host,
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['*'],
  };

  // Configure auth from database
  if (options.auth !== false) {
    // Check database first, then fall back to ENV for backward compatibility
    const dbApiKeys = await settingsRepo.get<string>(GATEWAY_API_KEYS_KEY);
    const dbJwtSecret = await settingsRepo.get<string>(GATEWAY_JWT_SECRET_KEY);

    const apiKeys = dbApiKeys?.split(',').filter(Boolean) ?? process.env.API_KEYS?.split(',').filter(Boolean);
    const jwtSecret = dbJwtSecret ?? process.env.JWT_SECRET;

    if (apiKeys && apiKeys.length > 0) {
      config.auth = { type: 'api-key', apiKeys };
    } else if (jwtSecret) {
      config.auth = { type: 'jwt', jwtSecret };
    } else {
      config.auth = { type: 'none' };
    }
  } else {
    config.auth = { type: 'none' };
  }

  // Configure rate limiting from database
  if (options.rateLimit !== false) {
    const dbRateLimitMax = await settingsRepo.get<number>(GATEWAY_RATE_LIMIT_MAX_KEY);
    const dbRateLimitWindow = await settingsRepo.get<number>(GATEWAY_RATE_LIMIT_WINDOW_KEY);

    config.rateLimit = {
      windowMs: dbRateLimitWindow ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
      maxRequests: dbRateLimitMax ?? parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    };
  }

  const app = createApp(config);

  // Initialize plugins
  try {
    await initializePlugins();
    console.log('✅ Plugins initialized');
  } catch (err) {
    console.warn('⚠️  Plugin initialization failed:', err instanceof Error ? err.message : err);
  }

  // Initialize scheduler
  try {
    await initializeScheduler();
    console.log('✅ Scheduler initialized');
  } catch (err) {
    console.warn('⚠️  Scheduler initialization failed:', err instanceof Error ? err.message : err);
  }

  console.log('\n🚀 Starting OwnPilot Server...\n');
  console.log(`   Port:       ${port}`);
  console.log(`   Host:       ${host}`);
  console.log(`   Auth:       ${config.auth?.type ?? 'none'}`);
  console.log(`   Rate Limit: ${config.rateLimit ? `${config.rateLimit.maxRequests} req/min` : 'disabled'}`);
  console.log('');

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info: { address: string; port: number }) => {
      console.log(`✅ Server running at http://${info.address}:${info.port}`);
      console.log('');
      console.log('📚 API Endpoints:');
      console.log(`   Health:  http://${info.address}:${info.port}/health`);
      console.log(`   Agents:  http://${info.address}:${info.port}/api/v1/agents`);
      console.log(`   Chat:    http://${info.address}:${info.port}/api/v1/chat`);
      console.log(`   Tools:   http://${info.address}:${info.port}/api/v1/tools`);
      console.log('');
      console.log('💡 Configure settings via the web UI at http://localhost:' + port + '/settings');
      console.log('Press Ctrl+C to stop');
    }
  );
}
