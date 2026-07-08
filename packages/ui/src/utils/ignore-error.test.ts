import { afterEach, describe, expect, it, vi } from 'vitest';
import { ignoreError, silentCatch } from './ignore-error';

describe('ignoreError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing for nullish or non-promise values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ignoreError(null);
    ignoreError(undefined);
    ignoreError({} as unknown as Promise<unknown>);

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs rejected promises with the optional tag', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('network failed');

    ignoreError(Promise.reject(error), 'savePrefs');
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith('[ignored savePrefs]', error);
  });

  it('logs rejected promises without a tag', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('network failed');

    ignoreError(Promise.reject(error));
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith('[ignored]', error);
  });

  it('does not log resolved promises', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ignoreError(Promise.resolve('ok'), 'load');
    await Promise.resolve();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('silentCatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a rejection handler that logs with a tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('boom');

    silentCatch('refresh')(error);

    expect(warn).toHaveBeenCalledWith('[ignored refresh]', error);
  });

  it('logs without a tag when none is provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = 'plain failure';

    silentCatch()(error);

    expect(warn).toHaveBeenCalledWith('[ignored]', error);
  });
});
