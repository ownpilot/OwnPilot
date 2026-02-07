import { describe, it, expect } from 'vitest';
import {
  TOOL_GROUPS,
  DEFAULT_ENABLED_GROUPS,
  getEnabledTools,
  getToolGroups,
  getGroupForTool,
  getToolStats,
} from './tool-config.js';

// ===========================================================================
// TOOL_GROUPS constant
// ===========================================================================

describe('TOOL_GROUPS', () => {
  const groupIds = Object.keys(TOOL_GROUPS);

  it('contains the core group', () => {
    expect(TOOL_GROUPS.core).toBeDefined();
  });

  it('contains the filesystem group', () => {
    expect(TOOL_GROUPS.filesystem).toBeDefined();
  });

  it('contains personal data groups', () => {
    for (const id of ['tasks', 'bookmarks', 'notes', 'contacts', 'calendar']) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });

  it('contains memory and goals groups', () => {
    expect(TOOL_GROUPS.memory).toBeDefined();
    expect(TOOL_GROUPS.goals).toBeDefined();
  });

  it('contains email group', () => {
    expect(TOOL_GROUPS.email).toBeDefined();
  });

  it('contains git group', () => {
    expect(TOOL_GROUPS.git).toBeDefined();
  });

  it('contains customData group', () => {
    expect(TOOL_GROUPS.customData).toBeDefined();
  });

  it('contains customTools group', () => {
    expect(TOOL_GROUPS.customTools).toBeDefined();
  });

  it('contains utility groups', () => {
    for (const id of ['textUtils', 'dateTime', 'conversion', 'generation', 'extraction', 'validation', 'listOps', 'mathStats']) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });

  it('contains advanced groups', () => {
    for (const id of ['codeExecution', 'webFetch', 'weather', 'image', 'audio', 'pdf', 'translation', 'vectorSearch', 'dataExtraction']) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });

  describe('group structure', () => {
    it.each(groupIds)('group "%s" has all required fields', (groupId) => {
      const group = TOOL_GROUPS[groupId];
      expect(typeof group.id).toBe('string');
      expect(group.id.length).toBeGreaterThan(0);
      expect(typeof group.name).toBe('string');
      expect(group.name.length).toBeGreaterThan(0);
      expect(typeof group.description).toBe('string');
      expect(group.description.length).toBeGreaterThan(0);
      expect(typeof group.defaultEnabled).toBe('boolean');
      expect(Array.isArray(group.tools)).toBe(true);
    });

    it.each(groupIds)('group "%s" has a non-empty tools array', (groupId) => {
      expect(TOOL_GROUPS[groupId].tools.length).toBeGreaterThan(0);
    });

    it.each(groupIds)('group "%s" id matches its key', (groupId) => {
      expect(TOOL_GROUPS[groupId].id).toBe(groupId);
    });
  });

  describe('no duplicate tool names', () => {
    it('has no duplicate tool names across all groups', () => {
      const allTools: string[] = [];
      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const group of Object.values(TOOL_GROUPS)) {
        for (const tool of group.tools) {
          if (seen.has(tool)) {
            duplicates.push(tool);
          }
          seen.add(tool);
          allTools.push(tool);
        }
      }

      expect(duplicates).toEqual([]);
    });
  });
});

// ===========================================================================
// DEFAULT_ENABLED_GROUPS
// ===========================================================================

describe('DEFAULT_ENABLED_GROUPS', () => {
  it('is a non-empty array', () => {
    expect(DEFAULT_ENABLED_GROUPS.length).toBeGreaterThan(0);
  });

  it('contains core and filesystem', () => {
    expect(DEFAULT_ENABLED_GROUPS).toContain('core');
    expect(DEFAULT_ENABLED_GROUPS).toContain('filesystem');
  });

  it('contains personal data groups', () => {
    for (const id of ['tasks', 'bookmarks', 'notes', 'calendar', 'contacts']) {
      expect(DEFAULT_ENABLED_GROUPS).toContain(id);
    }
  });

  it('contains customData', () => {
    expect(DEFAULT_ENABLED_GROUPS).toContain('customData');
  });

  it('contains memory and goals', () => {
    expect(DEFAULT_ENABLED_GROUPS).toContain('memory');
    expect(DEFAULT_ENABLED_GROUPS).toContain('goals');
  });

  it('does not contain codeExecution by default', () => {
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('codeExecution');
  });

  it('does not contain webFetch by default', () => {
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('webFetch');
  });

  it('does not contain email by default', () => {
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('email');
  });

  it('does not contain git by default', () => {
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('git');
  });

  it('only contains valid group ids', () => {
    for (const id of DEFAULT_ENABLED_GROUPS) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });
});

