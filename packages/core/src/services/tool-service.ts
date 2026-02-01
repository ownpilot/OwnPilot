/**
 * IToolService - Unified Tool Access Interface
 *
 * Wraps the ToolRegistry to provide a consistent service interface.
 * All tool access (execution, discovery, middleware) goes through this.
 *
 * Usage:
 *   const tools = registry.get(Services.Tool);
 *   const defs = tools.getDefinitions();
 *   const result = await tools.execute('get_current_time', {});
 */

import type { ToolDefinition, ToolExecutor, ToolMiddleware, ToolSource } from '../agent/types.js';

// ============================================================================
// Tool Execution Result (simplified for service layer)
// ============================================================================

export interface ToolServiceResult {
  readonly content: string;
  readonly isError?: boolean;
}

// ============================================================================
// IToolService
// ============================================================================

export interface IToolService {
  /**
   * Execute a tool by name.
   */
  execute(
    name: string,
    args: Record<string, unknown>,
    context?: { conversationId?: string; userId?: string },
  ): Promise<ToolServiceResult>;

  /**
   * Get a tool definition by name.
   */
  getDefinition(name: string): ToolDefinition | undefined;

  /**
   * Get all tool definitions.
   */
  getDefinitions(): readonly ToolDefinition[];

  /**
   * Get tool definitions filtered by source.
   */
  getDefinitionsBySource(source: ToolSource): readonly ToolDefinition[];

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean;

  /**
   * Get all tool names.
   */
  getNames(): readonly string[];

  /**
   * Add global middleware.
   */
  use(middleware: ToolMiddleware): void;

  /**
   * Get tool count.
   */
  getCount(): number;
}
