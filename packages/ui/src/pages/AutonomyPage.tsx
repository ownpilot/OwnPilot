import { useState, useEffect, useCallback, useRef } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Gauge,
  RefreshCw,
  Plus,
  Trash2,
  Heart,
  Activity,
  Power,
  Play,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  BarChart,
  Settings,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../components/ToastProvider';
import { autonomyApi, pulseApi, ApiError } from '../api';
import type {
  PendingApproval,
  AutonomyConfig,
  AutonomyLevel,
  PulseStatus,
  PulseActivity,
  PulseLogEntry,
  PulseStats,
  PulseEngineConfig,
  PulseDirectives,
  PulseRuleDefinition,
  PulseActionType,
  RuleThresholds,
  ActionCooldowns,
} from '../api';

const levelColors = ['bg-error', 'bg-warning', 'bg-warning', 'bg-success', 'bg-primary'];

const riskColors = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-warning',
  critical: 'text-error',
};

const PAGE_SIZE = 15;

const DEFAULT_THRESHOLDS: RuleThresholds = {
  staleDays: 3,
  deadlineDays: 3,
  activityDays: 2,
  lowProgressPct: 10,
  memoryMaxCount: 500,
  memoryMinImportance: 0.3,
  triggerErrorMin: 3,
};

const DEFAULT_COOLDOWNS: ActionCooldowns = {
  create_memory: 30,
  update_goal_progress: 60,
  send_notification: 15,
  run_memory_cleanup: 360,
};

const DIRECTIVE_TEMPLATES: Record<string, Omit<PulseDirectives, 'template'>> = {
  conservative: {
    disabledRules: ['memory_cleanup', 'no_activity'],
    blockedActions: ['run_memory_cleanup'],
    customInstructions:
      'Only take action on critical signals. Prefer notifications over data modifications. Be very conservative.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS, staleDays: 5, deadlineDays: 2 },
    actionCooldowns: { ...DEFAULT_COOLDOWNS, create_memory: 60, run_memory_cleanup: 720 },
  },
  balanced: {
    disabledRules: [],
    blockedActions: [],
    customInstructions: '',
    ruleThresholds: { ...DEFAULT_THRESHOLDS },
    actionCooldowns: { ...DEFAULT_COOLDOWNS },
  },
  proactive: {
    disabledRules: [],
    blockedActions: [],
    customInstructions:
      'Actively manage goals and memories. Send notifications about any progress opportunities. Create memories for patterns you notice.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS, staleDays: 2, deadlineDays: 5, lowProgressPct: 20 },
    actionCooldowns: { ...DEFAULT_COOLDOWNS, create_memory: 15, send_notification: 5 },
  },
  minimal: {
    disabledRules: ['no_activity', 'memory_cleanup', 'low_progress'],
    blockedActions: ['run_memory_cleanup', 'create_memory'],
    customInstructions:
      'Only monitor deadlines and system health. Do not create or modify data. Only send high-urgency notifications.',
    ruleThresholds: { ...DEFAULT_THRESHOLDS },
    actionCooldowns: { ...DEFAULT_COOLDOWNS },
  },
};

const THRESHOLD_LABELS: Record<string, { label: string; unit: string; min: number; max: number }> = {
  staleDays: { label: 'Stale', unit: 'days', min: 1, max: 30 },
  deadlineDays: { label: 'Deadline', unit: 'days', min: 1, max: 30 },
  activityDays: { label: 'Activity', unit: 'days', min: 1, max: 30 },
  lowProgressPct: { label: 'Progress', unit: '%', min: 1, max: 100 },
  memoryMaxCount: { label: 'Max', unit: 'count', min: 50, max: 10000 },
  memoryMinImportance: { label: 'Min', unit: 'imp', min: 0, max: 1 },
  triggerErrorMin: { label: 'Errors', unit: 'min', min: 1, max: 100 },
};


function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          {value}
        </div>
        <div className="text-xs text-text-muted dark:text-dark-text-muted">{label}</div>
      </div>
    </div>
  );
}

