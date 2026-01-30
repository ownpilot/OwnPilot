/**
 * Dynamic Tools System
 *
 * Allows LLM to create, register, and execute custom tools at runtime.
 * Tools are stored in the database and executed in a sandboxed environment.
 */

import * as crypto from 'node:crypto';
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
import { UTILITY_TOOLS } from './utility-tools.js';

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

import type { ConfigFieldDefinition } from '../../services/config-center.js';

/**
 * @deprecated Use RequiredConfigService instead
 */
export interface RequiredApiKey {
  /** Service name (used as lookup key in Config Center) */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Description of what this API key is used for */
  description?: string;
  /** Category for grouping in Config Center */
  category?: string;
  /** Link to the API provider's docs/signup page */
  docsUrl?: string;
}

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
  requiredApiKeys?: RequiredApiKey[];
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
// SANDBOX UTILITY HELPERS
// =============================================================================

/**
 * Create utility helpers available to dynamic tool code via `utils.*`
 * These give custom tools access to common operations without needing
 * to reimplement them from scratch.
 */
function createSandboxUtils() {
  return {
    // --- Hashing ---
    hash(text: string, algorithm: string = 'sha256'): string {
      return crypto.createHash(algorithm).update(text).digest('hex');
    },

    // --- UUID ---
    uuid(): string {
      return crypto.randomUUID();
    },

    // --- Encoding/Decoding ---
    base64Encode(text: string): string {
      return Buffer.from(text).toString('base64');
    },
    base64Decode(text: string): string {
      return Buffer.from(text, 'base64').toString('utf-8');
    },
    urlEncode(text: string): string {
      return encodeURIComponent(text);
    },
    urlDecode(text: string): string {
      return decodeURIComponent(text);
    },
    hexEncode(text: string): string {
      return Buffer.from(text).toString('hex');
    },
    hexDecode(hex: string): string {
      return Buffer.from(hex, 'hex').toString('utf-8');
    },

    // --- Date/Time ---
    now(): string {
      return new Date().toISOString();
    },
    timestamp(): number {
      return Date.now();
    },
    dateDiff(date1: string, date2: string, unit: string = 'days'): number {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      const diffMs = d2.getTime() - d1.getTime();
      const units: Record<string, number> = {
        seconds: 1000, minutes: 60000, hours: 3600000,
        days: 86400000, weeks: 604800000,
      };
      return diffMs / (units[unit] || units.days!);
    },
    dateAdd(date: string, amount: number, unit: string = 'days'): string {
      const d = date === 'now' ? new Date() : new Date(date);
      switch (unit) {
        case 'seconds': d.setSeconds(d.getSeconds() + amount); break;
        case 'minutes': d.setMinutes(d.getMinutes() + amount); break;
        case 'hours': d.setHours(d.getHours() + amount); break;
        case 'days': d.setDate(d.getDate() + amount); break;
        case 'weeks': d.setDate(d.getDate() + (amount * 7)); break;
        case 'months': d.setMonth(d.getMonth() + amount); break;
        case 'years': d.setFullYear(d.getFullYear() + amount); break;
      }
      return d.toISOString();
    },
    formatDate(date: string, locale: string = 'en-US'): string {
      return new Date(date).toLocaleDateString(locale, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    },

    // --- Text ---
    slugify(text: string): string {
      return text.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    },
    camelCase(text: string): string {
      return text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
    },
    snakeCase(text: string): string {
      return text.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
    },
    kebabCase(text: string): string {
      return text.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
    },
    titleCase(text: string): string {
      return text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
    },
    truncate(text: string, maxLength: number = 100, suffix: string = '...'): string {
      return text.length > maxLength ? text.slice(0, maxLength - suffix.length) + suffix : text;
    },
    countWords(text: string): number {
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    },
    removeDiacritics(text: string): string {
      return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },

    // --- Validation ---
    isEmail(value: string): boolean {
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
    },
    isUrl(value: string): boolean {
      try { new URL(value); return true; } catch { return false; }
    },
    isJson(value: string): boolean {
      try { JSON.parse(value); return true; } catch { return false; }
    },
    isUuid(value: string): boolean {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    },

    // --- Math ---
    clamp(value: number, min: number, max: number): number {
      return Math.min(Math.max(value, min), max);
    },
    round(value: number, decimals: number = 2): number {
      return Number(value.toFixed(decimals));
    },
    randomInt(min: number = 0, max: number = 100): number {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    sum(numbers: number[]): number {
      return numbers.reduce((a, b) => a + b, 0);
    },
    avg(numbers: number[]): number {
      return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
    },

    // --- Data ---
    parseJson(text: string): unknown {
      return JSON.parse(text);
    },
    toJson(data: unknown, indent: number = 2): string {
      return JSON.stringify(data, null, indent);
    },
    parseCsv(csv: string, delimiter: string = ','): Record<string, string>[] {
      const lines = csv.split('\n').filter(l => l.trim());
      if (lines.length < 2) return [];
      const headers = lines[0]!.split(delimiter).map(h => h.trim());
      return lines.slice(1).map(line => {
        const values = line.split(delimiter);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
        return obj;
      });
    },
    flatten(obj: Record<string, unknown>, prefix: string = ''): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(result, this.flatten(value as Record<string, unknown>, newKey));
        } else {
          result[newKey] = value;
        }
      }
      return result;
    },
    getPath(obj: unknown, path: string): unknown {
      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current: unknown = obj;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        if (typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
      return current;
    },

    // --- Array ---
    unique<T>(arr: T[]): T[] {
      return [...new Set(arr)];
    },
    chunk<T>(arr: T[], size: number): T[][] {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    },
    shuffle<T>(arr: T[]): T[] {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = temp;
      }
      return shuffled;
    },
    sample<T>(arr: T[], n: number = 1): T[] {
      return this.shuffle(arr).slice(0, n);
    },
    groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
      return arr.reduce((groups, item) => {
        const groupKey = String(item[key]);
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(item);
        return groups;
      }, {} as Record<string, T[]>);
    },

    // --- Password ---
    generatePassword(length: number = 16): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
      let password = '';
      const bytes = crypto.randomBytes(length);
      for (let i = 0; i < length; i++) {
        password += chars[bytes[i]! % chars.length];
      }
      return password;
    },
  };
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
  context: ToolContext,
  callableTools?: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
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
        log: (...logArgs: unknown[]) => console.log(`[DynamicTool:${tool.name}]`, ...logArgs),
        warn: (...logArgs: unknown[]) => console.warn(`[DynamicTool:${tool.name}]`, ...logArgs),
        error: (...logArgs: unknown[]) => console.error(`[DynamicTool:${tool.name}]`, ...logArgs),
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
         * Usage: const result = await utils.callTool('tool_name', { arg1: 'value' })
         */
        callTool: async (toolName: string, toolArgs: Record<string, unknown> = {}) => {
          // Search callable tools first (all built-in tools), then fall back to utility tools
          const allTools = callableTools ?? UTILITY_TOOLS;
          const foundTool = allTools.find(t => t.definition.name === toolName);
          if (!foundTool) {
            const available = allTools.map(t => t.definition.name).join(', ');
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
         */
        listTools: () => {
          const allTools = callableTools ?? UTILITY_TOOLS;
          return allTools.map(t => ({
            name: t.definition.name,
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
export function createDynamicToolRegistry(
  callableTools?: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
): DynamicToolRegistry {
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
- Should handle errors gracefully
- Declare API dependencies via 'required_api_keys' so they appear in Config Center for user configuration
- Has access to 'utils' helper object with: getApiKey(serviceName) to get API keys from Config Center, getServiceConfig(serviceName) to get full service config, getConfigEntry(serviceName, label?) to get a config entry's data, getConfigEntries(serviceName) to get all entries (multi-account), getFieldValue(serviceName, fieldName, label?) to get a resolved field value, callTool(name, args) to invoke any built-in tool (file system, web fetch, pdf, translation, image, email, git, audio, data extraction, weather, utilities, etc.), listTools() to list all available tools, plus hash/uuid/password generation, base64/url/hex encoding, date math (now/dateDiff/dateAdd/formatDate), text transforms (slugify/camelCase/snakeCase/titleCase/truncate), validation (isEmail/isUrl/isJson/isUuid), math (clamp/round/randomInt/sum/avg), data (parseJson/toJson/parseCsv/flatten/getPath), array (unique/chunk/shuffle/sample/groupBy)`,
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

/**
 * get_tool_help — Meta-tool for on-demand tool documentation
 * LLM calls this to get detailed usage info for a specific tool
 */
export const getToolHelpDefinition: ToolDefinition = {
  name: 'get_tool_help',
  description: 'Get detailed usage information and parameters for a specific tool. Call this before using an unfamiliar tool to learn its parameters and usage.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Name of the tool to get help for (e.g. "add_task", "remember", "search_web")',
      },
    },
    required: ['tool_name'],
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
  description: 'Execute any available tool by name with the given arguments. First call get_tool_help to learn the parameters, then call this to execute.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Name of the tool to execute (e.g. "add_task", "remember", "search_web")',
      },
      arguments: {
        type: 'object',
        description: 'Arguments to pass to the tool as a JSON object. Use get_tool_help first to learn required parameters.',
      },
    },
    required: ['tool_name', 'arguments'],
  },
  category: 'System',
};

export const DYNAMIC_TOOL_DEFINITIONS: ToolDefinition[] = [
  getToolHelpDefinition,
  useToolDefinition,
  createToolDefinition,
  listToolsDefinition,
  deleteToolDefinition,
  toggleToolDefinition,
];;;

export const DYNAMIC_TOOL_NAMES = DYNAMIC_TOOL_DEFINITIONS.map((t) => t.name);
