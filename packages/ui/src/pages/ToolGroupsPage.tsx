import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { settingsApi } from '../api';
import type { ToolGroupInfo } from '../api';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Wrench,
  Layers,
  Shield,
  Bot,
  Settings,
  Home,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';

// =============================================================================
// Tool Group Card
// =============================================================================

function ToolGroupCard({
  group,
  onToggle,
}: {
  group: ToolGroupInfo;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border ${group.enabled ? 'border-border bg-card' : 'border-border/50 bg-card/50 opacity-75'}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Group info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary">{group.name}</span>
            <span className="text-xs text-text-muted">({group.toolCount} tools)</span>
            {group.alwaysOn && (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <Lock className="w-3 h-3" />
                Always on
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">{group.description}</p>
        </div>

        {/* Toggle */}
        <button
          onClick={() => onToggle(group.id, !group.enabled)}
          disabled={group.alwaysOn}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            group.alwaysOn
              ? 'cursor-not-allowed bg-primary/60'
              : group.enabled
                ? 'cursor-pointer bg-primary'
                : 'cursor-pointer bg-border'
          }`}
          aria-label={`${group.enabled ? 'Disable' : 'Enable'} ${group.name}`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              group.enabled ? 'translate-x-4' : 'translate-x-0.5'
            } mt-0.5`}
          />
        </button>
      </div>

      {/* Expanded tool list */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-border/50">
          <div className="flex flex-wrap gap-1.5 mt-2">
            {group.tools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-bg-secondary text-text-muted font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function ToolGroupsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  type TabId = 'home' | 'groups';
  const TAB_LABELS: Record<TabId, string> = { home: 'Home', groups: 'Groups' };

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'groups'] as string[]).includes(tabParam) ? tabParam : 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:toolgroups:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  // Auto-redirect to groups if skipHome is enabled and no explicit tab param
  useEffect(() => {
    if (skipHome && !tabParam) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'groups');
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [skipHome, tabParam, searchParams, navigate]);

  const [groups, setGroups] = useState<ToolGroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getToolGroups();
      setGroups(data.groups);
      setDirty(false);
    } catch (err) {
      toast.error('Failed to load tool groups');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, enabled } : g)));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const enabledIds = groups.filter((g) => g.enabled).map((g) => g.id);
      await settingsApi.saveToolGroups(enabledIds);
      setDirty(false);
      toast.success('Tool groups saved');
    } catch (err) {
      toast.error('Failed to save tool groups');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [groups, toast]);

  const handleReset = useCallback(() => {
    setGroups((prev) => prev.map((g) => ({ ...g, enabled: g.defaultEnabled || g.alwaysOn })));
    setDirty(true);
  }, []);

  const enabledCount = groups.filter((g) => g.enabled).length;
  const totalTools = groups.filter((g) => g.enabled).reduce((sum, g) => sum + g.toolCount, 0);

  // Separate always-on and toggleable
  const alwaysOnGroups = groups.filter((g) => g.alwaysOn);
  const toggleableGroups = groups.filter((g) => !g.alwaysOn);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Tool Groups
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {enabledCount} groups enabled ({totalTools} tools available)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
          >
            Reset defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              dirty
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-border text-text-muted cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'groups'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Layers, color: 'text-primary bg-primary/10' },
            { icon: Wrench, color: 'text-emerald-500 bg-emerald-500/10' },
            { icon: Shield, color: 'text-violet-500 bg-violet-500/10' },
          ]}
          title="Organize Tools into Groups"
          subtitle="Group related tools together for better organization — assign groups to agents or use them to control tool access."
          cta={{
            label: 'Manage Groups',
            icon: Layers,
            onClick: () => setTab('groups'),
          }}
          skipHomeChecked={skipHome}
          onSkipHomeChange={handleSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Groups"
          features={[
            {
              icon: Layers,
              color: 'text-primary bg-primary/10',
              title: 'Logical Grouping',
              description: 'Organize tools into meaningful categories for clarity.',
            },
            {
              icon: Bot,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Agent Assignment',
              description: 'Assign tool groups to specific agents for focused capabilities.',
            },
            {
              icon: Lock,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Access Control',
              description: 'Enable or disable entire groups to control what tools are available.',
            },
            {
              icon: Settings,
              color: 'text-amber-500 bg-amber-500/10',
              title: 'Bulk Management',
              description: 'Toggle, reset, and save group configurations in bulk.',
            },
          ]}
          steps={[
            { title: 'Create a group', detail: 'Groups are auto-detected from tool categories.' },
            {
              title: 'Add tools to the group',
              detail: 'Each group contains related tools automatically.',
            },
            {
              title: 'Assign to agents',
              detail: 'Control which agents have access to which groups.',
            },
            {
              title: 'Control access',
              detail: 'Enable or disable groups to manage available tools.',
            },
          ]}
        />
      )}

      {activeTab === 'groups' && (
        <>
          <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {/* Always-on groups */}
                {alwaysOnGroups.length > 0 && (
                  <div>
                    <h2 className="text-sm font-medium text-text-muted mb-2 uppercase tracking-wide">
                      Always Enabled
                    </h2>
                    <div className="space-y-2">
                      {alwaysOnGroups.map((group) => (
                        <ToolGroupCard key={group.id} group={group} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Toggleable groups */}
                {toggleableGroups.length > 0 && (
                  <div>
                    <h2 className="text-sm font-medium text-text-muted mb-2 uppercase tracking-wide">
                      Optional
                    </h2>
                    <div className="space-y-2">
                      {toggleableGroups.map((group) => (
                        <ToolGroupCard key={group.id} group={group} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                )}

                {dirty && (
                  <p className="text-xs text-warning mt-4">
                    You have unsaved changes. Click Save to apply.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
