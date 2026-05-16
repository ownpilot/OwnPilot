/**
 * Tool Name Aliases
 *
 * LLMs reliably hallucinate a few "obvious" tool names that don't exist
 * (e.g. `get_current_time` instead of `get_current_datetime`). Rather
 * than failing the tool call and forcing the model to recover via
 * `search_tools`, we transparently rewrite the call. The map is
 * deliberately conservative — only well-trodden hallucinations land here,
 * because every alias is a permanent contract.
 */

/**
 * Wrong name → correct name. Keys are bare (un-namespaced); both bare and
 * namespaced ("core.get_current_time") forms are resolved by
 * `resolveToolAlias`.
 */
export const TOOL_ALIASES: Record<string, string> = {
  // Time/Date
  get_current_time: 'get_current_datetime',
  get_time: 'get_current_datetime',
  current_time: 'get_current_datetime',
  get_date: 'get_current_datetime',
  get_datetime: 'get_current_datetime',

  // Tasks
  get_tasks: 'list_tasks',
  create_task: 'add_task',
  new_task: 'add_task',
  remove_task: 'delete_task',

  // Notes
  get_notes: 'list_notes',
  create_note: 'add_note',
  new_note: 'add_note',
  remove_note: 'delete_note',

  // Memory
  get_memories: 'list_memories',
  save_memory: 'add_memory',
  remember: 'add_memory',
  recall: 'search_memories',

  // Calendar
  get_events: 'list_events',
  create_event: 'add_event',
  new_event: 'add_event',

  // Contacts
  get_contacts: 'list_contacts',
  create_contact: 'add_contact',
  new_contact: 'add_contact',

  // Bookmarks
  get_bookmarks: 'list_bookmarks',
  create_bookmark: 'add_bookmark',
  new_bookmark: 'add_bookmark',

  // Files
  read_file: 'file_read',
  write_file: 'file_write',
  list_files: 'file_list',
  delete_file: 'file_delete',

  // Web
  fetch_url: 'web_fetch',
  browse: 'web_search',
  google: 'web_search',
  search: 'web_search',
  search_web: 'web_search',

  // Email
  send_mail: 'send_email',
  compose_email: 'send_email',

  // Goals
  get_goals: 'list_goals',
  create_goal: 'add_goal',
  new_goal: 'add_goal',

  // Git
  git_log: 'git_history',

  // Code
  run_code: 'execute_code',
  exec_code: 'execute_code',
  eval_code: 'execute_code',
};

/**
 * Resolve a tool name through the alias map.
 * Returns the canonical name (preserving the caller's namespace prefix), or
 * null if no alias applies.
 */
export function resolveToolAlias(toolName: string): string | null {
  const alias = TOOL_ALIASES[toolName];
  if (alias) return alias;

  // Strip namespace prefix (e.g., "core.get_current_time" → "get_current_time"),
  // resolve, then re-prefix.
  const dotIdx = toolName.indexOf('.');
  if (dotIdx > 0) {
    const prefix = toolName.slice(0, dotIdx + 1);
    const baseName = toolName.slice(dotIdx + 1);
    const baseAlias = TOOL_ALIASES[baseName];
    if (baseAlias) return prefix + baseAlias;
  }

  return null;
}
