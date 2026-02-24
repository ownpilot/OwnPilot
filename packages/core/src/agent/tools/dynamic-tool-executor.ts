/**
 * Dynamic Tools — Executor
 *
 * The main executeDynamicTool() function that runs dynamic tool code in a sandbox.
 */

import * as crypto from 'node:crypto';
import { createSandbox } from '../../sandbox/executor.js';
import { createScopedFs, createScopedExec } from '../../sandbox/scoped-apis.js';
import type { PluginId } from '../../types/branded.js';
import type { ToolDefinition, ToolExecutor, ToolContext, ToolExecutionResult } from '../types.js';
import { UTILITY_TOOLS } from './utility-tools.js';
import { getBaseName } from '../tool-namespace.js';
import type { DynamicToolDefinition } from './dynamic-tool-types.js';
import { isToolCallAllowed } from './dynamic-tool-permissions.js';
import { createSafeFetch, mapPermissions, createSandboxUtils } from './dynamic-tool-sandbox.js';

/**
 * Execute dynamic tool code in sandbox
 */
export async function executeDynamicTool(
  tool: DynamicToolDefinition,
  args: Record<string, unknown>,
  context: ToolContext,
  callableTools?: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
): Promise<ToolExecutionResult> {
  const pluginId = `dynamic:${tool.name}` as PluginId;
  const toolPermissions = tool.permissions ?? [];

  // Create sandbox with appropriate permissions
  const sandbox = createSandbox({
    pluginId,
    permissions: mapPermissions(toolPermissions),
    limits: {
      maxExecutionTime: 30000, // 30 seconds max
      maxCpuTime: 5000, // 5 seconds CPU time
      maxMemory: 50 * 1024 * 1024, // 50MB memory
    },
    globals: {
      // Inject helper APIs
      __args__: args,
      __context__: {
        toolName: tool.name,
        callId: context.callId,
        conversationId: context.conversationId,
        userId: context.userId,
      },
      // Helper functions available to tool code
      // SSRF-safe fetch: blocks private/internal URLs
      fetch: toolPermissions.includes('network') ? createSafeFetch(tool.name) : undefined,
      console: {
        log: (...logArgs: unknown[]) => console.log(`[DynamicTool:${tool.name}]`, ...logArgs),
        warn: (...logArgs: unknown[]) => console.warn(`[DynamicTool:${tool.name}]`, ...logArgs),
        error: (...logArgs: unknown[]) => console.error(`[DynamicTool:${tool.name}]`, ...logArgs),
      },
      // Config bridge — matches skill.json documentation: config.get(service, field)
      config: {
        get: async (serviceName: string, fieldName: string) => {
          return context.getFieldValue?.(serviceName, fieldName);
        },
      },
      // Crypto utilities (require('crypto') is blocked in sandbox)
      crypto: {
        randomUUID: () => crypto.randomUUID(),
        randomBytes: (size: number) => crypto.randomBytes(size),
        createHash: (algorithm: string) => crypto.createHash(algorithm),
      },
      // Utility helpers - all built-in utility functions accessible via utils.*
      utils: {
        ...createSandboxUtils(),
        /**
         * Get API key for a named service from the Config Center.
         * Usage: const key = utils.getApiKey('openweathermap')
         */
        getApiKey: (serviceName: string): string | undefined => {
          return context.getApiKey?.(serviceName);
        },
        /**
         * Get full service config from the Config Center (legacy shape).
         * Usage: const config = utils.getServiceConfig('openweathermap')
         */
        getServiceConfig: (serviceName: string) => {
          return context.getServiceConfig?.(serviceName) ?? null;
        },
        /**
         * Get a config entry's data by service name and optional label.
         * Usage: const entry = utils.getConfigEntry('smtp')
         * Usage: const entry = utils.getConfigEntry('smtp', 'Work Email')
         */
        getConfigEntry: (serviceName: string, entryLabel?: string) => {
          return context.getConfigEntry?.(serviceName, entryLabel) ?? null;
        },
        /**
         * Get all config entries for a service (multi-entry).
         * Usage: const entries = utils.getConfigEntries('smtp')
         */
        getConfigEntries: (serviceName: string) => {
          return context.getConfigEntries?.(serviceName) ?? [];
        },
        /**
         * Get a resolved field value from a service config entry.
         * Usage: const host = utils.getFieldValue('smtp', 'host')
         */
        getFieldValue: (serviceName: string, fieldName: string, entryLabel?: string) => {
          return context.getFieldValue?.(serviceName, fieldName, entryLabel);
        },
        /**
         * Call a built-in utility tool by name.
         * SECURITY: Restricted to safe tools only. Dangerous tools (code execution,
         * file mutation, email, git) are blocked. Some tools require specific permissions.
         * Usage: const result = await utils.callTool('tool_name', { arg1: 'value' })
         */
        callTool: async (toolName: string, toolArgs: Record<string, unknown> = {}) => {
          // Security: Check if tool is allowed for this custom tool
          const check = isToolCallAllowed(toolName, toolPermissions);
          if (!check.allowed) {
            throw new Error(check.reason);
          }

          // Search callable tools first (all built-in tools), then fall back to utility tools
          // Match by exact name first, then by base name (for qualified name resolution)
          const allTools = callableTools ?? UTILITY_TOOLS;
          const foundTool =
            allTools.find((t) => t.definition.name === toolName) ??
            allTools.find((t) => getBaseName(t.definition.name) === getBaseName(toolName));
          if (!foundTool) {
            // Only show allowed tools in the error message (show base names for readability)
            const available = allTools
              .filter((t) => isToolCallAllowed(t.definition.name, toolPermissions).allowed)
              .map((t) => getBaseName(t.definition.name))
              .join(', ');
            throw new Error(`Tool '${toolName}' not found. Available tools: ${available}`);
          }
          const result = await foundTool.executor(toolArgs, context);
          if (result.isError) {
            throw new Error(`Tool '${toolName}' failed: ${result.content}`);
          }
          // Parse JSON content back to object if possible
          if (typeof result.content === 'string') {
            try {
              return JSON.parse(result.content);
            } catch {
              return result.content;
            }
          }
          return result.content;
        },
        /**
         * List all available tools that can be called via callTool.
         * Only shows tools that this custom tool is allowed to call.
         */
        listTools: () => {
          const allTools = callableTools ?? UTILITY_TOOLS;
          return allTools
            .filter((t) => isToolCallAllowed(t.definition.name, toolPermissions).allowed)
            .map((t) => ({
              name: getBaseName(t.definition.name),
              description: t.definition.description,
              parameters: Object.keys(t.definition.parameters.properties || {}),
            }));
        },
      },
      // Common globals
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      setTimeout: undefined, // explicitly blocked in sandbox
      // Scoped filesystem API (requires 'local' + 'filesystem' permissions)
      fs:
        toolPermissions.includes('local') && toolPermissions.includes('filesystem')
          ? createScopedFs(context.workspaceDir ?? process.cwd())
          : undefined,
      // Scoped shell execution API (requires 'local' + 'shell' permissions)
      exec:
        toolPermissions.includes('local') && toolPermissions.includes('shell')
          ? createScopedExec(context.workspaceDir ?? process.cwd()).exec
          : undefined,
    },
    debug: false,
  });

  // Wrap the tool code to receive args and return result
  const wrappedCode = `
    const args = __args__;
    const context = __context__;

    // Tool implementation
    ${tool.code}
  `;

  const result = await sandbox.execute(wrappedCode);

  if (result.ok) {
    const execResult = result.value;
    if (execResult.success) {
      return {
        content: execResult.value,
        isError: false,
        metadata: {
          executionTime: execResult.executionTime,
          dynamicTool: tool.name,
        },
      };
    } else {
      return {
        content: `Tool execution failed: ${execResult.error}`,
        isError: true,
        metadata: {
          executionTime: execResult.executionTime,
          dynamicTool: tool.name,
          stack: execResult.stack,
        },
      };
    }
  } else {
    return {
      content: `Tool execution error: ${result.error.message}`,
      isError: true,
      metadata: {
        dynamicTool: tool.name,
        errorType: result.error.name,
      },
    };
  }
}
