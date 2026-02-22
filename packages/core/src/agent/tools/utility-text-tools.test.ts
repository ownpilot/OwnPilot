import { describe, it, expect } from 'vitest';
import {
  countTextExecutor,
  extractFromTextExecutor,
  transformTextExecutor,
  compareTextExecutor,
  runRegexExecutor,
} from './utility-text-tools.js';

function parse(result: { content: string }) {
  return JSON.parse(result.content as string);
}

describe('countTextExecutor', () => {
  it('should count basic text statistics', async () => {
    const result = await countTextExecutor({ text: 'Hello world. This is a test.' });
    const data = parse(result);
    expect(data.words).toBe(6);
    expect(data.sentences).toBe(2);
    expect(data.characters).toBe(28);
    expect(data.lines).toBe(1);
    expect(data.paragraphs).toBe(1);
  });

  it('should handle empty string', async () => {
    const result = await countTextExecutor({ text: '' });
    const data = parse(result);
    expect(data.characters).toBe(0);
    expect(data.words).toBe(0);
    expect(data.sentences).toBe(0);
    expect(data.paragraphs).toBe(0);
    // ''.split('\n') gives [''], so lines = 1
    expect(data.lines).toBe(1);
  });

  it('should handle whitespace-only string', async () => {
    const result = await countTextExecutor({ text: '   \n  \t  ' });
    const data = parse(result);
    expect(data.words).toBe(0);
  });

  it('should count multiple paragraphs', async () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const result = await countTextExecutor({ text });
    const data = parse(result);
    expect(data.paragraphs).toBe(3);
    expect(data.sentences).toBe(3);
  });

  it('should handle sentences with multiple punctuation marks', async () => {
    const result = await countTextExecutor({ text: 'Really?! Yes!!! Okay...' });
    const data = parse(result);
    expect(data.sentences).toBe(3);
  });

  it('should calculate reading time', async () => {
    // 200 words per minute, ceil
    const words = Array(450).fill('word').join(' ');
    const result = await countTextExecutor({ text: words });
    const data = parse(result);
    expect(data.words).toBe(450);
    expect(data.readingTimeMinutes).toBe(Math.ceil(450 / 200));
  });

  it('should count a single word', async () => {
    const result = await countTextExecutor({ text: 'Hello' });
    const data = parse(result);
    expect(data.words).toBe(1);
    expect(data.characters).toBe(5);
    expect(data.charactersNoSpaces).toBe(5);
  });

  it('should handle special characters', async () => {
    const result = await countTextExecutor({ text: '@#$% ^&*()' });
    const data = parse(result);
    expect(data.words).toBe(2);
    expect(data.characters).toBe(10);
    expect(data.charactersNoSpaces).toBe(9);
  });
});

