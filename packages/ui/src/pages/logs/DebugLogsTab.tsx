/**
 * DebugLogsTab — the Debug Logs half of LogsPage.
 *
 * Split out of LogsPage.tsx (1172 LOC). The debug domain is self-contained:
 * its own fetch, filter, list and detail panel, sharing nothing with the
 * request-log side except the pure formatters in ./formatters.
 */

import type { DebugInfo, DebugLogEntry } from '../../api';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import {
  formatDate,
  formatDuration,
  formatTime,
  getDebugTypeColor,
  getDebugTypeIcon,
} from './formatters';

export type DebugFilterType =
  'all' | 'tool_call' | 'tool_result' | 'request' | 'response' | 'error';

interface DebugLogsTabProps {
  debugInfo: DebugInfo | null;
  debugLoading: boolean;
  debugFilter: DebugFilterType;
  onDebugFilterChange: (filter: DebugFilterType) => void;
  selectedEntry: DebugLogEntry | null;
  onSelectEntry: (entry: DebugLogEntry | null) => void;
  entries: DebugLogEntry[];
}

export function DebugLogsTab({
  debugInfo,
  debugLoading,
  debugFilter,
  onDebugFilterChange,
  selectedEntry,
  onSelectEntry,
  entries: filteredDebugEntries,
}: DebugLogsTabProps) {
  return (
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
              <div
                className={`text-xl font-bold ${debugInfo.enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
              >
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
            onChange={(e) => onDebugFilterChange(e.target.value as DebugFilterType)}
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
        <div className={`flex-1 overflow-auto ${selectedEntry ? 'hidden md:block md:w-1/2' : ''}`}>
          {debugLoading ? (
            <div className="py-12">
              <LoadingSpinner size="sm" message="Loading debug logs..." />
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
              {filteredDebugEntries.map((entry) => (
                <button
                  key={`${entry.timestamp}-${entry.type}`}
                  onClick={() => onSelectEntry(entry)}
                  className={`w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    selectedEntry === entry ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{getDebugTypeIcon(entry.type)}</span>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${getDebugTypeColor(entry.type)}`}
                    >
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
                      <span className="font-medium">{entry.data.name}</span>
                      {entry.data.approved === false && (
                        <span className="ml-2 text-xs text-red-500">Rejected</span>
                      )}
                    </div>
                  )}

                  {/* Tool result specific info */}
                  {entry.type === 'tool_result' && entry.data && (
                    <div className="mt-1 text-sm">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {entry.data.name}
                      </span>
                      <span
                        className={`ml-2 text-xs ${entry.data.success ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {entry.data.success ? 'Success' : 'Failed'}
                      </span>
                      {entry.duration && (
                        <span className="ml-2 text-xs text-gray-500">
                          {formatDuration(entry.duration)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Error specific info */}
                  {entry.type === 'error' && entry.data && (
                    <div className="mt-1 text-xs text-red-500 truncate">{entry.data.error}</div>
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
        {selectedEntry && (
          <div className="w-full md:w-1/2 border-l border-gray-200 dark:border-gray-700 overflow-auto bg-gray-50 dark:bg-gray-900">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getDebugTypeIcon(selectedEntry.type)}</span>
                <h3 className="font-medium text-gray-900 dark:text-white capitalize">
                  {selectedEntry.type.replace('_', ' ')} Detail
                </h3>
              </div>
              <button
                onClick={() => onSelectEntry(null)}
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
              {/* Metadata */}
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Info</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-500 dark:text-gray-400">Type</div>
                  <div>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${getDebugTypeColor(selectedEntry.type)}`}
                    >
                      {selectedEntry.type}
                    </span>
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">Timestamp</div>
                  <div className="text-gray-900 dark:text-white text-xs">
                    {formatDate(selectedEntry.timestamp)}
                  </div>
                  {selectedEntry.provider && (
                    <>
                      <div className="text-gray-500 dark:text-gray-400">Provider</div>
                      <div className="text-gray-900 dark:text-white">{selectedEntry.provider}</div>
                    </>
                  )}
                  {selectedEntry.model && (
                    <>
                      <div className="text-gray-500 dark:text-gray-400">Model</div>
                      <div className="text-gray-900 dark:text-white text-xs">
                        {selectedEntry.model}
                      </div>
                    </>
                  )}
                  {selectedEntry.duration && (
                    <>
                      <div className="text-gray-500 dark:text-gray-400">Duration</div>
                      <div className="text-gray-900 dark:text-white">
                        {formatDuration(selectedEntry.duration)}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Tool Call Specific */}
              {selectedEntry.type === 'tool_call' && selectedEntry.data && (
                <>
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 space-y-2">
                    <h4 className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      Tool Call
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-emerald-600 dark:text-emerald-400">Name</div>
                      <div className="text-emerald-800 dark:text-emerald-200 font-medium">
                        {selectedEntry.data.name}
                      </div>
                      <div className="text-emerald-600 dark:text-emerald-400">ID</div>
                      <div className="text-emerald-800 dark:text-emerald-200 font-mono text-xs">
                        {selectedEntry.data.id}
                      </div>
                      <div className="text-emerald-600 dark:text-emerald-400">Approved</div>
                      <div
                        className={`font-medium ${selectedEntry.data.approved ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {selectedEntry.data.approved ? 'Yes' : 'No'}
                      </div>
                      {selectedEntry.data.rejectionReason && (
                        <>
                          <div className="text-emerald-600 dark:text-emerald-400">
                            Rejection Reason
                          </div>
                          <div className="text-red-600 dark:text-red-400">
                            {selectedEntry.data.rejectionReason}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Arguments */}
                  {selectedEntry.data.arguments && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Arguments (Input)
                      </h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                        {JSON.stringify(selectedEntry.data.arguments, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {/* Tool Result Specific */}
              {selectedEntry.type === 'tool_result' && selectedEntry.data && (
                <>
                  <div
                    className={`rounded-lg p-4 space-y-2 ${selectedEntry.data.success ? 'bg-teal-50 dark:bg-teal-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
                  >
                    <h4
                      className={`text-sm font-medium ${selectedEntry.data.success ? 'text-teal-700 dark:text-teal-400' : 'text-red-700 dark:text-red-400'}`}
                    >
                      Tool Result
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-teal-600 dark:text-teal-400">Name</div>
                      <div className="text-teal-800 dark:text-teal-200 font-medium">
                        {selectedEntry.data.name}
                      </div>
                      <div className="text-teal-600 dark:text-teal-400">Tool Call ID</div>
                      <div className="text-teal-800 dark:text-teal-200 font-mono text-xs">
                        {selectedEntry.data.toolCallId}
                      </div>
                      <div className="text-teal-600 dark:text-teal-400">Success</div>
                      <div
                        className={`font-medium ${selectedEntry.data.success ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {selectedEntry.data.success ? 'Yes' : 'No'}
                      </div>
                      <div className="text-teal-600 dark:text-teal-400">Duration</div>
                      <div className="text-teal-800 dark:text-teal-200">
                        {formatDuration(selectedEntry.data.durationMs)}
                      </div>
                      <div className="text-teal-600 dark:text-teal-400">Result Length</div>
                      <div className="text-teal-800 dark:text-teal-200">
                        {selectedEntry.data.resultLength} chars
                      </div>
                    </div>
                  </div>

                  {/* Result Preview */}
                  {selectedEntry.data.result && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Result (Output)
                      </h4>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {selectedEntry.data.result}
                      </pre>
                    </div>
                  )}

                  {/* Error if failed */}
                  {selectedEntry.data.error && (
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Error</h4>
                      <div className="text-sm text-red-600 dark:text-red-300">
                        {selectedEntry.data.error}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Request/Response Specific */}
              {(selectedEntry.type === 'request' || selectedEntry.type === 'response') && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Data</h4>
                  <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-80 text-gray-700 dark:text-gray-300">
                    {JSON.stringify(selectedEntry.data, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error Specific */}
              {selectedEntry.type === 'error' && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium text-red-700 dark:text-red-400">
                    Error Details
                  </h4>
                  <div className="text-sm text-red-600 dark:text-red-300">
                    {selectedEntry.data.error}
                  </div>
                  {selectedEntry.data.stack && (
                    <pre className="mt-2 p-2 bg-red-100 dark:bg-red-900/40 rounded text-xs overflow-auto max-h-40 text-red-700 dark:text-red-300">
                      {selectedEntry.data.stack}
                    </pre>
                  )}
                  {selectedEntry.data.context && (
                    <div className="text-xs text-red-500 mt-2">
                      Context: {selectedEntry.data.context}
                    </div>
                  )}
                </div>
              )}

              {/* Retry Specific */}
              {selectedEntry.type === 'retry' && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    Retry Info
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-yellow-600 dark:text-yellow-400">Attempt</div>
                    <div className="text-yellow-800 dark:text-yellow-200">
                      {selectedEntry.data.attempt} / {selectedEntry.data.maxRetries}
                    </div>
                    <div className="text-yellow-600 dark:text-yellow-400">Delay</div>
                    <div className="text-yellow-800 dark:text-yellow-200">
                      {formatDuration(selectedEntry.data.delayMs)}
                    </div>
                    <div className="text-yellow-600 dark:text-yellow-400">Error</div>
                    <div className="text-yellow-800 dark:text-yellow-200">
                      {selectedEntry.data.error}
                    </div>
                  </div>
                </div>
              )}

              {/* Raw Data (fallback for other types) */}
              {!['tool_call', 'tool_result', 'request', 'response', 'error', 'retry'].includes(
                selectedEntry.type
              ) && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Raw Data</h4>
                  <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-60 text-gray-700 dark:text-gray-300">
                    {JSON.stringify(selectedEntry.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
