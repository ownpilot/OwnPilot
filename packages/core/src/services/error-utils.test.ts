import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './error-utils.js';

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('returns empty string from Error with empty message', () => {
    expect(getErrorMessage(new Error(''))).toBe('');
  });

  it('returns the string itself for string values', () => {
    expect(getErrorMessage('raw error string')).toBe('raw error string');
  });

  it('returns stringified number for number values', () => {
    expect(getErrorMessage(123)).toBe('123');
  });

  it('returns "null" for null', () => {
    expect(getErrorMessage(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('returns "[object Object]" for plain object', () => {
    expect(getErrorMessage({})).toBe('[object Object]');
  });

  it('returns stringified boolean', () => {
    expect(getErrorMessage(true)).toBe('true');
    expect(getErrorMessage(false)).toBe('false');
  });

  it('returns fallback for non-Error value when fallback is provided', () => {
    expect(getErrorMessage('some string', 'fallback message')).toBe('fallback message');
    expect(getErrorMessage(42, 'fallback message')).toBe('fallback message');
    expect(getErrorMessage(null, 'fallback message')).toBe('fallback message');
    expect(getErrorMessage(undefined, 'fallback message')).toBe('fallback message');
  });

  it('returns error.message even when fallback is provided for Error instances', () => {
    expect(getErrorMessage(new Error('actual error'), 'fallback message')).toBe('actual error');
  });
});
