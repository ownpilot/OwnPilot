/**
 * Tool registry and management
 */

import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { ValidationError, NotFoundError, PluginError } from '../types/errors.js';
import { createToolId, type ToolId, type PluginId } from '../types/branded.js';
import type {
  ToolDefinition,
  ToolExecutor,
  RegisteredTool,
  ToolContext,
  ToolExecutionResult,
  ToolCall,
  ToolResult,
} from './types.js';
import { logToolCall, logToolResult } from './debug.js';
import type { ConfigCenter } from '../services/config-center.js';
// Backward compat alias
type ApiKeyCenter = ConfigCenter;

// Re-export types for consumers
export type { ToolDefinition, ToolExecutor, RegisteredTool, ToolContext, ToolExecutionResult, ToolCall, ToolResult };

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly pluginTools = new Map<string, Set<string>>();
  private _apiKeyCenter?: ApiKeyCenter;

  /**
   * Register a tool
   */
  register(
    definition: ToolDefinition,
    executor: ToolExecutor,
    pluginId?: PluginId
  ): Result<ToolId, ValidationError> {
    // Validate tool name
    if (!definition.name || definition.name.length > 64) {
      return err(new ValidationError('Tool name must be 1-64 characters'));
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(definition.name)) {
      return err(
        new ValidationError('Tool name must start with a letter and contain only alphanumeric characters and underscores')
      );
    }

    // Check for duplicate
    if (this.tools.has(definition.name)) {
      return err(new ValidationError(`Tool already registered: ${definition.name}`));
    }

    const toolId = createToolId(definition.name);

    const tool: RegisteredTool = {
      id: toolId,
      definition,
      executor,
      pluginId,
    };

    this.tools.set(definition.name, tool);

    // Track plugin association
    if (pluginId) {
      let pluginToolSet = this.pluginTools.get(pluginId);
      if (!pluginToolSet) {
        pluginToolSet = new Set();
        this.pluginTools.set(pluginId, pluginToolSet);
      }
      pluginToolSet.add(definition.name);
    }

    return ok(toolId);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    this.tools.delete(name);

    // Remove from plugin tracking
    if (tool.pluginId) {
      const pluginToolSet = this.pluginTools.get(tool.pluginId);
      if (pluginToolSet) {
        pluginToolSet.delete(name);
        if (pluginToolSet.size === 0) {
          this.pluginTools.delete(tool.pluginId);
        }
      }
    }

    return true;
  }

  /**
   * Update executor for an existing tool
   * Used to override placeholder implementations with real ones (e.g., Gmail, Media services)
   */
  updateExecutor(name: string, executor: ToolExecutor): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    tool.executor = executor;
    return true;
  }

  /**
   * Unregister all tools from a plugin
   */
  unregisterPlugin(pluginId: PluginId): number {
    const pluginToolSet = this.pluginTools.get(pluginId);
    if (!pluginToolSet) return 0;

    let count = 0;
    for (const name of pluginToolSet) {
      this.tools.delete(name);
      count++;
    }

    this.pluginTools.delete(pluginId);
    return count;
  }

  /**
   * Get a tool by name
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool definitions
   */
  getDefinitions(): readonly ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get tool definitions by names
   */
  getDefinitionsByNames(names: readonly string[]): readonly ToolDefinition[] {
    return names
      .map((name) => this.tools.get(name)?.definition)
      .filter((d): d is ToolDefinition => d !== undefined);
  }

  /**
   * Get all tool names
   */
  getNames(): readonly string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tools for a specific plugin
   */
  getPluginTools(pluginId: PluginId): readonly RegisteredTool[] {
    const names = this.pluginTools.get(pluginId);
    if (!names) return [];

    return Array.from(names)
      .map((name) => this.tools.get(name))
      .filter((t): t is RegisteredTool => t !== undefined);
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: Omit<ToolContext, 'callId'>
  ): Promise<Result<ToolExecutionResult, NotFoundError | PluginError>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return err(new NotFoundError('Tool', name));
    }

    const fullContext: ToolContext = {
      ...context,
      callId: randomUUID(),
      pluginId: tool.pluginId,
      workspaceDir: context.workspaceDir ?? this._workspaceDir,
      // Config Center accessors (if configured)
      getApiKey: this._apiKeyCenter
        ? (serviceName: string) => this._apiKeyCenter!.getApiKey(serviceName)
        : undefined,
      getServiceConfig: this._apiKeyCenter
        ? (serviceName: string) => this._apiKeyCenter!.getServiceConfig(serviceName)
        : undefined,
      getConfigEntry: this._apiKeyCenter
        ? (serviceName: string, entryLabel?: string) => this._apiKeyCenter!.getConfigEntry(serviceName, entryLabel)
        : undefined,
      getConfigEntries: this._apiKeyCenter
        ? (serviceName: string) => this._apiKeyCenter!.getConfigEntries(serviceName)
        : undefined,
      getFieldValue: this._apiKeyCenter
        ? (serviceName: string, fieldName: string, entryLabel?: string) => this._apiKeyCenter!.getFieldValue(serviceName, fieldName, entryLabel)
        : undefined,
    };

    try {
      const result = await tool.executor(args, fullContext);
      return ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PluginError(tool.pluginId ?? 'core', `Tool execution failed: ${message}`));
    }
  }

  /**
   * Set the workspace directory for file operations
   */
  setWorkspaceDir(workspaceDir: string | undefined): void {
    this._workspaceDir = workspaceDir;
  }

  /**
   * Get the workspace directory
   */
  getWorkspaceDir(): string | undefined {
    return this._workspaceDir;
  }

  /**
   * Set the Config Center for centralized service configuration.
   * Tools can then access configs via context.getApiKey(), context.getConfigEntry(), etc.
   */
  setApiKeyCenter(center: ApiKeyCenter): void {
    this._apiKeyCenter = center;
  }

  /**
   * Get the current Config Center (if set).
   */
  getApiKeyCenter(): ApiKeyCenter | undefined {
    return this._apiKeyCenter;
  }

  private _workspaceDir: string | undefined;

  /**
   * Execute a tool call from the model
   */
  async executeToolCall(
    toolCall: ToolCall,
    conversationId: string,
    userId?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments);
    } catch {
      const errorContent = `Error: Invalid JSON arguments: ${toolCall.arguments}`;
      logToolResult({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: false,
        resultPreview: errorContent,
        resultLength: errorContent.length,
        durationMs: Date.now() - startTime,
        error: 'Invalid JSON arguments',
      });
      return {
        toolCallId: toolCall.id,
        content: errorContent,
        isError: true,
      };
    }

    // Log the tool call with arguments
    logToolCall({
      id: toolCall.id,
      name: toolCall.name,
      arguments: args,
      approved: true, // It's already approved if we're here
    });

    const result = await this.execute(toolCall.name, args, {
      conversationId,
      userId,
    });

    const durationMs = Date.now() - startTime;

    if (!result.ok) {
      const errorContent = `Error: ${result.error.message}`;
      logToolResult({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: false,
        resultPreview: errorContent,
        resultLength: errorContent.length,
        durationMs,
        error: result.error.message,
      });
      return {
        toolCallId: toolCall.id,
        content: errorContent,
        isError: true,
      };
    }

    // Convert result content to string (handle undefined/null cases)
    const rawContent = result.value.content;
    const content =
      rawContent === undefined || rawContent === null
        ? ''
        : typeof rawContent === 'string'
          ? rawContent
          : JSON.stringify(rawContent);

    // Log successful tool result
    logToolResult({
      toolCallId: toolCall.id,
      name: toolCall.name,
      success: !result.value.isError,
      resultPreview: content.substring(0, 500),
      resultLength: content.length,
      durationMs,
      error: result.value.isError ? content : undefined,
    });

    return {
      toolCallId: toolCall.id,
      content,
      isError: result.value.isError,
    };
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeToolCalls(
    toolCalls: readonly ToolCall[],
    conversationId: string,
    userId?: string
  ): Promise<readonly ToolResult[]> {
    return Promise.all(
      toolCalls.map((tc) => this.executeToolCall(tc, conversationId, userId))
    );
  }

  /**
   * Get registry statistics
   */
  getStats(): { totalTools: number; pluginTools: number; coreTools: number } {
    let pluginToolCount = 0;
    for (const tool of this.tools.values()) {
      if (tool.pluginId) pluginToolCount++;
    }

    return {
      totalTools: this.tools.size,
      pluginTools: pluginToolCount,
      coreTools: this.tools.size - pluginToolCount,
    };
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.pluginTools.clear();
  }
}

