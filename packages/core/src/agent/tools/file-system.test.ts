/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import type { ToolContext, ToolExecutionResult } from '../types.js';

// ---------------------------------------------------------------------------
// Mock node:fs/promises  (vi.hoisted runs before the hoisted vi.mock)
// ---------------------------------------------------------------------------
const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMock);

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------
import {
  readFileTool,
  readFileExecutor,
  writeFileTool,
  writeFileExecutor,
  listDirectoryTool,
  listDirectoryExecutor,
  searchFilesTool,
  searchFilesExecutor,
  downloadFileTool,
  downloadFileExecutor,
  fileInfoTool,
  fileInfoExecutor,
  deleteFileTool,
  deleteFileExecutor,
  copyFileTool,
  copyFileExecutor,
  FILE_SYSTEM_TOOLS,
} from './file-system.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const WORKSPACE = path.resolve('/workspace');

function ctx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    callId: 'call-1',
    conversationId: 'conv-1',
    workspaceDir: WORKSPACE,
    ...overrides,
  };
}

function parse(result: ToolExecutionResult): Record<string, any> {
  return JSON.parse(result.content as string);
}

function makeStat(overrides?: Partial<Record<string, any>>) {
  const now = new Date('2025-01-01T00:00:00.000Z');
  return {
    size: overrides?.size ?? 100,
    isFile: () => overrides?.isFile ?? true,
    isDirectory: () => overrides?.isDirectory ?? false,
    isSymbolicLink: () => overrides?.isSymbolicLink ?? false,
    mtime: overrides?.mtime ?? now,
    birthtime: overrides?.birthtime ?? now,
    atime: overrides?.atime ?? now,
    mode: overrides?.mode ?? 0o644,
  };
}

