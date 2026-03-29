import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, GitBranch, MessageSquare } from './icons';
import { ALL_NAV_ITEMS, type NavItem } from '../constants/nav-items';
import { NAV_DESCRIPTIONS } from '../constants/nav-descriptions';
import { workflowsApi } from '../api/endpoints/workflows';
import { chatApi } from '../api/endpoints/chat';
import type { Workflow } from '../api/endpoints/workflows';
import type { Conversation } from '../api/types/channels';

interface Props {
  onClose: () => void;
}

interface SearchResults {
  pages: NavItem[];
  workflows: Workflow[];
  conversations: Conversation[];
}

export function GlobalSearchOverlay({ onClose }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({ pages: [], workflows: [], conversations: [] });
  const [cachedWorkflows, setCachedWorkflows] = useState<Workflow[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch workflows once on mount
  useEffect(() => {
    workflowsApi.list({ limit: '100' }).then((res) => {
      setCachedWorkflows(res.workflows ?? []);
    }).catch(() => {
      // silently ignore — workflows just won't appear in search
    });
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search logic
  const performSearch = useCallback((q: string) => {
    const lower = q.trim().toLowerCase();
    if (!lower) {
      setResults({ pages: [], workflows: [], conversations: [] });
      return;
    }

    // Pages: filter by label + description
    const pages = ALL_NAV_ITEMS.filter((item) => {
      const desc = NAV_DESCRIPTIONS[item.to] ?? '';
      return item.label.toLowerCase().includes(lower) || desc.toLowerCase().includes(lower);
    }).slice(0, 8);

    // Workflows: filter cached
    const workflows = cachedWorkflows.filter((w) =>
      w.name.toLowerCase().includes(lower) ||
      (w.description ?? '').toLowerCase().includes(lower)
    ).slice(0, 5);

    setResults((prev) => ({ ...prev, pages, workflows }));

    // Conversations: debounced API call
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      chatApi.listHistory({ search: q.trim(), limit: 5 }).then((res) => {
        setResults((prev) => ({ ...prev, conversations: res.conversations ?? [] }));
      }).catch(() => {
        // silently ignore
      });
    }, 300);
  }, [cachedWorkflows]);

  useEffect(() => {
    performSearch(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch]);

  const handleSelect = (path: string) => {
    onClose();
    navigate(path);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  const trimmed = query.trim();
  const hasResults = results.pages.length > 0 || results.workflows.length > 0 || results.conversations.length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-20"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div className="w-full max-w-[580px] max-h-[500px] mx-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border shadow-2xl flex flex-col overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border dark:border-dark-border">
          <Search className="w-5 h-5 text-text-secondary dark:text-dark-text-secondary opacity-50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, workflows, conversations..."
            className="flex-1 bg-transparent border-none outline-none text-base text-text-primary dark:text-dark-text-primary placeholder:text-text-secondary/50 dark:placeholder:text-dark-text-secondary/50"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary font-mono shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto p-2">
          {!trimmed && (
            <p className="py-6 text-center text-sm text-text-secondary dark:text-dark-text-secondary">
              Start typing to search...
            </p>
          )}

          {trimmed && !hasResults && (
            <p className="py-6 text-center text-sm text-text-secondary dark:text-dark-text-secondary">
              No results for &ldquo;{trimmed}&rdquo;
            </p>
          )}

          {/* Pages */}
          {results.pages.length > 0 && (
            <ResultGroup label="Pages">
              {results.pages.map((item) => (
                <ResultItem
                  key={item.to}
                  icon={<item.icon className="w-4 h-4" />}
                  label={item.label}
                  hint={item.to}
                  onClick={() => handleSelect(item.to)}
                />
              ))}
            </ResultGroup>
          )}

          {/* Workflows */}
          {results.workflows.length > 0 && (
            <ResultGroup label="Workflows">
              {results.workflows.map((wf) => (
                <ResultItem
                  key={wf.id}
                  icon={<GitBranch className="w-4 h-4" />}
                  label={wf.name}
                  hint={`/workflows`}
                  onClick={() => handleSelect(`/workflows?id=${wf.id}`)}
                />
              ))}
            </ResultGroup>
          )}

          {/* Conversations */}
          {results.conversations.length > 0 && (
            <ResultGroup label="Conversations">
              {results.conversations.map((conv) => (
                <ResultItem
                  key={conv.id}
                  icon={<MessageSquare className="w-4 h-4" />}
                  label={conv.title || 'Untitled conversation'}
                  hint={new Date(conv.updatedAt).toLocaleDateString()}
                  onClick={() => handleSelect(`/history/${conv.id}`)}
                />
              ))}
            </ResultGroup>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2.5 py-1.5 text-sm font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-base text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:text-text-primary dark:hover:text-dark-text-primary cursor-pointer transition-colors text-left"
    >
      <span className="w-5 text-center shrink-0 opacity-70">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[10px] text-text-secondary/50 dark:text-dark-text-secondary/50 font-mono shrink-0">
        {hint}
      </span>
    </button>
  );
}
