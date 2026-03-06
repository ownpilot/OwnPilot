export const FORMAT_BADGE_COLORS: Record<string, string> = {
  agentskills: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  ownpilot: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
};

export const FORMAT_LABELS: Record<string, string> = {
  agentskills: 'SKILL.md',
  ownpilot: 'Extension',
};

// Re-export from extensions constants for convenience
export { STATUS_COLORS, CATEGORY_COLORS, EXTENSION_CATEGORIES } from '../extensions/constants';
