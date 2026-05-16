/**
 * External Tool Registration
 *
 *  - registerPluginTools     — channel/feature plugins (Telegram, weather, etc.)
 *  - registerExtensionTools  — user-installed extensions (.skill / ext.*)
 *  - registerMcpTools        — tools surfaced by connected MCP servers
 *
 * All three pull their source-of-truth registries (plugin service, extension
 * service, shared MCP registry) and copy/wrap into the per-request
 * ToolRegistry passed by callers.
 */

import type { ToolRegistry } from '@ownpilot/core';
import {
  getServiceRegistry,
  Services,
  qualifyToolName,
  getBaseName,
  type ToolDefinition,
  type ToolExecutionResult as CoreToolResult,
  type ToolContext,
} from '@ownpilot/core';
import { getCustomToolDynamicRegistry } from '../../services/custom-tool-registry.js';
import { getSharedToolRegistry } from '../../services/tool-executor.js';
import type { ExtensionService } from '../../services/extension-service.js';
import { traceToolCallStart, traceToolCallEnd } from '../../tracing/index.js';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../../services/log.js';
import { removeSupersededCoreStubs } from './utils.js';

const log = getLog('AgentTools');

/**
 * Register plugin-provided tools and remove superseded core stubs.
 * Used by both agent and chat endpoints.
 *
 * @returns The plugin tool definitions (needed for tool-list assembly).
 */
export function registerPluginTools(tools: ToolRegistry, trace: boolean): ToolDefinition[] {
  const pluginService = getServiceRegistry().get(Services.Plugin);
  const pluginTools = pluginService.getAllTools();
  const pluginToolDefs: ToolDefinition[] = [];

  // Collect core-category plugin IDs — their tools are already registered by registerAllTools()
  // as core.* (same logic as tool-executor.ts line 132)
  const corePluginIds = new Set(
    pluginService
      .getEnabled()
      .filter((p: { manifest: { category?: string } }) => p.manifest.category === 'core')
      .map((p: { manifest: { id: string } }) => p.manifest.id)
  );

  for (const { pluginId, definition, executor } of pluginTools) {
    // Skip core-category plugins — their tools are already registered by registerAllTools()
    if (corePluginIds.has(pluginId)) continue;

    const qName = qualifyToolName(definition.name, 'plugin', pluginId);
    const qDef = { ...definition, name: qName };
    const wrappedExecutor = async (
      args: unknown,
      context: ToolContext
    ): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(definition.name, args as Record<string, unknown>)
        : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace)
          traceToolCallEnd(
            definition.name,
            startTime,
            !result.isError,
            result.content,
            result.isError ? String(result.content) : undefined
          );
        return result;
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace) traceToolCallEnd(definition.name, startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    };

    if (tools.has(qName)) {
      tools.updateExecutor(qName, wrappedExecutor);
    } else {
      tools.register(qDef, wrappedExecutor);
    }
    pluginToolDefs.push(definition);
  }

  // Remove core stub tools that are superseded by plugin tools
  const pluginToolBaseNames = new Set(pluginToolDefs.map((t) => getBaseName(t.name)));
  removeSupersededCoreStubs(tools, pluginToolBaseNames);

  return pluginToolDefs;
}

/**
 * Register extension tools (from installed user extensions).
 * Extension tools are registered in the DynamicToolRegistry (same sandbox as custom tools)
 * and then exposed on the ToolRegistry for agent access.
 *
 * @returns The extension tool definitions (needed for tool-list assembly).
 */
