import { describe, it, expect } from 'vitest';
import { BASE_SYSTEM_PROMPT } from './agent-prompt.js';

describe('agent-prompt', () => {
  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  describe('exports', () => {
    it('exports BASE_SYSTEM_PROMPT as a string', () => {
      expect(typeof BASE_SYSTEM_PROMPT).toBe('string');
    });

    it('BASE_SYSTEM_PROMPT is not empty', () => {
      expect(BASE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it('BASE_SYSTEM_PROMPT is a non-trivial length', () => {
      // The prompt is ~100 lines; it should be well over 1000 characters
      expect(BASE_SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // Identity section
  // ---------------------------------------------------------------------------
  describe('identity section', () => {
    it('contains "OwnPilot" brand name', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('OwnPilot');
    });

    it('contains "privacy-first" value prop', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('privacy-first');
    });

    it('contains "personal AI assistant" role', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('personal AI assistant');
    });

    it('contains "local" data locality', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('local');
    });

    it('starts with "You are OwnPilot"', () => {
      expect(BASE_SYSTEM_PROMPT.startsWith('You are OwnPilot')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Structure — ## Headings
  // ---------------------------------------------------------------------------
  describe('structure — major headings', () => {
    it('contains "## How to Call Tools"', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('## How to Call Tools');
    });

    it('contains "## Capabilities & Key Tools"', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('## Capabilities & Key Tools');
    });

    it('contains "## Memory Protocol"', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('## Memory Protocol');
    });

    it('contains "## Behavior"', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('## Behavior');
    });

    it('contains "## Suggestions"', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('## Suggestions');
    });

    it('has exactly 5 level-2 headings', () => {
      const h2Matches = BASE_SYSTEM_PROMPT.match(/^## /gm);
      expect(h2Matches).not.toBeNull();
      expect(h2Matches!.length).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Sub-section headings (### level)
  // ---------------------------------------------------------------------------
  describe('sub-section headings', () => {
    const expectedSubsections = [
      'Personal Data',
      'Custom Database',
      'Custom Tools',
      'Memory & Goals',
      'File System',
      'Automation',
      'Web & Research',
      'Code Execution',
      'Media',
      'Email',
      'Utilities',
      'Configuration & Extensions',
    ];

    for (const heading of expectedSubsections) {
      it(`contains "### ${heading}"`, () => {
        expect(BASE_SYSTEM_PROMPT).toContain(`### ${heading}`);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — meta-tools
  // ---------------------------------------------------------------------------
  describe('meta-tools', () => {
    const metaTools = ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'];

    for (const tool of metaTools) {
      it(`documents meta-tool: ${tool}`, () => {
        expect(BASE_SYSTEM_PROMPT).toContain(tool);
      });
    }

    it('lists all 4 meta-tools in the How to Call Tools section', () => {
      const section = BASE_SYSTEM_PROMPT.split('## How to Call Tools')[1]!.split('\n##')[0]!;
      for (const tool of metaTools) {
        expect(section).toContain(tool);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Namespace prefixes
  // ---------------------------------------------------------------------------
  describe('namespace prefixes', () => {
    it('contains core.* namespace', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('core.*');
    });

    it('contains custom.* namespace', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('custom.*');
    });

    it('contains plugin. namespace prefix', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('plugin.');
    });

    it('contains ext. namespace prefix', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('ext.');
    });

    it('contains mcp. namespace prefix', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('mcp.');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Personal Data tools
  // ---------------------------------------------------------------------------
  describe('personal data tools', () => {
    it('contains task tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('add_task');
      expect(BASE_SYSTEM_PROMPT).toContain('list_tasks');
      expect(BASE_SYSTEM_PROMPT).toContain('complete_task');
    });

    it('contains note tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('add_note');
      expect(BASE_SYSTEM_PROMPT).toContain('list_notes');
    });

    it('contains calendar tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('add_calendar_event');
      expect(BASE_SYSTEM_PROMPT).toContain('list_calendar_events');
    });

    it('contains contact tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('add_contact');
      expect(BASE_SYSTEM_PROMPT).toContain('list_contacts');
    });

    it('contains bookmark tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('add_bookmark');
      expect(BASE_SYSTEM_PROMPT).toContain('list_bookmarks');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Custom Database tools
  // ---------------------------------------------------------------------------
  describe('custom database tools', () => {
    it('contains create_custom_table', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_custom_table');
    });

    it('contains list_custom_records', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('list_custom_records');
    });

    it('contains search_custom_records', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('search_custom_records');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Memory & Goals tools
  // ---------------------------------------------------------------------------
  describe('memory & goals tools', () => {
    it('contains memory tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_memory');
      expect(BASE_SYSTEM_PROMPT).toContain('search_memories');
    });

    it('contains goal tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_goal');
      expect(BASE_SYSTEM_PROMPT).toContain('list_goals');
      expect(BASE_SYSTEM_PROMPT).toContain('decompose_goal');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — File System tools
  // ---------------------------------------------------------------------------
  describe('file system tools', () => {
    it('contains read_file and write_file', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('read_file');
      expect(BASE_SYSTEM_PROMPT).toContain('write_file');
    });

    it('contains list_files', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('list_files');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Automation tools
  // ---------------------------------------------------------------------------
  describe('automation tools', () => {
    it('contains trigger tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_trigger');
      expect(BASE_SYSTEM_PROMPT).toContain('list_triggers');
    });

    it('contains plan tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_plan');
      expect(BASE_SYSTEM_PROMPT).toContain('execute_plan');
    });

    it('contains heartbeat tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('create_heartbeat');
      expect(BASE_SYSTEM_PROMPT).toContain('list_heartbeats');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Web & Research tools
  // ---------------------------------------------------------------------------
  describe('web & research tools', () => {
    it('contains search_web', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('search_web');
    });

    it('contains fetch_web_page', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('fetch_web_page');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Code Execution tools
  // ---------------------------------------------------------------------------
  describe('code execution tools', () => {
    it('contains execute_javascript', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('execute_javascript');
    });

    it('contains execute_python', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('execute_python');
    });

    it('contains execute_shell', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('execute_shell');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Media tools
  // ---------------------------------------------------------------------------
  describe('media tools', () => {
    it('contains image tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('analyze_image');
      expect(BASE_SYSTEM_PROMPT).toContain('generate_image');
    });

    it('contains audio tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('text_to_speech');
    });

    it('contains pdf tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('read_pdf');
      expect(BASE_SYSTEM_PROMPT).toContain('create_pdf');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Email tools
  // ---------------------------------------------------------------------------
  describe('email tools', () => {
    it('contains send_email', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('send_email');
    });

    it('contains list_emails', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('list_emails');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Documentation — Configuration & Extensions
  // ---------------------------------------------------------------------------
  describe('configuration & extensions tools', () => {
    it('contains config_list_services', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('config_list_services');
    });

    it('contains extension tools', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('list_extensions');
      expect(BASE_SYSTEM_PROMPT).toContain('toggle_extension');
    });
  });

  // ---------------------------------------------------------------------------
  // Memory Protocol
  // ---------------------------------------------------------------------------
  describe('memory protocol', () => {
    it('contains <memories> tag format', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('<memories>');
      expect(BASE_SYSTEM_PROMPT).toContain('</memories>');
    });

    it('contains memory types: fact, preference, conversation, event, skill', () => {
      const memorySection = BASE_SYSTEM_PROMPT.split('## Memory Protocol')[1]!.split('\n##')[0]!;
      expect(memorySection).toContain('fact');
      expect(memorySection).toContain('preference');
      expect(memorySection).toContain('conversation');
      expect(memorySection).toContain('event');
      expect(memorySection).toContain('skill');
    });

    it('contains "search_memories" instruction', () => {
      const memorySection = BASE_SYSTEM_PROMPT.split('## Memory Protocol')[1]!.split('\n##')[0]!;
      expect(memorySection).toContain('search_memories');
    });

    it('instructs to search memories before answering personal questions', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('search_memories` before answering personal questions');
    });
  });

  // ---------------------------------------------------------------------------
  // Behavior
  // ---------------------------------------------------------------------------
  describe('behavior section', () => {
    it('contains "Concise"', () => {
      const behaviorSection = BASE_SYSTEM_PROMPT.split('## Behavior')[1]!.split('\n##')[0]!;
      expect(behaviorSection).toContain('Concise');
    });

    it('contains "Proactive"', () => {
      const behaviorSection = BASE_SYSTEM_PROMPT.split('## Behavior')[1]!.split('\n##')[0]!;
      expect(behaviorSection).toContain('Proactive');
    });

    it('instructs to retry on tool error', () => {
      const behaviorSection = BASE_SYSTEM_PROMPT.split('## Behavior')[1]!.split('\n##')[0]!;
      expect(behaviorSection).toContain('retry');
    });

    it('instructs to summarize results after tool operations', () => {
      const behaviorSection = BASE_SYSTEM_PROMPT.split('## Behavior')[1]!.split('\n##')[0]!;
      expect(behaviorSection).toContain('summarize results');
    });

    it('instructs never to expose internal tool names to user', () => {
      const behaviorSection = BASE_SYSTEM_PROMPT.split('## Behavior')[1]!.split('\n##')[0]!;
      expect(behaviorSection).toContain('Never expose internal tool names');
      expect(behaviorSection).toContain('friendly display name');
    });
  });

  // ---------------------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------------------
  describe('suggestions section', () => {
    it('contains <suggestions> tag format', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('<suggestions>');
      expect(BASE_SYSTEM_PROMPT).toContain('</suggestions>');
    });

    it('specifies 2-3 follow-ups', () => {
      const suggestionsSection = BASE_SYSTEM_PROMPT.split('## Suggestions')[1]!;
      expect(suggestionsSection).toContain('2-3');
    });

    it('specifies max character guidance for title', () => {
      const suggestionsSection = BASE_SYSTEM_PROMPT.split('## Suggestions')[1]!;
      expect(suggestionsSection).toContain('40ch');
    });

    it('specifies max character guidance for detail', () => {
      const suggestionsSection = BASE_SYSTEM_PROMPT.split('## Suggestions')[1]!;
      expect(suggestionsSection).toContain('200ch');
    });

    it('specifies max 5 suggestions', () => {
      const suggestionsSection = BASE_SYSTEM_PROMPT.split('## Suggestions')[1]!;
      expect(suggestionsSection).toContain('max 5');
    });
  });

  // ---------------------------------------------------------------------------
  // Structural integrity
  // ---------------------------------------------------------------------------
  describe('structural integrity', () => {
    it('ends with suggestion format guidance (last line mentions "max 5")', () => {
      const lastLine = BASE_SYSTEM_PROMPT.trim().split('\n').pop()!;
      expect(lastLine).toContain('max 5');
    });

    it('has no unclosed backtick code blocks', () => {
      const tripleBackticks = (BASE_SYSTEM_PROMPT.match(/```/g) || []).length;
      expect(tripleBackticks % 2).toBe(0);
    });

    it('has balanced <memories> tags', () => {
      const opens = (BASE_SYSTEM_PROMPT.match(/<memories>/g) || []).length;
      const closes = (BASE_SYSTEM_PROMPT.match(/<\/memories>/g) || []).length;
      expect(opens).toBe(closes);
    });

    it('has balanced <suggestions> tags', () => {
      const opens = (BASE_SYSTEM_PROMPT.match(/<suggestions>/g) || []).length;
      const closes = (BASE_SYSTEM_PROMPT.match(/<\/suggestions>/g) || []).length;
      expect(opens).toBe(closes);
    });

    it('section order: identity → tools → capabilities → memory → behavior → suggestions', () => {
      const identityIdx = BASE_SYSTEM_PROMPT.indexOf('You are OwnPilot');
      const toolsIdx = BASE_SYSTEM_PROMPT.indexOf('## How to Call Tools');
      const capabilitiesIdx = BASE_SYSTEM_PROMPT.indexOf('## Capabilities & Key Tools');
      const memoryIdx = BASE_SYSTEM_PROMPT.indexOf('## Memory Protocol');
      const behaviorIdx = BASE_SYSTEM_PROMPT.indexOf('## Behavior');
      const suggestionsIdx = BASE_SYSTEM_PROMPT.indexOf('## Suggestions');

      expect(identityIdx).toBeLessThan(toolsIdx);
      expect(toolsIdx).toBeLessThan(capabilitiesIdx);
      expect(capabilitiesIdx).toBeLessThan(memoryIdx);
      expect(memoryIdx).toBeLessThan(behaviorIdx);
      expect(behaviorIdx).toBeLessThan(suggestionsIdx);
    });

    it('does not contain tab characters (uses spaces)', () => {
      expect(BASE_SYSTEM_PROMPT).not.toContain('\t');
    });

    it('uses PostgreSQL as the data store reference', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('PostgreSQL');
    });

    it('capabilities section references core namespace for listed tools', () => {
      const section = BASE_SYSTEM_PROMPT.split('## Capabilities & Key Tools')[1]!.split('\n##')[0]!;
      expect(section).toContain('core');
      expect(section).toContain('core.<tool_name>');
    });

    it('instructs never to fabricate data', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('never fabricate data');
    });
  });
});
