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
import type { ToolDefinition, ToolContext, DynamicToolDefinition, ExecutionPermissions } from '@ownpilot/core';
import { gatewayConfigCenter } from './config-center-impl.js';
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
import { getErrorMessage } from '../routes/helpers.js';
import { getLog } from './log.js';
import { hasServiceRegistry, getServiceRegistry, Services } from '@ownpilot/core';
import type { IAuditService } from '@ownpilot/core';

const log = getLog('ToolExecutor');

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

  tools.setConfigCenter(gatewayConfigCenter);

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

  // Update dynamic registry's callable tools with the full set (core + gateway providers).
  // Without this, custom tools calling utils.callTool() can only reach core tools,
  // not gateway-provided tools like custom data, memory, goals, etc.
  getCustomToolDynamicRegistry().setCallableTools(tools.getAllTools());

  sharedRegistry = tools;
  return tools;
}

/**
 * Bring plugin tools into the shared ToolRegistry.
 * Also listens for plugin enable/disable events to add/remove tools dynamically.
 */
function initPluginToolsIntoRegistry(registry: ToolRegistry): void {
  if (!hasServiceRegistry()) return;

  try {
    const pluginService = getServiceRegistry().get(Services.Plugin);
    const eventSystem = getServiceRegistry().get(Services.Event);

    // Register tools from all currently enabled plugins
    // Skip core-category plugins — their tools are registered synchronously
    // by registerAllTools() + registerCoreTools() above.
    for (const plugin of pluginService.getEnabled()) {
      if (plugin.tools.size > 0 && plugin.manifest.category !== 'core') {
        registry.registerPluginTools(createPluginId(plugin.manifest.id), plugin.tools);
      }
    }

    // Listen for future plugin state changes via EventSystem
    eventSystem.onAny('plugin.status', (e) => {
      try {
        const event = e.data as { pluginId: string; newStatus: string };
        const pluginId = createPluginId(event.pluginId);
        if (event.newStatus === 'enabled') {
          const plugin = pluginService.get(event.pluginId);
          if (plugin && plugin.tools.size > 0 && plugin.manifest.category !== 'core') {
            registry.registerPluginTools(createPluginId(plugin.manifest.id), plugin.tools);
          }
        } else if (event.newStatus === 'disabled') {
          registry.unregisterPluginTools(pluginId);
        }
        // Keep dynamic registry's callable tools in sync
        getCustomToolDynamicRegistry().setCallableTools(registry.getAllTools());
      } catch (err) {
        log.warn('[tool-executor] Plugin status event handler failed', { error: err });
      }
    });
  } catch {
    // Plugin or Event service not initialized yet — plugins will register later
  }
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
          parameters: tool.parameters as DynamicToolDefinition['parameters'],
          code: tool.code,
          category: tool.category,
          permissions: tool.permissions as DynamicToolDefinition['permissions'],
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
        const executor = (args: Record<string, unknown>, context: ToolContext) =>
          dynamicRegistry.execute(tool.name, args, context);

        registry.registerCustomTool(def, executor, tool.id);
      }

      if (tools.length > 0) {
        log.info(`[tool-executor] Synced ${tools.length} custom tool(s) into shared registry`);
        // Refresh callable tools so newly synced tools are available via utils.callTool()
        dynamicRegistry.setCallableTools(registry.getAllTools());
      }
    })
    .catch((err) => {
      log.warn('[tool-executor] Custom tools sync deferred — DB may not be ready yet', { error: err });
    });
}

/**
 * Execute a tool by name with arguments.
 * First checks the shared ToolRegistry, then falls back to PluginRegistry
 * (in case plugin tools haven't been synced yet due to async initialization).
 * Returns a standardized result object.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default',
  executionPermissions?: ExecutionPermissions,
): Promise<ToolExecutionResult> {
  const start = Date.now();
  const result = await executeToolInternal(toolName, args, userId, executionPermissions);

  // Audit log (fire-and-forget)
  if (hasServiceRegistry()) {
    const audit = getServiceRegistry().tryGet<IAuditService>(Services.Audit);
    audit?.logAudit({
      userId,
      action: 'tool_execute',
      resource: 'tool',
      resourceId: toolName,
      details: {
        tool: toolName,
        success: result.success,
        durationMs: Date.now() - start,
        error: result.error,
      },
    });
  }

  return result;
}

async function executeToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  executionPermissions?: ExecutionPermissions,
): Promise<ToolExecutionResult> {
  const tools = getSharedToolRegistry(userId);

  // Try shared registry first
  if (tools.has(toolName)) {
    try {
      const result = await tools.execute(toolName, args, {
        conversationId: 'system-execution',
        executionPermissions,
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
        error: getErrorMessage(error, 'Tool execution failed'),
      };
    }
  }

  // Fallback: check plugin service (covers the sync race window)
  try {
    const pluginService = getServiceRegistry().get(Services.Plugin);
    const pluginTool = pluginService.getTool(toolName);
    if (pluginTool != null) {
      try {
        const pluginResult = await pluginTool.executor(args, { callId: 'fallback', conversationId: 'system-execution' });
        const content = typeof pluginResult.content === 'string' ? pluginResult.content : String(pluginResult.content);
        return {
          success: !pluginResult.isError,
          result: content,
          error: pluginResult.isError ? content : undefined,
        };
      } catch (execError) {
        return {
          success: false,
          error: execError instanceof Error ? execError.message : 'Plugin tool execution failed',
        };
      }
    }
  } catch {
    // Ignore plugin service lookup errors — fall through to not-found
  }

  return {
    success: false,
    error: `Tool '${toolName}' not found in shared registry or plugins`,
  };
}

/**
 * Check if a tool exists in the shared registry or plugin registry.
 */
export async function hasTool(toolName: string): Promise<boolean> {
  const tools = getSharedToolRegistry();
  if (tools.has(toolName)) return true;

  // Fallback: check plugin service
  try {
    const pluginService = getServiceRegistry().get(Services.Plugin);
    return pluginService.getTool(toolName) != null;
  } catch {
    return false;
  }
}

/**
 * Reset the shared registry (for testing or reinitialization).
 */
export function resetSharedToolRegistry(): void {
  sharedRegistry = null;
}
