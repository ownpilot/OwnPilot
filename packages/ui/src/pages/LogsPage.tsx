import { useState, useEffect, useCallback } from 'react';

interface RequestLog {
  id: string;
  type: 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
  conversationId: string | null;
  provider: string | null;
  model: string | null;
  statusCode: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  createdAt: string;
}

interface LogDetail extends RequestLog {
  userId: string;
  endpoint: string | null;
  method: string;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  totalTokens: number | null;
  errorStack: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

interface LogStats {
  totalRequests: number;
  errorCount: number;
  successCount: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
}

// Debug log types from core
interface DebugLogEntry {
  timestamp: string;
  type: 'request' | 'response' | 'tool_call' | 'tool_result' | 'error' | 'retry';
  provider?: string;
  model?: string;
  data: Record<string, unknown>;
  duration?: number;
}

interface DebugInfo {
  enabled: boolean;
  entries: DebugLogEntry[];
  summary: {
    requests: number;
    responses: number;
    toolCalls: number;
    errors: number;
    retries: number;
  };
}

type FilterType = 'all' | 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
type ErrorFilter = 'all' | 'errors' | 'success';
type TabType = 'requests' | 'debug';
type DebugFilterType = 'all' | 'tool_call' | 'tool_result' | 'request' | 'response' | 'error';

export function LogsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('requests');

  // Request logs state
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (filterType !== 'all') params.set('type', filterType);
      if (errorFilter === 'errors') params.set('errors', 'true');
      if (errorFilter === 'success') params.set('errors', 'false');

