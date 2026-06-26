import { describe, it, expect, vi } from 'vitest';
import { ignoreError, silentCatch } from './ignore-error.js';

describe('ignore-error utils', () => {
  it('swallows ignored promise rejections by default', async () => {
    ignoreError(Promise.reject(new Error('ignored')), 'test');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(true).toBe(true);
  });

  it('passes ignored rejections to an optional handler with the tag', async () => {
    const onError = vi.fn();

    ignoreError(Promise.reject(new Error('tracked')), 'tag-1', onError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'tag-1');
  });

  it('returns a catch handler for promise chains', () => {
    const onError = vi.fn();
    const err = new Error('chain');

    silentCatch('tag-2', onError)(err);

    expect(onError).toHaveBeenCalledWith(err, 'tag-2');
  });
});
