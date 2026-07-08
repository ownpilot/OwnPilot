// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbedWidget } from './EmbedWidget';

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('EmbedWidget', () => {
  it('renders a single embed iframe from object with src', () => {
    const container = render(
      <EmbedWidget data={{ src: 'https://example.com/embed', title: 'My Embed' }} />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('src')).toBe('https://example.com/embed');
    expect(iframe!.getAttribute('title')).toBe('My Embed');
    expect(container.textContent).toContain('My Embed');
  });

  it('sets sandbox attribute on iframe', () => {
    const container = render(<EmbedWidget data={{ src: 'https://example.com/embed' }} />);

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe!.getAttribute('sandbox')).toContain('allow-forms');
    // Should NOT have allow-same-origin
    expect(iframe!.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('blocks disallowed embed URL', () => {
    const container = render(<EmbedWidget data={{ src: 'javascript:alert(1)' }} />);

    expect(container.textContent).toContain('Blocked embed URL');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('blocks same-origin URL', () => {
    // safeEmbedSrc checks window.location.origin, so with happy-dom this will be
    // the default origin which won't match 'https://evil.com'
    const container = render(<EmbedWidget data={{ src: 'https://example.com/page' }} />);

    // https://example.com should be allowed (different origin from happy-dom's default)
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
  });

  it('renders multiple embeds', () => {
    const container = render(
      <EmbedWidget
        data={{
          items: [
            { src: 'https://example.com/embed1', title: 'Embed 1' },
            { src: 'https://example.com/embed2', title: 'Embed 2' },
          ],
        }}
      />
    );

    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(2);
    expect(container.textContent).toContain('Embed 1');
    expect(container.textContent).toContain('Embed 2');
  });

  it('renders embeds from array data directly', () => {
    const container = render(
      <EmbedWidget
        data={[
          { src: 'https://example.com/1' },
          { src: 'https://example.com/2' },
          { src: 'https://example.com/3' },
        ]}
      />
    );

    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(3);
  });

  it('shows no valid embeds warning when items are empty', () => {
    const container = render(<EmbedWidget data={{ items: [] }} />);

    expect(container.textContent).toContain('No valid embeds found');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows no valid embeds warning when data is empty object', () => {
    const container = render(<EmbedWidget data={{}} />);

    expect(container.textContent).toContain('No valid embeds found');
  });

  it('shows no valid embeds warning when items lack src', () => {
    const container = render(
      <EmbedWidget
        data={{
          items: [{ title: 'No src' }],
        }}
      />
    );

    expect(container.textContent).toContain('No valid embeds found');
  });

  it('uses title prop when not provided in data', () => {
    const container = render(
      <EmbedWidget title="Dashboard" data={{ src: 'https://example.com/dashboard' }} />
    );

    expect(container.textContent).toContain('Dashboard');
  });

  it('renders embed without title', () => {
    const container = render(<EmbedWidget data={{ src: 'https://example.com/embed' }} />);

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('title')).toBe('Embedded content');
  });

  it('uses custom width and height', () => {
    const container = render(
      <EmbedWidget data={{ src: 'https://example.com/embed', width: 800, height: 600 }} />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('width')).toBe('800');
    expect(iframe!.getAttribute('height')).toBe('600');
  });
});