function makeDirent(name: string, type: 'file' | 'directory' | 'symlink' = 'file') {
  return {
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  // Default: realpath resolves to the given path
  fsMock.realpath.mockImplementation(async (p: string) => p);
  // Restore env
  process.env = { ...originalEnv };
  delete process.env.ALLOW_HOME_DIR_ACCESS;
  delete process.env.WORKSPACE_DIR;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ===========================================================================
// FILE_SYSTEM_TOOLS array
// ===========================================================================
describe('FILE_SYSTEM_TOOLS', () => {
  it('contains 8 tool entries', () => {
    expect(FILE_SYSTEM_TOOLS).toHaveLength(8);
  });

  it('has the expected tool names', () => {
    const names = FILE_SYSTEM_TOOLS.map((t) => t.definition.name);
    expect(names).toEqual([
      'read_file',
      'write_file',
      'list_directory',
      'search_files',
      'download_file',
      'get_file_info',
      'delete_file',
      'copy_file',
    ]);
  });

  it('each entry has a definition and executor function', () => {
    for (const tool of FILE_SYSTEM_TOOLS) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTypeOf('string');
      expect(tool.definition.parameters).toBeDefined();
      expect(tool.executor).toBeTypeOf('function');
    }
  });
});

// ===========================================================================
// Tool definitions (schemas)
// ===========================================================================
describe('Tool definitions', () => {
  it('readFileTool has required path parameter', () => {
    expect(readFileTool.name).toBe('read_file');
    expect(readFileTool.parameters.required).toEqual(['path']);
    expect(readFileTool.parameters.properties.path).toBeDefined();
    expect(readFileTool.parameters.properties.encoding).toBeDefined();
    expect(readFileTool.parameters.properties.startLine).toBeDefined();
    expect(readFileTool.parameters.properties.endLine).toBeDefined();
  });

  it('writeFileTool has required path and content parameters', () => {
    expect(writeFileTool.name).toBe('write_file');
    expect(writeFileTool.parameters.required).toEqual(['path', 'content']);
    expect(writeFileTool.parameters.properties.append).toBeDefined();
    expect(writeFileTool.parameters.properties.createDirs).toBeDefined();
  });

  it('listDirectoryTool has required path parameter', () => {
    expect(listDirectoryTool.name).toBe('list_directory');
    expect(listDirectoryTool.parameters.required).toEqual(['path']);
    expect(listDirectoryTool.parameters.properties.recursive).toBeDefined();
    expect(listDirectoryTool.parameters.properties.pattern).toBeDefined();
    expect(listDirectoryTool.parameters.properties.includeHidden).toBeDefined();
  });

  it('searchFilesTool has required path and query parameters', () => {
    expect(searchFilesTool.name).toBe('search_files');
    expect(searchFilesTool.parameters.required).toEqual(['path', 'query']);
    expect(searchFilesTool.parameters.properties.filePattern).toBeDefined();
    expect(searchFilesTool.parameters.properties.caseSensitive).toBeDefined();
    expect(searchFilesTool.parameters.properties.maxResults).toBeDefined();
  });

  it('downloadFileTool has required url and path parameters', () => {
    expect(downloadFileTool.name).toBe('download_file');
    expect(downloadFileTool.parameters.required).toEqual(['url', 'path']);
    expect(downloadFileTool.parameters.properties.overwrite).toBeDefined();
  });

  it('fileInfoTool has required path parameter', () => {
    expect(fileInfoTool.name).toBe('get_file_info');
    expect(fileInfoTool.parameters.required).toEqual(['path']);
  });

  it('deleteFileTool has required path parameter', () => {
    expect(deleteFileTool.name).toBe('delete_file');
    expect(deleteFileTool.parameters.required).toEqual(['path']);
    expect(deleteFileTool.parameters.properties.recursive).toBeDefined();
  });

  it('copyFileTool has required source and destination parameters', () => {
    expect(copyFileTool.name).toBe('copy_file');
    expect(copyFileTool.parameters.required).toEqual(['source', 'destination']);
    expect(copyFileTool.parameters.properties.move).toBeDefined();
    expect(copyFileTool.parameters.properties.overwrite).toBeDefined();
  });
});

// ===========================================================================
// readFileExecutor
// ===========================================================================
describe('readFileExecutor', () => {
  it('reads a file successfully', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('hello world');

    const result = await readFileExecutor({ path: 'test.txt' }, ctx());
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.content).toBe('hello world');
    expect(data.size).toBe(11);
    expect(data.path).toContain('test.txt');
  });

  it('resolves relative paths against workspace directory', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('data');

    const result = await readFileExecutor({ path: 'subdir/file.txt' }, ctx());
    const data = parse(result);
    expect(data.path).toBe(path.resolve(WORKSPACE, 'subdir/file.txt'));
  });

  it('returns error for path outside allowed directories', async () => {
    fsMock.realpath.mockImplementation(async (p: string) => p);
    const result = await readFileExecutor(
      { path: '/etc/shadow' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when file exceeds max size', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 11 * 1024 * 1024 }));

    const result = await readFileExecutor({ path: 'big.bin' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('File too large');
  });

  it('supports line range selection with startLine and endLine', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

    const result = await readFileExecutor(
      { path: 'file.txt', startLine: 2, endLine: 4 },
      ctx(),
    );
    const data = parse(result);
    expect(data.content).toBe('line2\nline3\nline4');
    expect(data.lines.start).toBe(2);
    expect(data.lines.end).toBe(4);
  });

  it('handles startLine only (reads to end)', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('a\nb\nc\nd');

    const result = await readFileExecutor(
      { path: 'file.txt', startLine: 3 },
      ctx(),
    );
    const data = parse(result);
    expect(data.content).toBe('c\nd');
    expect(data.lines.total).toBe(4);
  });

  it('handles endLine only (reads from beginning)', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('a\nb\nc\nd');

    const result = await readFileExecutor(
      { path: 'file.txt', endLine: 2 },
      ctx(),
    );
    const data = parse(result);
    expect(data.content).toBe('a\nb');
    expect(data.lines.start).toBe(1);
  });

  it('uses custom encoding', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('YWJj');

    await readFileExecutor({ path: 'file.txt', encoding: 'base64' }, ctx());
    expect(fsMock.readFile).toHaveBeenCalledWith(
      expect.any(String),
      { encoding: 'base64' },
    );
  });

  it('returns error when fs.stat throws', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await readFileExecutor({ path: 'missing.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error reading file');
    expect(result.content).toContain('ENOENT');
  });

  it('returns error when fs.readFile throws', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockRejectedValue(new Error('Permission denied'));

    const result = await readFileExecutor({ path: 'noperm.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Permission denied');
  });
});

