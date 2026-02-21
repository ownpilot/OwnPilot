import { describe, it, expect } from 'vitest';
import { parseLimit, parseOffset, parsePagination } from './query-params.js';

describe('parseLimit', () => {
  it('returns default 50 when value is undefined', () => {
    expect(parseLimit(undefined)).toBe(50);
  });

  it('returns default 50 when value is empty string', () => {
    expect(parseLimit('')).toBe(50);
  });

  it('parses a valid numeric string', () => {
    expect(parseLimit('25')).toBe(25);
  });

  it('returns default when value is 0 (less than 1)', () => {
    expect(parseLimit('0')).toBe(50);
  });

  it('returns default when value is negative', () => {
    expect(parseLimit('-5')).toBe(50);
  });

  it('returns default when value is NaN', () => {
    expect(parseLimit('abc')).toBe(50);
  });

  it('caps value at max limit when exceeded', () => {
    expect(parseLimit('2000')).toBe(1000);
  });

  it('returns value when exactly at max limit', () => {
    expect(parseLimit('1000')).toBe(1000);
  });

  it('uses custom defaultLimit when provided', () => {
    expect(parseLimit(undefined, 20)).toBe(20);
  });

  it('uses custom maxLimit when provided', () => {
    expect(parseLimit('500', 50, 200)).toBe(200);
  });

  it('accepts 1 as the minimum valid value', () => {
    expect(parseLimit('1')).toBe(1);
  });

  it('truncates decimal via parseInt', () => {
    expect(parseLimit('1.5')).toBe(1);
  });
});

describe('parseOffset', () => {
  it('returns default 0 when value is undefined', () => {
    expect(parseOffset(undefined)).toBe(0);
  });

  it('returns default 0 when value is empty string', () => {
    expect(parseOffset('')).toBe(0);
  });

  it('parses a valid numeric string', () => {
    expect(parseOffset('10')).toBe(10);
  });

  it('returns default when value is negative', () => {
    expect(parseOffset('-1')).toBe(0);
  });

  it('returns default when value is NaN', () => {
    expect(parseOffset('abc')).toBe(0);
  });

  it('accepts 0 as a valid offset', () => {
    expect(parseOffset('0')).toBe(0);
  });

  it('uses custom default when provided', () => {
    expect(parseOffset(undefined, 5)).toBe(5);
  });

  it('does not cap large values', () => {
    expect(parseOffset('999999')).toBe(999999);
  });
});

describe('parsePagination', () => {
  it('returns defaults when both values are undefined', () => {
    expect(parsePagination(undefined, undefined)).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it('parses valid limit and offset values', () => {
    expect(parsePagination('25', '10')).toEqual({
      limit: 25,
      offset: 10,
    });
  });

  it('applies custom options for defaults and max', () => {
    expect(
      parsePagination(undefined, undefined, {
        defaultLimit: 20,
        maxLimit: 200,
        defaultOffset: 5,
      })
    ).toEqual({
      limit: 20,
      offset: 5,
    });
  });

  it('defaults offset when only limit is provided', () => {
    expect(parsePagination('30', undefined)).toEqual({
      limit: 30,
      offset: 0,
    });
  });

  it('defaults limit when only offset is provided', () => {
    expect(parsePagination(undefined, '15')).toEqual({
      limit: 50,
      offset: 15,
    });
  });

  it('respects all custom options together', () => {
    expect(
      parsePagination('500', '100', {
        defaultLimit: 10,
        maxLimit: 200,
        defaultOffset: 0,
      })
    ).toEqual({
      limit: 200,
      offset: 100,
    });
  });
});
