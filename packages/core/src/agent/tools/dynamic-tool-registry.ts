/**
 * Dynamic Tools — Registry
 *
 * The createDynamicToolRegistry() factory function.
 */

import { validateToolCodeWithPermissions } from '../../sandbox/code-validator.js';
import type { ToolDefinition, ToolExecutor, ToolContext, ToolExecutionResult } from '../types.js';
import type { DynamicToolDefinition, DynamicToolRegistry } from './dynamic-tool-types.js';
import { executeDynamicTool } from './dynamic-tool-executor.js';

/**
 * Create a dynamic tool registry.
 * @deprecated Use ToolRegistry.registerCustomTool() for registering custom/dynamic tools.
 */
export function createDynamicToolRegistry(
  initialCallableTools?: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
): DynamicToolRegistry {
  let callableTools = initialCallableTools;
  const tools = new Map<string, DynamicToolDefinition>();

  return {
    tools,

    getDefinition(name: string): ToolDefinition | undefined {
      const tool = tools.get(name);
      if (!tool) return undefined;

      return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        category: tool.category ?? 'Custom',
        requiresConfirmation: tool.requiresApproval,
      };
    },

    getAllDefinitions(): ToolDefinition[] {
      const definitions: ToolDefinition[] = [];
      for (const tool of tools.values()) {
        definitions.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          category: tool.category ?? 'Custom',
          requiresConfirmation: tool.requiresApproval,
        });
      }
      return definitions;
    },

    async execute(
      name: string,
      args: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolExecutionResult> {
      const tool = tools.get(name);
      if (!tool) {
        return {
          content: `Dynamic tool not found: ${name}`,
          isError: true,
        };
      }

      return executeDynamicTool(tool, args, context, callableTools);
    },

    register(tool: DynamicToolDefinition): void {
      // Validate tool name (alphanumeric and underscores only)
      if (!/^[a-z][a-z0-9_.]*$/.test(tool.name)) {
        throw new Error(
          `Invalid tool name: ${tool.name}. Must start with lowercase letter and contain only lowercase letters, numbers, underscores, and dots.`
        );
      }

      // Validate code against dangerous patterns (permission-aware)
      const codeValidation = validateToolCodeWithPermissions(tool.code, tool.permissions);
      if (!codeValidation.valid) {
        throw new Error(`Tool code validation failed: ${codeValidation.errors.join('; ')}`);
      }

      tools.set(tool.name, tool);
    },

    unregister(name: string): boolean {
      return tools.delete(name);
    },

    has(name: string): boolean {
      return tools.has(name);
    },

    setCallableTools(
      newTools: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
    ): void {
      callableTools = newTools;
    },
  };
}