describe('extractFromTextExecutor', () => {
  it('should extract URLs', async () => {
    const result = await extractFromTextExecutor({
      text: 'Visit https://example.com and http://test.org today',
      pattern: 'urls',
    });
    const data = parse(result);
    expect(data.matches).toContain('https://example.com');
    expect(data.matches).toContain('http://test.org');
    expect(data.count).toBe(2);
  });

  it('should extract emails', async () => {
    const result = await extractFromTextExecutor({
      text: 'Contact alice@example.com or bob@test.org',
      pattern: 'emails',
    });
    const data = parse(result);
    expect(data.matches).toContain('alice@example.com');
    expect(data.matches).toContain('bob@test.org');
    expect(data.count).toBe(2);
  });

  it('should extract phone numbers', async () => {
    const result = await extractFromTextExecutor({
      text: 'Call 555-123-4567 or (555) 987-6543',
      pattern: 'phones',
    });
    const data = parse(result);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.matches.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract dates', async () => {
    const result = await extractFromTextExecutor({
      text: 'Due on 2026-02-21 and 12/25/2025',
      pattern: 'dates',
    });
    const data = parse(result);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it('should extract numbers', async () => {
    const result = await extractFromTextExecutor({
      text: 'Got 42 items and 3.14 liters',
      pattern: 'numbers',
    });
    const data = parse(result);
    expect(data.matches).toContain('42');
    expect(data.matches).toContain('3.14');
  });

  it('should extract hashtags', async () => {
    const result = await extractFromTextExecutor({
      text: 'Love #TypeScript and #Vitest today',
      pattern: 'hashtags',
    });
    const data = parse(result);
    expect(data.matches).toContain('#TypeScript');
    expect(data.matches).toContain('#Vitest');
    expect(data.count).toBe(2);
  });

  it('should extract mentions', async () => {
    const result = await extractFromTextExecutor({
      text: 'Thanks @alice and @bob for the review',
      pattern: 'mentions',
    });
    const data = parse(result);
    expect(data.matches).toContain('@alice');
    expect(data.matches).toContain('@bob');
    expect(data.count).toBe(2);
  });

  it('should return error for unknown pattern', async () => {
    const result = await extractFromTextExecutor({
      text: 'Some text',
      pattern: 'foobar',
    });
    const data = parse(result);
    expect(data.error).toContain('Unknown pattern');
    expect(data.error).toContain('foobar');
  });

  it('should deduplicate matches and track totalOccurrences', async () => {
    const result = await extractFromTextExecutor({
      text: 'Visit https://example.com then https://example.com again and https://example.com',
      pattern: 'urls',
    });
    const data = parse(result);
    expect(data.matches).toHaveLength(1);
    expect(data.count).toBe(1);
    expect(data.totalOccurrences).toBe(3);
  });

  it('should return empty matches when nothing found', async () => {
    const result = await extractFromTextExecutor({
      text: 'No special patterns here',
      pattern: 'emails',
    });
    const data = parse(result);
    expect(data.matches).toHaveLength(0);
    expect(data.count).toBe(0);
  });
});

describe('transformTextExecutor', () => {
  it('should convert to uppercase', async () => {
    const result = await transformTextExecutor({ text: 'hello world', operation: 'uppercase' });
    const data = parse(result);
    expect(data.output).toBe('HELLO WORLD');
  });

  it('should convert to lowercase', async () => {
    const result = await transformTextExecutor({ text: 'HELLO WORLD', operation: 'lowercase' });
    const data = parse(result);
    expect(data.output).toBe('hello world');
  });

  it('should capitalize first letter and lowercase rest', async () => {
    const result = await transformTextExecutor({ text: 'hELLO wORLD', operation: 'capitalize' });
    const data = parse(result);
    expect(data.output).toBe('Hello world');
  });

  it('should convert to title case', async () => {
    const result = await transformTextExecutor({
      text: 'hello world test',
      operation: 'title_case',
    });
    const data = parse(result);
    expect(data.output).toBe('Hello World Test');
  });

  it('should trim whitespace', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim' });
    const data = parse(result);
    expect(data.output).toBe('hello');
  });

  it('should trim start', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim_start' });
    const data = parse(result);
    expect(data.output).toBe('hello  ');
  });

  it('should trim end', async () => {
    const result = await transformTextExecutor({ text: '  hello  ', operation: 'trim_end' });
    const data = parse(result);
    expect(data.output).toBe('  hello');
  });

  it('should slugify text', async () => {
    const result = await transformTextExecutor({ text: 'Hello World! Test', operation: 'slugify' });
    const data = parse(result);
    expect(data.output).toBe('hello-world-test');
  });

  it('should slugify text with diacritics', async () => {
    const result = await transformTextExecutor({
      text: 'Cafe\u0301 re\u0301sume\u0301',
      operation: 'slugify',
    });
    const data = parse(result);
    expect(data.output).toBe('cafe-resume');
  });

  it('should convert to camel case', async () => {
    const result = await transformTextExecutor({ text: 'hello world', operation: 'camel_case' });
    const data = parse(result);
    expect(data.output).toBe('helloWorld');
  });

  it('should convert camelCase to snake case', async () => {
    const result = await transformTextExecutor({ text: 'helloWorld', operation: 'snake_case' });
    const data = parse(result);
    expect(data.output).toBe('hello_world');
  });

  it('should convert multi-word to snake case', async () => {
    const result = await transformTextExecutor({ text: 'Hello World', operation: 'snake_case' });
    const data = parse(result);
    expect(data.output).toBe('hello_world');
  });

  it('should convert camelCase to kebab case', async () => {
    const result = await transformTextExecutor({ text: 'helloWorld', operation: 'kebab_case' });
    const data = parse(result);
    expect(data.output).toBe('hello-world');
  });

  it('should convert to pascal case', async () => {
    const result = await transformTextExecutor({ text: 'hello world', operation: 'pascal_case' });
    const data = parse(result);
    expect(data.output).toBe('HelloWorld');
  });

  it('should reverse text', async () => {
    const result = await transformTextExecutor({ text: 'hello', operation: 'reverse' });
    const data = parse(result);
    expect(data.output).toBe('olleh');
  });

  it('should remove whitespace', async () => {
    const result = await transformTextExecutor({
      text: 'h e l l o',
      operation: 'remove_whitespace',
    });
    const data = parse(result);
    expect(data.output).toBe('hello');
  });

  it('should normalize whitespace', async () => {
    const result = await transformTextExecutor({
      text: 'hello   world  test',
      operation: 'normalize_whitespace',
    });
    const data = parse(result);
    expect(data.output).toBe('hello world test');
  });

  it('should remove diacritics', async () => {
    const result = await transformTextExecutor({
      text: 'caf\u00e9 r\u00e9sum\u00e9 na\u00efve',
      operation: 'remove_diacritics',
    });
    const data = parse(result);
    expect(data.output).toBe('cafe resume naive');
  });

  it('should truncate with defaults (maxLength 100, suffix "...")', async () => {
    const longText = 'a'.repeat(150);
    const result = await transformTextExecutor({ text: longText, operation: 'truncate' });
    const data = parse(result);
    // output = text.slice(0, 100 - 3) + '...' = 97 + 3 = 100
    expect(data.output).toHaveLength(100);
    expect(data.output.endsWith('...')).toBe(true);
  });

  it('should truncate with custom options', async () => {
    const text = 'Hello World this is a long sentence that needs truncation';
    const result = await transformTextExecutor({
      text,
      operation: 'truncate',
      options: { maxLength: 15, suffix: '~' },
    });
    const data = parse(result);
    // output = text.slice(0, 15 - 1) + '~' = 14 + 1 = 15
    expect(data.output).toHaveLength(15);
    expect(data.output.endsWith('~')).toBe(true);
  });

  it('should return error for unknown operation', async () => {
    const result = await transformTextExecutor({ text: 'hello', operation: 'foobar' });
    const data = parse(result);
    expect(data.error).toContain('Unknown operation');
    expect(data.error).toContain('foobar');
  });
});

