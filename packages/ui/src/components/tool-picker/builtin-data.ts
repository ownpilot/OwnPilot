/**
 * The built-in data sources offered by ToolPicker.
 *
 * Data only — extracted from ToolPicker.tsx.
 */

import type { ResourceItem } from './types';

export const BUILTIN_DATA_ITEMS: ResourceItem[] = [
  {
    name: 'tasks',
    description: 'Task management — todos, checklists, task tracking',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'bookmarks',
    description: 'Saved URL bookmarks and web links',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'notes',
    description: 'Personal notes and text snippets',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'calendar',
    description: 'Calendar events and scheduling',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'contacts',
    description: 'Contact information and address book',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'memories',
    description: 'AI memory and persistent knowledge',
    category: 'AI Data',
    type: 'builtin-data',
  },
  {
    name: 'goals',
    description: 'Long-term goals and objectives tracking',
    category: 'AI Data',
    type: 'builtin-data',
  },
];
