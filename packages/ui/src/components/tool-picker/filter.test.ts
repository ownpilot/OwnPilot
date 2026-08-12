/**
 * Tests for ToolPicker's search matching.
 *
 * This filter sits between the user and a list that can run to several hundred
 * tools, so its edge cases are the difference between "found it" and "the tool
 * does not exist". Extracted from ToolPicker.tsx, where it was untestable.
 */

import { describe, it, expect } from 'vitest';
import { matchesSearch } from './filter';
import type { ResourceItem } from './types';

const item = (over: Partial<ResourceItem> = {}): ResourceItem => ({
  name: 'send_email',
  description: 'Send an email message',
  type: 'tool',
  ...over,
});

describe('matchesSearch', () => {
  it('matches everything for an empty query', () => {
    expect(matchesSearch(item(), '')).toBe(true);
    expect(matchesSearch(item(), '   ')).toBe(true);
  });

  it('treats "all" and "*" as show-everything wildcards', () => {
    expect(matchesSearch(item(), 'all')).toBe(true);
    expect(matchesSearch(item(), '*')).toBe(true);
    expect(matchesSearch(item(), 'ALL')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch(item(), 'SEND')).toBe(true);
  });

  it('folds underscores and dashes so spaced queries find snake_case names', () => {
    // Users type "send email"; the tool is registered as send_email.
    expect(matchesSearch(item(), 'send email')).toBe(true);
    expect(matchesSearch(item({ name: 'send-email' }), 'send email')).toBe(true);
  });

  it('requires every word to match, not just one', () => {
    expect(matchesSearch(item(), 'send message')).toBe(true);
    expect(matchesSearch(item(), 'send fax')).toBe(false);
  });

  it('searches description, displayName, internalName and category too', () => {
    const it_ = item({
      name: 'x1',
      description: 'no match here',
      displayName: 'My Recipes',
      internalName: 'recipes_x1',
      category: 'Kitchen',
    });
    expect(matchesSearch(it_, 'recipes')).toBe(true);
    expect(matchesSearch(it_, 'kitchen')).toBe(true);
    expect(matchesSearch(it_, 'my recipes')).toBe(true);
  });

  it('tolerates items missing the optional fields', () => {
    expect(matchesSearch(item(), 'nothing')).toBe(false);
  });

  it('ignores surrounding and repeated whitespace in the query', () => {
    expect(matchesSearch(item(), '  send   email  ')).toBe(true);
  });
});