// ===========================================================================
// writeFileExecutor
// ===========================================================================
describe('writeFileExecutor', () => {
  it('writes a file successfully', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));

    const result = await writeFileExecutor(
      { path: 'out.txt', content: 'hello' },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('written');
    expect(data.size).toBe(5);
  });

  it('appends to a file when append is true', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.appendFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await writeFileExecutor(
      { path: 'out.txt', content: 'more', append: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.action).toBe('appended');
    expect(fsMock.appendFile).toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('creates parent directories', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 3 }));

    await writeFileExecutor(
      { path: 'deep/nested/file.txt', content: 'hi' },
      ctx(),
    );
    expect(fsMock.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('deep'),
      { recursive: true },
    );
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await writeFileExecutor(
      { path: '/etc/passwd', content: 'hack' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when content exceeds max size', async () => {
    const largeContent = 'x'.repeat(11 * 1024 * 1024);
    const result = await writeFileExecutor(
      { path: 'big.txt', content: largeContent },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Content too large');
  });

  it('returns error when fs.writeFile throws', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockRejectedValue(new Error('disk full'));

    const result = await writeFileExecutor(
      { path: 'out.txt', content: 'data' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('disk full');
  });
});

// ===========================================================================
// listDirectoryExecutor
// ===========================================================================
describe('listDirectoryExecutor', () => {
  it('lists directory contents', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('file1.ts', 'file'),
      makeDirent('subdir', 'directory'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 200 }));

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(2);
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].type).toBe('file');
    expect(data.entries[1].type).toBe('directory');
  });

  it('filters by glob pattern', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('app.ts', 'file'),
      makeDirent('readme.md', 'file'),
      makeDirent('utils.ts', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 100 }));

    const result = await listDirectoryExecutor(
      { path: '.', pattern: '*.ts' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(2);
    expect(data.entries.every((e: any) => e.name.endsWith('.ts'))).toBe(true);
  });

  it('skips hidden files by default', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('.hidden', 'file'),
      makeDirent('visible.txt', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('visible.txt');
  });

  it('includes hidden files when includeHidden is true', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('.gitignore', 'file'),
      makeDirent('index.ts', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor(
      { path: '.', includeHidden: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(2);
  });

  it('lists recursively up to depth 5', async () => {
    // Root level
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('child', 'directory'),
    ]);
    // Child level
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('nested.txt', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));

    const result = await listDirectoryExecutor(
      { path: '.', recursive: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('includes symlink entries', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('link', 'symlink'),
    ]);

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].type).toBe('symlink');
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await listDirectoryExecutor({ path: '/etc' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when readdir throws', async () => {
    fsMock.readdir.mockRejectedValue(new Error('EACCES'));

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error listing directory');
  });
});

