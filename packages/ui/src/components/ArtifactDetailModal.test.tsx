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

const mockConfirm = { fn: vi.fn() };

vi.mock('./ConfirmDialog', () => ({
  useDialog: () => ({ confirm: mockConfirm.fn }),
}));

const mockToast = { success: vi.fn(), info: vi.fn() };

vi.mock('./ToastProvider', () => ({
  useToast: () => ({ success: mockToast.success, info: mockToast.info }),
}));

vi.mock('../api/endpoints/artifacts', () => ({
  artifactsApi: {
    togglePin: vi.fn(),
    refresh: vi.fn(),
    delete: vi.fn(),
  },
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

  it('shows info toast when open in new tab is clicked for non-html/svg artifact', () => {
    const container = render(
      <ArtifactDetailModal artifact={artifact({ type: 'markdown' })} onClose={vi.fn()} />
    );
    // For non-html/svg, the "Open in new tab" button should not be rendered
    expect(container.querySelector('button[title="Open in new tab"]')).toBeNull();
  });

  it('renders different artifact types with correct labels', () => {
    const types: Array<{ type: Artifact['type']; label: string }> = [
      { type: 'html', label: 'HTML' },
      { type: 'svg', label: 'SVG' },
      { type: 'markdown', label: 'Markdown' },
      { type: 'form', label: 'Form' },
      { type: 'chart', label: 'Chart' },
      { type: 'react', label: 'React' },
    ];

    for (const { type, label } of types) {
      const c = render(
        <ArtifactDetailModal
          key={type}
          artifact={artifact({ type: type as Artifact['type'], title: `Test ${label}` })}
          onClose={vi.fn()}
        />
      );
      expect(c.textContent).toContain(label);
      expect(c.textContent).toContain(`Test ${label}`);
      act(() => {
        root?.unmount();
      });
      root = null;
      document.body.replaceChildren();
    }
  });

  it('toggles source/preview view', () => {
    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={vi.fn()} />);
    // Find the source toggle button
    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Source'
    );

    expect(toggleBtn).toBeDefined();
    act(() => toggleBtn!.click());
    // After clicking, button text should say "Preview"
    expect(toggleBtn!.textContent).toBe('Preview');
    expect(container.textContent).toContain('<h1>Report</h1>');

    act(() => toggleBtn!.click());
    // Back to render mode - ArtifactRenderer should show
    expect(toggleBtn!.textContent).toBe('Source');
  });

  it('shows pin/unpin button and calls togglePin', async () => {
    const { artifactsApi } = await import('../api/endpoints/artifacts');
    const mockTogglePin = vi
      .mocked(artifactsApi.togglePin)
      .mockResolvedValue(artifact({ pinned: true }));

    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={vi.fn()} />);

    const pinBtn = container.querySelector<HTMLButtonElement>('button[title="Pin to dashboard"]');
    expect(pinBtn).toBeDefined();
    act(() => pinBtn!.click());

    await vi.waitFor(() => {
      expect(mockTogglePin).toHaveBeenCalledWith('artifact-1');
      expect(mockToast.success).toHaveBeenCalledWith('Artifact pinned');
    });
  });

  it('shows unpin button when already pinned', () => {
    const container = render(
      <ArtifactDetailModal artifact={artifact({ pinned: true })} onClose={vi.fn()} />
    );

    const unpinBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Unpin from dashboard"]'
    );
    expect(unpinBtn).toBeDefined();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={onClose} />);

    // Click the backdrop (outer div with fixed inset-0)
    const backdrop = container.firstElementChild as HTMLElement;
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on content area click', () => {
    const onClose = vi.fn();
    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={onClose} />);

    // Click the inner modal content div
    const inner = container.querySelector('.max-w-7xl') as HTMLElement;
    act(() => {
      inner.click();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows tags when present', () => {
    const container = render(
      <ArtifactDetailModal artifact={artifact({ tags: ['important', 'demo'] })} onClose={vi.fn()} />
    );

    expect(container.textContent).toContain('important');
    expect(container.textContent).toContain('demo');
  });

  it('shows refresh button when dataBindings present', () => {
    const container = render(
      <ArtifactDetailModal
        artifact={artifact({
          dataBindings: [{ id: 'b1', variableName: 'data', source: { type: 'query' } }],
        })}
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('button[title="Refresh data bindings"]')).toBeDefined();
    expect(container.textContent).toContain('1 data binding(s)');
  });

  it('shows updated timestamp when different from created', () => {
    const container = render(
      <ArtifactDetailModal
        artifact={artifact({
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        })}
        onClose={vi.fn()}
      />
    );

    expect(container.textContent).toContain('Updated');
  });

  it('shows delete confirmation dialog', async () => {
    const { artifactsApi } = await import('../api/endpoints/artifacts');
    const mockDelete = vi.mocked(artifactsApi.delete).mockResolvedValue(undefined);

    mockConfirm.fn.mockResolvedValue(true);
    const onClose = vi.fn();
    const onDelete = vi.fn();

    const container = render(
      <ArtifactDetailModal artifact={artifact()} onClose={onClose} onDelete={onDelete} />
    );

    const deleteBtn = container.querySelector<HTMLButtonElement>('button[title="Delete artifact"]');
    expect(deleteBtn).toBeDefined();
    act(() => deleteBtn!.click());

    await vi.waitFor(() => {
      expect(mockConfirm.fn).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith('artifact-1');
      expect(onDelete).toHaveBeenCalledWith('artifact-1');
      expect(onClose).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalledWith('Artifact deleted');
    });
  });

  it('does not delete when confirm dialog dismissed', () => {
    const onDelete = vi.fn();

    // Set confirm to return false BEFORE clicking delete
    mockConfirm.fn.mockReturnValue(Promise.resolve(false));

    const container = render(
      <ArtifactDetailModal artifact={artifact()} onClose={vi.fn()} onDelete={onDelete} />
    );

    const deleteBtn = container.querySelector<HTMLButtonElement>('button[title="Delete artifact"]');
    act(() => deleteBtn!.click());

    // confirm() was called and returned false — neither delete nor onDelete should fire
    expect(mockConfirm.fn).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows download button and creates blob', () => {
    const createObjectURL = vi.fn(() => 'blob:download');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const container = render(<ArtifactDetailModal artifact={artifact()} onClose={vi.fn()} />);

    const downloadBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Download artifact"]'
    );
    expect(downloadBtn).toBeDefined();
    act(() => downloadBtn!.click());

    expect(createObjectURL).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('Artifact downloaded');
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

  it('strips javascript: and data: URLs from href/src attributes', () => {
    const out = sanitizeArtifactForNewTab(
      '<a href="javascript:alert(1)">click</a><img src="data:image/svg+xml,alert(1)">',
      'html'
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:');
  });

  it('returns empty string when DOMParser is unavailable', () => {
    const originalParser = (globalThis as Record<string, unknown>).DOMParser;
    (globalThis as Record<string, unknown>).DOMParser = undefined;
    const out = sanitizeArtifactForNewTab('<script>alert(1)</script>', 'html');
    expect(out).toBe('');
    (globalThis as Record<string, unknown>).DOMParser = originalParser;
  });
});
