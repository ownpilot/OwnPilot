/**
 * SystemPage pure data + helpers.
 *
 * Extracted from SystemPage.tsx — no React: uptime formatting, the tool
 * dependency category color map, and the CSV export/import table list.
 */

/** Format a duration in seconds as a compact `1d 2h 3m 4s` string. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/** Category color map for tool dependency badges. */
export const CATEGORY_COLORS: Record<string, string> = {
  Email: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  Image: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  PDF: 'bg-red-500/10 text-red-600 dark:text-red-400',
  Audio: 'bg-green-500/10 text-green-600 dark:text-green-400',
  'Coding Agents': 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

/** Tables available for CSV export/import. */
export const CSV_TABLES = [
  'expenses',
  'habits',
  'bookmarks',
  'notes',
  'tasks',
  'contacts',
  'calendar_events',
  'captures',
] as const;
