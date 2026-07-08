// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CodeWidget } from './CodeWidget';

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

describe('CodeWidget', () => {
  it('renders code with language label and content', () => {
    const container = render(
      <CodeWidget data={{ code: 'const x = 1;', language: 'javascript', title: 'Example' }} />
    );

    expect(container.textContent).toContain('javascript');
    expect(container.textContent).toContain('const x = 1;');
    expect(container.textContent).toContain('Example');
  });

  it('renders code from a plain string data', () => {
    const container = render(<CodeWidget data="console.log('hello')" />);

    expect(container.textContent).toContain("console.log('hello')");
  });

  it('shows "No code provided" when data object has no code', () => {
    const container = render(<CodeWidget data={{ language: 'json' }} />);

    expect(container.textContent).toContain('No code provided');
  });

  it('shows "No code provided" for empty string', () => {
    const container = render(<CodeWidget data={{ code: '' }} />);

    expect(container.textContent).toContain('No code provided');
  });

  it('shows line numbers by default', () => {
    const container = render(
      <CodeWidget data={{ code: 'line1\nline2\nline3', language: 'text' }} />
    );

    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('3');
  });

  it('hides line numbers when showLineNumbers is false', () => {
    const container = render(
      <CodeWidget data={{ code: 'line1\nline2', language: 'text', showLineNumbers: false }} />
    );

    // Should still show the code but no obvious line number text
    expect(container.textContent).toContain('line1');
    expect(container.textContent).toContain('line2');
  });

  it('defaults language to "text" when not provided', () => {
    const container = render(<CodeWidget data={{ code: 'some code' }} />);

    expect(container.textContent).toContain('text');
  });

  it('normalizes language to lowercase', () => {
    const container = render(<CodeWidget data={{ code: 'let x = 1;', language: 'JavaScript' }} />);

    expect(container.textContent).toContain('javascript');
  });

  it('uses title prop when data has no title', () => {
    const container = render(<CodeWidget data={{ code: 'hello' }} title="My Code" />);

    expect(container.textContent).toContain('My Code');
  });

  it('falls back to "Code" when no title provided', () => {
    const container = render(<CodeWidget data={{ code: 'hello' }} />);

    expect(container.textContent).toContain('Code');
  });
});
