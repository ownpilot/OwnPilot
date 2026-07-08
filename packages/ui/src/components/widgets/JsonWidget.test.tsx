// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JsonWidget } from './JsonWidget';

function render(element: ReactElement) {
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

describe('JsonWidget', () => {
  it('renders JSON data with the provided title', () => {
    const container = render(
      createElement(JsonWidget, {
        title: 'Payload',
        data: { ok: true, count: 2 },
      })
    );

    expect(container.textContent).toContain('Payload');
    expect(container.textContent).toContain('"ok": true');
    expect(container.textContent).toContain('"count": 2');
  });

  it('truncates long raw strings for display', () => {
    const container = render(
      createElement(JsonWidget, {
        data: { raw: 'x'.repeat(201) },
      })
    );

    expect(container.textContent).toContain('[hidden — truncated for display]');
    expect(container.textContent).not.toContain('x'.repeat(201));
  });

  it('renders primitive values as JSON', () => {
    const container = render(createElement(JsonWidget, { data: 'plain text' }));

    expect(container.textContent).toContain('JSON');
    expect(container.textContent).toContain('"plain text"');
  });

  it('renders malformed widget data as a warning with optional raw details', () => {
    const container = render(
      createElement(JsonWidget, {
        data: { error: 'Invalid widget data', raw: '{bad json' },
      })
    );

    expect(container.textContent).toContain('Widget could not be rendered');
    expect(container.textContent).toContain('Show raw data');
    expect(container.textContent).toContain('{bad json');
  });

  it('handles malformed widget data without raw details', () => {
    const container = render(
      createElement(JsonWidget, {
        data: { error: 'Invalid widget data', raw: 123 },
      })
    );

    expect(container.textContent).toContain('Widget could not be rendered');
    expect(container.textContent).not.toContain('Show raw data');
  });
});
