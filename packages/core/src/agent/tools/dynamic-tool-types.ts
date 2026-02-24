/**
 * Dynamic Tools — Type definitions
 *
 * All types and interfaces for the dynamic tools system.
 */

import type { ConfigFieldDefinition } from '../../services/config-center.js';
import type {
  ToolDefinition,
  ToolExecutor,
  ToolContext,
  ToolExecutionResult,
  JSONSchemaProperty,
} from '../types.js';

export type DynamicToolPermission =
  | 'network'
  | 'filesystem'
  | 'database'
  | 'shell'
  | 'email'
  | 'scheduling'
  | 'local';

/** Config service requirement declared by a tool */
export interface RequiredConfigService {
  /** Service name (lookup key in Config Center) */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Description */
  description?: string;
  /** Category for grouping */
  category?: string;
  /** Link to API docs/signup page */
  docsUrl?: string;
  /** Whether this service supports multiple entries */
  multiEntry?: boolean;
  /** Config schema (if not provided, defaults to api_key + base_url) */
  configSchema?: ConfigFieldDefinition[];
}

export interface DynamicToolDefinition {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  /** JavaScript code that implements the tool */
  code: string;
  /** Tool category for organization */
  category?: string;
  /** Required permissions */
  permissions?: DynamicToolPermission[];
  /** Whether this tool requires user approval before each execution */
  requiresApproval?: boolean;
  /** API keys this tool requires (auto-registered in Config Center) */
  requiredApiKeys?: RequiredConfigService[];
}

/**
 * @deprecated Use ToolRegistry.registerCustomTool() instead.
 * Dynamic tools should be registered in the shared ToolRegistry with source: 'custom'.
 */
export interface DynamicToolRegistry {
  /** All registered dynamic tools */
  tools: Map<string, DynamicToolDefinition>;
  /** Get tool definition for LLM */
  getDefinition(name: string): ToolDefinition | undefined;
  /** Get all tool definitions */
  getAllDefinitions(): ToolDefinition[];
  /** Execute a dynamic tool */
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecutionResult>;
  /** Register a new tool */
  register(tool: DynamicToolDefinition): void;
  /** Unregister a tool */
  unregister(name: string): boolean;
  /** Check if tool exists */
  has(name: string): boolean;
  /** Update the callable tools available to custom tool sandboxes via utils.callTool() */
  setCallableTools(tools: Array<{ definition: ToolDefinition; executor: ToolExecutor }>): void;
}