// ===========================================================================
// getEnabledTools
// ===========================================================================

describe('getEnabledTools', () => {
  it('returns tools from default enabled groups when called with no argument', () => {
    const tools = getEnabledTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('includes core tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).toContain('get_current_time');
    expect(tools).toContain('calculate');
    expect(tools).toContain('generate_uuid');
  });

  it('includes filesystem tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).toContain('read_file');
    expect(tools).toContain('write_file');
  });

  it('does not include code execution tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).not.toContain('execute_javascript');
    expect(tools).not.toContain('execute_shell');
  });

  it('returns only tools for specified groups', () => {
    const tools = getEnabledTools(['core']);
    expect(tools).toEqual(expect.arrayContaining(['get_current_time', 'calculate', 'generate_uuid']));
    // Should not contain tools from other groups
    expect(tools).not.toContain('read_file');
    expect(tools).not.toContain('add_task');
  });

  it('returns tools from multiple specified groups', () => {
    const tools = getEnabledTools(['core', 'tasks']);
    expect(tools).toContain('get_current_time');
    expect(tools).toContain('add_task');
    expect(tools).toContain('list_tasks');
  });

  it('deduplicates tool names', () => {
    // Pass the same group twice
    const tools = getEnabledTools(['core', 'core']);
    const unique = new Set(tools);
    expect(tools.length).toBe(unique.size);
  });

  it('handles empty array', () => {
    const tools = getEnabledTools([]);
    expect(tools).toEqual([]);
  });

  it('handles unknown group names gracefully', () => {
    const tools = getEnabledTools(['nonexistent_group']);
    expect(tools).toEqual([]);
  });

  it('skips unknown groups but includes valid ones', () => {
    const tools = getEnabledTools(['nonexistent', 'core']);
    expect(tools.length).toBe(TOOL_GROUPS.core.tools.length);
  });

  it('returns codeExecution tools when explicitly enabled', () => {
    const tools = getEnabledTools(['codeExecution']);
    expect(tools).toContain('execute_javascript');
    expect(tools).toContain('execute_python');
    expect(tools).toContain('execute_shell');
  });

  it('returns email tools when explicitly enabled', () => {
    const tools = getEnabledTools(['email']);
    expect(tools).toContain('send_email');
    expect(tools).toContain('list_emails');
  });

  it('returns git tools when explicitly enabled', () => {
    const tools = getEnabledTools(['git']);
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_diff');
    expect(tools).toContain('git_log');
  });
});

// ===========================================================================
// getToolGroups
// ===========================================================================

describe('getToolGroups', () => {
  it('returns an array of all groups', () => {
    const groups = getToolGroups();
    expect(Array.isArray(groups)).toBe(true);
  });

  it('returns the correct number of groups', () => {
    const groups = getToolGroups();
    expect(groups.length).toBe(Object.keys(TOOL_GROUPS).length);
  });

  it('each element is a ToolGroupConfig with required fields', () => {
    const groups = getToolGroups();
    for (const group of groups) {
      expect(typeof group.id).toBe('string');
      expect(typeof group.name).toBe('string');
      expect(typeof group.description).toBe('string');
      expect(typeof group.defaultEnabled).toBe('boolean');
      expect(Array.isArray(group.tools)).toBe(true);
    }
  });

  it('contains the core group object', () => {
    const groups = getToolGroups();
    const core = groups.find((g) => g.id === 'core');
    expect(core).toBeDefined();
    expect(core?.name).toBe('Core Utilities');
  });
});

