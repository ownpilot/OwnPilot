/**
 * Tool Namespace System
 *
 * Provides dot-separated namespace prefixes for all tools:
 *   core.read_file, custom.my_tool, plugin.telegram.send_message, ext.web_search.search_web
 *
 * The 4 LLM-facing meta-tools stay unprefixed (LLM APIs don't support dots in function names).
 * All other tools are accessed via use_tool("core.read_file", args) where the name is a string parameter.
 */

export type ToolNamespacePrefix = 'core' | 'custom' | 'plugin' | 'ext' | 'mcp';

/**
 * Meta-tools that MUST stay unprefixed — they appear in LLM native tool schemas
 * where dots are not allowed by OpenAI/Anthropic/Google APIs.
 */
export const UNPREFIXED_META_TOOLS = new Set([
  'search_tools',
  'get_tool_help',
  'use_tool',
  'batch_use_tool',
]);

/**
 * Build a qualified tool name with namespace prefix.
 *
 * @param baseName - Original tool name (e.g., 'read_file')
 * @param prefix - Namespace prefix ('core', 'custom', 'plugin', 'ext')
 * @param subId - Sub-namespace ID for plugin/ext (e.g., 'telegram', 'web_search')
 * @returns Qualified name (e.g., 'core.read_file', 'plugin.telegram.send_message')
 *
 * Meta-tools in UNPREFIXED_META_TOOLS are returned unchanged.
 */
export function qualifyToolName(
  baseName: string,
  prefix: ToolNamespacePrefix,
  subId?: string
): string {
  if (UNPREFIXED_META_TOOLS.has(baseName)) return baseName;
  return subId ? `${prefix}.${subId}.${baseName}` : `${prefix}.${baseName}`;
}

/**
 * Extract the base name from a possibly-qualified tool name.
 *
 * @example getBaseName('core.read_file') // 'read_file'
 * @example getBaseName('plugin.telegram.send_message') // 'send_message'
 * @example getBaseName('search_tools') // 'search_tools'
 */
export function getBaseName(qualifiedName: string): string {
  const i = qualifiedName.lastIndexOf('.');
  return i >= 0 ? qualifiedName.substring(i + 1) : qualifiedName;
}

/**
 * Extract the namespace prefix from a qualified name.
 *
 * @example getNamespace('core.read_file') // 'core'
 * @example getNamespace('plugin.telegram.send_message') // 'plugin'
 * @example getNamespace('search_tools') // undefined
 */
export function getNamespace(qualifiedName: string): ToolNamespacePrefix | undefined {
  const i = qualifiedName.indexOf('.');
  if (i < 0) return undefined;
  return qualifiedName.substring(0, i) as ToolNamespacePrefix;
}

/**
 * Check if a tool name is already qualified (has a dot-separated prefix).
 * Meta-tools are never considered qualified even though they don't have dots.
 */
export function isQualifiedName(name: string): boolean {
  return name.includes('.');
}

/**
 * Sanitize a tool name for LLM API compatibility.
 *
 * OpenAI/Google/Anthropic APIs require function names to match `^[a-zA-Z0-9_-]{1,64}$`.
 * Dot-separated namespaces like `core.add_task` are not allowed.
 *
 * This replaces `.` with `__` (double underscore):
 *   `core.add_task` → `core__add_task`
 *   `plugin.telegram.send_message` → `plugin__telegram__send_message`
 *   `search_tools` → `search_tools` (unchanged, no dots)
 */
export function sanitizeToolName(name: string): string {
  return name.replaceAll('.', '__');
}

/**
 * Reverse sanitization: convert `__` back to `.` to recover the internal qualified name.
 *
 *   `core__add_task` → `core.add_task`
 *   `plugin__telegram__send_message` → `plugin.telegram.send_message`
 *   `search_tools` → `search_tools` (unchanged, no double underscores)
 */
export function desanitizeToolName(name: string): string {
  return name.replaceAll('__', '.');
}
