import { useState, useEffect, useCallback } from 'react';
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
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { autonomyApi } from '../api';
import type { PendingApproval, AutonomyConfig, AutonomyLevel } from '../api';


const levelColors = [
  'bg-error',
  'bg-warning',
  'bg-warning',
  'bg-success',
  'bg-primary',
];

const riskColors = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-warning',
  critical: 'text-error',
};

export function AutonomyPage() {
  const { confirm } = useDialog();
  const [config, setConfig] = useState<AutonomyConfig | null>(null);
  const [levels, setLevels] = useState<AutonomyLevel[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newBlockedTool, setNewBlockedTool] = useState('');

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

  useEffect(() => {
    Promise.all([fetchConfig(), fetchPendingApprovals()]).finally(() =>
      setIsLoading(false)
    );
    // Refresh approvals every 10 seconds
    const interval = setInterval(fetchPendingApprovals, 10000);
    return () => clearInterval(interval);
  }, [fetchConfig, fetchPendingApprovals]);

  const handleLevelChange = useCallback(async (level: number) => {
    try {
      await autonomyApi.setLevel(String(level));
      fetchConfig();
    } catch {
      // API client handles error reporting
    }
  }, [fetchConfig]);

  const handleBudgetUpdate = useCallback(async (updates: Partial<AutonomyConfig>) => {
    try {
      await autonomyApi.updateBudget({ ...updates });
      fetchConfig();
    } catch {
      // API client handles error reporting
    }
  }, [fetchConfig]);

  const handleAddTool = useCallback(async (type: "allow" | "block", tool: string) => {
    if (!tool.trim()) return;
    try {
      if (type === "allow") {
        await autonomyApi.allowTool(tool.trim());
      } else {
        await autonomyApi.blockTool(tool.trim());
      }
      fetchConfig();
      if (type === "allow") setNewAllowedTool("");
      else setNewBlockedTool("");
    } catch {
      // API client handles error reporting
    }
  }, [fetchConfig]);

  const handleRemoveTool = useCallback(async (tool: string) => {
    try {
      await autonomyApi.removeTool(tool);
      fetchConfig();
    } catch {
      // API client handles error reporting
    }
  }, [fetchConfig]);

  const handleApproval = useCallback(async (actionId: string, decision: 'approve' | 'reject') => {
    try {
      await autonomyApi.resolveApproval(actionId, decision);
      fetchPendingApprovals();
    } catch {
      // API client handles error reporting
    }
  }, [fetchPendingApprovals]);

  const handleResetConfig = useCallback(async () => {
    if (!await confirm({ message: 'Are you sure you want to reset autonomy settings to defaults?', variant: 'danger' })) return;
    try {
      await autonomyApi.resetConfig();
      fetchConfig();
    } catch {
      // API client handles error reporting
    }
  }, [confirm, fetchConfig]);

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-muted dark:text-dark-text-muted">Loading autonomy settings...</p>
      </div>
    );
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
                {config.level === level.level && (
                  <ShieldCheck className="w-5 h-5 text-primary" />
                )}
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
