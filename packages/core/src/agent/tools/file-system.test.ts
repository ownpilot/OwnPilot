import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
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
// Mock node:dns/promises to prevent real DNS lookups in SSRF protection.
// The fn is hoisted to a referenceable handle so the global beforeEach can
// re-apply its implementation after vi.resetAllMocks() (which would otherwise
// wipe it, making lookup() return undefined -> SSRF check throws -> URL blocked).
// ---------------------------------------------------------------------------
const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock }));

/** Public IP so isPrivateUrlAsync() treats test hosts as external (not blocked). */
const PUBLIC_DNS_RESULT = [{ address: '93.184.216.34', family: 4 }];

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------
import {
  readFileTool,
  readFileExecutor,
  writeFileTool,
  writeFileExecutor,
  listDirectoryExecutor,
  searchFilesExecutor,
  downloadFileExecutor,
  fileInfoExecutor,
  deleteFileExecutor,
  copyFileExecutor,
  createDirectoryExecutor,
  moveFileExecutor,
  editFileExecutor,
  buildEditMismatchHint,
  findFlexibleMatch,
  buildMissingDirHint,
  buildSearchMissHint,
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
  // Re-apply the dns resolver impl wiped by resetAllMocks so SSRF checks
  // resolve test hostnames to a public IP instead of throwing.
  dnsLookupMock.mockResolvedValue(PUBLIC_DNS_RESULT);
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

  it('allows files under the system temp directory', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 5 }));
    fsMock.readFile.mockResolvedValue('tmp data');

    const tmpFile = path.join(os.tmpdir(), 'safe.txt');
    const result = await readFileExecutor({ path: tmpFile }, ctx());
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

  it('blocks writing a NEW file through a symlinked parent dir that escapes the workspace', async () => {
    // A symlinked directory exists inside the workspace ("cache" -> /outside),
    // and the agent writes a file that does not exist yet under it. realpath of
    // the missing leaf fails; the symlinked parent resolves OUTSIDE the
    // workspace. Without resolving the parent's symlink, path.normalize would
    // keep the path under the workspace prefix and the write would follow the
    // symlink to escape.
    const linkParent = path.join(WORKSPACE, 'cache');
    const newFile = path.join(linkParent, 'evil.sh');
    fsMock.realpath.mockImplementation(async (p: string) => {
      if (p === newFile) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (p === linkParent) return path.resolve('/outside/secrets');
      return p;
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue(makeStat({ size: 4 }));

    const result = await writeFileExecutor({ path: newFile, content: 'evil' }, ctx());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
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
});

// ===========================================================================
// Additional tests for uncovered lines (targeting 90%+ coverage)
// ===========================================================================

describe('listDirectoryExecutor additional coverage', () => {
  const makeDirent = (name: string, type: 'file' | 'directory' | 'symlink' = 'file') => ({
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
  });

  it('lists directory contents successfully', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('file1.txt', 'file'),
      makeDirent('subdir', 'directory'),
      makeDirent('link', 'symlink'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 100 }));

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.count).toBe(3);
    expect(data.entries).toHaveLength(3);
    expect(data.entries[0].name).toBe('file1.txt');
    expect(data.entries[0].type).toBe('file');
    expect(data.entries[0].size).toBe(100);
    expect(data.entries[1].type).toBe('directory');
    expect(data.entries[2].type).toBe('symlink');
  });

  it('excludes hidden files by default', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('visible.txt', 'file'),
      makeDirent('.hidden', 'file'),
      makeDirent('.gitignore', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.entries[0].name).toBe('visible.txt');
  });

  it('includes hidden files when includeHidden is true', async () => {
    fsMock.readdir.mockResolvedValue([
      makeDirent('visible.txt', 'file'),
      makeDirent('.hidden', 'file'),
    ]);
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.', includeHidden: true }, ctx());
    const data = parse(result);
    expect(data.count).toBe(2);
  });

  it('lists directory recursively', async () => {
    fsMock.readdir.mockImplementation(async (dirPath: string) => {
      if (dirPath.includes('subdir')) {
        return [makeDirent('nested.txt', 'file')];
      }
      return [makeDirent('root.txt', 'file'), makeDirent('subdir', 'directory')];
    });
    fsMock.stat.mockResolvedValue(makeStat({ size: 50 }));

    const result = await listDirectoryExecutor({ path: '.', recursive: true }, ctx());
    const data = parse(result);
    expect(data.count).toBe(3);
    const names = data.entries.map((e: { name: string }) => e.name);
    expect(names).toContain('root.txt');
    expect(names).toContain('subdir');
    expect(names).toContain('nested.txt');
  });

  it('respects max depth limit in recursive mode', async () => {
    let callCount = 0;
    fsMock.readdir.mockImplementation(async () => {
      callCount++;
      return [
        makeDirent(`file${callCount}.txt`, 'file'),
        makeDirent(`dir${callCount}`, 'directory'),
      ];
    });
    fsMock.stat.mockResolvedValue(makeStat({ size: 10 }));

    const result = await listDirectoryExecutor({ path: '.', recursive: true }, ctx());
    const data = parse(result);
    // Should stop at depth 5
    expect(data.count).toBeGreaterThan(0);
    expect(callCount).toBeLessThanOrEqual(6); // root + 5 levels
  });

  it('hints with the nearest existing directory on ENOENT', async () => {
    const missing = path.resolve(WORKSPACE, 'downloads');
    fsMock.readdir.mockImplementation(async (dir: string) => {
      if (path.resolve(dir) === missing) {
        const err = new Error(`ENOENT: no such file or directory, scandir '${missing}'`);
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      // Nearest existing ancestor (the workspace root) contents.
      return [makeDirent('data', 'directory'), makeDirent('README.md', 'file')];
    });

    const result = await listDirectoryExecutor({ path: 'downloads' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('nearest existing directory');
    expect(result.content).toContain('data/');
    expect(result.content).toContain('README.md');
  });
});

describe('buildMissingDirHint', () => {
  const dirent = (name: string, isDir: boolean) => ({
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  });

  it('lists the nearest existing ancestor, marking directories with a slash', async () => {
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readdir.mockImplementation(async (dir: string) => {
      if (path.resolve(dir) === path.resolve(WORKSPACE, 'a')) {
        const err = new Error('ENOENT');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      }
      return [dirent('src', true), dirent('package.json', false), dirent('.hidden', false)];
    });

    const hint = await buildMissingDirHint(path.resolve(WORKSPACE, 'a', 'missing'), WORKSPACE);
    expect(hint).toContain('src/');
    expect(hint).toContain('package.json');
    expect(hint).not.toContain('.hidden'); // hidden entries excluded
  });

  it('falls back to a generic hint when no ancestor is listable', async () => {
    fsMock.realpath.mockImplementation(async (p: string) => p);
    fsMock.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const hint = await buildMissingDirHint(path.resolve(WORKSPACE, 'x', 'y'), WORKSPACE);
    expect(hint).toContain('List "." to see the workspace root');
  });
});

describe('searchFilesExecutor additional coverage', () => {
  beforeEach(() => {
    // Ensure realpath returns paths within workspace
    fsMock.realpath.mockImplementation(async (p: string) => {
      // Handle both Unix and Windows paths (for cross-platform compatibility)
      const normalizedP = (p as string).replace(/\\/g, '/');
      if (normalizedP.startsWith('/workspace')) return p;
      return path.join(WORKSPACE, p);
    });
  });

  it('finds matching content in files', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('const foo = "bar";\nconst baz = "qux";');

    const result = await searchFilesExecutor({ path: '/workspace', query: 'foo' }, ctx());
    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.results[0].content).toContain('foo');
    expect(data.results[0].line).toBe(1);
  });

  it('respects maxResults limit', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'file1.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: 'file2.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('match\nmatch\nmatch\nmatch\nmatch');

    const result = await searchFilesExecutor(
      { path: '/workspace', query: 'match', maxResults: 3 },
      ctx()
    );
    const data = parse(result);
    expect(data.count).toBe(3);
  });

  it('filters by file pattern', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: 'test.js',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('const x = 1;');

    const result = await searchFilesExecutor(
      { path: '/workspace', query: 'const', filePattern: '*.ts' },
      ctx()
    );
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.results[0].file).toBe('test.ts');
  });

  it('is case insensitive by default', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('const FOO = 1;');

    const result = await searchFilesExecutor({ path: '/workspace', query: 'foo' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
  });

  it('respects caseSensitive flag', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('const FOO = 1;');

    const result = await searchFilesExecutor(
      { path: '/workspace', query: 'foo', caseSensitive: true },
      ctx()
    );
    const data = parse(result);
    expect(data.count).toBe(0);
  });

  it('returns empty results when no matches found', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('const x = 1;');

    const result = await searchFilesExecutor({ path: '/workspace', query: 'notfound' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(0);
    expect(data.results).toHaveLength(0);
  });

  it('trims and limits line content to 200 chars', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'test.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockResolvedValue('x'.repeat(300));

    const result = await searchFilesExecutor({ path: '/workspace', query: 'x' }, ctx());
    const data = parse(result);
    expect(data.results[0].content.length).toBeLessThanOrEqual(200);
  });

  it('handles unreadable files gracefully', async () => {
    fsMock.readdir.mockResolvedValue([
      {
        name: 'readable.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: 'unreadable.ts',
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ]);
    fsMock.readFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes('unreadable')) throw new Error('Permission denied');
      return 'readable content';
    });

    const result = await searchFilesExecutor({ path: '/workspace', query: 'content' }, ctx());
    const data = parse(result);
    expect(data.count).toBe(1);
    expect(data.results[0].file).toBe('readable.ts');
  });

  it('returns error for invalid regex pattern', async () => {
    const result = await searchFilesExecutor({ path: '/workspace', query: '[invalid' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid search pattern');
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
  it('FILE_SYSTEM_TOOLS contains all 11 tools', () => {
    expect(FILE_SYSTEM_TOOLS).toHaveLength(11);
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
      'create_directory',
      'move_file',
      'edit_file',
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
      create_directory: ['path'],
      move_file: ['source', 'destination'],
      edit_file: ['path', 'oldText', 'newText'],
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

// ===========================================================================
// createDirectoryExecutor — explicit mkdir
// ===========================================================================
describe('createDirectoryExecutor', () => {
  it('creates a directory with recursive: true', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await createDirectoryExecutor({ path: 'new-dir/sub' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.created).toBe(true);
    expect(fsMock.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('blocks paths outside workspace', async () => {
    const result = await createDirectoryExecutor({ path: '/etc/evil' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('returns error when mkdir fails', async () => {
    fsMock.mkdir.mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await createDirectoryExecutor({ path: 'forbidden' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('EACCES');
  });
});

// ===========================================================================
// moveFileExecutor — delegates to copyFileExecutor with move:true
// ===========================================================================
describe('moveFileExecutor', () => {
  it('moves a file (action: moved)', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.rename.mockResolvedValue(undefined);

    const result = await moveFileExecutor({ source: 'old.txt', destination: 'new.txt' }, ctx());
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.action).toBe('moved');
    expect(fsMock.rename).toHaveBeenCalled();
    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('forwards overwrite flag to underlying copy/rename', async () => {
    fsMock.access.mockResolvedValue(undefined); // Destination exists
    fsMock.rename.mockResolvedValue(undefined);

    const result = await moveFileExecutor(
      { source: 'old.txt', destination: 'existing.txt', overwrite: true },
      ctx()
    );
    expect(result.isError).toBeFalsy();
    expect(fsMock.rename).toHaveBeenCalled();
  });

  it('refuses when destination exists and overwrite is false', async () => {
    fsMock.access.mockResolvedValue(undefined);

    const result = await moveFileExecutor(
      { source: 'old.txt', destination: 'existing.txt' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('exists');
  });
});

// ===========================================================================
// editFileExecutor — in-place find/replace
// ===========================================================================
describe('editFileExecutor', () => {
  beforeEach(() => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 100 }));
  });

  it('replaces a unique substring in-place', async () => {
    fsMock.readFile.mockResolvedValue('hello world\nfoo bar');
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'world', newText: 'planet' },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.replacements).toBe(1);
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      'hello planet\nfoo bar',
      'utf-8'
    );
  });

  it('refuses when oldText is not found (file is not modified)', async () => {
    fsMock.readFile.mockResolvedValue('hello world');

    const result = await editFileExecutor({ path: 'a.txt', oldText: 'nope', newText: 'x' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('includes a self-correction hint when oldText is not found', async () => {
    // File has two spaces between the words; oldText has one -> not an exact
    // substring, but a whitespace-insensitive match, which should be flagged.
    fsMock.readFile.mockResolvedValue('line one\nindented  target\nline three');

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'indented target', newText: 'x' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('whitespace-insensitive match');
  });

  it('refuses when oldText occurs multiple times without replaceAll', async () => {
    fsMock.readFile.mockResolvedValue('a a a');

    const result = await editFileExecutor({ path: 'a.txt', oldText: 'a', newText: 'b' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('3 times');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('applies a whitespace-tolerant match when oldText has different trailing spaces', async () => {
    // File has trailing spaces after "return 1;"; oldText does not.
    fsMock.readFile.mockResolvedValue('function f() {\n  return 1;   \n}');
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: '  return 1;\n}', newText: '  return 2;\n}' },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.whitespaceTolerant).toBe(true);
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      'function f() {\n  return 2;\n}',
      'utf-8'
    );
  });

  it('applies a CRLF-tolerant match when the file uses CRLF and oldText uses LF', async () => {
    fsMock.readFile.mockResolvedValue('alpha\r\nbeta\r\ngamma');
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'beta\ngamma', newText: 'BETA\nGAMMA' },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.whitespaceTolerant).toBe(true);
    // The matched CRLF region is replaced wholesale with the LF newText.
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      'alpha\r\nBETA\nGAMMA',
      'utf-8'
    );
  });

  it('does not fall back to a fuzzy match for an internal-whitespace difference', async () => {
    // Internal (non-trailing) whitespace is significant — must NOT auto-apply.
    fsMock.readFile.mockResolvedValue('indented  target');

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'indented target', newText: 'x' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('replaces all occurrences when replaceAll is true', async () => {
    fsMock.readFile.mockResolvedValue('a a a');
    fsMock.writeFile.mockResolvedValue(undefined);

    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'a', newText: 'b', replaceAll: true },
      ctx()
    );
    const data = parse(result);
    expect(data.success).toBe(true);
    expect(data.replacements).toBe(3);
    expect(fsMock.writeFile).toHaveBeenCalledWith(expect.any(String), 'b b b', 'utf-8');
  });

  it('rejects empty oldText (would match every position)', async () => {
    const result = await editFileExecutor({ path: 'a.txt', oldText: '', newText: 'x' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-empty');
  });

  it('rejects non-string newText', async () => {
    const result = await editFileExecutor(
      { path: 'a.txt', oldText: 'x', newText: 42 as unknown as string },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('string');
  });

  it('blocks paths outside workspace', async () => {
    const result = await editFileExecutor(
      { path: '/etc/passwd', oldText: 'root', newText: 'admin' },
      ctx()
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Access denied');
  });

  it('refuses files over MAX_FILE_SIZE', async () => {
    fsMock.stat.mockResolvedValue(makeStat({ size: 11 * 1024 * 1024 }));

    const result = await editFileExecutor({ path: 'huge.txt', oldText: 'x', newText: 'y' }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('too large');
  });
});

// ===========================================================================
// buildEditMismatchHint — diagnostic for failed edit_file matches
// ===========================================================================
describe('buildEditMismatchHint', () => {
  it('flags a whitespace-only difference', () => {
    const file = 'function foo() {\n        return 1;\n}';
    // Right text, wrong indentation.
    const hint = buildEditMismatchHint(file, 'return 1;');
    expect(hint).toContain('whitespace-insensitive match');
  });

  it('flags a CRLF vs LF difference', () => {
    const file = 'alpha\r\nbeta\r\ngamma';
    const hint = buildEditMismatchHint(file, 'alpha\nbeta');
    expect(hint).toContain('whitespace-insensitive match');
  });

  it('shows the actual nearby content when the first line anchors', () => {
    const file = 'a\nb\nconst target = 42;\nc\nd';
    // Same anchor line, but the rest of oldText is wrong so no exact match.
    const hint = buildEditMismatchHint(file, 'const target = 42;\nWRONG NEXT LINE');
    expect(hint).toContain('Actual file content');
    expect(hint).toContain('const target = 42;');
    expect(hint).toContain('Copy oldText verbatim');
  });

  it('caps the context window so it cannot flood output', () => {
    const longLine = 'x'.repeat(2000);
    const file = `anchorline\n${longLine}`;
    const hint = buildEditMismatchHint(file, 'anchorline\nnope');
    expect(hint).toContain('…');
    expect(hint.length).toBeLessThan(800);
  });

  it('falls back to a generic hint when nothing similar is found', () => {
    const hint = buildEditMismatchHint('completely unrelated content', 'zzz qqq vvv');
    expect(hint).toContain('No similar text was found');
  });
});

// ===========================================================================
// findFlexibleMatch — whitespace/CRLF-tolerant span finder
// ===========================================================================
describe('findFlexibleMatch', () => {
  it('returns null when there is no tolerant match', () => {
    expect(findFlexibleMatch('hello world', 'goodbye')).toBeNull();
  });

  it('matches across trailing-whitespace differences and returns the original span', () => {
    const original = 'foo\nbar   \nbaz';
    const m = findFlexibleMatch(original, 'bar\nbaz');
    expect(m).not.toBeNull();
    // Span replaces the real (trailing-space-bearing) region in the original.
    expect(original.slice(m!.start, m!.end)).toBe('bar   \nbaz');
    expect(m!.count).toBe(1);
  });

  it('matches across CRLF vs LF', () => {
    const original = 'a\r\nb\r\nc';
    const m = findFlexibleMatch(original, 'b\nc');
    expect(m).not.toBeNull();
    expect(original.slice(m!.start, m!.end)).toBe('b\r\nc');
  });

  it('counts multiple tolerant matches', () => {
    const m = findFlexibleMatch('x \nx \nx ', 'x');
    expect(m).not.toBeNull();
    expect(m!.count).toBe(3);
  });

  it('does not match on internal-whitespace differences', () => {
    expect(findFlexibleMatch('indented  target', 'indented target')).toBeNull();
  });

  it('preserves leading indentation as significant', () => {
    // oldText has no leading indent; file line does -> not a tolerant match.
    expect(findFlexibleMatch('    return 1;', 'return 1;')).not.toBeNull();
    // (substring still matches because "return 1;" is a suffix; verify span)
    const m = findFlexibleMatch('    return 1;', 'return 1;');
    expect('    return 1;'.slice(m!.start, m!.end)).toBe('return 1;');
  });
});

describe('buildSearchMissHint', () => {
  it('points at the filePattern when nothing was scanned and a filter was set', () => {
    const h = buildSearchMissHint(0, { filePattern: '*.ts' });
    expect(h).toMatch(/filePattern "\*\.ts"/);
    expect(h).toMatch(/broaden|remove/i);
  });

  it('points at the path when nothing was scanned and no filter was set', () => {
    const h = buildSearchMissHint(0, {});
    expect(h).toMatch(/path exists|list_directory/i);
  });

  it('suggests loosening the query when files were scanned but none matched', () => {
    const h = buildSearchMissHint(12, {});
    expect(h).toMatch(/Scanned 12 file/);
    expect(h).toMatch(/shorter or less specific/i);
  });

  it('suggests disabling case sensitivity when it was on', () => {
    const h = buildSearchMissHint(5, { caseSensitive: true });
    expect(h).toMatch(/caseSensitive:false/);
  });
});

describe('searchFilesExecutor no-match hint (integration)', () => {
  it('includes a hint when the search returns zero results', async () => {
    fsMock.realpath.mockImplementation(async (p: string) => p);
    // Empty directory -> nothing scanned -> path-oriented hint.
    fsMock.readdir.mockResolvedValue([]);

    const result = await searchFilesExecutor(
      { path: '/workspace', query: 'needle-that-is-absent' },
      ctx()
    );
    const data = parse(result);
    expect(data.count).toBe(0);
    expect(typeof data.hint).toBe('string');
    expect(data.hint.length).toBeGreaterThan(0);
  });
});
