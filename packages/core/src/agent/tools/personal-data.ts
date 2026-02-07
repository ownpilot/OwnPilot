/**
 * Personal Data Tools
 *
 * AI tools for managing user's personal data:
 * - Tasks (todo items with due dates, priorities)
 * - Bookmarks (saved URLs with categories)
 * - Notes (text notes with categories)
 * - Calendar Events (scheduled events)
 * - Contacts (people with contact info)
 */

import type { ToolDefinition } from '../types.js';

// ============================================================================
// TASK TOOLS
// ============================================================================

export const addTaskTool: ToolDefinition = {
  name: 'add_task',
  brief: 'Create a task with title, priority, and due date',
  description: `Add a new task/todo item. Use this for any task, todo, or action item the user wants to track.
This is the PREFERRED tool for todos - do NOT create custom tables for tasks.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Task title/description',
      },
      dueDate: {
        type: 'string',
        description: 'Due date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent'],
        description: 'Task priority level',
      },
      category: {
        type: 'string',
        description: 'Task category (e.g., "work", "personal", "shopping")',
      },
      notes: {
        type: 'string',
        description: 'Additional notes or details',
      },
    },
    required: ['title'],
  },
};

export const listTasksTool: ToolDefinition = {
  name: 'list_tasks',
  brief: 'List tasks filtered by status, priority, or date',
  description: `List user's tasks with optional filtering. Returns tasks sorted by due date.`,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'Filter by status',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent'],
        description: 'Filter by priority',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      search: {
        type: 'string',
        description: 'Search in task titles',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of tasks to return (default: 20)',
      },
    },
    required: [],
  },
};

export const completeTaskTool: ToolDefinition = {
  name: 'complete_task',
  brief: 'Mark a task as completed by ID',
  description: `Mark a task as completed.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The task ID to complete',
      },
    },
    required: ['taskId'],
  },
};

export const updateTaskTool: ToolDefinition = {
  name: 'update_task',
  brief: 'Update a task title, priority, due date, or status',
  description: `Update an existing task's details.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The task ID to update',
      },
      title: {
        type: 'string',
        description: 'New title',
      },
      dueDate: {
        type: 'string',
        description: 'New due date',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent'],
        description: 'New priority',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status',
      },
      category: {
        type: 'string',
        description: 'New category',
      },
      notes: {
        type: 'string',
        description: 'New notes',
      },
    },
    required: ['taskId'],
  },
};

export const deleteTaskTool: ToolDefinition = {
  name: 'delete_task',
  brief: 'Delete a task permanently by ID',
  description: `Delete a task permanently.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The task ID to delete',
      },
    },
    required: ['taskId'],
  },
};

export const batchAddTasksTool: ToolDefinition = {
  name: 'batch_add_tasks',
  brief: 'Create multiple tasks at once',
  description: `Add multiple tasks at once. Use this for bulk task creation instead of calling add_task multiple times.
Efficient for importing task lists, creating recurring task patterns, or adding multiple related items.`,
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Array of tasks to add',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Task title/description',
            },
            dueDate: {
              type: 'string',
              description: 'Due date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'urgent'],
              description: 'Task priority level',
            },
            category: {
              type: 'string',
              description: 'Task category',
            },
            notes: {
              type: 'string',
              description: 'Additional notes or details',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['tasks'],
  },
};

// ============================================================================
// BOOKMARK TOOLS
// ============================================================================

export const addBookmarkTool: ToolDefinition = {
  name: 'add_bookmark',
  brief: 'Save a URL with title and tags',
  description: `Save a URL as a bookmark. Use this for any website, article, or link the user wants to save.
This is the PREFERRED tool for bookmarks - do NOT create custom tables for bookmarks.`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to bookmark',
      },
      title: {
        type: 'string',
        description: 'Bookmark title (if not provided, will be auto-detected)',
      },
      description: {
        type: 'string',
        description: 'Brief description of the bookmark',
      },
      category: {
        type: 'string',
        description: 'Category (e.g., "reading", "tech", "recipes")',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for the bookmark',
      },
      isFavorite: {
        type: 'boolean',
        description: 'Whether to mark as favorite',
      },
    },
    required: ['url'],
  },
};

export const listBookmarksTool: ToolDefinition = {
  name: 'list_bookmarks',
  brief: 'List bookmarks with optional tag/search filter',
  description: `List user's bookmarks with optional filtering.`,
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      favorite: {
        type: 'boolean',
        description: 'Show only favorites',
      },
      search: {
        type: 'string',
        description: 'Search in titles and descriptions',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of bookmarks to return (default: 20)',
      },
    },
    required: [],
  },
};

