/**
 * App settings — pure helper functions for reading/writing application
 * settings backed by `settingsRepo`. Extracted from `routes/settings.ts` so
 * non-route consumers (services, capabilities, runtimes) do not have to reach
 * back into the routes/ layer for these helpers.
 *
 * The route handlers in `routes/settings.ts` continue to live there and
 * import from this module. New service code MUST import from here, not from
 * `routes/settings.js`.
 *
 * Covers:
 *   - Provider API keys + default provider/model resolution
 *   - Coding-agent allowed working directories
 *   - Sandbox settings
 *   - Tool group enable/disable state
 */

import { sanitizeProviderName } from '../utils/common.js';
import { settingsRepo, localProvidersRepo } from '../db/repositories/index.js';
import {
  getDefaultModelForProvider,
  DEFAULT_SANDBOX_SETTINGS,
  type SandboxSettings,
  DEFAULT_ENABLED_GROUPS,
  type ResolvedAuth,
} from '@ownpilot/core';
import { getLog } from './log.js';

const settingsLog = getLog('AppSettings');

// ============================================
// Storage keys
// ============================================

export const API_KEY_PREFIX = 'api_key:';
/**
 * Per-provider auth blob storage key prefix. Holds the full {@link ResolvedAuth}
 * (method + token + optional refresh + expiry) for providers that authenticate
 * with anything other than a static API key — session_token (xAI Grok),
 * oauth2_device_code (Codex CLI), oauth2_pkce (browser sign-in). When this
 * key exists for a provider it overrides the legacy `api_key:<provider>` value.
 */
export const AUTH_PREFIX = 'provider_auth:';
export const DEFAULT_PROVIDER_KEY = 'default_ai_provider';
export const DEFAULT_MODEL_KEY = 'default_ai_model';
const ALLOWED_DIRS_KEY = 'coding_agents:allowed_dirs';
const SANDBOX_SETTINGS_PREFIX = 'sandbox:';
export const TOOL_GROUPS_KEY = 'tool_groups';

// ============================================
// Provider API keys
// ============================================

/** Check if a provider has an API key configured (database only). */
export async function hasApiKey(provider: string): Promise<boolean> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return await settingsRepo.has(key);
}

/** Get API key for a provider (database only). */
export async function getApiKey(provider: string): Promise<string | undefined> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return (await settingsRepo.get<string>(key)) ?? undefined;
}

/**
 * Get all configured provider IDs in one query (batch version of hasApiKey).
 * Returns a Set of provider IDs that have API keys configured.
 */
export async function getConfiguredProviderIds(): Promise<Set<string>> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  return new Set(apiKeySettings.map((s) => s.key.replace(API_KEY_PREFIX, '')));
}

/**
 * Load all API keys from database into process.env for provider SDKs.
 * Called at startup — allows SDKs that read from env to work.
 */
export async function loadApiKeysToEnvironment(): Promise<void> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);

  for (const setting of apiKeySettings) {
    const provider = setting.key.replace(API_KEY_PREFIX, '');
    const sanitizedProvider = sanitizeProviderName(provider);
    if (sanitizedProvider) {
      const envVarName = `${sanitizedProvider}_API_KEY`;
      process.env[envVarName] = setting.value as string;
    }
  }
}

/**
 * Get the source of an API key.
 * Returns 'database' if key exists, null otherwise.
 */
export async function getApiKeySource(provider: string): Promise<'database' | null> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return (await settingsRepo.has(key)) ? 'database' : null;
}

/**
 * Read the full {@link ResolvedAuth} for a provider, preferring the new
 * `provider_auth:<id>` blob (session_token / oauth) over the legacy
 * `api_key:<id>` string. Returns `undefined` when no credential is stored —
 * call sites should treat that the same way they treat a missing API key.
 *
 * Stored shape for the blob (JSON-encoded {@link ResolvedAuth}):
 * - `{ method: 'session_token', value, expiresAt? }`
 * - `{ method: 'oauth2_device_code' | 'oauth2_pkce', value, refreshToken?, expiresAt?, scopes? }`
 * - `{ method: 'api_key', value }` (only if a caller wrote it explicitly)
 */
