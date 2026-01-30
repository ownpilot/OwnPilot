/**
 * Config Services Seed Data
 *
 * Pre-populates config services that are actively used by built-in tools,
 * media services, or channel adapters.
 *
 * Each service declares a `configSchema` — an array of typed field definitions
 * that drive the dynamic UI forms and runtime resolution (DB value → env var fallback).
 *
 * Services with no existing implementation are intentionally omitted —
 * they will be auto-registered on demand when a custom tool or plugin
 * declares them via `requiredServices`.
 */

import { configServicesRepo } from '../repositories/config-services.js';
import type { CreateConfigServiceInput } from '../repositories/config-services.js';
import type { ConfigFieldDefinition } from '@ownpilot/core';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Standard schema for services that only need an API key and optional base URL.
 */
function apiKeySchema(envVar: string, defaultBaseUrl?: string): ConfigFieldDefinition[] {
  const fields: ConfigFieldDefinition[] = [
    {
      name: 'api_key',
      label: 'API Key',
      type: 'secret',
      required: true,
      envVar,
      order: 0,
    },
  ];
  if (defaultBaseUrl) {
    fields.push({
      name: 'base_url',
      label: 'Base URL',
      type: 'url',
      required: false,
      defaultValue: defaultBaseUrl,
      placeholder: defaultBaseUrl,
      order: 1,
    });
  }
  return fields;
}

// =============================================================================
// KNOWN SERVICES
// =============================================================================

