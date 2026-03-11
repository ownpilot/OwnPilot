/**
 * Personal Data Domain
 *
 * Bounded context for user personal information:
 * tasks, bookmarks, notes, calendar events, contacts,
 * memories, goals, custom data, artifacts.
 *
 * Tables: tasks, bookmarks, notes, calendar_events, contacts,
 *         memories, goals, goal_steps, custom_data_tables,
 *         custom_data_rows, artifacts
 *
 * Routes: /tasks, /bookmarks, /notes, /calendar, /contacts,
 *         /memories, /goals, /custom-data, /artifacts, /summary
 */

export const personalDataDomain = {
  name: 'personal-data' as const,

  routes: [
    '/api/v1/tasks',
    '/api/v1/bookmarks',
    '/api/v1/notes',
    '/api/v1/calendar',
    '/api/v1/contacts',
    '/api/v1/memories',
    '/api/v1/goals',
    '/api/v1/custom-data',
    '/api/v1/artifacts',
    '/api/v1/summary',
  ],

  tables: [
    'tasks',
    'bookmarks',
    'notes',
    'calendar_events',
    'contacts',
    'memories',
    'goals',
    'goal_steps',
    'custom_data_tables',
    'custom_data_rows',
    'artifacts',
  ],

  publicServices: [
    'memory-service',
    'goal-service',
    'custom-data-service',
    'artifact-service',
  ],
} as const;
