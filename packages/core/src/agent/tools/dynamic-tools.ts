/**
 * Dynamic Tools System
 *
 * Allows LLM to create, register, and execute custom tools at runtime.
 * Tools are stored in the database and executed in a sandboxed environment.
 */

import { createSandbox } from '../../sandbox/executor.js';
import type { SandboxPermissions, ResourceLimits } from '../../sandbox/types.js';
import type { PluginId } from '../../types/branded.js';
import type {
  ToolDefinition,
  ToolExecutor,
  ToolContext,
  ToolExecutionResult,
  JSONSchemaProperty,
} from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type DynamicToolPermission =
  | 'network'
  | 'filesystem'
  | 'database'
  | 'shell'
  | 'email'
  | 'scheduling';

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
}

export interface DynamicToolRegistry {
  /** All registered dynamic tools */
  tools: Map<string, DynamicToolDefinition>;
  /** Get tool definition for LLM */
  getDefinition(name: string): ToolDefinition | undefined;
  /** Get all tool definitions */
  getAllDefinitions(): ToolDefinition[];
  /** Execute a dynamic tool */
  execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult>;
  /** Register a new tool */
  register(tool: DynamicToolDefinition): void;
  /** Unregister a tool */
  unregister(name: string): boolean;
  /** Check if tool exists */
  has(name: string): boolean;
}

// =============================================================================
// PERMISSION MAPPING
// =============================================================================

/**
 * Map dynamic tool permissions to sandbox permissions
 */
function mapPermissions(permissions: DynamicToolPermission[]): Partial<SandboxPermissions> {
  const sandboxPermissions: Partial<SandboxPermissions> = {
    network: false,
    fsRead: false,
    fsWrite: false,
    spawn: false,
    env: false,
  };

  for (const perm of permissions) {
    switch (perm) {
      case 'network':
        sandboxPermissions.network = true;
        break;
      case 'filesystem':
        sandboxPermissions.fsRead = true;
        sandboxPermissions.fsWrite = true;
        break;
      case 'shell':
        sandboxPermissions.spawn = true;
        break;
      case 'database':
      case 'email':
      case 'scheduling':
        // These are handled through injected APIs, not raw permissions
        break;
    }
  }

  return sandboxPermissions;
}

// =============================================================================
// SANDBOX EXECUTION
// =============================================================================

/**
 * Execute dynamic tool code in sandbox
 */
async function executeDynamicTool(
  tool: DynamicToolDefinition,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const pluginId = `dynamic:${tool.name}` as PluginId;

  // Create sandbox with appropriate permissions
  const sandbox = createSandbox({
    pluginId,
    permissions: mapPermissions(tool.permissions ?? []),
    limits: {
      maxExecutionTime: 30000, // 30 seconds max
      maxCpuTime: 5000,        // 5 seconds CPU time
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
      fetch: tool.permissions?.includes('network') ? globalThis.fetch : undefined,
      console: {
        log: (...args: unknown[]) => console.log(`[DynamicTool:${tool.name}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[DynamicTool:${tool.name}]`, ...args),
        error: (...args: unknown[]) => console.error(`[DynamicTool:${tool.name}]`, ...args),
      },
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

// =============================================================================
// REGISTRY IMPLEMENTATION
// =============================================================================

/**
 * Create a dynamic tool registry
 */
export function createDynamicToolRegistry(): DynamicToolRegistry {
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

      return executeDynamicTool(tool, args, context);
    },

    register(tool: DynamicToolDefinition): void {
      // Validate tool name (alphanumeric and underscores only)
      if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
        throw new Error(
          `Invalid tool name: ${tool.name}. Must start with lowercase letter and contain only lowercase letters, numbers, and underscores.`
        );
      }

      // Validate code doesn't contain dangerous patterns
      const dangerousPatterns = [
        /process\.exit/i,
        /require\s*\(/i,
        /import\s*\(/i,
        /__dirname/i,
        /__filename/i,
        /global\./i,
        /globalThis\./i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(tool.code)) {
          throw new Error(`Tool code contains forbidden pattern: ${pattern.source}`);
        }
      }

      tools.set(tool.name, tool);
    },

    unregister(name: string): boolean {
      return tools.delete(name);
    },

    has(name: string): boolean {
      return tools.has(name);
    },
  };
}

// =============================================================================
// TOOL CREATION TOOL (META-TOOL)
// =============================================================================

/**
 * Tool definition for the "create_tool" meta-tool
 * This allows LLM to create new tools
 */
export const createToolDefinition: ToolDefinition = {
  name: 'create_tool',
  description: `Create a new reusable tool that can be called in future conversations.
The tool will be saved and available for use. Write JavaScript code that:
- Receives arguments via the 'args' object
- Returns a result (will be JSON stringified)
- Can use 'fetch' if network permission is granted
- Should handle errors gracefully`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique tool name (lowercase, underscores allowed, e.g., "fetch_weather")',
      },
      description: {
        type: 'string',
        description: 'Clear description of what the tool does',
      },
      parameters: {
        type: 'string',
        description: 'JSON Schema for tool parameters as a JSON string (e.g., {"type":"object","properties":{"query":{"type":"string","description":"Search query"}}})',
      },
      code: {
        type: 'string',
        description: 'JavaScript code implementing the tool. Access args via "args" variable. Return the result.',
      },
      category: {
        type: 'string',
        description: 'Category for organizing the tool (e.g., "Weather", "Utilities")',
      },
      permissions: {
        type: 'array',
        description: 'Required permissions: "network", "filesystem", "database"',
        items: {
          type: 'string',
          enum: ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling'],
        },
      },
    },
    required: ['name', 'description', 'parameters', 'code'],
  },
  category: 'Meta',
  requiresConfirmation: true,
};

/**
 * Tool definition for listing custom tools
 */
export const listToolsDefinition: ToolDefinition = {
  name: 'list_custom_tools',
  description: 'List all custom tools that have been created',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      status: {
        type: 'string',
        description: 'Filter by status: active, disabled, pending_approval',
        enum: ['active', 'disabled', 'pending_approval'],
      },
    },
  },
  category: 'Meta',
};

/**
 * Tool definition for deleting a custom tool
 */
export const deleteToolDefinition: ToolDefinition = {
  name: 'delete_custom_tool',
  description: 'Delete a custom tool by name',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the tool to delete',
      },
    },
    required: ['name'],
  },
  category: 'Meta',
  requiresConfirmation: true,
};

/**
 * Tool definition for enabling/disabling a custom tool
 */
export const toggleToolDefinition: ToolDefinition = {
  name: 'toggle_custom_tool',
  description: 'Enable or disable a custom tool',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the tool to toggle',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether to enable (true) or disable (false) the tool',
      },
    },
    required: ['name', 'enabled'],
  },
  category: 'Meta',
};

// =============================================================================
// EXPORTS
// =============================================================================

export const DYNAMIC_TOOL_DEFINITIONS: ToolDefinition[] = [
  createToolDefinition,
  listToolsDefinition,
  deleteToolDefinition,
  toggleToolDefinition,
];

export const DYNAMIC_TOOL_NAMES = DYNAMIC_TOOL_DEFINITIONS.map((t) => t.name);
