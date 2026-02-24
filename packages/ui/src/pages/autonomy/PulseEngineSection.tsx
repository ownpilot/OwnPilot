import { useState } from 'react';
import {
  Heart,
  Activity,
  Clock,
  BarChart,
  Power,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
} from '../../components/icons';
import { StatCard } from './StatCard';
import { DirectivesSection } from './DirectivesSection';
import { formatRelativeTime, formatDuration, PAGE_SIZE } from './helpers';
import type {
  PulseStatus,
  PulseActivity,
  PulseLogEntry,
  PulseStats,
  PulseEngineConfig,
  PulseDirectives,
  PulseRuleDefinition,
  PulseActionType,
} from '../../api';

interface PulseEngineSectionProps {
  pulseStatus: PulseStatus;
  pulseStats: PulseStats | null;
  pulseActivity: PulseActivity | null;
  pulseHistory: PulseLogEntry[];
  pulseTotal: number;
  pulsePage: number;
  pulseEngineLoading: boolean;
  pulseRunning: boolean;
  pulseDirectives: PulseDirectives | null;
  ruleDefinitions: PulseRuleDefinition[];
  actionTypes: PulseActionType[];
  directivesInstructions: string;
  onDirectivesInstructionsChange: (value: string) => void;
  onPulseToggle: () => void;
  onRunPulse: () => void;
  onPulseSettingsUpdate: (updates: Partial<PulseEngineConfig>) => void;
  onPulseStatusChange: (updater: (prev: PulseStatus | null) => PulseStatus | null) => void;
  onDirectivesUpdate: (updates: Partial<PulseDirectives>) => void;
  onToggleRule: (ruleId: string) => void;
  onToggleAction: (actionId: string) => void;
  onApplyTemplate: (templateName: string) => void;
  onPageChange: (page: number) => void;
}

export function PulseEngineSection({
  pulseStatus,
  pulseStats,
  pulseActivity,
  pulseHistory,
  pulseTotal,
  pulsePage,
  pulseEngineLoading,
  pulseRunning,
  pulseDirectives,
  ruleDefinitions,
  actionTypes,
  directivesInstructions,
  onDirectivesInstructionsChange,
  onPulseToggle,
  onRunPulse,
  onPulseSettingsUpdate,
  onPulseStatusChange,
  onDirectivesUpdate,
  onToggleRule,
  onToggleAction,
  onApplyTemplate,
  onPageChange,
}: PulseEngineSectionProps) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const pulsePageCount = Math.max(1, Math.ceil(pulseTotal / PAGE_SIZE));
  const showFrom = pulseTotal > 0 ? pulsePage * PAGE_SIZE + 1 : 0;
  const showTo = Math.min((pulsePage + 1) * PAGE_SIZE, pulseTotal);

  return (
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
            onClick={onPulseToggle}
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
        <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-primary/10 border border-primary/20 rounded-lg text-sm text-primary">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="font-medium">
            {pulseActivity.stage.charAt(0).toUpperCase() + pulseActivity.stage.slice(1)}...
          </span>
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
            onClick={onRunPulse}
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
                onPulseSettingsUpdate({ minIntervalMs: val * 60000 });
              }}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onPulseStatusChange((prev) =>
                  prev ? { ...prev, config: { ...prev.config, minIntervalMs: val * 60000 } } : prev
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
                onPulseSettingsUpdate({ maxIntervalMs: val * 60000 });
              }}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onPulseStatusChange((prev) =>
                  prev ? { ...prev, config: { ...prev.config, maxIntervalMs: val * 60000 } } : prev
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
                onPulseSettingsUpdate({ quietHoursStart: val });
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
                onPulseSettingsUpdate({ quietHoursEnd: val });
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
                onPulseSettingsUpdate({ maxActions: val });
              }}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </div>

      {/* Pulse Directives */}
      {pulseDirectives && (
        <DirectivesSection
          pulseDirectives={pulseDirectives}
          ruleDefinitions={ruleDefinitions}
          actionTypes={actionTypes}
          directivesInstructions={directivesInstructions}
          onDirectivesInstructionsChange={onDirectivesInstructionsChange}
          onDirectivesUpdate={onDirectivesUpdate}
          onToggleRule={onToggleRule}
          onToggleAction={onToggleAction}
          onApplyTemplate={onApplyTemplate}
        />
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
                  onClick={() => setExpandedLogId(expandedLogId === entry.id ? null : entry.id)}
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
                            <span
                              className={`font-medium ${
                                entry.urgencyScore >= 75
                                  ? 'text-error'
                                  : entry.urgencyScore >= 40
                                    ? 'text-warning'
                                    : 'text-success'
                              }`}
                            >
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
                            <div key={i} className="flex items-center gap-2 text-xs">
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
                  onClick={() => onPageChange(Math.max(0, pulsePage - 1))}
                  disabled={pulsePage === 0}
                  className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
                </button>
                <span className="text-xs text-text-muted dark:text-dark-text-muted">
                  Page {pulsePage + 1} of {pulsePageCount}
                </span>
                <button
                  onClick={() => onPageChange(Math.min(pulsePageCount - 1, pulsePage + 1))}
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
  );
}
