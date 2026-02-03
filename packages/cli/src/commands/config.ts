/**
 * Config command - manage API keys and settings in the database
 *
 * All settings are stored in SQLite database.
 * No encrypted credential store - everything is in the database.
 */

import { createInterface } from 'node:readline';
import {
  initializeAdapter,
  settingsRepo,
  getDatabasePath,
} from '@ownpilot/gateway';

// Database key prefixes
const API_KEY_PREFIX = 'api_key:';

// Valid provider names for API keys
const VALID_PROVIDERS = [
  'openai',
  'anthropic',
  'zhipu',
  'deepseek',
  'groq',
  'together',
  'mistral',
  'fireworks',
  'perplexity',
] as const;

type Provider = (typeof VALID_PROVIDERS)[number];

// Other settings keys
const OTHER_KEYS = [
  'default_ai_provider',
  'default_ai_model',
  'telegram_bot_token',
  // Gateway authentication settings
  'gateway_api_keys',
  'gateway_jwt_secret',
  'gateway_auth_type',
  // Rate limiting settings
  'gateway_rate_limit_max',
  'gateway_rate_limit_window_ms',
] as const;

type OtherKey = (typeof OTHER_KEYS)[number];

interface ConfigSetOptions {
  key: string;
  value?: string;
}

interface ConfigGetOptions {
  key: string;
}

interface ConfigDeleteOptions {
  key: string;
}

/**
 * Read a line from stdin
 */
async function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Sensitive keys that should be masked
const SENSITIVE_KEYS = ['gateway_api_keys', 'gateway_jwt_secret', 'telegram_bot_token'] as const;

/**
 * Parse key to database key
 */
function parseKey(key: string): { dbKey: string; isApiKey: boolean; isSensitive: boolean } {
  // Check if it's an API key format (e.g., openai-api-key)
  const apiKeyMatch = key.match(/^(\w+)-api-key$/);
  if (apiKeyMatch) {
    const provider = apiKeyMatch[1];
    if (VALID_PROVIDERS.includes(provider as Provider)) {
      return { dbKey: `${API_KEY_PREFIX}${provider}`, isApiKey: true, isSensitive: true };
    }
  }

  // Direct key (e.g., default_ai_provider)
  if (OTHER_KEYS.includes(key as OtherKey)) {
    const isSensitive = SENSITIVE_KEYS.includes(key as typeof SENSITIVE_KEYS[number]);
    return { dbKey: key, isApiKey: false, isSensitive };
  }

  // Unknown key
  return { dbKey: key, isApiKey: false, isSensitive: false };
}

/**
 * Set a configuration value
 */
export async function configSet(options: ConfigSetOptions): Promise<void> {
  const { key, value } = options;

  // Initialize database
  await initializeAdapter();

  const { dbKey, isApiKey } = parseKey(key);

  // Get value if not provided
  let configValue = value;
  if (!configValue) {
    configValue = await readLine(`Enter ${key}: `);
  }

  if (!configValue?.trim()) {
    console.error('Value cannot be empty');
    process.exit(1);
  }

  // Store in database
  await settingsRepo.set(dbKey, configValue.trim());

  // For API keys, also set in environment for immediate use
  if (isApiKey) {
    const provider = dbKey.replace(API_KEY_PREFIX, '');
    const envVarName = `${provider.toUpperCase()}_API_KEY`;
    process.env[envVarName] = configValue.trim();
  }

  console.log(`✅ Saved "${key}"`);
}

/**
 * Get a configuration value (masked for secrets)
 */
export async function configGet(options: ConfigGetOptions): Promise<void> {
  const { key } = options;

  // Initialize database
  await initializeAdapter();

  const { dbKey, isSensitive } = parseKey(key);
  const value = await settingsRepo.get<string>(dbKey);

  if (value) {
    // Mask sensitive values
    if (isSensitive) {
      const masked = value.length > 12
        ? value.substring(0, 8) + '...' + value.substring(value.length - 4)
        : '********';
      console.log(`${key}: ${masked}`);
    } else {
      console.log(`${key}: ${value}`);
    }
  } else {
    console.log(`${key}: (not set)`);
  }
}

/**
 * Delete a configuration value
 */
