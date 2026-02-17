import { describe, it, expect } from 'vitest';
import { extractMemoriesFromResponse } from './memory-extraction.js';

describe('extractMemoriesFromResponse', () => {
  it('extracts valid single memory', () => {
    const raw = 'Here is my response.\n\n<memories>[{"type":"fact","content":"User lives in Istanbul"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe('Here is my response.');
    expect(result.memories).toEqual([
      { type: 'fact', content: 'User lives in Istanbul' },
    ]);
  });

  it('extracts multiple memories', () => {
    const raw = 'Response.\n<memories>[{"type":"fact","content":"Name is Alex"},{"type":"preference","content":"Likes dark mode"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe('Response.');
    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toEqual({ type: 'fact', content: 'Name is Alex' });
    expect(result.memories[1]).toEqual({ type: 'preference', content: 'Likes dark mode' });
  });

  it('preserves optional importance field', () => {
    const raw = 'Response.\n<memories>[{"type":"fact","content":"Important fact","importance":0.9}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories[0]).toEqual({
      type: 'fact',
      content: 'Important fact',
      importance: 0.9,
    });
  });

  it('ignores importance outside 0-1 range', () => {
    const raw = 'Response.\n<memories>[{"type":"fact","content":"Test","importance":1.5}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories[0]).toEqual({ type: 'fact', content: 'Test' });
  });

  it('returns empty memories when no tag present', () => {
    const raw = 'Just a normal response.';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe(raw);
    expect(result.memories).toEqual([]);
  });

  it('returns content as-is with malformed JSON', () => {
    const raw = 'Response.\n<memories>not valid json</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe(raw);
    expect(result.memories).toEqual([]);
  });

  it('returns content as-is when JSON is not an array', () => {
    const raw = 'Response.\n<memories>{"type":"fact","content":"test"}</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe(raw);
    expect(result.memories).toEqual([]);
  });

  it('filters out items with missing content', () => {
    const raw = 'Response.\n<memories>[{"type":"fact","content":""},{"type":"fact","content":"Valid"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toEqual([{ type: 'fact', content: 'Valid' }]);
  });

  it('filters out items with invalid type', () => {
    const raw = 'Response.\n<memories>[{"type":"invalid","content":"Test"},{"type":"skill","content":"Python"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toEqual([{ type: 'skill', content: 'Python' }]);
  });

  it('filters out non-object items', () => {
    const raw = 'Response.\n<memories>[42, null, "string", {"type":"fact","content":"Valid"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toEqual([{ type: 'fact', content: 'Valid' }]);
  });

  it('truncates content exceeding 500 chars', () => {
    const longContent = 'A'.repeat(600);
    const raw = `Response.\n<memories>[{"type":"fact","content":"${longContent}"}]</memories>`;
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories[0]!.content).toHaveLength(500);
  });

  it('caps at max 10 memories', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ type: 'fact', content: `Fact ${i}` }));
    const raw = `Response.\n<memories>${JSON.stringify(items)}</memories>`;
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toHaveLength(10);
  });

  it('returns empty memories for empty array', () => {
    const raw = 'Response.\n<memories>[]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe(raw);
    expect(result.memories).toEqual([]);
  });

  it('handles tag in middle of content (before suggestions)', () => {
    const raw = 'Response text.\n<memories>[{"type":"fact","content":"Name is Alex"}]</memories>\n<suggestions>[{"title":"Hi","detail":"Hello"}]</suggestions>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe('Response text.\n\n<suggestions>[{"title":"Hi","detail":"Hello"}]</suggestions>');
    expect(result.memories).toEqual([{ type: 'fact', content: 'Name is Alex' }]);
  });

  it('handles whitespace around the tag', () => {
    const raw = 'Response.\n\n<memories>  [{"type":"preference","content":"Likes coffee"}]  </memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toBe('Response.');
    expect(result.memories).toEqual([{ type: 'preference', content: 'Likes coffee' }]);
  });

  it('trims content text', () => {
    const raw = 'Response.\n<memories>[{"type":"fact","content":"  padded content  "}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories[0]!.content).toBe('padded content');
  });

  it('handles empty input', () => {
    const result = extractMemoriesFromResponse('');
    expect(result.content).toBe('');
    expect(result.memories).toEqual([]);
  });

  it('handles all valid memory types', () => {
    const types = ['fact', 'preference', 'conversation', 'event', 'skill'];
    const items = types.map(t => ({ type: t, content: `Type ${t}` }));
    const raw = `Response.\n<memories>${JSON.stringify(items)}</memories>`;
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toHaveLength(5);
    for (let i = 0; i < types.length; i++) {
      expect(result.memories[i]!.type).toBe(types[i]);
    }
  });

  it('filters out items missing type', () => {
    const raw = 'Response.\n<memories>[{"content":"No type"},{"type":"fact","content":"Has type"}]</memories>';
    const result = extractMemoriesFromResponse(raw);
    expect(result.memories).toEqual([{ type: 'fact', content: 'Has type' }]);
  });

  it('handles multiline response with memories before suggestions', () => {
    const raw = `# Title

Here is a response.

- Point 1
- Point 2

<memories>[{"type":"fact","content":"User mentioned points"}]</memories>
<suggestions>[{"title":"Continue","detail":"Continue discussion"}]</suggestions>`;
    const result = extractMemoriesFromResponse(raw);
    expect(result.content).toContain('# Title');
    expect(result.content).toContain('Point 2');
    expect(result.content).not.toContain('<memories>');
    expect(result.content).toContain('<suggestions>');
    expect(result.memories).toEqual([{ type: 'fact', content: 'User mentioned points' }]);
  });
});
