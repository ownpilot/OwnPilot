/**
 * Tool Source Code Service
 *
 * Reads actual TypeScript source files and extracts tool implementation
 * functions for display in the UI. Caches results for performance.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Navigate from dist/services/ or src/services/ to gateway package root
const gatewayRoot = resolve(__dirname, '../..');
const gatewaySrc = resolve(gatewayRoot, 'src');
const coreSrc = resolve(gatewayRoot, '../core/src/agent/tools');

// =============================================================================
// Source File Cache
// =============================================================================

const fileCache = new Map<string, string>();
const extractionCache = new Map<string, string>();

function readSourceFile(absolutePath: string): string | null {
  if (fileCache.has(absolutePath)) return fileCache.get(absolutePath)!;
  try {
    const content = readFileSync(absolutePath, 'utf-8');
    fileCache.set(absolutePath, content);
    return content;
  } catch {
    return null;
  }
}

// =============================================================================
// Function Extraction
// =============================================================================

/**
 * Extract a specific switch case block from source code.
 * Finds `case 'toolName': {` and extracts until the matching `}`.
 */
function extractSwitchCase(source: string, caseName: string): string | null {
  // Find case 'toolName': { or case 'toolName':
  const casePatterns = [
    `case '${caseName}':`,
    `case "${caseName}":`,
  ];

  let caseIdx = -1;
  for (const p of casePatterns) {
    caseIdx = source.indexOf(p);
    if (caseIdx >= 0) break;
  }
  if (caseIdx < 0) return null;

  // Find opening brace after the case
  const braceStart = source.indexOf('{', caseIdx);
  if (braceStart < 0) return null;

  // Make sure the brace is on the same or next line (not some random brace far away)
  const textBetween = source.substring(caseIdx, braceStart);
  if (textBetween.split('\n').length > 2) return null;

  // Brace-match to find the case body end
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.substring(caseIdx, i + 1).trim();
      }
    }
  }
  return null;
}

/**
 * Extract a named exported const (arrow function) from source.
 * Handles: export const fooExecutor: Type = async (args) => { ... };
 */
function extractConstFunction(source: string, constName: string): string | null {
  const patterns = [
    `export const ${constName}`,
    `const ${constName}`,
  ];

  let startIdx = -1;
  for (const pattern of patterns) {
    startIdx = source.indexOf(pattern);
    if (startIdx >= 0) break;
  }
  if (startIdx < 0) return null;

  // Find the arrow's opening brace: => {
  const arrowIdx = source.indexOf('=>', startIdx);
  if (arrowIdx < 0 || arrowIdx - startIdx > 500) return null;
  const braceStart = source.indexOf('{', arrowIdx);
  if (braceStart < 0) return null;

  // Brace-match
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        const end = source[i + 1] === ';' ? i + 2 : i + 1;
        return source.substring(startIdx, end).trim();
      }
    }
  }
  return null;
}

/**
 * Extract a named function from source code using brace-matching.
 * Handles: export async function X(...) { ... }
 */
function extractFunction(source: string, funcName: string): string | null {
  const patterns = [
    `export async function ${funcName}`,
    `export function ${funcName}`,
    `async function ${funcName}`,
    `function ${funcName}`,
  ];

  let startIdx = -1;
  for (const pattern of patterns) {
    startIdx = source.indexOf(pattern);
    if (startIdx >= 0) break;
  }
  if (startIdx < 0) return null;

  const braceStart = source.indexOf('{', source.indexOf(')', startIdx));
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.substring(startIdx, i + 1).trim();
      }
    }
  }
  return null;
}

// =============================================================================
// Tool Name → Source Mapping
// =============================================================================

/** Gateway-wrapped tools: tool name → { file, function name } */
const GATEWAY_TOOL_MAP: Record<string, { file: string; func: string }> = {};

/** Core tools: tool name → { file, executor name } */
const CORE_TOOL_MAP: Record<string, { file: string; executor: string }> = {};

function addGatewayTools(names: string[], file: string, func: string) {
  for (const name of names) {
    GATEWAY_TOOL_MAP[name] = { file, func };
  }
}