// ===========================================================================
// searchFilesExecutor
// ===========================================================================
describe('searchFilesExecutor', () => {
  it('searches files and returns matching lines', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('app.ts', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('line1\nimport foo\nline3');

    const result = await searchFilesExecutor(
      { path: '.', query: 'import' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.results[0].line).toBe(2);
    expect(data.results[0].content).toContain('import foo');
  });

  it('respects filePattern filter', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('app.ts', 'file'),
      makeDirent('readme.md', 'file'),
    ]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('hello world');

    const result = await searchFilesExecutor(
      { path: '.', query: 'hello', filePattern: '*.ts' },
      ctx(),
    );
    const data = parse(result);
    // Only app.ts matches the pattern
    expect(data.count).toBe(1);
    expect(data.results[0].file).toContain('app.ts');
  });

  it('handles case-insensitive search by default', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('file.txt', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('Hello World');

    const result = await searchFilesExecutor(
      { path: '.', query: 'hello' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
  });

  it('handles case-sensitive search when caseSensitive is true', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('file.txt', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('Hello World');

    const result = await searchFilesExecutor(
      { path: '.', query: 'hello', caseSensitive: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(0);
  });

  it('respects maxResults', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('file.txt', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('match\nmatch\nmatch\nmatch\nmatch');

    const result = await searchFilesExecutor(
      { path: '.', query: 'match', maxResults: 2 },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(2);
  });

  it('returns error for invalid regex pattern', async () => {
    const result = await searchFilesExecutor(
      { path: '.', query: '[invalid' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    const data = parse(result);
    expect(data.error).toContain('Invalid search pattern');
  });

  it('skips hidden files', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('.secret', 'file'),
      makeDirent('public.txt', 'file'),
    ]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('match');

    const result = await searchFilesExecutor(
      { path: '.', query: 'match' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.results[0].file).toContain('public.txt');
  });

  it('recurses into subdirectories', async () => {
    // Root level
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('subdir', 'directory'),
    ]);
    // Subdir level
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('nested.txt', 'file'),
    ]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockResolvedValue('found it');

    const result = await searchFilesExecutor(
      { path: '.', query: 'found' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
  });

  it('prevents symlink loops via visited set', async () => {
    // realpath resolves all dirs to the same real path (simulating a loop)
    fsMock.realpath.mockResolvedValue(WORKSPACE);
    // readdir returns a subdir on first call, then nothing
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('subdir', 'directory'),
    ]);
    fsMock.readdir.mockResolvedValueOnce([
      makeDirent('subdir', 'directory'),
    ]);

    const result = await searchFilesExecutor(
      { path: '.', query: 'test' },
      ctx(),
    );
    // Should not loop forever; second visit to the same realpath is skipped
    const data = parse(result);
    expect(data.count).toBe(0);
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await searchFilesExecutor(
      { path: '/etc', query: 'test' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('truncates matching lines to 200 chars', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('file.txt', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    const longLine = 'x'.repeat(300);
    fsMock.readFile.mockResolvedValue(longLine);

    const result = await searchFilesExecutor(
      { path: '.', query: 'x' },
      ctx(),
    );
    const data = parse(result);
    expect(data.results[0].content.length).toBe(200);
  });

  it('skips unreadable files without error', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('binary.bin', 'file')]);
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readFile.mockRejectedValue(new Error('EACCES'));

    const result = await searchFilesExecutor(
      { path: '.', query: 'test' },
      ctx(),
    );
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.count).toBe(0);
  });
});

// ===========================================================================
// downloadFileExecutor
// ===========================================================================
describe('downloadFileExecutor', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads a file successfully', async () => {
    const buffer = new ArrayBuffer(8);
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: vi.fn().mockResolvedValue(buffer),
      headers: { get: vi.fn().mockReturnValue('application/octet-stream') },
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // file does not exist
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.zip', path: 'downloads/file.zip' },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.url).toBe('https://example.com/file.zip');
    expect(data.size).toBe(8);
    expect(data.contentType).toBe('application/octet-stream');
  });

  it('returns error when file exists and overwrite is false', async () => {
    fsMock.access.mockResolvedValue(undefined); // file exists
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/f.txt', path: 'f.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('File already exists');
  });

  it('overwrites existing file when overwrite is true', async () => {
    const buffer = new ArrayBuffer(4);
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(buffer),
      headers: { get: vi.fn().mockReturnValue('text/plain') },
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);
    fsMock.access.mockResolvedValue(undefined); // file exists
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/f.txt', path: 'f.txt', overwrite: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it('returns error for failed HTTP response', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await downloadFileExecutor(
      { url: 'https://example.com/missing', path: 'out.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('404');
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await downloadFileExecutor(
      { url: 'https://example.com/f', path: '/etc/download' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when fetch throws', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    (globalThis.fetch as any).mockRejectedValue(new Error('Network error'));

    const result = await downloadFileExecutor(
      { url: 'https://example.com/f', path: 'out.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Network error');
  });
});

// ===========================================================================
// fileInfoExecutor
// ===========================================================================
describe('fileInfoExecutor', () => {
  it('returns file info successfully', async () => {
    const mtime = new Date('2025-06-15T10:00:00.000Z');
    const atime = new Date('2025-06-15T11:00:00.000Z');
    const birthtime = new Date('2025-01-01T00:00:00.000Z');
    fsMock.stat.mockResolvedValue(
      makeStat({
        size: 1024,
        isFile: true,
        isDirectory: false,
        mtime,
        atime,
        birthtime,
        mode: 0o755,
      }),
    );

    const result = await fileInfoExecutor({ path: 'test.txt' }, ctx());
    const data = parse(result);
    expect(data.type).toBe('file');
    expect(data.size).toBe(1024);
    expect(data.modified).toBe(mtime.toISOString());
    expect(data.accessed).toBe(atime.toISOString());
    expect(data.created).toBe(birthtime.toISOString());
    expect(data.permissions).toBe('755');
  });

  it('returns directory info', async () => {
    fsMock.stat.mockResolvedValue(
      makeStat({ isFile: false, isDirectory: true }),
    );

    const result = await fileInfoExecutor({ path: '.' }, ctx());
    const data = parse(result);
    expect(data.type).toBe('directory');
  });

  it('returns other type for non-file non-directory', async () => {
    fsMock.stat.mockResolvedValue(
      makeStat({ isFile: false, isDirectory: false }),
    );

    const result = await fileInfoExecutor({ path: 'dev-null' }, ctx());
    const data = parse(result);
    expect(data.type).toBe('other');
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await fileInfoExecutor({ path: '/etc/passwd' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when stat throws', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await fileInfoExecutor({ path: 'ghost.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error getting file info');
  });
});

// ===========================================================================
// deleteFileExecutor
// ===========================================================================
describe('deleteFileExecutor', () => {
  it('deletes a file', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: true, isDirectory: false }));
    fsMock.unlink.mockResolvedValue(undefined);

    const result = await deleteFileExecutor({ path: 'trash.txt' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.deleted).toBe(true);
    expect(fsMock.unlink).toHaveBeenCalled();
  });

  it('deletes a directory recursively', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: false, isDirectory: true }));
    fsMock.rm.mockResolvedValue(undefined);

    const result = await deleteFileExecutor(
      { path: 'old-dir', recursive: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(fsMock.rm).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('passes recursive: false when not specified', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: false, isDirectory: true }));
    fsMock.rm.mockResolvedValue(undefined);

    await deleteFileExecutor({ path: 'empty-dir' }, ctx());
    expect(fsMock.rm).toHaveBeenCalledWith(expect.any(String), { recursive: false });
  });

  it('returns error for path outside allowed directories', async () => {
    const result = await deleteFileExecutor({ path: '/etc/important' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when stat throws', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await deleteFileExecutor({ path: 'missing.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error deleting');
  });

  it('returns error when unlink throws', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: true, isDirectory: false }));
    fsMock.unlink.mockRejectedValue(new Error('EPERM'));

    const result = await deleteFileExecutor({ path: 'locked.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('EPERM');
  });
});

