/**
 * Shared Tool Executor Service
 *
 * Provides a reusable tool execution capability for triggers, plans,
 * and any other system that needs to run tools outside of a chat session.
 * Creates and caches a ToolRegistry with ALL tools registered:
 *   - Core tools (file system, code exec, web fetch, etc.)
 *   - Gateway providers (memory, goals, custom data, etc.)
 *   - Plugin tools (weather, expense, etc.)
 *   - Custom tools (user/LLM-created, sandboxed)
 *
 * All tools go through the same ToolRegistry with middleware support.
 */

import {
  ToolRegistry,
  registerAllTools,
  registerCoreTools,
  createPluginSecurityMiddleware,
  createPluginId,
} from '@ownpilot/core';
import type { ToolDefinition } from '@ownpilot/core';
import { gatewayConfigCenter as gatewayApiKeyCenter } from './config-center-impl.js';
import { getDefaultPluginRegistry } from '../plugins/index.js';
import { registerToolConfigRequirements } from './api-service-registrar.js';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
} from './tool-providers/index.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import {
  getCustomToolDynamicRegistry,
  setSharedRegistryForCustomTools,
} from '../routes/custom-tools.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Shared ToolRegistry
// ============================================================================

let sharedRegistry: ToolRegistry | null = null;

/**
 * Get or create a shared ToolRegistry with ALL tools registered.
 * This is the single registry used by routes, triggers, plans, agents, etc.
 *
 * Tool sources registered:
 * 1. Core tools (source: 'core')
 * 2. Gateway providers (source: 'gateway')
 * 3. Plugin tools (source: 'plugin') — brought in from PluginRegistry
 * 4. Custom tools are registered on-demand via registerCustomTool()
 */
export function getSharedToolRegistry(userId = 'default'): ToolRegistry {
  if (sharedRegistry) return sharedRegistry;

  const tools = new ToolRegistry();

  // Wire config auto-registration handler
  tools.setConfigRegistrationHandler(registerToolConfigRequirements);

  // Security middleware for plugin/custom tools (rate limiting, arg validation, output sanitization)
  tools.use(createPluginSecurityMiddleware());

  // Register all modular tools (file system, code exec, web fetch, etc.)
  registerAllTools(tools);

  // Register legacy core tools (get_current_time, calculate, etc.)
  // Duplicates are safely ignored by ToolRegistry
  registerCoreTools(tools);

  tools.setApiKeyCenter(gatewayApiKeyCenter);

  // Register gateway tool providers (source: 'gateway')
  tools.registerProvider(createMemoryToolProvider(userId));
  tools.registerProvider(createGoalToolProvider(userId));
  tools.registerProvider(createCustomDataToolProvider());
  tools.registerProvider(createPersonalDataToolProvider());
  tools.registerProvider(createTriggerToolProvider());
  tools.registerProvider(createPlanToolProvider());

  // Register plugin tools into the shared registry (source: 'plugin')
  initPluginToolsIntoRegistry(tools);

  // Sync active custom tools from DB into the shared registry (source: 'custom')
  syncCustomToolsIntoRegistry(tools, userId);

  // Wire the shared registry reference so custom-tools CRUD operations keep it in sync
  setSharedRegistryForCustomTools(tools);

  sharedRegistry = tools;
  return tools;
}

/**
 * Bring plugin tools into the shared ToolRegistry.
 * Also listens for plugin enable/disable events to add/remove tools dynamically.
 */
function initPluginToolsIntoRegistry(registry: ToolRegistry): void {
  // getDefaultPluginRegistry() is async — fire-and-forget registration
  getDefaultPluginRegistry()
    .then((pluginRegistry) => {
      // Register tools from all currently enabled plugins
      for (const plugin of pluginRegistry.getEnabled()) {
        if (plugin.tools.size > 0) {
          registry.registerPluginTools(createPluginId(plugin.manifest.id), plugin.tools);
        }
      }

      // Listen for future plugin state changes
      pluginRegistry.onEvent('plugin.status', (data: unknown) => {
        const event = data as { pluginId: string; newStatus: string };
        const pluginId = createPluginId(event.pluginId);
        if (event.newStatus === 'enabled') {
          const plugin = pluginRegistry.get(event.pluginId);
          if (plugin && plugin.tools.size > 0) {
            registry.registerPluginTools(createPluginId(plugin.manifest.id), plugin.tools);
          }
        } else if (event.newStatus === 'disabled') {
          registry.unregisterPluginTools(pluginId);
        }
      });
    })
    .catch(() => {
      // Plugin registry not initialized yet — plugins will register later
    });
}

/**
 * Sync active custom tools from DB into the shared ToolRegistry.
 * Each custom tool gets a sandboxed executor that delegates to the DynamicToolRegistry.
 * Fire-and-forget — runs async so getSharedToolRegistry() stays synchronous.
 */
function syncCustomToolsIntoRegistry(registry: ToolRegistry, userId: string): void {
  const repo = createCustomToolsRepo(userId);

  repo.getActiveTools()
    .then((tools) => {
      const dynamicRegistry = getCustomToolDynamicRegistry();

      for (const tool of tools) {
        // Ensure the tool is also registered in the dynamic registry (for sandbox execution)
        dynamicRegistry.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as any,
          code: tool.code,
          category: tool.category,
          permissions: tool.permissions as any,
          requiresApproval: tool.requiresApproval,
        });

        // Register in shared registry with sandboxed executor
        const def: ToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as ToolDefinition['parameters'],
          category: tool.category ?? 'Custom',
          configRequirements: tool.requiredApiKeys?.map(k => ({
            name: k.name,
            displayName: k.displayName,
            description: k.description,
            category: k.category,
            docsUrl: k.docsUrl,
          })),
        };

        // Executor delegates to dynamic registry which handles sandboxing
        const executor = (args: Record<string, unknown>, context: any) =>
          dynamicRegistry.execute(tool.name, args, context);

        registry.registerCustomTool(def, executor, tool.id);
      }

      if (tools.length > 0) {
        console.log(`[tool-executor] Synced ${tools.length} custom tool(s) into shared registry`);
      }
    })
    .catch(() => {
      // DB not ready yet — custom tools will be registered on-demand via CRUD routes
    });
}

/**
 * Execute a tool by name with arguments.
 * All tools (core, gateway, plugin, custom) are in the shared registry.
 * Returns a standardized result object.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const tools = getSharedToolRegistry(userId);

  if (!tools.has(toolName)) {
    return {
      success: false,
      error: `Tool '${toolName}' not found`,
    };
  }

  try {
    const result = await tools.execute(toolName, args, {
      conversationId: 'system-execution',
    });

    if (result.ok) {
      const value = result.value;
      return {
        success: !value.isError,
        result: value.content,
        error: value.isError ? String(value.content) : undefined,
      };
    }

    return {
      success: false,
      error: result.error.message,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}

/**
 * Check if a tool exists in the shared registry.
 */
export async function hasTool(toolName: string): Promise<boolean> {
  const tools = getSharedToolRegistry();
  return tools.has(toolName);
}

/**
 * Reset the shared registry (for testing or reinitialization).
 */
export function resetSharedToolRegistry(): void {
  sharedRegistry = null;
}