export const KNOWN_CONFIG_SERVICES: CreateConfigServiceInput[] = [
  // ---------------------------------------------------------------------------
  // Weather
  // ---------------------------------------------------------------------------
  {
    name: 'openweathermap',
    displayName: 'OpenWeatherMap',
    category: 'weather',
    description: 'Weather data provider with current conditions and forecasts.',
    docsUrl: 'https://openweathermap.org/api',
    configSchema: apiKeySchema('OPENWEATHERMAP_API_KEY', 'https://api.openweathermap.org/data/2.5'),
  },
  {
    name: 'weatherapi',
    displayName: 'WeatherAPI',
    category: 'weather',
    description: 'Alternative weather data provider with forecasts and astronomy data.',
    docsUrl: 'https://www.weatherapi.com/docs/',
    configSchema: apiKeySchema('WEATHERAPI_KEY', 'https://api.weatherapi.com/v1'),
  },

  // ---------------------------------------------------------------------------
  // Email (multi-entry: multiple accounts)
  // ---------------------------------------------------------------------------
  {
    name: 'smtp',
    displayName: 'SMTP Email (Send)',
    category: 'email',
    description: 'Send emails via SMTP. Configure host, port, user, and password.',
    docsUrl: 'https://nodemailer.com/smtp/',
    multiEntry: true,
    configSchema: [
      { name: 'host', label: 'SMTP Host', type: 'string', required: true, placeholder: 'smtp.gmail.com', order: 0 },
      { name: 'port', label: 'Port', type: 'number', required: true, defaultValue: 587, order: 1 },
      { name: 'secure', label: 'Use TLS/SSL', type: 'boolean', defaultValue: false, description: 'Enable TLS (port 465) or STARTTLS (port 587)', order: 2 },
      { name: 'user', label: 'Username / Email', type: 'string', required: true, placeholder: 'you@gmail.com', order: 3 },
      { name: 'password', label: 'Password / App Password', type: 'secret', required: true, description: 'For Gmail, use an App Password', order: 4 },
      { name: 'from_name', label: 'From Name', type: 'string', required: false, placeholder: 'My Assistant', order: 5 },
    ],
  },
  {
    name: 'imap',
    displayName: 'IMAP Email (Read)',
    category: 'email',
    description: 'Read emails via IMAP. Configure host, port, user, and password.',
    multiEntry: true,
    configSchema: [
      { name: 'host', label: 'IMAP Host', type: 'string', required: true, placeholder: 'imap.gmail.com', order: 0 },
      { name: 'port', label: 'Port', type: 'number', required: true, defaultValue: 993, order: 1 },
      { name: 'secure', label: 'Use TLS', type: 'boolean', defaultValue: true, order: 2 },
      { name: 'user', label: 'Username / Email', type: 'string', required: true, placeholder: 'you@gmail.com', order: 3 },
      { name: 'password', label: 'Password / App Password', type: 'secret', required: true, description: 'For Gmail, use an App Password', order: 4 },
      { name: 'mailbox', label: 'Mailbox', type: 'string', defaultValue: 'INBOX', placeholder: 'INBOX', order: 5 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Media (TTS / STT)
  // ---------------------------------------------------------------------------
  {
    name: 'elevenlabs',
    displayName: 'ElevenLabs',
    category: 'media',
    description: 'Text-to-speech with natural, expressive voices.',
    docsUrl: 'https://elevenlabs.io/docs',
    configSchema: [
      { name: 'api_key', label: 'API Key', type: 'secret', required: true, envVar: 'ELEVENLABS_API_KEY', order: 0 },
      { name: 'base_url', label: 'Base URL', type: 'url', defaultValue: 'https://api.elevenlabs.io/v1', placeholder: 'https://api.elevenlabs.io/v1', order: 1 },
      { name: 'voice_id', label: 'Default Voice ID', type: 'string', required: false, placeholder: 'e.g. 21m00Tcm4TlvDq8ikWAM', description: 'Default voice for TTS requests', order: 2 },
      { name: 'model_id', label: 'Model', type: 'select', required: false, defaultValue: 'eleven_multilingual_v2', options: [
        { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
        { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
        { value: 'eleven_monolingual_v1', label: 'Monolingual v1' },
      ], order: 3 },
    ],
  },
  {
    name: 'deepgram',
    displayName: 'Deepgram',
    category: 'media',
    description: 'Speech-to-text transcription with high accuracy.',
    docsUrl: 'https://developers.deepgram.com/',
    configSchema: [
      { name: 'api_key', label: 'API Key', type: 'secret', required: true, envVar: 'DEEPGRAM_API_KEY', order: 0 },
      { name: 'base_url', label: 'Base URL', type: 'url', defaultValue: 'https://api.deepgram.com/v1', placeholder: 'https://api.deepgram.com/v1', order: 1 },
      { name: 'model', label: 'Default Model', type: 'select', required: false, defaultValue: 'nova-2', options: [
        { value: 'nova-2', label: 'Nova 2 (Best)' },
        { value: 'nova', label: 'Nova' },
        { value: 'enhanced', label: 'Enhanced' },
        { value: 'base', label: 'Base' },
      ], order: 2 },
      { name: 'language', label: 'Default Language', type: 'string', required: false, defaultValue: 'en', placeholder: 'en', order: 3 },
    ],
  },
  // ---------------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------------
  {
    name: 'deepl',
    displayName: 'DeepL',
    category: 'translation',
    description: 'High-quality machine translation API.',
    docsUrl: 'https://www.deepl.com/docs-api',
    configSchema: [
      { name: 'api_key', label: 'Auth Key', type: 'secret', required: true, envVar: 'DEEPL_API_KEY', order: 0 },
      { name: 'base_url', label: 'Base URL', type: 'url', defaultValue: 'https://api-free.deepl.com/v2', placeholder: 'https://api-free.deepl.com/v2', description: 'Use api-free.deepl.com for free plan, api.deepl.com for pro', order: 1 },
      { name: 'plan', label: 'Plan', type: 'select', defaultValue: 'free', options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ], order: 2 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  {
    name: 'tavily',
    displayName: 'Tavily',
    category: 'search',
    description: 'AI-optimized search API for RAG applications.',
    docsUrl: 'https://docs.tavily.com/',
    configSchema: [
      { name: 'api_key', label: 'API Key', type: 'secret', required: true, envVar: 'TAVILY_API_KEY', order: 0 },
      { name: 'search_depth', label: 'Default Search Depth', type: 'select', defaultValue: 'basic', options: [
        { value: 'basic', label: 'Basic (faster)' },
        { value: 'advanced', label: 'Advanced (better)' },
      ], order: 1 },
    ],
  },
  {
    name: 'serper',
    displayName: 'Serper',
    category: 'search',
    description: 'Google Search API for real-time search results.',
    docsUrl: 'https://serper.dev/docs',
    configSchema: apiKeySchema('SERPER_API_KEY'),
  },
  {
    name: 'perplexity',
    displayName: 'Perplexity',
    category: 'search',
    description: 'Search-augmented AI models.',
    docsUrl: 'https://docs.perplexity.ai/',
    configSchema: apiKeySchema('PERPLEXITY_API_KEY', 'https://api.perplexity.ai'),
  },

  // ---------------------------------------------------------------------------
  // Messaging (channel adapters)
  // ---------------------------------------------------------------------------
  {
    name: 'telegram',
    displayName: 'Telegram Bot',
    category: 'messaging',
    description: 'Telegram Bot API for messaging integration.',
    docsUrl: 'https://core.telegram.org/bots/api',
    configSchema: [
      { name: 'bot_token', label: 'Bot Token', type: 'secret', required: true, envVar: 'TELEGRAM_BOT_TOKEN', order: 0 },
      { name: 'base_url', label: 'API Base URL', type: 'url', defaultValue: 'https://api.telegram.org', placeholder: 'https://api.telegram.org', order: 1 },
    ],
  },
  {
    name: 'discord',
    displayName: 'Discord Bot',
    category: 'messaging',
    description: 'Discord bot for messaging integration.',
    docsUrl: 'https://discord.com/developers/docs',
    configSchema: [
      { name: 'bot_token', label: 'Bot Token', type: 'secret', required: true, envVar: 'DISCORD_BOT_TOKEN', order: 0 },
      { name: 'application_id', label: 'Application ID', type: 'string', required: false, placeholder: 'e.g. 123456789', description: 'Required for slash commands', order: 1 },
      { name: 'base_url', label: 'API Base URL', type: 'url', defaultValue: 'https://discord.com/api/v10', placeholder: 'https://discord.com/api/v10', order: 2 },
    ],
  },
  {
    name: 'slack',
    displayName: 'Slack Bot',
    category: 'messaging',
    description: 'Slack bot for workspace messaging.',
    docsUrl: 'https://api.slack.com/docs',
    configSchema: [
      { name: 'bot_token', label: 'Bot Token', type: 'secret', required: true, envVar: 'SLACK_BOT_TOKEN', description: 'xoxb-... token', order: 0 },
      { name: 'signing_secret', label: 'Signing Secret', type: 'secret', required: false, envVar: 'SLACK_SIGNING_SECRET', description: 'For verifying webhook requests', order: 1 },
      { name: 'app_token', label: 'App-Level Token', type: 'secret', required: false, envVar: 'SLACK_APP_TOKEN', description: 'xapp-... token for Socket Mode', order: 2 },
      { name: 'base_url', label: 'API Base URL', type: 'url', defaultValue: 'https://slack.com/api', placeholder: 'https://slack.com/api', order: 3 },
    ],
  },
];

// =============================================================================
// SEED FUNCTION
// =============================================================================

/**
 * Seed known config services into the database.
 * Uses idempotent upsert — metadata and schema are always refreshed
 * but user-set config entry values are never overwritten.
 */
export async function seedConfigServices(): Promise<number> {
  let seeded = 0;
  for (const service of KNOWN_CONFIG_SERVICES) {
    try {
      await configServicesRepo.upsert(service);
      seeded++;
    } catch (error) {
      console.error(`[Seed] Failed to seed config service '${service.name}':`, error);
    }
  }
  console.log(`[Seed] Seeded ${seeded} config services`);

  // Clean up stale services that are no longer in the seed and have no dependents
  const knownNames = new Set(KNOWN_CONFIG_SERVICES.map(s => s.name));
  const allServices = configServicesRepo.list();
  let removed = 0;
  for (const service of allServices) {
    if (!knownNames.has(service.name) && (!service.requiredBy || service.requiredBy.length === 0)) {
      try {
        await configServicesRepo.delete(service.name);
        removed++;
      } catch (error) {
        console.error(`[Seed] Failed to remove stale service '${service.name}':`, error);
      }
    }
  }
  if (removed > 0) {
    console.log(`[Seed] Removed ${removed} stale config services`);
  }

  return seeded;
}
