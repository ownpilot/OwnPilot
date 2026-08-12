/**
 * Instruction builders for ToolPicker attachments.
 *
 * Each returns the prompt text injected when a user attaches a resource. Pure
 * string construction — extracted from ToolPicker.tsx (1247 LOC) so the wording,
 * which the agent depends on, can be asserted directly.
 */

export const BUILTIN_DATA_TOOL_INSTRUCTIONS: Record<string, string> = {
  tasks: [
    'Data source: tasks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_tasks", {}) — List all tasks',
    '• use_tool("core.list_tasks", {"status":"pending"}) — List pending tasks',
    '• use_tool("core.add_task", {"title":"...", "priority":"normal"}) — Add new task',
    '• use_tool("core.complete_task", {"taskId":"..."}) — Mark task complete',
    '• use_tool("core.update_task", {"taskId":"...", "title":"...", "priority":"..."}) — Update task',
    '• use_tool("core.delete_task", {"taskId":"..."}) — Delete task',
  ].join('\n'),

  bookmarks: [
    'Data source: bookmarks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_bookmarks", {}) — List all bookmarks',
    '• use_tool("core.list_bookmarks", {"search":"...", "category":"..."}) — Filter bookmarks',
    '• use_tool("core.add_bookmark", {"url":"...", "title":"...", "category":"..."}) — Add bookmark',
    '• use_tool("core.delete_bookmark", {"bookmarkId":"..."}) — Delete bookmark',
  ].join('\n'),

  notes: [
    'Data source: notes (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_notes", {}) — List all notes',
    '• use_tool("core.list_notes", {"search":"...", "category":"..."}) — Filter notes',
    '• use_tool("core.add_note", {"title":"...", "content":"..."}) — Create note',
    '• use_tool("core.update_note", {"noteId":"...", "title":"...", "content":"..."}) — Update note',
    '• use_tool("core.delete_note", {"noteId":"..."}) — Delete note',
  ].join('\n'),

  calendar: [
    'Data source: calendar events (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_calendar_events", {}) — List upcoming events',
    '• use_tool("core.list_calendar_events", {"startAfter":"2025-01-01", "startBefore":"2025-12-31"}) — Date range',
    '• use_tool("core.add_calendar_event", {"title":"...", "startTime":"2025-01-15T10:00:00"}) — Add event',
    '• use_tool("core.delete_calendar_event", {"eventId":"..."}) — Delete event',
  ].join('\n'),

  contacts: [
    'Data source: contacts (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_contacts", {}) — List all contacts',
    '• use_tool("core.list_contacts", {"search":"..."}) — Search contacts',
    '• use_tool("core.add_contact", {"name":"...", "email":"...", "phone":"..."}) — Add contact',
    '• use_tool("core.update_contact", {"contactId":"...", "name":"..."}) — Update contact',
    '• use_tool("core.delete_contact", {"contactId":"..."}) — Delete contact',
  ].join('\n'),

  memories: [
    'Data source: AI memories (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_memories", {}) — List all memories',
    '• use_tool("core.recall", {"query":"..."}) — Search memories by keyword',
    '• use_tool("core.remember", {"key":"...", "value":"..."}) — Store a memory',
    '• use_tool("core.forget", {"memoryId":"..."}) — Delete a memory',
  ].join('\n'),

  goals: [
    'Data source: goals (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_goals", {}) — List all goals',
  ].join('\n'),
};

export function buildCustomDataInstructions(displayName: string, internalName: string): string {
  return [
    `Data source: Custom Data Table "${displayName}" (internal table name: ${internalName})`,
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    `• use_tool("core.list_custom_records", {"table_name":"${internalName}"}) — List all records`,
    `• use_tool("core.search_custom_records", {"table_name":"${internalName}", "query":"..."}) — Search records`,
    `• use_tool("core.add_custom_record", {"table_name":"${internalName}", "data":{...}}) — Add record`,
    `• use_tool("core.get_custom_record", {"record_id":"..."}) — Get single record`,
    `• use_tool("core.update_custom_record", {"record_id":"...", "data":{...}}) — Update record`,
    `• use_tool("core.delete_custom_record", {"record_id":"..."}) — Delete record`,
    `• use_tool("core.describe_custom_table", {"table_name":"${internalName}"}) — Get table schema/columns`,
    '',
    'TIP: Call core.describe_custom_table first to learn the column names.',
  ].join('\n');
}

