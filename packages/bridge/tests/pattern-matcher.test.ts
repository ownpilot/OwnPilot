import { describe, it, expect } from 'vitest';
import {
  matchPatterns,
  matchPattern,
  hasStructuredOutput,
  isBlocking,
} from '../src/pattern-matcher.ts';

describe('matchPatterns', () => {
  it('detects PROGRESS pattern', () => {
    const results = matchPatterns('PROGRESS: Phase 3 running');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('PROGRESS');
    expect(results[0].value).toBe('Phase 3 running');
  });

  it('detects multiple patterns', () => {
    const text = 'PROGRESS: step 1\nQUESTION: which DB?';
    const results = matchPatterns(text);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const keys = results.map((r) => r.key);
    expect(keys).toContain('PROGRESS');
    expect(keys).toContain('QUESTION');
  });

  it('returns empty for plain text', () => {
    expect(matchPatterns('Hello world, nothing structured here.')).toHaveLength(0);
  });
});

describe('matchPattern', () => {
  it('returns null for non-matching pattern', () => {
    expect(matchPattern('Hello', 'ERROR')).toBeNull();
  });

  it('matches ERROR pattern', () => {
    const r = matchPattern('ERROR: Build failed with code 1', 'ERROR');
    expect(r).not.toBeNull();
    expect(r!.value).toBe('Build failed with code 1');
  });
});

describe('PHASE_COMPLETE anchor', () => {
  it('matches at start of line', () => {
    const r = matchPattern('Phase 3 complete', 'PHASE_COMPLETE');
    expect(r).not.toBeNull();
  });

  it('does NOT match mid-sentence (anchor fix)', () => {
    // This was a bug — fixed with ^ anchor
    const r = matchPattern('We verified Phase 3 complete already', 'PHASE_COMPLETE');
    expect(r).toBeNull();
  });

  it('matches at start of multiline text', () => {
    const r = matchPattern('Some preamble\nPhase 5 complete\nMore text', 'PHASE_COMPLETE');
    expect(r).not.toBeNull();
  });
});

describe('isBlocking', () => {
  it('returns true for QUESTION', () => {
    expect(isBlocking('QUESTION: Which database should we use?')).toBe(true);
  });

  it('returns true for TASK_BLOCKED', () => {
    expect(isBlocking('TASK_BLOCKED: Missing API key for deployment')).toBe(true);
  });

  it('returns false for non-blocking patterns', () => {
    expect(isBlocking('PROGRESS: Phase 2 running')).toBe(false);
    expect(isBlocking('TASK_COMPLETE: Auth module done')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isBlocking('Just a normal response with no patterns')).toBe(false);
  });
});

describe('hasStructuredOutput', () => {
  it('returns true when pattern exists', () => {
    expect(hasStructuredOutput('ERROR: something broke')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasStructuredOutput('No patterns here')).toBe(false);
  });
});
