/**
 * CLI Tools Discovery Service
 *
 * Discovers installed CLI tools from the catalog and custom providers.
 * Binary checks (where/which + --version) are expensive, so results
 * are cached per-user with a 5-minute TTL.
 */

import type { CliToolStatus, CliToolCategory, CliToolPolicy } from '@ownpilot/core';
import { CLI_TOOLS_CATALOG, CLI_TOOLS_BY_NAME } from './cli-tools-catalog.js';
import { cliToolPoliciesRepo } from '../db/repositories/cli-tool-policies.js';
import { cliProvidersRepo } from '../db/repositories/cli-providers.js';
import { isBinaryInstalled, getBinaryVersion } from './binary-utils.js';
import { getLog } from './log.js';

const log = getLog('CliToolDiscovery');

// =============================================================================
// CONSTANTS
// =============================================================================

/** Cache TTL: 5 minutes (binary install status doesn't change frequently) */
const CACHE_TTL_MS = 300_000;

// =============================================================================
// TYPES
// =============================================================================

interface CachedDiscovery {
  tools: CliToolStatus[];
  cachedAt: number;
}

// =============================================================================
// CACHE
// =============================================================================

const discoveryCache = new Map<string, CachedDiscovery>();

// =============================================================================
// DISCOVERY
// =============================================================================

/**
 * Discover all available CLI tools for a user.
 * Returns catalog tools + custom providers with install status and policies.
 */
export async function discoverTools(
  userId = 'default',
  forceRefresh = false
): Promise<CliToolStatus[]> {
  // Check cache
  const cached = discoveryCache.get(userId);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tools;
  }

  log.debug('Discovering CLI tools', { userId, forceRefresh });

  // Load user policies
  let policyMap = new Map<string, CliToolPolicy>();
  try {
    const policies = await cliToolPoliciesRepo.listPolicies(userId);
    policyMap = new Map(policies.map((p) => [p.toolName, p.policy]));
  } catch {
    // DB may not be ready — use catalog defaults
  }

  // Discover catalog tools
  const results: CliToolStatus[] = [];
  for (const entry of CLI_TOOLS_CATALOG) {
    const installed = isBinaryInstalled(entry.binaryName);
    const version = installed
      ? getBinaryVersion(entry.binaryName, entry.versionFlag)
      : undefined;
    const npxAvailable = !installed && !!entry.npxPackage && isBinaryInstalled('npx');

    results.push({
      name: entry.name,
      displayName: entry.displayName,
      category: entry.category,
      riskLevel: entry.riskLevel,
      installed,
      version,
      npxAvailable,
      policy: policyMap.get(entry.name) ?? entry.defaultPolicy,
      source: 'catalog',
    });
  }

  // Discover custom providers (from cli_providers table)
  try {
    const customProviders = await cliProvidersRepo.listActive(userId);
    for (const cp of customProviders) {
      // Skip if already in catalog (name collision)
      if (CLI_TOOLS_BY_NAME.has(cp.name)) continue;

      const toolName = `custom:${cp.name}`;
      const installed = isBinaryInstalled(cp.binary);

      results.push({
        name: toolName,
        displayName: cp.displayName,
        category: (cp.category as CliToolCategory) || 'utility',
        riskLevel: 'medium',
        installed,
        version: installed ? getBinaryVersion(cp.binary) : undefined,
        npxAvailable: false,
        policy: policyMap.get(toolName) ?? 'prompt',
        source: 'custom',
      });
    }
  } catch {
    // DB not ready — return only catalog tools
  }

  // Update cache
  discoveryCache.set(userId, { tools: results, cachedAt: Date.now() });
  log.debug(`Discovered ${results.length} CLI tools`, { userId });
  return results;
}

/**
 * Clear the discovery cache.
 * Call after installing/uninstalling tools or changing custom providers.
 */
export function clearDiscoveryCache(userId?: string): void {
  if (userId) {
    discoveryCache.delete(userId);
  } else {
    discoveryCache.clear();
  }
}
