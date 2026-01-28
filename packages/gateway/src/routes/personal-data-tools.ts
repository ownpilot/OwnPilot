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

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute personal data tool
 */
export async function executePersonalDataTool(
  toolId: string,
  params: Record<string, unknown>,
  userId: string = 'default'
): Promise<ToolExecutionResult> {
  try {
    switch (toolId) {
      // =====================================================
      // TASK TOOLS
      // =====================================================
      case 'add_task': {
        const repo = new TasksRepository(userId);
        // Map 'medium' to 'normal' for priority compatibility
        let priority = params.priority as string | undefined;
        if (priority === 'medium') priority = 'normal';
        const task = await repo.create({
          title: params.title as string,
          dueDate: params.dueDate as string | undefined,
          priority: priority as 'low' | 'normal' | 'high' | 'urgent' | undefined,
          category: params.category as string | undefined,
          description: params.notes as string | undefined,
        });
        return {
          success: true,
          result: {
            message: `Task "${task.title}" created successfully.`,
            task,
          },
        };
      }

      case 'list_tasks': {
        const repo = new TasksRepository(userId);
        // Map 'medium' to 'normal' for priority compatibility
        let priority = params.priority as string | undefined;
        if (priority === 'medium') priority = 'normal';
        const tasks = await repo.list({
          status: params.status as 'pending' | 'in_progress' | 'completed' | 'cancelled' | undefined,
          priority: priority as 'low' | 'normal' | 'high' | 'urgent' | undefined,
          category: params.category as string | undefined,
          search: params.search as string | undefined,
          limit: params.limit as number | undefined,
        });
        return {
          success: true,
          result: {
            message: `Found ${tasks.length} task(s).`,
            tasks,
          },
        };
      }

      case 'complete_task': {
        const repo = new TasksRepository(userId);
        const task = await repo.complete(params.taskId as string);
        if (!task) {
          return { success: false, error: `Task not found: ${params.taskId}` };
        }
        return {
          success: true,
          result: {
            message: `Task "${task.title}" marked as completed.`,
            task,
          },
        };
      }

      case 'update_task': {
        const repo = new TasksRepository(userId);
        const { taskId, ...updates } = params;
        const task = await repo.update(taskId as string, updates);
        if (!task) {
          return { success: false, error: `Task not found: ${taskId}` };
        }
        return {
          success: true,
          result: {
            message: `Task "${task.title}" updated.`,
            task,
          },
        };
      }

      case 'delete_task': {
        const repo = new TasksRepository(userId);
        const deleted = await repo.delete(params.taskId as string);
        if (!deleted) {
          return { success: false, error: `Task not found: ${params.taskId}` };
        }
        return {
          success: true,
          result: { message: 'Task deleted.' },
        };
      }

      // =====================================================
      // BOOKMARK TOOLS
      // =====================================================
      case 'add_bookmark': {
        const repo = new BookmarksRepository(userId);
        const url = params.url as string;
        // Title is required - use URL as fallback
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
          result: {
            message: `Bookmark "${bookmark.title}" saved.`,
            bookmark,
          },
        };
      }

      case 'list_bookmarks': {
        const repo = new BookmarksRepository(userId);
        const bookmarks = await repo.list({
          category: params.category as string | undefined,
          isFavorite: params.favorite as boolean | undefined,
          search: params.search as string | undefined,
          limit: params.limit as number | undefined,
        });
        return {
          success: true,
          result: {
            message: `Found ${bookmarks.length} bookmark(s).`,
            bookmarks,
          },
        };
      }

      case 'delete_bookmark': {
        const repo = new BookmarksRepository(userId);
        const deleted = await repo.delete(params.bookmarkId as string);
        if (!deleted) {
          return { success: false, error: `Bookmark not found: ${params.bookmarkId}` };
        }
        return {
          success: true,
          result: { message: 'Bookmark deleted.' },
        };
      }

      // =====================================================
      // NOTE TOOLS
      // =====================================================
      case 'add_note': {
        const repo = new NotesRepository(userId);
        const note = await repo.create({
          title: params.title as string,
          content: params.content as string,
          category: params.category as string | undefined,
          tags: params.tags as string[] | undefined,
          isPinned: params.isPinned as boolean | undefined,
        });
        return {
          success: true,
          result: {
            message: `Note "${note.title}" created.`,
            note,
          },
        };
      }

      case 'list_notes': {
        const repo = new NotesRepository(userId);
        const notes = await repo.list({
          category: params.category as string | undefined,
          isPinned: params.pinned as boolean | undefined,
          search: params.search as string | undefined,
          limit: params.limit as number | undefined,
        });
        return {
          success: true,
          result: {
            message: `Found ${notes.length} note(s).`,
            notes,
          },
        };
      }

      case 'update_note': {
        const repo = new NotesRepository(userId);
        const { noteId, ...updates } = params;
        const note = await repo.update(noteId as string, updates);
        if (!note) {
          return { success: false, error: `Note not found: ${noteId}` };
        }
        return {
          success: true,
          result: {
            message: `Note "${note.title}" updated.`,
            note,
          },
        };
      }

      case 'delete_note': {
        const repo = new NotesRepository(userId);
        const deleted = await repo.delete(params.noteId as string);
        if (!deleted) {
          return { success: false, error: `Note not found: ${params.noteId}` };
        }
        return {
          success: true,
          result: { message: 'Note deleted.' },
        };
      }

      // =====================================================
      // CALENDAR EVENT TOOLS
      // =====================================================
      case 'add_calendar_event': {
        const repo = new CalendarRepository(userId);
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
        const repo = new CalendarRepository(userId);
        const events = await repo.list({
          startAfter: params.startAfter as string | undefined,
          startBefore: params.startBefore as string | undefined,
          category: params.category as string | undefined,
          search: params.search as string | undefined,
          limit: params.limit as number | undefined,
        });
        return {
          success: true,
          result: {
            message: `Found ${events.length} event(s).`,
            events,
          },
        };
      }

      case 'delete_calendar_event': {
        const repo = new CalendarRepository(userId);
        const deleted = await repo.delete(params.eventId as string);
        if (!deleted) {
          return { success: false, error: `Event not found: ${params.eventId}` };
        }
        return {
          success: true,
          result: { message: 'Event deleted.' },
        };
      }

      // =====================================================
      // CONTACT TOOLS
      // =====================================================
      case 'add_contact': {
        const repo = new ContactsRepository(userId);
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
          result: {
            message: `Contact "${contact.name}" added.`,
            contact,
          },
        };
      }

      case 'list_contacts': {
        const repo = new ContactsRepository(userId);
        const contacts = await repo.list({
          relationship: params.relationship as string | undefined,
          company: params.company as string | undefined,
          isFavorite: params.favorite as boolean | undefined,
          search: params.search as string | undefined,
          limit: params.limit as number | undefined,
        });
        return {
          success: true,
          result: {
            message: `Found ${contacts.length} contact(s).`,
            contacts,
          },
        };
      }

      case 'update_contact': {
        const repo = new ContactsRepository(userId);
        const { contactId, ...updates } = params;
        const contact = await repo.update(contactId as string, updates);
        if (!contact) {
          return { success: false, error: `Contact not found: ${contactId}` };
        }
        return {
          success: true,
          result: {
            message: `Contact "${contact.name}" updated.`,
            contact,
          },
        };
      }

      case 'delete_contact': {
        const repo = new ContactsRepository(userId);
        const deleted = await repo.delete(params.contactId as string);
        if (!deleted) {
          return { success: false, error: `Contact not found: ${params.contactId}` };
        }
        return {
          success: true,
          result: { message: 'Contact deleted.' },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
