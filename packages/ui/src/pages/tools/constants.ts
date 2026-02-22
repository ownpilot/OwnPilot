/**
 * Tool page constants
 */

// Category display order
export const CATEGORY_ORDER = [
  'core',
  'filesystem',
  'memory',
  'goals',
  'personalData',
  'customData',
  'utilities',
  'media',
  'communication',
  'devTools',
  'finance',
  'codeExecution',
  'webFetch',
  'automation',
  'plugins',
  'other',
];

// Category display names
export const CATEGORY_NAMES: Record<string, string> = {
  core: 'Core',
  filesystem: 'File System',
  memory: 'Memory',
  goals: 'Goals',
  personalData: 'Personal Data',
  customData: 'Custom Data',
  utilities: 'Utilities',
  media: 'Media',
  communication: 'Communication & Weather',
  devTools: 'Developer Tools',
  finance: 'Finance',
  codeExecution: 'Code Execution',
  webFetch: 'Web & API',
  automation: 'Automation',
  plugins: 'Plugins',
  other: 'Other',
};

// Source display names
export const SOURCE_NAMES: Record<string, string> = {
  core: 'Core Tool',
  memory: 'Memory System',
  goals: 'Goals System',
  customData: 'Custom Data',
  personalData: 'Personal Data',
  triggers: 'Triggers',
  plans: 'Plans',
  plugin: 'Plugin',
};

export const API_BASE = '/api/v1/tools';