// ===========================================================================
// copyFileExecutor
// ===========================================================================
describe('copyFileExecutor', () => {
  it('copies a file', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // dest doesn't exist
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt' },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('copied');
    expect(fsMock.copyFile).toHaveBeenCalled();
  });

  it('moves a file when move is true', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt', move: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.action).toBe('moved');
    expect(fsMock.rename).toHaveBeenCalled();
  });

  it('returns error when destination exists and overwrite is false', async () => {
    fsMock.access.mockResolvedValue(undefined); // dest exists
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Destination exists');
  });

  it('overwrites destination when overwrite is true', async () => {
    fsMock.access.mockResolvedValue(undefined); // dest exists
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt', overwrite: true },
      ctx(),
    );
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it('returns error when source is outside allowed directories', async () => {
    const result = await copyFileExecutor(
      { source: '/etc/shadow', destination: 'copy.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when destination is outside allowed directories', async () => {
    const result = await copyFileExecutor(
      { source: 'file.txt', destination: '/etc/evil' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('creates destination parent directories', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockResolvedValue(undefined);

    await copyFileExecutor(
      { source: 'a.txt', destination: 'deep/nested/b.txt' },
      ctx(),
    );
    expect(fsMock.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('deep'),
      { recursive: true },
    );
  });

  it('returns error when copyFile throws', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockRejectedValue(new Error('EACCES'));

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('EACCES');
  });
});

// ===========================================================================
// Security: path traversal and allowed paths
// ===========================================================================
describe('Security - path traversal protection', () => {
  it('denies access to paths with .. traversal', async () => {
    const result = await readFileExecutor(
      { path: '../../../etc/passwd' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('allows access to /tmp paths', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('tmp data');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const result = await readFileExecutor(
      { path: '/tmp/safe.txt' },
      ctx(),
    );
    expect(result.isError).toBeUndefined();
  });

  it('denies access to random absolute paths', async () => {
    const result = await readFileExecutor(
      { path: '/var/log/syslog' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('allows access to workspace subdirectories', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('data');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const filePath = path.join(WORKSPACE, 'sub', 'file.txt');
    const result = await readFileExecutor({ path: filePath }, ctx());
    expect(result.isError).toBeUndefined();
  });

  it('denies a path that starts with workspace dir name but is not a subdir', async () => {
    // e.g., /workspace-evil is not within /workspace
    fsMock.realpath.mockImplementation(async (p: string) => p);
    const evilPath = WORKSPACE + '-evil/secret.txt';
    const result = await readFileExecutor({ path: evilPath }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('handles symlink resolution for security', async () => {
    // realpath resolves the symlink to a path outside workspace
    fsMock.realpath.mockResolvedValue('/etc/passwd');
    const result = await readFileExecutor(
      { path: 'symlink-to-etc' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('falls back to normalized path when realpath fails (new file)', async () => {
    // First call to realpath (for the file) fails (file doesn't exist)
    fsMock.realpath.mockRejectedValueOnce(new Error('ENOENT'));
    // Second call is not needed since we just normalize
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('new file data');

    const result = await readFileExecutor({ path: 'newfile.txt' }, ctx());
    expect(result.isError).toBeUndefined();
  });

  it('returns false for path check when realpath fails on a new file', async () => {
    // realpath fails (file doesn't exist yet), but the normalized path is within workspace
    fsMock.realpath.mockRejectedValue(new Error('ENOENT'));
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('data');

    const result = await readFileExecutor({ path: 'newfile.txt' }, ctx());
    // Normalized path is within workspace, so access is allowed
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.content).toBe('data');
  });
});

// ===========================================================================
// Security: ALLOW_HOME_DIR_ACCESS environment variable
// ===========================================================================
describe('Security - ALLOW_HOME_DIR_ACCESS', () => {
  it('does not include home dir in allowed paths by default', async () => {
    const homePath = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!homePath) return; // skip if no home dir

    fsMock.realpath.mockImplementation(async (p: string) => p);
    const result = await readFileExecutor(
      { path: path.join(homePath, 'secret.txt') },
      ctx(),
    );
    // Should be denied unless home dir is within workspace or /tmp
    if (!homePath.startsWith(WORKSPACE) && !homePath.startsWith('/tmp')) {
      expect(result.isError).toBe(true);
    }
  });

  it('includes home dir when ALLOW_HOME_DIR_ACCESS is true', async () => {
    process.env.ALLOW_HOME_DIR_ACCESS = 'true';
    const homePath = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!homePath) return;

    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('home data');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const result = await readFileExecutor(
      { path: path.join(homePath, 'file.txt') },
      ctx(),
    );
    expect(result.isError).toBeUndefined();
  });
});

// ===========================================================================
// Security: workspace directory resolution
// ===========================================================================
describe('Security - workspace directory resolution', () => {
  it('uses context.workspaceDir when provided', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('data');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const customWorkspace = path.resolve('/custom/workspace');
    const result = await readFileExecutor(
      { path: 'file.txt' },
      ctx({ workspaceDir: customWorkspace }),
    );
    const data = parse(result);
    expect(data.path).toBe(path.resolve(customWorkspace, 'file.txt'));
  });

  it('uses WORKSPACE_DIR env var when context.workspaceDir is not set', async () => {
    const envWorkspace = path.resolve('/env/workspace');
    process.env.WORKSPACE_DIR = envWorkspace;

    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));
    fsMock.readFile.mockResolvedValue('env');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const result = await readFileExecutor(
      { path: 'file.txt' },
      ctx({ workspaceDir: undefined }),
    );
    const data = parse(result);
    expect(data.path).toBe(path.resolve(envWorkspace, 'file.txt'));
  });
});

// ===========================================================================
// safeGlobToRegex (tested indirectly through listDirectoryExecutor)
// ===========================================================================
describe('safeGlobToRegex (via listDirectoryExecutor)', () => {
  beforeEach(() => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
  });

  it('matches simple wildcard pattern *.ts', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('app.ts', 'file'),
      makeDirent('app.js', 'file'),
      makeDirent('readme.md', 'file'),
    ]);

    const result = await listDirectoryExecutor(
      { path: '.', pattern: '*.ts' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('app.ts');
  });

  it('matches single-char wildcard pattern ?.ts', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('a.ts', 'file'),
      makeDirent('ab.ts', 'file'),
    ]);

    const result = await listDirectoryExecutor(
      { path: '.', pattern: '?.ts' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('a.ts');
  });

  it('case-insensitive matching', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('README.MD', 'file'),
    ]);

    const result = await listDirectoryExecutor(
      { path: '.', pattern: '*.md' },
      ctx(),
    );
    const data = parse(result);
    expect(data.count).toBe(1);
  });

  it('escapes regex metacharacters in glob', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('file[1].txt', 'file'),
      makeDirent('file2.txt', 'file'),
    ]);

    const result = await listDirectoryExecutor(
      { path: '.', pattern: 'file[1].txt' },
      ctx(),
    );
    const data = parse(result);
    // The glob treats [ and ] as literal characters after escaping
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('file[1].txt');
  });

  it('handles pattern with dots correctly', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('app.config.ts', 'file'),
      makeDirent('appXconfigXts', 'file'),
    ]);

    const result = await listDirectoryExecutor(
      { path: '.', pattern: 'app.config.ts' },
      ctx(),
    );
    const data = parse(result);
    // Dots are escaped, so only exact match
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('app.config.ts');
  });
});

