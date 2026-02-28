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
  qualifyToolName,
} from '@ownpilot/core';
import type {
  ToolDefinition,
  ToolContext,
  DynamicToolDefinition,
  ExecutionPermissions,
} from '@ownpilot/core';
import { gatewayConfigCenter } from './config-center-impl.js';
import { registerToolConfigRequirements } from './api-service-registrar.js';
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
} from './tool-providers/index.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import {
  getCustomToolDynamicRegistry,
  setSharedRegistryForCustomTools,
} from './custom-tool-registry.js';
import { getErrorMessage } from '../routes/helpers.js';
import { getLog } from './log.js';
import { registerImageOverrides } from './image-overrides.js';
import { registerEmailOverrides } from './email-overrides.js';
import { registerAudioOverrides } from './audio-overrides.js';
import { hasServiceRegistry, getServiceRegistry, Services } from '@ownpilot/core';
import type { IAuditService } from '@ownpilot/core';
import { checkToolPermission } from './tool-permission-service.js';
import type { ToolExecContext } from './permission-utils.js';

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

  // Override tool placeholders with real implementations
  registerImageOverrides(tools).catch((err) =>
    log.warn('registerImageOverrides failed:', String(err))
  );
  registerEmailOverrides(tools).catch((err) =>
    log.warn('registerEmailOverrides failed:', String(err))
  );
  registerAudioOverrides(tools).catch((err) =>
    log.warn('registerAudioOverrides failed:', String(err))
  );

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
  tools.registerProvider(createConfigToolProvider());
  tools.registerProvider(createHeartbeatToolProvider(userId));
  tools.registerProvider(createExtensionToolProvider(userId));
  tools.registerProvider(createCodingAgentToolProvider(userId));
  tools.registerProvider(createCliToolProvider(userId));

  // Register plugin tools into the shared registry (source: 'plugin')
  initPluginToolsIntoRegistry(tools);

  // Sync active custom tools from DB into the shared registry (source: 'custom')
  syncCustomToolsIntoRegistry(tools, userId);

  // Sync enabled extension tools into the shared registry (source: 'dynamic', ext.*/skill.*)
  syncExtensionToolsIntoRegistry(tools);

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
 * The sync runs async so getSharedToolRegistry() stays synchronous.
 * The returned promise is stored so callers can await completion via waitForToolSync().
 */
let toolSyncPromise: Promise<void> | null = null;

function syncCustomToolsIntoRegistry(registry: ToolRegistry, userId: string): void {
  const repo = createCustomToolsRepo(userId);

  toolSyncPromise = repo
    .getActiveTools()
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
          configRequirements: tool.requiredApiKeys?.map((k) => ({
            name: k.name,
            displayName: k.displayName,
            description: k.description,
            category: k.category,
            docsUrl: k.docsUrl,
          })),
          workflowUsable:
            tool.metadata?.workflowUsable !== undefined
              ? Boolean(tool.metadata.workflowUsable)
              : undefined,
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
      log.warn('[tool-executor] Custom tools sync deferred — DB may not be ready yet', {
        error: err,
      });
    });
}

/**
 * Sync enabled extension tools into the shared ToolRegistry.
 * Extension tools get namespaced as ext.{id}.{name} or skill.{id}.{name}.
 * Also listens for extension install/enable/disable events to stay in sync.
 */
