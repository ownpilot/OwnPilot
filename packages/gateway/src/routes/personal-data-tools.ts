/**
 * Personal Data Tool Executors
 *
 * Execute personal data tools (tasks, bookmarks, notes, calendar, contacts)
 * for AI agents.
 */

import {
  TasksRepository,
  BookmarksRepository,
  NotesRepository,
  CalendarRepository,
  ContactsRepository,
} from '../db/repositories/index.js';
import { sanitizeId, getErrorMessage } from './helpers.js';
import type { ToolExecutionResult } from '../services/tool-executor.js';

/** Maximum items allowed in a single batch operation. */
const MAX_BATCH_SIZE = 100;

type Params = Record<string, unknown>;

/** Map 'medium' to 'normal' for priority compatibility. */
function normalizePriority(value: string | undefined): string | undefined {
  return value === 'medium' ? 'normal' : value;
}

// ─── Task Tools ─────────────────────────────────────────────────

async function handleTaskTool(
  toolId: string,
  params: Params,
  repo: TasksRepository
): Promise<ToolExecutionResult | null> {
  switch (toolId) {
    case 'add_task': {
      const task = await repo.create({
        title: params.title as string,
        dueDate: params.dueDate as string | undefined,
        priority: normalizePriority(params.priority as string | undefined) as
          | 'low'
          | 'normal'
          | 'high'
          | 'urgent'
          | undefined,
        category: params.category as string | undefined,
        description: params.notes as string | undefined,
      });
      return {
        success: true,
        result: { message: `Task "${task.title}" created successfully.`, task },
      };
    }

    case 'list_tasks': {
      const tasks = await repo.list({
        status: params.status as 'pending' | 'in_progress' | 'completed' | 'cancelled' | undefined,
        priority: normalizePriority(params.priority as string | undefined) as
          | 'low'
          | 'normal'
          | 'high'
          | 'urgent'
          | undefined,
        category: params.category as string | undefined,
        search: params.search as string | undefined,
        limit: params.limit as number | undefined,
      });
      return {
        success: true,
        result: { message: `Found ${tasks.length} task(s).`, tasks },
      };
    }

    case 'complete_task': {
      const task = await repo.complete(params.taskId as string);
      if (!task) {
        return { success: false, error: `Task not found: ${sanitizeId(String(params.taskId))}` };
      }
      return {
        success: true,
        result: { message: `Task "${task.title}" marked as completed.`, task },
      };
    }

    case 'update_task': {
      const { taskId, ...updates } = params;
      const task = await repo.update(taskId as string, updates);
      if (!task) {
        return { success: false, error: `Task not found: ${sanitizeId(String(taskId))}` };
      }
      return {
        success: true,
        result: { message: `Task "${task.title}" updated.`, task },
      };
    }

    case 'delete_task': {
      const deleted = await repo.delete(params.taskId as string);
      if (!deleted) {
        return { success: false, error: `Task not found: ${sanitizeId(String(params.taskId))}` };
      }
      return { success: true, result: { message: 'Task deleted.' } };
    }

    case 'batch_add_tasks': {
      const tasksInput = params.tasks as Array<{
        title: string;
        dueDate?: string;
        priority?: string;
        category?: string;
        notes?: string;
      }>;

      if (!tasksInput || !Array.isArray(tasksInput)) {
        return { success: false, error: 'tasks must be an array' };
      }
      if (tasksInput.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
      }

      const results = [];
      for (const taskInput of tasksInput) {
        const task = await repo.create({
          title: taskInput.title,
          dueDate: taskInput.dueDate,
          priority: normalizePriority(taskInput.priority) as
            | 'low'
            | 'normal'
            | 'high'
            | 'urgent'
            | undefined,
          category: taskInput.category,
          description: taskInput.notes,
        });
        results.push(task);
      }

      return {
        success: true,
        result: { message: `Created ${results.length} task(s).`, tasks: results, count: results.length },
      };
    }

    default:
      return null;
  }
}

// ─── Bookmark Tools ─────────────────────────────────────────────

