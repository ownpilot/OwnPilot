import { describe, it, expect } from 'vitest';
import { formatNumber, formatBytes, formatToolName } from './formatters.js';

describe('formatNumber', () => {
  it('returns plain string for numbers under 1000', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with K suffix (1 decimal by default)', () => {
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(999999)).toBe('1000.0K');
  });

  it('formats millions with M suffix (1 decimal by default)', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
    expect(formatNumber(2_500_000)).toBe('2.5M');
  });

  it('respects custom kDecimals option', () => {
    expect(formatNumber(1234, { kDecimals: 0 })).toBe('1K');
    expect(formatNumber(1234, { kDecimals: 2 })).toBe('1.23K');
  });

  it('respects custom mDecimals option', () => {
    expect(formatNumber(1_234_567, { mDecimals: 0 })).toBe('1M');
    expect(formatNumber(1_234_567, { mDecimals: 2 })).toBe('1.23M');
  });
});

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes without suffix', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('respects custom decimals parameter', () => {
    // parseFloat strips trailing zeros — "1.50" → "1.5" is intentional for clean display
    expect(formatBytes(1536, 2)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatToolName', () => {
  it('title-cases simple names', () => {
    expect(formatToolName('get_time')).toBe('Get Time');
  });

  it('strips namespace prefix', () => {
    expect(formatToolName('core.get_time')).toBe('Get Time');
  });

  it('strips nested namespace prefixes', () => {
    expect(formatToolName('plugin.my_plugin.search_web')).toBe('Search Web');
  });

  it('handles single word names', () => {
    expect(formatToolName('search')).toBe('Search');
  });

  it('handles names without underscores or dots', () => {
    expect(formatToolName('mytool')).toBe('Mytool');
  });
});
