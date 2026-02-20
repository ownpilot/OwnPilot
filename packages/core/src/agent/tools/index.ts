/**
 * Tools Index
 * Export all tool modules and provide unified registration
 */

// =============================================================================
// EXPORTS - Module resolver (used by gateway for pnpm strict mode)
// =============================================================================

export { setModuleResolver, tryImport } from './module-resolver.js';

// =============================================================================
// IMPORTS - Tool sets
// =============================================================================

import { FILE_SYSTEM_TOOLS } from './file-system.js';
import { CODE_EXECUTION_TOOLS } from './code-execution.js';
import { WEB_FETCH_TOOLS } from './web-fetch.js';
import { EXPENSE_TRACKER_TOOLS } from './expense-tracker.js';
import { CUSTOM_DATA_TOOLS, CUSTOM_DATA_TOOL_NAMES } from './custom-data.js';
import { MEMORY_TOOLS, MEMORY_TOOL_NAMES } from './memory-tools.js';
import { GOAL_TOOLS, GOAL_TOOL_NAMES } from './goal-tools.js';
import { PERSONAL_DATA_TOOLS, PERSONAL_DATA_TOOL_NAMES } from './personal-data.js';

// New tool imports
import { PDF_TOOLS, PDF_TOOL_NAMES } from './pdf-tools.js';
import { IMAGE_TOOLS, IMAGE_TOOL_NAMES } from './image-tools.js';
import { EMAIL_TOOLS, EMAIL_TOOL_NAMES } from './email-tools.js';
import { GIT_TOOLS, GIT_TOOL_NAMES } from './git-tools.js';
import { AUDIO_TOOLS, AUDIO_TOOL_NAMES } from './audio-tools.js';
import { DATA_EXTRACTION_TOOLS, DATA_EXTRACTION_TOOL_NAMES } from './data-extraction-tools.js';
import { WEATHER_TOOLS, WEATHER_TOOL_NAMES } from './weather-tools.js';

// Dynamic tools (LLM-created tools management)
import {
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
  createDynamicToolRegistry,
  type DynamicToolRegistry,
  type DynamicToolDefinition,
  type DynamicToolPermission,
} from './dynamic-tools.js';

// Utility tools (date/time, calculations, conversions, text utilities)
import { UTILITY_TOOLS, UTILITY_TOOL_NAMES } from './utility-tools.js';

// Tool search tags for discovery
import { TOOL_SEARCH_TAGS } from './tool-tags.js';

// Tool max limits for list-returning tools
import { TOOL_MAX_LIMITS, applyToolLimits } from './tool-limits.js';
import type { ToolLimit } from './tool-limits.js';

import type { ToolDefinition, ToolExecutor, ToolRegistry as IToolRegistry } from '../tools.js';
import { qualifyToolName, getBaseName } from '../tool-namespace.js';

// =============================================================================
// TOOL SETS
// =============================================================================

/**
 * All available tool sets
 */
export const TOOL_SETS = {
  // Core tools
  fileSystem: FILE_SYSTEM_TOOLS,
  codeExecution: CODE_EXECUTION_TOOLS,
  webFetch: WEB_FETCH_TOOLS,
  expenseTracker: EXPENSE_TRACKER_TOOLS,

  // New tool sets
  pdf: PDF_TOOLS,
  image: IMAGE_TOOLS,
  email: EMAIL_TOOLS,
  git: GIT_TOOLS,
  audio: AUDIO_TOOLS,
  dataExtraction: DATA_EXTRACTION_TOOLS,
  weather: WEATHER_TOOLS,
  utility: UTILITY_TOOLS,
} as const;

// =============================================================================
// TOOL NAME EXPORTS
// =============================================================================

/**
 * Core tool sets (with built-in executors)
 */
export { FILE_SYSTEM_TOOLS };
export { CODE_EXECUTION_TOOLS };
export { WEB_FETCH_TOOLS };
export { EXPENSE_TRACKER_TOOLS };

/**
 * Custom data tools (definitions only - executors are in gateway)
 * These are safe, structured data operations without code execution
 */
export { CUSTOM_DATA_TOOLS, CUSTOM_DATA_TOOL_NAMES };

/**
 * Memory tools (definitions only - executors are in gateway)
 * Persistent memory for the autonomous AI assistant
 */
export { MEMORY_TOOLS, MEMORY_TOOL_NAMES };

/**
 * Goal tools (definitions only - executors are in gateway)
 * Long-term objective tracking for the autonomous AI assistant
 */
export { GOAL_TOOLS, GOAL_TOOL_NAMES };

/**
 * Personal data tools (definitions only - executors are in gateway)
 * Tasks, bookmarks, notes, calendar, contacts
 */
