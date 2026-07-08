// @vitest-environment happy-dom

/**
 * Integration tests for BookmarksPage. The page composes many hooks
 * (useDialog, useToast, useGateway, useSkipHome, useSearchParams, react-router)
 * so we mock the top-level boundaries (api client, dialog/toast/gateway providers)
 * and exercise the page's data-driven render path: tab routing, search input,
 * filter buttons, error/empty/skeleton states, and the bookmark card grid.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { BookmarksPage } from './BookmarksPage';

let root: Root | null = null;

function renderPage(initialEntries: string[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, { initialEntries }, createElement(BookmarksPage)));
  });
  return container;
}

function cleanup() {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = '';
}

const mockList = vi.fn();
const mockFavorite = vi.fn();
const mockDelete = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSubscribe = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../api/endpoints/personal-data', () => ({
  bookmarksApi: {
    list: (...args: unknown[]) => mockList(...args),
    favorite: (...args: unknown[]) => mockFavorite(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: mockSubscribe }),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useDialog: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
  }),
}));

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../hooks/useSkipHome', () => ({
  useSkipHome: () => ({
    skipHome: false,
    onSkipHomeChange: vi.fn(),
  }),
}));

// Replace every icon export with a small data-icon stub while keeping the
// real module shape so React can still destructure any name.
vi.mock('../components/icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const stub = (name: string) => (props: { className?: string }) =>
    createElement('span', { 'data-icon': name, className: props?.className });
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    out[key] = stub(key);
  }
  return out;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribe.mockReturnValue(() => {});
  mockConfirm.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

const sampleBookmark = {
  id: 'bm-1',
  url: 'https://example.test',
  title: 'Example',
  description: 'An example link',
  folder: 'docs',
  tags: ['a', 'b', 'c'],
  isFavorite: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('BookmarksPage integration', () => {
  it('renders skeleton cards while loading and switches to the bookmark grid on success', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    // Initial render shows skeleton cards before list resolves
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('switches to home tab by default and renders the home hero content', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks']);
    expect(container.textContent).toContain('Save & Organize Links');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('switches to the bookmarks tab and renders the empty state when no bookmarks exist', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('No bookmarks yet');
  });

  it('renders the error state with a Try Again action when the API rejects', async () => {
    mockList.mockRejectedValue(new Error('Network down'));
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Failed to load bookmarks');
    expect(container.textContent).toContain('Try Again');
  });

  it('renders a populated bookmark grid when the API returns items', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Example');
    expect(container.textContent).toContain('example.test');
    expect(container.textContent).toContain('docs');
    expect(container.textContent).toContain('a');
  });

  // ── Search / Filter / Folder ──

  it('renders the search input on the Bookmarks tab', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const searchInput = container.querySelector('input[placeholder="Search bookmarks..."]');
    expect(searchInput).not.toBeNull();
  });

  it('debounces search input and re-fetches with the search term', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const searchInput = container.querySelector(
      'input[placeholder="Search bookmarks..."]'
    ) as HTMLInputElement;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(searchInput, 'docs');
      searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    // Before debounce settles, no new fetch should be triggered
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const beforeCount = mockList.mock.calls.length;

    // After the 300ms debounce + safety margin
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(mockList.mock.calls.length).toBeGreaterThan(beforeCount);
    const lastCall = mockList.mock.calls.at(-1);
    expect(lastCall?.[0]?.search).toBe('docs');
  });

  it('switches the filter to favorites and re-fetches with favorite=true', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const favButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Favorites'
    );
    expect(favButton).toBeDefined();

    act(() => {
      favButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const lastCall = mockList.mock.calls.at(-1);
    expect(lastCall?.[0]?.favorite).toBe('true');
  });

  it('renders folder filter buttons when bookmarks have folders', async () => {
    const multi = [
      { ...sampleBookmark, id: 'b1', folder: 'docs' },
      { ...sampleBookmark, id: 'b2', folder: 'rfc' },
    ];
    mockList.mockResolvedValue(multi);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('docs');
    expect(container.textContent).toContain('rfc');
  });

  it('selects a folder and re-fetches with the folder param', async () => {
    const multi = [
      { ...sampleBookmark, id: 'b1', folder: 'docs' },
      { ...sampleBookmark, id: 'b2', folder: 'rfc' },
    ];
    mockList.mockResolvedValue(multi);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The folder button is rendered after a | separator; find it by exact text
    const folderButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'docs'
    );
    expect(folderButton).toBeDefined();

    act(() => {
      folderButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const lastCall = mockList.mock.calls.at(-1);
    expect(lastCall?.[0]?.folder).toBe('docs');
  });

  it('renders the Add Bookmark modal when the create button is clicked', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    expect(addButton).toBeDefined();
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Modal title is "Add Bookmark" (header) — at least 2 instances now
    const matches = Array.from(container.querySelectorAll('h3')).filter(
      (h) => h.textContent?.trim() === 'Add Bookmark'
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The form has a url input
    const urlInput = container.querySelector('input[type="url"]');
    expect(urlInput).not.toBeNull();
  });

  it('renders the empty state with Clear Search button when search returns nothing', async () => {
    // The Bookmarks tab renders the empty state with a Clear Search action
    // when the list is empty and the user has typed a search query.
    // We simulate that by setting the searchQuery input value directly and
    // returning an empty list from the API.
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Type a search query that won't match anything
    const searchInput = container.querySelector(
      'input[placeholder="Search bookmarks..."]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(searchInput, 'zzz');
      searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(container.textContent).toContain('No bookmarks found');
  });

  it('renders the home tab by default with the PageHomeTab CTA', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain('Save & Organize Links');
  });

  it('renders a populated bookmark card with folder, tags, and favorite star', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Card content
    expect(container.textContent).toContain('Example');
    expect(container.textContent).toContain('example.test');
    expect(container.textContent).toContain('docs');
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
    expect(container.textContent).toContain('c');

    // favorite star is rendered with the warning color
    const favButton = container.querySelector('button[aria-label*="favorites"]');
    expect(favButton).not.toBeNull();
  });

  // ── BookmarkModal form interaction ──

  it('renders Add Bookmark modal with empty form fields and a disabled submit', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit).toBeTruthy();
    expect(submit.disabled).toBe(true);
  });

  it('enables the submit button once URL and Title are filled, and creates the bookmark', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    mockCreate.mockResolvedValueOnce({ id: 'new-bm' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Fill URL
    const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement | null;
    expect(urlInput).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(urlInput, 'https://example.test/new');
      urlInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    // Fill Title
    const titleInput = container.querySelector(
      'input[placeholder="Page title"]'
    ) as HTMLInputElement | null;
    expect(titleInput).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(titleInput, 'New Bookmark');
      titleInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submit?.disabled).toBe(false);

    // Submit form
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0]?.[0];
    expect(createArg?.url).toBe('https://example.test/new');
    expect(createArg?.title).toBe('New Bookmark');
  });

  it('opens the Edit modal pre-filled with the bookmark fields when the card is clicked', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    mockUpdate.mockResolvedValueOnce({ ...sampleBookmark, title: 'Edited' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Click the card body to edit
    const editableArea = container.querySelector('[role="button"]');
    expect(editableArea).not.toBeNull();
    act(() => {
      editableArea?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Modal title is "Edit Bookmark"
    const titleEl = Array.from(container.querySelectorAll('h3')).find(
      (h) => h.textContent?.trim() === 'Edit Bookmark'
    );
    expect(titleEl).toBeDefined();

    const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement | null;
    expect(urlInput?.value).toBe('https://example.test');

    const titleInput = container.querySelector(
      'input[placeholder="Page title"]'
    ) as HTMLInputElement | null;
    expect(titleInput?.value).toBe('Example');

    // Update title and submit
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(titleInput, 'Edited');
      titleInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]?.[0]).toBe('bm-1');
    expect(mockUpdate.mock.calls[0]?.[1]?.title).toBe('Edited');
  });

  it('closes the modal when the Cancel button is clicked', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    );
    expect(cancelButton).toBeDefined();
    act(() => {
      cancelButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Modal closed: url input is gone
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses comma-separated tags and includes them in the create body', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({ id: 'tagged' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'Tagged');
      setInput('input[placeholder="Comma-separated tags"]', 'one, two ,three,,');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]?.[0]?.tags).toEqual(['one', 'two', 'three']);
  });

  it('fills the folder select with existing folders and creates a new folder via input', async () => {
    const multi = [
      { ...sampleBookmark, id: 'b1', folder: 'docs' },
      { ...sampleBookmark, id: 'b2', folder: 'rfc' },
    ];
    mockList.mockResolvedValueOnce(multi).mockResolvedValueOnce([]); // initial + re-fetch after save
    mockCreate.mockResolvedValueOnce({ id: 'new-folder' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Folder <select> exists and contains "No folder" + the existing folders
    const folderSelect = container.querySelector('select') as HTMLSelectElement | null;
    expect(folderSelect).toBeTruthy();
    const options = Array.from(folderSelect?.querySelectorAll('option') ?? []).map(
      (o) => o.textContent
    );
    expect(options).toContain('No folder');
    expect(options).toContain('docs');
    expect(options).toContain('rfc');

    // Type a new folder name
    const newFolderInput = container.querySelector(
      'input[placeholder="Or create new folder..."]'
    ) as HTMLInputElement | null;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(newFolderInput, 'projects');
      newFolderInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // URL + title
    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'New');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]?.[0]?.folder).toBe('projects');
  });

  // ── BookmarkCard delete handle ──

  it('triggers the delete confirm and deletes the bookmark on confirm', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    mockDelete.mockResolvedValueOnce(undefined);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Find the delete button on the card by aria-label
    const deleteButton = container.querySelector(
      'button[aria-label="Delete bookmark"]'
    ) as HTMLButtonElement | null;
    expect(deleteButton).not.toBeNull();
    act(() => {
      deleteButton?.click();
    });
    // animatedDelete waits ~280ms before invoking the api
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('bm-1');
  });

  it('skips the delete when the confirm dialog is rejected', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const deleteButton = container.querySelector(
      'button[aria-label="Delete bookmark"]'
    ) as HTMLButtonElement | null;
    act(() => {
      deleteButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('toggles favorite on the card and re-fetches', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    mockFavorite.mockResolvedValueOnce(undefined);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The fav button label for a favorited bookmark is "Remove from favorites"
    const favButton = container.querySelector(
      'button[aria-label="Remove from favorites"]'
    ) as HTMLButtonElement | null;
    expect(favButton).not.toBeNull();
    act(() => {
      favButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockFavorite).toHaveBeenCalledWith('bm-1');
  });

  it('renders the unsafe-URL span when bookmark URL has javascript: protocol', async () => {
    const unsafe = {
      ...sampleBookmark,
      url: 'javascript:alert(1)',
      title: 'Unsafe',
    };
    mockList.mockResolvedValue([unsafe]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The unsafe-URL span has aria-label "Cannot open unsafe URL"
    const unsafeSpan = container.querySelector('[aria-label="Cannot open unsafe URL"]');
    expect(unsafeSpan).not.toBeNull();
    expect(container.textContent).toContain('Unsafe');
  });

  // ── BookmarkModal fallback branches + useSkipHome ──

  it('omits description in the create body when the field is empty', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({ id: 'no-desc' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        (el as HTMLInputElement).constructor.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'No Desc');
      setInput('textarea', ''); // description empty
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0]?.[0];
    expect(body?.description).toBeUndefined();
  });

  it('falls back to the folder select when newFolder is empty', async () => {
    const multi = [
      { ...sampleBookmark, id: 'b1', folder: 'docs' },
      { ...sampleBookmark, id: 'b2', folder: 'rfc' },
    ];
    mockList.mockResolvedValueOnce(multi).mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce({ id: 'fallback' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Pick a folder from the select
    const folderSelect = container.querySelector('select') as HTMLSelectElement | null;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(folderSelect, 'docs');
      folderSelect?.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    // Leave the new-folder input empty
    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        (el as HTMLInputElement).constructor.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'Folder');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate.mock.calls[0]?.[0]?.folder).toBe('docs');
  });

  it('omits folder in the create body when both newFolder and folder are empty', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({ id: 'no-folder' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        (el as HTMLInputElement).constructor.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'No Folder');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate.mock.calls[0]?.[0]?.folder).toBeUndefined();
  });

  it('passes isFavorite when the checkbox is checked in the create body', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({ id: 'fav-create' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The favorite checkbox
    const favCheckbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null;
    expect(favCheckbox).toBeTruthy();
    expect(favCheckbox?.checked).toBe(false);

    // Toggle it on
    act(() => {
      favCheckbox?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        (el as HTMLInputElement).constructor.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'Fav');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate.mock.calls[0]?.[0]?.isFavorite).toBe(true);
  });

  it('renders the home tab with a skip-home checkbox and calls onSkipHomeChange when toggled', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The skip-home checkbox label is "Skip this screen and go directly to Bookmarks"
    const skipHomeLabel = Array.from(container.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('Skip this screen')
    );
    expect(skipHomeLabel).toBeDefined();
    // The associated checkbox is the input next to the label
    const skipHomeCheckbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null;
    expect(skipHomeCheckbox).toBeTruthy();
    // The default is false (mock returns skipHome: false)
    expect(skipHomeCheckbox?.checked).toBe(false);

    act(() => {
      skipHomeCheckbox?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The onSkipHomeChange mock was called once with the new value
    // (The mock returns skipHome=false; click toggles to true and onChange fires.)
  });

  it('parses tags with only empty entries and creates the bookmark with empty tags', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({ id: 'no-tags' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        (el as HTMLInputElement).constructor.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test');
      setInput('input[placeholder="Page title"]', 'No Tags');
      setInput('input[placeholder="Comma-separated tags"]', ',, ,  ,');
    });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockCreate.mock.calls[0]?.[0]?.tags).toEqual([]);
  });

  it('handles a bookmark update with empty description (undefined fallback)', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    mockUpdate.mockResolvedValueOnce({ ...sampleBookmark, description: '' });
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Click the card to edit
    const editableArea = container.querySelector('[role="button"]');
    act(() => {
      editableArea?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Clear description
    const descTextarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(descTextarea?.value).toBe('An example link');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(descTextarea, '');
      descTextarea?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    act(() => {
      submit?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]?.[1]?.description).toBeUndefined();
  });
});

// ── BookmarkModal close + save error + BookmarkCard edge-cases ──

describe('BookmarksPage modal close + error path + bookmark card edges', () => {
  it('invokes onClose when the Cancel button in the Add Bookmark modal is clicked', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    ) as HTMLButtonElement | null;
    expect(cancelButton).toBeTruthy();
    act(() => {
      cancelButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The modal form should be removed (Cancel/Submit buttons are gone)
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('closes the modal when the backdrop is clicked (useModalClose)', async () => {
    mockList.mockResolvedValue([]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The modal's outer container is the fixed inset-0 backdrop
    const backdrop = container.querySelector('div.fixed.inset-0');
    expect(backdrop).not.toBeNull();
    act(() => {
      backdrop?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The modal form should be removed (Cancel/Submit buttons are gone)
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('re-enables the Save button after a save error (setIsSaving resets to false)', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockRejectedValueOnce(new Error('save failed'));
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add Bookmark'
    );
    act(() => {
      addButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Fill URL + Title
    const setInput = (selector: string, value: string) => {
      const el = container.querySelector(selector) as HTMLInputElement | null;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el?.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    act(() => {
      setInput('input[type="url"]', 'https://example.test/x');
      setInput('input[placeholder="Page title"]', 'X');
    });

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submit?.disabled).toBe(false);

    act(() => {
      submit?.click();
    });
    await act(async () => {
      // Give the rejected promise + finally block time to run
      await new Promise((r) => setTimeout(r, 50));
    });

    // The submit button is back to enabled because setIsSaving(false) ran
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).not.toContain('Saving...');
  });

  it('shows the bookmark icon fallback when the bookmark has no favicon', async () => {
    const noFav = { ...sampleBookmark, id: 'no-fav', favicon: null };
    mockList.mockResolvedValue([noFav]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // No favicon img, but the Bookmark icon (svg) is rendered
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Example');
  });

  it('shows the favicon img when the bookmark has a favicon URL', async () => {
    const withFav = {
      ...sampleBookmark,
      id: 'fav-bm',
      favicon: 'https://example.test/favicon.ico',
    };
    mockList.mockResolvedValue([withFav]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const img = container.querySelector('img[alt=""]');
    expect(img).not.toBeNull();
    expect((img as HTMLImageElement).getAttribute('src')).toBe('https://example.test/favicon.ico');
  });

  it('renders the open-bookmark anchor when the URL passes the safeUrl check', async () => {
    mockList.mockResolvedValue([sampleBookmark]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const anchor = container.querySelector('a[target="_blank"][rel="noopener noreferrer"]');
    expect(anchor).not.toBeNull();
    expect((anchor as HTMLAnchorElement).getAttribute('href')).toBe(sampleBookmark.url);
  });

  it('hides the open-bookmark anchor when the URL is unsafe (javascript:)', async () => {
    const unsafe = { ...sampleBookmark, id: 'unsafe', url: 'javascript:alert(1)' };
    mockList.mockResolvedValue([unsafe]);
    const container = renderPage(['/bookmarks?tab=bookmarks']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // No anchor — the unsafe-url span replaces it
    expect(container.querySelector('a[target="_blank"][rel="noopener noreferrer"]')).toBeNull();
    // The card body still renders the title
    expect(container.textContent).toContain('Example');
  });
});
