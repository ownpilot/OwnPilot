/**
 * Fleet Page — Manage coordinated multi-worker agent fleets
 *
 * Follows the app's page convention: header → tab bar → PageHomeTab / content.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { PageHomeTab } from '../components/PageHomeTab';
import { fleetApi } from '../api/endpoints/fleet';
import type { FleetConfig } from '../api/endpoints/fleet';
import {
  Plus,
  RefreshCw,
  Search,
  Bot,
  Terminal,
  Globe,
  Activity,
  Users,
  AlertCircle,
  Layers,
  Home,
  Zap,
  Brain,
  DollarSign,
} from '../components/icons';
import { CreateFleetModal } from './fleet/CreateFleetModal';
import { AddTasksModal } from './fleet/AddTasksModal';
import { BroadcastModal } from './fleet/BroadcastModal';
import { FleetDetailPanel } from './fleet/FleetDetailPanel';
import { FleetCard } from './fleet/FleetCard';

// =============================================================================
// Stats strip component
// =============================================================================

function FleetStatsStrip() {
  const [stats, setStats] = useState<{
    totalFleets: number; running: number; totalWorkers: number;
    successRate: number; avgCost: number; totalCost: number;
    tasksCompleted: number; activeWorkers: number;
  } | null>(null);
  const [health, setHealth] = useState<{
    status: string; score: number;
  } | null>(null);

  useEffect(() => {
    fleetApi.stats().then(setStats).catch(() => {});
    fleetApi.health().then(setHealth).catch(() => {});
  }, []);

  if (!stats && !health) return null;

  return (
    <div className="flex items-center gap-4 px-6 py-2 border-b border-border dark:border-dark-border bg-bg-tertiary/50">
      {stats && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Layers className="w-3.5 h-3.5" />
            <span>{stats.totalFleets} fleets</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Bot className="w-3.5 h-3.5" />
            <span>{stats.activeWorkers} active workers</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Activity className="w-3.5 h-3.5" />
            <span>{stats.tasksCompleted} tasks done</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className="text-success">{Math.round(stats.successRate * 100)}% success</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <DollarSign className="w-3.5 h-3.5" />
            <span>${stats.totalCost.toFixed(4)}</span>
          </div>
        </>
      )}
      {health && (
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
          health.status === 'healthy' ? 'bg-success/20 text-success' :
          health.status === 'watch' ? 'bg-yellow-500/20 text-yellow-500' :
          'bg-error/20 text-error'
        }`}>
          {health.status} ({health.score})
        </span>
      )}
    </div>
  );
}

type TabId = 'home' | 'fleets';

const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  fleets: 'Fleets',
};

export function FleetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useDialog();

  const SKIP_HOME_KEY = 'ownpilot:fleet:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'fleets'] as string[]).includes(tabParam) ? tabParam : 'home';

  // Only redirect on first mount — user can still click Home tab manually
  const didSkipHomeRef = useRef(false);
  useEffect(() => {
    if (skipHome && !tabParam && !didSkipHomeRef.current) {
      didSkipHomeRef.current = true;
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'fleets');
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [skipHome, tabParam, searchParams, navigate]);

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const [fleets, setFleets] = useState<FleetConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedFleet, setSelectedFleet] = useState<FleetConfig | null>(null);
  const [addTasksFleet, setAddTasksFleet] = useState<FleetConfig | null>(null);
  const [broadcastFleet, setBroadcastFleet] = useState<FleetConfig | null>(null);

  const loadFleets = useCallback(async () => {
    try {
      const result = await fleetApi.list();
      setFleets(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fleets');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFleets();
  }, [loadFleets]);

  const { subscribe } = useGateway();
  useEffect(() => {
    const unsubs = [
      subscribe('fleet:cycle:end', loadFleets),
      subscribe('fleet:started', loadFleets),
      subscribe('fleet:stopped', loadFleets),
      subscribe('fleet:paused', loadFleets),
      subscribe('fleet:resumed', loadFleets),
      subscribe('fleet:worker:completed', loadFleets),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, loadFleets]);

  useEffect(() => {
    const hasRunning = fleets.some((f) => f.session?.state === 'running');
    if (!hasRunning) return;
    const timer = setInterval(loadFleets, 10_000);
    return () => clearInterval(timer);
  }, [fleets, loadFleets]);

  const handleAction = async (action: string, fleet: FleetConfig) => {
    try {
      switch (action) {
        case 'start':
          await fleetApi.start(fleet.id);
          toast.success(`Fleet "${fleet.name}" started`);
          break;
        case 'pause':
          await fleetApi.pause(fleet.id);
          toast.success(`Fleet "${fleet.name}" paused`);
          break;
        case 'resume':
          await fleetApi.resume(fleet.id);
          toast.success(`Fleet "${fleet.name}" resumed`);
          break;
        case 'stop':
          await fleetApi.stop(fleet.id);
          toast.success(`Fleet "${fleet.name}" stopped`);
          break;
        case 'addTasks':
          setAddTasksFleet(fleet);
          return;
        case 'broadcast':
          setBroadcastFleet(fleet);
          return;
        case 'delete': {
          const ok = await confirm({
            title: 'Delete Fleet',
            message: `Delete "${fleet.name}" and all its tasks? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
          });
          if (!ok) return;
          await fleetApi.delete(fleet.id);
          toast.success(`Fleet "${fleet.name}" deleted`);
          if (selectedFleet?.id === fleet.id) setSelectedFleet(null);
          break;
        }
      }
      loadFleets();
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const filteredFleets = searchQuery
    ? fleets.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.mission.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : fleets;

  const runningCount = fleets.filter((f) => f.session?.state === 'running').length;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Fleet Command
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {fleets.length} fleet{fleets.length !== 1 ? 's' : ''} configured
            {runningCount > 0 && ` · ${runningCount} running`}
          </p>
        </div>
        <button
          onClick={() => {
            setTab('fleets');
            setShowCreate(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Fleet
        </button>
      </header>

      <FleetStatsStrip />

      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'fleets'] as TabId[]).map((tab) => (
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
            { icon: Bot, color: 'text-violet-500 bg-violet-500/10' },
            { icon: Terminal, color: 'text-cyan-500 bg-cyan-500/10' },
          ]}
          title="Coordinated Agent Armies"
          subtitle="Deploy fleets of AI workers that run in the background — coding agents, research bots, data processors, and monitors — all coordinated from a single command center."
          cta={{
            label: 'New Fleet',
            icon: Plus,
            onClick: () => {
              setTab('fleets');
              setShowCreate(true);
            },
          }}
          features={[
            {
              icon: Users,
              color: 'text-primary bg-primary/10',
              title: '4 Worker Types',
              description:
                'AI Chat (full 250+ tools), Coding CLI (Claude Code, Codex, Gemini), API Call (lightweight), and MCP Bridge (external services).',
            },
            {
              icon: Zap,
              color: 'text-amber-500 bg-amber-500/10',
              title: '5 Schedule Modes',
              description:
                'Run on-demand, continuously, on intervals, via cron, or triggered by events.',
            },
            {
              icon: Brain,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Task Queue',
              description:
                'Add tasks to the queue with priorities. Workers pick tasks automatically and report results.',
            },
            {
              icon: Activity,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Real-Time Monitoring',
              description:
                'Track cycles, costs, task completion, and worker status with live WebSocket updates.',
            },
          ]}
          steps={[
            {
              title: 'Create a fleet',
              detail: 'Click "New Fleet" and pick a template or start from scratch.',
            },
            {
              title: 'Configure workers',
              detail:
                'Add workers with different types — AI Chat for complex reasoning, Coding CLI for code tasks, API Call for lightweight ops.',
            },
            {
              title: 'Add tasks to the queue',
              detail: 'Describe what each worker should do. Set priorities and dependencies.',
            },
            {
              title: 'Start and monitor',
              detail:
                'Hit start and watch your fleet execute tasks in parallel. Track progress in real-time.',
            },
          ]}
          quickActions={[
            {
              icon: Terminal,
              label: 'Code Review Army',
              description: 'Automated code review with AI reviewers and CLI fixers',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
            {
              icon: Globe,
              label: 'Research Squad',
              description: 'Multi-agent research team with analysis and synthesis',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
            {
              icon: Activity,
              label: 'System Monitor',
              description: 'Continuous health checks and auto-remediation',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
          ]}
          skipHomeChecked={skipHome}
          onSkipHomeChange={handleSkipHomeChange}
          skipHomeLabel="Skip this screen and go directly to Fleets"
          infoBox={{
            icon: Layers,
            title: 'Built on Top of Existing Services',
            description:
              'Fleet workers reuse the same engines as claw agents, coding agents, and MCP servers. No new infrastructure needed — just orchestration.',
            color: 'blue',
          }}
        />
      )}

      {activeTab === 'fleets' && (
        <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-dark-text-secondary">
              <Layers className="w-4 h-4" />
              <span>
                {fleets.length} fleet{fleets.length !== 1 ? 's' : ''}
              </span>
            </div>
            {runningCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-success">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                {runningCount} running
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={loadFleets}
              className="p-2 rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
            </button>
          </div>

          {fleets.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search fleets..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary text-sm"
              />
            </div>
          )}

          {isLoading ? (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-error/10 text-error">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : filteredFleets.length === 0 && searchQuery ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 mx-auto text-text-tertiary dark:text-dark-text-tertiary mb-3 opacity-40" />
              <p className="text-text-secondary dark:text-dark-text-secondary">
                No fleets match "{searchQuery}"
              </p>
            </div>
          ) : fleets.length === 0 ? (
            <div className="text-center py-12">
              <Layers className="w-10 h-10 mx-auto text-text-tertiary dark:text-dark-text-tertiary mb-3 opacity-40" />
              <p className="text-text-secondary dark:text-dark-text-secondary">
                No fleets yet. Create one to get started.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                <Plus className="w-4 h-4" /> New Fleet
              </button>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {filteredFleets.map((fleet) => (
                <FleetCard
                  key={fleet.id}
                  fleet={fleet}
                  onAction={handleAction}
                  onSelect={setSelectedFleet}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateFleetModal onClose={() => setShowCreate(false)} onCreated={loadFleets} />
      )}
      {addTasksFleet && (
        <AddTasksModal
          fleet={addTasksFleet}
          onClose={() => setAddTasksFleet(null)}
          onAdded={loadFleets}
        />
      )}
      {broadcastFleet && (
        <BroadcastModal fleet={broadcastFleet} onClose={() => setBroadcastFleet(null)} />
      )}
      {selectedFleet && (
        <FleetDetailPanel
          fleet={selectedFleet}
          onClose={() => setSelectedFleet(null)}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