export { PERSONAL_DATA_TOOLS, PERSONAL_DATA_TOOL_NAMES };

/**
 * PDF tools
 * Read, create, and extract info from PDF documents
 */
export { PDF_TOOLS, PDF_TOOL_NAMES };

/**
 * Image tools
 * Image analysis (Vision API) and generation (DALL-E)
 */
export { IMAGE_TOOLS, IMAGE_TOOL_NAMES };

/**
 * Email tools
 * Send and receive emails via SMTP/IMAP
 */
export { EMAIL_TOOLS, EMAIL_TOOL_NAMES };

/**
 * Git tools
 * Version control operations
 */
export { GIT_TOOLS, GIT_TOOL_NAMES };

/**
 * Audio tools
 * Text-to-speech and speech-to-text (Whisper)
 */
export { AUDIO_TOOLS, AUDIO_TOOL_NAMES };

/**
 * Data extraction tools
 * Extract structured data from unstructured content
 */
export { DATA_EXTRACTION_TOOLS, DATA_EXTRACTION_TOOL_NAMES };

/**
 * Weather tools
 * Get current weather and forecasts
 */
export { WEATHER_TOOLS, WEATHER_TOOL_NAMES };

/**
 * Dynamic tools (Meta tools for LLM-created tools)
 * Create, list, delete, and toggle custom tools at runtime
 */
export {
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
  createDynamicToolRegistry,
  type DynamicToolRegistry,
  type DynamicToolDefinition,
  type DynamicToolPermission,
};

/**
 * Utility tools
 * Date/time, calculations, unit conversions, text utilities, validation
 */
export { UTILITY_TOOLS, UTILITY_TOOL_NAMES };

/**
 * Tool search tags for discovery via search_tools
 */
export { TOOL_SEARCH_TAGS };

/**
 * Tool max limits for list-returning tools
 * Enforced in use_tool proxy to prevent unbounded queries
 */
export { TOOL_MAX_LIMITS, applyToolLimits, type ToolLimit };

// =============================================================================
// ALL TOOLS COMBINED
// =============================================================================

/**
 * All tools combined (tools with built-in executors)
 */
export const ALL_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  // Core tools
  ...FILE_SYSTEM_TOOLS,
  ...CODE_EXECUTION_TOOLS,
  ...WEB_FETCH_TOOLS,
  ...EXPENSE_TRACKER_TOOLS,

  // New tools
  ...PDF_TOOLS,
  ...IMAGE_TOOLS,
  ...EMAIL_TOOLS,
  ...GIT_TOOLS,
  ...AUDIO_TOOLS,
  ...DATA_EXTRACTION_TOOLS,
  ...WEATHER_TOOLS,

  // Utility tools
  ...UTILITY_TOOLS,
];

/**
 * All tool names for quick lookup
 */
export const ALL_TOOL_NAMES: string[] = ALL_TOOLS.map((t) => t.definition.name);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get tool definitions only
 */
export function getToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map((t) => t.definition);
}

/**
 * Get tool executors as a map
 */
export function getToolExecutors(): Map<string, ToolExecutor> {
  const map = new Map<string, ToolExecutor>();
  for (const tool of ALL_TOOLS) {
    map.set(tool.definition.name, tool.executor);
  }
  return map;
}

/**
 * Register all tools with a ToolRegistry
 */
export function registerAllTools(registry: IToolRegistry): void {
  for (const tool of ALL_TOOLS) {
    const qName = qualifyToolName(tool.definition.name, 'core');
    registry.register({ ...tool.definition, name: qName }, tool.executor);
  }
}

/**
 * Register specific tool sets
 */
export function registerToolSet(
  registry: IToolRegistry,
  setName: keyof typeof TOOL_SETS
): void {
  const toolSet = TOOL_SETS[setName];
  for (const tool of toolSet) {
    const qName = qualifyToolName(tool.definition.name, 'core');
    registry.register({ ...tool.definition, name: qName }, tool.executor);
  }
}

/**
 * Get a tool by name
 */
export function getTool(name: string): { definition: ToolDefinition; executor: ToolExecutor } | undefined {
  const baseName = getBaseName(name);
  return ALL_TOOLS.find((t) => t.definition.name === baseName);
}

// =============================================================================
// TOOL CATEGORIES
// =============================================================================

/**
 * Tool categories for UI organization
 */
