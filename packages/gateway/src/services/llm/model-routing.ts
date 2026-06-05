/**
 * Model Routing Service
 *
 * Per-process model routing with fallback support.
 * Stores config in the settings table using 'model_routing:' prefix keys.
 *
 * Resolution waterfall per process:
 *   1. Process-specific config (model_routing:{process}:provider)
 *   2. Global default (default_ai_provider / default_ai_model)
 *   3. First configured provider (existing fallback in getDefaultProvider)
 */

import { pricingByExactKey } from '@ownpilot/core';
import { settingsRepo } from '../../db/repositories/index.js';
import { getDefaultProvider, getDefaultModel } from '../app-settings.js';
import { getLog } from '../log.js';

const log = getLog('ModelRouting');
const PREFIX = 'model_routing:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingProcess = 'chat' | 'channel' | 'channel_media' | 'pulse';

export const VALID_PROCESSES: readonly RoutingProcess[] = [
  'chat',
  'channel',
  'channel_media',
  'pulse',
] as const;

interface ProcessRouting {
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
}

interface ResolvedRouting extends ProcessRouting {
  /** Where the primary provider/model came from */
  source: 'process' | 'channel' | 'global' | 'first-configured';
}

export type ChannelRoutingKind = 'default' | 'media';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isValidProcess(p: string): p is RoutingProcess {
  return (VALID_PROCESSES as readonly string[]).includes(p);
}

function settingKey(process: RoutingProcess, field: string): string {
  return `${PREFIX}${process}:${field}`;
}

function channelScope(pluginId: string, kind: ChannelRoutingKind = 'default'): string {
  return kind === 'media' ? `channel_plugin_media:${pluginId}` : `channel_plugin:${pluginId}`;
}

function scopedSettingKey(scope: string, field: string): string {
  return `${PREFIX}${scope}:${field}`;
}

function hasConfiguredValue(routing: ProcessRouting): boolean {
  return Boolean(
    routing.provider || routing.model || routing.fallbackProvider || routing.fallbackModel
  );
}

function mergeRouting(override: ProcessRouting, base: ProcessRouting): ProcessRouting {
  return {
    provider: override.provider ?? base.provider,
    model: override.model ?? base.model,
    fallbackProvider: override.fallbackProvider ?? base.fallbackProvider,
    fallbackModel: override.fallbackModel ?? base.fallbackModel,
  };
}

// ---------------------------------------------------------------------------
// Getters (sync — cache-backed)
// ---------------------------------------------------------------------------

/**
 * Read the raw routing config for a process from settings cache.
 * Returns nulls for any field that is not explicitly configured.
 */
export function getProcessRouting(process: RoutingProcess): ProcessRouting {
  return {
    provider: settingsRepo.get<string>(settingKey(process, 'provider')),
    model: settingsRepo.get<string>(settingKey(process, 'model')),
    fallbackProvider: settingsRepo.get<string>(settingKey(process, 'fallback_provider')),
    fallbackModel: settingsRepo.get<string>(settingKey(process, 'fallback_model')),
  };
}

/**
 * Read routing configs for all processes.
 */
export function getAllRouting(): Record<RoutingProcess, ProcessRouting> {
  return {
    chat: getProcessRouting('chat'),
    channel: getProcessRouting('channel'),
    channel_media: getProcessRouting('channel_media'),
    pulse: getProcessRouting('pulse'),
  };
}

export function getChannelScopedRouting(
  pluginId: string,
  kind: ChannelRoutingKind = 'default'
): ProcessRouting {
  const scope = channelScope(pluginId, kind);
  return {
    provider: settingsRepo.get<string>(scopedSettingKey(scope, 'provider')),
    model: settingsRepo.get<string>(scopedSettingKey(scope, 'model')),
    fallbackProvider: settingsRepo.get<string>(scopedSettingKey(scope, 'fallback_provider')),
    fallbackModel: settingsRepo.get<string>(scopedSettingKey(scope, 'fallback_model')),
  };
}

/**
 * Backward-compatible: read 'channel' config, falling back to legacy 'telegram' keys.
 * This lets existing users' model_routing:telegram:* settings keep working.
 */
export function getChannelRouting(): ProcessRouting {
  const channel = getProcessRouting('channel');

  // If any channel key is configured, use channel config entirely
  if (channel.provider || channel.model || channel.fallbackProvider || channel.fallbackModel) {
    return channel;
  }

  // Fallback: read legacy 'telegram' keys
  const PREFIX_LEGACY = `${PREFIX}telegram:`;
  return {
    provider: settingsRepo.get<string>(`${PREFIX_LEGACY}provider`),
    model: settingsRepo.get<string>(`${PREFIX_LEGACY}model`),
    fallbackProvider: settingsRepo.get<string>(`${PREFIX_LEGACY}fallback_provider`),
    fallbackModel: settingsRepo.get<string>(`${PREFIX_LEGACY}fallback_model`),
  };
}

async function finalizeResolved(
  routing: ProcessRouting,
  source: ResolvedRouting['source']
): Promise<ResolvedRouting> {
  let provider: string | null = routing.provider;
  let model: string | null = routing.model;
  let resolvedSource = source;

  if (provider) {
    model = model ?? (await getDefaultModel(provider));
  } else {
    provider = await getDefaultProvider();
    model = routing.model ?? (await getDefaultModel(provider ?? undefined));
    resolvedSource = provider ? 'global' : 'first-configured';
  }

  return {
    provider,
    model,
    fallbackProvider: routing.fallbackProvider,
    fallbackModel: routing.fallbackModel,
    source: resolvedSource,
  };
}