// ===========================================================================
// getGroupForTool
// ===========================================================================

describe('getGroupForTool', () => {
  it('finds the correct group for a core tool', () => {
    const group = getGroupForTool('get_current_time');
    expect(group).toBeDefined();
    expect(group?.id).toBe('core');
  });

  it('finds the correct group for a filesystem tool', () => {
    const group = getGroupForTool('read_file');
    expect(group).toBeDefined();
    expect(group?.id).toBe('filesystem');
  });

  it('finds the correct group for a task tool', () => {
    const group = getGroupForTool('add_task');
    expect(group).toBeDefined();
    expect(group?.id).toBe('tasks');
  });

  it('finds the correct group for a memory tool', () => {
    const group = getGroupForTool('create_memory');
    expect(group).toBeDefined();
    expect(group?.id).toBe('memory');
  });

  it('finds the correct group for a goal tool', () => {
    const group = getGroupForTool('create_goal');
    expect(group).toBeDefined();
    expect(group?.id).toBe('goals');
  });

  it('finds the correct group for code execution tool', () => {
    const group = getGroupForTool('execute_javascript');
    expect(group).toBeDefined();
    expect(group?.id).toBe('codeExecution');
  });

  it('finds the correct group for an email tool', () => {
    const group = getGroupForTool('send_email');
    expect(group).toBeDefined();
    expect(group?.id).toBe('email');
  });

  it('finds the correct group for a git tool', () => {
    const group = getGroupForTool('git_commit');
    expect(group).toBeDefined();
    expect(group?.id).toBe('git');
  });

  it('finds the correct group for a custom tools tool', () => {
    const group = getGroupForTool('create_tool');
    expect(group).toBeDefined();
    expect(group?.id).toBe('customTools');
  });

  it('returns undefined for an unknown tool', () => {
    const group = getGroupForTool('nonexistent_tool_xyz');
    expect(group).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    const group = getGroupForTool('');
    expect(group).toBeUndefined();
  });
});

// ===========================================================================
// getToolStats
// ===========================================================================

describe('getToolStats', () => {
  const stats = getToolStats();

  it('returns totalGroups matching the number of groups', () => {
    expect(stats.totalGroups).toBe(Object.keys(TOOL_GROUPS).length);
  });

  it('returns a positive totalTools count', () => {
    expect(stats.totalTools).toBeGreaterThan(0);
  });

  it('totalTools equals unique tool count across all groups', () => {
    const allTools = new Set<string>();
    for (const group of Object.values(TOOL_GROUPS)) {
      for (const tool of group.tools) {
        allTools.add(tool);
      }
    }
    expect(stats.totalTools).toBe(allTools.size);
  });

  it('enabledByDefault + disabledByDefault accounts for all tool slots', () => {
    let totalSlots = 0;
    for (const group of Object.values(TOOL_GROUPS)) {
      totalSlots += group.tools.length;
    }
    expect(stats.enabledByDefault + stats.disabledByDefault).toBe(totalSlots);
  });

  it('enabledByDefault is greater than zero', () => {
    expect(stats.enabledByDefault).toBeGreaterThan(0);
  });

  it('disabledByDefault is greater than zero', () => {
    expect(stats.disabledByDefault).toBeGreaterThan(0);
  });

  it('enabledByDefault matches sum of tools in defaultEnabled groups', () => {
    let expected = 0;
    for (const group of Object.values(TOOL_GROUPS)) {
      if (group.defaultEnabled) {
        expected += group.tools.length;
      }
    }
    expect(stats.enabledByDefault).toBe(expected);
  });

  it('disabledByDefault matches sum of tools in non-defaultEnabled groups', () => {
    let expected = 0;
    for (const group of Object.values(TOOL_GROUPS)) {
      if (!group.defaultEnabled) {
        expected += group.tools.length;
      }
    }
    expect(stats.disabledByDefault).toBe(expected);
  });
});
