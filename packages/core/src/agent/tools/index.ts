/**
 * Tools Index
 * Export all tool modules and provide unified registration
 */

// =============================================================================
// EXPORTS - All tool modules
// =============================================================================

export * from './file-system.js';
export * from './code-execution.js';
export * from './web-fetch.js';
export * from './expense-tracker.js';
export * from './scheduler-tools.js';
export * from './custom-data.js';
export * from './memory-tools.js';
export * from './goal-tools.js';
export * from './personal-data.js';

// New tools
export * from './pdf-tools.js';
export * from './translation-tools.js';
export * from './image-tools.js';
export * from './email-tools.js';
export * from './git-tools.js';
export * from './vector-search-tools.js';
export * from './audio-tools.js';
export * from './data-extraction-tools.js';
export * from './weather-tools.js';

// Dynamic tools - LLM-created tools
export * from './dynamic-tools.js';

// Utility tools - date/time, calculations, conversions, text utilities
export * from './utility-tools.js';

// =============================================================================
// IMPORTS - Tool sets
// =============================================================================

import { FILE_SYSTEM_TOOLS } from './file-system.js';
import { CODE_EXECUTION_TOOLS } from './code-execution.js';
import { WEB_FETCH_TOOLS } from './web-fetch.js';
import { EXPENSE_TRACKER_TOOLS } from './expense-tracker.js';
import { SCHEDULER_TOOLS } from './scheduler-tools.js';
import { CUSTOM_DATA_TOOLS, CUSTOM_DATA_TOOL_NAMES } from './custom-data.js';
import { MEMORY_TOOLS, MEMORY_TOOL_NAMES } from './memory-tools.js';
import { GOAL_TOOLS, GOAL_TOOL_NAMES } from './goal-tools.js';
import { PERSONAL_DATA_TOOLS, PERSONAL_DATA_TOOL_NAMES } from './personal-data.js';

// New tool imports
import { PDF_TOOLS, PDF_TOOL_NAMES } from './pdf-tools.js';
import { TRANSLATION_TOOLS, TRANSLATION_TOOL_NAMES } from './translation-tools.js';
import { IMAGE_TOOLS, IMAGE_TOOL_NAMES } from './image-tools.js';
import { EMAIL_TOOLS, EMAIL_TOOL_NAMES } from './email-tools.js';
import { GIT_TOOLS, GIT_TOOL_NAMES } from './git-tools.js';
import { VECTOR_SEARCH_TOOLS, VECTOR_SEARCH_TOOL_NAMES } from './vector-search-tools.js';
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

import type { ToolDefinition, ToolExecutor, ToolRegistry as IToolRegistry } from '../tools.js';

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
  scheduler: SCHEDULER_TOOLS,

  // New tool sets
  pdf: PDF_TOOLS,
  translation: TRANSLATION_TOOLS,
  image: IMAGE_TOOLS,
  email: EMAIL_TOOLS,
  git: GIT_TOOLS,
  vectorSearch: VECTOR_SEARCH_TOOLS,
  audio: AUDIO_TOOLS,
  dataExtraction: DATA_EXTRACTION_TOOLS,
  weather: WEATHER_TOOLS,
  utility: UTILITY_TOOLS,
} as const;

// =============================================================================
// TOOL NAME EXPORTS
// =============================================================================

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
 * Translation tools
 * Multi-language translation and language detection
 */
export { TRANSLATION_TOOLS, TRANSLATION_TOOL_NAMES };

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
 * Vector search tools
 * Semantic search and embeddings for RAG applications
 */
export { VECTOR_SEARCH_TOOLS, VECTOR_SEARCH_TOOL_NAMES };

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
  ...SCHEDULER_TOOLS,

  // New tools
  ...PDF_TOOLS,
  ...TRANSLATION_TOOLS,
  ...IMAGE_TOOLS,
  ...EMAIL_TOOLS,
  ...GIT_TOOLS,
  ...VECTOR_SEARCH_TOOLS,
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
    registry.register(tool.definition, tool.executor);
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
    registry.register(tool.definition, tool.executor);
  }
}

/**
 * Get a tool by name
 */
export function getTool(name: string): { definition: ToolDefinition; executor: ToolExecutor } | undefined {
  return ALL_TOOLS.find((t) => t.definition.name === name);
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
    'file_info',
    'delete_file',
    'copy_file',
  ],
  'PDF': [
    'read_pdf',
    'create_pdf',
    'pdf_info',
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
    'json_api',
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
    'edit_image',
    'image_variation',
    'resize_image',
  ],
  'Audio': [
    'text_to_speech',
    'speech_to_text',
    'translate_audio',
    'audio_info',
    'split_audio',
  ],

  // AI & NLP
  'Translation': [
    'translate_text',
    'detect_language',
    'list_languages',
    'batch_translate',
  ],
  'Data Extraction': [
    'extract_structured_data',
    'extract_entities',
    'extract_table_data',
    'summarize_text',
  ],
  'Vector Search': [
    'create_embedding',
    'semantic_search',
    'upsert_vectors',
    'delete_vectors',
    'list_vector_collections',
    'create_vector_collection',
    'similarity_score',
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

  // Automation
  'Scheduler': [
    'create_scheduled_task',
    'list_scheduled_tasks',
    'update_scheduled_task',
    'delete_scheduled_task',
    'get_task_history',
    'trigger_task',
  ],

  // Weather
  'Weather': [
    'get_weather',
    'get_weather_forecast',
  ],

  // Memory & Goals
  'Memory': [
    'remember',
    'batch_remember',
    'recall',
    'forget',
    'list_memories',
    'boost_memory',
    'memory_stats',
  ],
  'Goals': [
    'create_goal',
    'list_goals',
    'update_goal',
    'decompose_goal',
    'get_next_actions',
    'complete_step',
    'get_goal_details',
    'goal_stats',
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
    'statistics',
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
    'regex',
    'format_json',
    'parse_csv',
    'generate_csv',
    'array_operations',
    'validate',
    'system_info',
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
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if ((tools as readonly string[]).includes(toolName)) {
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
