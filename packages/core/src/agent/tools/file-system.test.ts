/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import type { ToolContext, ToolExecutionResult } from '../types.js';

// ---------------------------------------------------------------------------
// Mock node:fs/promises (vi.hoisted runs before the hoisted vi.mock)
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
// Mock self-protection module
// ---------------------------------------------------------------------------
const mockIsOwnPilotPath = vi.hoisted(() => vi.fn().mockReturnValue(false));

vi.mock('../../security/self-protection.js', () => ({
  isOwnPilotPath: mockIsOwnPilotPath,
}));

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
    userId: 'test-user',
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  // Default: realpath resolves to the given path
  fsMock.realpath.mockImplementation(async (p: string) => p);
  // Default: self-protection is off (not an OwnPilot path)
  mockIsOwnPilotPath.mockReturnValue(false);
});

// ===========================================================================
// 1. isPathAllowedAsync — allows workspace dirs, /tmp, blocks outside paths
//    (tested indirectly through readFileExecutor)
// ===========================================================================
describe('isPathAllowedAsync (via readFileExecutor)', () => {
  it('allows files inside the workspace directory', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('workspace data');

    const result = await readFileExecutor({ path: 'subdir/file.txt' }, ctx());
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.content).toBe('workspace data');
  });

  it('allows files under /tmp', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));
    fsMock.readFile.mockResolvedValue('tmp data');

    const result = await readFileExecutor({ path: '/tmp/safe.txt' }, ctx());
    expect(result.isError).toBeUndefined();
  });

  it('blocks paths outside workspace and /tmp', async () => {
    const result = await readFileExecutor({ path: '/etc/shadow' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('blocks a path that starts with workspace name but is not a subdirectory', async () => {
    const evilPath = WORKSPACE + '-evil/secret.txt';
    const result = await readFileExecutor({ path: evilPath }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });
});

// ===========================================================================
// 2. Self-protection integration — OwnPilot source paths blocked
// ===========================================================================
describe('Self-protection integration (isOwnPilotPath)', () => {
  it('blocks read access to OwnPilot source paths', async () => {
    mockIsOwnPilotPath.mockReturnValue(true);

    const ownpilotFile = path.join(WORKSPACE, 'packages/core/src/index.ts');
    const result = await readFileExecutor({ path: ownpilotFile }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
    expect(mockIsOwnPilotPath).toHaveBeenCalled();
  });

  it('blocks write access to OwnPilot source paths', async () => {
    mockIsOwnPilotPath.mockReturnValue(true);

    const result = await writeFileExecutor(
      { path: path.join(WORKSPACE, 'server.ts'), content: 'hacked' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('allows access when isOwnPilotPath returns false', async () => {
    mockIsOwnPilotPath.mockReturnValue(false);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('safe');

    const result = await readFileExecutor({ path: 'safe-file.txt' }, ctx());
    expect(result.isError).toBeUndefined();
  });
});

// ===========================================================================
// 3. _isPathAllowed (sync) — tested indirectly; same checks apply
//    Note: The async version (isPathAllowedAsync) is used in all executors.
//    The sync version exists for backward compat. We verify the same denial
//    behavior through the executor path.
// ===========================================================================
describe('_isPathAllowed sync checks (via executor denial patterns)', () => {
  it('denies /var/log path (not in allowed list)', async () => {
    const result = await readFileExecutor({ path: '/var/log/syslog' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });
});

// ===========================================================================
// 4. MAX_FILE_SIZE enforcement (10 MB)
// ===========================================================================
describe('MAX_FILE_SIZE enforcement', () => {
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  it('readFileExecutor rejects files larger than 10 MB', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: MAX_FILE_SIZE + 1 }));

    const result = await readFileExecutor({ path: 'huge.bin' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('File too large');
    expect(result.content).toContain('10 MB');
  });

  it('readFileExecutor allows files exactly at the 10 MB limit', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: MAX_FILE_SIZE }));
    fsMock.readFile.mockResolvedValue('x'.repeat(100));

    const result = await readFileExecutor({ path: 'exact-limit.bin' }, ctx());
    expect(result.isError).toBeUndefined();
  });

  it('writeFileExecutor rejects content larger than 10 MB', async () => {
    const oversized = 'x'.repeat(MAX_FILE_SIZE + 1);
    const result = await writeFileExecutor({ path: 'big.txt', content: oversized }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Content too large');
    expect(result.content).toContain('10 MB');
  });
});

// ===========================================================================
// 5. Path traversal prevention (../../ paths)
// ===========================================================================
describe('Path traversal prevention', () => {
  it('denies ../../../etc/passwd traversal via read', async () => {
    const result = await readFileExecutor({ path: '../../../etc/passwd' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('denies ../../../etc/shadow traversal via write', async () => {
    const result = await writeFileExecutor({ path: '../../../etc/shadow', content: 'evil' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('blocks symlink escape (realpath resolves outside workspace)', async () => {
    fsMock.realpath.mockResolvedValue('/etc/passwd');

    const result = await readFileExecutor({ path: 'symlink-to-etc' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });
});

// ===========================================================================
// 6. resolveFilePath — relative paths resolve to workspace
// ===========================================================================
describe('resolveFilePath (via executor path resolution)', () => {
  it('resolves relative paths to the workspace directory', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));
    fsMock.readFile.mockResolvedValue('data');

    const result = await readFileExecutor({ path: 'subdir/file.txt' }, ctx());
    const data = parse(result);
    expect(data.path).toBe(path.resolve(WORKSPACE, 'subdir/file.txt'));
  });

  it('keeps absolute paths as-is (when within workspace)', async () => {
    const absPath = path.join(WORKSPACE, 'abs.txt');
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));
    fsMock.readFile.mockResolvedValue('abs');

    const result = await readFileExecutor({ path: absPath }, ctx());
    const data = parse(result);
    expect(data.path).toBe(absPath);
  });
});

// ===========================================================================
// 7. safeGlobToRegex — escapes special chars, converts * and ?
//    (tested indirectly through listDirectoryExecutor pattern filtering)
// ===========================================================================
describe('safeGlobToRegex (via listDirectoryExecutor pattern)', () => {
  const makeDirent = (name: string, type: 'file' | 'directory' = 'file') => ({
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => false,
  });

  it('converts * to match any characters (*.ts)', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('app.ts'),
      makeDirent('app.js'),
      makeDirent('readme.md'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.', pattern: '*.ts' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('app.ts');
  });

  it('converts ? to match a single character', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('a.ts'), makeDirent('ab.ts')]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.', pattern: '?.ts' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('a.ts');
  });

  it('escapes regex metacharacters like [ and ]', async () => {
    fsMock.readdir.mockResolvedValue([makeDirent('file[1].txt'), makeDirent('file2.txt')]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.', pattern: 'file[1].txt' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('file[1].txt');
  });
});

// ===========================================================================
// 8. readFileExecutor — reads files, blocks outside workspace, handles missing
// ===========================================================================
describe('readFileExecutor', () => {
  it('reads file content and returns path and size', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('hello world');

    const result = await readFileExecutor({ path: 'test.txt' }, ctx());
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.content).toBe('hello world');
    expect(data.size).toBe(11);
    expect(data.path).toContain('test.txt');
  });

  it('returns error for missing files (ENOENT)', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const result = await readFileExecutor({ path: 'missing.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error reading file');
    expect(result.content).toContain('ENOENT');
  });

  it('supports line range selection with startLine and endLine', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));
    fsMock.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

    const result = await readFileExecutor({ path: 'file.txt', startLine: 2, endLine: 4 }, ctx());
    const data = parse(result);
    expect(data.content).toBe('line2\nline3\nline4');
    expect(data.lines.start).toBe(2);
    expect(data.lines.end).toBe(4);
    expect(data.lines.total).toBe(5);
  });
});

// ===========================================================================
// 9. writeFileExecutor — writes files, blocks outside workspace, size limit
// ===========================================================================
describe('writeFileExecutor', () => {
  it('writes a file and returns success with metadata', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));

    const result = await writeFileExecutor({ path: 'out.txt', content: 'hello' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('written');
    expect(data.size).toBe(5);
    expect(data.path).toContain('out.txt');
  });

  it('appends to a file when append flag is true', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.appendFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await writeFileExecutor(
      { path: 'out.txt', content: 'more', append: true },
      ctx()
    );
    const data = parse(result);
    expect(data.action).toBe('appended');
    expect(fsMock.appendFile).toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('blocks writes to paths outside the workspace', async () => {
    const result = await writeFileExecutor({ path: '/etc/passwd', content: 'hack' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when fs.writeFile throws', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockRejectedValue(new Error('disk full'));

    const result = await writeFileExecutor({ path: 'out.txt', content: 'data' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('disk full');
  });
});

// ===========================================================================
// 10. Tool definitions exist with correct names and required params
// ===========================================================================
describe('Tool definitions', () => {
  it('FILE_SYSTEM_TOOLS contains all 8 tools', () => {
    expect(FILE_SYSTEM_TOOLS).toHaveLength(8);
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

  it('each tool has a definition with name, parameters, and an executor function', () => {
    for (const tool of FILE_SYSTEM_TOOLS) {
      expect(tool.definition.name).toBeTypeOf('string');
      expect(tool.definition.parameters).toBeDefined();
      expect(tool.definition.parameters.type).toBe('object');
      expect(tool.executor).toBeTypeOf('function');
    }
  });

  it('readFileTool requires path parameter', () => {
    expect(readFileTool.name).toBe('read_file');
    expect(readFileTool.parameters.required).toEqual(['path']);
    expect(readFileTool.parameters.properties.path).toBeDefined();
    expect(readFileTool.parameters.properties.encoding).toBeDefined();
  });

  it('writeFileTool requires path and content parameters', () => {
    expect(writeFileTool.name).toBe('write_file');
    expect(writeFileTool.parameters.required).toEqual(['path', 'content']);
  });

  it('all tool definitions have required arrays', () => {
    const expectations: Record<string, string[]> = {
      read_file: ['path'],
      write_file: ['path', 'content'],
      list_directory: ['path'],
      search_files: ['path', 'query'],
      download_file: ['url', 'path'],
      get_file_info: ['path'],
      delete_file: ['path'],
      copy_file: ['source', 'destination'],
    };

    for (const tool of FILE_SYSTEM_TOOLS) {
      const name = tool.definition.name;
      expect(tool.definition.parameters.required).toEqual(expectations[name]);
    }
  });
});

// ===========================================================================
// 11. deleteFileExecutor — deletes files and directories
// ===========================================================================
describe('deleteFileExecutor', () => {
  it('deletes a file successfully', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: true, isDirectory: false }));
    fsMock.unlink.mockResolvedValue(undefined);

    const result = await deleteFileExecutor({ path: 'old.txt' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.deleted).toBe(true);
    expect(fsMock.unlink).toHaveBeenCalled();
  });

  it('deletes a directory recursively when recursive flag is true', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ isFile: false, isDirectory: true }));
    fsMock.rm.mockResolvedValue(undefined);

    const result = await deleteFileExecutor({ path: 'olddir', recursive: true }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(fsMock.rm).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('blocks deletion of paths outside workspace', async () => {
    const result = await deleteFileExecutor({ path: '/etc/passwd' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when file does not exist', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT: file not found'));

    const result = await deleteFileExecutor({ path: 'missing.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ENOENT');
  });
});

// ===========================================================================
// 12. copyFileExecutor — copies and moves files
// ===========================================================================
describe('copyFileExecutor', () => {
  it('copies a file successfully', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // Destination doesn't exist
    fsMock.copyFile.mockResolvedValue(undefined);

    const result = await copyFileExecutor({ source: 'src.txt', destination: 'dst.txt' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('copied');
    expect(fsMock.copyFile).toHaveBeenCalled();
  });

  it('moves a file when move flag is true', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // Destination doesn't exist
    fsMock.rename.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'src.txt', destination: 'dst.txt', move: true },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('moved');
    expect(fsMock.rename).toHaveBeenCalled();
  });

  it('overwrites destination when overwrite flag is true', async () => {
    fsMock.access.mockResolvedValue(undefined); // Destination exists
    fsMock.copyFile.mockResolvedValue(undefined);

    const result = await copyFileExecutor(
      { source: 'src.txt', destination: 'existing.txt', overwrite: true },
      ctx()
    );
    expect(result.isError).toBeFalsy();
    expect(fsMock.copyFile).toHaveBeenCalled();
  });

  it('returns error when destination exists and overwrite is false', async () => {
    fsMock.access.mockResolvedValue(undefined); // Destination exists

    const result = await copyFileExecutor(
      { source: 'src.txt', destination: 'existing.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('exists');
  });

  it('blocks copy to paths outside workspace', async () => {
    const result = await copyFileExecutor(
      { source: 'safe.txt', destination: '/etc/passwd' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when copy operation fails', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // Destination doesn't exist
    fsMock.copyFile.mockRejectedValue(new Error('permission denied'));

    const result = await copyFileExecutor({ source: 'src.txt', destination: 'dst.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('permission denied');
  });
});

// ===========================================================================
// 12. searchFilesExecutor — searches file contents
// ===========================================================================
describe('searchFilesExecutor', () => {
  it('returns error when search fails', async () => {
    fsMock.readdir.mockRejectedValue(new Error('Permission denied'));

    const result = await searchFilesExecutor({ path: '.', query: 'test' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error searching files');
  });
});

// ===========================================================================
// 13. downloadFileExecutor — downloads files from URLs
// ===========================================================================
describe('downloadFileExecutor', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('downloads file successfully', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT')); // File doesn't exist
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      arrayBuffer: async () => new ArrayBuffer(100),
    } as unknown as Response);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.json', path: 'downloaded.json' },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.url).toBe('https://example.com/file.json');
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  it('blocks download to paths outside workspace', async () => {
    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.txt', path: '/etc/passwd' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when file already exists and no overwrite', async () => {
    fsMock.access.mockResolvedValue(undefined); // File exists

    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.txt', path: 'existing.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('already exists');
  });

  it('allows overwrite when flag is true', async () => {
    fsMock.access.mockResolvedValue(undefined); // File exists
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map(),
      arrayBuffer: async () => new ArrayBuffer(50),
    } as unknown as Response);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.txt', path: 'existing.txt', overwrite: true },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  it('returns error when download fails', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    const result = await downloadFileExecutor(
      { url: 'https://example.com/missing.txt', path: 'file.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Failed to download');
  });

  it('blocks internal/private URLs', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await downloadFileExecutor(
      { url: 'http://localhost:3000/internal.txt', path: 'file.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('blocked');
  });

  it('returns error when fetch throws exception', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.mkdir.mockResolvedValue(undefined);

    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await downloadFileExecutor(
      { url: 'https://example.com/file.txt', path: 'file.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error downloading file');
  });
});

// ===========================================================================
// 14. fileInfoExecutor — gets file information
// ===========================================================================
describe('fileInfoExecutor', () => {
  it('returns file metadata', async () => {
    const modifiedDate = new Date('2024-01-15');
    const birthDate = new Date('2024-01-01');
    fsMock.stat.mockResolvedValue({
      size: 1024,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      mtime: modifiedDate,
      birthtime: birthDate,
      atime: modifiedDate,
      mode: 0o644,
    } as never);

    const result = await fileInfoExecutor({ path: 'test.txt' }, ctx());
    const data = parse(result);
    expect(data.size).toBe(1024);
    expect(data.type).toBe('file');
  });

  it('returns directory metadata', async () => {
    const modifiedDate = new Date('2024-02-20');
    const birthDate = new Date('2024-02-01');
    fsMock.stat.mockResolvedValue({
      size: 4096,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mtime: modifiedDate,
      birthtime: birthDate,
      atime: modifiedDate,
      mode: 0o755,
    } as never);

    const result = await fileInfoExecutor({ path: 'mydir' }, ctx());
    const data = parse(result);
    expect(data.type).toBe('directory');
  });

  it('blocks access to paths outside workspace', async () => {
    const result = await fileInfoExecutor({ path: '/etc/passwd' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when file does not exist', async () => {
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await fileInfoExecutor({ path: 'missing.txt' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ENOENT');
  });
});
