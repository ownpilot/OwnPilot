/**
 * Extension Permission Checker
 *
 * Maps SkillPermission categories to tool name patterns and checks
 * whether a tool call is allowed by an extension's granted permissions.
 */

import type { SkillPermission } from './extension-types.js';
import { getLog } from './log.js';

const log = getLog('ExtPerms');

// =============================================================================
// Permission → Tool Mapping
// =============================================================================

/**
 * Maps each SkillPermission to tool name patterns that require it.
 * Patterns support prefix matching with `*` wildcard at end.
 */
const PERMISSION_TOOL_MAP: Record<SkillPermission, string[]> = {
  memories: [
    'add_memory',
    'search_memories',
    'delete_memory',
    'get_memory',
    'list_memories',
    'update_memory',
  ],
  goals: [
    'create_goal',
    'update_goal',
    'delete_goal',
    'list_goals',
    'get_goal',
    'add_goal_step',
    'update_goal_step',
  ],
  tasks: ['create_task', 'update_task', 'delete_task', 'list_tasks', 'get_task', 'complete_task'],
  contacts: [
    'create_contact',
    'update_contact',
    'delete_contact',
    'list_contacts',
    'search_contacts',
    'get_contact',
  ],
  calendar: ['create_event', 'update_event', 'delete_event', 'list_events', 'get_event'],
  notes: ['create_note', 'update_note', 'delete_note', 'list_notes', 'get_note', 'search_notes'],
  'custom-data': [
    'create_table',
    'add_record',
    'update_record',
    'delete_record',
    'query_records',
    'list_tables',
    'get_table',
    'delete_table',
    'batch_add_records',
  ],
  triggers: [
    'create_trigger',
    'update_trigger',
    'delete_trigger',
    'list_triggers',
    'get_trigger',
    'toggle_trigger',
  ],
  plans: [
    'create_plan',
    'update_plan',
    'delete_plan',
    'list_plans',
    'get_plan',
    'add_plan_step',
    'update_plan_step',
  ],
  network: ['http_request', 'fetch_web_page', 'search_web', 'call_json_api'],
  browser: [
    'browse_web',
    'browser_click',
    'browser_type',
    'browser_fill_form',
    'browser_screenshot',
    'browser_extract',
  ],
  config: ['get_config', 'set_config', 'list_config'],
  expenses: ['create_expense', 'update_expense', 'delete_expense', 'list_expenses', 'get_expense'],
  bookmarks: [
    'create_bookmark',
    'update_bookmark',
    'delete_bookmark',
    'list_bookmarks',
    'get_bookmark',
  ],
};

// Pre-build reverse lookup: tool base name → required permission
const _toolToPermission = new Map<string, SkillPermission>();
for (const [perm, tools] of Object.entries(PERMISSION_TOOL_MAP)) {
  for (const tool of tools) {
    _toolToPermission.set(tool, perm as SkillPermission);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the permission required to call a given tool.
 * Returns null if the tool doesn't require any specific permission.
 */
export function getRequiredPermission(toolName: string): SkillPermission | null {
  // Strip namespace prefix (e.g. "core.create_task" → "create_task")
  const baseName = toolName.includes('.') ? toolName.split('.').pop()! : toolName;
  return _toolToPermission.get(baseName) ?? null;
}

/**
 * Check if a tool call is allowed by the granted permissions.
 * - If the tool doesn't require a specific permission, it's always allowed.
 * - If the extension has no permissions field (legacy), all tools are allowed.
 */
export function checkPermission(
  toolName: string,
  grantedPermissions: SkillPermission[] | undefined
): boolean {
  // Legacy extensions without permissions → unrestricted
  if (!grantedPermissions) return true;

  const required = getRequiredPermission(toolName);
  // Tool doesn't need a specific permission → allowed
  if (!required) return true;

  return grantedPermissions.includes(required);
}

/**
 * Get human-readable description for a permission.
 */
export function getPermissionDescription(permission: SkillPermission): string {
  const descriptions: Record<SkillPermission, string> = {
    memories: 'Access and modify AI memories',
    goals: 'Create and manage goals',
    tasks: 'Create and manage tasks',
    contacts: 'Access and modify contacts',
    calendar: 'Access and modify calendar events',
    notes: 'Create and manage notes',
    'custom-data': 'Create and manage custom data tables',
    triggers: 'Create and manage automation triggers',
    plans: 'Create and manage plans',
    network: 'Make HTTP requests to external services',
    browser: 'Control headless browser for web automation',
    config: 'Access configuration settings',
    expenses: 'Create and manage expense records',
    bookmarks: 'Create and manage bookmarks',
  };
  return descriptions[permission] ?? permission;
}

/**
 * Categorize permissions by sensitivity level.
 */
export function getPermissionSensitivity(permission: SkillPermission): 'low' | 'medium' | 'high' {
  const high: SkillPermission[] = ['network', 'browser', 'config'];
  const medium: SkillPermission[] = ['contacts', 'calendar', 'expenses', 'custom-data', 'triggers'];
  if (high.includes(permission)) return 'high';
  if (medium.includes(permission)) return 'medium';
  return 'low';
}

/**
 * Get all available permission categories.
 */
export function getAllPermissions(): SkillPermission[] {
  return Object.keys(PERMISSION_TOOL_MAP) as SkillPermission[];
}

/**
 * Log a permission denial for debugging.
 */
export function logPermissionDenied(
  extensionId: string,
  toolName: string,
  requiredPermission: SkillPermission
): void {
  log.warn(
    `Permission denied: extension "${extensionId}" tried to call "${toolName}" ` +
      `but lacks "${requiredPermission}" permission`
  );
}
