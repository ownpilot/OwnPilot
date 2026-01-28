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
  getApiKey,
  getDefaultModel,
  isDemoModeFromSettings,
  channelManager,
  initializeChannelFactories,
} from '@ownpilot/gateway';
import { createSimpleAgent } from '@ownpilot/core';
import { createTelegramBot, type TelegramConfig } from '@ownpilot/channels';

interface StartOptions {
  port: string;
  bot?: boolean;
}

export async function startAll(options: StartOptions): Promise<void> {
  console.log('\n🚀 Starting OwnPilot...\n');

  // Initialize PostgreSQL database first
  await initializeAdapter();

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
  const serverConfig: Partial<GatewayConfig> = {
    port,
    host: '0.0.0.0',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['*'],
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

  // Initialize channel factories (loads channels from database)
  await initializeChannelFactories();

  // The Telegram bot functionality is now handled by the channel manager
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

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    process.exit(0);
  });
}
