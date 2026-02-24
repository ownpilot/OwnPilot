/**
 * Tests for resource tool executors
 *
 * Covers: create_task, list_tasks, complete_task, create_note, search_notes,
 *         create_bookmark, list_bookmarks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

const mockMkdir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockReaddir = vi.hoisted(() => vi.fn());

const mockResolveWorkspacePath = vi.hoisted(() => vi.fn());
const mockRandomUUID = vi.hoisted(() => vi.fn(() => 'abcdef01-2345-6789-abcd-ef0123456789'));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  readdir: mockReaddir,
}));

vi.mock('./helpers.js', () => ({
  resolveWorkspacePath: mockResolveWorkspacePath,
  getWorkspacePath: () => '/workspace',
  WORKSPACE_DIR: 'workspace',
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { RESOURCE_EXECUTORS } from './resource-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
}

// =============================================================================
// create_task
// =============================================================================

describe('RESOURCE_EXECUTORS.create_task', () => {
  const fn = RESOURCE_EXECUTORS.create_task!;

  beforeEach(resetMocks);

  it('creates a task with minimum fields', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ title: 'Buy groceries' });
    expect(result.content).toContain('Task created');
    expect(result.content).toContain('Buy groceries');
    expect(result.content).toContain('abcdef01'); // ID from UUID mock
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('creates a task with all fields', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({
      title: 'Review PR',
      description: 'Review pull request #42',
      due_date: '2026-03-01',
      priority: 'high',
      tags: ['work', 'urgent'],
    });
    expect(result.content).toContain('Review PR');
    expect(result.content).toContain('Review pull request #42');
    expect(result.content).toContain('Due: 2026-03-01');
    expect(result.content).toContain('high');
    expect(result.content).toContain('work, urgent');
  });

  it('uses default priority and empty tags when not specified', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ title: 'Simple task' });
    expect(result.content).toContain('medium');
  });

  it('appends to existing tasks file', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks');
    mockExistsSync.mockReturnValue(true); // tasks dir and file exist
    mockReadFile.mockResolvedValue(JSON.stringify([{ id: 'old', title: 'Old task' }]));

    await fn({ title: 'New task' });
    // Written array should have 2 items
    const writtenData = JSON.parse(mockWriteFile.mock.calls[0]![1]);
    expect(writtenData).toHaveLength(2);
    expect(writtenData[0].id).toBe('old');
    expect(writtenData[1].title).toBe('New task');
  });

  it('handles null resolveWorkspacePath gracefully', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);

    const result = await fn({ title: 'No workspace' });
    // Task is still "created" — just not persisted to disk
    expect(result.content).toContain('Task created');
  });

  it('does not show description line when not provided', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ title: 'No desc' });
    expect(result.content).not.toContain('\uD83D\uDCDD');
  });

  it('does not show due date line when not provided', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ title: 'No due' });
    expect(result.content).not.toContain('Due:');
  });

  it('does not show tags line when tags array is empty', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ title: 'No tags', tags: [] });
    expect(result.content).not.toContain('Tags:');
  });
});

// =============================================================================
// list_tasks
// =============================================================================

describe('RESOURCE_EXECUTORS.list_tasks', () => {
  const fn = RESOURCE_EXECUTORS.list_tasks!;

  beforeEach(resetMocks);

  it('returns "no tasks" when file does not exist', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({});
    expect(result.content).toContain('No tasks found');
  });

  it('returns "no tasks" when resolvedPath exists but file missing', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(false);
    const result = await fn({});
    expect(result.content).toContain('No tasks found');
  });

  it('lists all tasks with no filter', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Task A', status: 'pending', priority: 'high' },
        { id: '2', title: 'Task B', status: 'completed', priority: 'low' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('Tasks (2)');
    expect(result.content).toContain('Task A');
    expect(result.content).toContain('Task B');
  });

  it('filters by pending status', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Pending', status: 'pending', priority: 'medium' },
        { id: '2', title: 'Done', status: 'completed', priority: 'medium' },
      ])
    );

    const result = await fn({ filter: 'pending' });
    expect(result.content).toContain('Pending');
    expect(result.content).not.toContain('Done');
  });

  it('filters by completed status', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Pending', status: 'pending', priority: 'medium' },
        { id: '2', title: 'Done', status: 'completed', priority: 'medium' },
      ])
    );

    const result = await fn({ filter: 'completed' });
    expect(result.content).not.toContain('[1]');
    expect(result.content).toContain('Done');
  });

  it('filters by overdue status', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        {
          id: '1',
          title: 'Overdue',
          status: 'pending',
          priority: 'high',
          dueDate: '2020-01-01',
        },
        {
          id: '2',
          title: 'Future',
          status: 'pending',
          priority: 'low',
          dueDate: '2099-12-31',
        },
        {
          id: '3',
          title: 'No due',
          status: 'pending',
          priority: 'medium',
        },
      ])
    );

    const result = await fn({ filter: 'overdue' });
    expect(result.content).toContain('Overdue');
    expect(result.content).not.toContain('Future');
    expect(result.content).not.toContain('No due');
  });

  it('filters by tag', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Tagged', status: 'pending', priority: 'medium', tags: ['work'] },
        { id: '2', title: 'Untagged', status: 'pending', priority: 'medium', tags: [] },
      ])
    );

    const result = await fn({ tag: 'work' });
    expect(result.content).toContain('Tagged');
    expect(result.content).not.toContain('Untagged');
  });

  it('returns no match message when all tasks filtered out', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'A', status: 'completed', priority: 'medium' },
      ])
    );

    const result = await fn({ filter: 'pending' });
    expect(result.content).toContain('No tasks match');
  });

  it('shows due date in task list when present', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Task', status: 'pending', priority: 'medium', dueDate: '2026-05-01' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('Due: 2026-05-01');
  });

  it('shows correct emoji for high priority', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'High', status: 'pending', priority: 'high' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('\uD83D\uDD34'); // red circle
  });

  it('shows correct emoji for low priority', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Low', status: 'pending', priority: 'low' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('\uD83D\uDFE2'); // green circle
  });

  it('shows correct emoji for medium priority', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Med', status: 'pending', priority: 'medium' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('\uD83D\uDFE1'); // yellow circle
  });

  it('shows checkmark for completed tasks', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', title: 'Done', status: 'completed', priority: 'medium' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('\u2705'); // checkmark
  });
});

// =============================================================================
// complete_task
// =============================================================================

describe('RESOURCE_EXECUTORS.complete_task', () => {
  const fn = RESOURCE_EXECUTORS.complete_task!;

  beforeEach(resetMocks);

  it('returns error when no tasks file exists (null path)', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ task_id: 'abc' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('No tasks found');
  });

  it('returns error when no tasks file exists (missing file)', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(false);
    const result = await fn({ task_id: 'abc' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('No tasks found');
  });

  it('returns error when task ID not found', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([{ id: 'xyz', title: 'Other', status: 'pending' }])
    );

    const result = await fn({ task_id: 'abc' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Task not found');
  });

  it('completes a task successfully', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/tasks/tasks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([{ id: 'abc', title: 'My Task', status: 'pending' }])
    );

    const result = await fn({ task_id: 'abc' });
    expect(result.content).toContain('Task completed');
    expect(result.content).toContain('My Task');

    // Verify the task was written with completed status
    const written = JSON.parse(mockWriteFile.mock.calls[0]![1]);
    expect(written[0].status).toBe('completed');
  });
});

// =============================================================================
// create_note
// =============================================================================

describe('RESOURCE_EXECUTORS.create_note', () => {
  const fn = RESOURCE_EXECUTORS.create_note!;

  beforeEach(resetMocks);

  it('returns error when path is invalid', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ title: 'Note', content: 'text' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('creates a note with default category', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/general');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ title: 'My Note', content: 'Note body' });
    expect(result.content).toContain('Note created');
    expect(result.content).toContain('notes/general/my-note.md');
    expect(mockWriteFile).toHaveBeenCalled();
    const written = mockWriteFile.mock.calls[0]![1];
    expect(written).toContain('title: My Note');
    expect(written).toContain('category: general');
    expect(written).toContain('Note body');
  });

  it('creates a note with custom category and tags', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/recipes');
    mockExistsSync.mockReturnValue(true); // dir already exists

    const result = await fn({
      title: 'Pasta Recipe',
      content: 'Cook pasta',
      category: 'recipes',
      tags: ['food', 'italian'],
    });
    expect(result.content).toContain('notes/recipes/pasta-recipe.md');
    const written = mockWriteFile.mock.calls[0]![1];
    expect(written).toContain('tags: [food, italian]');
  });

  it('slugifies title with special characters', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/general');
    mockExistsSync.mockReturnValue(true);

    await fn({ title: 'Hello World!!! 123', content: 'body' });
    const filepath = mockWriteFile.mock.calls[0]![0];
    expect(filepath).toContain('hello-world-123.md');
  });

  it('creates directory when it does not exist', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/general');
    mockExistsSync.mockReturnValue(false);

    await fn({ title: 'Note', content: 'body' });
    expect(mockMkdir).toHaveBeenCalledWith('/workspace/notes/general', { recursive: true });
  });

  it('does not create directory when it exists', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/general');
    mockExistsSync.mockReturnValue(true);

    await fn({ title: 'Note', content: 'body' });
    expect(mockMkdir).not.toHaveBeenCalled();
  });
});

// =============================================================================
// search_notes
// =============================================================================

describe('RESOURCE_EXECUTORS.search_notes', () => {
  const fn = RESOURCE_EXECUTORS.search_notes!;

  beforeEach(resetMocks);

  it('returns "no notes" when path is invalid', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ query: 'test' });
    expect(result.content).toContain('No notes found');
  });

  it('returns "no notes" when directory does not exist', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ query: 'test' });
    expect(result.content).toContain('No notes found');
  });

  it('searches notes in root notes directory', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'match.md', isDirectory: () => false },
      { name: 'other.md', isDirectory: () => false },
    ]);
    mockReadFile
      .mockResolvedValueOnce('This contains the search term test')
      .mockResolvedValueOnce('Nothing here');

    const result = await fn({ query: 'test' });
    expect(result.content).toContain('Found 1 note');
    expect(result.content).toContain('match.md');
  });

  it('searches notes with category filter', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes/recipes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'pasta.md', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValue('Pasta recipe');

    const result = await fn({ query: 'pasta', category: 'recipes' });
    expect(result.content).toContain('pasta.md');
  });

  it('matches by filename', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'testfile.md', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValue('No match in content');

    const result = await fn({ query: 'testfile' });
    expect(result.content).toContain('testfile.md');
  });

  it('recurses into subdirectories', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);

    mockReaddir.mockResolvedValueOnce([
      { name: 'subcat', isDirectory: () => true },
    ]);
    mockReaddir.mockResolvedValueOnce([
      { name: 'deep.md', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValue('Found the query term');

    const result = await fn({ query: 'query' });
    expect(result.content).toContain('subcat/deep.md');
  });

  it('returns no match message when nothing found', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'note.md', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValue('Nothing relevant');

    const result = await fn({ query: 'xyznonexistent' });
    expect(result.content).toContain('No notes found matching');
  });

  it('ignores non-md files', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'image.png', isDirectory: () => false },
    ]);

    const result = await fn({ query: 'anything' });
    expect(result.content).toContain('No notes found matching');
    // readFile should not have been called for .png
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('search is case-insensitive', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/notes');
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([
      { name: 'note.md', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValue('IMPORTANT NOTE');

    const result = await fn({ query: 'important' });
    expect(result.content).toContain('note.md');
  });
});

// =============================================================================
// create_bookmark
// =============================================================================

describe('RESOURCE_EXECUTORS.create_bookmark', () => {
  const fn = RESOURCE_EXECUTORS.create_bookmark!;

  beforeEach(resetMocks);

  it('creates a bookmark with minimum fields', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ url: 'https://example.com', title: 'Example' });
    expect(result.content).toContain('Bookmark saved');
    expect(result.content).toContain('Example');
    expect(result.content).toContain('https://example.com');
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('creates a bookmark with description and tags', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks');
    mockExistsSync.mockReturnValue(false);

    const result = await fn({
      url: 'https://github.com',
      title: 'GitHub',
      description: 'Code hosting',
      tags: ['dev', 'code'],
    });
    expect(result.content).toContain('GitHub');
    expect(result.content).toContain('Code hosting');
    expect(result.content).toContain('dev, code');
  });

  it('appends to existing bookmarks file', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks');
    // bookmarks dir exists, bookmarks.json exists
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([{ id: 'old', url: 'https://old.com', title: 'Old' }])
    );

    await fn({ url: 'https://new.com', title: 'New' });
    const written = JSON.parse(mockWriteFile.mock.calls[0]![1]);
    expect(written).toHaveLength(2);
  });

  it('handles null resolveWorkspacePath gracefully', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ url: 'https://example.com', title: 'Test' });
    expect(result.content).toContain('Bookmark saved');
  });

  it('does not show description when not provided', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ url: 'https://example.com', title: 'Test' });
    // The note emoji is used for description
    const lines = (result.content as string).split('\n');
    const hasDescLine = lines.some((l: string) => l.includes('\uD83D\uDCDD'));
    expect(hasDescLine).toBe(false);
  });

  it('does not show tags when empty', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ url: 'https://example.com', title: 'Test', tags: [] });
    const content = result.content as string;
    expect(content).not.toContain('\uD83C\uDFF7');
  });
});

// =============================================================================
// list_bookmarks
// =============================================================================

describe('RESOURCE_EXECUTORS.list_bookmarks', () => {
  const fn = RESOURCE_EXECUTORS.list_bookmarks!;

  beforeEach(resetMocks);

  it('returns "no bookmarks" when file does not exist', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({});
    expect(result.content).toContain('No bookmarks found');
  });

  it('returns "no bookmarks" when path exists but file missing', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(false);
    const result = await fn({});
    expect(result.content).toContain('No bookmarks found');
  });

  it('lists all bookmarks with no filter', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://a.com', title: 'A', createdAt: '2026-01-01' },
        { id: '2', url: 'https://b.com', title: 'B', createdAt: '2026-01-02' },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('Bookmarks (2)');
    expect(result.content).toContain('A');
    expect(result.content).toContain('B');
  });

  it('filters by tag', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://a.com', title: 'A', tags: ['dev'], createdAt: '2026-01-01' },
        { id: '2', url: 'https://b.com', title: 'B', tags: ['misc'], createdAt: '2026-01-02' },
      ])
    );

    const result = await fn({ tag: 'dev' });
    expect(result.content).toContain('A');
    expect(result.content).not.toContain('\nB\n');
  });

  it('filters by search query on title', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://github.com', title: 'GitHub', createdAt: '2026-01-01' },
        { id: '2', url: 'https://gitlab.com', title: 'GitLab', createdAt: '2026-01-02' },
      ])
    );

    const result = await fn({ search: 'hub' });
    expect(result.content).toContain('GitHub');
    expect(result.content).toContain('Bookmarks (1)');
  });

  it('filters by search query on description', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        {
          id: '1',
          url: 'https://a.com',
          title: 'A',
          description: 'Code hosting platform',
          createdAt: '2026-01-01',
        },
        {
          id: '2',
          url: 'https://b.com',
          title: 'B',
          description: 'Shopping site',
          createdAt: '2026-01-02',
        },
      ])
    );

    const result = await fn({ search: 'hosting' });
    expect(result.content).toContain('A');
    expect(result.content).toContain('Bookmarks (1)');
  });

  it('filters by search query on URL', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://github.com', title: 'GH', createdAt: '2026-01-01' },
        { id: '2', url: 'https://example.com', title: 'EX', createdAt: '2026-01-02' },
      ])
    );

    const result = await fn({ search: 'github' });
    expect(result.content).toContain('GH');
    expect(result.content).toContain('Bookmarks (1)');
  });

  it('returns no match message when all filtered out', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://a.com', title: 'A', tags: ['x'], createdAt: '2026-01-01' },
      ])
    );

    const result = await fn({ tag: 'nonexistent' });
    expect(result.content).toContain('No bookmarks match');
  });

  it('shows tags in bookmark listing', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        {
          id: '1',
          url: 'https://a.com',
          title: 'A',
          tags: ['tag1', 'tag2'],
          createdAt: '2026-01-01',
        },
      ])
    );

    const result = await fn({});
    expect(result.content).toContain('tag1, tag2');
  });

  it('does not show tags line when no tags', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://a.com', title: 'A', tags: [], createdAt: '2026-01-01' },
      ])
    );

    const result = await fn({});
    expect(result.content).not.toContain('\uD83C\uDFF7');
  });

  it('search is case-insensitive', async () => {
    mockResolveWorkspacePath.mockReturnValue('/workspace/bookmarks/bookmarks.json');
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: '1', url: 'https://a.com', title: 'GitHub Pages', createdAt: '2026-01-01' },
      ])
    );

    const result = await fn({ search: 'GITHUB' });
    expect(result.content).toContain('GitHub Pages');
  });
});
