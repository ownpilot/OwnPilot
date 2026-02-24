import { useState, useEffect, useCallback, useRef } from 'react';
import { useGateway } from '../../hooks/useWebSocket';
import {
  Shield,
  ShieldCheck,
  Gauge,
  RefreshCw,
  Plus,
  Trash2,
  DollarSign,
} from '../../components/icons';
import { useDialog } from '../../components/ConfirmDialog';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/ToastProvider';
import { autonomyApi, pulseApi, ApiError } from '../../api';
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
} from '../../api';
import { levelColors, PAGE_SIZE, DIRECTIVE_TEMPLATES } from './helpers';
import { PulseEngineSection } from './PulseEngineSection';
import { ApprovalsSection } from './ApprovalsSection';

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
          <PulseEngineSection
            pulseStatus={pulseStatus}
            pulseStats={pulseStats}
            pulseActivity={pulseActivity}
            pulseHistory={pulseHistory}
            pulseTotal={pulseTotal}
            pulsePage={pulsePage}
            pulseEngineLoading={pulseEngineLoading}
            pulseRunning={pulseRunning}
            pulseDirectives={pulseDirectives}
            ruleDefinitions={ruleDefinitions}
            actionTypes={actionTypes}
            directivesInstructions={directivesInstructions}
            onDirectivesInstructionsChange={setDirectivesInstructions}
            onPulseToggle={handlePulseToggle}
            onRunPulse={handleRunPulse}
            onPulseSettingsUpdate={handlePulseSettingsUpdate}
            onPulseStatusChange={setPulseStatus}
            onDirectivesUpdate={handleDirectivesUpdate}
            onToggleRule={handleToggleRule}
            onToggleAction={handleToggleAction}
            onApplyTemplate={handleApplyTemplate}
            onPageChange={setPulsePage}
          />
        )}

        {/* Pending Approvals */}
        <ApprovalsSection
          pendingApprovals={pendingApprovals}
          onApproval={handleApproval}
        />

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
