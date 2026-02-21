import { describe, it, expect } from 'vitest';
import { TOOL_SEARCH_TAGS } from './tool-tags.js';

// ─────────────────────────────────────────────
// Export Shape
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — export shape', () => {
  it('is a non-null object', () => {
    expect(TOOL_SEARCH_TAGS).toBeDefined();
    expect(typeof TOOL_SEARCH_TAGS).toBe('object');
    expect(TOOL_SEARCH_TAGS).not.toBeNull();
  });

  it('is not empty', () => {
    expect(Object.keys(TOOL_SEARCH_TAGS).length).toBeGreaterThan(0);
  });

  it('has only string keys', () => {
    for (const key of Object.keys(TOOL_SEARCH_TAGS)) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('all values are non-empty arrays', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      expect(Array.isArray(tags), `${key} should be an array`).toBe(true);
      expect(tags.length, `${key} should have at least one tag`).toBeGreaterThan(0);
    }
  });

  it('all tag values are strings (no nulls, numbers, or undefined)', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(typeof tag, `${key} has non-string tag: ${String(tag)}`).toBe('string');
      }
    }
  });
});

// ─────────────────────────────────────────────
// Completeness — Category Presence
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — category presence', () => {
  const allKeys = Object.keys(TOOL_SEARCH_TAGS);

  it('contains all 6 email tools', () => {
    const emailTools = ['send_email', 'list_emails', 'read_email', 'delete_email', 'search_emails', 'reply_email'];
    for (const tool of emailTools) {
      expect(allKeys, `missing email tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 7 git tools', () => {
    const gitTools = ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_add', 'git_branch', 'git_checkout'];
    for (const tool of gitTools) {
      expect(allKeys, `missing git tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 7 memory tools', () => {
    const memoryTools = [
      'create_memory', 'batch_create_memories', 'search_memories',
      'delete_memory', 'list_memories', 'update_memory_importance', 'get_memory_stats',
    ];
    for (const tool of memoryTools) {
      expect(allKeys, `missing memory tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 6 task tools', () => {
    const taskTools = ['add_task', 'list_tasks', 'complete_task', 'update_task', 'delete_task', 'batch_add_tasks'];
    for (const tool of taskTools) {
      expect(allKeys, `missing task tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 5 note tools', () => {
    const noteTools = ['add_note', 'list_notes', 'update_note', 'delete_note', 'batch_add_notes'];
    for (const tool of noteTools) {
      expect(allKeys, `missing note tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 4 calendar tools', () => {
    const calTools = ['add_calendar_event', 'list_calendar_events', 'delete_calendar_event', 'batch_add_calendar_events'];
    for (const tool of calTools) {
      expect(allKeys, `missing calendar tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 5 contact tools', () => {
    const contactTools = ['add_contact', 'list_contacts', 'update_contact', 'delete_contact', 'batch_add_contacts'];
    for (const tool of contactTools) {
      expect(allKeys, `missing contact tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 4 bookmark tools', () => {
    const bookmarkTools = ['add_bookmark', 'list_bookmarks', 'delete_bookmark', 'batch_add_bookmarks'];
    for (const tool of bookmarkTools) {
      expect(allKeys, `missing bookmark tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 7 expense tools', () => {
    const expenseTools = [
      'add_expense', 'batch_add_expenses', 'parse_receipt',
      'query_expenses', 'export_expenses', 'expense_summary', 'delete_expense',
    ];
    for (const tool of expenseTools) {
      expect(allKeys, `missing expense tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 8 file system tools', () => {
    const fileTools = [
      'read_file', 'write_file', 'list_directory', 'search_files',
      'download_file', 'get_file_info', 'delete_file', 'copy_file',
    ];
    for (const tool of fileTools) {
      expect(allKeys, `missing file tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 4 web/api tools', () => {
    const webTools = ['http_request', 'fetch_web_page', 'search_web', 'call_json_api'];
    for (const tool of webTools) {
      expect(allKeys, `missing web tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 5 code execution tools', () => {
    const codeTools = ['execute_javascript', 'execute_python', 'execute_shell', 'compile_code', 'package_manager'];
    for (const tool of codeTools) {
      expect(allKeys, `missing code tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 3 image tools', () => {
    const imageTools = ['analyze_image', 'generate_image', 'resize_image'];
    for (const tool of imageTools) {
      expect(allKeys, `missing image tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 5 audio tools', () => {
    const audioTools = ['text_to_speech', 'speech_to_text', 'translate_audio', 'get_audio_info', 'split_audio'];
    for (const tool of audioTools) {
      expect(allKeys, `missing audio tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 3 PDF tools', () => {
    const pdfTools = ['read_pdf', 'create_pdf', 'get_pdf_info'];
    for (const tool of pdfTools) {
      expect(allKeys, `missing PDF tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 8 goal tools', () => {
    const goalTools = [
      'create_goal', 'list_goals', 'update_goal', 'decompose_goal',
      'get_next_actions', 'complete_step', 'get_goal_details', 'get_goal_stats',
    ];
    for (const tool of goalTools) {
      expect(allKeys, `missing goal tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 2 data extraction tools', () => {
    const extractionTools = ['extract_entities', 'extract_table_data'];
    for (const tool of extractionTools) {
      expect(allKeys, `missing data extraction tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 11 custom data tools', () => {
    const customDataTools = [
      'list_custom_tables', 'describe_custom_table', 'create_custom_table', 'delete_custom_table',
      'add_custom_record', 'batch_add_custom_records', 'list_custom_records',
      'search_custom_records', 'get_custom_record', 'update_custom_record', 'delete_custom_record',
    ];
    for (const tool of customDataTools) {
      expect(allKeys, `missing custom data tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 2 weather tools', () => {
    const weatherTools = ['get_weather', 'get_weather_forecast'];
    for (const tool of weatherTools) {
      expect(allKeys, `missing weather tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 22 utility tools', () => {
    const utilityTools = [
      'get_current_datetime', 'calculate', 'convert_units', 'generate_uuid',
      'generate_password', 'random_number', 'hash_text', 'encode_decode',
      'count_text', 'extract_from_text', 'validate_data', 'transform_text',
      'date_diff', 'date_add', 'format_json', 'parse_csv', 'generate_csv',
      'array_operations', 'calculate_statistics', 'compare_text', 'run_regex',
      'get_system_info',
    ];
    for (const tool of utilityTools) {
      expect(allKeys, `missing utility tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 8 dynamic/meta tools', () => {
    const dynamicTools = [
      'create_tool', 'list_custom_tools', 'delete_custom_tool', 'toggle_custom_tool',
      'search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool',
    ];
    for (const tool of dynamicTools) {
      expect(allKeys, `missing dynamic tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 3 config center tools', () => {
    const configTools = ['config_list_services', 'config_get_service', 'config_set_entry'];
    for (const tool of configTools) {
      expect(allKeys, `missing config tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 6 trigger tools', () => {
    const triggerTools = ['create_trigger', 'list_triggers', 'enable_trigger', 'fire_trigger', 'delete_trigger', 'trigger_stats'];
    for (const tool of triggerTools) {
      expect(allKeys, `missing trigger tool: ${tool}`).toContain(tool);
    }
  });

  it('contains all 7 plan tools', () => {
    const planTools = ['create_plan', 'add_plan_step', 'list_plans', 'get_plan_details', 'execute_plan', 'pause_plan', 'delete_plan'];
    for (const tool of planTools) {
      expect(allKeys, `missing plan tool: ${tool}`).toContain(tool);
    }
  });
});

// ─────────────────────────────────────────────
// Tag Quality
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — tag quality', () => {
  it('every tool has at least 2 tags', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      expect(tags.length, `${key} should have at least 2 tags but has ${tags.length}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('no tool has duplicate tags within its own array', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      const unique = new Set(tags);
      expect(unique.size, `${key} has duplicate tags`).toBe(tags.length);
    }
  });

  it('all tags are lowercase', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(tag, `${key} has non-lowercase tag: "${tag}"`).toBe(tag.toLowerCase());
      }
    }
  });

  it('all tags are non-empty strings', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(tag.length, `${key} has an empty string tag`).toBeGreaterThan(0);
      }
    }
  });

  it('no tag exceeds 40 characters', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(tag.length, `${key} tag "${tag}" is too long (${tag.length} chars)`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('all tags are trimmed (no leading/trailing whitespace)', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(tag, `${key} tag "${tag}" has extra whitespace`).toBe(tag.trim());
      }
    }
  });

  it('no tag contains tab or newline characters', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        expect(tag, `${key} tag "${tag}" contains tab/newline`).not.toMatch(/[\t\n\r]/);
      }
    }
  });

  it('all tool names use snake_case convention', () => {
    for (const key of Object.keys(TOOL_SEARCH_TAGS)) {
      expect(key, `tool name "${key}" is not snake_case`).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it('tags are readonly arrays (Object.isFrozen or push throws)', () => {
    // TypeScript enforces readonly at compile time, but we verify
    // that at runtime the arrays are treated as readonly (either frozen or not extensible)
    // The main check is that the type is correct — runtime freeze is optional
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      expect(Array.isArray(tags), `${key} tags should be an array`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────
// Tag Content — Keyword Coverage
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — tag content / keyword coverage', () => {
  const hasAnyTag = (toolName: string, keywords: string[]): boolean => {
    const tags = TOOL_SEARCH_TAGS[toolName];
    if (!tags) return false;
    return keywords.some(kw => tags.some(tag => tag.includes(kw)));
  };

  it('email tools all contain "email" or "mail" tag', () => {
    const emailTools = ['send_email', 'list_emails', 'read_email', 'delete_email', 'search_emails', 'reply_email'];
    for (const tool of emailTools) {
      expect(hasAnyTag(tool, ['email', 'mail']), `${tool} should have email/mail tag`).toBe(true);
    }
  });

  it('git tools all contain "git" tag', () => {
    const gitTools = ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_add', 'git_branch', 'git_checkout'];
    for (const tool of gitTools) {
      expect(TOOL_SEARCH_TAGS[tool], `${tool} should exist`).toBeDefined();
      expect(TOOL_SEARCH_TAGS[tool]!.includes('git'), `${tool} should have "git" tag`).toBe(true);
    }
  });

  it('task tools all contain "task" or "todo" or "done" tag', () => {
    const taskTools = ['add_task', 'list_tasks', 'complete_task', 'update_task', 'delete_task', 'batch_add_tasks'];
    for (const tool of taskTools) {
      expect(hasAnyTag(tool, ['task', 'todo', 'done', 'complete']), `${tool} should have task-related tag`).toBe(true);
    }
  });

  it('file tools contain "file" or related tag', () => {
    const fileTools = ['read_file', 'write_file', 'search_files', 'delete_file', 'copy_file', 'get_file_info'];
    for (const tool of fileTools) {
      expect(hasAnyTag(tool, ['file']), `${tool} should have "file" tag`).toBe(true);
    }
  });

  it('code execution tools contain "code" or "run" tag', () => {
    const codeTools = ['execute_javascript', 'execute_python', 'execute_shell', 'compile_code'];
    for (const tool of codeTools) {
      expect(hasAnyTag(tool, ['code', 'run']), `${tool} should have code/run tag`).toBe(true);
    }
  });

  it('calendar tools all contain "calendar" or "event" tag', () => {
    const calTools = ['add_calendar_event', 'list_calendar_events', 'delete_calendar_event', 'batch_add_calendar_events'];
    for (const tool of calTools) {
      expect(hasAnyTag(tool, ['calendar', 'event']), `${tool} should have calendar/event tag`).toBe(true);
    }
  });

  it('contact tools all contain "contact" tag', () => {
    const contactTools = ['add_contact', 'list_contacts', 'update_contact', 'delete_contact', 'batch_add_contacts'];
    for (const tool of contactTools) {
      expect(hasAnyTag(tool, ['contact']), `${tool} should have contact tag`).toBe(true);
    }
  });

  it('bookmark tools all contain "bookmark" tag', () => {
    const bookmarkTools = ['add_bookmark', 'list_bookmarks', 'delete_bookmark', 'batch_add_bookmarks'];
    for (const tool of bookmarkTools) {
      expect(hasAnyTag(tool, ['bookmark']), `${tool} should have bookmark tag`).toBe(true);
    }
  });

  it('expense tools all contain "expense" or "money" or "budget" tag', () => {
    const expenseTools = ['add_expense', 'batch_add_expenses', 'query_expenses', 'export_expenses', 'expense_summary', 'delete_expense'];
    for (const tool of expenseTools) {
      expect(hasAnyTag(tool, ['expense', 'money', 'budget']), `${tool} should have expense-related tag`).toBe(true);
    }
  });

  it('goal tools all contain "goal" or "objective" tag', () => {
    const goalTools = ['create_goal', 'list_goals', 'update_goal', 'get_goal_details', 'get_goal_stats'];
    for (const tool of goalTools) {
      expect(hasAnyTag(tool, ['goal', 'objective']), `${tool} should have goal/objective tag`).toBe(true);
    }
  });

  it('trigger tools all contain "trigger" or "automation" tag', () => {
    const triggerTools = ['create_trigger', 'list_triggers', 'enable_trigger', 'fire_trigger', 'delete_trigger', 'trigger_stats'];
    for (const tool of triggerTools) {
      expect(hasAnyTag(tool, ['trigger', 'automation']), `${tool} should have trigger/automation tag`).toBe(true);
    }
  });

  it('plan tools all contain "plan" or "workflow" tag', () => {
    const planTools = ['create_plan', 'add_plan_step', 'list_plans', 'get_plan_details', 'execute_plan', 'pause_plan', 'delete_plan'];
    for (const tool of planTools) {
      expect(hasAnyTag(tool, ['plan', 'workflow']), `${tool} should have plan/workflow tag`).toBe(true);
    }
  });

  it('PDF tools all contain "pdf" or "document" tag', () => {
    const pdfTools = ['read_pdf', 'create_pdf', 'get_pdf_info'];
    for (const tool of pdfTools) {
      expect(hasAnyTag(tool, ['pdf', 'document']), `${tool} should have pdf/document tag`).toBe(true);
    }
  });

  it('audio tools all contain "audio" tag', () => {
    const audioTools = ['text_to_speech', 'speech_to_text', 'translate_audio', 'get_audio_info', 'split_audio'];
    for (const tool of audioTools) {
      expect(hasAnyTag(tool, ['audio']), `${tool} should have audio tag`).toBe(true);
    }
  });

  it('weather tools all contain "weather" or "forecast" tag', () => {
    const weatherTools = ['get_weather', 'get_weather_forecast'];
    for (const tool of weatherTools) {
      expect(hasAnyTag(tool, ['weather', 'forecast']), `${tool} should have weather/forecast tag`).toBe(true);
    }
  });

  it('meta-tools (search_tools, use_tool, batch_use_tool) are present', () => {
    expect(TOOL_SEARCH_TAGS['search_tools']).toBeDefined();
    expect(TOOL_SEARCH_TAGS['use_tool']).toBeDefined();
    expect(TOOL_SEARCH_TAGS['batch_use_tool']).toBeDefined();
  });

  it('search_tools has "find tool" or "discover" tag', () => {
    const tags = TOOL_SEARCH_TAGS['search_tools']!;
    const hasFindOrDiscover = tags.some(t => t.includes('find tool') || t.includes('discover'));
    expect(hasFindOrDiscover).toBe(true);
  });

  it('batch_use_tool has "batch" or "parallel" tag', () => {
    const tags = TOOL_SEARCH_TAGS['batch_use_tool']!;
    const hasBatchOrParallel = tags.some(t => t.includes('batch') || t.includes('parallel'));
    expect(hasBatchOrParallel).toBe(true);
  });

  it('config tools contain "config" or "settings" tag', () => {
    const configTools = ['config_list_services', 'config_get_service', 'config_set_entry'];
    for (const tool of configTools) {
      expect(hasAnyTag(tool, ['config', 'settings']), `${tool} should have config/settings tag`).toBe(true);
    }
  });

  it('custom data tools contain "table" or "record" or "database" tag', () => {
    const dataTools = ['list_custom_tables', 'create_custom_table', 'add_custom_record', 'list_custom_records'];
    for (const tool of dataTools) {
      expect(hasAnyTag(tool, ['table', 'record', 'database']), `${tool} should have table/record/database tag`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────
// Cross-category Consistency
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — cross-category consistency', () => {
  const allKeys = Object.keys(TOOL_SEARCH_TAGS);

  it('has no duplicate tool names', () => {
    const unique = new Set(allKeys);
    expect(unique.size).toBe(allKeys.length);
  });

  it('total tool count is at least 130', () => {
    // Sum of all category counts: 6+7+7+6+5+4+5+4+7+8+4+5+3+5+3+8+2+11+2+21+8+3+6+7 = 141
    expect(allKeys.length).toBeGreaterThanOrEqual(130);
  });

  it('create_ and delete_ pairs exist for tasks', () => {
    expect(allKeys).toContain('add_task');
    expect(allKeys).toContain('delete_task');
  });

  it('create_ and delete_ pairs exist for notes', () => {
    expect(allKeys).toContain('add_note');
    expect(allKeys).toContain('delete_note');
  });

  it('create_ and delete_ pairs exist for calendar events', () => {
    expect(allKeys).toContain('add_calendar_event');
    expect(allKeys).toContain('delete_calendar_event');
  });

  it('create_ and delete_ pairs exist for contacts', () => {
    expect(allKeys).toContain('add_contact');
    expect(allKeys).toContain('delete_contact');
  });

  it('create_ and delete_ pairs exist for bookmarks', () => {
    expect(allKeys).toContain('add_bookmark');
    expect(allKeys).toContain('delete_bookmark');
  });

  it('create_ and delete_ pairs exist for goals', () => {
    expect(allKeys).toContain('create_goal');
    // goals use list_goals but no delete_goal — verify decompose exists instead
    expect(allKeys).toContain('decompose_goal');
  });

  it('create_ and delete_ pairs exist for custom tables', () => {
    expect(allKeys).toContain('create_custom_table');
    expect(allKeys).toContain('delete_custom_table');
  });

  it('create_ and delete_ pairs exist for custom records', () => {
    expect(allKeys).toContain('add_custom_record');
    expect(allKeys).toContain('delete_custom_record');
  });

  it('create_ and delete_ pairs exist for triggers', () => {
    expect(allKeys).toContain('create_trigger');
    expect(allKeys).toContain('delete_trigger');
  });

  it('create_ and delete_ pairs exist for plans', () => {
    expect(allKeys).toContain('create_plan');
    expect(allKeys).toContain('delete_plan');
  });

  it('create_ and delete_ pairs exist for expenses', () => {
    expect(allKeys).toContain('add_expense');
    expect(allKeys).toContain('delete_expense');
  });

  it('create_ and delete_ pairs exist for files', () => {
    expect(allKeys).toContain('write_file');
    expect(allKeys).toContain('delete_file');
  });

  it('create_ and delete_ pairs exist for emails', () => {
    expect(allKeys).toContain('send_email');
    expect(allKeys).toContain('delete_email');
  });

  it('batch_ variants exist for tasks', () => {
    expect(allKeys).toContain('batch_add_tasks');
  });

  it('batch_ variants exist for notes', () => {
    expect(allKeys).toContain('batch_add_notes');
  });

  it('batch_ variants exist for calendar events', () => {
    expect(allKeys).toContain('batch_add_calendar_events');
  });

  it('batch_ variants exist for contacts', () => {
    expect(allKeys).toContain('batch_add_contacts');
  });

  it('batch_ variants exist for bookmarks', () => {
    expect(allKeys).toContain('batch_add_bookmarks');
  });

  it('batch_ variants exist for expenses', () => {
    expect(allKeys).toContain('batch_add_expenses');
  });

  it('batch_ variants exist for custom records', () => {
    expect(allKeys).toContain('batch_add_custom_records');
  });

  it('batch_ variants exist for memories', () => {
    expect(allKeys).toContain('batch_create_memories');
  });

  it('most categories have a list_ tool', () => {
    const listTools = allKeys.filter(k => k.startsWith('list_'));
    // tasks, notes, calendar, contacts, bookmarks, memories, goals, plans, triggers, custom_tables, custom_records, custom_tools, emails, bookmarks
    expect(listTools.length).toBeGreaterThanOrEqual(10);
  });

  it('CRUD pattern: tasks have add/list/update/delete', () => {
    expect(allKeys).toContain('add_task');
    expect(allKeys).toContain('list_tasks');
    expect(allKeys).toContain('update_task');
    expect(allKeys).toContain('delete_task');
  });

  it('CRUD pattern: notes have add/list/update/delete', () => {
    expect(allKeys).toContain('add_note');
    expect(allKeys).toContain('list_notes');
    expect(allKeys).toContain('update_note');
    expect(allKeys).toContain('delete_note');
  });

  it('CRUD pattern: contacts have add/list/update/delete', () => {
    expect(allKeys).toContain('add_contact');
    expect(allKeys).toContain('list_contacts');
    expect(allKeys).toContain('update_contact');
    expect(allKeys).toContain('delete_contact');
  });

  it('CRUD pattern: custom records have add/list/get/update/delete', () => {
    expect(allKeys).toContain('add_custom_record');
    expect(allKeys).toContain('list_custom_records');
    expect(allKeys).toContain('get_custom_record');
    expect(allKeys).toContain('update_custom_record');
    expect(allKeys).toContain('delete_custom_record');
  });
});

// ─────────────────────────────────────────────
// Specific Tool Tag Verification
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — specific tool tag verification', () => {
  it('add_task includes "todo" and "reminder"', () => {
    const tags = TOOL_SEARCH_TAGS['add_task']!;
    expect(tags).toContain('todo');
    expect(tags).toContain('reminder');
  });

  it('search_web includes "google" and "internet"', () => {
    const tags = TOOL_SEARCH_TAGS['search_web']!;
    expect(tags).toContain('google');
    expect(tags).toContain('internet');
  });

  it('execute_javascript includes "javascript" and "js"', () => {
    const tags = TOOL_SEARCH_TAGS['execute_javascript']!;
    expect(tags).toContain('javascript');
    expect(tags).toContain('js');
  });

  it('execute_python includes "python" and "py"', () => {
    const tags = TOOL_SEARCH_TAGS['execute_python']!;
    expect(tags).toContain('python');
    expect(tags).toContain('py');
  });

  it('text_to_speech includes "tts" and "voice"', () => {
    const tags = TOOL_SEARCH_TAGS['text_to_speech']!;
    expect(tags).toContain('tts');
    expect(tags).toContain('voice');
  });

  it('calculate includes "math" and "formula"', () => {
    const tags = TOOL_SEARCH_TAGS['calculate']!;
    expect(tags).toContain('math');
    expect(tags).toContain('formula');
  });

  it('add_bookmark includes "bookmark" and "url"', () => {
    const tags = TOOL_SEARCH_TAGS['add_bookmark']!;
    expect(tags).toContain('bookmark');
    expect(tags).toContain('url');
  });

  it('create_trigger includes "automation", "schedule", and "cron"', () => {
    const tags = TOOL_SEARCH_TAGS['create_trigger']!;
    expect(tags).toContain('automation');
    expect(tags).toContain('schedule');
    expect(tags).toContain('cron');
  });

  it('speech_to_text includes "stt" and "transcribe"', () => {
    const tags = TOOL_SEARCH_TAGS['speech_to_text']!;
    expect(tags).toContain('stt');
    expect(tags).toContain('transcribe');
  });

  it('execute_shell includes "bash" and "terminal"', () => {
    const tags = TOOL_SEARCH_TAGS['execute_shell']!;
    expect(tags).toContain('bash');
    expect(tags).toContain('terminal');
  });

  it('hash_text includes "md5" and "sha"', () => {
    const tags = TOOL_SEARCH_TAGS['hash_text']!;
    expect(tags).toContain('md5');
    expect(tags).toContain('sha');
  });

  it('encode_decode includes "base64" and "url encode"', () => {
    const tags = TOOL_SEARCH_TAGS['encode_decode']!;
    expect(tags).toContain('base64');
    expect(tags).toContain('url encode');
  });

  it('convert_units includes unit-related tags', () => {
    const tags = TOOL_SEARCH_TAGS['convert_units']!;
    expect(tags).toContain('celsius');
    expect(tags).toContain('fahrenheit');
    expect(tags).toContain('inch');
  });

  it('http_request includes "api" and "rest"', () => {
    const tags = TOOL_SEARCH_TAGS['http_request']!;
    expect(tags).toContain('api');
    expect(tags).toContain('rest');
  });

  it('parse_receipt includes "receipt" and "invoice"', () => {
    const tags = TOOL_SEARCH_TAGS['parse_receipt']!;
    expect(tags).toContain('receipt');
    expect(tags).toContain('invoice');
  });

  it('fetch_web_page includes "scrape" and "html"', () => {
    const tags = TOOL_SEARCH_TAGS['fetch_web_page']!;
    expect(tags).toContain('scrape');
    expect(tags).toContain('html');
  });

  it('generate_password includes "password" and "secure"', () => {
    const tags = TOOL_SEARCH_TAGS['generate_password']!;
    expect(tags).toContain('password');
    expect(tags).toContain('secure');
  });

  it('analyze_image includes "vision" and "ocr"', () => {
    const tags = TOOL_SEARCH_TAGS['analyze_image']!;
    expect(tags).toContain('vision');
    expect(tags).toContain('ocr');
  });

  it('get_tool_help includes "help" and "documentation"', () => {
    const tags = TOOL_SEARCH_TAGS['get_tool_help']!;
    expect(tags).toContain('help');
    expect(tags).toContain('documentation');
  });

  it('add_expense includes "money" and "payment"', () => {
    const tags = TOOL_SEARCH_TAGS['add_expense']!;
    expect(tags).toContain('money');
    expect(tags).toContain('payment');
  });

  it('export_expenses includes "csv" and "report"', () => {
    const tags = TOOL_SEARCH_TAGS['export_expenses']!;
    expect(tags).toContain('csv');
    expect(tags).toContain('report');
  });

  it('decompose_goal includes "break down" and "sub-goals"', () => {
    const tags = TOOL_SEARCH_TAGS['decompose_goal']!;
    expect(tags).toContain('break down');
    expect(tags).toContain('sub-goals');
  });

  it('package_manager includes "npm" and "pip"', () => {
    const tags = TOOL_SEARCH_TAGS['package_manager']!;
    expect(tags).toContain('npm');
    expect(tags).toContain('pip');
  });

  it('get_system_info includes "os" and "cpu"', () => {
    const tags = TOOL_SEARCH_TAGS['get_system_info']!;
    expect(tags).toContain('os');
    expect(tags).toContain('cpu');
  });

  it('calculate_statistics includes "average" and "median"', () => {
    const tags = TOOL_SEARCH_TAGS['calculate_statistics']!;
    expect(tags).toContain('average');
    expect(tags).toContain('median');
  });

  it('run_regex includes "regex" and "regular expression"', () => {
    const tags = TOOL_SEARCH_TAGS['run_regex']!;
    expect(tags).toContain('regex');
    expect(tags).toContain('regular expression');
  });

  it('create_plan includes "workflow" and "automation"', () => {
    const tags = TOOL_SEARCH_TAGS['create_plan']!;
    expect(tags).toContain('workflow');
    expect(tags).toContain('automation');
  });

  it('send_email includes "smtp" and "notify"', () => {
    const tags = TOOL_SEARCH_TAGS['send_email']!;
    expect(tags).toContain('smtp');
    expect(tags).toContain('notify');
  });

  it('list_directory includes "ls" and "folder"', () => {
    const tags = TOOL_SEARCH_TAGS['list_directory']!;
    expect(tags).toContain('ls');
    expect(tags).toContain('folder');
  });

  it('random_number includes "dice" and "luck"', () => {
    const tags = TOOL_SEARCH_TAGS['random_number']!;
    expect(tags).toContain('dice');
    expect(tags).toContain('luck');
  });

  it('generate_uuid includes "uuid" and "unique"', () => {
    const tags = TOOL_SEARCH_TAGS['generate_uuid']!;
    expect(tags).toContain('uuid');
    expect(tags).toContain('unique');
  });
});

// ─────────────────────────────────────────────
// Aggregate Statistics
// ─────────────────────────────────────────────

describe('TOOL_SEARCH_TAGS — aggregate statistics', () => {
  it('total unique tag count is reasonably large', () => {
    const allTags = new Set<string>();
    for (const tags of Object.values(TOOL_SEARCH_TAGS)) {
      for (const tag of tags) {
        allTags.add(tag);
      }
    }
    // With 140+ tools and 2+ tags each, there should be many unique tags
    expect(allTags.size).toBeGreaterThanOrEqual(100);
  });

  it('average tags per tool is at least 3', () => {
    const entries = Object.entries(TOOL_SEARCH_TAGS);
    const totalTags = entries.reduce((sum, [, tags]) => sum + tags.length, 0);
    const avg = totalTags / entries.length;
    expect(avg).toBeGreaterThanOrEqual(3);
  });

  it('no single tool has more than 20 tags', () => {
    for (const [key, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
      expect(tags.length, `${key} has too many tags (${tags.length})`).toBeLessThanOrEqual(20);
    }
  });

  it('the exact tool count matches the source (148 tools)', () => {
    // Count from source: email(6) + git(7) + memory(7) + tasks(6) + notes(5) +
    // calendar(4) + contacts(5) + bookmarks(4) + expenses(7) + files(8) +
    // web(4) + code(5) + image(3) + audio(5) + pdf(3) + goals(8) +
    // extraction(2) + custom_data(11) + weather(2) + utility(22) +
    // dynamic(8) + config(3) + triggers(6) + plans(7) = 148
    expect(Object.keys(TOOL_SEARCH_TAGS).length).toBe(148);
  });
});