async function handleBookmarkTool(
  toolId: string,
  params: Params,
  repo: BookmarksRepository
): Promise<ToolExecutionResult | null> {
  switch (toolId) {
    case 'add_bookmark': {
      const url = params.url as string;
      const title = (params.title as string) || url;
      const bookmark = await repo.create({
        url,
        title,
        description: params.description as string | undefined,
        category: params.category as string | undefined,
        tags: params.tags as string[] | undefined,
        isFavorite: params.isFavorite as boolean | undefined,
      });
      return {
        success: true,
        result: { message: `Bookmark "${bookmark.title}" saved.`, bookmark },
      };
    }

    case 'list_bookmarks': {
      const bookmarks = await repo.list({
        category: params.category as string | undefined,
        isFavorite: params.favorite as boolean | undefined,
        search: params.search as string | undefined,
        limit: params.limit as number | undefined,
      });
      return {
        success: true,
        result: { message: `Found ${bookmarks.length} bookmark(s).`, bookmarks },
      };
    }

    case 'delete_bookmark': {
      const deleted = await repo.delete(params.bookmarkId as string);
      if (!deleted) {
        return {
          success: false,
          error: `Bookmark not found: ${sanitizeId(String(params.bookmarkId))}`,
        };
      }
      return { success: true, result: { message: 'Bookmark deleted.' } };
    }

    case 'batch_add_bookmarks': {
      const bookmarksInput = params.bookmarks as Array<{
        url: string;
        title?: string;
        description?: string;
        category?: string;
        tags?: string[];
        isFavorite?: boolean;
      }>;

      if (!bookmarksInput || !Array.isArray(bookmarksInput)) {
        return { success: false, error: 'bookmarks must be an array' };
      }
      if (bookmarksInput.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
      }

      const results = [];
      for (const input of bookmarksInput) {
        const bookmark = await repo.create({
          url: input.url,
          title: input.title || input.url,
          description: input.description,
          category: input.category,
          tags: input.tags,
          isFavorite: input.isFavorite,
        });
        results.push(bookmark);
      }

      return {
        success: true,
        result: {
          message: `Saved ${results.length} bookmark(s).`,
          bookmarks: results,
          count: results.length,
        },
      };
    }

    default:
      return null;
  }
}

// ─── Note Tools ─────────────────────────────────────────────────

async function handleNoteTool(
  toolId: string,
  params: Params,
  repo: NotesRepository
): Promise<ToolExecutionResult | null> {
  switch (toolId) {
    case 'add_note': {
      const note = await repo.create({
        title: params.title as string,
        content: params.content as string,
        category: params.category as string | undefined,
        tags: params.tags as string[] | undefined,
        isPinned: params.isPinned as boolean | undefined,
      });
      return {
        success: true,
        result: { message: `Note "${note.title}" created.`, note },
      };
    }

    case 'list_notes': {
      const notes = await repo.list({
        category: params.category as string | undefined,
        isPinned: params.pinned as boolean | undefined,
        search: params.search as string | undefined,
        limit: params.limit as number | undefined,
      });
      return {
        success: true,
        result: { message: `Found ${notes.length} note(s).`, notes },
      };
    }

    case 'update_note': {
      const { noteId, ...updates } = params;
      const note = await repo.update(noteId as string, updates);
      if (!note) {
        return { success: false, error: `Note not found: ${sanitizeId(String(noteId))}` };
      }
      return {
        success: true,
        result: { message: `Note "${note.title}" updated.`, note },
      };
    }

    case 'delete_note': {
      const deleted = await repo.delete(params.noteId as string);
      if (!deleted) {
        return { success: false, error: `Note not found: ${sanitizeId(String(params.noteId))}` };
      }
      return { success: true, result: { message: 'Note deleted.' } };
    }

    case 'batch_add_notes': {
      const notesInput = params.notes as Array<{
        title: string;
        content: string;
        category?: string;
        tags?: string[];
        isPinned?: boolean;
      }>;

      if (!notesInput || !Array.isArray(notesInput)) {
        return { success: false, error: 'notes must be an array' };
      }
      if (notesInput.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
      }

      const results = [];
      for (const input of notesInput) {
        const note = await repo.create({
          title: input.title,
          content: input.content,
          category: input.category,
          tags: input.tags,
          isPinned: input.isPinned,
        });
        results.push(note);
      }

      return {
        success: true,
        result: { message: `Created ${results.length} note(s).`, notes: results, count: results.length },
      };
    }

    default:
      return null;
  }
}

// ─── Calendar Tools ─────────────────────────────────────────────

async function handleCalendarTool(
  toolId: string,
  params: Params,
  repo: CalendarRepository
): Promise<ToolExecutionResult | null> {
  switch (toolId) {
    case 'add_calendar_event': {
      const event = await repo.create({
        title: params.title as string,
        startTime: params.startTime as string,
        endTime: params.endTime as string | undefined,
        allDay: (params.isAllDay || params.allDay) as boolean | undefined,
        location: params.location as string | undefined,
        description: params.description as string | undefined,
        category: params.category as string | undefined,
        reminderMinutes: (params.reminder || params.reminderMinutes) as number | undefined,
      });
      return {
        success: true,
        result: {
          message: `Event "${event.title}" created for ${new Date(event.startTime).toLocaleString()}.`,
          event,
        },
      };
    }

    case 'list_calendar_events': {
      const events = await repo.list({
        startAfter: params.startAfter as string | undefined,
        startBefore: params.startBefore as string | undefined,
        category: params.category as string | undefined,
        search: params.search as string | undefined,
        limit: params.limit as number | undefined,
      });
      return {
        success: true,
        result: { message: `Found ${events.length} event(s).`, events },
      };
    }

    case 'delete_calendar_event': {
      const deleted = await repo.delete(params.eventId as string);
      if (!deleted) {
        return {
          success: false,
          error: `Event not found: ${sanitizeId(String(params.eventId))}`,
        };
      }
      return { success: true, result: { message: 'Event deleted.' } };
    }

    case 'batch_add_calendar_events': {
      const eventsInput = params.events as Array<{
        title: string;
        startTime: string;
        endTime?: string;
        isAllDay?: boolean;
        location?: string;
        description?: string;
        category?: string;
        reminder?: number;
      }>;

      if (!eventsInput || !Array.isArray(eventsInput)) {
        return { success: false, error: 'events must be an array' };
      }
      if (eventsInput.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
      }

      const results = [];
      for (const input of eventsInput) {
        const event = await repo.create({
          title: input.title,
          startTime: input.startTime,
          endTime: input.endTime,
          allDay: input.isAllDay,
          location: input.location,
          description: input.description,
          category: input.category,
          reminderMinutes: input.reminder,
        });
        results.push(event);
      }

      return {
        success: true,
        result: { message: `Created ${results.length} event(s).`, events: results, count: results.length },
      };
    }

    default:
      return null;
  }
}

