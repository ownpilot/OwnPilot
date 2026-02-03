/**
 * Gateway Config Center Implementation
 *
 * Implements the ConfigCenter interface from core,
 * backed by the config_services PostgreSQL tables with in-memory cache.
 */

import type {
  ConfigCenter,
  ApiServiceConfig,
  ConfigServiceDefinition,
  ConfigEntry,
} from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';

// =============================================================================
// HELPER
// =============================================================================

/**
 * Build a legacy ApiServiceConfig shape from a service definition
 * by reading its default config entry.
 */
function toLegacyServiceConfig(svc: ConfigServiceDefinition): ApiServiceConfig {
  const defaultEntry = configServicesRepo.getDefaultEntry(svc.name);
  const data = (defaultEntry?.data ?? {}) as Record<string, unknown>;
  const { api_key, base_url, ...extraConfig } = data;

  return {
    name: svc.name,
    displayName: svc.displayName,
    category: svc.category,
    description: svc.description,
    apiKey: (api_key as string) ?? configServicesRepo.getApiKey(svc.name),
    baseUrl: (base_url as string) ?? undefined,
    extraConfig: extraConfig as Record<string, unknown>,
    isActive: svc.isActive,
  };
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Gateway implementation of ConfigCenter backed by config_services DB tables.
 */
export class GatewayConfigCenter implements ConfigCenter {
  // ---------------------------------------------------------------------------
  // Backward-compatible methods
  // ---------------------------------------------------------------------------

  getApiKey(serviceName: string): string | undefined {
    const key = configServicesRepo.getApiKey(serviceName);

    // Runtime auto-detection: if service doesn't exist at all, register it (fire-and-forget)
    if (!configServicesRepo.getByName(serviceName)) {
      configServicesRepo
        .upsert({
          name: serviceName,
          displayName: serviceName,
          category: 'general',
          description: 'Auto-discovered service',
        })
        .catch(() => {
          /* ignore - best effort */
        });
    }

    return key;
  }

  getServiceConfig(serviceName: string): ApiServiceConfig | null {
    const svc = configServicesRepo.getByName(serviceName);
    if (!svc) return null;
    return toLegacyServiceConfig(svc);
  }

  isServiceAvailable(serviceName: string): boolean {
    return configServicesRepo.isAvailable(serviceName);
  }

  listServices(category?: string): ApiServiceConfig[] {
    return configServicesRepo.list(category).map(toLegacyServiceConfig);
  }

  // ---------------------------------------------------------------------------
  // New config entry methods
  // ---------------------------------------------------------------------------

  getConfigEntry(serviceName: string, entryLabel?: string): ConfigEntry | null {
    if (entryLabel) {
      return configServicesRepo.getEntryByLabel(serviceName, entryLabel);
    }
    return configServicesRepo.getDefaultEntry(serviceName);
  }

  getConfigEntries(serviceName: string): ConfigEntry[] {
    return configServicesRepo.getEntries(serviceName);
  }

  getFieldValue(serviceName: string, fieldName: string, entryLabel?: string): unknown {
    return configServicesRepo.getFieldValue(serviceName, fieldName, entryLabel);
  }

  getServiceDefinition(serviceName: string): ConfigServiceDefinition | null {
    return configServicesRepo.getByName(serviceName);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

/** Singleton instance */
export const gatewayConfigCenter = new GatewayConfigCenter();

