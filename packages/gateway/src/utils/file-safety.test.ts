import { describe, expect, it } from 'vitest';
import {
  attachmentDisposition,
  getLeafName,
  isWithinDirectory,
  normalizeArchiveEntryPath,
  sanitizeFilenameSegment,
} from './file-safety.js';

describe('file-safety utilities', () => {
  it('extracts leaf names across Unix and Windows-style paths', () => {
    expect(getLeafName('../evil.json')).toBe('evil.json');
    expect(getLeafName('C:\\temp\\evil.json')).toBe('evil.json');
  });

  it('sanitizes filename segments for headers and paths', () => {
    expect(sanitizeFilenameSegment('Report "Q1"\r\n.csv')).toBe('Report-Q1-.csv');
    expect(sanitizeFilenameSegment('!!!', { fallback: 'download' })).toBe('download');
    expect(sanitizeFilenameSegment('My Skill', { lowerCase: true })).toBe('my-skill');
  });

  it('allows sibling-looking names that stay inside the base directory', () => {
    expect(isWithinDirectory('/data/skills/pkg', '/data/skills/pkg/..evil/file.py')).toBe(true);
  });

  it('rejects paths outside the base directory', () => {
    expect(isWithinDirectory('/data/skills/pkg', '/data/skills/pkg2/file.py')).toBe(false);
    expect(isWithinDirectory('/data/skills/pkg', '/data/skills/pkg/../other/file.py')).toBe(false);
  });

  it('normalizes safe archive entry paths', () => {
    expect(normalizeArchiveEntryPath('./skill/scripts/run.py')).toBe('skill/scripts/run.py');
    expect(normalizeArchiveEntryPath('skill\\SKILL.md')).toBe('skill/SKILL.md');
  });

  it('rejects unsafe archive entry paths', () => {
    expect(normalizeArchiveEntryPath('../SKILL.md')).toBeNull();
    expect(normalizeArchiveEntryPath('/tmp/SKILL.md')).toBeNull();
    expect(normalizeArchiveEntryPath('C:\\tmp\\SKILL.md')).toBeNull();
  });

  it('builds an attachment disposition with a sanitized filename', () => {
    expect(attachmentDisposition('../bad"\r\n.txt')).toBe('attachment; filename="bad-.txt"');
  });
});
