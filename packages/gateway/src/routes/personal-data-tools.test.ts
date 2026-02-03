/**
 * Personal Data Tool Executors Tests
 *
 * Tests for tasks, bookmarks, notes, calendar events, and contacts tool execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock Repositories ──────────────────────────────────────────

const { mockTasksRepo, mockBookmarksRepo, mockNotesRepo, mockCalendarRepo, mockContactsRepo } = vi.hoisted(() => ({
  mockTasksRepo: {
    create: vi.fn(),
    list: vi.fn(),
    complete: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockBookmarksRepo: {
    create: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
  mockNotesRepo: {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockCalendarRepo: {
    create: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
  mockContactsRepo: {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../db/repositories/index.js', () => ({
  TasksRepository: vi.fn(() => mockTasksRepo),
  BookmarksRepository: vi.fn(() => mockBookmarksRepo),
  NotesRepository: vi.fn(() => mockNotesRepo),
  CalendarRepository: vi.fn(() => mockCalendarRepo),
  ContactsRepository: vi.fn(() => mockContactsRepo),
}));

// ─── Import ─────────────────────────────────────────────────────

import { executePersonalDataTool } from './personal-data-tools.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('executePersonalDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TASKS ──────────────────────────────────────────────────

  describe('Task tools', () => {
    it('add_task: should create a task', async () => {
      mockTasksRepo.create.mockResolvedValue({ id: 't-1', title: 'Buy milk' });

      const result = await executePersonalDataTool('add_task', { title: 'Buy milk', priority: 'high' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('Buy milk');
      expect(mockTasksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Buy milk', priority: 'high' })
      );
    });

    it('add_task: should map medium priority to normal', async () => {
      mockTasksRepo.create.mockResolvedValue({ id: 't-1', title: 'Test' });

      await executePersonalDataTool('add_task', { title: 'Test', priority: 'medium' });

      expect(mockTasksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'normal' })
      );
    });

    it('list_tasks: should return tasks', async () => {
      mockTasksRepo.list.mockResolvedValue([{ id: 't-1' }, { id: 't-2' }]);

      const result = await executePersonalDataTool('list_tasks', { status: 'pending' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('2 task(s)');
    });

    it('complete_task: should complete task', async () => {
      mockTasksRepo.complete.mockResolvedValue({ id: 't-1', title: 'Done' });

      const result = await executePersonalDataTool('complete_task', { taskId: 't-1' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('completed');
    });

    it('complete_task: should return error when not found', async () => {
      mockTasksRepo.complete.mockResolvedValue(null);

      const result = await executePersonalDataTool('complete_task', { taskId: 'missing' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('update_task: should update task', async () => {
      mockTasksRepo.update.mockResolvedValue({ id: 't-1', title: 'Updated' });

      const result = await executePersonalDataTool('update_task', { taskId: 't-1', title: 'Updated' });

      expect(result.success).toBe(true);
    });

    it('update_task: should return error when not found', async () => {
      mockTasksRepo.update.mockResolvedValue(null);

      const result = await executePersonalDataTool('update_task', { taskId: 'missing' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('delete_task: should delete task', async () => {
      mockTasksRepo.delete.mockResolvedValue(true);

      const result = await executePersonalDataTool('delete_task', { taskId: 't-1' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('deleted');
    });

    it('delete_task: should return error when not found', async () => {
      mockTasksRepo.delete.mockResolvedValue(false);

      const result = await executePersonalDataTool('delete_task', { taskId: 'missing' });

      expect(result.success).toBe(false);
    });

    it('batch_add_tasks: should create multiple tasks', async () => {
      mockTasksRepo.create
        .mockResolvedValueOnce({ id: 't-1', title: 'Task 1' })
        .mockResolvedValueOnce({ id: 't-2', title: 'Task 2' });

      const result = await executePersonalDataTool('batch_add_tasks', {
        tasks: [{ title: 'Task 1' }, { title: 'Task 2', priority: 'medium' }],
      });

      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      expect(data.count).toBe(2);
    });

    it('batch_add_tasks: should return error for invalid input', async () => {
      const result = await executePersonalDataTool('batch_add_tasks', { tasks: 'not-array' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be an array');
    });
  });

  // ─── BOOKMARKS ──────────────────────────────────────────────

  describe('Bookmark tools', () => {
    it('add_bookmark: should create a bookmark', async () => {
      mockBookmarksRepo.create.mockResolvedValue({ id: 'b-1', title: 'Example', url: 'https://example.com' });

      const result = await executePersonalDataTool('add_bookmark', { url: 'https://example.com', title: 'Example' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('Example');
    });

    it('add_bookmark: should use URL as fallback title', async () => {
      mockBookmarksRepo.create.mockResolvedValue({ id: 'b-1', title: 'https://example.com', url: 'https://example.com' });

      await executePersonalDataTool('add_bookmark', { url: 'https://example.com' });

      expect(mockBookmarksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'https://example.com' })
      );
    });

    it('list_bookmarks: should return bookmarks', async () => {
      mockBookmarksRepo.list.mockResolvedValue([{ id: 'b-1' }]);

      const result = await executePersonalDataTool('list_bookmarks', { search: 'test' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('1 bookmark(s)');
    });

    it('delete_bookmark: should delete bookmark', async () => {
      mockBookmarksRepo.delete.mockResolvedValue(true);

      const result = await executePersonalDataTool('delete_bookmark', { bookmarkId: 'b-1' });

      expect(result.success).toBe(true);
    });

    it('delete_bookmark: should return error when not found', async () => {
      mockBookmarksRepo.delete.mockResolvedValue(false);

      const result = await executePersonalDataTool('delete_bookmark', { bookmarkId: 'missing' });

      expect(result.success).toBe(false);
    });

    it('batch_add_bookmarks: should create multiple bookmarks', async () => {
      mockBookmarksRepo.create.mockResolvedValue({ id: 'b-1' });

      const result = await executePersonalDataTool('batch_add_bookmarks', {
        bookmarks: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).count).toBe(2);
    });

    it('batch_add_bookmarks: should return error for invalid input', async () => {
      const result = await executePersonalDataTool('batch_add_bookmarks', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be an array');
    });
  });

  // ─── NOTES ──────────────────────────────────────────────────

  describe('Note tools', () => {
    it('add_note: should create a note', async () => {
      mockNotesRepo.create.mockResolvedValue({ id: 'n-1', title: 'Ideas' });

      const result = await executePersonalDataTool('add_note', { title: 'Ideas', content: 'Some thoughts' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('Ideas');
    });

    it('list_notes: should return notes', async () => {
      mockNotesRepo.list.mockResolvedValue([]);

      const result = await executePersonalDataTool('list_notes', {});

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('0 note(s)');
    });

    it('update_note: should update note', async () => {
      mockNotesRepo.update.mockResolvedValue({ id: 'n-1', title: 'Updated' });

      const result = await executePersonalDataTool('update_note', { noteId: 'n-1', title: 'Updated' });

      expect(result.success).toBe(true);
    });

    it('update_note: should return error when not found', async () => {
      mockNotesRepo.update.mockResolvedValue(null);

      const result = await executePersonalDataTool('update_note', { noteId: 'missing' });

      expect(result.success).toBe(false);
    });

    it('delete_note: should delete note', async () => {
      mockNotesRepo.delete.mockResolvedValue(true);

      const result = await executePersonalDataTool('delete_note', { noteId: 'n-1' });

      expect(result.success).toBe(true);
    });

    it('batch_add_notes: should create multiple notes', async () => {
      mockNotesRepo.create.mockResolvedValue({ id: 'n-1' });

      const result = await executePersonalDataTool('batch_add_notes', {
        notes: [{ title: 'A', content: 'a' }, { title: 'B', content: 'b' }],
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).count).toBe(2);
    });
  });

  // ─── CALENDAR ───────────────────────────────────────────────

  describe('Calendar tools', () => {
    it('add_calendar_event: should create an event', async () => {
      mockCalendarRepo.create.mockResolvedValue({
        id: 'e-1', title: 'Meeting', startTime: '2024-06-01T10:00:00Z',
      });

      const result = await executePersonalDataTool('add_calendar_event', {
        title: 'Meeting', startTime: '2024-06-01T10:00:00Z',
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('Meeting');
    });

    it('list_calendar_events: should return events', async () => {
      mockCalendarRepo.list.mockResolvedValue([{ id: 'e-1' }, { id: 'e-2' }]);

      const result = await executePersonalDataTool('list_calendar_events', {
        startAfter: '2024-01-01',
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('2 event(s)');
    });

    it('delete_calendar_event: should delete event', async () => {
      mockCalendarRepo.delete.mockResolvedValue(true);

      const result = await executePersonalDataTool('delete_calendar_event', { eventId: 'e-1' });

      expect(result.success).toBe(true);
    });

    it('delete_calendar_event: should return error when not found', async () => {
      mockCalendarRepo.delete.mockResolvedValue(false);

      const result = await executePersonalDataTool('delete_calendar_event', { eventId: 'missing' });

      expect(result.success).toBe(false);
    });

    it('batch_add_calendar_events: should create multiple events', async () => {
      mockCalendarRepo.create.mockResolvedValue({ id: 'e-1' });

      const result = await executePersonalDataTool('batch_add_calendar_events', {
        events: [
          { title: 'Event A', startTime: '2024-06-01T10:00:00Z' },
          { title: 'Event B', startTime: '2024-06-02T10:00:00Z' },
        ],
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).count).toBe(2);
    });

    it('batch_add_calendar_events: should return error for invalid input', async () => {
      const result = await executePersonalDataTool('batch_add_calendar_events', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be an array');
    });
  });

  // ─── CONTACTS ───────────────────────────────────────────────

  describe('Contact tools', () => {
    it('add_contact: should create a contact', async () => {
      mockContactsRepo.create.mockResolvedValue({ id: 'c-1', name: 'John Doe' });

      const result = await executePersonalDataTool('add_contact', {
        name: 'John Doe', email: 'john@example.com',
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('John Doe');
    });

    it('list_contacts: should return contacts', async () => {
      mockContactsRepo.list.mockResolvedValue([{ id: 'c-1' }]);

      const result = await executePersonalDataTool('list_contacts', { search: 'John' });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).message).toContain('1 contact(s)');
    });

    it('update_contact: should update contact', async () => {
      mockContactsRepo.update.mockResolvedValue({ id: 'c-1', name: 'Jane Doe' });

      const result = await executePersonalDataTool('update_contact', {
        contactId: 'c-1', name: 'Jane Doe',
      });

      expect(result.success).toBe(true);
    });

    it('update_contact: should return error when not found', async () => {
      mockContactsRepo.update.mockResolvedValue(null);

      const result = await executePersonalDataTool('update_contact', { contactId: 'missing' });

      expect(result.success).toBe(false);
    });

    it('delete_contact: should delete contact', async () => {
      mockContactsRepo.delete.mockResolvedValue(true);

      const result = await executePersonalDataTool('delete_contact', { contactId: 'c-1' });

      expect(result.success).toBe(true);
    });

    it('batch_add_contacts: should create multiple contacts', async () => {
      mockContactsRepo.create.mockResolvedValue({ id: 'c-1' });

      const result = await executePersonalDataTool('batch_add_contacts', {
        contacts: [{ name: 'Alice' }, { name: 'Bob' }],
      });

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).count).toBe(2);
    });
  });

  // ─── EDGE CASES ─────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should return error for unknown tool', async () => {
      const result = await executePersonalDataTool('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('should catch and return thrown errors', async () => {
      mockTasksRepo.create.mockRejectedValue(new Error('Database connection lost'));

      const result = await executePersonalDataTool('add_task', { title: 'Fail' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
    });

    it('should use default userId when not provided', async () => {
      mockTasksRepo.list.mockResolvedValue([]);
      const { TasksRepository } = await import('../db/repositories/index.js');

      await executePersonalDataTool('list_tasks', {});

      expect(TasksRepository).toHaveBeenCalledWith('default');
    });

    it('should pass custom userId to repositories', async () => {
      mockNotesRepo.list.mockResolvedValue([]);
      const { NotesRepository } = await import('../db/repositories/index.js');

      await executePersonalDataTool('list_notes', {}, 'user-42');

      expect(NotesRepository).toHaveBeenCalledWith('user-42');
    });
  });
});