describe('compareTextExecutor', () => {
  it('should detect identical texts', async () => {
    const result = await compareTextExecutor({ text1: 'hello world', text2: 'hello world' });
    const data = parse(result);
    expect(data.identical).toBe(true);
    expect(data.similarity).toBe(100);
  });

  it('should detect differences with word mode', async () => {
    // Use word mode so individual words are compared rather than whole lines
    const result = await compareTextExecutor({
      text1: 'hello world',
      text2: 'hello there',
      mode: 'words',
    });
    const data = parse(result);
    expect(data.identical).toBe(false);
    expect(data.similarity).toBeLessThan(100);
    expect(data.similarity).toBeGreaterThan(0);
    expect(data.removed).toContain('world');
    expect(data.added).toContain('there');
  });

  it('should compare by lines (default mode)', async () => {
    const result = await compareTextExecutor({
      text1: 'line1\nline2\nline3',
      text2: 'line1\nline3\nline4',
    });
    const data = parse(result);
    expect(data.mode).toBe('lines');
    expect(data.removedCount).toBeGreaterThanOrEqual(1);
    expect(data.addedCount).toBeGreaterThanOrEqual(1);
    expect(data.commonCount).toBeGreaterThanOrEqual(1);
  });

  it('should compare by words', async () => {
    const result = await compareTextExecutor({
      text1: 'hello world foo',
      text2: 'hello world bar',
      mode: 'words',
    });
    const data = parse(result);
    expect(data.mode).toBe('words');
    expect(data.removed).toContain('foo');
    expect(data.added).toContain('bar');
    expect(data.commonCount).toBe(2);
  });

  it('should compare by chars', async () => {
    const result = await compareTextExecutor({
      text1: 'abc',
      text2: 'abd',
      mode: 'chars',
    });
    const data = parse(result);
    expect(data.mode).toBe('chars');
    expect(data.removed).toContain('c');
    expect(data.added).toContain('d');
  });

  it('should handle empty texts', async () => {
    const result = await compareTextExecutor({ text1: '', text2: '' });
    const data = parse(result);
    expect(data.identical).toBe(true);
  });
});

