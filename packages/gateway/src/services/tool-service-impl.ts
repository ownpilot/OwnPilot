/**
 * ToolService Implementation
 *
 * Wraps the existing ToolRegistry to provide IToolService interface.
 * This is an adapter — the existing tool registration code continues to work.
 *
 * Usage:
 *   const tools = registry.get(Services.Tool);
 *   const defs = tools.getDefinitions();
 *   await tools.execute('get_current_time', {});
 */

import { randomUUID } from 'node:crypto';
import type { IToolService, ToolServiceResult } from '@ownpilot/core';
import type { ToolDefinition, ToolMiddleware, ToolSource } from '@ownpilot/core';
import { getSharedToolRegistry } from './tool-executor.js';

// ============================================================================
// ToolService Adapter
// ============================================================================

export class ToolService implements IToolService {
  private get registry() {
    return getSharedToolRegistry(this.userId);
  }

  constructor(private readonly userId: string = 'default') {}

  async execute(
    name: string,
    args: Record<string, unknown>,
    context?: { conversationId?: string; userId?: string }
  ): Promise<ToolServiceResult> {
    let argsJson: string;
    try {
      argsJson = JSON.stringify(args);
    } catch {
      return { content: 'Invalid tool arguments: cannot serialize to JSON', isError: true };
    }

    const result = await this.registry.executeToolCall(
      {
        id: `call_${randomUUID()}`,
        name,
        arguments: argsJson,
      },
      context?.conversationId ?? 'service',
      context?.userId ?? this.userId
    );

    let content: string;
    if (typeof result.content === 'string') {
      content = result.content;
    } else {
      try {
        content = JSON.stringify(result.content);
      } catch {
        content = String(result.content);
      }
    }

    return { content, isError: result.isError };
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.registry.getDefinition(name);
  }

  getDefinitions(): readonly ToolDefinition[] {
    return this.registry.getDefinitions();
  }

  getDefinitionsBySource(source: ToolSource): readonly ToolDefinition[] {
    return this.registry.getToolsBySource(source).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getNames(): readonly string[] {
    return this.registry.getNames();
  }

  use(middleware: ToolMiddleware): void {
    this.registry.use(middleware);
  }

  getCount(): number {
    return this.registry.getNames().length;
  }
}

/**
 * Create a new ToolService instance.
 */
export function createToolService(userId?: string): IToolService {
  return new ToolService(userId);
}
