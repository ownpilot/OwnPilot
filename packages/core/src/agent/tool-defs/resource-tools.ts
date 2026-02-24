/**
 * Resource Tool Definitions
 *
 * Tool schemas for tasks, notes, and bookmarks.
 */

import type { ToolDefinition } from '../types.js';

export const RESOURCE_TOOL_DEFS: readonly ToolDefinition[] = [
  // ===== TASK & REMINDER TOOLS =====
  {
    name: 'create_task',
    description: 'Create a task or reminder and save to workspace',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        due_date: {
          type: 'string',
          description: 'Due date (ISO format or natural language)',
        },
        priority: {
          type: 'string',
          description: 'Priority: low, medium, high',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks from workspace',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter: all, pending, completed, overdue (default: all)',
        },
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to complete',
        },
      },
      required: ['task_id'],
    },
  },
  // ===== NOTE TAKING TOOLS =====
  {
    name: 'create_note',
    description: 'Create a note in the workspace with automatic organization',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Note title',
        },
        content: {
          type: 'string',
          description: 'Note content (supports Markdown)',
        },
        category: {
          type: 'string',
          description: 'Category for organization (creates subfolder)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for the note',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search notes in workspace by title, content, or tags',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Limit search to category',
        },
      },
      required: ['query'],
    },
  },
  // ===== BOOKMARK & LINK TOOLS =====
  {
    name: 'create_bookmark',
    description: 'Save a bookmark/link with title and description',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to bookmark',
        },
        title: {
          type: 'string',
          description: 'Bookmark title',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['url', 'title'],
    },
  },
  {
    name: 'list_bookmarks',
    description: 'List saved bookmarks',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
        search: {
          type: 'string',
          description: 'Search in title/description',
        },
      },
    },
  },
];
