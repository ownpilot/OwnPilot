import { lazy, Suspense, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { BookOpen } from '../../components/icons';

const InstalledTab = lazy(() =>
  import('./InstalledTab').then((m) => ({ default: m.InstalledTab }))
);
const DiscoverTab = lazy(() => import('./DiscoverTab').then((m) => ({ default: m.DiscoverTab })));
const CreateTab = lazy(() => import('./CreateTab').then((m) => ({ default: m.CreateTab })));

type TabId = 'installed' | 'discover' | 'create';

const TAB_DESCRIPTIONS: Record<TabId, string> = {
  installed: 'Manage your installed skills and extensions',
  discover: 'Browse the npm registry for AgentSkills.io packages',
  create: 'Build a new skill with the guided wizard',
};

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function SkillsHubPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [installedCount, setInstalledCount] = useState<number | null>(null);

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && ['installed', 'discover', 'create'].includes(tabParam) ? tabParam : 'installed';

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    // Clear format filter when switching away from installed
    if (tab !== 'installed') params.delete('format');
    navigate({ search: params.toString() }, { replace: true });
  };

  const formatParam = searchParams.get('format') ?? undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Skills Hub
            </h2>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              {TAB_DESCRIPTIONS[activeTab]}
            </p>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['installed', 'discover', 'create'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'installed' && installedCount !== null && installedCount > 0 && (
              <span
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none ${
                  activeTab === 'installed'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
                }`}
              >
                {installedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<TabLoader />}>
          {activeTab === 'installed' && (
            <InstalledTab initialFormat={formatParam} onCountChange={setInstalledCount} />
          )}
          {activeTab === 'discover' && <DiscoverTab />}
          {activeTab === 'create' && <CreateTab />}
        </Suspense>
      </div>
    </div>
  );
}
