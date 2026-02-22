/**
 * Tool Configuration
 *
 * Defines which tool groups are enabled and manages tool loading.
 * This allows customizing which tools are available to the AI.
 *
 * Tool names here MUST match real tool definitions in tools/*.ts files.
 * Phantom/aspirational names are not allowed.
 */

import { getBaseName } from './tool-namespace.js';

export interface ToolGroupConfig {
  /** Group identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Whether enabled by default */
  defaultEnabled: boolean;
  /** Tool names in this group */
  tools: readonly string[];
  /** Whether this group can be disabled by the user */
  alwaysOn?: boolean;
}

/**
 * Tool groups organized by functionality.
 * Consolidated from 27 → 14 groups. All tool names verified against real implementations.
 */
export const TOOL_GROUPS: Record<string, ToolGroupConfig> = {
  // =========================================================================
  // ALWAYS-ON GROUPS (8) — essential for a personal assistant
  // =========================================================================
  core: {
    id: 'core',
    name: 'Core',
    description: 'Time, math, UUID, system info',
    defaultEnabled: true,
    alwaysOn: true,
    tools: [
      'get_current_time',
      'get_current_datetime',
      'calculate',
      'calculate_statistics',
      'generate_uuid',
      'get_system_info',
    ],
  },

  filesystem: {
    id: 'filesystem',
    name: 'File System',
    description: 'Read, write, and manage files in workspace',
    defaultEnabled: true,
    alwaysOn: true,
    tools: ['create_folder', 'write_file', 'read_file', 'list_files', 'delete_file', 'move_file'],
  },

  personalData: {
    id: 'personalData',
    name: 'Personal Data',
    description: 'Tasks, notes, bookmarks, calendar, contacts',
    defaultEnabled: true,
    alwaysOn: true,
    tools: [
      // Tasks
      'add_task',
      'list_tasks',
      'complete_task',
      'update_task',
      'delete_task',
      // Notes
      'add_note',
      'list_notes',
      'update_note',
      'delete_note',
      // Bookmarks
      'add_bookmark',
      'list_bookmarks',
      'delete_bookmark',
      // Calendar
      'add_calendar_event',
      'list_calendar_events',
      'delete_calendar_event',
      // Contacts
      'add_contact',
      'list_contacts',
      'update_contact',
      'delete_contact',
    ],
  },

  customData: {
    id: 'customData',
    name: 'Custom Data',
    description: 'Create dynamic tables for any data structure',
    defaultEnabled: true,
    tools: [
      'create_custom_table',
      'list_custom_tables',
      'describe_custom_table',
      'delete_custom_table',
      'add_custom_record',
      'list_custom_records',
      'get_custom_record',
      'update_custom_record',
      'delete_custom_record',
      'search_custom_records',
    ],
  },

  memory: {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent AI memory for user context',
    defaultEnabled: true,
    alwaysOn: true,
    tools: ['create_memory', 'search_memories', 'delete_memory', 'list_memories'],
  },

  goals: {
    id: 'goals',
    name: 'Goals',
    description: 'Long-term objective tracking',
    defaultEnabled: true,
    tools: [
      'create_goal',
      'list_goals',
      'get_goal_details',
      'update_goal',
      'decompose_goal',
      'get_next_actions',
      'complete_step',
    ],
  },

  utilities: {
    id: 'utilities',
    name: 'Utilities',
    description: 'Date/time, text processing, conversion, validation, data extraction',
    defaultEnabled: true,
    tools: [
      // Date/time
      'date_diff',
      'date_add',
      // Text processing
      'format_json',
      'count_text',
      'transform_text',
      'run_regex',
      'compare_text',
      // Conversion & encoding
      'convert_units',
      'encode_decode',
      'hash_text',
      // CSV/data
      'parse_csv',
      'generate_csv',
      'array_operations',
      // Generation
      'random_number',
      'generate_password',
      // Extraction & validation
      'extract_from_text',
      'validate_data',
      // Data extraction (regex-based NER + table parser)
      'extract_entities',
      'extract_table_data',
    ],
  },

  customTools: {
    id: 'customTools',
    name: 'Custom Tools',
    description: 'Create and manage user-created tools',
    defaultEnabled: true,
    tools: [
      'create_tool',
      'list_custom_tools',
      'delete_custom_tool',
      'toggle_custom_tool',
      'inspect_tool_source',
      'update_custom_tool',
    ],
  },

  // =========================================================================
  // TOGGLEABLE GROUPS (6) — disabled by default, user enables in Settings
  // =========================================================================
  codeExecution: {
    id: 'codeExecution',
    name: 'Code Execution',
    description: 'Execute JavaScript, Python, or shell commands (sandboxed)',
    defaultEnabled: false,
    tools: [
      'execute_javascript',
      'execute_python',
      'execute_shell',
      'compile_code',
      'package_manager',
    ],
  },

  webFetch: {
    id: 'webFetch',
    name: 'Web & API',
    description: 'HTTP requests, web scraping, web search',
    defaultEnabled: false,
    tools: ['http_request', 'fetch_web_page', 'search_web', 'call_json_api'],
  },

  media: {
    id: 'media',
    name: 'Media',
    description: 'Image analysis/generation, audio TTS/STT, PDF read/create',
    defaultEnabled: false,
    tools: [
      // Image
      'analyze_image',
      'generate_image',
      'resize_image',
      // Audio
      'text_to_speech',
      'speech_to_text',
      'translate_audio',
      'get_audio_info',
      'split_audio',
      // PDF
      'read_pdf',
      'create_pdf',
      'get_pdf_info',
    ],
  },

  communication: {
    id: 'communication',
    name: 'Communication & Weather',
    description: 'Email (SMTP/IMAP) and weather forecasts',
    defaultEnabled: false,
    tools: [
      // Email
      'send_email',
      'list_emails',
      'read_email',
      'delete_email',
      'search_emails',
      'reply_email',
      // Weather
      'get_weather',
      'get_weather_forecast',
    ],
  },

  devTools: {
    id: 'devTools',
    name: 'Developer Tools',
    description: 'Git version control operations',
    defaultEnabled: false,
    tools: [
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_add',
      'git_branch',
      'git_checkout',
    ],
  },

  finance: {
    id: 'finance',
    name: 'Finance',
    description: 'Expense tracking, receipt parsing, budget reports',
    defaultEnabled: false,
    tools: [
      'add_expense',
      'batch_add_expenses',
      'parse_receipt',
      'query_expenses',
      'export_expenses',
      'expense_summary',
      'delete_expense',
    ],
  },
};

