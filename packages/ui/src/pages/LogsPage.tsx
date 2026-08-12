import { useState, useCallback, useMemo, useEffect } from 'react';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { debugApi } from '../api';
import type { DebugInfo, DebugLogEntry, LogDetail, RequestLog, LogStats } from '../api';
import {
  Home,
  FileText,
  Activity,
  Search,
  Terminal,
  RefreshCw,
  AlertTriangle,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { EmptyState } from '../components/EmptyState';
import { useSkipHome } from '../hooks/useSkipHome';
import { DebugLogsTab, type DebugFilterType } from './logs/DebugLogsTab';
import {
  formatDuration,
  formatTokens,
  formatDate,
  getStatusColor,
  getTypeColor,
} from './logs/formatters';

type FilterType = 'all' | 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
type ErrorFilter = 'all' | 'errors' | 'success';
type TabType = 'home' | 'requests' | 'debug';

export function LogsPage() {
  const { confirm } = useDialog();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('home');

  const { skipHome, onSkipHomeChange } = useSkipHome({
    pageName: 'logs',
    defaultTab: 'requests',
    onNavigate: (tab) => setActiveTab(tab as TabType),
  });

  // Request logs state
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');
  const [days, setDays] = useState(7);

  // Debug logs state
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugFilter, setDebugFilter] = useState<DebugFilterType>('all');
  const [selectedDebugEntry, setSelectedDebugEntry] = useState<DebugLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = { limit: '100' };
      if (filterType !== 'all') params.type = filterType;
      if (errorFilter === 'errors') params.errors = 'true';
      if (errorFilter === 'success') params.errors = 'false';

      const data = await debugApi.listLogs(params);
      setLogs(data.logs);
    } catch {
      setError('Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  }, [filterType, errorFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await debugApi.getLogStats({ days: String(days) });
      setStats(data);
    } catch {
      // Ignore stats errors
    }
  }, [days]);

  const fetchDebugLogs = useCallback(async () => {
    setDebugLoading(true);
    try {
      const data = await debugApi.get(100);
      setDebugInfo(data);
    } catch {
      // Ignore debug errors
    } finally {
      setDebugLoading(false);
    }
  }, []);

  const fetchLogDetail = async (id: string) => {
    try {
      const data = await debugApi.getLogs(id);
      setSelectedLog(data);
    } catch {
      // Ignore detail errors
    }
  };

  const clearOldLogs = async (olderThanDays: number) => {
    if (
      !(await confirm({
        message: `Delete logs older than ${olderThanDays} days?`,
        variant: 'danger',
      }))
    )
      return;

    try {
      await debugApi.deleteLogs({ olderThanDays });
      toast.success('Old logs deleted');
      fetchLogs();
      fetchStats();
    } catch {
      setError('Failed to delete logs');
    }
  };

  const clearAllLogs = async () => {
    if (
      !(await confirm({
        message: 'Delete ALL request logs? This cannot be undone.',
        variant: 'danger',
      }))
    )
      return;

    try {
      await debugApi.deleteLogs({ all: true });
      toast.success('All logs deleted');
      fetchLogs();
      fetchStats();
    } catch {
      setError('Failed to delete logs');
    }
  };

  const clearDebugLogs = async () => {
    if (!(await confirm({ message: 'Clear all debug logs?', variant: 'danger' }))) return;
    try {
      await debugApi.clear();
      toast.success('Debug logs cleared');
      fetchDebugLogs();
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (activeTab === 'requests') {
      fetchLogs();
      fetchStats();
    } else if (activeTab === 'debug') {
      fetchDebugLogs();
    }
  }, [activeTab, fetchLogs, fetchStats, fetchDebugLogs]);

  const filteredDebugEntries = useMemo(
    () =>
      debugInfo?.entries.filter((entry) => {
        if (debugFilter === 'all') return true;
        return entry.type === debugFilter;
      }) || [],
    [debugInfo, debugFilter]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Logs
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Request and debug log viewer
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'requests' ? (
            <>
              <button
                onClick={() => clearOldLogs(30)}
                className="px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors"
              >
                Clear Old
              </button>
              <button
                onClick={clearAllLogs}
                className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg transition-colors"
              >
                Clear All
              </button>
              <button
                onClick={() => {
                  fetchLogs();
                  fetchStats();
                }}
                className="px-3 py-1.5 text-sm bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </>
          ) : activeTab === 'debug' ? (
            <>
              <button
                onClick={clearDebugLogs}
                className="px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors"
              >
                Clear Debug Logs
              </button>
              <button
                onClick={fetchDebugLogs}
                className="px-3 py-1.5 text-sm bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'requests', 'debug'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {tab === 'home' ? 'Home' : tab === 'requests' ? 'Request Logs' : 'Debug Logs'}
            {tab === 'debug' && debugInfo && debugInfo.summary.toolCalls > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full">
                {debugInfo.summary.toolCalls}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'home' && (
        <div className="flex-1 overflow-auto p-4">
          <PageHomeTab
            heroIcons={[
              { icon: FileText, color: 'text-primary bg-primary/10' },
              { icon: Activity, color: 'text-orange-500 bg-orange-500/10' },
              { icon: Search, color: 'text-violet-500 bg-violet-500/10' },
            ]}
            title="Monitor Every Request"
            subtitle="Full visibility into AI requests, responses, and system events — with search, filtering, and debug tools."
            cta={{
              label: 'View Request Logs',
              icon: FileText,
              onClick: () => setActiveTab('requests'),
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={onSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Logs"
            features={[
              {
                icon: FileText,
                color: 'text-primary bg-primary/10',
                title: 'Request Logs',
                description:
                  'Browse every AI request with details on tokens, cost, latency, and response status.',
              },
              {
                icon: Terminal,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Debug Console',
                description:
                  'Inspect tool calls, retries, and errors in a developer-friendly debug view.',
              },
              {
                icon: Search,
                color: 'text-orange-500 bg-orange-500/10',
                title: 'Search & Filter',
                description:
                  'Filter logs by type, status, date range, and more to find exactly what you need.',
              },
              {
                icon: Activity,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Real-time Stream',
                description:
                  'Watch requests flow through the system in real time as your agents work.',
              },
            ]}
            steps={[
              {
                title: 'Browse recent requests',
                detail: 'View the latest AI requests across all providers and agents.',
              },
              {
                title: 'Filter by type or status',
                detail: 'Narrow down logs to find specific request types or errors.',
              },
              {
                title: 'Inspect request details',
                detail: 'Click any request to see full token usage, cost, and response data.',
              },
              {
                title: 'Debug with system logs',
                detail: 'Switch to the debug console for tool calls and internal events.',
              },
            ]}
            quickActions={[
              {
                icon: FileText,
                label: 'Request Logs',
                description: 'Browse all AI requests',
                onClick: () => setActiveTab('requests'),
              },
              {
                icon: Terminal,
                label: 'Debug Console',
                description: 'View tool calls and system events',
                onClick: () => setActiveTab('debug'),
              },
            ]}
          />
        </div>
      )}

      {activeTab === 'requests' ? (
        <>
          {/* Stats Cards */}
          {stats && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Total Requests</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {stats.totalRequests}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Success</div>
                  <div className="text-xl font-bold text-green-600 dark:text-green-400">
                    {stats.successCount}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Errors</div>
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">
                    {stats.errorCount}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Avg Duration</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatDuration(Math.round(stats.avgDurationMs))}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Input Tokens</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatTokens(stats.totalInputTokens)}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Output Tokens</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatTokens(stats.totalOutputTokens)}
                  </div>
                </div>
              </div>

              {/* Stats period selector */}
              <div className="mt-3 flex gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Period:</span>
                {[1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-2 py-1 text-xs rounded ${
                      days === d
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {d === 1 ? 'Today' : `${d} days`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Type:</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border-0 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All</option>
                <option value="chat">Chat</option>
                <option value="completion">Completion</option>
                <option value="embedding">Embedding</option>
                <option value="tool">Tool</option>
                <option value="agent">Agent</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
              <select
                value={errorFilter}
                onChange={(e) => setErrorFilter(e.target.value as ErrorFilter)}
                className="px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border-0 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="errors">Errors</option>
              </select>
            </div>
          </div>

          {/* Request Logs Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Logs List */}
            <div
              className={`flex-1 overflow-auto ${selectedLog ? 'hidden md:block md:w-1/2' : ''}`}
            >
              {isLoading ? (
                <div className="py-12">
                  <LoadingSpinner size="sm" message="Loading logs..." />
                </div>
              ) : error ? (
                <div className="m-4">
                  <EmptyState
                    icon={AlertTriangle}
                    title="Failed to load logs"
                    description={error}
                    variant="card"
                    iconBgColor="bg-red-500/10 dark:bg-red-500/20"
                    iconColor="text-red-500"
                    action={{
                      label: 'Try Again',
                      onClick: fetchLogs,
                      icon: RefreshCw,
                    }}
                  />
                </div>
              ) : logs.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No logs found"
                  description="Try adjusting your filters or check back later."
                  variant="card"
                  iconBgColor="bg-indigo-500/10 dark:bg-indigo-500/20"
                  iconColor="text-indigo-500"
                />
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {logs.map((log) => (
                    <button
                      key={log.id}
                      onClick={() => fetchLogDetail(log.id)}
                      className={`w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                        selectedLog?.id === log.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(log.type)}`}
                        >
                          {log.type}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(log.statusCode, !!log.error)}`}
                        >
                          {log.error ? 'Error' : log.statusCode || 200}
                        </span>
                        {log.provider && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {log.provider}
                          </span>
                        )}
                        {log.model && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[120px]">
                            {log.model}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>{formatDate(log.createdAt)}</span>
                        <span>{formatDuration(log.durationMs)}</span>
                        {log.inputTokens !== null && <span>↑{formatTokens(log.inputTokens)}</span>}
                        {log.outputTokens !== null && (
                          <span>↓{formatTokens(log.outputTokens)}</span>
                        )}
                      </div>
                      {log.error && (
                        <div className="mt-1 text-xs text-red-500 truncate">{log.error}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Log Detail Panel */}
            {selectedLog && (
              <div className="w-full md:w-1/2 border-l border-gray-200 dark:border-gray-700 overflow-auto bg-gray-50 dark:bg-gray-900">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-gray-900">
                  <h3 className="font-medium text-gray-900 dark:text-white">Log Detail</h3>
                  <button
                    onClick={() => setSelectedLog(null)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Basic Info */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Basic Info
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-gray-500 dark:text-gray-400">ID</div>
                      <div className="text-gray-900 dark:text-white font-mono text-xs">
                        {selectedLog.id}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Type</div>
                      <div>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(selectedLog.type)}`}
                        >
                          {selectedLog.type}
                        </span>
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Status</div>
                      <div>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(selectedLog.statusCode, !!selectedLog.error)}`}
                        >
                          {selectedLog.error ? 'Error' : selectedLog.statusCode || 200}
                        </span>
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Provider</div>
                      <div className="text-gray-900 dark:text-white">
                        {selectedLog.provider || '-'}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Model</div>
                      <div className="text-gray-900 dark:text-white text-xs">
                        {selectedLog.model || '-'}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Endpoint</div>
                      <div className="text-gray-900 dark:text-white text-xs">
                        {selectedLog.endpoint || '-'}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Method</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.method}</div>
                      <div className="text-gray-500 dark:text-gray-400">Duration</div>
                      <div className="text-gray-900 dark:text-white">
                        {formatDuration(selectedLog.durationMs)}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">Created</div>
                      <div className="text-gray-900 dark:text-white text-xs">
                        {formatDate(selectedLog.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* Tokens */}
                  {(selectedLog.inputTokens || selectedLog.outputTokens) && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Token Usage
                      </h4>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Input</div>
                          <div className="text-gray-900 dark:text-white font-medium">
                            {formatTokens(selectedLog.inputTokens)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Output</div>
                          <div className="text-gray-900 dark:text-white font-medium">
                            {formatTokens(selectedLog.outputTokens)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Total</div>
                          <div className="text-gray-900 dark:text-white font-medium">
                            {formatTokens(selectedLog.totalTokens)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {selectedLog.error && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Error</h4>
                      <div className="text-sm text-red-600 dark:text-red-300">
                        {selectedLog.error}
                      </div>
                      {selectedLog.errorStack && (
                        <pre className="mt-2 p-2 bg-red-100 dark:bg-red-900/40 rounded text-xs overflow-auto max-h-40 text-red-700 dark:text-red-300">
                          {selectedLog.errorStack}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Request Body */}
                  {selectedLog.requestBody && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Request Body
                      </h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedLog.requestBody, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Response Body */}
                  {selectedLog.responseBody && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Response Body
                      </h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedLog.responseBody, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Metadata
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-gray-500 dark:text-gray-400">Conversation ID</div>
                      <div className="text-gray-900 dark:text-white font-mono text-xs">
                        {selectedLog.conversationId || '-'}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">User ID</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.userId}</div>
                      <div className="text-gray-500 dark:text-gray-400">IP Address</div>
                      <div className="text-gray-900 dark:text-white">
                        {selectedLog.ipAddress || '-'}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">User Agent</div>
                      <div className="text-gray-900 dark:text-white text-xs truncate">
                        {selectedLog.userAgent || '-'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Debug Logs Tab */
        <DebugLogsTab
          debugInfo={debugInfo}
          debugLoading={debugLoading}
          debugFilter={debugFilter}
          onDebugFilterChange={setDebugFilter}
          selectedEntry={selectedDebugEntry}
          onSelectEntry={setSelectedDebugEntry}
          entries={filteredDebugEntries}
        />
      )}
    </div>
  );
}
