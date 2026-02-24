/**
 * Dynamic Tools — Tool Definitions
 *
 * All 10 ToolDefinition exports for the dynamic/meta tools system,
 * plus the DYNAMIC_TOOL_DEFINITIONS array and DYNAMIC_TOOL_NAMES.
 */

import type { ToolDefinition } from '../types.js';

// =============================================================================
// TOOL CREATION TOOL (META-TOOL)
// =============================================================================

/**
 * Tool definition for the "create_tool" meta-tool
 * This allows LLM to create new tools
 */
export const createToolDefinition: ToolDefinition = {
  name: 'create_tool',
  brief: 'Create a new custom tool with JavaScript code',
  workflowUsable: false,
  description: `Create a new reusable tool that can be called in future conversations.
The tool will be saved and available for use. Write JavaScript code that:
- Receives arguments via the 'args' object
- Returns a result (will be JSON stringified)
- Can use 'fetch' if network permission is granted
- Should handle errors gracefully
- Declare API dependencies via 'required_api_keys' so they appear in Config Center for user configuration
- Has access to 'utils' helper object with: getApiKey(serviceName) to get API keys from Config Center, getServiceConfig(serviceName) to get full service config, getConfigEntry(serviceName, label?) to get a config entry's data, getConfigEntries(serviceName) to get all entries (multi-account), getFieldValue(serviceName, fieldName, label?) to get a resolved field value, callTool(name, args) to invoke safe built-in tools (file read, web fetch, pdf, translation, image, data extraction, weather, utilities — code execution and file mutation tools are blocked for security), listTools() to list all available tools, plus hash/uuid/password generation, base64/url/hex encoding, date math (now/dateDiff/dateAdd/formatDate), text transforms (slugify/camelCase/snakeCase/titleCase/truncate), validation (isEmail/isUrl/isJson/isUuid), math (clamp/round/randomInt/sum/avg), data (parseJson/toJson/parseCsv/flatten/getPath), array (unique/chunk/shuffle/sample/groupBy)`,
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
        description:
          'JSON Schema for tool parameters as a JSON string (e.g., {"type":"object","properties":{"query":{"type":"string","description":"Search query"}}})',
      },
      code: {
        type: 'string',
        description:
          'JavaScript code implementing the tool. Access args via "args" variable. Return the result.',
      },
      category: {
        type: 'string',
        description: 'Category for organizing the tool (e.g., "Weather", "Utilities")',
      },
      permissions: {
        type: 'array',
        description:
          'Required permissions. Use "local" with "filesystem" or "shell" to access workspace files or run commands on the host machine.',
        items: {
          type: 'string',
          enum: ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling', 'local'],
        },
      },
      required_api_keys: {
        type: 'array',
        description:
          'API keys this tool needs. Each entry auto-registers in Config Center. Example: [{"name":"weatherapi","displayName":"WeatherAPI","description":"Weather data provider","category":"weather","docsUrl":"https://weatherapi.com"}]',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Service name (lookup key in Config Center, e.g. "weatherapi")',
            },
            displayName: {
              type: 'string',
              description: 'Human-readable name (e.g. "WeatherAPI")',
            },
            description: {
              type: 'string',
              description: 'What this API key is used for',
            },
            category: {
              type: 'string',
              description: 'Category for grouping (e.g. "weather", "email")',
            },
            docsUrl: {
              type: 'string',
              description: 'Link to API docs or signup page',
            },
          },
          required: ['name'],
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
  brief: 'List all user-created custom tools',
  workflowUsable: false,
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
  brief: 'Delete an LLM-created custom tool',
  workflowUsable: false,
  description:
    'Delete a custom tool by name. IMPORTANT: Can only delete LLM-created tools. User-created tools are protected and cannot be deleted by the LLM.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the tool to delete',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to confirm deletion. Required for safety.',
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
  brief: 'Enable or disable a custom tool',
  workflowUsable: false,
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
// META-TOOLS FOR TOOL DISCOVERY
// =============================================================================

/**
 * search_tools — Search for tools by keyword, intent, or category.
 * This is the primary discovery mechanism for the LLM.
 */
export const searchToolsDefinition: ToolDefinition = {
  name: 'search_tools',
  brief: 'Find tools by keyword and get their parameter docs',
  workflowUsable: false,
  description:
    'Search for tools by keyword or intent. AND matching: "email send" finds send_email. Use "all" to list every tool. Returns parameter docs by default.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search keywords (e.g. "email", "send email", "task add"). Multiple words use AND logic. Use "all" to list everything.',
      },
      category: {
        type: 'string',
        description: 'Optional: filter by category name',
      },
      include_params: {
        type: 'boolean',
        description: 'Include full parameter docs for matched tools. Default: true.',
      },
    },
    required: ['query'],
  },
  category: 'System',
};

