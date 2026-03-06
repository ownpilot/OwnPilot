/**
 * Resource CRUD tool executors
 *
 * Executors: create_task, list_tasks, complete_task, create_note, search_notes,
 *            create_bookmark, list_bookmarks
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolExecutor } from '../types.js';
import { resolveWorkspacePath } from './helpers.js';
import { safeJsonParseWithDefault } from '../../utils/safe-json.js';

export const RESOURCE_EXECUTORS: Record<string, ToolExecutor> = {
  create_task: async (args) => {
    const title = typeof args.title === 'string' ? args.title : String(args.title ?? '');
    const description = typeof args.description === 'string' ? args.description : undefined;
    const dueDate = typeof args.due_date === 'string' ? args.due_date : undefined;
    const priority = typeof args.priority === 'string' ? args.priority : 'medium';
    const tags = Array.isArray(args.tags)
      ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    const tasksPath = resolveWorkspacePath('tasks');
    if (!tasksPath) {
      return { content: 'Error: No workspace configured', isError: true };
    }

    const taskId = randomUUID().slice(0, 8);
    const task = {
      id: taskId,
      title,
      description,
      dueDate,
      priority,
      tags,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    if (!fs.existsSync(tasksPath)) {
      await fsp.mkdir(tasksPath, { recursive: true });
    }

    const tasksFile = path.join(tasksPath, 'tasks.json');
    let tasks: unknown[] = [];
    if (fs.existsSync(tasksFile)) {
      const content = await fsp.readFile(tasksFile, 'utf-8');
      tasks = safeJsonParseWithDefault<unknown[]>(content, []);
    }
    tasks.push(task);
    await fsp.writeFile(tasksFile, JSON.stringify(tasks, null, 2));

    return {
      content: `\u2705 Task created (ID: ${taskId})
\u{1F4CC} ${title}${description ? `\n\u{1F4DD} ${description}` : ''}${dueDate ? `\n\u{1F4C5} Due: ${dueDate}` : ''}
\u{1F3F7}\uFE0F Priority: ${priority}${tags.length ? `\n\u{1F516} Tags: ${tags.join(', ')}` : ''}`,
    };
  },

  list_tasks: async (args) => {
    const filter = typeof args.filter === 'string' ? args.filter : 'all';
    const tagFilter = typeof args.tag === 'string' ? args.tag : undefined;

    const tasksPath = resolveWorkspacePath('tasks/tasks.json');
    if (!tasksPath || !fs.existsSync(tasksPath)) {
      return { content: 'No tasks found. Create your first task!' };
    }

    const content = await fsp.readFile(tasksPath, 'utf-8');
    let tasks = safeJsonParseWithDefault<
      Array<{
        id: string;
        title: string;
        status: string;
        priority: string;
        dueDate?: string;
        tags?: string[];
      }>
    >(content, []);

    // Apply filters
    if (filter === 'pending') {
      tasks = tasks.filter((t) => t.status === 'pending');
    } else if (filter === 'completed') {
      tasks = tasks.filter((t) => t.status === 'completed');
    } else if (filter === 'overdue') {
      const now = new Date();
      tasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status === 'pending');
    }

    if (tagFilter) {
      tasks = tasks.filter((t) => t.tags?.includes(tagFilter));
    }

    if (tasks.length === 0) {
      return { content: 'No tasks match the filter.' };
    }

    const taskList = tasks.map((t) => {
      const status = t.status === 'completed' ? '\u2705' : '\u2B1C';
      const priority =
        t.priority === 'high' ? '\u{1F534}' : t.priority === 'low' ? '\u{1F7E2}' : '\u{1F7E1}';
      return `${status} ${priority} [${t.id}] ${t.title}${t.dueDate ? ` (Due: ${t.dueDate})` : ''}`;
    });

    return { content: `\u{1F4CB} Tasks (${tasks.length}):\n${taskList.join('\n')}` };
  },

  complete_task: async (args) => {
    const taskId = typeof args.task_id === 'string' ? args.task_id : String(args.task_id ?? '');

    const tasksPath = resolveWorkspacePath('tasks/tasks.json');
    if (!tasksPath || !fs.existsSync(tasksPath)) {
      return { content: 'Error: No tasks found', isError: true };
    }

    const content = await fsp.readFile(tasksPath, 'utf-8');
    const tasks = safeJsonParseWithDefault<
      Array<{
        id: string;
        title: string;
        status: string;
      }>
    >(content, []);

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { content: `Error: Task not found: ${taskId}`, isError: true };
    }

    task.status = 'completed';
    await fsp.writeFile(tasksPath, JSON.stringify(tasks, null, 2));

    return { content: `\u2705 Task completed: ${task.title}` };
  },

  create_note: async (args) => {
    const title = typeof args.title === 'string' ? args.title : String(args.title ?? '');
    const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');
    const category = typeof args.category === 'string' ? args.category : 'general';
    const tags = Array.isArray(args.tags)
      ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    const notesDir = resolveWorkspacePath(`notes/${category}`);
    if (!notesDir) {
      return { content: 'Error: Invalid path', isError: true };
    }

    if (!fs.existsSync(notesDir)) {
      await fsp.mkdir(notesDir, { recursive: true });
    }

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${slug}.md`;
    const filepath = path.join(notesDir, filename);

    const noteContent = `---
title: ${title}
category: ${category}
tags: [${tags.join(', ')}]
created: ${new Date().toISOString()}
---

${content}
`;

    await fsp.writeFile(filepath, noteContent);

    return { content: `\u{1F4DD} Note created: notes/${category}/${filename}` };
  },

  search_notes: async (args) => {
    const query = (
      typeof args.query === 'string' ? args.query : String(args.query ?? '')
    ).toLowerCase();
    const category = typeof args.category === 'string' ? args.category : undefined;

    const notesDir = resolveWorkspacePath(category ? `notes/${category}` : 'notes');
    if (!notesDir || !fs.existsSync(notesDir)) {
      return { content: 'No notes found.' };
    }

    const MAX_DEPTH = 5;
    const MAX_RESULTS = 100;
    const results: string[] = [];

    const searchDir = async (dir: string, prefix = '', depth = 0) => {
      if (depth >= MAX_DEPTH || results.length >= MAX_RESULTS) return;
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (entry.isSymbolicLink?.()) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          const content = (await fsp.readFile(fullPath, 'utf-8')).toLowerCase();
          if (content.includes(query) || entry.name.toLowerCase().includes(query)) {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            results.push(`\u{1F4C4} notes/${relativePath}`);
          }
        }
      }
    };

    await searchDir(notesDir);

    if (results.length === 0) {
      return { content: `No notes found matching "${query}"` };
    }

    const truncated = results.length >= MAX_RESULTS ? ` (showing first ${MAX_RESULTS})` : '';
    return {
      content: `\u{1F50D} Found ${results.length} note(s)${truncated}:\n${results.join('\n')}`,
    };
  },

  create_bookmark: async (args) => {
    const url = typeof args.url === 'string' ? args.url : String(args.url ?? '');
    const title = typeof args.title === 'string' ? args.title : String(args.title ?? '');
    const description = typeof args.description === 'string' ? args.description : undefined;
    const tags = Array.isArray(args.tags)
      ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    const bookmarksDir = resolveWorkspacePath('bookmarks');
    if (!bookmarksDir) {
      return { content: 'Error: No workspace configured', isError: true };
    }

    const bookmark = {
      id: randomUUID().slice(0, 8),
      url,
      title,
      description,
      tags,
      createdAt: new Date().toISOString(),
    };

    if (!fs.existsSync(bookmarksDir)) {
      await fsp.mkdir(bookmarksDir, { recursive: true });
    }

    const bookmarksFile = path.join(bookmarksDir, 'bookmarks.json');
    let bookmarks: unknown[] = [];
    if (fs.existsSync(bookmarksFile)) {
      const content = await fsp.readFile(bookmarksFile, 'utf-8');
      bookmarks = safeJsonParseWithDefault<unknown[]>(content, []);
    }
    bookmarks.push(bookmark);
    await fsp.writeFile(bookmarksFile, JSON.stringify(bookmarks, null, 2));

    return {
      content: `\u{1F516} Bookmark saved!
\u{1F4CC} ${title}
\u{1F517} ${url}${description ? `\n\u{1F4DD} ${description}` : ''}${tags.length ? `\n\u{1F3F7}\uFE0F ${tags.join(', ')}` : ''}`,
    };
  },

  list_bookmarks: async (args) => {
    const tagFilter = typeof args.tag === 'string' ? args.tag : undefined;
    const searchQuery = typeof args.search === 'string' ? args.search : undefined;

    const bookmarksPath = resolveWorkspacePath('bookmarks/bookmarks.json');
    if (!bookmarksPath || !fs.existsSync(bookmarksPath)) {
      return { content: 'No bookmarks found. Create your first bookmark!' };
    }

    const content = await fsp.readFile(bookmarksPath, 'utf-8');
    let bookmarks = safeJsonParseWithDefault<
      Array<{
        id: string;
        url: string;
        title: string;
        description?: string;
        tags?: string[];
        createdAt: string;
      }>
    >(content, []);

    if (tagFilter) {
      bookmarks = bookmarks.filter((b) => b.tags?.includes(tagFilter));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      bookmarks = bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description?.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    if (bookmarks.length === 0) {
      return { content: 'No bookmarks match the filter.' };
    }

    const list = bookmarks.map(
      (b) =>
        `\u{1F4CC} ${b.title}\n   \u{1F517} ${b.url}${b.tags?.length ? `\n   \u{1F3F7}\uFE0F ${b.tags.join(', ')}` : ''}`
    );

    return { content: `\u{1F516} Bookmarks (${bookmarks.length}):\n\n${list.join('\n\n')}` };
  },
};