      const res = await fetch(`/api/v1/chat/logs?${params}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.logs);
      } else {
        setError(data.error?.message || 'Failed to fetch logs');
      }
    } catch {
      setError('Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [filterType, errorFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chat/logs/stats?days=${days}`);
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch {
      // Ignore stats errors
    }
  }, [days]);

  const fetchDebugLogs = useCallback(async () => {
    setDebugLoading(true);
    try {
      const res = await fetch('/api/v1/debug?count=100');
      const data = await res.json();
      if (data.success) {
        setDebugInfo(data.data);
      }
    } catch {
      // Ignore debug errors
    } finally {
      setDebugLoading(false);
    }
  }, []);

  const fetchLogDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/chat/logs/${id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedLog(data.data);
      }
    } catch {
      // Ignore detail errors
    }
  };

  const clearOldLogs = async (olderThanDays: number) => {
    if (!confirm(`Delete logs older than ${olderThanDays} days?`)) return;

    try {
      const res = await fetch(`/api/v1/chat/logs?olderThanDays=${olderThanDays}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        alert(`Deleted ${data.data.deleted} logs`);
        fetchLogs();
        fetchStats();
      }
    } catch {
      setError('Failed to delete logs');
    }
  };

  const clearDebugLogs = async () => {
    if (!confirm('Clear all debug logs?')) return;
    try {
      await fetch('/api/v1/debug', { method: 'DELETE' });
      fetchDebugLogs();
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    if (activeTab === 'requests') {
      fetchLogs();
      fetchStats();
    } else {
      fetchDebugLogs();
    }
  }, [activeTab, fetchLogs, fetchStats, fetchDebugLogs]);

  const formatDuration = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTokens = (tokens: number | null) => {
    if (tokens === null) return '-';
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString();
  };

  const getStatusColor = (statusCode: number | null, hasError: boolean) => {
    if (hasError || (statusCode && statusCode >= 400)) {
      return 'text-red-500 bg-red-100 dark:bg-red-900/20';
    }
    return 'text-green-500 bg-green-100 dark:bg-green-900/20';
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      chat: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      completion: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      embedding: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
      tool: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      agent: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
      other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400',
    };
    return colors[type] || colors.other;
  };

  const getDebugTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      tool_call: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      tool_result: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
      request: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      response: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      retry: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400';
  };

  const getDebugTypeIcon = (type: string) => {
    switch (type) {
      case 'tool_call':
        return '🔧';
      case 'tool_result':
        return '📤';
      case 'request':
        return '📥';
      case 'response':
        return '📨';
      case 'error':
        return '❌';
      case 'retry':
        return '🔄';
      default:
        return '📋';
    }
  };

  const filteredDebugEntries = debugInfo?.entries.filter(entry => {
    if (debugFilter === 'all') return true;
    return entry.type === debugFilter;
  }) || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Logs</h1>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'requests'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Request Logs
          </button>
          <button
            onClick={() => setActiveTab('debug')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'debug'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <span>Debug Logs</span>
            {debugInfo && debugInfo.summary.toolCalls > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full">
                {debugInfo.summary.toolCalls}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'requests' ? (
            <>
              <button
                onClick={() => clearOldLogs(30)}
                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Clear Old Logs
              </button>
              <button
                onClick={() => { fetchLogs(); fetchStats(); }}
                className="px-3 py-1.5 text-sm bg-indigo-500 text-white hover:bg-indigo-600 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </>
          ) : (
            <>
              <button
                onClick={clearDebugLogs}
                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Clear Debug Logs
              </button>
              <button
                onClick={fetchDebugLogs}
                className="px-3 py-1.5 text-sm bg-indigo-500 text-white hover:bg-indigo-600 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

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
            <div className={`flex-1 overflow-auto ${selectedLog ? 'hidden md:block md:w-1/2' : ''}`}>
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-gray-500 dark:text-gray-400">Loading logs...</div>
                </div>
              ) : error ? (
                <div className="m-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
                  {error}
                </div>
              ) : logs.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-gray-500 dark:text-gray-400">No logs found</div>
                </div>
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
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(log.type)}`}>
                          {log.type}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(log.statusCode, !!log.error)}`}>
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
                        {log.inputTokens !== null && (
                          <span>↑{formatTokens(log.inputTokens)}</span>
                        )}
                        {log.outputTokens !== null && (
                          <span>↓{formatTokens(log.outputTokens)}</span>
                        )}
                      </div>
                      {log.error && (
                        <div className="mt-1 text-xs text-red-500 truncate">
                          {log.error}
                        </div>
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Basic Info */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Basic Info</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-gray-500 dark:text-gray-400">ID</div>
                      <div className="text-gray-900 dark:text-white font-mono text-xs">{selectedLog.id}</div>
                      <div className="text-gray-500 dark:text-gray-400">Type</div>
                      <div><span className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(selectedLog.type)}`}>{selectedLog.type}</span></div>
                      <div className="text-gray-500 dark:text-gray-400">Status</div>
                      <div><span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(selectedLog.statusCode, !!selectedLog.error)}`}>{selectedLog.error ? 'Error' : selectedLog.statusCode || 200}</span></div>
                      <div className="text-gray-500 dark:text-gray-400">Provider</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.provider || '-'}</div>
                      <div className="text-gray-500 dark:text-gray-400">Model</div>
                      <div className="text-gray-900 dark:text-white text-xs">{selectedLog.model || '-'}</div>
                      <div className="text-gray-500 dark:text-gray-400">Endpoint</div>
                      <div className="text-gray-900 dark:text-white text-xs">{selectedLog.endpoint || '-'}</div>
                      <div className="text-gray-500 dark:text-gray-400">Method</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.method}</div>
                      <div className="text-gray-500 dark:text-gray-400">Duration</div>
                      <div className="text-gray-900 dark:text-white">{formatDuration(selectedLog.durationMs)}</div>
                      <div className="text-gray-500 dark:text-gray-400">Created</div>
                      <div className="text-gray-900 dark:text-white text-xs">{formatDate(selectedLog.createdAt)}</div>
                    </div>
                  </div>

                  {/* Tokens */}
                  {(selectedLog.inputTokens || selectedLog.outputTokens) && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Token Usage</h4>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Input</div>
                          <div className="text-gray-900 dark:text-white font-medium">{formatTokens(selectedLog.inputTokens)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Output</div>
                          <div className="text-gray-900 dark:text-white font-medium">{formatTokens(selectedLog.outputTokens)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 dark:text-gray-400 text-xs">Total</div>
                          <div className="text-gray-900 dark:text-white font-medium">{formatTokens(selectedLog.totalTokens)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {selectedLog.error && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Error</h4>
                      <div className="text-sm text-red-600 dark:text-red-300">{selectedLog.error}</div>
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
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Request Body</h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedLog.requestBody, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Response Body */}
                  {selectedLog.responseBody && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Response Body</h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedLog.responseBody, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Metadata</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-gray-500 dark:text-gray-400">Conversation ID</div>
                      <div className="text-gray-900 dark:text-white font-mono text-xs">{selectedLog.conversationId || '-'}</div>
                      <div className="text-gray-500 dark:text-gray-400">User ID</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.userId}</div>
                      <div className="text-gray-500 dark:text-gray-400">IP Address</div>
                      <div className="text-gray-900 dark:text-white">{selectedLog.ipAddress || '-'}</div>
                      <div className="text-gray-500 dark:text-gray-400">User Agent</div>
                      <div className="text-gray-900 dark:text-white text-xs truncate">{selectedLog.userAgent || '-'}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Debug Logs Tab */
        <>
          {/* Debug Stats */}
          {debugInfo && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Tool Calls</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {debugInfo.summary.toolCalls}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Requests</div>
                  <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                    {debugInfo.summary.requests}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Responses</div>
                  <div className="text-xl font-bold text-purple-600 dark:text-purple-400">
                    {debugInfo.summary.responses}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Errors</div>
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">
                    {debugInfo.summary.errors}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Retries</div>
                  <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">
                    {debugInfo.summary.retries}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
                  <div className={`text-xl font-bold ${debugInfo.enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                    {debugInfo.enabled ? 'ON' : 'OFF'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Debug Filters */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Filter:</span>
              <select
                value={debugFilter}
                onChange={(e) => setDebugFilter(e.target.value as DebugFilterType)}
                className="px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border-0 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All</option>
                <option value="tool_call">Tool Calls</option>
                <option value="tool_result">Tool Results</option>
                <option value="request">Requests</option>
                <option value="response">Responses</option>
                <option value="error">Errors</option>
              </select>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {filteredDebugEntries.length} entries (in-memory, last 100)
            </div>
          </div>

          {/* Debug Logs Content */}
          <div className="flex-1 overflow-hidden flex">
            <div className={`flex-1 overflow-auto ${selectedDebugEntry ? 'hidden md:block md:w-1/2' : ''}`}>
              {debugLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-gray-500 dark:text-gray-400">Loading debug logs...</div>
                </div>
              ) : filteredDebugEntries.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center text-gray-500 dark:text-gray-400">
                    <p>No debug logs found</p>
                    <p className="text-xs mt-1">Debug logs are captured during AI interactions</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredDebugEntries.map((entry, index) => (
                    <button
                      key={`${entry.timestamp}-${index}`}
                      onClick={() => setSelectedDebugEntry(entry)}
                      className={`w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                        selectedDebugEntry === entry ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{getDebugTypeIcon(entry.type)}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getDebugTypeColor(entry.type)}`}>
                          {entry.type.replace('_', ' ')}
                        </span>
                        {entry.provider && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {entry.provider}
                          </span>
                        )}
                        {entry.model && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[120px]">
                            {entry.model}
                          </span>
                        )}
                      </div>

                      {/* Tool call specific info */}
                      {entry.type === 'tool_call' && entry.data && (
                        <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                          <span className="font-medium">{(entry.data as { name?: string }).name}</span>
                          {(entry.data as { approved?: boolean }).approved === false && (
                            <span className="ml-2 text-xs text-red-500">Rejected</span>
                          )}
                        </div>
                      )}

                      {/* Tool result specific info */}
                      {entry.type === 'tool_result' && entry.data && (
                        <div className="mt-1 text-sm">
                          <span className="font-medium text-gray-700 dark:text-gray-300">{(entry.data as { name?: string }).name}</span>
                          <span className={`ml-2 text-xs ${(entry.data as { success?: boolean }).success ? 'text-green-500' : 'text-red-500'}`}>
                            {(entry.data as { success?: boolean }).success ? 'Success' : 'Failed'}
                          </span>
                          {entry.duration && (
                            <span className="ml-2 text-xs text-gray-500">{formatDuration(entry.duration)}</span>
                          )}
                        </div>
                      )}

                      {/* Error specific info */}
                      {entry.type === 'error' && entry.data && (
                        <div className="mt-1 text-xs text-red-500 truncate">
                          {(entry.data as { error?: string }).error}
                        </div>
                      )}

                      <div className="mt-1 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>{formatTime(entry.timestamp)}</span>
                        {entry.duration && <span>{formatDuration(entry.duration)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Debug Entry Detail Panel */}
            {selectedDebugEntry && (
              <div className="w-full md:w-1/2 border-l border-gray-200 dark:border-gray-700 overflow-auto bg-gray-50 dark:bg-gray-900">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-gray-900">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getDebugTypeIcon(selectedDebugEntry.type)}</span>
                    <h3 className="font-medium text-gray-900 dark:text-white capitalize">
                      {selectedDebugEntry.type.replace('_', ' ')} Detail
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedDebugEntry(null)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Metadata */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Info</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-gray-500 dark:text-gray-400">Type</div>
                      <div><span className={`px-2 py-0.5 text-xs font-medium rounded ${getDebugTypeColor(selectedDebugEntry.type)}`}>{selectedDebugEntry.type}</span></div>
                      <div className="text-gray-500 dark:text-gray-400">Timestamp</div>
                      <div className="text-gray-900 dark:text-white text-xs">{formatDate(selectedDebugEntry.timestamp)}</div>
                      {selectedDebugEntry.provider && (
                        <>
                          <div className="text-gray-500 dark:text-gray-400">Provider</div>
                          <div className="text-gray-900 dark:text-white">{selectedDebugEntry.provider}</div>
                        </>
                      )}
                      {selectedDebugEntry.model && (
                        <>
                          <div className="text-gray-500 dark:text-gray-400">Model</div>
                          <div className="text-gray-900 dark:text-white text-xs">{selectedDebugEntry.model}</div>
                        </>
                      )}
                      {selectedDebugEntry.duration && (
                        <>
                          <div className="text-gray-500 dark:text-gray-400">Duration</div>
                          <div className="text-gray-900 dark:text-white">{formatDuration(selectedDebugEntry.duration)}</div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Tool Call Specific */}
                  {selectedDebugEntry.type === 'tool_call' && selectedDebugEntry.data && (
                    <>
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 space-y-2">
                        <h4 className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Tool Call</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-emerald-600 dark:text-emerald-400">Name</div>
                          <div className="text-emerald-800 dark:text-emerald-200 font-medium">{(selectedDebugEntry.data as { name?: string }).name}</div>
                          <div className="text-emerald-600 dark:text-emerald-400">ID</div>
                          <div className="text-emerald-800 dark:text-emerald-200 font-mono text-xs">{(selectedDebugEntry.data as { id?: string }).id}</div>
                          <div className="text-emerald-600 dark:text-emerald-400">Approved</div>
                          <div className={`font-medium ${(selectedDebugEntry.data as { approved?: boolean }).approved ? 'text-green-600' : 'text-red-600'}`}>
                            {(selectedDebugEntry.data as { approved?: boolean }).approved ? 'Yes' : 'No'}
                          </div>
                          {(selectedDebugEntry.data as { rejectionReason?: string }).rejectionReason && (
                            <>
                              <div className="text-emerald-600 dark:text-emerald-400">Rejection Reason</div>
                              <div className="text-red-600 dark:text-red-400">{(selectedDebugEntry.data as { rejectionReason?: string }).rejectionReason}</div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Arguments */}
                      {(selectedDebugEntry.data as { arguments?: Record<string, unknown> }).arguments && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Arguments (Input)</h4>
                          <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                            {JSON.stringify((selectedDebugEntry.data as { arguments?: Record<string, unknown> }).arguments, null, 2)}
                          </pre>
                        </div>
                      )}
                    </>
                  )}

                  {/* Tool Result Specific */}
                  {selectedDebugEntry.type === 'tool_result' && selectedDebugEntry.data && (
                    <>
                      <div className={`rounded-lg p-4 space-y-2 ${(selectedDebugEntry.data as { success?: boolean }).success ? 'bg-teal-50 dark:bg-teal-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                        <h4 className={`text-sm font-medium ${(selectedDebugEntry.data as { success?: boolean }).success ? 'text-teal-700 dark:text-teal-400' : 'text-red-700 dark:text-red-400'}`}>Tool Result</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-teal-600 dark:text-teal-400">Name</div>
                          <div className="text-teal-800 dark:text-teal-200 font-medium">{(selectedDebugEntry.data as { name?: string }).name}</div>
                          <div className="text-teal-600 dark:text-teal-400">Tool Call ID</div>
                          <div className="text-teal-800 dark:text-teal-200 font-mono text-xs">{(selectedDebugEntry.data as { toolCallId?: string }).toolCallId}</div>
                          <div className="text-teal-600 dark:text-teal-400">Success</div>
                          <div className={`font-medium ${(selectedDebugEntry.data as { success?: boolean }).success ? 'text-green-600' : 'text-red-600'}`}>
                            {(selectedDebugEntry.data as { success?: boolean }).success ? 'Yes' : 'No'}
                          </div>
                          <div className="text-teal-600 dark:text-teal-400">Duration</div>
                          <div className="text-teal-800 dark:text-teal-200">{formatDuration((selectedDebugEntry.data as { durationMs?: number }).durationMs)}</div>
                          <div className="text-teal-600 dark:text-teal-400">Result Length</div>
                          <div className="text-teal-800 dark:text-teal-200">{(selectedDebugEntry.data as { resultLength?: number }).resultLength} chars</div>
                        </div>
                      </div>

                      {/* Result Preview */}
                      {(selectedDebugEntry.data as { resultPreview?: string }).resultPreview && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Result (Output)</h4>
                          <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {(selectedDebugEntry.data as { resultPreview?: string }).resultPreview}
                          </pre>
                        </div>
                      )}

                      {/* Error if failed */}
                      {(selectedDebugEntry.data as { error?: string }).error && (
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                          <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Error</h4>
                          <div className="text-sm text-red-600 dark:text-red-300">{(selectedDebugEntry.data as { error?: string }).error}</div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Request/Response Specific */}
                  {(selectedDebugEntry.type === 'request' || selectedDebugEntry.type === 'response') && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Data</h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-80 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedDebugEntry.data, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Error Specific */}
                  {selectedDebugEntry.type === 'error' && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Error Details</h4>
                      <div className="text-sm text-red-600 dark:text-red-300">{(selectedDebugEntry.data as { error?: string }).error}</div>
                      {(selectedDebugEntry.data as { stack?: string }).stack && (
                        <pre className="mt-2 p-2 bg-red-100 dark:bg-red-900/40 rounded text-xs overflow-auto max-h-40 text-red-700 dark:text-red-300">
                          {(selectedDebugEntry.data as { stack?: string }).stack}
                        </pre>
                      )}
                      {(selectedDebugEntry.data as { context?: string }).context && (
                        <div className="text-xs text-red-500 mt-2">Context: {(selectedDebugEntry.data as { context?: string }).context}</div>
                      )}
                    </div>
                  )}

                  {/* Retry Specific */}
                  {selectedDebugEntry.type === 'retry' && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-yellow-700 dark:text-yellow-400">Retry Info</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-yellow-600 dark:text-yellow-400">Attempt</div>
                        <div className="text-yellow-800 dark:text-yellow-200">
                          {(selectedDebugEntry.data as { attempt?: number }).attempt} / {(selectedDebugEntry.data as { maxRetries?: number }).maxRetries}
                        </div>
                        <div className="text-yellow-600 dark:text-yellow-400">Delay</div>
                        <div className="text-yellow-800 dark:text-yellow-200">{formatDuration((selectedDebugEntry.data as { delayMs?: number }).delayMs)}</div>
                        <div className="text-yellow-600 dark:text-yellow-400">Error</div>
                        <div className="text-yellow-800 dark:text-yellow-200">{(selectedDebugEntry.data as { error?: string }).error}</div>
                      </div>
                    </div>
                  )}

                  {/* Raw Data (fallback for other types) */}
                  {!['tool_call', 'tool_result', 'request', 'response', 'error', 'retry'].includes(selectedDebugEntry.type) && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Raw Data</h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedDebugEntry.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
