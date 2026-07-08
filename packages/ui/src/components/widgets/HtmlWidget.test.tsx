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
  act(() => {
    root = createRoot(container);
    flushSync(() => root?.render(element));
  });
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

  it('shows "No HTML content" when html string is empty', () => {
    const container = render(<HtmlWidget data={{ html: '' }} />);
    expect(container.textContent).toContain('No HTML content provided');
  });

  it('shows "No HTML content" when data is a non-html object', () => {
    const container = render(<HtmlWidget data={{ notHtml: true }} />);
    expect(container.textContent).toContain('No HTML content provided');
  });

  it('renders HTML from a plain string data', () => {
    const container = render(<HtmlWidget data="<p>String content</p>" />);
    expect(container.textContent).toContain('String content');
  });

  it('uses title from data object', () => {
    const container = render(<HtmlWidget data={{ html: '<p>Content</p>', title: 'My HTML' }} />);
    expect(container.textContent).toContain('My HTML');
  });

  it('uses title prop when data has no title', () => {
    const container = render(<HtmlWidget data="<p>Content</p>" title="Fallback Title" />);
    expect(container.textContent).toContain('Fallback Title');
  });

  it('strips target attribute when it is not _blank', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<p><a href="/page" target="_self">self link</a></p>',
        }}
      />
    );

    expect(container.textContent).toContain('self link');
    // target="_self" is stripped; link text is preserved
  });

  it('adds rel="noopener noreferrer" for target="_blank" links', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<p><a href="https://example.com" target="_blank">external</a></p>',
        }}
      />
    );

    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    // DOMPurify hook should add rel="noopener noreferrer" in sanitized HTML
    expect(container.textContent).toContain('external');
  });

  it('renders nested HTML elements (ul, li)', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<div><ul><li>Item 1</li><li>Item 2</li></ul></div>',
        }}
      />
    );

    expect(container.textContent).toContain('Item 1');
    expect(container.textContent).toContain('Item 2');
  });

  it('renders headers (h1-h6)', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<div><h1>Title</h1><h2>Subtitle</h2></div>',
        }}
      />
    );

    expect(container.textContent).toContain('Title');
    expect(container.textContent).toContain('Subtitle');
  });

  it('renders table elements (table, thead, tbody, tr, th, td)', () => {
    const container = render(
      <HtmlWidget
        data={{
          html: '<div><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Value</td></tr></tbody></table></div>',
        }}
      />
    );

    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Value');
  });
});
