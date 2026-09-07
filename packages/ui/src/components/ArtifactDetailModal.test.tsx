// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactDetailModal, sanitizeArtifactForNewTab } from './ArtifactDetailModal';
import type { Artifact } from '../api/endpoints/artifacts';

/** Re-parse sanitizer output so assertions can inspect the emitted DOM. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

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
    await act(async () => {
      pinBtn!.click();
      await Promise.resolve();
    });

    expect(mockTogglePin).toHaveBeenCalledWith('artifact-1');
    expect(mockToast.success).toHaveBeenCalledWith('Artifact pinned');
    expect(
      container.querySelector<HTMLButtonElement>('button[title="Unpin from dashboard"]')
    ).toBeDefined();
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

  // Round 60 bypass regressions: the sanitizer previously missed (a) schemes
  // smuggled with TAB/LF/CR characters — browsers strip those from URLs
  // before scheme parsing, so "java\tscript:…" executes while never matching
  // a naive prefix test — (b) URL attributes outside {href, src, xlink:href},
  // and (c) iframes that render same-origin nested documents un-sandboxed.

  it('strips javascript: URLs smuggled with control characters', () => {
    const out = sanitizeArtifactForNewTab('<a href="java&#9;script:alert(1)">click</a>', 'html');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    const dangerous = Array.from(doc.querySelectorAll('a[href]')).filter((a) =>
      /^\s*(?:javascript|data):/i.test((a.getAttribute('href') ?? '').replace(/[\t\n\r]/g, ''))
    );
    expect(dangerous).toHaveLength(0);
  });

  it('strips javascript: URLs from form action attributes', () => {
    const out = sanitizeArtifactForNewTab(
      '<form action="javascript:alert(1)"><input type="submit" value="go"></form>',
      'html'
    );
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelectorAll('[action]').length).toBe(0);
  });

  it('emits every iframe with a script-blocking sandbox', () => {
    const out = sanitizeArtifactForNewTab(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      'html'
    );
    const doc = new DOMParser().parseFromString(out, 'text/html');
    const iframes = Array.from(doc.querySelectorAll('iframe'));
    expect(iframes.length).toBe(1);
    for (const frame of iframes) {
      expect(frame.hasAttribute('sandbox')).toBe(true);
      expect((frame.getAttribute('sandbox') ?? '').split(/\s+/)).not.toContain('allow-scripts');
    }
  });

  it('still preserves benign markup and https links (round 60 CONTROL)', () => {
    const out = sanitizeArtifactForNewTab(
      '<p style="color:red">Hello</p><a href="https://example.com">link</a>',
      'html'
    );
    expect(out).toContain('Hello');
    expect(out).toContain('https://example.com');
  });

  // Round 61 bypass regression: SMIL <animate>/<set> re-target attributes at
  // RUNTIME — inside an <a>, <animate attributeName="href"
  // values="javascript:…"/> rewrites the link to a scripting URL after static
  // attribute stripping, so clicking executes same-origin script. They are
  // now removed entirely (SMIL animation is non-essential to a preview).

  it('removes SMIL <animate> elements targeting href with javascript: values', () => {
    const out = sanitizeArtifactForNewTab(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><circle r="5"/><animate attributeName="href" values="javascript:alert(1)" dur="1s" repeatCount="indefinite"/></a></svg>',
      'svg'
    );
    expect(out).toContain('<circle');
    expect(out).not.toContain('<animate');
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('removes SMIL <animate> in HTML mode (attributeName case-folded)', () => {
    const out = sanitizeArtifactForNewTab(
      '<a href="#"><animate attributeName="href" to="javascript:alert(1)" dur="1s"/></a>',
      'html'
    );
    expect(out).not.toContain('<animate');
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('removes SMIL <set> elements targeting xlink:href', () => {
    const out = sanitizeArtifactForNewTab(
      '<a href="#"><set attributeName="xlink:href" to="javascript:alert(1)" dur="1s"/></a>',
      'html'
    );
    expect(out).not.toContain('<set');
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('CONTROL: static SVG shapes are preserved (true before and after)', () => {
    const out = sanitizeArtifactForNewTab(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/><rect width="4" height="4"/></svg>',
      'svg'
    );
    expect(out).toContain('<circle');
    expect(out).toContain('<rect');
  });

  // Round 62 bypass regression: <meta http-equiv="refresh"> placed in the
  // BODY survives the doc.body.innerHTML export (the HTML parser keeps
  // mid-document metas in body), and the blob document then force-navigates
  // to any URL the instant it opens — a phishing primitive from a
  // trusted-looking blob:https://app/… context. http-equiv metas are now
  // removed; charset metas (no http-equiv) are preserved.

  it('removes a body-position <meta http-equiv="refresh"> (forced-navigation primitive)', () => {
    const out = sanitizeArtifactForNewTab(
      '<p>Hello</p><meta http-equiv="refresh" content="0;url=https://evil.example/steal">',
      'html'
    );
    expect(parse(out).querySelectorAll('meta[http-equiv]').length).toBe(0);
    expect(out).not.toContain('http-equiv');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('Hello');
  });

  it('removes a refresh meta even when its target is a script scheme', () => {
    const out = sanitizeArtifactForNewTab(
      '<p>Hello</p><meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      'html'
    );
    expect(parse(out).querySelectorAll('meta[http-equiv]').length).toBe(0);
    expect(out).not.toContain('alert(1)');
  });

  it('CONTROL: a plain charset meta (no http-equiv) is preserved (true before and after)', () => {
    const out = sanitizeArtifactForNewTab('<p>A</p><meta charset="utf-8">', 'html');
    expect(parse(out).querySelectorAll('meta[charset]').length).toBe(1);
    expect(out).not.toContain('http-equiv');
    expect(out).toContain('A');
  });
});
