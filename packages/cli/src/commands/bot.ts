/**
 * Bot command - starts the Telegram bot
 *
 * All API keys and settings are loaded from the database.
 * Use --token flag to override the database setting (for testing).
 */

import { createSimpleAgent } from '@ownpilot/core';
import { createTelegramBot, type TelegramConfig } from '@ownpilot/channels';
import {
  getDatabase,
  loadApiKeysToEnvironment,
  getDefaultProvider,
  getApiKey,
  getDefaultModel,
  isDemoModeFromSettings,
  settingsRepo,
} from '@ownpilot/gateway';

interface BotOptions {
  token?: string;
  webhook?: string;
  users?: string;
  chats?: string;
}

// Settings key for Telegram bot token
const TELEGRAM_TOKEN_KEY = 'telegram_bot_token';

export async function startBot(options: BotOptions): Promise<void> {
  // Initialize database first
  getDatabase();

  // Load saved API keys from database into environment (for SDKs)
  loadApiKeysToEnvironment();

  // Get Telegram token from options or database
  const token = options.token ?? settingsRepo.get<string>(TELEGRAM_TOKEN_KEY);

  if (!token) {
    console.error('❌ Error: Telegram bot token is required');
    console.error('   Configure a Telegram channel via the web UI, or use --token flag');
    process.exit(1);
  }

  // Get provider from database
  const provider = getDefaultProvider();

  if (!provider) {
    console.error('❌ Error: No AI provider API key configured');
    console.error('   Configure an API key via the web UI settings');
    process.exit(1);
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    console.error(`❌ Error: API key for ${provider} not found`);
    process.exit(1);
  }

  const model = getDefaultModel(provider);

  // Validate provider is supported by createSimpleAgent
  const supportedProviders = ['openai', 'anthropic'] as const;
  type SupportedProvider = typeof supportedProviders[number];

  if (!supportedProviders.includes(provider as SupportedProvider)) {
    console.error(`❌ Error: Provider "${provider}" is not supported for CLI bot`);
    console.error(`   Supported providers: ${supportedProviders.join(', ')}`);
    console.error('   For other providers, use the gateway server and configure via web UI');
    process.exit(1);
  }

  // Create agent with database-configured settings
  const agent = createSimpleAgent(provider as SupportedProvider, apiKey, {
    name: 'Telegram Bot',
    model: model ?? undefined,
    systemPrompt: 'You are a helpful AI assistant on Telegram. Be concise and friendly.',
  });

  // Parse allowed users/chats from CLI options
  const allowedUserIds = options.users?.split(',').map(Number).filter(Boolean);
  const allowedChatIds = options.chats?.split(',').map(Number).filter(Boolean);

  // Create bot config
  const config: TelegramConfig = {
    type: 'telegram',
    enabled: true,
    botToken: token,
    allowedUserIds: allowedUserIds,
    allowedChatIds: allowedChatIds,
    parseMode: 'HTML',
  };

  const bot = createTelegramBot(config);

  // Set up message handler
  bot.onMessage(async (message) => {
    console.log(`📨 [${message.username ?? message.userId}]: ${message.text}`);

    const result = await agent.chat(message.text);

    if (result.ok) {
      console.log(`🤖 Response: ${result.value.content.substring(0, 100)}...`);
      await bot.sendMessage({
        chatId: message.chatId,
        text: result.value.content,
        replyToMessageId: message.id,
      });
    } else {
      console.error(`❌ Error: ${result.error.message}`);
      await bot.sendMessage({
        chatId: message.chatId,
        text: `Sorry, I encountered an error: ${result.error.message}`,
        replyToMessageId: message.id,
      });
    }
  });

  console.log('\n🤖 Starting Telegram Bot...\n');
  console.log(`   Provider:      ${provider}`);
  console.log(`   Model:         ${model ?? 'default'}`);
  console.log(`   Allowed Users: ${config.allowedUserIds?.join(', ') || 'all'}`);
  console.log(`   Allowed Chats: ${config.allowedChatIds?.join(', ') || 'all'}`);
  console.log('');

  // Start bot
  if (options.webhook) {
    await bot.setWebhook(options.webhook);
    console.log(`✅ Webhook set to: ${options.webhook}`);
  } else {
    await bot.start();
    console.log('✅ Bot started with long polling');
  }

  console.log('');
  console.log('Press Ctrl+C to stop');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Stopping bot...');
    await bot.stop();
    process.exit(0);
  });
}
