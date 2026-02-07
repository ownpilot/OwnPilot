/**
 * Tool Configuration
 *
 * Defines which tool groups are enabled and manages tool loading.
 * This allows customizing which tools are available to the AI.
 */

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
  /** Dependencies on other groups */
  dependsOn?: string[];
}

/**
 * Tool groups organized by functionality
 */
export const TOOL_GROUPS: Record<string, ToolGroupConfig> = {
  // =========================================================================
  // CORE - Always needed
  // =========================================================================
  core: {
    id: 'core',
    name: 'Core Utilities',
    description: 'Essential tools: time, calculation, UUID',
    defaultEnabled: true,
    tools: ['get_current_time', 'calculate', 'generate_uuid'],
  },

  // =========================================================================
  // FILE SYSTEM - Workspace operations
  // =========================================================================
  filesystem: {
    id: 'filesystem',
    name: 'File System',
    description: 'Read, write, and manage files in workspace',
    defaultEnabled: true,
    tools: [
      'create_folder',
      'write_file',
      'read_file',
      'list_files',
      'delete_file',
      'move_file',
    ],
  },

  // =========================================================================
  // DATA MANAGEMENT - Personal data tools
  // =========================================================================
  tasks: {
    id: 'tasks',
    name: 'Task Management',
    description: 'Todo items with due dates and priorities',
    defaultEnabled: true,
    tools: ['add_task', 'list_tasks', 'complete_task', 'update_task', 'delete_task'],
  },

  bookmarks: {
    id: 'bookmarks',
    name: 'Bookmarks',
    description: 'Save and organize URLs',
    defaultEnabled: true,
    tools: ['add_bookmark', 'list_bookmarks', 'delete_bookmark'],
  },

  notes: {
    id: 'notes',
    name: 'Notes',
    description: 'Create and manage text notes',
    defaultEnabled: true,
    tools: ['add_note', 'list_notes', 'update_note', 'delete_note'],
  },

  calendar: {
    id: 'calendar',
    name: 'Calendar',
    description: 'Schedule events and appointments',
    defaultEnabled: true,
    tools: ['add_calendar_event', 'list_calendar_events', 'delete_calendar_event'],
  },

  contacts: {
    id: 'contacts',
    name: 'Contacts',
    description: 'Manage contact information',
    defaultEnabled: true,
    tools: ['add_contact', 'list_contacts', 'update_contact', 'delete_contact'],
  },

  // =========================================================================
  // CUSTOM DATA - Flexible dynamic tables
  // =========================================================================
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

  // =========================================================================
  // MEMORY & GOALS - AI Persistence
  // =========================================================================
  memory: {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent AI memory for user context',
    defaultEnabled: true,
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

  // =========================================================================
  // TEXT UTILITIES - Text processing
  // =========================================================================
  textUtils: {
    id: 'textUtils',
    name: 'Text Utilities',
    description: 'Text transformation and analysis',
    defaultEnabled: true,
    tools: [
      'parse_json',
      'format_json',
      'text_stats',
      'text_transform',
      'search_replace',
      'truncate_text',
      'wrap_text',
      'to_slug',
      'change_case',
    ],
  },

  // =========================================================================
  // DATE & TIME - Date operations
  // =========================================================================
  dateTime: {
    id: 'dateTime',
    name: 'Date & Time',
    description: 'Date formatting and calculations',
    defaultEnabled: true,
    tools: ['format_date', 'date_diff', 'add_to_date'],
  },

  // =========================================================================
  // CONVERSION - Unit and format conversion
  // =========================================================================
  conversion: {
    id: 'conversion',
    name: 'Conversion',
    description: 'Unit, currency, and format conversion',
    defaultEnabled: true,
    tools: [
      'convert_units',
      'convert_currency',
      'base64_encode',
      'base64_decode',
      'url_encode',
      'hash_text',
      'json_to_csv',
      'csv_to_json',
      'markdown_to_html',
      'strip_markdown',
    ],
  },

  // =========================================================================
  // RANDOM & GENERATION - Generate data
  // =========================================================================
  generation: {
    id: 'generation',
    name: 'Generation',
    description: 'Generate random data and content',
    defaultEnabled: true,
    tools: [
      'random_number',
      'random_string',
      'random_choice',
      'generate_password',
      'generate_lorem_ipsum',
    ],
  },

  // =========================================================================
  // EXTRACTION - Data extraction
  // =========================================================================
  extraction: {
    id: 'extraction',
    name: 'Extraction',
    description: 'Extract data from text',
    defaultEnabled: true,
    tools: [
      'extract_urls',
      'extract_emails',
      'extract_numbers',
    ],
  },

  // =========================================================================
  // VALIDATION - Data validation
  // =========================================================================
  validation: {
    id: 'validation',
    name: 'Validation',
    description: 'Validate data formats',
    defaultEnabled: true,
    tools: ['validate_email', 'validate_url', 'test_regex'],
  },

  // =========================================================================
  // LIST OPERATIONS - Array/list processing
  // =========================================================================
  listOps: {
    id: 'listOps',
    name: 'List Operations',
    description: 'Sort, filter, and transform lists',
    defaultEnabled: true,
    tools: ['sort_list', 'deduplicate', 'create_table'],
  },

  // =========================================================================
  // MATH & STATS - Mathematical operations
  // =========================================================================
  mathStats: {
    id: 'mathStats',
    name: 'Math & Statistics',
    description: 'Mathematical and statistical calculations',
    defaultEnabled: true,
    tools: ['calculate_percentage', 'calculate_statistics', 'count_words'],
  },

  // =========================================================================
  // ADVANCED - Code execution, external APIs (disabled by default)
  // =========================================================================
  codeExecution: {
    id: 'codeExecution',
    name: 'Code Execution',
    description: 'Execute code (requires Docker sandbox)',
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
    name: 'Web Fetch',
    description: 'HTTP requests and web scraping',
    defaultEnabled: false,
    tools: ['http_request', 'fetch_web_page', 'search_web', 'call_json_api'],
  },

  email: {
    id: 'email',
    name: 'Email',
    description: 'Send and receive emails',
    defaultEnabled: false,
    tools: ['send_email', 'list_emails', 'read_email', 'delete_email', 'search_emails', 'reply_email'],
  },

  weather: {
    id: 'weather',
    name: 'Weather',
    description: 'Get current weather and forecasts',
    defaultEnabled: false,
    tools: ['get_weather', 'get_weather_forecast'],
  },

  git: {
    id: 'git',
    name: 'Git',
    description: 'Version control operations',
    defaultEnabled: false,
    tools: ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_add', 'git_branch', 'git_checkout'],
  },

  // =========================================================================
  // MEDIA - Image, audio, PDF (disabled by default - need APIs)
  // =========================================================================
  image: {
    id: 'image',
    name: 'Image',
    description: 'Image analysis and generation',
    defaultEnabled: false,
    tools: ['analyze_image', 'generate_image', 'edit_image', 'image_variation', 'resize_image'],
  },

  audio: {
    id: 'audio',
    name: 'Audio',
    description: 'Text-to-speech and transcription',
    defaultEnabled: false,
    tools: ['text_to_speech', 'speech_to_text', 'translate_audio', 'get_audio_info', 'split_audio'],
  },

  pdf: {
    id: 'pdf',
    name: 'PDF',
    description: 'PDF reading and creation',
    defaultEnabled: false,
    tools: ['read_pdf', 'create_pdf', 'get_pdf_info'],
  },

  // =========================================================================
  // AI/NLP - Advanced AI features (disabled by default)
  // =========================================================================
  translation: {
    id: 'translation',
    name: 'Translation',
    description: 'Multi-language translation',
    defaultEnabled: false,
    tools: ['translate_text', 'detect_language', 'list_languages', 'batch_translate'],
  },

  vectorSearch: {
    id: 'vectorSearch',
    name: 'Vector Search',
    description: 'Semantic search with embeddings',
    defaultEnabled: false,
    tools: [
      'create_embedding',
      'semantic_search',
      'upsert_vectors',
      'delete_vectors',
      'list_vector_collections',
      'create_vector_collection',
      'similarity_score',
    ],
  },

  dataExtraction: {
    id: 'dataExtraction',
    name: 'Data Extraction',
    description: 'Extract structured data from text',
    defaultEnabled: false,
    tools: ['extract_structured_data', 'extract_entities', 'extract_table_data', 'summarize_text'],
  },

  // =========================================================================
  // CUSTOM TOOLS - User/LLM-created tools (always available when active)
  // =========================================================================
  customTools: {
    id: 'customTools',
    name: 'Custom Tools',
    description: 'Create and manage custom tools (always included when active)',
    defaultEnabled: true,
    tools: [
      'create_tool',
      'list_custom_tools',
      'delete_custom_tool',
      'toggle_custom_tool',
    ],
  },
};

/**
 * Default tool configuration - what's enabled for a personal assistant
 */
export const DEFAULT_ENABLED_GROUPS: string[] = [
  // Core essentials
  'core',
  'filesystem',

  // Personal data management
  'tasks',
  'bookmarks',
  'notes',
  'calendar',
  'contacts',
  'customData',

  // AI persistence
  'memory',
  'goals',

  // Custom tools (always included when active, listed here for documentation)
  'customTools',

  // Utilities
  'textUtils',
  'dateTime',
  'conversion',
  'generation',
  'extraction',
  'validation',
  'listOps',
  'mathStats',
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
  for (const group of Object.values(TOOL_GROUPS)) {
    if (group.tools.includes(toolName)) {
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

  // Memory (renamed)
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
  core: 'Get current time, perform calculations, generate UUIDs',
  filesystem: 'Read, write, list, search, move, and delete files in the workspace',
  tasks: 'Create, list, update, complete, and delete todo items with priorities and due dates',
  bookmarks: 'Save, list, and organize web bookmarks/URLs',
  notes: 'Create, list, update, and delete text notes',
  calendar: 'Schedule events, list upcoming appointments, manage calendar',
  contacts: 'Store and manage contact information (name, phone, email)',
  customData: 'Create custom database tables with any schema; CRUD records; search and query',
  memory: 'Persistently remember facts about the user; search and manage memories',
  goals: 'Track long-term objectives, decompose into steps, monitor progress',
  textUtils: 'Parse/format JSON, text stats, search-replace, case conversion, slugify',
  dateTime: 'Format dates, calculate date differences, date arithmetic',
  conversion: 'Unit/currency conversion, base64/URL encoding, hashing, CSV/JSON/Markdown transforms',
  generation: 'Generate random numbers, strings, passwords, lorem ipsum',
  extraction: 'Extract URLs, emails, and numbers from text',
  validation: 'Validate emails, URLs, and test regex patterns',
  listOps: 'Sort, deduplicate, and format lists/tables',
  mathStats: 'Percentages, statistical calculations (mean/median/std), word counts',
  codeExecution: 'Execute JavaScript, Python, or shell commands (sandboxed)',
  webFetch: 'HTTP requests, web page fetching, web search, JSON API calls',
  email: 'Send, receive, search, read, and reply to emails',
  weather: 'Current weather conditions and multi-day forecasts',
  git: 'Git operations: status, diff, log, commit, branch, checkout',
  image: 'Analyze images (OCR/vision), generate images (DALL-E), edit/resize',
  audio: 'Text-to-speech, speech-to-text transcription, audio processing',
  pdf: 'Read PDF content, create PDFs, get PDF metadata',
  translation: 'Translate text between languages, detect language',
  vectorSearch: 'Semantic search with embeddings, vector collections, similarity scoring',
  dataExtraction: 'Extract structured data, named entities, tables from text; summarize',
  customTools: 'Create, list, enable/disable, and delete user-created custom tools',
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
