export const STATUS_COLORS: Record<string, string> = {
  enabled: 'bg-success/20 text-success',
  disabled: 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted',
  error: 'bg-error/20 text-error',
};

export const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  communication: 'bg-green-500/20 text-green-600 dark:text-green-400',
  utilities: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400',
  data: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  integrations: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  media: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
  developer: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  lifestyle: 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
  other: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
};

export const EXTENSION_CATEGORIES = [
  'developer',
  'productivity',
  'communication',
  'data',
  'utilities',
  'integrations',
  'media',
  'lifestyle',
  'other',
] as const;

export const TOOL_PERMISSIONS = ['network', 'filesystem', 'database', 'system'] as const;

export const DEFAULT_PARAMS = '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}';
export const DEFAULT_CODE =
  '// Access arguments via `args` object\n// Use `config.get(service, field)` for service config\n// Return { content: { ... } }\nreturn { content: { result: "ok" } };';

export interface ToolDraft {
  name: string;
  description: string;
  parameters: string;
  code: string;
  permissions: string[];
  requiresApproval: boolean;
  expanded: boolean;
}
