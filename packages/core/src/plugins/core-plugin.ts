/**
 * CorePlugin
 *
 * Packages all built-in tools (modular ALL_TOOLS + legacy CORE_TOOLS)
 * into a single plugin entity visible in the PluginRegistry.
 *
 * This plugin has `category: 'core'` — the tool executor bridge uses this
 * to register its tools with `source: 'core'` and `trustLevel: 'trusted'`
 * instead of the default 'semi-trusted' used for third-party plugins.
 */

import { createPlugin } from './index.js';
import { ALL_TOOLS } from '../agent/tools/index.js';
import { CORE_TOOLS, CORE_EXECUTORS } from '../agent/tools.js';
import type { PluginManifest, Plugin } from './index.js';

/**
 * Build the CorePlugin manifest + implementation.
 *
 * Returns the shape expected by `PluginRegistry.register()`.
 */
export function buildCorePlugin(): { manifest: PluginManifest; implementation: Partial<Plugin> } {
  const builder = createPlugin()
    .id('core')
    .name('OwnPilot Core')
    .version('1.0.0')
    .description('Built-in core tools: file system, code execution, web fetch, data processing, utilities, and more.')
    .meta({
      category: 'core',
      capabilities: ['tools'],
      permissions: [],
    });

  // Register all modular tools (file system, code exec, web fetch, PDF, translation, etc.)
  builder.tools(ALL_TOOLS);

  // Register legacy core tools (get_current_time, calculate, generate_uuid, file ops, etc.)
  for (const def of CORE_TOOLS) {
    const executor = CORE_EXECUTORS[def.name];
    if (executor) {
      builder.tool(def, executor);
    }
  }

  return builder.build();
}
