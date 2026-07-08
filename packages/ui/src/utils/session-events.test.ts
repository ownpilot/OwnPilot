// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchSessionChanged, onSessionChanged } from './session-events';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session-events', () => {
  it('notifies subscribers with the authenticated detail', () => {
    const handler = vi.fn();
    const unsubscribe = onSessionChanged(handler);

    dispatchSessionChanged(true);

    expect(handler).toHaveBeenCalledWith({ authenticated: true });

    unsubscribe();
  });

  it('removes the listener when unsubscribe is called', () => {
    const handler = vi.fn();
    const unsubscribe = onSessionChanged(handler);

    unsubscribe();
    dispatchSessionChanged(false);

    expect(handler).not.toHaveBeenCalled();
  });
});