export const TOOL_CATEGORIES = {
  // Personal Data
  'Tasks': [
    'add_task',
    'batch_add_tasks',
    'list_tasks',
    'complete_task',
    'update_task',
    'delete_task',
  ],
  'Bookmarks': [
    'add_bookmark',
    'batch_add_bookmarks',
    'list_bookmarks',
    'delete_bookmark',
  ],
  'Notes': [
    'add_note',
    'batch_add_notes',
    'list_notes',
    'update_note',
    'delete_note',
  ],
  'Calendar': [
    'add_calendar_event',
    'batch_add_calendar_events',
    'list_calendar_events',
    'delete_calendar_event',
  ],
  'Contacts': [
    'add_contact',
    'batch_add_contacts',
    'list_contacts',
    'update_contact',
    'delete_contact',
  ],
  'Custom Data': [
    'list_custom_tables',
    'describe_custom_table',
    'create_custom_table',
    'delete_custom_table',
    'add_custom_record',
    'batch_add_custom_records',
    'list_custom_records',
    'search_custom_records',
    'get_custom_record',
    'update_custom_record',
    'delete_custom_record',
  ],

  // File & Documents
  'File System': [
    'read_file',
    'write_file',
    'list_directory',
    'search_files',
    'download_file',
    'get_file_info',
    'delete_file',
    'copy_file',
  ],
  'PDF': [
    'read_pdf',
    'create_pdf',
    'get_pdf_info',
  ],

  // Code & Development
  'Code Execution (Sandbox Required)': [
    'execute_javascript',
    'execute_python',
    'execute_shell',
    'compile_code',
    'package_manager',
  ],
  'Git': [
    'git_status',
    'git_diff',
    'git_log',
    'git_commit',
    'git_add',
    'git_branch',
    'git_checkout',
  ],

  // Web & API
  'Web & API': [
    'http_request',
    'fetch_web_page',
    'search_web',
    'call_json_api',
  ],

  // Communication
  'Email': [
    'send_email',
    'list_emails',
    'read_email',
    'delete_email',
    'search_emails',
    'reply_email',
  ],

  // Media
  'Image': [
    'analyze_image',
    'generate_image',
    'resize_image',
  ],
  'Audio': [
    'text_to_speech',
    'speech_to_text',
    'translate_audio',
    'get_audio_info',
    'split_audio',
  ],

  // AI & NLP
  'Data Extraction': [
    'extract_entities',
    'extract_table_data',
  ],

  // Finance
  'Finance': [
    'add_expense',
    'batch_add_expenses',
    'parse_receipt',
    'query_expenses',
    'export_expenses',
    'expense_summary',
    'delete_expense',
  ],

  // Weather
  'Weather': [
    'get_weather',
    'get_weather_forecast',
  ],

  // Memory & Goals
  'Memory': [
    'create_memory',
    'batch_create_memories',
    'search_memories',
    'delete_memory',
    'list_memories',
    'update_memory_importance',
    'get_memory_stats',
  ],
  'Goals': [
    'create_goal',
    'list_goals',
    'update_goal',
    'decompose_goal',
    'get_next_actions',
    'complete_step',
    'get_goal_details',
    'get_goal_stats',
  ],

  // Meta - Dynamic Tool Management
  'Dynamic Tools': [
    'create_tool',
    'list_custom_tools',
    'delete_custom_tool',
    'toggle_custom_tool',
  ],

  // Utility Tools
  'Utilities': [
    'get_current_datetime',
    'date_diff',
    'date_add',
    'calculate',
    'calculate_statistics',
    'convert_units',
    'generate_uuid',
    'generate_password',
    'random_number',
    'hash_text',
    'encode_decode',
    'count_text',
    'extract_from_text',
    'transform_text',
    'compare_text',
    'run_regex',
    'format_json',
    'parse_csv',
    'generate_csv',
    'array_operations',
    'validate_data',
    'get_system_info',
  ],
} as const;

/**
 * Get tools by category
 */
export function getToolsByCategory(): Map<string, ToolDefinition[]> {
  const result = new Map<string, ToolDefinition[]>();
  const toolMap = new Map(ALL_TOOLS.map((t) => [t.definition.name, t.definition]));

  for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
    const categoryTools: ToolDefinition[] = [];
    for (const name of toolNames) {
      const tool = toolMap.get(name);
      if (tool) {
        categoryTools.push(tool);
      }
    }
    result.set(category, categoryTools);
  }

  return result;
}

/**
 * Get category for a tool name
 */
export function getCategoryForTool(toolName: string): string | undefined {
  const baseName = getBaseName(toolName);
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if ((tools as readonly string[]).includes(baseName)) {
      return category;
    }
  }
  return undefined;
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get tool statistics
 */
export function getToolStats(): {
  totalTools: number;
  categories: number;
  toolsByCategory: Record<string, number>;
} {
  const toolsByCategory: Record<string, number> = {};

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    toolsByCategory[category] = tools.length;
  }

  return {
    totalTools: ALL_TOOLS.length,
    categories: Object.keys(TOOL_CATEGORIES).length,
    toolsByCategory,
  };
}
