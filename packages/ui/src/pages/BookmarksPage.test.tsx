import { describe, expect, it } from 'vitest';
import { getUnsafeBookmarkUrlTitle } from './BookmarksPage';

describe('getUnsafeBookmarkUrlTitle', () => {
  it('labels unsafe URL protocols without throwing', () => {
    expect(getUnsafeBookmarkUrlTitle('javascript:alert(1)')).toBe(
      'Unsafe URL protocol: javascript:'
    );
  });

  it('handles invalid bookmark URLs without throwing during render', () => {
    expect(getUnsafeBookmarkUrlTitle('not a url')).toBe('Unsafe or invalid URL');
  });
});