/**
 * Default tool configuration — what's enabled for a personal assistant
 */
export const DEFAULT_ENABLED_GROUPS: string[] = [
  'core',
  'filesystem',
  'personalData',
  'customData',
  'memory',
  'goals',
  'utilities',
  'customTools',
];

/**
 * Get tool names for enabled groups
 */
export function getEnabledTools(enabledGroups: string[] = DEFAULT_ENABLED_GROUPS): string[] {
  const tools: string[] = [];
  const seen = new Set<string>();

  for (const groupId of enabledGroups) {
    const group = TOOL_GROUPS[groupId];
    if (group) {
      for (const tool of group.tools) {
        if (!seen.has(tool)) {
          tools.push(tool);
          seen.add(tool);
        }
      }
    }
  }

  return tools;
}

/**
 * Get all available tool groups
 */
export function getToolGroups(): ToolGroupConfig[] {
  return Object.values(TOOL_GROUPS);
}

/**
 * Get tool group by tool name
 */
export function getGroupForTool(toolName: string): ToolGroupConfig | undefined {
  const baseName = getBaseName(toolName);
  for (const group of Object.values(TOOL_GROUPS)) {
    if (group.tools.includes(baseName)) {
      return group;
    }
  }
  return undefined;
}

// =============================================================================
// FAMILIAR TOOLS — inline parameter schemas in system prompt tool catalog
// =============================================================================

/**
 * Tools whose parameter schemas are shown inline in the tool catalog.
 * These are the ~25 most frequently used tools. The LLM can call them
 * directly via use_tool without first calling search_tools or get_tool_help.
 */
export const FAMILIAR_TOOLS = new Set([
  // Tasks & Personal Data
  'add_task',
  'list_tasks',
  'complete_task',
  'add_note',
  'list_notes',
  'add_calendar_event',
  'list_calendar_events',
  'add_bookmark',

  // Memory
  'create_memory',
  'search_memories',
  'delete_memory',

  // Goals
  'create_goal',
  'list_goals',
  'update_goal',

  // File System
  'read_file',
  'write_file',
  'list_directory',
  'search_files',

  // Web
  'search_web',
  'fetch_web_page',

  // Utilities
  'get_current_datetime',
  'calculate',
  'convert_units',

  // Weather
  'get_weather',

  // Email
  'send_email',
]);

// =============================================================================
// TOOL CATEGORY CAPABILITIES — natural-language summaries for system prompt
// =============================================================================

/**
 * Capability descriptions for categorical prompt injection.
 * Maps each TOOL_GROUPS key to a concise summary of what those tools do.
 * Used by PromptComposer to generate compact tool descriptions instead of
 * listing every tool name.
 */
export const TOOL_CATEGORY_CAPABILITIES: Record<string, string> = {
  core: 'Get current time, perform calculations, statistics, generate UUIDs, system info',
  filesystem: 'Read, write, list, search, move, and delete files in the workspace',
  personalData: 'Tasks (CRUD), notes, bookmarks, calendar events, contacts',
  customData: 'Create custom database tables with any schema; CRUD records; search and query',
  memory: 'Persistently remember facts about the user; search and manage memories',
  goals: 'Track long-term objectives, decompose into steps, monitor progress',
  utilities:
    'Date math, text transform/compare/regex, JSON format, CSV parse/generate, encoding, hashing, validation, data extraction',
  customTools: 'Create, list, enable/disable, delete, inspect, and update user-created tools',
  codeExecution: 'Execute JavaScript, Python, or shell commands (sandboxed)',
  webFetch: 'HTTP requests, web page fetching, web search, JSON API calls',
  media:
    'Analyze images (vision/OCR), generate images, resize, TTS, STT, audio processing, PDF read/create',
  communication: 'Send/receive/search/read/reply emails, weather conditions and forecasts',
  devTools: 'Git operations: status, diff, log, commit, branch, checkout',
  finance: 'Track expenses, parse receipts, budget summaries, export reports',
};

/**
 * Tool statistics
 */
export function getToolStats(): {
  totalGroups: number;
  totalTools: number;
  enabledByDefault: number;
  disabledByDefault: number;
} {
  const groups = Object.values(TOOL_GROUPS);
  const allTools = new Set<string>();
  let enabledCount = 0;
  let disabledCount = 0;

  for (const group of groups) {
    for (const tool of group.tools) {
      allTools.add(tool);
    }
    if (group.defaultEnabled) {
      enabledCount += group.tools.length;
    } else {
      disabledCount += group.tools.length;
    }
  }

  return {
    totalGroups: groups.length,
    totalTools: allTools.size,
    enabledByDefault: enabledCount,
    disabledByDefault: disabledCount,
  };
}
