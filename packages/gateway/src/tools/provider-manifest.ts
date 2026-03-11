/**
 * Gateway Tool Provider Manifest
 *
 * Declarative registry of all gateway tool providers.
 * Each entry maps a provider name to its factory function.
 * Used by registerAllGatewayProviders() to register them in bulk.
 */

import type { ToolProvider } from '@ownpilot/core';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
  createConfigToolProvider,
  createHeartbeatToolProvider,
  createExtensionToolProvider,
  createCodingAgentToolProvider,
  createCliToolProvider,
  createBackgroundAgentToolProvider,
  createBrowserToolProvider,
  createEdgeToolProvider,
  createSkillToolProvider,
} from '../services/tool-providers/index.js';

export interface ProviderEntry {
  /** Human-readable name for logging */
  name: string;
  /** Factory that creates the ToolProvider. Always receives userId. */
  factory: (userId: string) => ToolProvider;
}

/**
 * All synchronous gateway tool providers.
 * Order is preserved but not significant — all providers are registered in one pass.
 *
 * Note: Async registrations (plugins, custom tools, extensions) are handled separately
 * in tool-executor.ts because they have different lifecycle requirements.
 */
export const GATEWAY_PROVIDER_MANIFEST: ProviderEntry[] = [
  { name: 'memory', factory: createMemoryToolProvider },
  { name: 'goal', factory: createGoalToolProvider },
  { name: 'custom-data', factory: (_uid) => createCustomDataToolProvider() },
  { name: 'personal-data', factory: (_uid) => createPersonalDataToolProvider() },
  { name: 'trigger', factory: (_uid) => createTriggerToolProvider() },
  { name: 'plan', factory: (_uid) => createPlanToolProvider() },
  { name: 'config', factory: (_uid) => createConfigToolProvider() },
  { name: 'heartbeat', factory: createHeartbeatToolProvider },
  { name: 'extension', factory: createExtensionToolProvider },
  { name: 'coding-agent', factory: createCodingAgentToolProvider },
  { name: 'cli-tools', factory: createCliToolProvider },
  { name: 'background-agent', factory: createBackgroundAgentToolProvider },
  { name: 'browser', factory: createBrowserToolProvider },
  { name: 'edge', factory: createEdgeToolProvider },
  { name: 'skill', factory: createSkillToolProvider },
];

/**
 * Register all gateway tool providers from the manifest into a ToolRegistry.
 */
export function registerAllGatewayProviders(
  registry: { registerProvider: (provider: ToolProvider) => void },
  userId: string
): void {
  for (const entry of GATEWAY_PROVIDER_MANIFEST) {
    registry.registerProvider(entry.factory(userId));
  }
}
