/**
 * ArtifactsPage
 *
 * Management page for AI-generated artifacts with filter tabs,
 * grid layout, and WS-driven refresh.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArtifactCard } from '../components/ArtifactCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import {
  LayoutTemplate,
  Code2,
  PenTool,
  FileText,
  FormInput,
  BarChart3,
  Pin,
  Search,
  RefreshCw,
  Image,
  Layers,
  Eye,
  Download,
  Home,
} from '../components/icons';
import { artifactsApi } from '../api/endpoints/artifacts';
import type { Artifact, ArtifactType } from '../api/endpoints/artifacts';
import { useGateway } from '../hooks/useWebSocket';
import { PageHomeTab } from '../components/PageHomeTab';

// =============================================================================
// Filter tabs
// =============================================================================

interface FilterTab {
  key: string;
  label: string;
  icon: typeof Code2;
  filter: { type?: ArtifactType; pinned?: boolean };
}

const FILTER_TABS: FilterTab[] = [
  { key: 'all', label: 'All', icon: LayoutTemplate, filter: {} },
  { key: 'html', label: 'HTML', icon: Code2, filter: { type: 'html' } },
  { key: 'svg', label: 'SVG', icon: PenTool, filter: { type: 'svg' } },
  { key: 'markdown', label: 'Markdown', icon: FileText, filter: { type: 'markdown' } },
  { key: 'form', label: 'Form', icon: FormInput, filter: { type: 'form' } },
  { key: 'chart', label: 'Chart', icon: BarChart3, filter: { type: 'chart' } },
  { key: 'pinned', label: 'Pinned', icon: Pin, filter: { pinned: true } },
];

// =============================================================================
// Component
// =============================================================================

export function ArtifactsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { subscribe } = useGateway();

  type PageTabId = 'home' | 'artifacts';
  const PAGE_TAB_LABELS: Record<PageTabId, string> = { home: 'Home', artifacts: 'Artifacts' };

  const pageTabParam = searchParams.get('tab') as PageTabId | null;
  const activePageTab: PageTabId =
    pageTabParam && (['home', 'artifacts'] as string[]).includes(pageTabParam)
      ? pageTabParam
      : 'home';
  const setPageTab = (tab: PageTabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchArtifacts = useCallback(async () => {
    const filter = FILTER_TABS.find((t) => t.key === activeTab)?.filter ?? {};
    try {
      const data = await artifactsApi.list({
        ...filter,
        search: searchQuery || undefined,
        limit: 50,
      });
      setArtifacts(data?.artifacts ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    setIsLoading(true);
    fetchArtifacts();
  }, [fetchArtifacts]);

  // WS-driven refresh
  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (payload) => {
      if (payload.entity === 'artifact') {
        fetchArtifacts();
      }
    });
    return () => {
      unsub();
    };
  }, [subscribe, fetchArtifacts]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleDelete = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const handleUpdate = useCallback((updated: Artifact) => {
    setArtifacts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Artifacts
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            AI-generated interactive content ({total} total)
          </p>
        </div>
        <button
          onClick={() => {
            setIsLoading(true);
            fetchArtifacts();
          }}
          className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-text-muted" />
        </button>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'artifacts'] as PageTabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setPageTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activePageTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {PAGE_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activePageTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Code2, color: 'text-primary bg-primary/10' },
            { icon: Image, color: 'text-violet-500 bg-violet-500/10' },
            { icon: FileText, color: 'text-emerald-500 bg-emerald-500/10' },
          ]}
          title="AI-Generated Artifacts"
          subtitle="Browse and manage code snippets, visualizations, forms, and other artifacts created during AI conversations."
          cta={{
            label: 'Browse Artifacts',
            icon: Code2,
            onClick: () => setPageTab('artifacts'),
          }}
          features={[
            {
              icon: Layers,
              color: 'text-primary bg-primary/10',
              title: 'Multiple Formats',
              description: 'HTML, SVG, Markdown, forms, charts, and more artifact types.',
            },
            {
              icon: Pin,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Pin Favorites',
              description: 'Pin your most useful artifacts for quick access later.',
            },
            {
              icon: Eye,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Live Preview',
              description: 'Preview HTML, SVG, and chart artifacts right in the browser.',
            },
            {
              icon: Download,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Export & Share',
              description: 'Download artifacts or copy their content for use elsewhere.',
            },
          ]}
          steps={[
            { title: 'Chat with your AI', detail: 'Ask it to create charts, forms, or visual content.' },
            { title: 'AI generates artifacts', detail: 'Interactive content appears alongside the conversation.' },
            { title: 'Browse & pin favorites', detail: 'Find all artifacts here and pin the best ones.' },
            { title: 'Export or reuse', detail: 'Download, copy, or reference artifacts in future chats.' },
          ]}
        />
      )}

      {activePageTab === 'artifacts' && (
        <>
          {/* Filter tabs + search */}
          <div className="px-6 py-3 border-b border-border dark:border-dark-border flex flex-wrap items-center gap-3">
            <div className="flex gap-1 flex-wrap">
              {FILTER_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-primary text-white'
                        : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="relative ml-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Search artifacts..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary w-48 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                <SkeletonCard count={6} />
              </div>
            ) : artifacts.length === 0 ? (
              <EmptyState
                icon={LayoutTemplate}
                title="No artifacts yet"
                description={
                  searchQuery
                    ? 'No artifacts match your search'
                    : 'Ask the AI to create charts, dashboards, forms, or visual content'
                }
              />
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {artifacts.map((artifact) => (
                  <ArtifactCard
                    key={artifact.id}
                    artifact={artifact}
                    onDelete={handleDelete}
                    onUpdate={handleUpdate}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