export async function getResolvedAuth(provider: string): Promise<ResolvedAuth | undefined> {
  const blob = await settingsRepo.get<string>(`${AUTH_PREFIX}${provider}`);
  if (blob) {
    try {
      const parsed = JSON.parse(blob) as ResolvedAuth;
      if (parsed && typeof parsed.value === 'string' && parsed.value.length > 0) {
        return parsed;
      }
      settingsLog.warn(`Stored auth blob for ${provider} is malformed; falling back to API key`);
    } catch (e) {
      settingsLog.warn(
        `Failed to parse auth blob for ${provider}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const apiKey = await getApiKey(provider);
  if (!apiKey) return undefined;
  return { method: 'api_key', value: apiKey };
}

/**
 * Persist a {@link ResolvedAuth} blob for a provider. Used by OAuth callbacks
 * and the session-token paste flow. For API-key-only providers, prefer the
 * existing `setApiKey` path so legacy readers continue to work.
 */
export async function setResolvedAuth(provider: string, auth: ResolvedAuth): Promise<void> {
  await settingsRepo.set(`${AUTH_PREFIX}${provider}`, JSON.stringify(auth));
}

/** Delete the stored auth blob for a provider (does NOT touch the legacy API key). */
export async function deleteResolvedAuth(provider: string): Promise<void> {
  await settingsRepo.delete(`${AUTH_PREFIX}${provider}`);
}

/**
 * Per-provider OAuth app config stored at runtime. Lets users bring
 * their own OAuth app (their own client_id / scopes / endpoints) for
 * any provider that supports the device-code flow without us having
 * to commit fabricated client IDs into the static JSON catalog.
 *
 * Resolved order (see {@link getProviderOAuthConfig}):
 *   1. user override at `provider_oauth_config:<id>` (this key)
 *   2. static catalog entry (`ProviderConfig.auth.oauth`)
 *
 * The override stores the same shape as {@link ProviderOAuthConfig}
 * from `@ownpilot/core`.
 */
export const PROVIDER_OAUTH_CONFIG_PREFIX = 'provider_oauth_config:';

interface ProviderOAuthConfigOverride {
  deviceCodeUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
}

/**
 * Read the user-supplied OAuth app config override for a provider.
 * Returns `undefined` when no override exists — call sites should fall
 * back to the static catalog (the resolver in oauth-flow does this).
 */
export async function getProviderOAuthOverride(
  provider: string
): Promise<ProviderOAuthConfigOverride | undefined> {
  const blob = await settingsRepo.get<string>(`${PROVIDER_OAUTH_CONFIG_PREFIX}${provider}`);
  if (!blob) return undefined;
  try {
    const parsed = JSON.parse(blob) as ProviderOAuthConfigOverride;
    if (parsed && typeof parsed === 'object') return parsed;
    return undefined;
  } catch (e) {
    settingsLog.warn(
      `Stored OAuth override for ${provider} is malformed: ${e instanceof Error ? e.message : String(e)}`
    );
    return undefined;
  }
}

/**
 * Persist (or replace) the OAuth app config override for a provider.
 * Empty / undefined fields are stored verbatim — the merge in
 * getProviderOAuthConfig treats `null`/`undefined` as "fall back to
 * catalog for that one field", so callers can partially override (e.g.
 * just swap the clientId while keeping the catalog endpoints).
 */
export async function setProviderOAuthOverride(
  provider: string,
  config: ProviderOAuthConfigOverride
): Promise<void> {
  await settingsRepo.set(`${PROVIDER_OAUTH_CONFIG_PREFIX}${provider}`, JSON.stringify(config));
}

/** Remove the OAuth override for a provider (catalog config is unchanged). */
export async function deleteProviderOAuthOverride(provider: string): Promise<void> {
  await settingsRepo.delete(`${PROVIDER_OAUTH_CONFIG_PREFIX}${provider}`);
}

// ============================================
// Default provider / model
// ============================================

/**
 * Get the default AI provider (database only, no hardcoded fallback).
 * Returns null if no provider is configured.
 */
export async function getDefaultProvider(): Promise<string | null> {
  const savedProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  if (savedProvider) {
    const localProv = await localProvidersRepo.getProvider(savedProvider);
    if (localProv) {
      if (localProv.isEnabled) return savedProvider;
      // Local provider is disabled — fall through to fallbacks
    } else {
      // Remote provider — always respect the user's explicit choice.
      return savedProvider;
    }
  }

  const localDefault = await localProvidersRepo.getDefault('default');
  if (localDefault?.isEnabled) return localDefault.id;

  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  const firstSetting = apiKeySettings[0];
  if (firstSetting) {
    return firstSetting.key.replace(API_KEY_PREFIX, '');
  }

  return null;
}

/** Set the default AI provider. */
export async function setDefaultProvider(provider: string): Promise<void> {
  await settingsRepo.set(DEFAULT_PROVIDER_KEY, provider);
}

/**
 * Get the default model for a provider (database + config, no hardcoded fallback).
 * Returns null if no model can be determined.
 */
export async function getDefaultModel(provider?: string): Promise<string | null> {
  const savedModel = await settingsRepo.get<string>(DEFAULT_MODEL_KEY);
  if (savedModel) return savedModel;

  const actualProvider = provider ?? (await getDefaultProvider());
  if (!actualProvider) return null;

  const defaultModel = getDefaultModelForProvider(actualProvider);
  return defaultModel?.id ?? null;
}

/** Set the default AI model. */
export async function setDefaultModel(model: string): Promise<void> {
  await settingsRepo.set(DEFAULT_MODEL_KEY, model);
}

/**
 * Resolve "default" provider/model to actual values.
 * Returns null values if no defaults are configured.
 *
 * NOTE: Uses the global default provider, NOT the per-process model-routing
 * waterfall. For process-aware routing (chat, pulse, channel), use
 * `getLLMRouter().pick(...)` from `@ownpilot/core` instead.
 */
export async function resolveDefaultProviderAndModel(
  provider: string,
  model: string
): Promise<{ provider: string | null; model: string | null }> {
  const resolvedProvider = provider === 'default' ? await getDefaultProvider() : provider;
  const resolvedModel =
    model === 'default' ? await getDefaultModel(resolvedProvider ?? undefined) : model;
  return { provider: resolvedProvider, model: resolvedModel };
}

/** Check if demo mode (no providers configured). */
export async function isDemoModeFromSettings(): Promise<boolean> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  if (apiKeySettings.length > 0) return false;

  const localProviders = await localProvidersRepo.listProviders();
  if (localProviders.some((p) => p.isEnabled)) return false;

  return true;
}

// ============================================
// Coding Agents — Allowed Working Directories
// ============================================

/**
 * Get the list of directories that coding agents are allowed to work in.
 * Empty array means no restriction (any directory allowed).
 */
export async function getAllowedDirs(): Promise<string[]> {
  const saved = await settingsRepo.get<string>(ALLOWED_DIRS_KEY);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Set the list of allowed working directories for coding agents. */
export async function setAllowedDirs(dirs: string[]): Promise<void> {
  await settingsRepo.set(ALLOWED_DIRS_KEY, JSON.stringify(dirs));
}

// ============================================
// Sandbox settings
// ============================================

/** Get sandbox settings (merges defaults with saved overrides). */
export async function getSandboxSettings(): Promise<SandboxSettings> {
  const settings = { ...DEFAULT_SANDBOX_SETTINGS } as {
    [K in keyof SandboxSettings]: SandboxSettings[K];
  };

  const savedSettings = await settingsRepo.getByPrefix(SANDBOX_SETTINGS_PREFIX);
  for (const setting of savedSettings) {
    const key = setting.key.replace(SANDBOX_SETTINGS_PREFIX, '') as keyof SandboxSettings;
    if (key in settings) {
      const defaultValue = DEFAULT_SANDBOX_SETTINGS[key];
      if (Array.isArray(defaultValue)) {
        try {
          const parsed = JSON.parse(setting.value as string);
          if (Array.isArray(parsed)) {
            (settings[key] as unknown) = parsed;
          }
        } catch {
          // Keep default if JSON parse fails
        }
      } else if (typeof defaultValue === 'boolean') {
        (settings[key] as unknown) = setting.value === 'true' || setting.value === true;
      } else if (typeof defaultValue === 'number') {
        (settings[key] as unknown) = Number(setting.value);
      } else {
        (settings[key] as unknown) = setting.value;
      }
    }
  }

  return settings;
}

/** Set a single sandbox setting. */
export async function setSandboxSetting<K extends keyof SandboxSettings>(
  key: K,
  value: SandboxSettings[K]
): Promise<void> {
  const settingKey = `${SANDBOX_SETTINGS_PREFIX}${key}`;
  if (Array.isArray(value)) {
    await settingsRepo.set(settingKey, JSON.stringify(value));
  } else {
    await settingsRepo.set(settingKey, String(value));
  }
}

/** Check if sandbox is enabled. */
export async function isSandboxEnabled(): Promise<boolean> {
  const enabledSetting = await settingsRepo.get<string>(`${SANDBOX_SETTINGS_PREFIX}enabled`);
  return enabledSetting === 'true';
}

// ============================================
// Tool group settings
// ============================================

/** Get enabled tool group IDs (synchronous read from settings cache). */
export function getEnabledToolGroupIds(): string[] {
  return settingsRepo.get<string[]>(TOOL_GROUPS_KEY) ?? DEFAULT_ENABLED_GROUPS;
}
