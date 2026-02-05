import { describe, it, expect } from 'vitest';
import { TOOL_MAX_LIMITS, applyToolLimits } from './tool-limits.js';

// ===========================================================================
// TOOL_MAX_LIMITS constant
// ===========================================================================

describe('TOOL_MAX_LIMITS', () => {
  const allEntries = Object.entries(TOOL_MAX_LIMITS);

  it('is a non-empty record', () => {
    expect(allEntries.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Expected tools exist
  // -------------------------------------------------------------------------

  describe('expected tools are present', () => {
    const expectedTools = [
      'list_emails',
      'search_emails',
      'list_tasks',
      'list_notes',
      'list_calendar_events',
      'list_contacts',
      'list_bookmarks',
      'query_expenses',
      'recall',
      'list_memories',
      'list_goals',
      'get_next_actions',
      'list_custom_records',
      'search_custom_records',
      'git_log',
      'get_task_history',
      'search_files',
      'search_web',
      'semantic_search',
    ];

    it.each(expectedTools)('contains an entry for "%s"', (toolName) => {
      expect(TOOL_MAX_LIMITS[toolName]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Structure validation
  // -------------------------------------------------------------------------

  describe('structure', () => {
    it.each(allEntries)('entry for "%s" has paramName, maxValue, defaultValue', (_toolName, limit) => {
      expect(typeof limit.paramName).toBe('string');
      expect(limit.paramName.length).toBeGreaterThan(0);
      expect(typeof limit.maxValue).toBe('number');
      expect(typeof limit.defaultValue).toBe('number');
    });

    it.each(allEntries)('entry for "%s" has maxValue > 0', (_toolName, limit) => {
      expect(limit.maxValue).toBeGreaterThan(0);
    });

    it.each(allEntries)('entry for "%s" has defaultValue <= maxValue', (_toolName, limit) => {
      expect(limit.defaultValue).toBeLessThanOrEqual(limit.maxValue);
    });

    it.each(allEntries)('entry for "%s" has defaultValue > 0', (_toolName, limit) => {
      expect(limit.defaultValue).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Specific values
  // -------------------------------------------------------------------------

  describe('specific values', () => {
    it('list_emails has limit=50, default=20', () => {
      const limit = TOOL_MAX_LIMITS['list_emails'];
      expect(limit.paramName).toBe('limit');
      expect(limit.maxValue).toBe(50);
      expect(limit.defaultValue).toBe(20);
    });

    it('search_emails has limit=100, default=50', () => {
      const limit = TOOL_MAX_LIMITS['search_emails'];
      expect(limit.paramName).toBe('limit');
      expect(limit.maxValue).toBe(100);
      expect(limit.defaultValue).toBe(50);
    });

    it('search_files uses maxResults param', () => {
      const limit = TOOL_MAX_LIMITS['search_files'];
      expect(limit.paramName).toBe('maxResults');
    });

    it('semantic_search uses topK param', () => {
      const limit = TOOL_MAX_LIMITS['semantic_search'];
      expect(limit.paramName).toBe('topK');
    });

    it('search_web has maxValue=20, default=10', () => {
      const limit = TOOL_MAX_LIMITS['search_web'];
      expect(limit.paramName).toBe('maxResults');
      expect(limit.maxValue).toBe(20);
      expect(limit.defaultValue).toBe(10);
    });

    it('list_goals has maxValue=30, default=10', () => {
      const limit = TOOL_MAX_LIMITS['list_goals'];
      expect(limit.maxValue).toBe(30);
      expect(limit.defaultValue).toBe(10);
    });

    it('get_next_actions has maxValue=20, default=5', () => {
      const limit = TOOL_MAX_LIMITS['get_next_actions'];
      expect(limit.maxValue).toBe(20);
      expect(limit.defaultValue).toBe(5);
    });
  });
});

// ===========================================================================
// applyToolLimits
// ===========================================================================

describe('applyToolLimits', () => {
  // -------------------------------------------------------------------------
  // Tool not in registry
  // -------------------------------------------------------------------------

  describe('tool not in registry', () => {
    it('returns args unchanged for unknown tool', () => {
      const args = { limit: 999, foo: 'bar' };
      const result = applyToolLimits('totally_unknown_tool', args);
      expect(result).toBe(args); // same reference
    });

    it('returns empty args unchanged for unknown tool', () => {
      const args = {};
      const result = applyToolLimits('unknown', args);
      expect(result).toBe(args);
    });
  });

  // -------------------------------------------------------------------------
  // Caps value at maxValue
  // -------------------------------------------------------------------------

  describe('caps at maxValue', () => {
    it('caps limit to maxValue for list_emails when exceeding', () => {
      const result = applyToolLimits('list_emails', { limit: 999 });
      expect(result.limit).toBe(50);
    });

    it('caps limit to maxValue for search_emails when exceeding', () => {
      const result = applyToolLimits('search_emails', { limit: 500 });
      expect(result.limit).toBe(100);
    });

    it('caps maxResults for search_files when exceeding', () => {
      const result = applyToolLimits('search_files', { maxResults: 200 });
      expect(result.maxResults).toBe(100);
    });

    it('caps topK for semantic_search when exceeding', () => {
      const result = applyToolLimits('semantic_search', { topK: 100 });
      expect(result.topK).toBe(50);
    });

    it('caps at maxValue when value equals maxValue + 1', () => {
      const result = applyToolLimits('list_emails', { limit: 51 });
      expect(result.limit).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Applies defaultValue when param is missing
  // -------------------------------------------------------------------------

  describe('applies defaultValue when param is missing', () => {
    it('applies default for list_emails when limit is absent', () => {
      const result = applyToolLimits('list_emails', {});
      expect(result.limit).toBe(20);
    });

    it('applies default for search_files when maxResults is absent', () => {
      const result = applyToolLimits('search_files', {});
      expect(result.maxResults).toBe(50);
    });

    it('applies default for semantic_search when topK is absent', () => {
      const result = applyToolLimits('semantic_search', {});
      expect(result.topK).toBe(10);
    });

    it('applies default for get_next_actions when limit is absent', () => {
      const result = applyToolLimits('get_next_actions', {});
      expect(result.limit).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Applies defaultValue when param is undefined
  // -------------------------------------------------------------------------

  describe('applies defaultValue when param is undefined', () => {
    it('applies default when limit is explicitly undefined', () => {
      const result = applyToolLimits('list_emails', { limit: undefined });
      expect(result.limit).toBe(20);
    });

    it('applies default when limit is null', () => {
      const result = applyToolLimits('list_emails', { limit: null });
      expect(result.limit).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Does not change value within limit
  // -------------------------------------------------------------------------

  describe('does not change value within limit', () => {
    it('keeps value when it equals maxValue', () => {
      const result = applyToolLimits('list_emails', { limit: 50 });
      // Returns original args when within range
      expect(result.limit).toBe(50);
    });

    it('keeps value when it is less than maxValue', () => {
      const result = applyToolLimits('list_emails', { limit: 10 });
      expect(result.limit).toBe(10);
    });

    it('keeps value of 1', () => {
      const result = applyToolLimits('list_emails', { limit: 1 });
      expect(result.limit).toBe(1);
    });

    it('keeps defaultValue when explicitly passed', () => {
      const result = applyToolLimits('list_emails', { limit: 20 });
      expect(result.limit).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Preserves other args
  // -------------------------------------------------------------------------

  describe('preserves other args', () => {
    it('preserves non-limit args when capping', () => {
      const result = applyToolLimits('list_emails', {
        limit: 999,
        query: 'test',
        folder: 'inbox',
      });
      expect(result.limit).toBe(50);
      expect(result.query).toBe('test');
      expect(result.folder).toBe('inbox');
    });

    it('preserves non-limit args when applying default', () => {
      const result = applyToolLimits('list_emails', {
        query: 'search term',
      });
      expect(result.limit).toBe(20);
      expect(result.query).toBe('search term');
    });

    it('preserves non-limit args when value is within range', () => {
      const args = { limit: 10, other: 'data' };
      const result = applyToolLimits('list_emails', args);
      expect(result.other).toBe('data');
    });
  });

  // -------------------------------------------------------------------------
  // Does not mutate original args
  // -------------------------------------------------------------------------

  describe('does not mutate original args', () => {
    it('returns a new object when capping', () => {
      const args = { limit: 999 };
      const result = applyToolLimits('list_emails', args);
      expect(result).not.toBe(args);
      expect(args.limit).toBe(999); // original unchanged
    });

    it('returns a new object when applying default', () => {
      const args = { query: 'test' };
      const result = applyToolLimits('list_emails', args);
      expect(result).not.toBe(args);
      expect(args).toEqual({ query: 'test' }); // original unchanged
    });

    it('returns original reference when value is within range (no mutation needed)', () => {
      const args = { limit: 10 };
      const result = applyToolLimits('list_emails', args);
      // The implementation returns args directly when within range
      expect(result).toBe(args);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles string numbers by converting them', () => {
      // Number('25') = 25, which is within list_emails maxValue of 50
      const result = applyToolLimits('list_emails', { limit: '25' });
      expect(result.limit).toBe('25'); // within range, returned as-is (original ref)
    });

    it('handles string numbers exceeding max by capping', () => {
      const result = applyToolLimits('list_emails', { limit: '999' });
      expect(result.limit).toBe(50);
    });

    it('treats NaN values as missing and applies default', () => {
      const result = applyToolLimits('list_emails', { limit: 'not-a-number' });
      expect(result.limit).toBe(20);
    });

    it('handles zero as a valid value within range', () => {
      const result = applyToolLimits('list_emails', { limit: 0 });
      expect(result.limit).toBe(0);
    });

    it('handles negative values (within range since < maxValue)', () => {
      const result = applyToolLimits('list_emails', { limit: -5 });
      // -5 is not > 50, so it passes through
      expect(result.limit).toBe(-5);
    });
  });
});
