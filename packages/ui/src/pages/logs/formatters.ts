/**
 * Pure display helpers shared by the LogsPage tabs.
 *
 * Extracted from LogsPage.tsx, where they were re-created on every render as
 * closures despite depending on nothing from the component.
 */

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTokens(tokens: number | null): string {
  if (tokens === null) return '-';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString();
}

export function getStatusColor(statusCode: number | null, hasError: boolean): string {
  if (hasError || (statusCode && statusCode >= 400)) {
    return 'text-red-500 bg-red-100 dark:bg-red-900/20';
  }
  return 'text-green-500 bg-green-100 dark:bg-green-900/20';
}

export function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    chat: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completion: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    embedding: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    tool: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    agent: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
    other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400',
  };
  return colors[type] || colors.other!;
}

export function getDebugTypeColor(type: string): string {
  const colors: Record<string, string> = {
    tool_call: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    tool_result: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    request: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    response: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    retry: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  };
  return colors[type] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400';
}

export function getDebugTypeIcon(type: string): string {
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
}
