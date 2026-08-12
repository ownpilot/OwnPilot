/**
 * Search matching for ToolPicker's item lists.
 *
 * Extracted from ToolPicker.tsx. This is the only thing standing between a user
 * and a list of several hundred tools, and it encodes three decisions worth
 * pinning: the wildcards that mean "show everything", the separator folding that
 * makes `send email` find `send_email`, and the AND-across-words semantics.
 */

import type { ResourceItem } from './types';

export function matchesSearch(item: ResourceItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === '*') return true;
  const blob = [
    item.name,
    item.displayName || '',
    item.internalName || '',
    item.description,
    item.category || '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/[_-]/g, ' ');
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => blob.includes(w));
}
