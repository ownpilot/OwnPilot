import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractKeywords,
  tokenizeMessage,
  buildKeywordIndex,
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

      const index = buildKeywordIndex(service);
      expect(index.extensions).toHaveLength(1);

      const ext = index.extensions[0]!;
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

      const index = buildKeywordIndex(service);
      const ext = index.extensions[0]!;
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

      const index = buildKeywordIndex(service);
      expect(index.extensions).toHaveLength(1);
      expect(index.extensions[0]!.keywords.has('prompt')).toBe(true);
      expect(index.extensions[0]!.keywords.has('writing')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyRequest
  // ---------------------------------------------------------------------------

  describe('classifyRequest', () => {
    const service = mockExtensionService([
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
    ]);

    let index: ReturnType<typeof buildKeywordIndex>;

    beforeEach(() => {
      index = buildKeywordIndex(service);
    });

    it('selects email extension for email-related request', () => {
      const routing = classifyRequest('Please send an email to my boss about the meeting', index);
      expect(routing.relevantExtensionIds).toContain('email-ext');
      expect(routing.confidence).toBeGreaterThan(0);
    });

    it('selects task extension for task-related request', () => {
      const routing = classifyRequest('Add a new task to buy groceries and mark it high priority', index);
      expect(routing.relevantExtensionIds).toContain('task-ext');
    });

    it('selects weather extension for weather request', () => {
      const routing = classifyRequest('What is the weather forecast for tomorrow?', index);
      expect(routing.relevantExtensionIds).toContain('weather-ext');
    });

    it('includes all extensions for very short messages', () => {
      const routing = classifyRequest('hi there', index);
      expect(routing.relevantExtensionIds).toHaveLength(3);
      expect(routing.confidence).toBe(0);
    });

    it('includes all extensions for single-word messages', () => {
      const routing = classifyRequest('hello', index);
      expect(routing.relevantExtensionIds).toHaveLength(3);
    });

    it('falls back to top N when no strong match', () => {
      const routing = classifyRequest(
        'Tell me a story about dragons and medieval knights',
        index
      );
      // No extension matches dragons/knights, but should still return some
      expect(routing.relevantExtensionIds.length).toBeGreaterThan(0);
      expect(routing.relevantExtensionIds.length).toBeLessThanOrEqual(2);
    });

    it('caps extensions at maximum', () => {
      // Create many extensions that all match
      const manyExts = Array.from({ length: 10 }, (_, i) => ({
        id: `ext-${i}`,
        name: `Email Tool ${i}`,
        description: 'Handles email sending and receiving',
        toolNames: ['send_email'],
        category: 'communication' as const,
      }));
      const bigIndex = buildKeywordIndex(mockExtensionService(manyExts));
      const routing = classifyRequest('I need to send an email right now', bigIndex);
      expect(routing.relevantExtensionIds.length).toBeLessThanOrEqual(5);
    });

    it('generates intent hint from matched categories', () => {
      const routing = classifyRequest('Send an email about the project update', index);
      if (routing.relevantCategories.length > 0) {
        expect(routing.intentHint).toBeTruthy();
        expect(routing.intentHint).toContain('Request relates to');
      }
    });

    it('handles empty message', () => {
      const routing = classifyRequest('', index);
      expect(routing.relevantExtensionIds).toHaveLength(3); // all included
    });

    it('handles empty index', () => {
      const emptyIndex = buildKeywordIndex(mockExtensionService([]));
      const routing = classifyRequest('send email', emptyIndex);
      expect(routing.relevantExtensionIds).toHaveLength(0);
      expect(routing.confidence).toBe(0);
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