/**
 * Create a global tool registry instance
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

// Workspace directory for file operations (relative to process.cwd())
const WORKSPACE_DIR = 'workspace';

/**
 * Get the workspace directory path, creating it if it doesn't exist
 */
function getWorkspacePath(): string {
  const workspacePath = path.join(process.cwd(), WORKSPACE_DIR);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
  return workspacePath;
}

/**
 * Resolve and validate a path within the workspace
 * Prevents directory traversal attacks
 */
function resolveWorkspacePath(relativePath: string): string | null {
  const workspacePath = getWorkspacePath();
  const resolvedPath = path.resolve(workspacePath, relativePath);

  // Ensure the resolved path is within the workspace
  if (!resolvedPath.startsWith(workspacePath)) {
    return null;
  }

  return resolvedPath;
}

/**
 * Built-in core tools
 */
export const CORE_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time in ISO format',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "America/New_York")',
        },
      },
    },
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'generate_uuid',
    description: 'Generate a random UUID',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_folder',
    description: 'Create a folder (directory) in the workspace. Can create nested folders.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the folder to create (e.g., "projects/my-project" or "notes/2024")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates the file if it does not exist, or overwrites if it does. Parent folders are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file (e.g., "notes/meeting.md" or "data/contacts.json")',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to read',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory within the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the directory to list (use "" or "/" for workspace root)',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list files recursively in subdirectories (default: false)',
        },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty folder from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file or folder to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder within the workspace',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current relative path of the file or folder',
        },
        destination: {
          type: 'string',
          description: 'New relative path for the file or folder',
        },
      },
      required: ['source', 'destination'],
    },
  },
  // ===== DATA & TEXT TOOLS =====
  {
    name: 'parse_json',
    description: 'Parse and validate JSON string, optionally extract specific fields',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to parse',
        },
        path: {
          type: 'string',
          description: 'Optional dot notation path to extract (e.g., "user.name" or "items[0].id")',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'format_json',
    description: 'Format/prettify JSON with indentation',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to format',
        },
        indent: {
          type: 'number',
          description: 'Number of spaces for indentation (default: 2)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'text_stats',
    description: 'Get statistics about text (word count, character count, line count, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'text_transform',
    description: 'Transform text (uppercase, lowercase, title case, reverse, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to transform',
        },
        operation: {
          type: 'string',
          description: 'Operation: uppercase, lowercase, titlecase, reverse, trim, slug',
        },
      },
      required: ['text', 'operation'],
    },
  },
  {
    name: 'search_replace',
    description: 'Search and replace text with support for regex',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to search in',
        },
        search: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        replace: {
          type: 'string',
          description: 'Replacement text',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat search as regex pattern (default: false)',
        },
        global: {
          type: 'boolean',
          description: 'If true, replace all occurrences (default: true)',
        },
      },
      required: ['text', 'search', 'replace'],
    },
  },
  // ===== DATE & TIME TOOLS =====
  {
    name: 'format_date',
    description: 'Format a date in various formats',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date string to format (ISO format or natural language like "tomorrow", "next week")',
        },
        format: {
          type: 'string',
          description: 'Output format: iso, short, long, relative, custom (with pattern)',
        },
        timezone: {
          type: 'string',
          description: 'Target timezone (default: UTC)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'date_diff',
    description: 'Calculate difference between two dates',
    parameters: {
      type: 'object',
      properties: {
        date1: {
          type: 'string',
          description: 'First date (ISO format)',
        },
        date2: {
          type: 'string',
          description: 'Second date (ISO format, defaults to now)',
        },
        unit: {
          type: 'string',
          description: 'Unit for result: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['date1'],
    },
  },
  {
    name: 'add_to_date',
    description: 'Add or subtract time from a date',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Starting date (ISO format, defaults to now)',
        },
        amount: {
          type: 'number',
          description: 'Amount to add (negative to subtract)',
        },
        unit: {
          type: 'string',
          description: 'Unit: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['amount', 'unit'],
    },
  },
  // ===== CONVERSION TOOLS =====
  {
    name: 'convert_units',
    description: 'Convert between units (length, weight, temperature, etc.)',
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'Value to convert',
        },
        from: {
          type: 'string',
          description: 'Source unit (e.g., "km", "lb", "celsius")',
        },
        to: {
          type: 'string',
          description: 'Target unit (e.g., "miles", "kg", "fahrenheit")',
        },
      },
      required: ['value', 'from', 'to'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert between currencies (uses approximate rates)',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to convert',
        },
        from: {
          type: 'string',
          description: 'Source currency code (e.g., "USD", "EUR", "TRY")',
        },
        to: {
          type: 'string',
          description: 'Target currency code',
        },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  // ===== ENCODING TOOLS =====
  {
    name: 'base64_encode',
    description: 'Encode text to Base64',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'base64_decode',
    description: 'Decode Base64 to text',
    parameters: {
      type: 'object',
      properties: {
        encoded: {
          type: 'string',
          description: 'Base64 encoded string to decode',
        },
      },
      required: ['encoded'],
    },
  },
  {
    name: 'url_encode',
    description: 'URL encode/decode text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode or decode',
        },
        decode: {
          type: 'boolean',
          description: 'If true, decode instead of encode (default: false)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'hash_text',
    description: 'Generate hash of text (MD5, SHA256, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to hash',
        },
        algorithm: {
          type: 'string',
          description: 'Hash algorithm: md5, sha1, sha256, sha512 (default: sha256)',
        },
      },
      required: ['text'],
    },
  },
  // ===== RANDOM GENERATION TOOLS =====
  {
    name: 'random_number',
    description: 'Generate a random number within a range',
    parameters: {
      type: 'object',
      properties: {
        min: {
          type: 'number',
          description: 'Minimum value (default: 0)',
        },
        max: {
          type: 'number',
          description: 'Maximum value (default: 100)',
        },
        integer: {
          type: 'boolean',
          description: 'If true, return integer only (default: true)',
        },
      },
    },
  },
  {
    name: 'random_string',
    description: 'Generate a random string',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Length of string (default: 16)',
        },
        charset: {
          type: 'string',
          description: 'Character set: alphanumeric, alpha, numeric, hex, custom',
        },
        custom: {
          type: 'string',
          description: 'Custom characters to use (when charset is "custom")',
        },
      },
    },
  },
  {
    name: 'random_choice',
    description: 'Randomly select from a list of options',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of options to choose from',
        },
        count: {
          type: 'number',
          description: 'Number of items to select (default: 1)',
        },
      },
      required: ['options'],
    },
  },
  // ===== TASK & REMINDER TOOLS =====
  {
    name: 'create_task',
    description: 'Create a task or reminder and save to workspace',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        due_date: {
          type: 'string',
          description: 'Due date (ISO format or natural language)',
        },
        priority: {
          type: 'string',
          description: 'Priority: low, medium, high',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks from workspace',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter: all, pending, completed, overdue (default: all)',
        },
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to complete',
        },
      },
      required: ['task_id'],
    },
  },
  // ===== NOTE TAKING TOOLS =====
  {
    name: 'create_note',
    description: 'Create a note in the workspace with automatic organization',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Note title',
        },
        content: {
          type: 'string',
          description: 'Note content (supports Markdown)',
        },
        category: {
          type: 'string',
          description: 'Category for organization (creates subfolder)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for the note',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search notes in workspace by title, content, or tags',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Limit search to category',
        },
      },
      required: ['query'],
    },
  },
  // ===== DATA EXTRACTION TOOLS =====
  {
    name: 'extract_urls',
    description: 'Extract all URLs from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract URLs from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_emails',
    description: 'Extract all email addresses from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract emails from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_numbers',
    description: 'Extract all numbers from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract numbers from',
        },
        include_decimals: {
          type: 'boolean',
          description: 'Include decimal numbers (default: true)',
        },
      },
      required: ['text'],
    },
  },
  // ===== LIST & DATA TOOLS =====
  {
    name: 'sort_list',
    description: 'Sort a list of items',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to sort',
        },
        order: {
          type: 'string',
          description: 'Sort order: asc, desc (default: asc)',
        },
        numeric: {
          type: 'boolean',
          description: 'Sort numerically if items are numbers (default: false)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'deduplicate',
    description: 'Remove duplicate items from a list',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to deduplicate',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Case sensitive comparison (default: true)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'create_table',
    description: 'Create a formatted table from data',
    parameters: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column headers',
        },
        rows: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'Table rows (array of arrays)',
        },
        format: {
          type: 'string',
          description: 'Output format: markdown, csv, json (default: markdown)',
        },
      },
      required: ['headers', 'rows'],
    },
  },
  // ===== VALIDATION TOOLS =====
  {
    name: 'validate_email',
    description: 'Validate if a string is a valid email address',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to validate',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'validate_url',
    description: 'Validate if a string is a valid URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to validate',
        },
      },
      required: ['url'],
    },
  },
  // ===== GENERATOR TOOLS =====
  {
    name: 'generate_password',
    description: 'Generate a secure random password',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Password length (default: 16)',
        },
        uppercase: {
          type: 'boolean',
          description: 'Include uppercase letters (default: true)',
        },
        lowercase: {
          type: 'boolean',
          description: 'Include lowercase letters (default: true)',
        },
        numbers: {
          type: 'boolean',
          description: 'Include numbers (default: true)',
        },
        symbols: {
          type: 'boolean',
          description: 'Include symbols (default: true)',
        },
      },
    },
  },
  {
    name: 'generate_lorem_ipsum',
    description: 'Generate Lorem Ipsum placeholder text',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type: words, sentences, paragraphs (default: paragraphs)',
        },
        count: {
          type: 'number',
          description: 'Number of units to generate (default: 3)',
        },
      },
    },
  },
  // ===== COLOR TOOLS =====
  {
    name: 'convert_color',
    description: 'Convert between color formats (HEX, RGB, HSL)',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'Color value (e.g., "#ff5733", "rgb(255,87,51)", "hsl(11,100%,60%)")',
        },
        to: {
          type: 'string',
          description: 'Target format: hex, rgb, hsl (default: all)',
        },
      },
      required: ['color'],
    },
  },
  // ===== TEXT COMPARISON =====
  {
    name: 'compare_texts',
    description: 'Compare two texts and show differences',
    parameters: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: 'First text',
        },
        text2: {
          type: 'string',
          description: 'Second text',
        },
        mode: {
          type: 'string',
          description: 'Comparison mode: lines, words, chars (default: lines)',
        },
      },
      required: ['text1', 'text2'],
    },
  },
  // ===== REGEX TOOLS =====
  {
    name: 'test_regex',
    description: 'Test a regular expression against text',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern',
        },
        text: {
          type: 'string',
          description: 'Text to test against',
        },
        flags: {
          type: 'string',
          description: 'Regex flags (g, i, m, etc.)',
        },
      },
      required: ['pattern', 'text'],
    },
  },
  // ===== WORD TOOLS =====
  {
    name: 'count_words',
    description: 'Count word frequency in text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
        top: {
          type: 'number',
          description: 'Show top N most frequent words (default: 10)',
        },
        min_length: {
          type: 'number',
          description: 'Minimum word length to count (default: 1)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'find_and_replace_bulk',
    description: 'Find and replace multiple patterns at once',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to process',
        },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
          },
          description: 'Array of {find, replace} pairs',
        },
      },
      required: ['text', 'replacements'],
    },
  },
  // ===== MARKDOWN TOOLS =====
  {
    name: 'markdown_to_html',
    description: 'Convert Markdown to HTML',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to convert',
        },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'strip_markdown',
    description: 'Remove Markdown formatting and return plain text',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to strip',
        },
      },
      required: ['markdown'],
    },
  },
  // ===== JSON/CSV TOOLS =====
  {
    name: 'json_to_csv',
    description: 'Convert JSON array to CSV format',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON array string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'csv_to_json',
    description: 'Convert CSV to JSON array',
    parameters: {
      type: 'object',
      properties: {
        csv: {
          type: 'string',
          description: 'CSV string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
        headers: {
          type: 'boolean',
          description: 'First row contains headers (default: true)',
        },
      },
      required: ['csv'],
    },
  },
  // ===== CALCULATION TOOLS =====
  {
    name: 'calculate_percentage',
    description: 'Calculate percentage (what % is X of Y, X% of Y, % change)',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operation: "of" (X% of Y), "is" (X is what % of Y), "change" (% change from X to Y)',
        },
        value1: {
          type: 'number',
          description: 'First value',
        },
        value2: {
          type: 'number',
          description: 'Second value',
        },
      },
      required: ['operation', 'value1', 'value2'],
    },
  },
  {
    name: 'calculate_statistics',
    description: 'Calculate statistics for a list of numbers',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers',
        },
      },
      required: ['numbers'],
    },
  },
  // ===== STRING TOOLS =====
  {
    name: 'truncate_text',
    description: 'Truncate text to specified length with ellipsis',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to truncate',
        },
        length: {
          type: 'number',
          description: 'Maximum length (default: 100)',
        },
        suffix: {
          type: 'string',
          description: 'Suffix to add (default: "...")',
        },
        word_boundary: {
          type: 'boolean',
          description: 'Cut at word boundary (default: true)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'wrap_text',
    description: 'Wrap text to specified line width',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to wrap',
        },
        width: {
          type: 'number',
          description: 'Maximum line width (default: 80)',
        },
      },
      required: ['text'],
    },
  },
  // ===== SLUG & CASE TOOLS =====
  {
    name: 'to_slug',
    description: 'Convert text to URL-friendly slug',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        separator: {
          type: 'string',
          description: 'Word separator (default: "-")',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'change_case',
    description: 'Change text case (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        case_type: {
          type: 'string',
          description: 'Target case: camel, pascal, snake, kebab, constant',
        },
      },
      required: ['text', 'case_type'],
    },
  },
  // ===== BOOKMARK & LINK TOOLS =====
  {
    name: 'create_bookmark',
    description: 'Save a bookmark/link with title and description',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to bookmark',
        },
        title: {
          type: 'string',
          description: 'Bookmark title',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['url', 'title'],
    },
  },
  {
    name: 'list_bookmarks',
    description: 'List saved bookmarks',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
        search: {
          type: 'string',
          description: 'Search in title/description',
        },
      },
    },
  },
];