export const deleteBookmarkTool: ToolDefinition = {
  name: 'delete_bookmark',
  brief: 'Delete a bookmark by ID',
  description: `Delete a bookmark.`,
  parameters: {
    type: 'object',
    properties: {
      bookmarkId: {
        type: 'string',
        description: 'The bookmark ID to delete',
      },
    },
    required: ['bookmarkId'],
  },
};

export const batchAddBookmarksTool: ToolDefinition = {
  name: 'batch_add_bookmarks',
  brief: 'Save multiple bookmarks at once',
  description: `Add multiple bookmarks at once. Use this for bulk bookmark import or saving multiple related links.
Efficient for importing browser bookmarks or saving research links.`,
  parameters: {
    type: 'object',
    properties: {
      bookmarks: {
        type: 'array',
        description: 'Array of bookmarks to add',
        items: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to bookmark',
            },
            title: {
              type: 'string',
              description: 'Bookmark title',
            },
            description: {
              type: 'string',
              description: 'Brief description of the bookmark',
            },
            category: {
              type: 'string',
              description: 'Category',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for the bookmark',
            },
            isFavorite: {
              type: 'boolean',
              description: 'Whether to mark as favorite',
            },
          },
          required: ['url'],
        },
      },
    },
    required: ['bookmarks'],
  },
};

// ============================================================================
// NOTE TOOLS
// ============================================================================

export const addNoteTool: ToolDefinition = {
  name: 'add_note',
  brief: 'Create a text note with optional tags',
  description: `Create a new note. Use this for any text content the user wants to save.
This is the PREFERRED tool for notes - do NOT create custom tables for notes.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Note title',
      },
      content: {
        type: 'string',
        description: 'Note content (supports markdown)',
      },
      category: {
        type: 'string',
        description: 'Category (e.g., "ideas", "meeting-notes", "personal")',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for the note',
      },
      isPinned: {
        type: 'boolean',
        description: 'Whether to pin the note',
      },
    },
    required: ['title', 'content'],
  },
};

export const listNotesTool: ToolDefinition = {
  name: 'list_notes',
  brief: 'List notes with optional tag/search filter',
  description: `List user's notes with optional filtering.`,
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      pinned: {
        type: 'boolean',
        description: 'Show only pinned notes',
      },
      search: {
        type: 'string',
        description: 'Search in titles and content',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of notes to return (default: 20)',
      },
    },
    required: [],
  },
};

export const updateNoteTool: ToolDefinition = {
  name: 'update_note',
  brief: 'Update a note title, content, or tags',
  description: `Update an existing note.`,
  parameters: {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description: 'The note ID to update',
      },
      title: {
        type: 'string',
        description: 'New title',
      },
      content: {
        type: 'string',
        description: 'New content',
      },
      category: {
        type: 'string',
        description: 'New category',
      },
    },
    required: ['noteId'],
  },
};

export const deleteNoteTool: ToolDefinition = {
  name: 'delete_note',
  brief: 'Delete a note permanently by ID',
  description: `Delete a note permanently.`,
  parameters: {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description: 'The note ID to delete',
      },
    },
    required: ['noteId'],
  },
};

