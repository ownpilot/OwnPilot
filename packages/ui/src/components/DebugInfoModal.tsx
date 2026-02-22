import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Clock,
  Wrench,
  Brain,
  Send,
  Code,
  AlertTriangle,
  RefreshCw,
  XCircle,
  Check,
  Database,
  Zap,
  ChevronDown,
  ChevronRight,
  Copy,
} from './icons';
import type { TraceInfo } from '../types';

interface DebugInfoModalProps {
  trace: TraceInfo;
  onClose: () => void;
}

type TabId = 'overview' | 'tool_calls' | 'model_calls' | 'events' | 'request' | 'raw';

export function DebugInfoModal({ trace, onClose }: DebugInfoModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const toolCallCount = trace.toolCalls.length;
  const successfulTools = trace.toolCalls.filter((t) => t.success).length;
  const failedTools = toolCallCount - successfulTools;
  const totalInputTokens = trace.modelCalls.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0);
  const totalOutputTokens = trace.modelCalls.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0);
  const totalTokens = trace.modelCalls.reduce(
    (sum, m) => sum + (m.tokens ?? (m.inputTokens ?? 0) + (m.outputTokens ?? 0)),
    0
  );
  const totalModelDuration = trace.modelCalls.reduce((sum, m) => sum + (m.duration ?? 0), 0);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tool_calls', label: 'Tool Calls', count: toolCallCount },
    { id: 'model_calls', label: 'Model Calls', count: trace.modelCalls.length },
    { id: 'events', label: 'Events', count: trace.events.length },
    { id: 'request', label: 'Request / Response' },
    { id: 'raw', label: 'Raw JSON' },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] animate-[fadeIn_150ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[95vw] h-[90vh] max-w-[1400px] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-[scaleIn_150ms_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Code className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Debug Logs
            </h2>
            <span className="text-sm text-text-muted dark:text-dark-text-muted">
              {trace.duration}ms total
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(JSON.stringify(trace, null, 2), 'all')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedKey === 'all' ? 'Copied!' : 'Copy All'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors text-text-muted dark:text-dark-text-muted"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border dark:border-dark-border px-5 bg-bg-secondary/30 dark:bg-dark-bg-secondary/30 flex-shrink-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'overview' && (
            <OverviewTab
              trace={trace}
              totalTokens={totalTokens}
              totalInputTokens={totalInputTokens}
              totalOutputTokens={totalOutputTokens}
              totalModelDuration={totalModelDuration}
              toolCallCount={toolCallCount}
              successfulTools={successfulTools}
              failedTools={failedTools}
            />
          )}
          {activeTab === 'tool_calls' && (
            <ToolCallsTab trace={trace} copyToClipboard={copyToClipboard} copiedKey={copiedKey} />
          )}
          {activeTab === 'model_calls' && <ModelCallsTab trace={trace} />}
          {activeTab === 'events' && (
            <EventsTab trace={trace} copyToClipboard={copyToClipboard} copiedKey={copiedKey} />
          )}
          {activeTab === 'request' && <RequestResponseTab trace={trace} />}
          {activeTab === 'raw' && (
            <RawJsonTab trace={trace} copyToClipboard={copyToClipboard} copiedKey={copiedKey} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Overview Tab
// ─────────────────────────────────────────────

function OverviewTab({
  trace,
  totalTokens,
  totalInputTokens,
  totalOutputTokens,
  totalModelDuration,
  toolCallCount,
  successfulTools,
  failedTools,
}: {
  trace: TraceInfo;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalModelDuration: number;
  toolCallCount: number;
  successfulTools: number;
  failedTools: number;
}) {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Total Duration"
          value={`${trace.duration}ms`}
          sublabel={`Model: ${totalModelDuration}ms`}
          color="text-text-muted dark:text-dark-text-muted"
        />
        <StatCard
          icon={<Brain className="w-5 h-5" />}
          label="Total Tokens"
          value={totalTokens.toLocaleString()}
          sublabel={`${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`}
          color="text-blue-500"
        />
        <StatCard
          icon={<Wrench className="w-5 h-5" />}
          label="Tool Calls"
          value={`${successfulTools}/${toolCallCount}`}
          sublabel={failedTools > 0 ? `${failedTools} failed` : 'All succeeded'}
          color={failedTools > 0 ? 'text-yellow-500' : 'text-green-500'}
        />
        <StatCard
          icon={<Send className="w-5 h-5" />}
          label="Model Calls"
          value={`${trace.modelCalls.length}`}
          sublabel={
            trace.request?.provider ? `${trace.request.provider}/${trace.request.model}` : ''
          }
          color="text-purple-500"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {trace.dbOperations.reads > 0 || trace.dbOperations.writes > 0 ? (
          <StatCard
            icon={<Database className="w-5 h-5" />}
            label="DB Operations"
            value={`${trace.dbOperations.reads + trace.dbOperations.writes}`}
            sublabel={`${trace.dbOperations.reads} reads / ${trace.dbOperations.writes} writes`}
            color="text-cyan-500"
          />
        ) : null}
        {trace.memoryOps.adds > 0 || trace.memoryOps.recalls > 0 ? (
          <StatCard
            icon={<Brain className="w-5 h-5" />}
            label="Memory Ops"
            value={`${trace.memoryOps.adds + trace.memoryOps.recalls}`}
            sublabel={`${trace.memoryOps.adds} adds / ${trace.memoryOps.recalls} recalls`}
            color="text-indigo-500"
          />
        ) : null}
        {trace.triggersFired.length > 0 && (
          <StatCard
            icon={<Zap className="w-5 h-5" />}
            label="Triggers Fired"
            value={`${trace.triggersFired.length}`}
            sublabel={trace.triggersFired.join(', ')}
            color="text-yellow-500"
          />
        )}
        {trace.errors.length > 0 && (
          <StatCard
            icon={<XCircle className="w-5 h-5" />}
            label="Errors"
            value={`${trace.errors.length}`}
            sublabel=""
            color="text-red-500"
          />
        )}
        {(trace.retries?.length ?? 0) > 0 && (
          <StatCard
            icon={<RefreshCw className="w-5 h-5" />}
            label="Retries"
            value={`${trace.retries!.length}`}
            sublabel=""
            color="text-amber-500"
          />
        )}
        {trace.autonomyChecks.length > 0 && (
          <StatCard
            icon={<AlertTriangle className="w-5 h-5" />}
            label="Autonomy Checks"
            value={`${trace.autonomyChecks.length}`}
            sublabel={`${trace.autonomyChecks.filter((a) => !a.approved).length} blocked`}
            color="text-orange-500"
          />
        )}
      </div>

      {/* Errors list */}
      {trace.errors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-red-500 mb-2 flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Errors
          </h3>
          <div className="space-y-2">
            {trace.errors.map((error, i) => (
              <div
                key={i}
                className="px-3 py-2 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/20 font-mono whitespace-pre-wrap break-all"
              >
                {error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retries list */}
      {trace.retries && trace.retries.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-500 mb-2 flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Retries
          </h3>
          <div className="space-y-2">
            {trace.retries.map((retry, i) => (
              <div
                key={i}
                className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm"
              >
                <span className="text-amber-400 font-medium">Attempt {retry.attempt}</span>
                <span className="text-text-muted dark:text-dark-text-muted mx-2">
                  delayed {retry.delayMs}ms
                </span>
                <div className="text-red-400 font-mono mt-1 whitespace-pre-wrap break-all">
                  {retry.error}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Autonomy Checks */}
      {trace.autonomyChecks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-orange-500 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Autonomy Checks
          </h3>
          <div className="space-y-1">
            {trace.autonomyChecks.map((check, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  check.approved
                    ? 'bg-green-500/10 border border-green-500/20'
                    : 'bg-red-500/10 border border-red-500/20'
                }`}
              >
                {check.approved ? (
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                )}
                <span className="font-mono text-text-primary dark:text-dark-text-primary">
                  {check.tool}
                </span>
                {check.reason && (
                  <span className="text-text-muted dark:text-dark-text-muted whitespace-pre-wrap break-all">
                    {check.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 p-4">
      <div className={`flex items-center gap-2 mb-1 ${color}`}>
        {icon}
        <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
          {label}
        </span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sublabel && (
        <div className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 break-all">
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Tool Calls Tab
// ─────────────────────────────────────────────

function ToolCallsTab({
  trace,
  copyToClipboard,
  copiedKey,
}: {
  trace: TraceInfo;
  copyToClipboard: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = (index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedTools(new Set(trace.toolCalls.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedTools(new Set());
  };

  if (trace.toolCalls.length === 0) {
    return (
      <div className="text-text-muted dark:text-dark-text-muted text-sm">
        No tool calls in this trace.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={expandAll} className="text-xs text-primary hover:underline">
          Expand All
        </button>
        <span className="text-text-muted dark:text-dark-text-muted text-xs">|</span>
        <button onClick={collapseAll} className="text-xs text-primary hover:underline">
          Collapse All
        </button>
      </div>

      {trace.toolCalls.map((tool, i) => {
        const isExpanded = expandedTools.has(i);
        return (
          <div
            key={i}
            className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 overflow-hidden"
          >
            {/* Tool Header */}
            <button
              onClick={() => toggleTool(i)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50 transition-colors"
            >
              {tool.success ? (
                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              )}
              <span className="font-mono text-sm text-text-primary dark:text-dark-text-primary font-medium">
                {tool.name}
              </span>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              )}
              <div className="ml-auto flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted">
                {tool.duration !== undefined && <span>{tool.duration}ms</span>}
                {tool.error && <span className="text-red-500">Error</span>}
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t border-border dark:border-dark-border">
                {/* Arguments */}
                {tool.arguments && Object.keys(tool.arguments).length > 0 && (
                  <div className="p-4 border-b border-border dark:border-dark-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
                        Arguments
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(JSON.stringify(tool.arguments, null, 2), `args-${i}`);
                        }}
                        className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `args-${i}` ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all font-mono">
                      {JSON.stringify(tool.arguments, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Result */}
                {tool.result && (
                  <div className="p-4 border-b border-border dark:border-dark-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
                        Result
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(
                            typeof tool.result === 'string'
                              ? tool.result
                              : JSON.stringify(tool.result, null, 2),
                            `result-${i}`
                          );
                        }}
                        className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `result-${i}` ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all font-mono">
                      {typeof tool.result === 'string'
                        ? tool.result
                        : JSON.stringify(tool.result, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {tool.error && (
                  <div className="p-4">
                    <span className="text-xs font-semibold text-red-500 uppercase tracking-wider block mb-2">
                      Error
                    </span>
                    <div className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg font-mono whitespace-pre-wrap break-all">
                      {tool.error}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Model Calls Tab
// ─────────────────────────────────────────────

function ModelCallsTab({ trace }: { trace: TraceInfo }) {
  if (trace.modelCalls.length === 0) {
    return (
      <div className="text-text-muted dark:text-dark-text-muted text-sm">
        No model calls in this trace.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trace.modelCalls.map((model, i) => {
        const inputTokens = model.inputTokens ?? 0;
        const outputTokens = model.outputTokens ?? 0;
        const totalTokens = model.tokens ?? inputTokens + outputTokens;

        return (
          <div
            key={i}
            className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <Brain className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                {model.provider}/{model.model}
              </span>
              {model.duration !== undefined && (
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto">
                  {model.duration}ms
                </span>
              )}
            </div>

            {/* Token Breakdown */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary p-3">
                <div className="text-[10px] uppercase text-text-muted dark:text-dark-text-muted tracking-wider mb-1">
                  Input
                </div>
                <div className="text-lg font-bold text-blue-400">
                  {inputTokens.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary p-3">
                <div className="text-[10px] uppercase text-text-muted dark:text-dark-text-muted tracking-wider mb-1">
                  Output
                </div>
                <div className="text-lg font-bold text-green-400">
                  {outputTokens.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary p-3">
                <div className="text-[10px] uppercase text-text-muted dark:text-dark-text-muted tracking-wider mb-1">
                  Total
                </div>
                <div className="text-lg font-bold text-purple-400">
                  {totalTokens.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Events Tab
// ─────────────────────────────────────────────

function EventsTab({
  trace,
  copyToClipboard,
  copiedKey,
}: {
  trace: TraceInfo;
  copyToClipboard: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const toggleEvent = (index: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (trace.events.length === 0) {
    return (
      <div className="text-text-muted dark:text-dark-text-muted text-sm">
        No events in this trace.
      </div>
    );
  }

  const getToolCallDetails = (eventName: string) => {
    return trace.toolCalls.find((tc) => tc.name === eventName);
  };

  return (
    <div className="space-y-1">
      {trace.events.map((event, i) => {
        const isToolCallEvent = event.type === 'tool_call' || event.type === 'tool_result';
        const toolCallData = isToolCallEvent ? getToolCallDetails(event.name) : null;
        const hasDetails = toolCallData && (toolCallData.arguments || toolCallData.result);
        const isExpanded = expandedEvents.has(i);

        return (
          <div
            key={i}
            className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 overflow-hidden"
          >
            <div
              onClick={() => hasDetails && toggleEvent(i)}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                hasDetails
                  ? 'cursor-pointer hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50'
                  : ''
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  event.success === false
                    ? 'bg-red-500'
                    : event.success === true
                      ? 'bg-green-500'
                      : 'bg-gray-400'
                }`}
              />
              <span className="px-2 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-xs text-text-muted dark:text-dark-text-muted font-mono">
                {event.type}
              </span>
              <span className="text-text-primary dark:text-dark-text-primary font-mono">
                {event.name}
              </span>
              {hasDetails && (
                <span className="text-text-muted dark:text-dark-text-muted">
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </span>
              )}
              {event.duration !== undefined && (
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto">
                  {event.duration}ms
                </span>
              )}
            </div>

            {isExpanded && toolCallData && (
              <div className="border-t border-border dark:border-dark-border">
                {toolCallData.arguments && Object.keys(toolCallData.arguments).length > 0 && (
                  <div className="p-4 border-b border-border dark:border-dark-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
                        Arguments
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(
                            JSON.stringify(toolCallData.arguments, null, 2),
                            `ev-args-${i}`
                          );
                        }}
                        className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `ev-args-${i}` ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all font-mono">
                      {JSON.stringify(toolCallData.arguments, null, 2)}
                    </pre>
                  </div>
                )}
                {toolCallData.result && (
                  <div className="p-4 border-b border-border dark:border-dark-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-dark-text-secondary uppercase tracking-wider">
                        Result
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(
                            typeof toolCallData.result === 'string'
                              ? toolCallData.result
                              : JSON.stringify(toolCallData.result, null, 2),
                            `ev-result-${i}`
                          );
                        }}
                        className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `ev-result-${i}` ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-3 rounded-lg overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all font-mono">
                      {typeof toolCallData.result === 'string'
                        ? toolCallData.result
                        : JSON.stringify(toolCallData.result, null, 2)}
                    </pre>
                  </div>
                )}
                {toolCallData.error && (
                  <div className="p-4">
                    <span className="text-xs font-semibold text-red-500 uppercase tracking-wider block mb-2">
                      Error
                    </span>
                    <div className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg font-mono whitespace-pre-wrap break-all">
                      {toolCallData.error}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Request / Response Tab
// ─────────────────────────────────────────────

function RequestResponseTab({ trace }: { trace: TraceInfo }) {
  return (
    <div className="space-y-6">
      {/* Request */}
      {trace.request && (
        <div>
          <h3 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary mb-3 flex items-center gap-2">
            <Send className="w-4 h-4" /> Request
          </h3>
          <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 overflow-hidden">
            <InfoRow label="Provider" value={trace.request.provider} />
            <InfoRow label="Model" value={trace.request.model} />
            <InfoRow label="Endpoint" value={trace.request.endpoint} />
            <InfoRow label="Messages" value={String(trace.request.messageCount)} />
            {trace.request.tools && trace.request.tools.length > 0 && (
              <div className="px-4 py-3 border-t border-border dark:border-dark-border">
                <span className="text-xs text-text-muted dark:text-dark-text-muted block mb-2">
                  Tools ({trace.request.tools.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {trace.request.tools.map((tool, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-mono"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Response */}
      {trace.response && (
        <div>
          <h3 className="text-sm font-semibold text-text-secondary dark:text-dark-text-secondary mb-3 flex items-center gap-2">
            <Code className="w-4 h-4" /> Response
          </h3>
          <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
              <span className="text-xs text-text-muted dark:text-dark-text-muted w-28">
                Status:
              </span>
              <span
                className={`text-sm font-medium ${trace.response.status === 'success' ? 'text-green-500' : 'text-red-500'}`}
              >
                {trace.response.status}
              </span>
            </div>
            {trace.response.finishReason && (
              <InfoRow label="Finish Reason" value={trace.response.finishReason} />
            )}
            {trace.response.contentLength !== undefined && (
              <InfoRow label="Content Length" value={`${trace.response.contentLength} chars`} />
            )}
          </div>
        </div>
      )}

      {!trace.request && !trace.response && (
        <div className="text-text-muted dark:text-dark-text-muted text-sm">
          No request/response data available.
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border last:border-b-0">
      <span className="text-xs text-text-muted dark:text-dark-text-muted w-28 flex-shrink-0">
        {label}:
      </span>
      <span className="text-sm text-text-primary dark:text-dark-text-primary font-mono break-all">
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Raw JSON Tab
// ─────────────────────────────────────────────

function RawJsonTab({
  trace,
  copyToClipboard,
  copiedKey,
}: {
  trace: TraceInfo;
  copyToClipboard: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  const rawJson = JSON.stringify(trace, null, 2);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          Full trace data ({rawJson.length.toLocaleString()} chars)
        </span>
        <button
          onClick={() => copyToClipboard(rawJson, 'raw-json')}
          className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary flex items-center gap-1"
        >
          <Copy className="w-3 h-3" />
          {copiedKey === 'raw-json' ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>
      <pre className="text-xs bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border p-4 rounded-lg overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all font-mono">
        {rawJson}
      </pre>
    </div>
  );
}