const CORE_FILE_TOOLS: Record<string, string[]> = {
  'utility-tools': [
    'get_current_datetime', 'calculate', 'convert_units', 'generate_uuid',
    'generate_password', 'random_number', 'hash_text', 'encode_decode',
    'count_text', 'extract_from_text', 'validate_data', 'transform_text',
    'date_diff', 'date_add', 'format_json', 'parse_csv', 'generate_csv',
    'array_operations', 'calculate_statistics', 'compare_text', 'run_regex', 'get_system_info',
  ],
  'file-system': [
    'read_file', 'write_file', 'list_directory', 'search_files',
    'download_file', 'get_file_info', 'delete_file', 'copy_file',
  ],
  'code-execution': [
    'execute_javascript', 'execute_python', 'execute_shell',
    'compile_code', 'package_manager',
  ],
  'web-fetch': [
    'http_request', 'fetch_web_page', 'search_web', 'call_json_api',
  ],
  'expense-tracker': [
    'add_expense', 'batch_add_expenses', 'parse_receipt',
    'query_expenses', 'export_expenses', 'expense_summary', 'delete_expense',
  ],
  'scheduler-tools': [
    'create_scheduled_task', 'list_scheduled_tasks', 'update_scheduled_task',
    'delete_scheduled_task', 'get_task_history', 'trigger_task',
  ],
  'pdf-tools': ['read_pdf', 'create_pdf', 'get_pdf_info'],
  'translation-tools': [
    'translate_text', 'detect_language', 'list_languages', 'batch_translate',
  ],
  'image-tools': [
    'analyze_image', 'generate_image', 'edit_image',
    'image_variation', 'resize_image',
  ],
  'email-tools': [
    'send_email', 'list_emails', 'read_email',
    'delete_email', 'search_emails', 'reply_email',
  ],
  'git-tools': [
    'git_status', 'git_diff', 'git_log', 'git_commit',
    'git_add', 'git_branch', 'git_checkout',
  ],
  'audio-tools': [
    'text_to_speech', 'speech_to_text', 'translate_audio',
    'get_audio_info', 'split_audio',
  ],
  'vector-search-tools': [
    'create_embedding', 'semantic_search', 'upsert_vectors',
    'delete_vectors', 'list_vector_collections',
    'create_vector_collection', 'similarity_score',
  ],
  'data-extraction-tools': [
    'extract_structured_data', 'extract_entities',
    'extract_table_data', 'summarize_text',
  ],
  'weather-tools': ['get_weather', 'get_weather_forecast'],
  'dynamic-tools': [
    'create_tool', 'list_custom_tools', 'delete_custom_tool',
    'toggle_custom_tool', 'search_tools', 'get_tool_help', 'use_tool',
    'inspect_tool_source', 'update_custom_tool',
  ],
};

// Build CORE_TOOL_MAP
for (const [file, toolNames] of Object.entries(CORE_FILE_TOOLS)) {
  for (const toolName of toolNames) {
    const camel = toolName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    CORE_TOOL_MAP[toolName] = { file, executor: `${camel}Executor` };
  }
}

// =============================================================================
// Public API
// =============================================================================

export function initToolSourceMappings(tools: {
  memoryNames: string[];
  goalNames: string[];
  customDataNames: string[];
  personalDataNames: string[];
  triggerNames: string[];
  planNames: string[];
}) {
  addGatewayTools(tools.memoryNames, 'routes/memories.ts', 'executeMemoryTool');
  addGatewayTools(tools.goalNames, 'routes/goals.ts', 'executeGoalTool');
  addGatewayTools(tools.customDataNames, 'routes/custom-data.ts', 'executeCustomDataTool');
  addGatewayTools(tools.personalDataNames, 'routes/personal-data-tools.ts', 'executePersonalDataTool');
  addGatewayTools(tools.triggerNames, 'tools/trigger-tools.ts', 'executeTriggerTool');
  addGatewayTools(tools.planNames, 'tools/plan-tools.ts', 'executePlanTool');
}

/**
 * Get the TypeScript source code for a specific tool.
 *
 * Priority:
 * 1. Gateway-wrapped tools → extract the specific case block for this tool
 * 2. Core tools → extract the specific executor function
 * 3. Fallback → executor.toString() (works for plugins + anything else)
 */
export function getToolSource(toolName: string, fallbackToString?: () => string): string | null {
  if (extractionCache.has(toolName)) return extractionCache.get(toolName)!;

  let source: string | null = null;

  // 1. Gateway-wrapped tools: extract per-tool case block
  const gwMapping = GATEWAY_TOOL_MAP[toolName];
  if (gwMapping) {
    const filePath = resolve(gatewaySrc, gwMapping.file);
    const fileContent = readSourceFile(filePath);
    if (fileContent) {
      // First try: extract just this tool's switch case
      source = extractSwitchCase(fileContent, toolName);
      // Second try: extract the entire function (less ideal but complete)
      if (!source) {
        source = extractFunction(fileContent, gwMapping.func);
      }
    }
  }

  // 2. Core tools: extract the specific executor
  if (!source) {
    const coreMapping = CORE_TOOL_MAP[toolName];
    if (coreMapping) {
      const filePath = resolve(coreSrc, `${coreMapping.file}.ts`);
      const fileContent = readSourceFile(filePath);
      if (fileContent) {
        source = extractConstFunction(fileContent, coreMapping.executor);
        if (!source) {
          source = extractFunction(fileContent, coreMapping.executor);
        }
      }
    }
  }

  // 3. Fallback: executor.toString() (plugin tools, overridden tools, etc.)
  if (!source && fallbackToString) {
    source = fallbackToString();
  }

  if (source) {
    extractionCache.set(toolName, source);
  }
  return source;
}