// ---------------------------------------------------------------------------
// Resolution (async — may need DB for global defaults)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective provider/model for a process.
 *
 * Waterfall:
 *   1. Process-specific provider → source='process'
 *   2. Global default provider → source='global'
 *   3. First configured provider → source='first-configured'
 */
export async function resolveForProcess(process: RoutingProcess): Promise<ResolvedRouting> {
  const routing = process === 'channel' ? getChannelRouting() : getProcessRouting(process);
  return finalizeResolved(routing, 'process');
}

export async function resolveForChannel(
  pluginId: string,
  options?: { hasMedia?: boolean }
): Promise<ResolvedRouting> {
  const baseChannel = getChannelRouting();
  const pluginDefault = getChannelScopedRouting(pluginId, 'default');

  if (options?.hasMedia) {
    const processMedia = getProcessRouting('channel_media');
    const pluginMedia = getChannelScopedRouting(pluginId, 'media');

    if (hasConfiguredValue(pluginMedia)) {
      return finalizeResolved(
        mergeRouting(pluginMedia, hasConfiguredValue(pluginDefault) ? pluginDefault : processMedia),
        'channel'
      );
    }

    if (hasConfiguredValue(pluginDefault)) {
      return finalizeResolved(
        mergeRouting(pluginDefault, hasConfiguredValue(processMedia) ? processMedia : baseChannel),
        'channel'
      );
    }

    if (hasConfiguredValue(processMedia)) {
      return finalizeResolved(mergeRouting(processMedia, baseChannel), 'process');
    }
  }

  if (hasConfiguredValue(pluginDefault)) {
    return finalizeResolved(mergeRouting(pluginDefault, baseChannel), 'channel');
  }

  return resolveForProcess('channel');
}

/**
 * Infer the provider that owns a bare model name.
 *
 * Channel users can override the model via commands like Telegram's `/model gpt-4o`,
 * which carry only a model name with no provider. We resolve the owning provider from
 * the pricing catalog so the override targets a real provider:model pair (and so cost
 * attribution records the right provider).
 *
 * Resolution order:
 *   1. If `preferredProvider` is supplied and it owns `model`, keep it — this avoids
 *      cross-provider drift when the routed provider already serves the model.
 *   2. Otherwise scan the catalog for an exact modelId match and return that provider.
 *   3. Return null when the model is unknown — callers fall back to their routed provider.
 */
export function inferProviderForModel(
  model: string,
  preferredProvider?: string | null
): string | null {
  if (!model) return null;
  if (preferredProvider && pricingByExactKey.has(`${preferredProvider}:${model}`)) {
    return preferredProvider;
  }
  for (const pricing of pricingByExactKey.values()) {
    if (pricing.modelId === model) return pricing.provider;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Setters (async — writes to DB + cache)
// ---------------------------------------------------------------------------

const FIELD_MAP: Record<keyof ProcessRouting, string> = {
  provider: 'provider',
  model: 'model',
  fallbackProvider: 'fallback_provider',
  fallbackModel: 'fallback_model',
};

/**
 * Update routing config for a process.
 * Pass null or empty string to clear a specific field.
 */
export async function setProcessRouting(
  process: RoutingProcess,
  routing: Partial<ProcessRouting>
): Promise<void> {
  for (const [field, dbField] of Object.entries(FIELD_MAP)) {
    const value = routing[field as keyof ProcessRouting];
    if (value !== undefined) {
      const k = settingKey(process, dbField);
      if (value === null || value === '') {
        await settingsRepo.delete(k);
      } else {
        await settingsRepo.set(k, value);
      }
    }
  }

  log.info(`Updated routing for ${process}: ${JSON.stringify(routing)}`);
}

export async function setChannelScopedRouting(
  pluginId: string,
  routing: Partial<ProcessRouting>,
  kind: ChannelRoutingKind = 'default'
): Promise<void> {
  const scope = channelScope(pluginId, kind);
  for (const [field, dbField] of Object.entries(FIELD_MAP)) {
    const value = routing[field as keyof ProcessRouting];
    if (value !== undefined) {
      const key = scopedSettingKey(scope, dbField);
      if (value === null || value === '') {
        await settingsRepo.delete(key);
      } else {
        await settingsRepo.set(key, value);
      }
    }
  }

  log.info(`Updated routing for ${scope}: ${JSON.stringify(routing)}`);
}

/**
 * Clear all routing config for a process (reverts to global default).
 */
export async function clearProcessRouting(process: RoutingProcess): Promise<void> {
  await settingsRepo.deleteByPrefix(`${PREFIX}${process}:`);
  log.info(`Cleared routing for ${process}`);
}

export async function clearChannelScopedRouting(
  pluginId: string,
  kind: ChannelRoutingKind = 'default'
): Promise<void> {
  await settingsRepo.deleteByPrefix(`${PREFIX}${channelScope(pluginId, kind)}:`);
  log.info(`Cleared routing for ${channelScope(pluginId, kind)}`);
}