export function registerExtensionTools(
  tools: ToolRegistry,
  _userId: string,
  trace: boolean
): ToolDefinition[] {
  let service: ExtensionService;
  try {
    service = getServiceRegistry().get(Services.Extension) as ExtensionService;
  } catch {
    log.debug('Extension service not initialized, skipping tool registration');
    return [];
  }

  const extToolDefs = service.getToolDefinitions();
  if (extToolDefs.length === 0) return [];

  // Get the shared DynamicToolRegistry (same sandbox as custom tools)
  const dynamicRegistry = getCustomToolDynamicRegistry();

  const result: ToolDefinition[] = [];

  for (const def of extToolDefs) {
    // Register in DynamicToolRegistry if not already there (uses base name)
    if (!dynamicRegistry.has(def.name)) {
      try {
        dynamicRegistry.register({
          name: def.name,
          description: def.description,
          parameters: def.extensionTool.parameters as never,
          code: def.extensionTool.code,
          permissions: def.extensionTool.permissions as never,
        });
      } catch (error) {
        log.warn(`Failed to register extension tool "${def.name}"`, { error: String(error) });
        continue;
      }
    }

    // Choose namespace based on format: ownpilot → ext.*, agentskills → skill.*
    const nsPrefix = def.format === 'agentskills' ? 'skill' : 'ext';
    const qName = qualifyToolName(def.name, nsPrefix, def.extensionId);
    const toolDef: ToolDefinition = {
      name: def.name,
      description: def.description,
      parameters: def.parameters as ToolDefinition['parameters'],
      category: def.category,
    };

    const pluginId = `${nsPrefix}:${def.extensionId}` as import('@ownpilot/core').PluginId;
    const registerResult = tools.register(
      { ...toolDef, name: qName },
      async (args, context): Promise<CoreToolResult> => {
        const startTime = trace ? traceToolCallStart(def.name, args as Record<string, unknown>) : 0;
        try {
          const execResult = await dynamicRegistry.execute(
            def.name,
            args as Record<string, unknown>,
            context
          );
          if (trace) {
            traceToolCallEnd(
              def.name,
              startTime,
              !execResult.isError,
              execResult.content,
              execResult.isError ? String(execResult.content) : undefined
            );
          }
          return {
            content: execResult.isError
              ? String(execResult.content)
              : JSON.stringify(execResult.content),
            isError: execResult.isError,
          };
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          if (trace) traceToolCallEnd(def.name, startTime, false, undefined, errorMsg);
          return { content: errorMsg, isError: true };
        }
      },
      {
        source: 'dynamic',
        pluginId,
        trustLevel: 'sandboxed',
        providerName: `${nsPrefix}:${def.extensionId}`,
      }
    );

    if (!registerResult.ok) {
      log.warn(`Extension tool "${def.name}" skipped: ${registerResult.error.message}`);
      continue;
    }

    result.push(toolDef);
  }

  return result;
}

/**
 * Register MCP tools from connected external MCP servers.
 * Copies tools from the shared ToolRegistry (where mcpClientService registers them)
 * into the per-request ToolRegistry used by agents/chat.
 */
export function registerMcpTools(tools: ToolRegistry, trace: boolean): ToolDefinition[] {
  const sharedRegistry = getSharedToolRegistry();
  const mcpTools = sharedRegistry.getToolsBySource('mcp');
  const mcpToolDefs: ToolDefinition[] = [];

  for (const registeredTool of mcpTools) {
    const { definition, executor } = registeredTool;

    const wrappedExecutor = async (
      args: unknown,
      context: ToolContext
    ): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(getBaseName(definition.name), args as Record<string, unknown>)
        : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace)
          traceToolCallEnd(
            getBaseName(definition.name),
            startTime,
            !result.isError,
            result.content,
            result.isError ? String(result.content) : undefined
          );
        return result;
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace)
          traceToolCallEnd(getBaseName(definition.name), startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    };

    if (!tools.has(definition.name)) {
      tools.register(definition, wrappedExecutor, {
        source: 'mcp',
        pluginId: registeredTool.pluginId,
        trustLevel: 'semi-trusted',
        providerName: registeredTool.providerName,
      });
    }
    mcpToolDefs.push(definition);
  }

  return mcpToolDefs;
}