describe('runRegexExecutor', () => {
  it('should test a regex pattern', async () => {
    const result = await runRegexExecutor({
      text: 'hello world',
      pattern: 'world',
      operation: 'test',
    });
    const data = parse(result);
    expect(data.result).toBe(true);
  });

  it('should match a regex pattern and return object with match, groups, index', async () => {
    const result = await runRegexExecutor({
      text: 'hello 42 world',
      pattern: '\\d+',
      operation: 'match',
    });
    const data = parse(result);
    expect(data.result.match).toBe('42');
    expect(data.result.index).toBe(6);
    expect(data.result.groups).toEqual([]);
  });

  it('should match_all occurrences as array of objects', async () => {
    const result = await runRegexExecutor({
      text: 'foo 12 bar 34 baz 56',
      pattern: '\\d+',
      operation: 'match_all',
    });
    const data = parse(result);
    expect(data.result).toHaveLength(3);
    expect(data.result[0].match).toBe('12');
    expect(data.result[1].match).toBe('34');
    expect(data.result[2].match).toBe('56');
  });

  it('should add g flag for match_all if not present', async () => {
    const result = await runRegexExecutor({
      text: 'aaa bbb aaa',
      pattern: 'aaa',
      operation: 'match_all',
    });
    const data = parse(result);
    expect(data.result).toHaveLength(2);
    expect(data.result[0].match).toBe('aaa');
    expect(data.result[1].match).toBe('aaa');
    // flags field stores the original input flags, not the internally-added 'g'
    expect(data.flags).toBe('');
  });

  it('should replace text', async () => {
    const result = await runRegexExecutor({
      text: 'hello world',
      pattern: 'world',
      operation: 'replace',
      replacement: 'earth',
      flags: 'g',
    });
    const data = parse(result);
    expect(data.result).toBe('hello earth');
  });

  it('should split text', async () => {
    const result = await runRegexExecutor({
      text: 'a,b,,c',
      pattern: ',+',
      operation: 'split',
    });
    const data = parse(result);
    expect(data.result).toEqual(['a', 'b', 'c']);
  });

  it('should return error for invalid regex', async () => {
    const result = await runRegexExecutor({
      text: 'hello',
      pattern: '[invalid',
      operation: 'test',
    });
    const data = parse(result);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('Invalid regex');
  });

  it('should return error for pattern too long', async () => {
    const result = await runRegexExecutor({
      text: 'hello',
      pattern: 'a'.repeat(1001),
      operation: 'test',
    });
    const data = parse(result);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('too long');
  });
});