/**
 * get_tool_help — Meta-tool for on-demand tool documentation
 * LLM calls this to get detailed usage info for a specific tool
 */
export const getToolHelpDefinition: ToolDefinition = {
  name: 'get_tool_help',
  brief: 'Get parameter docs for one or more tools by name',
  workflowUsable: false,
  description:
    'Get parameter info for one or more tools. Accepts tool_name (single) or tool_names (array).',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Qualified tool name (e.g., "core.add_task", "core.search_web").',
      },
      tool_names: {
        type: 'array',
        description: 'Array of qualified tool names (e.g., ["core.add_task", "core.list_tasks"]).',
        items: { type: 'string' },
      },
    },
  },
  category: 'System',
};

/**
 * use_tool — Proxy tool that executes any registered tool by name.
 * This allows LLMs with small context windows to access all tools
 * without having all tool schemas in the API request.
 */
export const useToolDefinition: ToolDefinition = {
  name: 'use_tool',
  brief: 'Execute any tool by name with arguments',
  workflowUsable: false,
  description:
    'Execute a tool by its qualified name (namespace.tool_name). Core tools: "core.*", custom: "custom.*". Check params via search_tools first. Errors show correct params — read and retry.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description:
          'Qualified tool name with namespace prefix (e.g., "core.add_task", "custom.fetch_weather"). Use search_tools to discover names.',
      },
      arguments: {
        type: 'object',
        description: 'Tool arguments. Must match the tool parameter schema.',
      },
    },
    required: ['tool_name', 'arguments'],
  },
  category: 'System',
};

/**
 * batch_use_tool — Execute multiple tools in parallel.
 * Saves round-trips when the LLM needs results from several tools at once.
 */
export const batchUseToolDefinition: ToolDefinition = {
  name: 'batch_use_tool',
  brief: 'Execute multiple tools in parallel',
  workflowUsable: false,
  description: 'Execute multiple tools in parallel. Faster than sequential use_tool calls.',
  parameters: {
    type: 'object',
    properties: {
      calls: {
        type: 'array',
        description: 'Array of { tool_name, arguments } objects.',
        items: {
          type: 'object',
          properties: {
            tool_name: {
              type: 'string',
              description: 'Qualified tool name with namespace (e.g., "core.add_task")',
            },
            arguments: {
              type: 'object',
              description: 'Arguments for this tool',
            },
          },
          required: ['tool_name', 'arguments'],
        },
      },
    },
    required: ['calls'],
  },
  category: 'System',
};

/**
 * inspect_tool_source — View source code of any tool (built-in or custom).
 * Lets the LLM understand how a tool works before improving or replacing it.
 */
export const inspectToolSourceDefinition: ToolDefinition = {
  name: 'inspect_tool_source',
  brief: 'View source code of any tool (built-in or custom)',
  workflowUsable: false,
  description:
    'Get the implementation source code of a tool. For built-in tools, returns TypeScript source. For custom tools, returns JavaScript code, parameters, and metadata. Use this to understand how a tool works before improving or replacing it.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Exact name of the tool to inspect',
      },
    },
    required: ['tool_name'],
  },
  category: 'Meta',
};

/**
 * update_custom_tool — Update code or config of an existing custom tool.
 * Allows iterative improvement of custom tools without delete/recreate.
 */
export const updateCustomToolDefinition: ToolDefinition = {
  name: 'update_custom_tool',
  brief: 'Update code or config of an existing custom tool',
  workflowUsable: false,
  description:
    'Update an existing custom tool. Can change code, description, parameters, category, or permissions. Use this after inspect_tool_source to improve a custom tool.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the custom tool to update' },
      description: { type: 'string', description: 'New description (optional)' },
      parameters: {
        type: 'string',
        description: 'New JSON Schema parameters as JSON string (optional)',
      },
      code: { type: 'string', description: 'New JavaScript code (optional)' },
      category: { type: 'string', description: 'New category (optional)' },
      permissions: {
        type: 'array',
        description: 'New permissions array (optional)',
        items: {
          type: 'string',
          enum: ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling', 'local'],
        },
      },
    },
    required: ['name'],
  },
  category: 'Meta',
  requiresConfirmation: true,
};

// =============================================================================
// AGGREGATED EXPORTS
// =============================================================================

export const DYNAMIC_TOOL_DEFINITIONS: ToolDefinition[] = [
  searchToolsDefinition,
  getToolHelpDefinition,
  useToolDefinition,
  batchUseToolDefinition,
  createToolDefinition,
  listToolsDefinition,
  deleteToolDefinition,
  toggleToolDefinition,
  inspectToolSourceDefinition,
  updateCustomToolDefinition,
];

export const DYNAMIC_TOOL_NAMES = DYNAMIC_TOOL_DEFINITIONS.map((t) => t.name);