export const batchAddNotesTool: ToolDefinition = {
  name: 'batch_add_notes',
  brief: 'Create multiple notes at once',
  description: `Add multiple notes at once. Use this for bulk note creation or importing notes.
Efficient for creating a series of related notes or importing from external sources.`,
  parameters: {
    type: 'object',
    properties: {
      notes: {
        type: 'array',
        description: 'Array of notes to add',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Note title',
            },
            content: {
              type: 'string',
              description: 'Note content (supports markdown)',
            },
            category: {
              type: 'string',
              description: 'Category',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for the note',
            },
            isPinned: {
              type: 'boolean',
              description: 'Whether to pin the note',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
    required: ['notes'],
  },
};

// ============================================================================
// CALENDAR/EVENT TOOLS
// ============================================================================

export const addEventTool: ToolDefinition = {
  name: 'add_calendar_event',
  brief: 'Create a calendar event with date, time, location',
  description: `Create a calendar event. Use this for appointments, meetings, or any scheduled activity.
This is the PREFERRED tool for events - do NOT create custom tables for calendar data.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Event title',
      },
      startTime: {
        type: 'string',
        description: 'Start time in ISO format (YYYY-MM-DDTHH:mm:ss)',
      },
      endTime: {
        type: 'string',
        description: 'End time in ISO format (optional for all-day events)',
      },
      isAllDay: {
        type: 'boolean',
        description: 'Whether this is an all-day event',
      },
      location: {
        type: 'string',
        description: 'Event location',
      },
      description: {
        type: 'string',
        description: 'Event description',
      },
      category: {
        type: 'string',
        description: 'Category (e.g., "meeting", "personal", "birthday")',
      },
      reminder: {
        type: 'number',
        description: 'Reminder in minutes before event (e.g., 15, 30, 60)',
      },
    },
    required: ['title', 'startTime'],
  },
};

export const listEventsTool: ToolDefinition = {
  name: 'list_calendar_events',
  brief: 'List events for a date range',
  description: `List calendar events with optional filtering.`,
  parameters: {
    type: 'object',
    properties: {
      startAfter: {
        type: 'string',
        description: 'Show events starting after this date (ISO format)',
      },
      startBefore: {
        type: 'string',
        description: 'Show events starting before this date (ISO format)',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      search: {
        type: 'string',
        description: 'Search in titles and descriptions',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 20)',
      },
    },
    required: [],
  },
};

export const deleteEventTool: ToolDefinition = {
  name: 'delete_calendar_event',
  brief: 'Delete a calendar event by ID',
  description: `Delete a calendar event.`,
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to delete',
      },
    },
    required: ['eventId'],
  },
};

export const batchAddEventsTool: ToolDefinition = {
  name: 'batch_add_calendar_events',
  brief: 'Create multiple calendar events at once',
  description: `Add multiple calendar events at once. Use this for bulk event creation.
Efficient for importing events, creating recurring patterns, or scheduling multiple meetings.`,
  parameters: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        description: 'Array of calendar events to add',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Event title',
            },
            startTime: {
              type: 'string',
              description: 'Start time in ISO format (YYYY-MM-DDTHH:mm:ss)',
            },
            endTime: {
              type: 'string',
              description: 'End time in ISO format',
            },
            isAllDay: {
              type: 'boolean',
              description: 'Whether this is an all-day event',
            },
            location: {
              type: 'string',
              description: 'Event location',
            },
            description: {
              type: 'string',
              description: 'Event description',
            },
            category: {
              type: 'string',
              description: 'Category',
            },
            reminder: {
              type: 'number',
              description: 'Reminder in minutes before event',
            },
          },
          required: ['title', 'startTime'],
        },
      },
    },
    required: ['events'],
  },
};

// ============================================================================
// CONTACT TOOLS
// ============================================================================

export const addContactTool: ToolDefinition = {
  name: 'add_contact',
  brief: 'Add a contact with name, phone, email',
  description: `Add a new contact. Use this for storing people's contact information.
This is the PREFERRED tool for contacts - do NOT create custom tables for contacts.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Contact name',
      },
      email: {
        type: 'string',
        description: 'Email address',
      },
      phone: {
        type: 'string',
        description: 'Phone number',
      },
      company: {
        type: 'string',
        description: 'Company/organization',
      },
      jobTitle: {
        type: 'string',
        description: 'Job title/role',
      },
      relationship: {
        type: 'string',
        description: 'Relationship type (e.g., "friend", "colleague", "family")',
      },
      birthday: {
        type: 'string',
        description: 'Birthday in YYYY-MM-DD format',
      },
      address: {
        type: 'string',
        description: 'Physical address',
      },
      notes: {
        type: 'string',
        description: 'Additional notes',
      },
      isFavorite: {
        type: 'boolean',
        description: 'Whether to mark as favorite',
      },
    },
    required: ['name'],
  },
};