export function AutonomyPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const { subscribe } = useGateway();
  const [config, setConfig] = useState<AutonomyConfig | null>(null);
  const [levels, setLevels] = useState<AutonomyLevel[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newBlockedTool, setNewBlockedTool] = useState('');

  // Pulse Engine state
  const [pulseStatus, setPulseStatus] = useState<PulseStatus | null>(null);
  const [pulseStats, setPulseStats] = useState<PulseStats | null>(null);
  const [pulseHistory, setPulseHistory] = useState<PulseLogEntry[]>([]);
  const [pulseTotal, setPulseTotal] = useState(0);
  const [pulsePage, setPulsePage] = useState(0);
  const [pulseEngineLoading, setPulseEngineLoading] = useState(false);
  const [pulseRunning, setPulseRunning] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [pulseActivity, setPulseActivity] = useState<PulseActivity | null>(null);
  const pulseRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Pulse Directives state
  const [pulseDirectives, setPulseDirectives] = useState<PulseDirectives | null>(null);
  const [ruleDefinitions, setRuleDefinitions] = useState<PulseRuleDefinition[]>([]);
  const [actionTypes, setActionTypes] = useState<PulseActionType[]>([]);
  const [directivesInstructions, setDirectivesInstructions] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const { config: cfg, levels: lvls } = await autonomyApi.getConfig();
      setConfig(cfg);
      setLevels(lvls);
    } catch {
      // API client handles error reporting
    }
  }, []);

  const fetchPendingApprovals = useCallback(async () => {
    try {
      const data = await autonomyApi.getApprovals();
      setPendingApprovals(data);
    } catch {
      // API client handles error reporting
    }
  }, []);

  const fetchPulseStatus = useCallback(async () => {
    try {
      const status = await pulseApi.status();
      setPulseStatus(status);
      if (status.activePulse) {
        setPulseActivity({
          status: 'stage',
          stage: status.activePulse.stage,
          pulseId: status.activePulse.pulseId,
          startedAt: status.activePulse.startedAt,
        });
      }
    } catch {
      // Engine might not be initialized — that's ok
    }
  }, []);

  const fetchPulseStats = useCallback(async () => {
    try {
      const stats = await pulseApi.stats();
      setPulseStats(stats);
    } catch {
      // Silently fail
    }
  }, []);

  const fetchPulseHistory = useCallback(
    async (page = pulsePage) => {
      try {
        const { history, total } = await pulseApi.history({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        setPulseHistory(history);
        setPulseTotal(total);
      } catch {
        // Silently fail
      }
    },
    [pulsePage]
  );

  const fetchDirectives = useCallback(async () => {
    try {
      const data = await pulseApi.getDirectives();
      setPulseDirectives(data.directives);
      setRuleDefinitions(data.ruleDefinitions);
      setActionTypes(data.actionTypes);
      setDirectivesInstructions(data.directives.customInstructions);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchConfig(),
      fetchPendingApprovals(),
      fetchPulseStatus(),
      fetchPulseStats(),
      fetchPulseHistory(0),
      fetchDirectives(),
    ]).finally(() => setIsLoading(false));
  }, []);

  // Re-fetch history on page change
  useEffect(() => {
    if (!isLoading) {
      fetchPulseHistory(pulsePage);
    }
  }, [pulsePage]);

  // WS-triggered refresh when tools complete or system notifications arrive
  useEffect(() => {
    const debouncedPulseRefresh = () => {
      if (pulseRefreshTimer.current) clearTimeout(pulseRefreshTimer.current);
      pulseRefreshTimer.current = setTimeout(() => {
        fetchPulseStatus();
        fetchPulseStats();
        fetchPulseHistory(pulsePage);
      }, 1000);
    };

    const unsubs = [
      subscribe('tool:end', () => fetchPendingApprovals()),
      subscribe('system:notification', (data: Record<string, unknown>) => {
        fetchPendingApprovals();
        if (data?.action === 'pulse') {
          debouncedPulseRefresh();
        }
      }),
      subscribe('pulse:activity', (data: PulseActivity) => {
        if (data.status === 'completed' || data.status === 'error') {
          setTimeout(() => setPulseActivity(null), 2000);
          debouncedPulseRefresh();
        } else {
          setPulseActivity(data);
        }
      }),
    ];
    return () => {
      unsubs.forEach((fn) => fn());
      if (pulseRefreshTimer.current) clearTimeout(pulseRefreshTimer.current);
    };
  }, [subscribe, fetchPendingApprovals, fetchPulseStatus, fetchPulseStats, fetchPulseHistory, pulsePage]);

  const handleLevelChange = useCallback(
    async (level: number) => {
      try {
        await autonomyApi.setLevel(level);
        fetchConfig();
        toast.success('Autonomy level updated');
      } catch {
        // API client handles error reporting
      }
    },
    [fetchConfig, toast]
  );

  const handleBudgetUpdate = useCallback(
    async (updates: Partial<AutonomyConfig>) => {
      try {
        await autonomyApi.updateBudget({ ...updates });
        fetchConfig();
        toast.success('Budget updated');
      } catch {
        // API client handles error reporting
      }
    },
    [fetchConfig, toast]
  );

  const handleAddTool = useCallback(
    async (type: 'allow' | 'block', tool: string) => {
      if (!tool.trim()) return;
      try {
        if (type === 'allow') {
          await autonomyApi.allowTool(tool.trim());
        } else {
          await autonomyApi.blockTool(tool.trim());
        }
        fetchConfig();
        toast.success('Tool added');
        if (type === 'allow') setNewAllowedTool('');
        else setNewBlockedTool('');
      } catch {
        // API client handles error reporting
      }
    },
    [fetchConfig, toast]
  );

  const handleRemoveTool = useCallback(
    async (tool: string) => {
      try {
        await autonomyApi.removeTool(tool);
        fetchConfig();
        toast.success('Tool removed');
      } catch {
        // API client handles error reporting
      }
    },
    [fetchConfig, toast]
  );

  const handleApproval = useCallback(
    async (actionId: string, decision: 'approve' | 'reject') => {
      try {
        await autonomyApi.resolveApproval(actionId, decision);
        fetchPendingApprovals();
        toast.success(decision === 'approve' ? 'Action approved' : 'Action rejected');
      } catch {
        // API client handles error reporting
      }
    },
    [fetchPendingApprovals, toast]
  );

  const handleResetConfig = useCallback(async () => {
    if (
      !(await confirm({
        message: 'Are you sure you want to reset autonomy settings to defaults?',
        variant: 'danger',
      }))
    )
      return;
    try {
      await autonomyApi.resetConfig();
      fetchConfig();
      toast.success('Config reset');
    } catch {
      // API client handles error reporting
    }
  }, [confirm, fetchConfig, toast]);

  // Pulse engine handlers
  const handlePulseToggle = useCallback(async () => {
    setPulseEngineLoading(true);
    try {
      if (pulseStatus?.running) {
        await pulseApi.stop();
        toast.success('Pulse engine stopped');
      } else {
        await pulseApi.start();
        toast.success('Pulse engine started');
      }
      await fetchPulseStatus();
    } catch {
      // API client handles error reporting
    } finally {
      setPulseEngineLoading(false);
    }
  }, [pulseStatus?.running, fetchPulseStatus, toast]);

  const handleRunPulse = useCallback(async () => {
    setPulseRunning(true);
    try {
      await pulseApi.run();
      toast.success('Pulse executed');
      await Promise.all([fetchPulseStatus(), fetchPulseStats(), fetchPulseHistory(pulsePage)]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.info('A pulse is already running.');
      }
      // Other errors handled by API client
    } finally {
      setPulseRunning(false);
    }
  }, [fetchPulseStatus, fetchPulseStats, fetchPulseHistory, pulsePage, toast]);

  const handlePulseSettingsUpdate = useCallback(
    async (updates: Partial<PulseEngineConfig>) => {
      try {
        const { config: newConfig } = await pulseApi.updateSettings(updates);
        setPulseStatus((prev) => (prev ? { ...prev, config: newConfig, enabled: newConfig.enabled } : prev));
        toast.success('Pulse settings updated');
      } catch {
        // API client handles error reporting
      }
    },
    [toast]
  );

  const handleDirectivesUpdate = useCallback(
    async (updates: Partial<PulseDirectives>) => {
      try {
        const { directives } = await pulseApi.updateDirectives(updates);
        setPulseDirectives(directives);
        setDirectivesInstructions(directives.customInstructions);
        toast.success('Pulse directives updated');
      } catch {
        // API client handles error reporting
      }
    },
    [toast]
  );

  const handleToggleRule = useCallback(
    (ruleId: string) => {
      if (!pulseDirectives) return;
      const disabled = pulseDirectives.disabledRules.includes(ruleId)
        ? pulseDirectives.disabledRules.filter((r) => r !== ruleId)
        : [...pulseDirectives.disabledRules, ruleId];
      handleDirectivesUpdate({ disabledRules: disabled, template: 'custom' });
    },
    [pulseDirectives, handleDirectivesUpdate]
  );

  const handleToggleAction = useCallback(
    (actionId: string) => {
      if (!pulseDirectives) return;
      const blocked = pulseDirectives.blockedActions.includes(actionId)
        ? pulseDirectives.blockedActions.filter((a) => a !== actionId)
        : [...pulseDirectives.blockedActions, actionId];
      handleDirectivesUpdate({ blockedActions: blocked, template: 'custom' });
    },
    [pulseDirectives, handleDirectivesUpdate]
  );

  const handleApplyTemplate = useCallback(
    (templateName: string) => {
      const tpl = DIRECTIVE_TEMPLATES[templateName];
      if (!tpl) return;
      handleDirectivesUpdate({ ...tpl, template: templateName });
    },
    [handleDirectivesUpdate]
  );

  if (isLoading || !config) {
    return <LoadingSpinner message="Loading autonomy settings..." />;
  }

  const currentLevel = levels.find((l) => l.level === config.level);
  const budgetRemaining = config.dailyBudget - config.dailySpend;
  const budgetPercent = config.dailyBudget > 0 ? (config.dailySpend / config.dailyBudget) * 100 : 0;

  const pulsePageCount = Math.max(1, Math.ceil(pulseTotal / PAGE_SIZE));
  const showFrom = pulseTotal > 0 ? pulsePage * PAGE_SIZE + 1 : 0;
  const showTo = Math.min((pulsePage + 1) * PAGE_SIZE, pulseTotal);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Autonomy Settings
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Control how autonomous the AI can be
          </p>
        </div>
        <button
          onClick={handleResetConfig}
          className="flex items-center gap-2 px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Reset to Defaults
        </button>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* Pulse Engine */}
        {pulseStatus && (
          <section className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary" />
                Pulse Engine
              </h3>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className={`w-2 h-2 rounded-full ${pulseStatus.running ? 'bg-success animate-pulse' : 'bg-error'}`}
                  />
                  <span className="text-text-secondary dark:text-dark-text-secondary">
                    {pulseStatus.running ? 'Running' : 'Stopped'}
                  </span>
                </span>
                <button
                  onClick={handlePulseToggle}
                  disabled={pulseEngineLoading}
                  className={`p-2 rounded-lg transition-colors ${
                    pulseStatus.running
                      ? 'text-error hover:bg-error/10'
                      : 'text-success hover:bg-success/10'
                  }`}
                  title={pulseStatus.running ? 'Stop engine' : 'Start engine'}
                >
                  <Power className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Active pulse banner */}
            {pulseActivity && (
              <div className="flex items-center gap-3 p-3 mb-4 bg-primary/10 border border-primary/20 rounded-lg">
                <RefreshCw className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    Pulse in progress
                  </span>
                  <span className="mx-2 text-text-muted dark:text-dark-text-muted">—</span>
                  <span className="text-sm text-primary">
                    {pulseActivity.stage.charAt(0).toUpperCase() + pulseActivity.stage.slice(1)}
                  </span>
                </div>
                {pulseActivity.startedAt && (
                  <span className="text-xs text-text-muted dark:text-dark-text-muted flex-shrink-0">
                    {formatDuration(Date.now() - pulseActivity.startedAt)}
                  </span>
                )}
              </div>
            )}

            {/* Stats cards */}
            {pulseStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <StatCard
                  icon={<Heart className="w-5 h-5" />}
                  value={pulseStats.totalPulses}
                  label="Total Pulses"
                />
                <StatCard
                  icon={<Activity className="w-5 h-5" />}
                  value={`${Math.round(pulseStats.llmCallRate * 100)}%`}
                  label="LLM Rate"
                />
                <StatCard
                  icon={<Clock className="w-5 h-5" />}
                  value={formatDuration(Math.round(pulseStats.avgDurationMs))}
                  label="Avg Duration"
                />
                <StatCard
                  icon={<BarChart className="w-5 h-5" />}
                  value={pulseStats.actionsExecuted}
                  label="Actions"
                />
              </div>
            )}

            {/* Settings */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  Settings
                </h4>
                <button
                  onClick={handleRunPulse}
                  disabled={pulseRunning || !!pulseActivity}
                  className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {pulseRunning || pulseActivity ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {pulseActivity
                    ? pulseActivity.stage.charAt(0).toUpperCase() + pulseActivity.stage.slice(1) + '...'
                    : 'Run Now'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-text-muted dark:text-dark-text-muted mb-1">
                    Min Interval (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={Math.round(pulseStatus.config.minIntervalMs / 60000)}
                    onBlur={(e) => {
                      const val = Math.max(1, Math.min(60, parseInt(e.target.value) || 5));
                      handlePulseSettingsUpdate({ minIntervalMs: val * 60000 });
                    }}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setPulseStatus((prev) =>
                        prev
                          ? { ...prev, config: { ...prev.config, minIntervalMs: val * 60000 } }
                          : prev
                      );
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted dark:text-dark-text-muted mb-1">
                    Max Interval (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={Math.round(pulseStatus.config.maxIntervalMs / 60000)}
                    onBlur={(e) => {
                      const val = Math.max(1, Math.min(120, parseInt(e.target.value) || 15));
                      handlePulseSettingsUpdate({ maxIntervalMs: val * 60000 });
                    }}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setPulseStatus((prev) =>
                        prev
                          ? { ...prev, config: { ...prev.config, maxIntervalMs: val * 60000 } }
                          : prev
                      );
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted dark:text-dark-text-muted mb-1">
                    Quiet Hours Start
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={pulseStatus.config.quietHoursStart}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                      handlePulseSettingsUpdate({ quietHoursStart: val });
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted dark:text-dark-text-muted mb-1">
                    Quiet Hours End
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={pulseStatus.config.quietHoursEnd}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                      handlePulseSettingsUpdate({ quietHoursEnd: val });
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted dark:text-dark-text-muted mb-1">
                    Max Actions per Pulse
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={pulseStatus.config.maxActions}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(20, parseInt(e.target.value) || 5));
                      handlePulseSettingsUpdate({ maxActions: val });
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>

            {/* Pulse Directives */}
            {pulseDirectives && (
              <div className="mb-5">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Pulse Directives
                </h4>

                {/* Template selector */}
                <div className="flex items-center gap-3 mb-4">
                  <label className="text-sm text-text-muted dark:text-dark-text-muted">
                    Template:
                  </label>
                  <select
                    value={pulseDirectives.template}
                    onChange={(e) => handleApplyTemplate(e.target.value)}
                    className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="balanced">Balanced</option>
                    <option value="conservative">Conservative</option>
                    <option value="proactive">Proactive</option>
                    <option value="minimal">Minimal</option>
                    {pulseDirectives.template === 'custom' && (
                      <option value="custom">Custom</option>
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {/* Evaluation Rules */}
                  <div>
                    <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 uppercase">
                      Evaluation Rules
                    </h5>
                    <div className="space-y-1.5">
                      {ruleDefinitions.map((rule) => {
                        const thresholdKey = rule.thresholdKey as keyof RuleThresholds | null;
                        const thresholdInfo = thresholdKey ? THRESHOLD_LABELS[thresholdKey] : null;
                        const currentValue = thresholdKey ? pulseDirectives.ruleThresholds?.[thresholdKey] : null;
                        return (
                          <div
                            key={rule.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={!pulseDirectives.disabledRules.includes(rule.id)}
                                onChange={() => handleToggleRule(rule.id)}
                                className="rounded border-border dark:border-dark-border text-primary focus:ring-primary/50"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-text-primary dark:text-dark-text-primary">
                                  {rule.label}
                                </span>
                                <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                                  {rule.description}
                                </p>
                              </div>
                            </label>
                            {thresholdInfo && currentValue != null && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <input
                                  type="number"
                                  min={thresholdInfo.min}
                                  max={thresholdInfo.max}
                                  step={thresholdKey === 'memoryMinImportance' ? 0.1 : 1}
                                  value={currentValue}
                                  onChange={(e) => {
                                    const val = thresholdKey === 'memoryMinImportance'
                                      ? parseFloat(e.target.value) || 0
                                      : parseInt(e.target.value) || 0;
                                    handleDirectivesUpdate({
                                      ruleThresholds: { ...pulseDirectives.ruleThresholds, [thresholdKey!]: val },
                                      template: 'custom',
                                    });
                                  }}
                                  className="w-16 px-1.5 py-0.5 text-xs text-center bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                                />
                                <span className="text-[10px] text-text-muted dark:text-dark-text-muted w-8">
                                  {thresholdInfo.unit}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Allowed Actions */}
                  <div>
                    <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 uppercase">
                      Allowed Actions
                    </h5>
                    <div className="space-y-1.5">
                      {actionTypes.map((action) => {
                        const cooldownKey = action.id as keyof ActionCooldowns;
                        const cooldownValue = pulseDirectives.actionCooldowns?.[cooldownKey];
                        return (
                          <div
                            key={action.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={!pulseDirectives.blockedActions.includes(action.id)}
                                onChange={() => handleToggleAction(action.id)}
                                className="rounded border-border dark:border-dark-border text-primary focus:ring-primary/50"
                              />
                              <span className="text-sm text-text-primary dark:text-dark-text-primary">
                                {action.label}
                              </span>
                            </label>
                            {cooldownValue != null && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <input
                                  type="number"
                                  min={0}
                                  max={1440}
                                  value={cooldownValue}
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(1440, parseInt(e.target.value) || 0));
                                    handleDirectivesUpdate({
                                      actionCooldowns: { ...pulseDirectives.actionCooldowns, [cooldownKey]: val },
                                      template: 'custom',
                                    });
                                  }}
                                  className="w-16 px-1.5 py-0.5 text-xs text-center bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                                />
                                <span className="text-[10px] text-text-muted dark:text-dark-text-muted w-6">
                                  min
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Custom Instructions */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase">
                      Custom Instructions
                    </h5>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {directivesInstructions.length} / 2,000
                    </span>
                  </div>
                  <textarea
                    value={directivesInstructions}
                    onChange={(e) => setDirectivesInstructions(e.target.value.slice(0, 2000))}
                    onBlur={() => {
                      if (directivesInstructions !== pulseDirectives.customInstructions) {
                        handleDirectivesUpdate({
                          customInstructions: directivesInstructions,
                          template: 'custom',
                        });
                      }
                    }}
                    rows={3}
                    placeholder="e.g. Focus on upcoming deadlines. Only notify for high-urgency items."
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Pulse History */}
            {pulseHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3">
                  Recent Pulse History
                </h4>

                <div className="space-y-1">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_70px_50px_70px_70px_32px] gap-2 px-3 py-1.5 text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase">
                    <span>Time</span>
                    <span className="text-right">Signals</span>
                    <span className="text-center">LLM</span>
                    <span className="text-right">Actions</span>
                    <span className="text-right">Duration</span>
                    <span />
                  </div>

                  {pulseHistory.map((entry) => (
                    <div key={entry.id}>
                      <button
                        onClick={() =>
                          setExpandedLogId(expandedLogId === entry.id ? null : entry.id)
                        }
                        className="w-full grid grid-cols-[1fr_70px_50px_70px_70px_32px] gap-2 px-3 py-2 text-sm rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        <span className="text-left text-text-primary dark:text-dark-text-primary flex items-center gap-1.5">
                          {entry.manual && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary rounded">
                              manual
                            </span>
                          )}
                          {entry.error && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-error/10 text-error rounded">
                              error
                            </span>
                          )}
                          {formatRelativeTime(entry.pulsedAt)}
                        </span>
                        <span className="text-right text-text-secondary dark:text-dark-text-secondary">
                          {entry.signalsFound}
                        </span>
                        <span className="text-center">
                          {entry.llmCalled ? (
                            <CheckCircle2 className="w-4 h-4 text-success inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-text-muted dark:text-dark-text-muted inline" />
                          )}
                        </span>
                        <span className="text-right text-text-secondary dark:text-dark-text-secondary">
                          {entry.actionsCount}
                        </span>
                        <span className="text-right text-text-muted dark:text-dark-text-muted">
                          {formatDuration(entry.durationMs)}
                        </span>
                        <span className="flex items-center justify-center text-text-muted dark:text-dark-text-muted">
                          {expandedLogId === entry.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </span>
                      </button>

                      {expandedLogId === entry.id && (
                        <div className="mx-3 mb-2 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm space-y-2">
                          {/* Signal IDs and urgency score */}
                          {(entry.signalIds?.length > 0 || entry.urgencyScore > 0) && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.signalIds?.map((sid) => (
                                <span
                                  key={sid}
                                  className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary rounded font-mono"
                                >
                                  {sid}
                                </span>
                              ))}
                              {entry.urgencyScore > 0 && (
                                <span className="ml-auto flex items-center gap-1 text-xs text-text-muted dark:text-dark-text-muted">
                                  <span>Urgency:</span>
                                  <span className={`font-medium ${
                                    entry.urgencyScore >= 75 ? 'text-error' :
                                    entry.urgencyScore >= 40 ? 'text-warning' : 'text-success'
                                  }`}>
                                    {entry.urgencyScore}%
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                          {entry.reportMsg && (
                            <div>
                              <span className="text-text-muted dark:text-dark-text-muted text-xs">
                                Report:
                              </span>
                              <p className="text-text-primary dark:text-dark-text-primary mt-0.5">
                                {entry.reportMsg}
                              </p>
                            </div>
                          )}
                          {entry.error && (
                            <div>
                              <span className="text-error text-xs">Error:</span>
                              <p className="text-error mt-0.5">{entry.error}</p>
                            </div>
                          )}
                          {entry.actions.length > 0 && (
                            <div>
                              <span className="text-text-muted dark:text-dark-text-muted text-xs">
                                Actions:
                              </span>
                              <div className="mt-1 space-y-1">
                                {entry.actions.map((action, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    {action.success ? (
                                      <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0" />
                                    ) : (
                                      <XCircle className="w-3 h-3 text-error flex-shrink-0" />
                                    )}
                                    <span className="text-text-primary dark:text-dark-text-primary">
                                      {action.type}
                                    </span>
                                    {action.error && (
                                      <span className="text-error truncate">{action.error}</span>
                                    )}
                                    {action.skipped && (
                                      <span className="text-text-muted dark:text-dark-text-muted">
                                        (skipped)
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {!entry.reportMsg && !entry.error && entry.actions.length === 0 && (
                            <p className="text-text-muted dark:text-dark-text-muted text-xs">
                              No signals detected — pulse skipped LLM call.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {pulseTotal > PAGE_SIZE && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border dark:border-dark-border">
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      Showing {showFrom}–{showTo} of {pulseTotal}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPulsePage((p) => Math.max(0, p - 1))}
                        disabled={pulsePage === 0}
                        className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
                      </button>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        Page {pulsePage + 1} of {pulsePageCount}
                      </span>
                      <button
                        onClick={() => setPulsePage((p) => Math.min(pulsePageCount - 1, p + 1))}
                        disabled={pulsePage >= pulsePageCount - 1}
                        className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {pulseHistory.length === 0 && (
              <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-4">
                No pulse history yet. Start the engine or run a manual pulse.
              </p>
            )}
          </section>
        )}

        {/* Pending Approvals */}
        {pendingApprovals.length > 0 && (
          <section className="bg-warning/10 border border-warning/30 rounded-xl p-4">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Pending Approvals ({pendingApprovals.length})
            </h3>
            <div className="space-y-3">
              {pendingApprovals.map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-start gap-3 p-3 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-text-primary dark:text-dark-text-primary">
                        {approval.description}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          riskColors[approval.risk.level as keyof typeof riskColors]
                        } bg-current/10`}
                      >
                        {approval.risk.level} risk
                      </span>
                    </div>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {approval.category} / {approval.type}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                      <Clock className="w-3 h-3" />
                      Expires: {new Date(approval.expiresAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproval(approval.id, 'approve')}
                      className="p-2 text-success hover:bg-success/10 rounded-lg transition-colors"
                      title="Approve"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleApproval(approval.id, 'reject')}
                      className="p-2 text-error hover:bg-error/10 rounded-lg transition-colors"
                      title="Reject"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Autonomy Level */}
        <section className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-primary" />
            Autonomy Level
          </h3>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted dark:text-dark-text-muted">
                Current Level
              </span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {currentLevel?.name} (Level {config.level})
              </span>
            </div>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {currentLevel?.description}
            </p>
          </div>

          <div className="space-y-2">
            {levels.map((level) => (
              <button
                key={level.level}
                onClick={() => handleLevelChange(level.level)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  config.level === level.level
                    ? 'border-primary bg-primary/5'
                    : 'border-border dark:border-dark-border hover:border-primary/50'
                }`}
              >
                <div className={`w-3 h-3 rounded-full ${levelColors[level.level]}`} />
                <div className="flex-1 text-left">
                  <div className="font-medium text-text-primary dark:text-dark-text-primary">
                    {level.name}
                  </div>
                  <div className="text-sm text-text-muted dark:text-dark-text-muted">
                    {level.description}
                  </div>
                </div>
                {config.level === level.level && <ShieldCheck className="w-5 h-5 text-primary" />}
              </button>
            ))}
          </div>
        </section>

        {/* Budget */}
        <section className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Budget Limits
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Daily Budget
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={config.dailyBudget}
                onChange={(e) =>
                  handleBudgetUpdate({ dailyBudget: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Max Cost per Action
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={config.maxCostPerAction}
                onChange={(e) =>
                  handleBudgetUpdate({ maxCostPerAction: parseFloat(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted dark:text-dark-text-muted">
                Today's Usage
              </span>
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                ${config.dailySpend.toFixed(2)} / ${config.dailyBudget.toFixed(2)}
              </span>
            </div>
            <div className="h-2 bg-bg-primary dark:bg-dark-bg-primary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  budgetPercent > 90 ? 'bg-error' : budgetPercent > 70 ? 'bg-warning' : 'bg-success'
                }`}
                style={{ width: `${Math.min(budgetPercent, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted">
              ${budgetRemaining.toFixed(2)} remaining • Resets{' '}
              {new Date(config.budgetResetAt).toLocaleString()}
            </p>
          </div>
        </section>

        {/* Tool Permissions */}
        <section className="bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Tool Permissions
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Allowed Tools */}
            <div>
              <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Always Allowed (no approval needed)
              </h4>
              <div className="space-y-2 mb-3">
                {config.allowedTools.length === 0 ? (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    No tools explicitly allowed
                  </p>
                ) : (
                  config.allowedTools.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center justify-between p-2 bg-success/10 border border-success/20 rounded-lg"
                    >
                      <span className="text-sm text-text-primary dark:text-dark-text-primary">
                        {tool}
                      </span>
                      <button
                        onClick={() => handleRemoveTool(tool)}
                        className="p-1 text-text-muted hover:text-error transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAllowedTool}
                  onChange={(e) => setNewAllowedTool(e.target.value)}
                  placeholder="Tool name"
                  className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTool('allow', newAllowedTool)}
                />
                <button
                  onClick={() => handleAddTool('allow', newAllowedTool)}
                  className="p-2 bg-success/10 text-success hover:bg-success/20 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Blocked Tools */}
            <div>
              <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Always Blocked (never run)
              </h4>
              <div className="space-y-2 mb-3">
                {config.blockedTools.length === 0 ? (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    No tools explicitly blocked
                  </p>
                ) : (
                  config.blockedTools.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center justify-between p-2 bg-error/10 border border-error/20 rounded-lg"
                    >
                      <span className="text-sm text-text-primary dark:text-dark-text-primary">
                        {tool}
                      </span>
                      <button
                        onClick={() => handleRemoveTool(tool)}
                        className="p-1 text-text-muted hover:text-error transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBlockedTool}
                  onChange={(e) => setNewBlockedTool(e.target.value)}
                  placeholder="Tool name"
                  className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTool('block', newBlockedTool)}
                />
                <button
                  onClick={() => handleAddTool('block', newBlockedTool)}
                  className="p-2 bg-error/10 text-error hover:bg-error/20 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