// ===========================================================================
// Edge cases and error handling
// ===========================================================================
describe('Edge cases', () => {
  it('readFileExecutor handles non-Error thrown values', async () => {
    fsMock.stat.mockRejectedValue('string error');

    const result = await readFileExecutor({ path: 'file.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('string error');
  });

  it('writeFileExecutor handles non-Error thrown values', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockRejectedValue(42);

    const result = await writeFileExecutor(
      { path: 'file.txt', content: 'x' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('42');
  });

  it('listDirectoryExecutor handles non-Error thrown values', async () => {
    fsMock.readdir.mockRejectedValue(null);

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error listing directory');
  });

  it('searchFilesExecutor returns error when readdir at root throws', async () => {
    fsMock.realpath.mockImplementation(async (p: string) => p);
    // readdir at the root search dir throws
    fsMock.readdir.mockRejectedValue(new Error('readdir fail'));

    const result = await searchFilesExecutor(
      { path: '.', query: 'test' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error searching files');
  });

  it('deleteFileExecutor handles non-Error thrown values', async () => {
    fsMock.stat.mockRejectedValue({ code: 'ENOENT' });

    const result = await deleteFileExecutor({ path: 'ghost.txt' }, ctx());
    expect(result.isError).toBe(true);
  });

  it('copyFileExecutor handles non-Error thrown values', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockRejectedValue('copy failed');

    const result = await copyFileExecutor(
      { source: 'a.txt', destination: 'b.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('copy failed');
  });

  it('downloadFileExecutor handles non-Error thrown values', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue('fetch boom');
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/x', path: 'x.txt' },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('fetch boom');

    globalThis.fetch = originalFetch;
  });

  it('fileInfoExecutor handles non-Error thrown values', async () => {
    fsMock.stat.mockRejectedValue(undefined);

    const result = await fileInfoExecutor({ path: 'x' }, ctx());
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// Absolute vs relative path handling
// ===========================================================================
describe('Path resolution', () => {
  it('readFileExecutor resolves absolute paths', async () => {
    const absPath = path.join(WORKSPACE, 'abs.txt');
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));
    fsMock.readFile.mockResolvedValue('abs');
    fsMock.realpath.mockImplementation(async (p: string) => p);

    const result = await readFileExecutor({ path: absPath }, ctx());
    const data = parse(result);
    expect(data.path).toBe(absPath);
  });

  it('writeFileExecutor resolves relative paths', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));

    const result = await writeFileExecutor(
      { path: 'rel/file.txt', content: 'hi' },
      ctx(),
    );
    const data = parse(result);
    expect(data.path).toBe(path.resolve(WORKSPACE, 'rel/file.txt'));
  });

  it('copyFileExecutor resolves both source and destination', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.copyFile.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'src.txt', destination: 'dst.txt' },
      ctx(),
    );
    const data = parse(result);
    expect(data.source).toBe(path.resolve(WORKSPACE, 'src.txt'));
    expect(data.destination).toBe(path.resolve(WORKSPACE, 'dst.txt'));
  });
});
