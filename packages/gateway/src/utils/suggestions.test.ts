import { describe, it, expect } from 'vitest';
import { extractSuggestions } from './suggestions.js';

describe('extractSuggestions', () => {
  // --- Object format (primary) ---

  it('extracts valid object suggestions from end of content', () => {
    const raw = 'Here is my response.\n\n<suggestions>[{"title":"Ask about X","detail":"Can you explain X in more detail?"},{"title":"Tell me more","detail":"Tell me more about this topic"}]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.content).toBe('Here is my response.');
    expect(result.suggestions).toEqual([
      { title: 'Ask about X', detail: 'Can you explain X in more detail?' },
      { title: 'Tell me more', detail: 'Tell me more about this topic' },
    ]);
  });

  it('returns empty suggestions when no tag present', () => {
    const raw = 'Just a normal response with no suggestions.';
    const result = extractSuggestions(raw);
    expect(result.content).toBe(raw);
    expect(result.suggestions).toEqual([]);
  });

  it('handles whitespace around the tag', () => {
    const raw = 'Response text.\n\n<suggestions>  [{"title":"A","detail":"Detail A"}]  </suggestions>  \n';
    const result = extractSuggestions(raw);
    expect(result.content).toBe('Response text.');
    expect(result.suggestions).toEqual([{ title: 'A', detail: 'Detail A' }]);
  });

  it('returns content as-is with malformed JSON', () => {
    const raw = 'Response.\n<suggestions>not valid json</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.content).toBe(raw);
    expect(result.suggestions).toEqual([]);
  });

  it('returns content as-is when JSON is not an array', () => {
    const raw = 'Response.\n<suggestions>{"key": "value"}</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.content).toBe(raw);
    expect(result.suggestions).toEqual([]);
  });

  it('truncates title exceeding max length (40)', () => {
    const longTitle = 'A'.repeat(60);
    const raw = `Response.\n<suggestions>[{"title":"${longTitle}","detail":"short"}]</suggestions>`;
    const result = extractSuggestions(raw);
    expect(result.suggestions[0]!.title).toHaveLength(40);
  });

  it('truncates detail exceeding max length (200)', () => {
    const longDetail = 'B'.repeat(250);
    const raw = `Response.\n<suggestions>[{"title":"ok","detail":"${longDetail}"}]</suggestions>`;
    const result = extractSuggestions(raw);
    expect(result.suggestions[0]!.detail).toHaveLength(200);
  });

  it('caps at max 5 suggestions', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, detail: `D${i}` }));
    const raw = `Response.\n<suggestions>${JSON.stringify(items)}</suggestions>`;
    const result = extractSuggestions(raw);
    expect(result.suggestions).toHaveLength(5);
  });

  it('filters out items with missing title', () => {
    const raw = 'Response.\n<suggestions>[{"title":"","detail":"has detail"},{"title":"ok","detail":"fine"}]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([{ title: 'ok', detail: 'fine' }]);
  });

  it('filters out items with missing detail', () => {
    const raw = 'Response.\n<suggestions>[{"title":"no detail","detail":""},{"title":"ok","detail":"fine"}]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([{ title: 'ok', detail: 'fine' }]);
  });

  it('filters out non-object/non-string items', () => {
    const raw = 'Response.\n<suggestions>[42, null, true, {"title":"valid","detail":"item"}]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([{ title: 'valid', detail: 'item' }]);
  });

  it('does NOT match tag in the middle of content', () => {
    const raw = 'Start <suggestions>[{"title":"mid","detail":"test"}]</suggestions> end of response.';
    const result = extractSuggestions(raw);
    expect(result.content).toBe(raw);
    expect(result.suggestions).toEqual([]);
  });

  it('returns empty suggestions for empty array', () => {
    const raw = 'Response.\n<suggestions>[]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.content).toBe(raw);
    expect(result.suggestions).toEqual([]);
  });

  it('trims title and detail text', () => {
    const raw = 'Response.\n<suggestions>[{"title":"  padded  ","detail":"  spaced  "}]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([{ title: 'padded', detail: 'spaced' }]);
  });

  it('handles empty input', () => {
    const result = extractSuggestions('');
    expect(result.content).toBe('');
    expect(result.suggestions).toEqual([]);
  });

  it('handles multiline response with suggestions at end', () => {
    const raw = `# Title

Here is a detailed response.

- Point 1
- Point 2

<suggestions>[{"title":"Continue","detail":"Continue with point 3"},{"title":"New topic","detail":"Change to a different topic"}]</suggestions>`;
    const result = extractSuggestions(raw);
    expect(result.content).toContain('# Title');
    expect(result.content).toContain('Point 2');
    expect(result.content).not.toContain('<suggestions>');
    expect(result.suggestions).toEqual([
      { title: 'Continue', detail: 'Continue with point 3' },
      { title: 'New topic', detail: 'Change to a different topic' },
    ]);
  });

  // --- Backward compatibility (plain strings) ---

  it('converts plain strings to {title, detail} with same value', () => {
    const raw = 'Response.\n<suggestions>["Ask about X", "Tell me more"]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([
      { title: 'Ask about X', detail: 'Ask about X' },
      { title: 'Tell me more', detail: 'Tell me more' },
    ]);
  });

  it('handles mixed array of objects and strings', () => {
    const raw = 'Response.\n<suggestions>[{"title":"Obj","detail":"Object detail"},"Plain string"]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([
      { title: 'Obj', detail: 'Object detail' },
      { title: 'Plain string', detail: 'Plain string' },
    ]);
  });

  it('filters out empty/whitespace-only strings', () => {
    const raw = 'Response.\n<suggestions>["good", "", "  ", "fine"]</suggestions>';
    const result = extractSuggestions(raw);
    expect(result.suggestions).toEqual([
      { title: 'good', detail: 'good' },
      { title: 'fine', detail: 'fine' },
    ]);
  });
});