export async function configDelete(options: ConfigDeleteOptions): Promise<void> {
  const { key } = options;

  // Initialize database
  await initializeAdapter();

  const { dbKey, isApiKey } = parseKey(key);

  if (await settingsRepo.has(dbKey)) {
    await settingsRepo.delete(dbKey);

    // For API keys, also remove from environment
    if (isApiKey) {
      const provider = dbKey.replace(API_KEY_PREFIX, '');
      const envVarName = `${provider.toUpperCase()}_API_KEY`;
      delete process.env[envVarName];
    }

    console.log(`✅ Deleted "${key}"`);
  } else {
    console.log(`"${key}" was not set`);
  }
}

/**
 * List all configuration values
 */
export async function configList(): Promise<void> {
  // Initialize database
  await initializeAdapter();

  console.log('\n🔐 Configuration (stored in database):\n');

  // List API keys
  console.log('API Keys:');
  for (const provider of VALID_PROVIDERS) {
    const dbKey = `${API_KEY_PREFIX}${provider}`;
    const hasKey = await settingsRepo.has(dbKey);
    const status = hasKey ? '✅ Set' : '⬜ Not set';
    console.log(`   ${provider}-api-key: ${status}`);
  }

  // Group settings by category
  const aiSettings = ['default_ai_provider', 'default_ai_model'] as const;
  const channelSettings = ['telegram_bot_token'] as const;
  const gatewaySettings = ['gateway_api_keys', 'gateway_jwt_secret', 'gateway_auth_type', 'gateway_rate_limit_max', 'gateway_rate_limit_window_ms'] as const;

  // List AI settings
  console.log('\nAI Settings:');
  for (const key of aiSettings) {
    const value = await settingsRepo.get<string>(key);
    console.log(`   ${key}: ${value ?? '(not set)'}`);
  }

  // List channel settings
  console.log('\nChannel Settings:');
  for (const key of channelSettings) {
    const value = await settingsRepo.get<string>(key);
    if (value) {
      const masked = value.length > 12
        ? value.substring(0, 8) + '...' + value.substring(value.length - 4)
        : '********';
      console.log(`   ${key}: ${masked}`);
    } else {
      console.log(`   ${key}: (not set)`);
    }
  }

  // List gateway settings
  console.log('\nGateway Settings:');
  for (const key of gatewaySettings) {
    const value = await settingsRepo.get<string>(key);
    if (value) {
      // Mask sensitive values
      if (key.includes('secret') || key === 'gateway_api_keys') {
        const masked = value.length > 12
          ? value.substring(0, 8) + '...' + value.substring(value.length - 4)
          : '********';
        console.log(`   ${key}: ${masked}`);
      } else {
        console.log(`   ${key}: ${value}`);
      }
    } else {
      console.log(`   ${key}: (not set)`);
    }
  }

  console.log(`\n📁 Database location: ${getDatabasePath()}`);
  console.log('💡 Use "ownpilot config set <key>" to configure');
  console.log('');
}

/**
 * Initial setup - no longer uses encrypted store
 * Just initializes the database
 */
export async function setup(): Promise<void> {
  // Initialize PostgreSQL database
  await initializeAdapter();

  console.log('\n✅ PostgreSQL database initialized!');
  console.log(`   Location: ${getDatabasePath()}`);
  console.log('\nNext steps:');
  console.log('   ownpilot config set openai-api-key     # Add your OpenAI key');
  console.log('   ownpilot config set anthropic-api-key  # Add your Anthropic key');
  console.log('   ownpilot start                         # Start the gateway');
  console.log('');
  console.log('💡 Or configure via the web UI at http://localhost:8080/settings');
  console.log('');
}

/**
 * Change password - deprecated (no longer uses encrypted store)
 */
export async function configChangePassword(): Promise<void> {
  console.log('\n⚠️  Password-based encryption has been removed.');
  console.log('   All settings are now stored in the PostgreSQL database.');
  console.log('   Use database access controls to protect the data.');
  console.log('');
}

/**
 * Load credentials to env - for backward compatibility
 */
export async function loadCredentialsToEnv(): Promise<void> {
  // Initialize database
  await initializeAdapter();

  // Load all API keys from database to environment
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);

  for (const setting of apiKeySettings) {
    const provider = setting.key.replace(API_KEY_PREFIX, '');
    const envVarName = `${provider.toUpperCase()}_API_KEY`;
    process.env[envVarName] = setting.value as string;
  }
}
