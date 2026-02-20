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

  it('contains always-on groups', () => {
    for (const id of ['core', 'filesystem', 'personalData', 'customData', 'memory', 'goals', 'utilities', 'customTools']) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });

  it('contains toggleable groups', () => {
    for (const id of ['codeExecution', 'webFetch', 'media', 'communication', 'devTools', 'finance']) {
      expect(TOOL_GROUPS[id]).toBeDefined();
    }
  });

  it('has exactly 14 groups', () => {
    expect(groupIds.length).toBe(14);
  });

  it('always-on groups have alwaysOn flag', () => {
    for (const id of ['core', 'filesystem', 'personalData', 'memory']) {
      expect(TOOL_GROUPS[id].alwaysOn).toBe(true);
    }
  });

  it('toggleable groups do not have alwaysOn flag', () => {
    for (const id of ['codeExecution', 'webFetch', 'media', 'communication', 'devTools', 'finance']) {
      expect(TOOL_GROUPS[id].alwaysOn).toBeFalsy();
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
      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const group of Object.values(TOOL_GROUPS)) {
        for (const tool of group.tools) {
          if (seen.has(tool)) {
            duplicates.push(tool);
          }
          seen.add(tool);
        }
      }

      expect(duplicates).toEqual([]);
    });
  });

  describe('personalData group merges old groups', () => {
    it('contains task tools', () => {
      const tools = TOOL_GROUPS.personalData.tools;
      expect(tools).toContain('add_task');
      expect(tools).toContain('list_tasks');
      expect(tools).toContain('complete_task');
    });

    it('contains note tools', () => {
      const tools = TOOL_GROUPS.personalData.tools;
      expect(tools).toContain('add_note');
      expect(tools).toContain('list_notes');
    });

    it('contains bookmark tools', () => {
      const tools = TOOL_GROUPS.personalData.tools;
      expect(tools).toContain('add_bookmark');
      expect(tools).toContain('list_bookmarks');
    });

    it('contains calendar tools', () => {
      const tools = TOOL_GROUPS.personalData.tools;
      expect(tools).toContain('add_calendar_event');
      expect(tools).toContain('list_calendar_events');
    });

    it('contains contact tools', () => {
      const tools = TOOL_GROUPS.personalData.tools;
      expect(tools).toContain('add_contact');
      expect(tools).toContain('list_contacts');
    });
  });

  describe('media group merges image+audio+pdf', () => {
    it('contains image tools', () => {
      const tools = TOOL_GROUPS.media.tools;
      expect(tools).toContain('analyze_image');
      expect(tools).toContain('generate_image');
      expect(tools).toContain('resize_image');
    });

    it('contains audio tools', () => {
      const tools = TOOL_GROUPS.media.tools;
      expect(tools).toContain('text_to_speech');
      expect(tools).toContain('speech_to_text');
    });

    it('contains pdf tools', () => {
      const tools = TOOL_GROUPS.media.tools;
      expect(tools).toContain('read_pdf');
      expect(tools).toContain('create_pdf');
    });
  });

  describe('communication group merges email+weather', () => {
    it('contains email tools', () => {
      const tools = TOOL_GROUPS.communication.tools;
      expect(tools).toContain('send_email');
      expect(tools).toContain('list_emails');
    });

    it('contains weather tools', () => {
      const tools = TOOL_GROUPS.communication.tools;
      expect(tools).toContain('get_weather');
      expect(tools).toContain('get_weather_forecast');
    });
  });

  describe('utilities group merges utility sub-groups', () => {
    const tools = TOOL_GROUPS.utilities.tools;

    it('contains date/time tools', () => {
      expect(tools).toContain('date_diff');
      expect(tools).toContain('date_add');
    });

    it('contains text processing tools', () => {
      expect(tools).toContain('format_json');
      expect(tools).toContain('count_text');
      expect(tools).toContain('transform_text');
      expect(tools).toContain('run_regex');
    });

    it('contains conversion tools', () => {
      expect(tools).toContain('convert_units');
      expect(tools).toContain('encode_decode');
      expect(tools).toContain('hash_text');
    });

    it('contains data extraction tools', () => {
      expect(tools).toContain('extract_entities');
      expect(tools).toContain('extract_table_data');
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

  it('contains always-on groups', () => {
    expect(DEFAULT_ENABLED_GROUPS).toContain('core');
    expect(DEFAULT_ENABLED_GROUPS).toContain('filesystem');
    expect(DEFAULT_ENABLED_GROUPS).toContain('personalData');
    expect(DEFAULT_ENABLED_GROUPS).toContain('customData');
    expect(DEFAULT_ENABLED_GROUPS).toContain('memory');
    expect(DEFAULT_ENABLED_GROUPS).toContain('goals');
    expect(DEFAULT_ENABLED_GROUPS).toContain('utilities');
    expect(DEFAULT_ENABLED_GROUPS).toContain('customTools');
  });

  it('does not contain disabled-by-default groups', () => {
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('codeExecution');
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('webFetch');
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('media');
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('communication');
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('devTools');
    expect(DEFAULT_ENABLED_GROUPS).not.toContain('finance');
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

  it('includes personalData tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).toContain('add_task');
    expect(tools).toContain('list_tasks');
    expect(tools).toContain('add_note');
  });

  it('does not include code execution tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).not.toContain('execute_javascript');
    expect(tools).not.toContain('execute_shell');
  });

  it('does not include media tools by default', () => {
    const tools = getEnabledTools();
    expect(tools).not.toContain('analyze_image');
    expect(tools).not.toContain('text_to_speech');
  });

  it('returns only tools for specified groups', () => {
    const tools = getEnabledTools(['core']);
    expect(tools).toEqual(expect.arrayContaining(['get_current_time', 'calculate', 'generate_uuid']));
    expect(tools).not.toContain('read_file');
    expect(tools).not.toContain('add_task');
  });

  it('returns tools from multiple specified groups', () => {
    const tools = getEnabledTools(['core', 'personalData']);
    expect(tools).toContain('get_current_time');
    expect(tools).toContain('add_task');
    expect(tools).toContain('list_tasks');
  });

  it('deduplicates tool names', () => {
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

  it('returns communication tools when explicitly enabled', () => {
    const tools = getEnabledTools(['communication']);
    expect(tools).toContain('send_email');
    expect(tools).toContain('list_emails');
    expect(tools).toContain('get_weather');
  });

  it('returns devTools when explicitly enabled', () => {
    const tools = getEnabledTools(['devTools']);
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_diff');
    expect(tools).toContain('git_log');
  });

  it('returns finance tools when explicitly enabled', () => {
    const tools = getEnabledTools(['finance']);
    expect(tools).toContain('add_expense');
    expect(tools).toContain('query_expenses');
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
    expect(core?.name).toBe('Core');
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

  it('finds the correct group for a task tool (personalData)', () => {
    const group = getGroupForTool('add_task');
    expect(group).toBeDefined();
    expect(group?.id).toBe('personalData');
  });

  it('finds the correct group for a note tool (personalData)', () => {
    const group = getGroupForTool('add_note');
    expect(group).toBeDefined();
    expect(group?.id).toBe('personalData');
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

  it('finds the correct group for an email tool (communication)', () => {
    const group = getGroupForTool('send_email');
    expect(group).toBeDefined();
    expect(group?.id).toBe('communication');
  });

  it('finds the correct group for a weather tool (communication)', () => {
    const group = getGroupForTool('get_weather');
    expect(group).toBeDefined();
    expect(group?.id).toBe('communication');
  });

  it('finds the correct group for a git tool (devTools)', () => {
    const group = getGroupForTool('git_commit');
    expect(group).toBeDefined();
    expect(group?.id).toBe('devTools');
  });

  it('finds the correct group for a custom tools tool', () => {
    const group = getGroupForTool('create_tool');
    expect(group).toBeDefined();
    expect(group?.id).toBe('customTools');
  });

  it('finds the correct group for an image tool (media)', () => {
    const group = getGroupForTool('analyze_image');
    expect(group).toBeDefined();
    expect(group?.id).toBe('media');
  });

  it('finds the correct group for an expense tool (finance)', () => {
    const group = getGroupForTool('add_expense');
    expect(group).toBeDefined();
    expect(group?.id).toBe('finance');
  });

  it('finds the correct group for a utility tool', () => {
    const group = getGroupForTool('format_json');
    expect(group).toBeDefined();
    expect(group?.id).toBe('utilities');
  });

  it('returns undefined for an unknown tool', () => {
    const group = getGroupForTool('nonexistent_tool_xyz');
    expect(group).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    const group = getGroupForTool('');
    expect(group).toBeUndefined();
  });

  it('resolves namespaced tool names via base name', () => {
    const group = getGroupForTool('core.get_current_time');
    expect(group).toBeDefined();
    expect(group?.id).toBe('core');
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