/**
 * Core tool executors
 */
export const CORE_EXECUTORS: Record<string, ToolExecutor> = {
  get_current_time: async (args) => {
    const timezone = (args.timezone as string) || 'UTC';
    try {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      });
      return { content: `Current time in ${timezone}: ${formatted}` };
    } catch {
      return { content: `Current time (UTC): ${new Date().toISOString()}` };
    }
  },

  calculate: async (args) => {
    const expression = args.expression as string;

    // Only allow safe characters
    if (!/^[\d\s+\-*/().%^]+$/.test(expression)) {
      return { content: 'Error: Invalid characters in expression', isError: true };
    }

    try {
      // Safe evaluation using Function with restricted scope
      const result = new Function(`"use strict"; return (${expression})`)();
      return { content: String(result) };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : 'Invalid expression'}`,
        isError: true,
      };
    }
  },

  generate_uuid: async () => {
    return { content: randomUUID() };
  },

  create_folder: async (args) => {
    const folderPath = args.path as string;
    if (!folderPath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(folderPath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      fs.mkdirSync(resolvedPath, { recursive: true });
      return { content: `Folder created: ${folderPath}` };
    } catch (error) {
      return {
        content: `Error creating folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  write_file: async (args) => {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }
    if (content === undefined || content === null) {
      return { content: 'Error: Content is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      // Create parent directories if they don't exist
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content, 'utf-8');
      const stats = fs.statSync(resolvedPath);
      return { content: `File written: ${filePath} (${stats.size} bytes)` };
    } catch (error) {
      return {
        content: `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  read_file: async (args) => {
    const filePath = args.path as string;
    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: File not found: ${filePath}`, isError: true };
      }

      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        return { content: `Error: Path is a directory, not a file: ${filePath}`, isError: true };
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return { content };
    } catch (error) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  list_files: async (args) => {
    const dirPath = (args.path as string) || '';
    const recursive = args.recursive as boolean;

    const resolvedPath = resolveWorkspacePath(dirPath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: Directory not found: ${dirPath || '/'}`, isError: true };
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { content: `Error: Path is not a directory: ${dirPath}`, isError: true };
      }

      const listDir = (dir: string, prefix = ''): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const results: string[] = [];

        for (const entry of entries) {
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            results.push(`📁 ${relativePath}/`);
            if (recursive) {
              results.push(...listDir(path.join(dir, entry.name), relativePath));
            }
          } else {
            const filePath = path.join(dir, entry.name);
            const fileStats = fs.statSync(filePath);
            const size = fileStats.size < 1024
              ? `${fileStats.size} B`
              : fileStats.size < 1024 * 1024
                ? `${(fileStats.size / 1024).toFixed(1)} KB`
                : `${(fileStats.size / (1024 * 1024)).toFixed(1)} MB`;
            results.push(`📄 ${relativePath} (${size})`);
          }
        }

        return results;
      };

      const items = listDir(resolvedPath);
      if (items.length === 0) {
        return { content: `Directory is empty: ${dirPath || '/'}` };
      }

      return { content: `Contents of ${dirPath || '/'}:\n${items.join('\n')}` };
    } catch (error) {
      return {
        content: `Error listing directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  delete_file: async (args) => {
    const filePath = args.path as string;
    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: File or folder not found: ${filePath}`, isError: true };
      }

      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        // Only delete empty directories for safety
        const contents = fs.readdirSync(resolvedPath);
        if (contents.length > 0) {
          return { content: `Error: Directory is not empty: ${filePath}. Delete contents first.`, isError: true };
        }
        fs.rmdirSync(resolvedPath);
        return { content: `Folder deleted: ${filePath}` };
      } else {
        fs.unlinkSync(resolvedPath);
        return { content: `File deleted: ${filePath}` };
      }
    } catch (error) {
      return {
        content: `Error deleting: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  move_file: async (args) => {
    const source = args.source as string;
    const destination = args.destination as string;

    if (!source) {
      return { content: 'Error: Source path is required', isError: true };
    }
    if (!destination) {
      return { content: 'Error: Destination path is required', isError: true };
    }

    const sourcePath = resolveWorkspacePath(source);
    const destPath = resolveWorkspacePath(destination);

    if (!sourcePath) {
      return { content: 'Error: Invalid source path (must be within workspace)', isError: true };
    }
    if (!destPath) {
      return { content: 'Error: Invalid destination path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(sourcePath)) {
        return { content: `Error: Source not found: ${source}`, isError: true };
      }

      // Create parent directory of destination if it doesn't exist
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.renameSync(sourcePath, destPath);
      return { content: `Moved: ${source} → ${destination}` };
    } catch (error) {
      return {
        content: `Error moving: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  // ===== DATA & TEXT TOOLS =====
  parse_json: async (args) => {
    const jsonStr = args.json as string;
    const jsonPath = args.path as string | undefined;

    try {
      const parsed = JSON.parse(jsonStr);

      if (jsonPath) {
        // Extract value at path
        const parts = jsonPath.replace(/\[(\d+)\]/g, '.$1').split('.');
        let value: unknown = parsed;
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[part];
          } else {
            return { content: `Error: Path not found: ${jsonPath}`, isError: true };
          }
        }
        return { content: JSON.stringify(value, null, 2) };
      }

      return { content: JSON.stringify(parsed, null, 2) };
    } catch (error) {
      return {
        content: `Error parsing JSON: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
        isError: true,
      };
    }
  },

  format_json: async (args) => {
    const jsonStr = args.json as string;
    const indent = (args.indent as number) ?? 2;

    try {
      const parsed = JSON.parse(jsonStr);
      return { content: JSON.stringify(parsed, null, indent) };
    } catch (error) {
      return {
        content: `Error formatting JSON: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
        isError: true,
      };
    }
  },

  text_stats: async (args) => {
    const text = args.text as string;

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split('\n').length;
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim()).length;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;

    return {
      content: `📊 Text Statistics:
• Characters: ${chars.toLocaleString()}
• Characters (no spaces): ${charsNoSpaces.toLocaleString()}
• Words: ${words.toLocaleString()}
• Lines: ${lines.toLocaleString()}
• Sentences: ${sentences.toLocaleString()}
• Paragraphs: ${paragraphs.toLocaleString()}`,
    };
  },

  text_transform: async (args) => {
    const text = args.text as string;
    const operation = (args.operation as string).toLowerCase();

    let result: string;
    switch (operation) {
      case 'uppercase':
        result = text.toUpperCase();
        break;
      case 'lowercase':
        result = text.toLowerCase();
        break;
      case 'titlecase':
        result = text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
        break;
      case 'reverse':
        result = text.split('').reverse().join('');
        break;
      case 'trim':
        result = text.trim();
        break;
      case 'slug':
        result = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        break;
      default:
        return { content: `Error: Unknown operation: ${operation}`, isError: true };
    }

    return { content: result };
  },

  search_replace: async (args) => {
    const text = args.text as string;
    const search = args.search as string;
    const replace = args.replace as string;
    const useRegex = args.regex as boolean;
    const global = args.global !== false;

    try {
      let result: string;
      if (useRegex) {
        const flags = global ? 'g' : '';
        const regex = new RegExp(search, flags);
        result = text.replace(regex, replace);
      } else {
        if (global) {
          result = text.split(search).join(replace);
        } else {
          result = text.replace(search, replace);
        }
      }

      const count = (text.length - result.length + replace.length * (text.split(search).length - 1)) / search.length;
      return { content: `Replaced ${Math.max(0, Math.round(count))} occurrence(s):\n\n${result}` };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : 'Invalid regex'}`,
        isError: true,
      };
    }
  },

  // ===== DATE & TIME TOOLS =====
  format_date: async (args) => {
    const dateStr = args.date as string;
    const format = (args.format as string) ?? 'long';
    const timezone = (args.timezone as string) ?? 'UTC';

    try {
      let date: Date;

      // Handle natural language dates
      const now = new Date();
      const lower = dateStr.toLowerCase();
      if (lower === 'now' || lower === 'today') {
        date = now;
      } else if (lower === 'tomorrow') {
        date = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      } else if (lower === 'yesterday') {
        date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (lower === 'next week') {
        date = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else {
        date = new Date(dateStr);
      }

      if (isNaN(date.getTime())) {
        return { content: `Error: Invalid date: ${dateStr}`, isError: true };
      }

      let result: string;
      switch (format) {
        case 'iso':
          result = date.toISOString();
          break;
        case 'short':
          result = date.toLocaleDateString('en-US', { timeZone: timezone });
          break;
        case 'long':
          result = date.toLocaleDateString('en-US', {
            timeZone: timezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          break;
        case 'relative': {
          const diff = date.getTime() - now.getTime();
          const days = Math.round(diff / (24 * 60 * 60 * 1000));
          if (days === 0) result = 'Today';
          else if (days === 1) result = 'Tomorrow';
          else if (days === -1) result = 'Yesterday';
          else if (days > 0) result = `In ${days} days`;
          else result = `${Math.abs(days)} days ago`;
          break;
        }
        default:
          result = date.toISOString();
      }

      return { content: result };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : 'Invalid date'}`,
        isError: true,
      };
    }
  },

  date_diff: async (args) => {
    const date1Str = args.date1 as string;
    const date2Str = (args.date2 as string) ?? new Date().toISOString();
    const unit = (args.unit as string) ?? 'days';

    try {
      const date1 = new Date(date1Str);
      const date2 = new Date(date2Str);

      if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
        return { content: 'Error: Invalid date', isError: true };
      }

      const diffMs = date2.getTime() - date1.getTime();
      let result: number;

      switch (unit) {
        case 'seconds':
          result = diffMs / 1000;
          break;
        case 'minutes':
          result = diffMs / (1000 * 60);
          break;
        case 'hours':
          result = diffMs / (1000 * 60 * 60);
          break;
        case 'days':
          result = diffMs / (1000 * 60 * 60 * 24);
          break;
        case 'weeks':
          result = diffMs / (1000 * 60 * 60 * 24 * 7);
          break;
        case 'months':
          result = diffMs / (1000 * 60 * 60 * 24 * 30.44);
          break;
        case 'years':
          result = diffMs / (1000 * 60 * 60 * 24 * 365.25);
          break;
        default:
          return { content: `Error: Unknown unit: ${unit}`, isError: true };
      }

      return { content: `${result.toFixed(2)} ${unit}` };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : 'Invalid date'}`,
        isError: true,
      };
    }
  },

  add_to_date: async (args) => {
    const dateStr = (args.date as string) ?? new Date().toISOString();
    const amount = args.amount as number;
    const unit = args.unit as string;

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return { content: 'Error: Invalid date', isError: true };
      }

      let msToAdd: number;
      switch (unit) {
        case 'seconds':
          msToAdd = amount * 1000;
          break;
        case 'minutes':
          msToAdd = amount * 1000 * 60;
          break;
        case 'hours':
          msToAdd = amount * 1000 * 60 * 60;
          break;
        case 'days':
          msToAdd = amount * 1000 * 60 * 60 * 24;
          break;
        case 'weeks':
          msToAdd = amount * 1000 * 60 * 60 * 24 * 7;
          break;
        case 'months':
          date.setMonth(date.getMonth() + amount);
          return { content: date.toISOString() };
        case 'years':
          date.setFullYear(date.getFullYear() + amount);
          return { content: date.toISOString() };
        default:
          return { content: `Error: Unknown unit: ${unit}`, isError: true };
      }

      const newDate = new Date(date.getTime() + msToAdd);
      return { content: newDate.toISOString() };
    } catch (error) {
      return {
        content: `Error: ${error instanceof Error ? error.message : 'Invalid operation'}`,
        isError: true,
      };
    }
  },

  // ===== CONVERSION TOOLS =====
  convert_units: async (args) => {
    const value = args.value as number;
    const from = (args.from as string).toLowerCase();
    const to = (args.to as string).toLowerCase();

    // Conversion factors to base units
    const conversions: Record<string, Record<string, number>> = {
      // Length (base: meters)
      length: {
        m: 1, meter: 1, meters: 1,
        km: 1000, kilometer: 1000, kilometers: 1000,
        cm: 0.01, centimeter: 0.01, centimeters: 0.01,
        mm: 0.001, millimeter: 0.001, millimeters: 0.001,
        mi: 1609.344, mile: 1609.344, miles: 1609.344,
        yd: 0.9144, yard: 0.9144, yards: 0.9144,
        ft: 0.3048, foot: 0.3048, feet: 0.3048,
        in: 0.0254, inch: 0.0254, inches: 0.0254,
      },
      // Weight (base: grams)
      weight: {
        g: 1, gram: 1, grams: 1,
        kg: 1000, kilogram: 1000, kilograms: 1000,
        mg: 0.001, milligram: 0.001, milligrams: 0.001,
        lb: 453.592, pound: 453.592, pounds: 453.592,
        oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
        ton: 1000000, tons: 1000000,
      },
      // Temperature (special handling)
      temperature: {
        c: 1, celsius: 1,
        f: 1, fahrenheit: 1,
        k: 1, kelvin: 1,
      },
    };

    // Find which category
    let category: string | null = null;
    for (const [cat, units] of Object.entries(conversions)) {
      if (from in units && to in units) {
        category = cat;
        break;
      }
    }

    if (!category) {
      return { content: `Error: Cannot convert from ${from} to ${to}`, isError: true };
    }

    let result: number;
    if (category === 'temperature') {
      // Special temperature conversion
      const fromUnit = from.startsWith('c') ? 'c' : from.startsWith('f') ? 'f' : 'k';
      const toUnit = to.startsWith('c') ? 'c' : to.startsWith('f') ? 'f' : 'k';

      // Convert to Celsius first
      let celsius: number;
      if (fromUnit === 'c') celsius = value;
      else if (fromUnit === 'f') celsius = (value - 32) * 5 / 9;
      else celsius = value - 273.15;

      // Convert from Celsius to target
      if (toUnit === 'c') result = celsius;
      else if (toUnit === 'f') result = celsius * 9 / 5 + 32;
      else result = celsius + 273.15;
    } else {
      const categoryUnits = conversions[category];
      if (!categoryUnits) {
        return { content: `Error: Unknown category: ${category}`, isError: true };
      }
      const fromFactor = categoryUnits[from];
      const toFactor = categoryUnits[to];
      if (fromFactor === undefined || toFactor === undefined) {
        return { content: `Error: Cannot convert from ${from} to ${to}`, isError: true };
      }
      result = (value * fromFactor) / toFactor;
    }

    return { content: `${value} ${from} = ${result.toFixed(4)} ${to}` };
  },

  convert_currency: async (args) => {
    const amount = args.amount as number;
    const from = (args.from as string).toUpperCase();
    const to = (args.to as string).toUpperCase();

    // Approximate exchange rates (USD base)
    const rates: Record<string, number> = {
      USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.50, CNY: 7.24,
      TRY: 32.50, AUD: 1.53, CAD: 1.36, CHF: 0.88, INR: 83.12,
      KRW: 1320, BRL: 4.97, MXN: 17.15, RUB: 89.50, SEK: 10.42,
      NOK: 10.58, DKK: 6.87, PLN: 3.98, THB: 35.20, SGD: 1.34,
      HKD: 7.82, NZD: 1.64, ZAR: 18.65, AED: 3.67, SAR: 3.75,
    };

    if (!rates[from] || !rates[to]) {
      return { content: `Error: Unknown currency code. Supported: ${Object.keys(rates).join(', ')}`, isError: true };
    }

    const inUsd = amount / rates[from];
    const result = inUsd * rates[to];

    return { content: `${amount.toLocaleString()} ${from} = ${result.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${to}` };
  },

  // ===== ENCODING TOOLS =====
  base64_encode: async (args) => {
    const text = args.text as string;
    return { content: Buffer.from(text, 'utf-8').toString('base64') };
  },

  base64_decode: async (args) => {
    const encoded = args.encoded as string;
    try {
      return { content: Buffer.from(encoded, 'base64').toString('utf-8') };
    } catch {
      return { content: 'Error: Invalid Base64 string', isError: true };
    }
  },

  url_encode: async (args) => {
    const text = args.text as string;
    const decode = args.decode as boolean;

    try {
      if (decode) {
        return { content: decodeURIComponent(text) };
      }
      return { content: encodeURIComponent(text) };
    } catch {
      return { content: 'Error: Invalid URL encoding', isError: true };
    }
  },

  hash_text: async (args) => {
    const text = args.text as string;
    const algorithm = (args.algorithm as string) ?? 'sha256';

    const validAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];
    if (!validAlgorithms.includes(algorithm)) {
      return { content: `Error: Invalid algorithm. Use: ${validAlgorithms.join(', ')}`, isError: true };
    }

    const hash = createHash(algorithm).update(text).digest('hex');
    return { content: `${algorithm.toUpperCase()}: ${hash}` };
  },

  // ===== RANDOM GENERATION TOOLS =====
  random_number: async (args) => {
    const min = (args.min as number) ?? 0;
    const max = (args.max as number) ?? 100;
    const integer = args.integer !== false;

    const random = Math.random() * (max - min) + min;
    const result = integer ? Math.floor(random) : random;

    return { content: String(result) };
  },

  random_string: async (args) => {
    const length = (args.length as number) ?? 16;
    const charset = (args.charset as string) ?? 'alphanumeric';
    const custom = args.custom as string;

    let chars: string;
    switch (charset) {
      case 'alpha':
        chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        break;
      case 'numeric':
        chars = '0123456789';
        break;
      case 'hex':
        chars = '0123456789abcdef';
        break;
      case 'custom':
        chars = custom || 'abcdefghijklmnopqrstuvwxyz';
        break;
      default:
        chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    }

    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return { content: result };
  },

  random_choice: async (args) => {
    const options = args.options as string[];
    const count = Math.min((args.count as number) ?? 1, options.length);

    if (count === 1) {
      return { content: options[Math.floor(Math.random() * options.length)] };
    }

    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return { content: shuffled.slice(0, count).join(', ') };
  },

  // ===== TASK & REMINDER TOOLS =====
  create_task: async (args) => {
    const title = args.title as string;
    const description = args.description as string | undefined;
    const dueDate = args.due_date as string | undefined;
    const priority = (args.priority as string) ?? 'medium';
    const tags = (args.tags as string[]) ?? [];

    const taskId = randomUUID().slice(0, 8);
    const task = {
      id: taskId,
      title,
      description,
      dueDate,
      priority,
      tags,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const tasksPath = resolveWorkspacePath('tasks');
    if (tasksPath) {
      if (!fs.existsSync(tasksPath)) {
        fs.mkdirSync(tasksPath, { recursive: true });
      }

      const tasksFile = path.join(tasksPath, 'tasks.json');
      let tasks: unknown[] = [];
      if (fs.existsSync(tasksFile)) {
        tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
      }
      tasks.push(task);
      fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
    }

    return {
      content: `✅ Task created (ID: ${taskId})
📌 ${title}${description ? `\n📝 ${description}` : ''}${dueDate ? `\n📅 Due: ${dueDate}` : ''}
🏷️ Priority: ${priority}${tags.length ? `\n🔖 Tags: ${tags.join(', ')}` : ''}`,
    };
  },

  list_tasks: async (args) => {
    const filter = (args.filter as string) ?? 'all';
    const tagFilter = args.tag as string | undefined;

    const tasksPath = resolveWorkspacePath('tasks/tasks.json');
    if (!tasksPath || !fs.existsSync(tasksPath)) {
      return { content: 'No tasks found. Create your first task!' };
    }

    let tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8')) as Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      dueDate?: string;
      tags?: string[];
    }>;

    // Apply filters
    if (filter === 'pending') {
      tasks = tasks.filter((t) => t.status === 'pending');
    } else if (filter === 'completed') {
      tasks = tasks.filter((t) => t.status === 'completed');
    } else if (filter === 'overdue') {
      const now = new Date();
      tasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status === 'pending');
    }

    if (tagFilter) {
      tasks = tasks.filter((t) => t.tags?.includes(tagFilter));
    }

    if (tasks.length === 0) {
      return { content: 'No tasks match the filter.' };
    }

    const taskList = tasks.map((t) => {
      const status = t.status === 'completed' ? '✅' : '⬜';
      const priority = t.priority === 'high' ? '🔴' : t.priority === 'low' ? '🟢' : '🟡';
      return `${status} ${priority} [${t.id}] ${t.title}${t.dueDate ? ` (Due: ${t.dueDate})` : ''}`;
    });

    return { content: `📋 Tasks (${tasks.length}):\n${taskList.join('\n')}` };
  },

  complete_task: async (args) => {
    const taskId = args.task_id as string;

    const tasksPath = resolveWorkspacePath('tasks/tasks.json');
    if (!tasksPath || !fs.existsSync(tasksPath)) {
      return { content: 'Error: No tasks found', isError: true };
    }

    const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8')) as Array<{
      id: string;
      title: string;
      status: string;
    }>;

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { content: `Error: Task not found: ${taskId}`, isError: true };
    }

    task.status = 'completed';
    fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));

    return { content: `✅ Task completed: ${task.title}` };
  },

  // ===== NOTE TAKING TOOLS =====
  create_note: async (args) => {
    const title = args.title as string;
    const content = args.content as string;
    const category = (args.category as string) ?? 'general';
    const tags = (args.tags as string[]) ?? [];

    const notesDir = resolveWorkspacePath(`notes/${category}`);
    if (!notesDir) {
      return { content: 'Error: Invalid path', isError: true };
    }

    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${slug}.md`;
    const filepath = path.join(notesDir, filename);

    const noteContent = `---
title: ${title}
category: ${category}
tags: [${tags.join(', ')}]
created: ${new Date().toISOString()}
---

${content}
`;

    fs.writeFileSync(filepath, noteContent);

    return { content: `📝 Note created: notes/${category}/${filename}` };
  },

  search_notes: async (args) => {
    const query = (args.query as string).toLowerCase();
    const category = args.category as string | undefined;

    const notesDir = resolveWorkspacePath(category ? `notes/${category}` : 'notes');
    if (!notesDir || !fs.existsSync(notesDir)) {
      return { content: 'No notes found.' };
    }

    const results: string[] = [];

    const searchDir = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.md')) {
          const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
          if (content.includes(query) || entry.name.toLowerCase().includes(query)) {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            results.push(`📄 notes/${relativePath}`);
          }
        }
      }
    };

    searchDir(notesDir);

    if (results.length === 0) {
      return { content: `No notes found matching "${query}"` };
    }

    return { content: `🔍 Found ${results.length} note(s):\n${results.join('\n')}` };
  },

  // ===== DATA EXTRACTION TOOLS =====
  extract_urls: async (args) => {
    const text = args.text as string;
    const urlRegex = /https?:\/\/[^\s<>\"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];

    if (urls.length === 0) {
      return { content: 'No URLs found.' };
    }

    const unique = [...new Set(urls)];
    return { content: `Found ${unique.length} URL(s):\n${unique.join('\n')}` };
  },

  extract_emails: async (args) => {
    const text = args.text as string;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailRegex) || [];

    if (emails.length === 0) {
      return { content: 'No email addresses found.' };
    }

    const unique = [...new Set(emails)];
    return { content: `Found ${unique.length} email(s):\n${unique.join('\n')}` };
  },

  extract_numbers: async (args) => {
    const text = args.text as string;
    const includeDecimals = args.include_decimals !== false;

    const regex = includeDecimals ? /-?\d+\.?\d*/g : /-?\d+/g;
    const numbers = text.match(regex) || [];

    if (numbers.length === 0) {
      return { content: 'No numbers found.' };
    }

    return { content: `Found ${numbers.length} number(s): ${numbers.join(', ')}` };
  },

  // ===== LIST & DATA TOOLS =====
  sort_list: async (args) => {
    const items = args.items as string[];
    const order = (args.order as string) ?? 'asc';
    const numeric = args.numeric as boolean;

    const sorted = [...items].sort((a, b) => {
      if (numeric) {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        return order === 'desc' ? numB - numA : numA - numB;
      }
      return order === 'desc' ? b.localeCompare(a) : a.localeCompare(b);
    });

    return { content: sorted.join('\n') };
  },

  deduplicate: async (args) => {
    const items = args.items as string[];
    const caseSensitive = args.case_sensitive !== false;

    let unique: string[];
    if (caseSensitive) {
      unique = [...new Set(items)];
    } else {
      const seen = new Set<string>();
      unique = items.filter((item) => {
        const lower = item.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
    }

    const removed = items.length - unique.length;
    return { content: `Removed ${removed} duplicate(s):\n${unique.join('\n')}` };
  },

  create_table: async (args) => {
    const headers = args.headers as string[];
    const rows = args.rows as string[][];
    const format = (args.format as string) ?? 'markdown';

    if (format === 'csv') {
      const csvRows = [headers.join(','), ...rows.map((r) => r.join(','))];
      return { content: csvRows.join('\n') };
    }

    if (format === 'json') {
      const jsonRows = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });
      return { content: JSON.stringify(jsonRows, null, 2) };
    }

    // Markdown table
    const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || '').length)));

    const headerRow = '| ' + headers.map((h, i) => h.padEnd(colWidths[i] ?? h.length)).join(' | ') + ' |';
    const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
    const dataRows = rows.map((r) => '| ' + headers.map((_, i) => (r[i] || '').padEnd(colWidths[i] ?? 0)).join(' | ') + ' |');

    return { content: [headerRow, separator, ...dataRows].join('\n') };
  },

  // ===== VALIDATION TOOLS =====
  validate_email: async (args) => {
    const email = args.email as string;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);

    if (isValid) {
      const [local, domain] = email.split('@');
      return {
        content: `✅ Valid email address
📧 Email: ${email}
👤 Local part: ${local}
🌐 Domain: ${domain}`,
      };
    }
    return { content: `❌ Invalid email address: ${email}`, isError: true };
  },

  validate_url: async (args) => {
    const url = args.url as string;
    try {
      const parsed = new URL(url);
      return {
        content: `✅ Valid URL
🔗 Full URL: ${url}
📋 Protocol: ${parsed.protocol}
🌐 Host: ${parsed.host}
📁 Path: ${parsed.pathname}
🔍 Search: ${parsed.search || '(none)'}
#️⃣ Hash: ${parsed.hash || '(none)'}`,
      };
    } catch {
      return { content: `❌ Invalid URL: ${url}`, isError: true };
    }
  },

  // ===== GENERATOR TOOLS =====
  generate_password: async (args) => {
    const length = (args.length as number) ?? 16;
    const useUpper = args.uppercase !== false;
    const useLower = args.lowercase !== false;
    const useNumbers = args.numbers !== false;
    const useSymbols = args.symbols !== false;

    let charset = '';
    if (useUpper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useLower) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (useNumbers) charset += '0123456789';
    if (useSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!charset) {
      return { content: 'Error: At least one character type must be enabled', isError: true };
    }

    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return {
      content: `🔐 Generated Password:
${password}

📊 Strength: ${length >= 16 ? 'Strong' : length >= 12 ? 'Medium' : 'Weak'}
📏 Length: ${length} characters`,
    };
  },

  generate_lorem_ipsum: async (args) => {
    const type = (args.type as string) ?? 'paragraphs';
    const count = (args.count as number) ?? 3;

    const words = [
      'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
      'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
      'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
      'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
      'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
      'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
      'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
      'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum',
    ];

    const getWord = () => words[Math.floor(Math.random() * words.length)];
    const getSentence = () => {
      const len = 8 + Math.floor(Math.random() * 10);
      const sentence = Array.from({ length: len }, getWord).join(' ');
      return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
    };
    const getParagraph = () => {
      const len = 3 + Math.floor(Math.random() * 4);
      return Array.from({ length: len }, getSentence).join(' ');
    };

    let result: string;
    switch (type) {
      case 'words':
        result = Array.from({ length: count }, getWord).join(' ');
        break;
      case 'sentences':
        result = Array.from({ length: count }, getSentence).join(' ');
        break;
      default:
        result = Array.from({ length: count }, getParagraph).join('\n\n');
    }

    return { content: result };
  },

  // ===== COLOR TOOLS =====
  convert_color: async (args) => {
    const color = (args.color as string).trim();
    const to = args.to as string | undefined;

    let r: number, g: number, b: number;

    // Parse HEX
    const hexMatch = color.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (hexMatch && hexMatch[1]) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // Parse RGB
    else if (color.match(/^rgb/i)) {
      const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
      } else {
        return { content: 'Error: Invalid RGB format', isError: true };
      }
    }
    // Parse HSL
    else if (color.match(/^hsl/i)) {
      const hslMatch = color.match(/hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/i);
      if (hslMatch && hslMatch[1] && hslMatch[2] && hslMatch[3]) {
        const h = parseInt(hslMatch[1]) / 360;
        const s = parseInt(hslMatch[2]) / 100;
        const l = parseInt(hslMatch[3]) / 100;

        if (s === 0) {
          r = g = b = Math.round(l * 255);
        } else {
          const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          };
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
          g = Math.round(hue2rgb(p, q, h) * 255);
          b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
        }
      } else {
        return { content: 'Error: Invalid HSL format', isError: true };
      }
    } else {
      return { content: 'Error: Unrecognized color format', isError: true };
    }

    // Convert to all formats
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    const rgb = `rgb(${r}, ${g}, ${b})`;

    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const rr = r / 255, gg = g / 255, bb = b / 255;
      if (rr === max) h = (gg - bb) / d + (gg < bb ? 6 : 0);
      else if (gg === max) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h /= 6;
    }
    const hsl = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;

    if (to === 'hex') return { content: hex };
    if (to === 'rgb') return { content: rgb };
    if (to === 'hsl') return { content: hsl };

    return {
      content: `🎨 Color Conversion:
HEX: ${hex}
RGB: ${rgb}
HSL: ${hsl}`,
    };
  },

  // ===== TEXT COMPARISON =====
  compare_texts: async (args) => {
    const text1 = args.text1 as string;
    const text2 = args.text2 as string;
    const mode = (args.mode as string) ?? 'lines';

    let units1: string[];
    let units2: string[];

    switch (mode) {
      case 'words':
        units1 = text1.split(/\s+/);
        units2 = text2.split(/\s+/);
        break;
      case 'chars':
        units1 = text1.split('');
        units2 = text2.split('');
        break;
      default:
        units1 = text1.split('\n');
        units2 = text2.split('\n');
    }

    const added = units2.filter((u) => !units1.includes(u));
    const removed = units1.filter((u) => !units2.includes(u));
    const same = units1.filter((u) => units2.includes(u));

    return {
      content: `📊 Text Comparison (${mode}):

✅ Same: ${same.length}
➕ Added: ${added.length}
➖ Removed: ${removed.length}

${added.length > 0 ? `\n➕ Added:\n${added.slice(0, 10).map((u) => `  + ${u}`).join('\n')}${added.length > 10 ? `\n  ... and ${added.length - 10} more` : ''}` : ''}
${removed.length > 0 ? `\n➖ Removed:\n${removed.slice(0, 10).map((u) => `  - ${u}`).join('\n')}${removed.length > 10 ? `\n  ... and ${removed.length - 10} more` : ''}` : ''}`,
    };
  },

  // ===== REGEX TOOLS =====
  test_regex: async (args) => {
    const pattern = args.pattern as string;
    const text = args.text as string;
    const flags = (args.flags as string) ?? 'g';

    try {
      const regex = new RegExp(pattern, flags);
      const matches = text.match(regex);

      if (!matches || matches.length === 0) {
        return { content: '❌ No matches found' };
      }

      return {
        content: `✅ Found ${matches.length} match(es):

Pattern: /${pattern}/${flags}

Matches:
${matches.map((m, i) => `${i + 1}. "${m}"`).join('\n')}`,
      };
    } catch (error) {
      return {
        content: `Error: Invalid regex - ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
      };
    }
  },

  // ===== WORD TOOLS =====
  count_words: async (args) => {
    const text = args.text as string;
    const top = (args.top as number) ?? 10;
    const minLength = (args.min_length as number) ?? 1;

    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const freq: Record<string, number> = {};

    for (const word of words) {
      if (word.length >= minLength) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top);

    const total = words.filter((w) => w.length >= minLength).length;
    const unique = Object.keys(freq).length;

    return {
      content: `📊 Word Frequency Analysis:

Total words: ${total}
Unique words: ${unique}

Top ${Math.min(top, sorted.length)} words:
${sorted.map(([word, count], i) => `${i + 1}. "${word}" - ${count} times`).join('\n')}`,
    };
  },

  find_and_replace_bulk: async (args) => {
    const text = args.text as string;
    const replacements = args.replacements as Array<{ find: string; replace: string }>;

    let result = text;
    let totalReplacements = 0;

    for (const { find, replace } of replacements) {
      const before = result;
      result = result.split(find).join(replace);
      totalReplacements += (before.length - result.length + replace.length * (before.split(find).length - 1)) / find.length;
    }

    return {
      content: `Made ${Math.max(0, Math.round(totalReplacements))} replacements:\n\n${result}`,
    };
  },

  // ===== MARKDOWN TOOLS =====
  markdown_to_html: async (args) => {
    const md = args.markdown as string;

    // Simple markdown to HTML conversion
    let html = md
      // Headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Bold and italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Lists
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      // Line breaks
      .replace(/\n/g, '<br>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');

    return { content: html };
  },

  strip_markdown: async (args) => {
    const md = args.markdown as string;

    const plain = md
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/___(.*?)___/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      // Remove code
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      // Remove links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      // Remove list markers
      .replace(/^\* /gm, '')
      .replace(/^- /gm, '')
      .replace(/^\d+\. /gm, '')
      // Remove blockquotes
      .replace(/^> /gm, '')
      // Remove horizontal rules
      .replace(/^---+$/gm, '');

    return { content: plain.trim() };
  },

  // ===== JSON/CSV TOOLS =====
  json_to_csv: async (args) => {
    const jsonStr = args.json as string;
    const delimiter = (args.delimiter as string) ?? ',';

    try {
      const data = JSON.parse(jsonStr);
      if (!Array.isArray(data)) {
        return { content: 'Error: JSON must be an array', isError: true };
      }
      if (data.length === 0) {
        return { content: 'Error: Array is empty', isError: true };
      }

      const headers = Object.keys(data[0]);
      const rows = data.map((obj) =>
        headers.map((h) => {
          const val = String(obj[h] ?? '');
          return val.includes(delimiter) || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        }).join(delimiter)
      );

      return { content: [headers.join(delimiter), ...rows].join('\n') };
    } catch (error) {
      return { content: `Error: ${error instanceof Error ? error.message : 'Invalid JSON'}`, isError: true };
    }
  },

  csv_to_json: async (args) => {
    const csv = args.csv as string;
    const delimiter = (args.delimiter as string) ?? ',';
    const hasHeaders = args.headers !== false;

    const lines = csv.trim().split('\n');
    const firstLine = lines[0];
    if (lines.length === 0 || !firstLine) {
      return { content: 'Error: CSV is empty', isError: true };
    }

    const parseRow = (row: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          if (inQuotes && row[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current);
      return values;
    };

    const headers = hasHeaders ? parseRow(firstLine) : parseRow(firstLine).map((_, i) => `column${i + 1}`);
    const dataLines = hasHeaders ? lines.slice(1) : lines;

    const result = dataLines.map((line) => {
      const values = parseRow(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      return obj;
    });

    return { content: JSON.stringify(result, null, 2) };
  },

  // ===== CALCULATION TOOLS =====
  calculate_percentage: async (args) => {
    const operation = args.operation as string;
    const value1 = args.value1 as number;
    const value2 = args.value2 as number;

    let result: number;
    let description: string;

    switch (operation.toLowerCase()) {
      case 'of':
        result = (value1 / 100) * value2;
        description = `${value1}% of ${value2} = ${result.toFixed(2)}`;
        break;
      case 'is':
        result = (value1 / value2) * 100;
        description = `${value1} is ${result.toFixed(2)}% of ${value2}`;
        break;
      case 'change':
        result = ((value2 - value1) / value1) * 100;
        description = `Change from ${value1} to ${value2} = ${result >= 0 ? '+' : ''}${result.toFixed(2)}%`;
        break;
      default:
        return { content: 'Error: Operation must be "of", "is", or "change"', isError: true };
    }

    return { content: description };
  },

  calculate_statistics: async (args) => {
    const numbers = args.numbers as number[];

    if (numbers.length === 0) {
      return { content: 'Error: Array is empty', isError: true };
    }

    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = numbers.reduce((a, b) => a + b, 0);
    const mean = sum / numbers.length;
    const len = numbers.length;
    const median = len % 2 === 0
      ? ((sorted[len / 2 - 1] ?? 0) + (sorted[len / 2] ?? 0)) / 2
      : (sorted[Math.floor(len / 2)] ?? 0);
    const variance = numbers.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numbers.length;
    const stdDev = Math.sqrt(variance);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const range = max - min;

    return {
      content: `📊 Statistics:

Count: ${numbers.length}
Sum: ${sum.toFixed(2)}
Mean: ${mean.toFixed(2)}
Median: ${median.toFixed(2)}
Min: ${min}
Max: ${max}
Range: ${range}
Std Dev: ${stdDev.toFixed(2)}
Variance: ${variance.toFixed(2)}`,
    };
  },

  // ===== STRING TOOLS =====
  truncate_text: async (args) => {
    const text = args.text as string;
    const length = (args.length as number) ?? 100;
    const suffix = (args.suffix as string) ?? '...';
    const wordBoundary = args.word_boundary !== false;

    if (text.length <= length) {
      return { content: text };
    }

    let truncated = text.slice(0, length - suffix.length);
    if (wordBoundary) {
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > length / 2) {
        truncated = truncated.slice(0, lastSpace);
      }
    }

    return { content: truncated + suffix };
  },

  wrap_text: async (args) => {
    const text = args.text as string;
    const width = (args.width as number) ?? 80;

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= width) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    return { content: lines.join('\n') };
  },

  // ===== SLUG & CASE TOOLS =====
  to_slug: async (args) => {
    const text = args.text as string;
    const separator = (args.separator as string) ?? '-';

    const slug = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, separator)
      .replace(new RegExp(`${separator}+`, 'g'), separator);

    return { content: slug };
  },

  change_case: async (args) => {
    const text = args.text as string;
    const caseType = (args.case_type as string).toLowerCase();

    // Split into words
    const words = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    let result: string;
    switch (caseType) {
      case 'camel':
        result = words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
        break;
      case 'pascal':
        result = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        break;
      case 'snake':
        result = words.join('_');
        break;
      case 'kebab':
        result = words.join('-');
        break;
      case 'constant':
        result = words.join('_').toUpperCase();
        break;
      default:
        return { content: `Error: Unknown case type: ${caseType}`, isError: true };
    }

    return { content: result };
  },

  // ===== BOOKMARK TOOLS =====
  create_bookmark: async (args) => {
    const url = args.url as string;
    const title = args.title as string;
    const description = args.description as string | undefined;
    const tags = (args.tags as string[]) ?? [];

    const bookmark = {
      id: randomUUID().slice(0, 8),
      url,
      title,
      description,
      tags,
      createdAt: new Date().toISOString(),
    };

    const bookmarksDir = resolveWorkspacePath('bookmarks');
    if (bookmarksDir) {
      if (!fs.existsSync(bookmarksDir)) {
        fs.mkdirSync(bookmarksDir, { recursive: true });
      }

      const bookmarksFile = path.join(bookmarksDir, 'bookmarks.json');
      let bookmarks: unknown[] = [];
      if (fs.existsSync(bookmarksFile)) {
        bookmarks = JSON.parse(fs.readFileSync(bookmarksFile, 'utf-8'));
      }
      bookmarks.push(bookmark);
      fs.writeFileSync(bookmarksFile, JSON.stringify(bookmarks, null, 2));
    }

    return {
      content: `🔖 Bookmark saved!
📌 ${title}
🔗 ${url}${description ? `\n📝 ${description}` : ''}${tags.length ? `\n🏷️ ${tags.join(', ')}` : ''}`,
    };
  },

  list_bookmarks: async (args) => {
    const tagFilter = args.tag as string | undefined;
    const searchQuery = args.search as string | undefined;

    const bookmarksPath = resolveWorkspacePath('bookmarks/bookmarks.json');
    if (!bookmarksPath || !fs.existsSync(bookmarksPath)) {
      return { content: 'No bookmarks found. Create your first bookmark!' };
    }

    let bookmarks = JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8')) as Array<{
      id: string;
      url: string;
      title: string;
      description?: string;
      tags?: string[];
      createdAt: string;
    }>;

    if (tagFilter) {
      bookmarks = bookmarks.filter((b) => b.tags?.includes(tagFilter));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      bookmarks = bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description?.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    if (bookmarks.length === 0) {
      return { content: 'No bookmarks match the filter.' };
    }

    const list = bookmarks.map((b) => `📌 ${b.title}\n   🔗 ${b.url}${b.tags?.length ? `\n   🏷️ ${b.tags.join(', ')}` : ''}`);

    return { content: `🔖 Bookmarks (${bookmarks.length}):\n\n${list.join('\n\n')}` };
  },
};

/**
 * Register core tools in a registry
 */
export function registerCoreTools(registry: ToolRegistry): void {
  for (const tool of CORE_TOOLS) {
    const executor = CORE_EXECUTORS[tool.name];
    if (executor) {
      registry.register(tool, executor);
    }
  }
}
