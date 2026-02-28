import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractKeywords,
  tokenizeMessage,
  buildKeywordIndex,
  buildToolTagIndex,
  classifyRequest,
  clearPreprocessorCache,
} from './request-preprocessor.js';

// =============================================================================
// Helpers
// =============================================================================

function mockExtensionService(
  extensions: Array<{
    id: string;
    name: string;
    description: string;
    format?: string;
    category?: string;
    toolNames?: string[];
    keywords?: string[];
  }>
) {
  return {
    getEnabledMetadata: () =>
      extensions.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        format: e.format ?? 'ownpilot',
        category: e.category,
        toolNames: e.toolNames ?? [],
        keywords: e.keywords,
      })),
  } as Parameters<typeof buildKeywordIndex>[0];
}

/** Create a full KeywordIndex from extension metadata for testing classifyRequest */
function buildTestIndex(
  extensions: Array<{
    id: string;
    name: string;
    description: string;
    format?: string;
    category?: string;
    toolNames?: string[];
    keywords?: string[];
  }>,
  options?: { toolBriefs?: Map<string, string> }
) {
  const service = mockExtensionService(extensions);
  const extKeywords = buildKeywordIndex(service);
  return {
    extensions: extKeywords,
    toolTagIndex: buildToolTagIndex(),
    toolBriefs: options?.toolBriefs ?? new Map(),
    customTables: [],
    mcpServers: [],
    builtAt: Date.now(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Request Preprocessor', () => {
  beforeEach(() => {
    clearPreprocessorCache();
  });

  // ---------------------------------------------------------------------------
  // extractKeywords
  // ---------------------------------------------------------------------------

  describe('extractKeywords', () => {
    it('splits on spaces and underscores', () => {
      const kw = extractKeywords('send_email notification');
      expect(kw.has('send')).toBe(true);
      expect(kw.has('email')).toBe(true);
      expect(kw.has('notification')).toBe(true);
    });

    it('expands camelCase', () => {
      const kw = extractKeywords('sendEmail getWeatherForecast');
      expect(kw.has('send')).toBe(true);
      expect(kw.has('email')).toBe(true);
      expect(kw.has('weather')).toBe(true);
      expect(kw.has('forecast')).toBe(true);
    });

    it('filters stop words', () => {
      const kw = extractKeywords('the quick brown fox is a good helper');
      expect(kw.has('the')).toBe(false);
      expect(kw.has('is')).toBe(false);
      expect(kw.has('a')).toBe(false);
      expect(kw.has('quick')).toBe(true);
      expect(kw.has('brown')).toBe(true);
      expect(kw.has('fox')).toBe(true);
    });

    it('filters single-character tokens', () => {
      const kw = extractKeywords('x y z word');
      expect(kw.has('x')).toBe(false);
      expect(kw.has('word')).toBe(true);
    });

    it('handles empty input', () => {
      expect(extractKeywords('')).toEqual(new Set());
      expect(extractKeywords(undefined as unknown as string)).toEqual(new Set());
    });

    it('handles hyphenated names', () => {
      const kw = extractKeywords('github-assistant');
      expect(kw.has('github')).toBe(true);
      expect(kw.has('assistant')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // tokenizeMessage
  // ---------------------------------------------------------------------------

  describe('tokenizeMessage', () => {
    it('tokenizes a user message', () => {
      const words = tokenizeMessage('Can you send an email to John?');
      expect(words.has('send')).toBe(true);
      expect(words.has('email')).toBe(true);
      expect(words.has('john')).toBe(true);
      // Stop words filtered
      expect(words.has('can')).toBe(false);
      expect(words.has('you')).toBe(false);
      expect(words.has('an')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // buildKeywordIndex
  // ---------------------------------------------------------------------------

  describe('buildKeywordIndex', () => {
    it('extracts keywords from name, description, and tool names', () => {
      const service = mockExtensionService([
        {
          id: 'email-manager',
          name: 'Email Manager',
          description: 'Send and receive emails with IMAP support',
          toolNames: ['send_email', 'read_inbox', 'search_emails'],
          category: 'communication',
        },
      ]);

      const extensions = buildKeywordIndex(service);
      expect(extensions).toHaveLength(1);

      const ext = extensions[0]!;
      expect(ext.id).toBe('email-manager');
      expect(ext.keywords.has('email')).toBe(true);
      expect(ext.keywords.has('manager')).toBe(true);
      expect(ext.keywords.has('send')).toBe(true);
      expect(ext.keywords.has('receive')).toBe(true);
      expect(ext.keywords.has('imap')).toBe(true);
      expect(ext.keywords.has('inbox')).toBe(true);
      expect(ext.keywords.has('search')).toBe(true);
      expect(ext.keywords.has('communication')).toBe(true);
    });

    it('includes explicit keywords', () => {
      const service = mockExtensionService([
        {
          id: 'scraper',
          name: 'Web Scraper',
          description: 'Scrape web pages',
          keywords: ['http', 'fetch', 'crawl', 'html'],
        },
      ]);

      const extensions = buildKeywordIndex(service);
      const ext = extensions[0]!;
      expect(ext.keywords.has('http')).toBe(true);
      expect(ext.keywords.has('fetch')).toBe(true);
      expect(ext.keywords.has('crawl')).toBe(true);
      expect(ext.keywords.has('html')).toBe(true);
    });

    it('handles extensions with no tools', () => {
      const service = mockExtensionService([
        {
          id: 'prompt-only',
          name: 'Prompt Enhancement',
          description: 'Adds writing style instructions',
        },
      ]);

      const extensions = buildKeywordIndex(service);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]!.keywords.has('prompt')).toBe(true);
      expect(extensions[0]!.keywords.has('writing')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // buildToolTagIndex
  // ---------------------------------------------------------------------------

  describe('buildToolTagIndex', () => {
    it('creates a reverse index from TOOL_SEARCH_TAGS', () => {
      const index = buildToolTagIndex();
      // "email" should map to multiple email tools
      const emailTools = index.get('email');
      expect(emailTools).toBeDefined();
      expect(emailTools!.has('send_email')).toBe(true);
      expect(emailTools!.has('list_emails')).toBe(true);
      expect(emailTools!.has('read_email')).toBe(true);
    });

    it('handles multi-word tags by splitting them', () => {
      const index = buildToolTagIndex();
      // "read mail" tag for list_emails → "read" and "mail" as separate entries
      const mailTools = index.get('mail');
      expect(mailTools).toBeDefined();
      expect(mailTools!.size).toBeGreaterThan(0);
    });

    it('includes tool name parts as self-matching keywords', () => {
      const index = buildToolTagIndex();
      // "send" from "send_email" tool name
      const sendTools = index.get('send');
      expect(sendTools).toBeDefined();
      expect(sendTools!.has('send_email')).toBe(true);
    });

    it('contains entries for major tool categories', () => {
      const index = buildToolTagIndex();
      expect(index.has('git')).toBe(true);
      expect(index.has('weather')).toBe(true);
      expect(index.has('task')).toBe(true);
      expect(index.has('calendar')).toBe(true);
      expect(index.has('expense')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyRequest — extension routing
  // ---------------------------------------------------------------------------

  describe('classifyRequest', () => {
    const testExtensions = [
      {
        id: 'email-ext',
        name: 'Email Manager',
        description: 'Send and receive emails',
        toolNames: ['send_email', 'read_inbox'],
        category: 'communication',
      },
      {
        id: 'task-ext',
        name: 'Task Tracker',
        description: 'Manage tasks and todo lists',
        toolNames: ['add_task', 'list_tasks', 'complete_task'],
        category: 'productivity',
      },
      {
        id: 'weather-ext',
        name: 'Weather Service',
        description: 'Get weather forecasts and current conditions',
        toolNames: ['get_weather', 'get_forecast'],
        category: 'utilities',
      },
    ];

    it('selects email extension for email-related request', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('Please send an email to my boss about the meeting', index);
      expect(routing.relevantExtensionIds).toContain('email-ext');
      expect(routing.confidence).toBeGreaterThan(0);
    });

    it('selects task extension for task-related request', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest(
        'Add a new task to buy groceries and mark it high priority',
        index
      );
      expect(routing.relevantExtensionIds).toContain('task-ext');
    });

    it('selects weather extension for weather request', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('What is the weather forecast for tomorrow?', index);
      expect(routing.relevantExtensionIds).toContain('weather-ext');
    });

    it('includes all extensions for very short messages', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('hi there', index);
      expect(routing.relevantExtensionIds).toHaveLength(3);
      expect(routing.confidence).toBe(0);
    });

    it('includes all extensions for single-word messages', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('hello', index);
      expect(routing.relevantExtensionIds).toHaveLength(3);
    });

    it('falls back to top N when no strong match', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('Tell me a story about dragons and medieval knights', index);
      // No extension matches dragons/knights, but should still return some
      expect(routing.relevantExtensionIds.length).toBeGreaterThan(0);
      expect(routing.relevantExtensionIds.length).toBeLessThanOrEqual(2);
    });

    it('caps extensions at maximum', () => {
      const manyExts = Array.from({ length: 10 }, (_, i) => ({
        id: `ext-${i}`,
        name: `Email Tool ${i}`,
        description: 'Handles email sending and receiving',
        toolNames: ['send_email'],
        category: 'communication' as const,
      }));
      const index = buildTestIndex(manyExts);
      const routing = classifyRequest('I need to send an email right now', index);
      expect(routing.relevantExtensionIds.length).toBeLessThanOrEqual(5);
    });

    it('generates intent hint from matched categories', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('Send an email about the project update', index);
      if (routing.relevantCategories.length > 0) {
        expect(routing.intentHint).toBeTruthy();
        expect(routing.intentHint).toContain('Request relates to');
      }
    });

    it('handles empty message', () => {
      const index = buildTestIndex(testExtensions);
      const routing = classifyRequest('', index);
      expect(routing.relevantExtensionIds).toHaveLength(3); // all included
    });

    it('handles empty index', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('send email', index);
      expect(routing.relevantExtensionIds).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyRequest — tool suggestions
  // ---------------------------------------------------------------------------

  describe('classifyRequest — tool suggestions', () => {
    it('suggests email tools for email-related request', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('Please send an email to John about the project', index);
      expect(routing.suggestedTools.length).toBeGreaterThan(0);
      const toolNames = routing.suggestedTools.map((t) => t.name);
      expect(toolNames).toContain('send_email');
    });

    it('suggests weather tools for weather request', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('What is the weather forecast for tomorrow?', index);
      const toolNames = routing.suggestedTools.map((t) => t.name);
      expect(toolNames).toContain('get_weather');
    });

    it('suggests task tools for task request', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('Add a new task to buy groceries at the store', index);
      const toolNames = routing.suggestedTools.map((t) => t.name);
      expect(toolNames).toContain('add_task');
    });

    it('suggests git tools for git request', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('Show me the git status and recent commits', index);
      const toolNames = routing.suggestedTools.map((t) => t.name);
      expect(toolNames).toContain('git_status');
    });

    it('returns no suggestions for very short messages', () => {
      const index = buildTestIndex([]);
      const routing = classifyRequest('hi', index);
      expect(routing.suggestedTools).toHaveLength(0);
    });

    it('caps tool suggestions at maximum', () => {
      const index = buildTestIndex([]);
      // Use a message with many overlapping tool keywords
      const routing = classifyRequest(
        'email mail send read search inbox delete reply contact notify smtp filter',
        index
      );
      expect(routing.suggestedTools.length).toBeLessThanOrEqual(8);
    });

    it('includes tool briefs when available', () => {
      const briefs = new Map([['send_email', 'Send an email message']]);
      const index = buildTestIndex([], { toolBriefs: briefs });
      const routing = classifyRequest('Please send an email to my colleague', index);
      const sendTool = routing.suggestedTools.find((t) => t.name === 'send_email');
      expect(sendTool?.brief).toBe('Send an email message');
    });
  });

  // ---------------------------------------------------------------------------
  // classifyRequest — custom data tables
  // ---------------------------------------------------------------------------

  describe('classifyRequest — custom data tables', () => {
    it('matches custom data tables by keyword', () => {
      const index = buildTestIndex([]);
      index.customTables = [
        { displayName: 'Contacts', keywords: new Set(['contacts', 'people', 'phone', 'address']) },
        { displayName: 'Projects', keywords: new Set(['projects', 'project', 'work']) },
      ];

      const routing = classifyRequest('Show me all my contacts and their phone numbers', index);
      expect(routing.relevantTables).toBeDefined();
      expect(routing.relevantTables).toContain('Contacts');
    });

    it('does not match tables for unrelated requests', () => {
      const index = buildTestIndex([]);
      index.customTables = [{ displayName: 'Contacts', keywords: new Set(['contacts', 'people']) }];

      const routing = classifyRequest('What is the weather like today?', index);
      expect(routing.relevantTables).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // classifyRequest — MCP servers
  // ---------------------------------------------------------------------------

  describe('classifyRequest — MCP servers', () => {
    it('matches MCP servers by tool keywords', () => {
      const index = buildTestIndex([]);
      index.mcpServers = [
        {
          name: 'github',
          keywords: new Set(['github', 'repository', 'pull', 'request', 'issue', 'commit']),
        },
      ];

      const routing = classifyRequest('Create a new issue on the GitHub repository', index);
      expect(routing.relevantMcpServers).toBeDefined();
      expect(routing.relevantMcpServers).toContain('github');
    });

    it('does not match MCP servers for unrelated requests', () => {
      const index = buildTestIndex([]);
      index.mcpServers = [{ name: 'github', keywords: new Set(['github', 'repository']) }];

      const routing = classifyRequest('Send an email to my team about lunch', index);
      expect(routing.relevantMcpServers).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // clearPreprocessorCache
  // ---------------------------------------------------------------------------

  describe('clearPreprocessorCache', () => {
    it('clears without error', () => {
      expect(() => clearPreprocessorCache()).not.toThrow();
    });
  });
});