function syncExtensionToolsIntoRegistry(registry: ToolRegistry): void {
  if (!hasServiceRegistry()) return;

  try {
    const service = getServiceRegistry().get(Services.Extension) as import('./extension-service.js').ExtensionService;
    const dynamicRegistry = getCustomToolDynamicRegistry();
    const extToolDefs = service.getToolDefinitions();

    for (const def of extToolDefs) {
      // Register in DynamicToolRegistry for sandbox execution
      if (!dynamicRegistry.has(def.name)) {
        try {
          dynamicRegistry.register({
            name: def.name,
            description: def.description,
            parameters: def.extensionTool.parameters as never,
            code: def.extensionTool.code,
            permissions: def.extensionTool.permissions as never,
          });
        } catch {
          continue;
        }
      }

      // Qualify name: ext.{id}.{name} or skill.{id}.{name}
      const nsPrefix = def.format === 'agentskills' ? 'skill' : 'ext';
      const qName = qualifyToolName(def.name, nsPrefix, def.extensionId);
      const toolDef: ToolDefinition = {
        name: qName,
        description: def.description,
        parameters: def.parameters as ToolDefinition['parameters'],
        category: def.category,
      };

      registry.register(
        toolDef,
        async (args, context) => {
          const execResult = await dynamicRegistry.execute(
            def.name,
            args as Record<string, unknown>,
            context
          );
          return {
            content: execResult.isError
              ? String(execResult.content)
              : JSON.stringify(execResult.content),
            isError: execResult.isError,
          };
        },
        {
          source: 'dynamic',
          pluginId: `${nsPrefix}:${def.extensionId}` as import('@ownpilot/core').PluginId,
          trustLevel: 'sandboxed',
          providerName: `${nsPrefix}:${def.extensionId}`,
        }
      );
    }

    if (extToolDefs.length > 0) {
      log.info(`[tool-executor] Synced ${extToolDefs.length} extension tool(s) into shared registry`);
    }

    // Listen for extension enable/disable/install events to keep in sync
    try {
      const eventSystem = getServiceRegistry().get(Services.Event);

      const resyncExtensionTools = () => {
        try {
          const freshDefs = service.getToolDefinitions();
          for (const d of freshDefs) {
            const ns = d.format === 'agentskills' ? 'skill' : 'ext';
            const qn = qualifyToolName(d.name, ns, d.extensionId);
            if (registry.has(qn)) continue; // already registered

            if (!dynamicRegistry.has(d.name)) {
              try {
                dynamicRegistry.register({
                  name: d.name,
                  description: d.description,
                  parameters: d.extensionTool.parameters as never,
                  code: d.extensionTool.code,
                  permissions: d.extensionTool.permissions as never,
                });
              } catch {
                continue;
              }
            }

            registry.register(
              {
                name: qn,
                description: d.description,
                parameters: d.parameters as ToolDefinition['parameters'],
                category: d.category,
              },
              async (args, context) => {
                const res = await dynamicRegistry.execute(
                  d.name,
                  args as Record<string, unknown>,
                  context
                );
                return {
                  content: res.isError ? String(res.content) : JSON.stringify(res.content),
                  isError: res.isError,
                };
              },
              {
                source: 'dynamic',
                pluginId: `${ns}:${d.extensionId}` as import('@ownpilot/core').PluginId,
                trustLevel: 'sandboxed',
                providerName: `${ns}:${d.extensionId}`,
              }
            );
          }
          dynamicRegistry.setCallableTools(registry.getAllTools());
        } catch (err) {
          log.warn('[tool-executor] Extension re-sync failed', { error: err });
        }
      };

      eventSystem.onAny('extension.installed', resyncExtensionTools);
      eventSystem.onAny('extension.enabled', resyncExtensionTools);
      eventSystem.onAny('extension.disabled', resyncExtensionTools);
    } catch {
      // EventSystem not available yet
    }
  } catch {
    // Extension service not initialized yet
  }
}

/**
 * Wait for the initial custom tool sync to complete.
 * Useful for ensuring all custom tools are registered before first trigger execution.
 */
export async function waitForToolSync(): Promise<void> {
  if (toolSyncPromise) await toolSyncPromise;
}

/**
 * Execute a tool by name with arguments.
 * First checks the shared ToolRegistry, then falls back to PluginRegistry
 * (in case plugin tools haven't been synced yet due to async initialization).
 * Returns a standardized result object.
 *
 * @param execContext - Execution context identifying the caller (trigger, plan, workflow, etc.).
 *                      When provided, the ToolPermissionService enforces tool group checks,
 *                      execution permissions, CLI policies, and custom tool approval requirements.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default',
  executionPermissions?: ExecutionPermissions,
  execContext?: ToolExecContext
): Promise<ToolExecutionResult> {
  // Centralized permission check — blocks disabled tools in ALL execution contexts
  if (execContext) {
    const perm = await checkToolPermission(userId, toolName, {
      ...execContext,
      executionPermissions: execContext.executionPermissions ?? executionPermissions,
    });
    if (!perm.allowed) {
      return { success: false, error: `Tool '${toolName}' blocked: ${perm.reason}` };
    }
  }

  const start = Date.now();
  const result = await executeToolInternal(toolName, args, userId, executionPermissions);

  // Audit log (fire-and-forget)
  if (hasServiceRegistry()) {
    try {
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
    } catch {
      /* audit failure should not affect tool execution */
    }
  }

  return result;
}

async function executeToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  executionPermissions?: ExecutionPermissions
): Promise<ToolExecutionResult> {
  const tools = getSharedToolRegistry(userId);

  // Try shared registry first
  if (tools.has(toolName)) {
    try {
      const result = await tools.execute(toolName, args, {
        conversationId: 'system-execution',
        userId,
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
        const pluginResult = await pluginTool.executor(args, {
          callId: 'fallback',
          conversationId: 'system-execution',
        });
        const content =
          typeof pluginResult.content === 'string'
            ? pluginResult.content
            : String(pluginResult.content);
        return {
          success: !pluginResult.isError,
          result: content,
          error: pluginResult.isError ? content : undefined,
        };
      } catch (execError) {
        return {
          success: false,
          error: getErrorMessage(execError, 'Plugin tool execution failed'),
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
  toolSyncPromise = null;
}
