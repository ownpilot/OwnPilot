/**
 * Custom Tool Registry
 *
 * Service-layer module for the DynamicToolRegistry and shared ToolRegistry bridge.
 * Extracted from routes/custom-tools.ts to break the circular dependency:
 *   tool-executor -> custom-tools (route) -> agents -> agent-tools -> tool-executor
 */

import {
  createDynamicToolRegistry,
  ALL_TOOLS,
  type DynamicToolDefinition,
  type ToolDefinition,
  type ToolContext,
  type ToolExecutor,
} from '@ownpilot/core';
import type { CustomToolRecord } from '../db/repositories/custom-tools.js';

// ============================================================================
// Dynamic Tool Registry
// ============================================================================

const dynamicRegistry = createDynamicToolRegistry(ALL_TOOLS);

/**
 * Get the dynamic tool registry (for sandbox execution of custom tools).
 */
export function getCustomToolDynamicRegistry() {
  return dynamicRegistry;
}

// ============================================================================
// Shared Registry Bridge
// ============================================================================

// Reference to shared ToolRegistry — set by tool-executor.ts during initialization
let _sharedRegistry: {
  registerCustomTool: (def: ToolDefinition, exec: ToolExecutor, id: string) => unknown;
  unregister: (name: string) => void;
  has: (name: string) => boolean;
  execute: (name: string, args: Record<string, unknown>, context: Omit<ToolContext, 'callId'>) => Promise<{ ok: true; value: { content: unknown; isError?: boolean; metadata?: Record<string, unknown> } } | { ok: false; error: { message: string } }>;
} | null = null;

/**
 * Set the shared ToolRegistry reference so CRUD operations can sync custom tools into it.
 * Called by tool-executor.ts during initialization.
 */
export function setSharedRegistryForCustomTools(registry: typeof _sharedRegistry): void {
  _sharedRegistry = registry;
}

/**
 * Execute a custom tool via the shared ToolRegistry (preferred) or fall back to DynamicToolRegistry.
 * Going through the shared registry ensures middleware, scoped config access, and event emission.
 */
export async function executeCustomToolUnified(
  toolName: string,
  args: Record<string, unknown>,
  context: { callId?: string; conversationId?: string; userId?: string }
): Promise<{ content: unknown; isError: boolean; metadata?: Record<string, unknown> }> {
  // Prefer shared registry (has middleware, scoped config, event emission)
  if (_sharedRegistry?.has(toolName)) {
    const result = await _sharedRegistry.execute(toolName, args, {
      conversationId: context.conversationId ?? 'custom-tool-execution',
      userId: context.userId,
    });
    if (result.ok) {
      return {
        content: result.value.content,
        isError: result.value.isError ?? false,
        metadata: result.value.metadata,
      };
    }
    return { content: result.error.message, isError: true };
  }

  // Fallback: direct dynamic registry (shared registry not yet initialized)
  const result = await dynamicRegistry.execute(toolName, args, {
    callId: context.callId ?? `exec_${Date.now()}`,
    conversationId: context.conversationId ?? 'custom-tool-execution',
    userId: context.userId,
  });
  return {
    content: result.content,
    isError: result.isError ?? false,
    metadata: result.metadata,
  };
}

/**
 * Unregister a tool by name from both registries.
 */
export function unregisterToolFromRegistries(toolName: string): void {
  dynamicRegistry.unregister(toolName);
  if (_sharedRegistry?.has(toolName)) {
    _sharedRegistry.unregister(toolName);
  }
}

/**
 * Sync database tools with both the dynamic registry (for sandbox execution)
 * and the shared ToolRegistry (for unified access from agents/triggers/plans).
 */
export function syncToolToRegistry(tool: CustomToolRecord): void {
  if (tool.status === 'active') {
    // Register in dynamic registry (handles sandbox execution)
    const dynamicTool: DynamicToolDefinition = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as DynamicToolDefinition['parameters'],
      code: tool.code,
      category: tool.category,
      permissions: tool.permissions as DynamicToolDefinition['permissions'],
      requiresApproval: tool.requiresApproval,
    };
    dynamicRegistry.register(dynamicTool);

    // Also register in shared ToolRegistry (for unified tool access)
    if (_sharedRegistry && !_sharedRegistry.has(tool.name)) {
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
        workflowUsable: tool.metadata?.workflowUsable !== undefined
          ? Boolean(tool.metadata.workflowUsable)
          : undefined,
      };
      const executor = (args: Record<string, unknown>, context: ToolContext) =>
        dynamicRegistry.execute(tool.name, args, context);
      _sharedRegistry.registerCustomTool(def, executor, tool.id);
    }
  } else {
    // Unregister from both registries
    dynamicRegistry.unregister(tool.name);
    if (_sharedRegistry?.has(tool.name)) {
      _sharedRegistry.unregister(tool.name);
    }
  }
}