export const listContactsTool: ToolDefinition = {
  name: 'list_contacts',
  brief: 'List contacts with optional search filter',
  description: `List contacts with optional filtering.`,
  parameters: {
    type: 'object',
    properties: {
      relationship: {
        type: 'string',
        description: 'Filter by relationship type',
      },
      company: {
        type: 'string',
        description: 'Filter by company',
      },
      favorite: {
        type: 'boolean',
        description: 'Show only favorites',
      },
      search: {
        type: 'string',
        description: 'Search in names, emails, and companies',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of contacts to return (default: 20)',
      },
    },
    required: [],
  },
};

export const updateContactTool: ToolDefinition = {
  name: 'update_contact',
  brief: 'Update a contact name, phone, email, or notes',
  description: `Update an existing contact's information.`,
  parameters: {
    type: 'object',
    properties: {
      contactId: {
        type: 'string',
        description: 'The contact ID to update',
      },
      name: {
        type: 'string',
        description: 'New name',
      },
      email: {
        type: 'string',
        description: 'New email',
      },
      phone: {
        type: 'string',
        description: 'New phone',
      },
      company: {
        type: 'string',
        description: 'New company',
      },
      notes: {
        type: 'string',
        description: 'New notes',
      },
    },
    required: ['contactId'],
  },
};

export const deleteContactTool: ToolDefinition = {
  name: 'delete_contact',
  brief: 'Delete a contact by ID',
  description: `Delete a contact.`,
  parameters: {
    type: 'object',
    properties: {
      contactId: {
        type: 'string',
        description: 'The contact ID to delete',
      },
    },
    required: ['contactId'],
  },
};

export const batchAddContactsTool: ToolDefinition = {
  name: 'batch_add_contacts',
  brief: 'Add multiple contacts at once',
  description: `Add multiple contacts at once. Use this for bulk contact import.
Efficient for importing contacts from external sources or adding multiple people at once.`,
  parameters: {
    type: 'object',
    properties: {
      contacts: {
        type: 'array',
        description: 'Array of contacts to add',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Contact name',
            },
            email: {
              type: 'string',
              description: 'Email address',
            },
            phone: {
              type: 'string',
              description: 'Phone number',
            },
            company: {
              type: 'string',
              description: 'Company/organization',
            },
            jobTitle: {
              type: 'string',
              description: 'Job title/role',
            },
            relationship: {
              type: 'string',
              description: 'Relationship type',
            },
            birthday: {
              type: 'string',
              description: 'Birthday in YYYY-MM-DD format',
            },
            address: {
              type: 'string',
              description: 'Physical address',
            },
            notes: {
              type: 'string',
              description: 'Additional notes',
            },
            isFavorite: {
              type: 'boolean',
              description: 'Whether to mark as favorite',
            },
          },
          required: ['name'],
        },
      },
    },
    required: ['contacts'],
  },
};

// ============================================================================
// EXPORT ALL PERSONAL DATA TOOLS
// ============================================================================

export const PERSONAL_DATA_TOOLS: ToolDefinition[] = [
  // Tasks
  addTaskTool,
  listTasksTool,
  completeTaskTool,
  updateTaskTool,
  deleteTaskTool,
  batchAddTasksTool,
  // Bookmarks
  addBookmarkTool,
  listBookmarksTool,
  deleteBookmarkTool,
  batchAddBookmarksTool,
  // Notes
  addNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
  batchAddNotesTool,
  // Calendar Events
  addEventTool,
  listEventsTool,
  deleteEventTool,
  batchAddEventsTool,
  // Contacts
  addContactTool,
  listContactsTool,
  updateContactTool,
  deleteContactTool,
  batchAddContactsTool,
];

/**
 * Get tool names for personal data operations
 */
export const PERSONAL_DATA_TOOL_NAMES = PERSONAL_DATA_TOOLS.map((t) => t.name);
