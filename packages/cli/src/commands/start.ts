/**
 * Start command - starts both server and bot
 *
 * All API keys and settings are loaded from the database.
 * No environment variables are used for provider configuration.
 */

import { serve } from '@hono/node-server';
import {
  createApp,
  type GatewayConfig,
  initializeAdapter,
  loadApiKeysToEnvironment,
  getDefaultProvider,
  isDemoModeFromSettings,
} from '@ownpilot/gateway';

interface StartOptions {
  port: string;
  bot?: boolean;
}

export async function startAll(options: StartOptions): Promise<void> {
  console.log('\n🚀 Starting OwnPilot...\n');

  // Initialize PostgreSQL database first
  try {
    await initializeAdapter();
  } catch (err) {
    console.error('❌ Database initialization failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Load saved API keys from database into environment (for SDKs)
  await loadApiKeysToEnvironment();

  // Check provider configuration from database
  const provider = await getDefaultProvider();
  const isDemoMode = await isDemoModeFromSettings();

  if (isDemoMode) {
    console.warn('⚠️  Warning: No AI provider API key configured');
    console.warn('   Configure an API key via the web UI at http://localhost:' + options.port + '/settings');
    console.warn('');
  } else {
    console.log(`✅ Default provider: ${provider}`);
  }

  // Start HTTP server
  const port = parseInt(options.port, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`❌ Invalid port: ${options.port}`);
    process.exit(1);
  }
  const serverConfig: Partial<GatewayConfig> = {
    port,
    host: '0.0.0.0',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    auth: { type: 'none' },
  };

  // API keys for gateway authentication (not provider API keys)
  const apiKeys = process.env.API_KEYS?.split(',').filter(Boolean);
  if (apiKeys && apiKeys.length > 0) {
    serverConfig.auth = { type: 'api-key', apiKeys };
  }

  const app = createApp(serverConfig);

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: '0.0.0.0',
    },
    (info: { address: string; port: number }) => {
      console.log(`✅ HTTP Server running at http://${info.address}:${info.port}`);
    }
  );

  // Channel plugins are initialized by PluginRegistry automatically
  // Channels are loaded from the database automatically
  // No need for manual bot setup here

  console.log('');
  console.log('📚 Endpoints:');
  console.log(`   API:      http://localhost:${port}/api/v1`);
  console.log(`   Health:   http://localhost:${port}/health`);
  console.log(`   Settings: http://localhost:${port}/settings`);
  console.log('');
  console.log('💡 Configure API keys and channels via the web UI');
  console.log('Press Ctrl+C to stop');

  // Handle shutdown signals
  const shutdown = () => {
    console.log('\n\n🛑 Shutting down...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
