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

import { settingsRepo } from '../db/repositories/index.js';
import { getDefaultProvider, getDefaultModel } from '../routes/settings.js';
import { getLog } from './log.js';

const log = getLog('ModelRouting');
const PREFIX = 'model_routing:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingProcess = 'chat' | 'telegram' | 'pulse';

export const VALID_PROCESSES: readonly RoutingProcess[] = ['chat', 'telegram', 'pulse'] as const;

export interface ProcessRouting {
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
}

export interface ResolvedRouting extends ProcessRouting {
  /** Where the primary provider/model came from */
  source: 'process' | 'global' | 'first-configured';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isValidProcess(p: string): p is RoutingProcess {
  return (VALID_PROCESSES as readonly string[]).includes(p);
}

function settingKey(process: RoutingProcess, field: string): string {
  return `${PREFIX}${process}:${field}`;
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
    telegram: getProcessRouting('telegram'),
    pulse: getProcessRouting('pulse'),
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
  const routing = getProcessRouting(process);

  let provider: string | null;
  let model: string | null;
  let source: ResolvedRouting['source'];

  if (routing.provider) {
    // Process-specific primary
    provider = routing.provider;
    model = routing.model ?? (await getDefaultModel(routing.provider));
    source = 'process';
  } else {
    // Waterfall to global default
    provider = await getDefaultProvider();
    model = routing.model ?? (await getDefaultModel(provider ?? undefined));
    source = provider ? 'global' : 'first-configured';
  }

  return {
    provider,
    model,
    fallbackProvider: routing.fallbackProvider,
    fallbackModel: routing.fallbackModel,
    source,
  };
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

/**
 * Clear all routing config for a process (reverts to global default).
 */
export async function clearProcessRouting(process: RoutingProcess): Promise<void> {
  await settingsRepo.deleteByPrefix(`${PREFIX}${process}:`);
  log.info(`Cleared routing for ${process}`);
}
