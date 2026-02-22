/**
 * GatewayPlugin
 *
 * Packages all gateway-specific tool providers (memory, goals, custom data,
 * personal data, triggers, plans) into a single plugin entity visible in
 * the PluginRegistry.
 *
 * Like CorePlugin, this has `category: 'core'` — its tools get registered
 * with `source: 'core'` and `trustLevel: 'trusted'`.
 */

import { createPlugin } from '@ownpilot/core';
import type { PluginManifest, Plugin } from '@ownpilot/core';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
} from '../services/tool-providers/index.js';

/**
 * Build the GatewayPlugin manifest + implementation.
 *
 * @param userId - User ID for user-scoped tool providers (memory, goals).
 */
export function buildGatewayPlugin(userId = 'default'): {
  manifest: PluginManifest;
  implementation: Partial<Plugin>;
} {
  const builder = createPlugin()
    .id('gateway')
    .name('OwnPilot Gateway')
    .version('1.0.0')
    .description(
      'Gateway service tools: memory, goals, custom data, personal data, triggers, and plans.'
    )
    .meta({
      category: 'core',
      capabilities: ['tools'],
      permissions: [],
    });

  // Collect tools from all gateway providers
  const providers = [
    createMemoryToolProvider(userId),
    createGoalToolProvider(userId),
    createCustomDataToolProvider(),
    createPersonalDataToolProvider(),
    createTriggerToolProvider(),
    createPlanToolProvider(),
  ];

  for (const provider of providers) {
    builder.tools(provider.getTools());
  }

  return builder.build();
}
