/**
 * Tool page constants
 */

// Category display order
export const CATEGORY_ORDER = [
  'core', 'filesystem', 'memory', 'goals',
  'tasks', 'bookmarks', 'notes', 'calendar', 'contacts',
  'customData', 'textUtils', 'dateTime', 'conversion',
  'generation', 'extraction', 'validation', 'listOps', 'mathStats',
  'email', 'image', 'audio', 'weather',
  'automation', 'plugins', 'other'
];

// Category display names
export const CATEGORY_NAMES: Record<string, string> = {
  core: 'Core',
  filesystem: 'File System',
  memory: 'Memory',
  goals: 'Goals',
  tasks: 'Tasks',
  bookmarks: 'Bookmarks',
  notes: 'Notes',
  calendar: 'Calendar',
  contacts: 'Contacts',
  customData: 'Custom Data',
  textUtils: 'Text Utilities',
  dateTime: 'Date & Time',
  conversion: 'Conversion',
  generation: 'Generation',
  extraction: 'Extraction',
  validation: 'Validation',
  listOps: 'List Operations',
  mathStats: 'Math & Stats',
  email: 'Email',
  image: 'Image',
  audio: 'Audio',
  weather: 'Weather',
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
