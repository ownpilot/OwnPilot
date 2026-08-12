/**
 * Shared React test harness.
 *
 * The UI suite renders with `createRoot` + `act` directly rather than
 * @testing-library. That is a fine choice, but every test file was carrying its
 * own copy of the same render/cleanup/flush/findByText block — 59 files at the
 * time this was extracted. Duplicated boilerplate is a tax on writing the next
 * test, and the pages that most need tests are the ones nobody wants to pay it
 * for.
 *
 * Usage:
 *
 *   import { render, cleanup, flushAsyncUpdates, hasText } from '../test-harness';
 *
 *   afterEach(cleanup);
 *
 *   it('mounts', async () => {
 *     const container = render(<MyPage />);
 *     await flushAsyncUpdates();
 *     expect(hasText(container, 'Expected')).toBe(true);
 *   });
 *
 * Requires `// @vitest-environment happy-dom` at the top of the test file.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

let root: Root | null = null;
let container: HTMLElement | null = null;

/**
 * Mount an element into a fresh container appended to document.body.
 * Call `cleanup()` afterwards (typically via `afterEach(cleanup)`).
 */
export function render(element: ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(element);
  });
  return container;
}

/** Unmount and reset the DOM. Safe to call when nothing is mounted. */
export function cleanup(): void {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  document.body.innerHTML = '';
}

/**
 * Let pending promises and timer-0 callbacks settle inside `act`.
 *
 * Pages fetch on mount, so a smoke test that asserts immediately after
 * `render` sees the loading state forever.
 */
export async function flushAsyncUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** First element whose text content includes `text`, or null. Internal to hasText. */
function findByText(scope: HTMLElement, text: string): HTMLElement | null {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes(text)) return node.parentElement;
  }
  return null;
}

/** Whether any text node under `scope` includes `text`. */
export function hasText(scope: HTMLElement, text: string): boolean {
  return findByText(scope, text) !== null;
}

/**
 * Stub module for `../components/icons`.
 *
 * Icons are SVG components with no behaviour; rendering the real ones only
 * slows tests down. Must be consumed from inside an async `vi.mock` factory,
 * because factories are hoisted above imports:
 *
 *   vi.mock('../components/icons', async () => {
 *     const { createIconStubs } = await import('../test-harness');
 *     return createIconStubs();
 *   });
 *
 * Returns a Proxy so any icon name resolves, which keeps the mock working when
 * a page adds an icon.
 *
 * `then` must resolve to undefined: a module namespace whose `then` is callable
 * is treated as a thenable, so `await import(...)` would recurse and hang the
 * worker rather than fail. Same for symbol keys, which the module machinery
 * probes (Symbol.toStringTag, Symbol.iterator).
 */
export function createIconStubs(): Record<string, unknown> {
  const cache = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === '__esModule') return true;
        if (prop === 'then' || prop === 'default') return undefined;
        if (!cache.has(prop)) {
          const Icon = ({ className }: { className?: string }) =>
            createElement('svg', { 'data-testid': `icon-${prop}`, className });
          Object.defineProperty(Icon, 'name', { value: prop });
          cache.set(prop, Icon);
        }
        return cache.get(prop);
      },
      has() {
        return true;
      },
    }
  ) as Record<string, unknown>;
}
