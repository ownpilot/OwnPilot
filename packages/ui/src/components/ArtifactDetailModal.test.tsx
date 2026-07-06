// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactDetailModal, sanitizeArtifactForNewTab } from './ArtifactDetailModal';
import type { Artifact } from '../api/endpoints/artifacts';

vi.mock('./ArtifactRenderer', () => ({
  ArtifactRenderer: () => <div data-testid="artifact-renderer" />,
}));

vi.mock('./ConfirmDialog', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}));

vi.mock('./ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn() }),
}));

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

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    conversationId: null,
    userId: 'user-1',
    type: 'html',
    title: 'Unsafe HTML',
    content: '<h1>Report</h1><script>window.opener.location="/owned"</script>',
    dataBindings: [],
    pinned: false,
    dashboardPosition: null,
    dashboardSize: 'medium',
    version: 1,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ArtifactDetailModal', () => {
  it('opens HTML artifact blobs with opener isolation', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:http://localhost/artifact-1');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={vi.fn()} />);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[title="Open in new tab"]')?.click();
    });

    expect(open).toHaveBeenCalledWith(
      'blob:http://localhost/artifact-1',
      '_blank',
      'noopener,noreferrer'
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/artifact-1');
  });
});

describe('sanitizeArtifactForNewTab', () => {
  it('strips <script> from HTML artifacts but keeps structure', () => {
    const out = sanitizeArtifactForNewTab(
      '<div><h1>Title</h1><script>window.opener.location="/owned"</script></div>',
      'html'
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('window.opener');
    expect(out).toContain('Title');
  });

  it('strips inline event handlers from HTML artifacts', () => {
    const out = sanitizeArtifactForNewTab('<img src=x onerror="alert(1)">', 'html');
    expect(out.toLowerCase()).not.toContain('onerror');
  });

  it('strips <script> and foreignObject from SVG artifacts but keeps shapes', () => {
    const out = sanitizeArtifactForNewTab(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><body onload="alert(2)"/></foreignObject><circle r="5"/></svg>',
      'svg'
    );
    expect(out).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('foreignobject');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out).toContain('circle');
  });
});
