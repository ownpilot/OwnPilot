// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlWidget } from './HtmlWidget';

let root: Root | null = null;

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root?.render(element));
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
});

describe('HtmlWidget', () => {
  it('renders sanitized allowed markup as React nodes', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<p><strong>Safe</strong> <a href="/docs" target="_blank">link</a></p>',
        }}
      />
    );

    expect(container.textContent).toContain('Safe link');
    expect(container.querySelector('strong')?.textContent).toBe('Safe');

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/docs');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('removes executable markup and unsafe attributes', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: [
            '<script>window.__xss = true</script>',
            '<iframe></iframe>',
            '<img src="javascript:alert(1)" onerror="alert(1)" alt="bad">',
            '<a href="data:text/html,evil" onclick="alert(1)">bad link</a>',
          ].join(''),
        }}
      />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();

    const image = container.querySelector('img');
    expect(image?.getAttribute('onerror')).toBeNull();
    expect(image?.getAttribute('src')).toBeNull();

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('onclick')).toBeNull();
    expect(anchor?.getAttribute('href')).toBeNull();
  });
});
