/**
 * Bot command - starts the Telegram bot
 *
 * All API keys and settings are loaded from the database.
 * Use --token flag to override the database setting (for testing).
 */

import { createSimpleAgent } from '@ownpilot/core/agent';
import { createTelegramBot, type TelegramConfig } from '../telegram/index.js';
import {
  loadApiKeysToEnvironment,
  getDefaultProvider,
  getApiKey,
  getDefaultModel,
} from '@ownpilot/gateway/config';
import { settingsRepo } from '@ownpilot/gateway/db';
import { replaceShutdownSignalHandlers } from './shutdown-signals.js';

interface BotOptions {
  token?: string;
  webhook?: string;
  users?: string;
  chats?: string;
}

// Settings key for Telegram bot token
const TELEGRAM_TOKEN_KEY = 'telegram_bot_token';

export async function startBot(options: BotOptions): Promise<void> {
  // Load saved API keys from database into environment (for SDKs)
  await loadApiKeysToEnvironment();

  // Get Telegram token from options or database
  const token = options.token ?? (await settingsRepo.get<string>(TELEGRAM_TOKEN_KEY));

  if (!token) {
    console.error('❌ Error: Telegram bot token is required');
    console.error('   Configure a Telegram channel via the web UI, or use --token flag');
    process.exit(1);
  }

  // Get provider from database
  const provider = await getDefaultProvider();

  if (!provider) {
    console.error('❌ Error: No AI provider API key configured');
    console.error('   Configure an API key via the web UI settings');
    process.exit(1);
  }

  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    console.error(`❌ Error: API key for ${provider} not found`);
    process.exit(1);
  }

  const model = await getDefaultModel(provider);

  // Validate provider is supported by createSimpleAgent
  const supportedProviders = ['openai', 'anthropic'] as const;
  type SupportedProvider = (typeof supportedProviders)[number];

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

  // Parse allowed users/chats from CLI options. Surface a loud warning when
  // the operator passed a value that parsed to nothing — the bot will
  // refuse all messages (fail-closed, see TelegramBot.isUserAllowed), which
  // would otherwise look like a silent outage.
  const parseAllowList = (raw: string | undefined, flagName: string): number[] | undefined => {
    if (raw === undefined) return undefined;
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) {
      console.error(
        `⚠️  --${flagName} was provided but parsed to no valid numeric IDs — ` +
          'the bot will refuse all messages. Pass comma-separated integer IDs.'
      );
    }
    return ids;
  };
  const allowedUserIds = parseAllowList(options.users, 'users');
  const allowedChatIds = parseAllowList(options.chats, 'chats');

  // Create bot config. parseMode is intentionally left undefined (plain text)
  // so LLM-generated content containing `<`, `&`, or arbitrary tag-like
  // substrings does not trigger Telegram's 'can't parse entities' 400 and
  // does not provide an HTML-injection sink for prompt-injection payloads.
  const config: TelegramConfig = {
    type: 'telegram',
    enabled: true,
    botToken: token,
    allowedUserIds: allowedUserIds,
    allowedChatIds: allowedChatIds,
  };

  const bot = createTelegramBot(config);

  // Set up message handler
  bot.onMessage(async (message) => {
    try {
      console.log(`📨 [${message.username ?? message.userId}]: ${message.text}`);

      const result = await agent.chat(message.text);

      if (result.ok) {
        const content = result.value.content || '(No response)';
        console.log(`🤖 Response: ${content.substring(0, 100)}...`);
        await bot.sendMessage({
          chatId: message.chatId,
          text: content,
          replyToMessageId: message.id,
        });
      } else {
        // Log full error detail server-side; reply with a generic apology so
        // provider SDK error strings (which can include request URLs, file
        // paths, model names, or truncated bearer tokens) do not leak to
        // the chat user.
        console.error(`❌ Error: ${result.error.message}`);
        try {
          await bot.sendMessage({
            chatId: message.chatId,
            text: 'Sorry, I encountered an error processing your request.',
            replyToMessageId: message.id,
          });
        } catch (sendErr) {
          console.error(
            'Failed to send error message:',
            sendErr instanceof Error ? sendErr.message : sendErr
          );
        }
      }
    } catch (err) {
      console.error('Failed to process message:', err instanceof Error ? err.message : err);
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
    let webhookUrl: URL;
    try {
      webhookUrl = new URL(options.webhook);
    } catch {
      console.error(`❌ Invalid webhook URL: ${options.webhook}`);
      process.exit(1);
    }

    // HTTPS-only — Telegram's setWebhook requires it. Plain http would
    // expose the bot token (Telegram appends X-Telegram-Bot-Api-Secret-Token
    // since 2021, but the path/query can still leak otherwise).
    if (webhookUrl.protocol !== 'https:') {
      console.error('❌ Webhook URL must use HTTPS');
      process.exit(1);
    }

    // Reject embedded credentials. `https://user:pass@example.com/...`
    // would be sent to Telegram, which then surfaces them in dashboard
    // diagnostics and in every update POST — a credential-leak sink.
    if (webhookUrl.username || webhookUrl.password) {
      console.error('❌ Webhook URL must not embed credentials (user:pass@host)');
      process.exit(1);
    }

    // Warn loudly on private/loopback hostnames — Telegram cannot reach
    // them, so this is almost certainly a misconfiguration. We refuse
    // (not just warn) because silently calling setWebhook with such a
    // URL still mutates Telegram's webhook state and may break long
    // polling without producing any working delivery channel.
    const host = webhookUrl.hostname.toLowerCase();
    const PRIVATE_HOST_RE =
      /^(localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[0-1])(\.\d+){2}|169\.254(\.\d+){2}|::1|fc[0-9a-f]{2}:|fe80::)/i;
    if (PRIVATE_HOST_RE.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
      console.error(
        `❌ Webhook host "${host}" looks private/internal; Telegram cannot reach it.\n` +
          '   Use a public HTTPS URL (e.g. a Cloudflare tunnel or ngrok endpoint).'
      );
      process.exit(1);
    }

    try {
      await bot.setWebhook(options.webhook);
      // Only log origin + path — never the query string, which is
      // commonly used to carry a secret token.
      console.log(`✅ Webhook set to: ${webhookUrl.origin}${webhookUrl.pathname}`);
    } catch (err) {
      console.error('❌ Failed to set webhook:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    await bot.start();
    console.log('✅ Bot started with long polling');
  }

  console.log('');
  console.log('Press Ctrl+C to stop');

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\n\n🛑 Stopping bot...');
    await bot.stop();
    process.exit(0);
  };
  replaceShutdownSignalHandlers('bot', shutdown);
}
