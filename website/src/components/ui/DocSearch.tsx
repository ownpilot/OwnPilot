/**
 * DocSearch — Client-side fuzzy search for documentation pages.
 * Uses Fuse.js to search the pre-built SEARCH_INDEX by title, description, and keywords.
 *
 * Triggered by Ctrl+K or clicking the search button in the header.
 * Inspired by the UI package's GlobalSearchOverlay pattern.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';
import Fuse from 'fuse.js';
import { Search, X } from 'lucide-react';
import { SEARCH_INDEX, type SearchEntry } from '@/lib/search-index';

interface DocSearchProps {
  onClose: () => void;
}

const SECTION_ICONS: Record<string, string> = {
  'Getting Started': '🚀',
  'Core Concepts': '🧠',
  Automation: '⚡',
  Operations: '🔧',
};

export function DocSearch({ onClose }: DocSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fuse = useMemo(
    () =>
      new Fuse(SEARCH_INDEX, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'description', weight: 1.5 },
          { name: 'keywords', weight: 2 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    []
  );

  const results = useMemo(() => {
    if (!query.trim()) return SEARCH_INDEX;
    return fuse.search(query.trim()).map((r) => r.item);
  }, [query, fuse]);

  // Focus input, close on Escape
  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        navigate(results[selectedIndex]!.path);
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, selectedIndex, navigate, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-lg mx-4 bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-text-subtle)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search documentation..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2 space-y-0.5">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((entry, i) => (
              <button
                key={entry.path}
                onClick={() => {
                  navigate(entry.path);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  i === selectedIndex
                    ? 'bg-[var(--color-accent-light)]'
                    : 'hover:bg-[var(--color-bg-subtle)]'
                }`}
              >
                <span className="text-base shrink-0 mt-0.5">
                  {SECTION_ICONS[entry.section] ?? '📄'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {entry.title}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] line-clamp-2 mt-0.5">
                    {entry.description}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-[var(--color-text-subtle)] uppercase tracking-wider">
                      {entry.section}
                    </span>
                    {entry.path !== '/docs/introduction' && (
                      <span className="text-[10px] text-[hsl(var(--primary))] font-mono">
                        {entry.path}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-subtle)] flex items-center justify-between">
          <span>{results.length} page{results.length !== 1 ? 's' : ''}</span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border)] font-mono">
              ↑↓
            </kbd>{' '}
            navigate{' '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border)] font-mono">
              ↵
            </kbd>{' '}
            open{' '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border)] font-mono">
              Esc
            </kbd>{' '}
            close
          </span>
        </div>
      </div>
    </div>
  );
}