// ─── Contact Tools ──────────────────────────────────────────────

async function handleContactTool(
  toolId: string,
  params: Params,
  repo: ContactsRepository
): Promise<ToolExecutionResult | null> {
  switch (toolId) {
    case 'add_contact': {
      const contact = await repo.create({
        name: params.name as string,
        email: params.email as string | undefined,
        phone: params.phone as string | undefined,
        company: params.company as string | undefined,
        jobTitle: params.jobTitle as string | undefined,
        relationship: params.relationship as string | undefined,
        birthday: params.birthday as string | undefined,
        address: params.address as string | undefined,
        notes: params.notes as string | undefined,
        isFavorite: params.isFavorite as boolean | undefined,
      });
      return {
        success: true,
        result: { message: `Contact "${contact.name}" added.`, contact },
      };
    }

    case 'list_contacts': {
      const contacts = await repo.list({
        relationship: params.relationship as string | undefined,
        company: params.company as string | undefined,
        isFavorite: params.favorite as boolean | undefined,
        search: params.search as string | undefined,
        limit: params.limit as number | undefined,
      });
      return {
        success: true,
        result: { message: `Found ${contacts.length} contact(s).`, contacts },
      };
    }

    case 'update_contact': {
      const { contactId, ...updates } = params;
      const contact = await repo.update(contactId as string, updates);
      if (!contact) {
        return {
          success: false,
          error: `Contact not found: ${sanitizeId(String(contactId))}`,
        };
      }
      return {
        success: true,
        result: { message: `Contact "${contact.name}" updated.`, contact },
      };
    }

    case 'delete_contact': {
      const deleted = await repo.delete(params.contactId as string);
      if (!deleted) {
        return {
          success: false,
          error: `Contact not found: ${sanitizeId(String(params.contactId))}`,
        };
      }
      return { success: true, result: { message: 'Contact deleted.' } };
    }

    case 'batch_add_contacts': {
      const contactsInput = params.contacts as Array<{
        name: string;
        email?: string;
        phone?: string;
        company?: string;
        jobTitle?: string;
        relationship?: string;
        birthday?: string;
        address?: string;
        notes?: string;
        isFavorite?: boolean;
      }>;

      if (!contactsInput || !Array.isArray(contactsInput)) {
        return { success: false, error: 'contacts must be an array' };
      }
      if (contactsInput.length > MAX_BATCH_SIZE) {
        return { success: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
      }

      const results = [];
      for (const input of contactsInput) {
        const contact = await repo.create({
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          jobTitle: input.jobTitle,
          relationship: input.relationship,
          birthday: input.birthday,
          address: input.address,
          notes: input.notes,
          isFavorite: input.isFavorite,
        });
        results.push(contact);
      }

      return {
        success: true,
        result: {
          message: `Added ${results.length} contact(s).`,
          contacts: results,
          count: results.length,
        },
      };
    }

    default:
      return null;
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────

/**
 * Execute personal data tool
 */
export async function executePersonalDataTool(
  toolId: string,
  params: Params,
  userId: string = 'default'
): Promise<ToolExecutionResult> {
  try {
    let result: ToolExecutionResult | null = null;

    if (toolId.endsWith('_task') || toolId.endsWith('_tasks')) {
      result = await handleTaskTool(toolId, params, new TasksRepository(userId));
    } else if (toolId.endsWith('_bookmark') || toolId.endsWith('_bookmarks')) {
      result = await handleBookmarkTool(toolId, params, new BookmarksRepository(userId));
    } else if (toolId.includes('calendar')) {
      result = await handleCalendarTool(toolId, params, new CalendarRepository(userId));
    } else if (toolId.endsWith('_note') || toolId.endsWith('_notes')) {
      result = await handleNoteTool(toolId, params, new NotesRepository(userId));
    } else if (toolId.endsWith('_contact') || toolId.endsWith('_contacts')) {
      result = await handleContactTool(toolId, params, new ContactsRepository(userId));
    }

    return result ?? { success: false, error: `Unknown tool: ${sanitizeId(toolId)}` };
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}