export function buildToolInstructions(
  toolName: string,
  description: string,
  parameters?: Record<string, unknown>
): string {
  const lines: string[] = [
    `Tool: ${toolName}`,
    `Description: ${description}`,
    `IMPORTANT: Call it by name "${toolName}" directly — do NOT use use_tool or search_tools.`,
    '',
  ];

  const props = (parameters?.properties || {}) as Record<string, Record<string, unknown>>;
  const requiredSet = new Set<string>((parameters?.required as string[]) || []);
  const propEntries = Object.entries(props);

  if (propEntries.length > 0) {
    lines.push('Parameters:');
    for (const [paramName, paramDef] of propEntries) {
      const isRequired = requiredSet.has(paramName);
      const typeStr =
        paramDef.enum && Array.isArray(paramDef.enum)
          ? (paramDef.enum as string[]).map((v) => JSON.stringify(v)).join(' | ')
          : String(paramDef.type || 'any');
      lines.push(
        `  • ${paramName}: ${typeStr}${isRequired ? ' (REQUIRED)' : ''}${paramDef.description ? ` — ${paramDef.description}` : ''}`
      );
    }
    lines.push('');
    const ex: Record<string, unknown> = {};
    for (const [p, d] of propEntries) {
      if (requiredSet.has(p)) {
        ex[p] =
          d.enum && Array.isArray(d.enum)
            ? d.enum[0]
            : d.type === 'number' || d.type === 'integer'
              ? 0
              : d.type === 'boolean'
                ? true
                : d.type === 'array'
                  ? []
                  : d.type === 'object'
                    ? {}
                    : '...';
      }
    }
    lines.push(`Example: ${toolName}(${JSON.stringify(ex)})`);
  } else {
    lines.push(`Example: ${toolName}({})`);
  }
  return lines.join('\n');
}

export function buildSkillInstructions(name: string, instructions: string): string {
  return [`Skill: ${name}`, 'Follow these skill instructions carefully:', '', instructions].join(
    '\n'
  );
}

export function buildFileInstructions(name: string, content: string): string {
  return [
    `Attached File: ${name} (${content.length.toLocaleString()} chars)`,
    '--- BEGIN FILE CONTENT ---',
    content,
    '--- END FILE CONTENT ---',
  ].join('\n');
}

export function buildUrlInstructions(url: string, title: string, text: string): string {
  return [
    `Web Page: ${url}`,
    `Title: ${title}`,
    '--- BEGIN PAGE CONTENT ---',
    text,
    '--- END PAGE CONTENT ---',
  ].join('\n');
}

export function buildComposioInstructions(
  action: string,
  appName: string,
  description: string
): string {
  return [
    `Connected App Action: ${action} (${appName})`,
    `Description: ${description}`,
    `To execute: use_tool("composio_execute", {"action": "${action}", "params": {...}})`,
    'IMPORTANT: Use composio_execute to run this action, NOT search_tools.',
  ].join('\n');
}

export function buildMcpToolInstructions(
  toolName: string,
  serverName: string,
  description: string,
  inputSchema?: Record<string, unknown>
): string {
  const lines = [
    `MCP Tool: ${toolName} (from MCP server: ${serverName})`,
    `Description: ${description || 'No description'}`,
    `Call it directly by name: ${toolName}({...}) — do NOT use use_tool() or search_tools().`,
  ];
  const props = (inputSchema?.properties || {}) as Record<string, Record<string, unknown>>;
  const entries = Object.entries(props);
  if (entries.length > 0) {
    lines.push('');
    lines.push('Parameters:');
    const required = new Set<string>((inputSchema?.required as string[]) || []);
    for (const [p, d] of entries) {
      lines.push(
        `  • ${p}: ${String(d.type || 'any')}${required.has(p) ? ' (REQUIRED)' : ''} — ${String(d.description || '')}`
      );
    }
  }
  return lines.join('\n');
}

export function buildArtifactInstructions(title: string, type: string, content: string): string {
  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
  return [
    `Previous AI Artifact: "${title}" (type: ${type})`,
    '--- BEGIN ARTIFACT CONTENT ---',
    truncated,
    '--- END ARTIFACT CONTENT ---',
  ].join('\n');
}
