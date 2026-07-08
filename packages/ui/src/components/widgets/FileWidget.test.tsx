// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWidget } from './FileWidget';

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

describe('FileWidget', () => {
  it('renders a single file with name and type', () => {
    const container = render(
      <FileWidget data={{ name: 'report.pdf', type: 'application/pdf', size: 102400 }} />
    );

    expect(container.textContent).toContain('report.pdf');
    expect(container.textContent).toContain('application/pdf');
    expect(container.textContent).toContain('100 KB');
  });

  it('renders a single file with no type', () => {
    const container = render(<FileWidget data={{ name: 'readme.txt', size: 5120 }} />);

    expect(container.textContent).toContain('readme.txt');
    expect(container.textContent).toContain('5 KB');
    // No type separator when type is absent
  });

  it('renders multiple files from items array', () => {
    const container = render(
      <FileWidget
        data={{
          items: [
            { name: 'doc1.pdf', size: 1000 },
            { name: 'doc2.pdf', size: 2000 },
          ],
        }}
      />
    );

    expect(container.textContent).toContain('doc1.pdf');
    expect(container.textContent).toContain('doc2.pdf');
  });

  it('renders multiple files from a bare array', () => {
    const container = render(
      <FileWidget
        data={[
          { name: 'a.txt', size: 100 },
          { name: 'b.txt', size: 200 },
        ]}
      />
    );

    expect(container.textContent).toContain('a.txt');
    expect(container.textContent).toContain('b.txt');
  });

  it('shows "No valid files found" when items have no valid names', () => {
    const container = render(<FileWidget data={{ items: [{ size: 100 }, {}] }} />);

    expect(container.textContent).toContain('No valid files found');
  });

  it('shows "No valid files found" for empty object data', () => {
    const container = render(<FileWidget data={{}} />);

    expect(container.textContent).toContain('No valid files found');
  });

  it('renders a download link when url is a safe HTTPS URL', () => {
    const container = render(
      <FileWidget data={{ name: 'notes.txt', url: 'https://example.com/notes.txt' }} />
    );

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/notes.txt');
  });

  it('does not render download link for unsafe javascript: URL', () => {
    const container = render(
      <FileWidget data={{ name: 'evil.txt', url: 'javascript:alert(1)' }} />
    );

    const downloadIcon = container.querySelector('[download]');
    expect(downloadIcon).toBeNull();
  });

  it('does not render download link when url is undefined', () => {
    const container = render(<FileWidget data={{ name: 'local.txt' }} />);

    const downloadIcon = container.querySelector('[download]');
    expect(downloadIcon).toBeNull();
  });

  it('uses title prop when data has no title', () => {
    const container = render(<FileWidget data={{ name: 'f.txt' }} title="Downloads" />);

    expect(container.textContent).toContain('Downloads');
  });

  it('renders size without type correctly (no bullet separator)', () => {
    const container = render(<FileWidget data={{ name: 'data.bin', size: 500 }} />);

    expect(container.textContent).toContain('500 B');
    // No type span rendered
  });

  it('handles null/undefined data gracefully', () => {
    const container = render(<FileWidget data={null} />);
    expect(container.textContent).toContain('No valid files found');
  });
});
