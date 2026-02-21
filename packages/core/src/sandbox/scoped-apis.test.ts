import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as path from 'path';

// =============================================================================
// Mocks — must be before imports
// =============================================================================

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

// Note: mocking child_process.exec is required here because scoped-apis.ts
// uses it internally — this test validates the security wrapper around it.
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('../security/index.js', () => ({
  isCommandBlocked: vi.fn(() => false),
}));

// =============================================================================
// Imports (after mocks)
// =============================================================================

import * as fsPromises from 'fs/promises';
import { exec as execRaw } from 'child_process';
import { isCommandBlocked } from '../security/index.js';
import { createScopedFs, createScopedExec } from './scoped-apis.js';

// =============================================================================
// Typed mocks
// =============================================================================

const mockReadFile = fsPromises.readFile as unknown as Mock;
const mockWriteFile = fsPromises.writeFile as unknown as Mock;
const mockReaddir = fsPromises.readdir as unknown as Mock;
const mockStat = fsPromises.stat as unknown as Mock;
const mockMkdir = fsPromises.mkdir as unknown as Mock;
const mockUnlink = fsPromises.unlink as unknown as Mock;
const mockAccess = fsPromises.access as unknown as Mock;
const mockExec = execRaw as unknown as Mock;
const mockIsCommandBlocked = isCommandBlocked as unknown as Mock;

// =============================================================================
// Helpers
// =============================================================================

// Use an absolute path appropriate for the platform
const WORKSPACE = path.resolve('/workspace/project');
const MAX_OUTPUT_SIZE = 512 * 1024;

function makeStdinEnd() {
  return { end: vi.fn() };
}

function setupExecSuccess(stdout = '', stderr = '') {
  const stdin = makeStdinEnd();
  mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
    callback(null, stdout, stderr);
    return { stdin };
  });
  return stdin;
}

function setupExecError(error: { killed?: boolean; code?: number }, stdout = '', stderr = '') {
  const stdin = makeStdinEnd();
  mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
    callback(error, stdout, stderr);
    return { stdin };
  });
  return stdin;
}

// =============================================================================
// Tests
// =============================================================================

describe('scoped-apis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCommandBlocked.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Path Traversal Prevention (tested via public API methods)
  // ===========================================================================

  describe('path traversal prevention', () => {
    it('blocks ../ relative path', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('../secret.txt')).rejects.toThrow('Path traversal blocked');
    });

    it('blocks ../../etc/passwd', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('../../etc/passwd')).rejects.toThrow('Path traversal blocked');
    });

    it('blocks deeply nested traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('a/b/c/../../../../../etc/shadow')).rejects.toThrow('Path traversal blocked');
    });

    it('blocks .. alone', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('..')).rejects.toThrow('Path traversal blocked');
    });

    it('blocks absolute path outside workspace', async () => {
      const fs = createScopedFs(WORKSPACE);
      const outsidePath = path.resolve('/etc/passwd');
      await expect(fs.readFile(outsidePath)).rejects.toThrow('Path traversal blocked');
    });

    it('blocks sibling directory ../workspace2', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('../workspace2/file.txt')).rejects.toThrow('Path traversal blocked');
    });

    it('blocks path that starts with workspace name but is a sibling', async () => {
      // e.g. /workspace/project-evil should not be accepted if workspace is /workspace/project
      const fs = createScopedFs(WORKSPACE);
      // Construct a sibling: workspace + "-evil/file.txt"
      const siblingPath = WORKSPACE + '-evil/file.txt';
      await expect(fs.readFile(siblingPath)).rejects.toThrow('Path traversal blocked');
    });

    it('allows simple relative path within workspace', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('content');

      const result = await fs.readFile('subdir/file.txt');

      expect(result).toBe('content');
      const calledPath = mockReadFile.mock.calls[0]![0] as string;
      expect(calledPath).toBe(path.join(WORKSPACE, 'subdir', 'file.txt'));
    });

    it('allows path that resolves within workspace via ..', async () => {
      // subdir/../other/file.txt resolves to workspace/other/file.txt — still within workspace
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('data');

      const result = await fs.readFile('subdir/../other/file.txt');

      expect(result).toBe('data');
      const calledPath = mockReadFile.mock.calls[0]![0] as string;
      expect(calledPath).toBe(path.join(WORKSPACE, 'other', 'file.txt'));
    });

    it('allows workspace dir itself (empty relative path)', async () => {
      // Empty string resolves to the workspace dir itself
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue({
        size: 4096,
        isFile: () => false,
        isDirectory: () => true,
        mtime: new Date('2026-01-01'),
      });

      const result = await fs.stat('');

      expect(result.isDirectory).toBe(true);
    });

    it('allows . (current workspace)', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue({
        size: 4096,
        isFile: () => false,
        isDirectory: () => true,
        mtime: new Date('2026-01-01'),
      });

      const result = await fs.stat('.');

      expect(result.isDirectory).toBe(true);
    });

    it('allows deeply nested valid path', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('deep content');

      const deepPath = 'a/b/c/d/e/f/g/file.txt';
      await fs.readFile(deepPath);

      const calledPath = mockReadFile.mock.calls[0]![0] as string;
      expect(calledPath).toBe(path.join(WORKSPACE, ...deepPath.split('/')));
    });

    it('includes the offending path in the error message', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('../../secret')).rejects.toThrow("'../../secret'");
    });

    it('blocks traversal in all fs methods consistently', async () => {
      const fs = createScopedFs(WORKSPACE);
      const traversalPath = '../../evil';

      await expect(fs.readFile(traversalPath)).rejects.toThrow('Path traversal blocked');
      await expect(fs.writeFile(traversalPath, 'data')).rejects.toThrow('Path traversal blocked');
      await expect(fs.readdir(traversalPath)).rejects.toThrow('Path traversal blocked');
      await expect(fs.stat(traversalPath)).rejects.toThrow('Path traversal blocked');
      await expect(fs.mkdir(traversalPath)).rejects.toThrow('Path traversal blocked');
      await expect(fs.unlink(traversalPath)).rejects.toThrow('Path traversal blocked');
    });

    it('exists() returns false on path traversal (error is caught)', async () => {
      // exists() wraps everything in try/catch, so traversal error returns false
      const fs = createScopedFs(WORKSPACE);

      const result = await fs.exists('../../etc/passwd');

      expect(result).toBe(false);
      expect(mockAccess).not.toHaveBeenCalled();
    });

    it('allows absolute path that is within workspace', async () => {
      const fs = createScopedFs(WORKSPACE);
      const insidePath = path.join(WORKSPACE, 'sub', 'file.txt');
      mockReadFile.mockResolvedValue('ok');

      await fs.readFile(insidePath);

      expect(mockReadFile).toHaveBeenCalledWith(insidePath, expect.any(Object));
    });

    it('blocks traversal disguised with backslashes on windows-style paths', async () => {
      // On Windows, path.resolve normalizes backslashes — still caught by startsWith check
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('..\\..\\secret.txt')).rejects.toThrow('Path traversal blocked');
    });
  });

  // ===========================================================================
  // createScopedFs.readFile
  // ===========================================================================

  describe('createScopedFs.readFile', () => {
    it('reads file with default encoding (utf-8)', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('file content');

      const result = await fs.readFile('test.txt');

      expect(result).toBe('file content');
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'test.txt'),
        { encoding: 'utf-8' },
      );
    });

    it('reads file with custom encoding', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('ascii content');

      const result = await fs.readFile('data.bin', 'ascii');

      expect(result).toBe('ascii content');
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'data.bin'),
        { encoding: 'ascii' },
      );
    });

    it('reads file with base64 encoding', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('aGVsbG8=');

      const result = await fs.readFile('image.png', 'base64');

      expect(result).toBe('aGVsbG8=');
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'image.png'),
        { encoding: 'base64' },
      );
    });

    it('uses utf-8 when encoding is empty string', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('data');

      await fs.readFile('file.txt', '');

      // encoding || 'utf-8' — '' is falsy so falls back to 'utf-8'
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'file.txt'),
        { encoding: 'utf-8' },
      );
    });

    it('blocks path traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readFile('../etc/passwd')).rejects.toThrow('Path traversal blocked');
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('propagates fs read errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(fs.readFile('missing.txt')).rejects.toThrow('ENOENT: no such file');
    });

    it('propagates permission errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(fs.readFile('protected.txt')).rejects.toThrow('EACCES: permission denied');
    });

    it('resolves nested path correctly', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReadFile.mockResolvedValue('nested');

      await fs.readFile('a/b/c.txt');

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'a', 'b', 'c.txt'),
        { encoding: 'utf-8' },
      );
    });
  });

  // ===========================================================================
  // createScopedFs.writeFile
  // ===========================================================================

  describe('createScopedFs.writeFile', () => {
    it('writes content to file', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await fs.writeFile('output.txt', 'hello world');

      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'output.txt'),
        'hello world',
        'utf-8',
      );
    });

    it('creates parent directory automatically', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await fs.writeFile('sub/dir/file.txt', 'data');

      const expectedFilePath = path.join(WORKSPACE, 'sub', 'dir', 'file.txt');
      const expectedDirPath = path.dirname(expectedFilePath);
      expect(mockMkdir).toHaveBeenCalledWith(expectedDirPath, { recursive: true });
    });

    it('calls mkdir before writeFile', async () => {
      const fs = createScopedFs(WORKSPACE);
      const callOrder: string[] = [];
      mockMkdir.mockImplementation(() => {
        callOrder.push('mkdir');
        return Promise.resolve(undefined);
      });
      mockWriteFile.mockImplementation(() => {
        callOrder.push('writeFile');
        return Promise.resolve(undefined);
      });

      await fs.writeFile('dir/file.txt', 'content');

      expect(callOrder).toEqual(['mkdir', 'writeFile']);
    });

    it('blocks path traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.writeFile('../../etc/cron', 'malicious')).rejects.toThrow('Path traversal blocked');
      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('propagates mkdir errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(fs.writeFile('dir/file.txt', 'data')).rejects.toThrow('EACCES');
    });

    it('propagates writeFile errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockRejectedValue(new Error('ENOSPC: no space left'));

      await expect(fs.writeFile('file.txt', 'data')).rejects.toThrow('ENOSPC');
    });

    it('writes empty content', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await fs.writeFile('empty.txt', '');

      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'empty.txt'),
        '',
        'utf-8',
      );
    });

    it('writes large content', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const largeContent = 'x'.repeat(1_000_000);
      await fs.writeFile('big.txt', largeContent);

      expect(mockWriteFile).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'big.txt'),
        largeContent,
        'utf-8',
      );
    });
  });

  // ===========================================================================
  // createScopedFs.readdir
  // ===========================================================================

  describe('createScopedFs.readdir', () => {
    it('lists directory contents', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockResolvedValue(['file1.txt', 'file2.txt', 'subdir']);

      const result = await fs.readdir('src');

      expect(result).toEqual(['file1.txt', 'file2.txt', 'subdir']);
      expect(mockReaddir).toHaveBeenCalledWith(path.join(WORKSPACE, 'src'));
    });

    it('uses workspaceDir when no argument', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockResolvedValue(['a', 'b']);

      const result = await fs.readdir();

      expect(result).toEqual(['a', 'b']);
      expect(mockReaddir).toHaveBeenCalledWith(WORKSPACE);
    });

    it('uses workspaceDir when undefined is passed', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockResolvedValue([]);

      await fs.readdir(undefined);

      expect(mockReaddir).toHaveBeenCalledWith(WORKSPACE);
    });

    it('blocks path traversal for provided directory', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.readdir('../../')).rejects.toThrow('Path traversal blocked');
      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it('returns empty array for empty directory', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockResolvedValue([]);

      const result = await fs.readdir('empty-dir');

      expect(result).toEqual([]);
    });

    it('propagates fs errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'));

      await expect(fs.readdir('nonexistent')).rejects.toThrow('ENOENT');
    });
  });

  // ===========================================================================
  // createScopedFs.stat
  // ===========================================================================

  describe('createScopedFs.stat', () => {
    const mockStatResult = {
      size: 1024,
      isFile: () => true,
      isDirectory: () => false,
      mtime: new Date('2026-01-15T10:30:00.000Z'),
    };

    it('returns correct shape { size, isFile, isDirectory, modified }', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue(mockStatResult);

      const result = await fs.stat('file.txt');

      expect(result).toEqual({
        size: 1024,
        isFile: true,
        isDirectory: false,
        modified: '2026-01-15T10:30:00.000Z',
      });
    });

    it('modified is an ISO string', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue(mockStatResult);

      const result = await fs.stat('file.txt');

      expect(typeof result.modified).toBe('string');
      // Verify it round-trips through Date correctly
      expect(new Date(result.modified).toISOString()).toBe(result.modified);
    });

    it('returns correct values for a directory', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue({
        size: 4096,
        isFile: () => false,
        isDirectory: () => true,
        mtime: new Date('2026-02-01T08:00:00.000Z'),
      });

      const result = await fs.stat('src');

      expect(result.isFile).toBe(false);
      expect(result.isDirectory).toBe(true);
      expect(result.size).toBe(4096);
    });

    it('blocks path traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.stat('../../etc')).rejects.toThrow('Path traversal blocked');
      expect(mockStat).not.toHaveBeenCalled();
    });

    it('resolves path correctly', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue(mockStatResult);

      await fs.stat('subdir/file.log');

      expect(mockStat).toHaveBeenCalledWith(path.join(WORKSPACE, 'subdir', 'file.log'));
    });

    it('propagates fs errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(fs.stat('missing.txt')).rejects.toThrow('ENOENT');
    });

    it('handles zero-size file', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockStat.mockResolvedValue({
        size: 0,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await fs.stat('empty.txt');

      expect(result.size).toBe(0);
      expect(result.isFile).toBe(true);
    });
  });

  // ===========================================================================
  // createScopedFs.mkdir
  // ===========================================================================

  describe('createScopedFs.mkdir', () => {
    it('creates directory with recursive default true', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);

      await fs.mkdir('new-dir/sub-dir');

      expect(mockMkdir).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'new-dir', 'sub-dir'),
        { recursive: true },
      );
    });

    it('creates directory with explicit recursive=true', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);

      await fs.mkdir('deep/path', true);

      expect(mockMkdir).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'deep', 'path'),
        { recursive: true },
      );
    });

    it('creates directory with recursive=false', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);

      await fs.mkdir('single-dir', false);

      expect(mockMkdir).toHaveBeenCalledWith(
        path.join(WORKSPACE, 'single-dir'),
        { recursive: false },
      );
    });

    it('blocks path traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.mkdir('../../evil-dir')).rejects.toThrow('Path traversal blocked');
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it('propagates fs errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(fs.mkdir('restricted')).rejects.toThrow('EACCES');
    });
  });

  // ===========================================================================
  // createScopedFs.unlink
  // ===========================================================================

  describe('createScopedFs.unlink', () => {
    it('deletes file at safe path', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockUnlink.mockResolvedValue(undefined);

      await fs.unlink('temp.txt');

      expect(mockUnlink).toHaveBeenCalledWith(path.join(WORKSPACE, 'temp.txt'));
    });

    it('deletes file in nested directory', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockUnlink.mockResolvedValue(undefined);

      await fs.unlink('sub/dir/file.log');

      expect(mockUnlink).toHaveBeenCalledWith(path.join(WORKSPACE, 'sub', 'dir', 'file.log'));
    });

    it('blocks path traversal', async () => {
      const fs = createScopedFs(WORKSPACE);
      await expect(fs.unlink('../../important.db')).rejects.toThrow('Path traversal blocked');
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('propagates fs errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockUnlink.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(fs.unlink('gone.txt')).rejects.toThrow('ENOENT');
    });

    it('propagates permission errors', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockUnlink.mockRejectedValue(new Error('EPERM: operation not permitted'));

      await expect(fs.unlink('system-file')).rejects.toThrow('EPERM');
    });
  });

  // ===========================================================================
  // createScopedFs.exists
  // ===========================================================================

  describe('createScopedFs.exists', () => {
    it('returns true when file exists (access succeeds)', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockResolvedValue(undefined);

      const result = await fs.exists('present.txt');

      expect(result).toBe(true);
      expect(mockAccess).toHaveBeenCalledWith(path.join(WORKSPACE, 'present.txt'));
    });

    it('returns false when file does not exist (access throws)', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      const result = await fs.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('returns false on path traversal (error is caught)', async () => {
      // exists() wraps everything in try/catch, so traversal error returns false
      const fs = createScopedFs(WORKSPACE);

      const result = await fs.exists('../../etc/passwd');

      expect(result).toBe(false);
      expect(mockAccess).not.toHaveBeenCalled();
    });

    it('returns false on permission error', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockRejectedValue(new Error('EACCES'));

      const result = await fs.exists('protected.txt');

      expect(result).toBe(false);
    });

    it('resolves path correctly before checking', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockResolvedValue(undefined);

      await fs.exists('sub/dir/check.txt');

      expect(mockAccess).toHaveBeenCalledWith(path.join(WORKSPACE, 'sub', 'dir', 'check.txt'));
    });

    it('returns true for workspace root path (dot)', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockResolvedValue(undefined);

      const result = await fs.exists('.');

      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // createScopedFs — factory behavior
  // ===========================================================================

  describe('createScopedFs factory', () => {
    it('returns an object with all ScopedFs methods', () => {
      const fs = createScopedFs(WORKSPACE);

      expect(typeof fs.readFile).toBe('function');
      expect(typeof fs.writeFile).toBe('function');
      expect(typeof fs.readdir).toBe('function');
      expect(typeof fs.stat).toBe('function');
      expect(typeof fs.mkdir).toBe('function');
      expect(typeof fs.unlink).toBe('function');
      expect(typeof fs.exists).toBe('function');
    });

    it('creates independent instances for different workspaces', async () => {
      const ws1 = path.resolve('/workspace/one');
      const ws2 = path.resolve('/workspace/two');
      const fs1 = createScopedFs(ws1);
      const fs2 = createScopedFs(ws2);
      mockReadFile.mockResolvedValue('data');

      await fs1.readFile('file.txt');
      await fs2.readFile('file.txt');

      expect(mockReadFile.mock.calls[0]![0]).toBe(path.join(ws1, 'file.txt'));
      expect(mockReadFile.mock.calls[1]![0]).toBe(path.join(ws2, 'file.txt'));
    });
  });

  // ===========================================================================
  // createScopedExec
  // ===========================================================================

  describe('createScopedExec', () => {
    describe('successful execution', () => {
      it('returns { stdout, stderr, exitCode: 0 } on success', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('hello world', '');

        const result = await scopedExec.exec('echo hello world');

        expect(result).toEqual({
          stdout: 'hello world',
          stderr: '',
          exitCode: 0,
        });
      });

      it('returns both stdout and stderr', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('output', 'warning');

        const result = await scopedExec.exec('some-command');

        expect(result.stdout).toBe('output');
        expect(result.stderr).toBe('warning');
        expect(result.exitCode).toBe(0);
      });

      it('returns empty strings for null stdout/stderr', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = makeStdinEnd();
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback(null, null, null);
          return { stdin };
        });

        const result = await scopedExec.exec('silent-cmd');

        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      });

      it('returns empty strings for undefined stdout/stderr', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = makeStdinEnd();
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback(null, undefined, undefined);
          return { stdin };
        });

        const result = await scopedExec.exec('quiet-cmd');

        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      });
    });

    describe('command errors', () => {
      it('resolves with exitCode from error.code on non-killed error', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecError({ killed: false, code: 127 }, '', 'command not found');

        const result = await scopedExec.exec('nonexistent-cmd');

        expect(result.exitCode).toBe(127);
        expect(result.stderr).toBe('command not found');
      });

      it('defaults exitCode to 1 when error.code is undefined', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecError({ killed: false }, '', 'generic error');

        const result = await scopedExec.exec('bad-cmd');

        expect(result.exitCode).toBe(1);
      });

      it('preserves stdout on error', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecError({ killed: false, code: 1 }, 'partial output', 'then error');

        const result = await scopedExec.exec('failing-cmd');

        expect(result.stdout).toBe('partial output');
        expect(result.stderr).toBe('then error');
        expect(result.exitCode).toBe(1);
      });

      it('handles null stdout/stderr on error', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = makeStdinEnd();
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback({ killed: false, code: 2 }, null, null);
          return { stdin };
        });

        const result = await scopedExec.exec('err-cmd');

        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(2);
      });
    });

    describe('timeout handling', () => {
      it('rejects with timeout error when command is killed', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = makeStdinEnd();
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback({ killed: true }, '', '');
          return { stdin };
        });

        await expect(scopedExec.exec('hang-cmd')).rejects.toThrow('Command timed out after 30000ms');
      });

      it('uses default timeout of 30000ms', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('cmd');

        const opts = mockExec.mock.calls[0]![1] as { timeout: number };
        expect(opts.timeout).toBe(30000);
      });

      it('uses custom timeout', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('cmd', 5000);

        const opts = mockExec.mock.calls[0]![1] as { timeout: number };
        expect(opts.timeout).toBe(5000);
      });

      it('includes custom timeout in error message', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = makeStdinEnd();
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback({ killed: true }, '', '');
          return { stdin };
        });

        await expect(scopedExec.exec('slow-cmd', 10000)).rejects.toThrow('Command timed out after 10000ms');
      });

      it('sets maxBuffer to MAX_OUTPUT_SIZE (512KB)', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('data');

        await scopedExec.exec('cmd');

        const opts = mockExec.mock.calls[0]![1] as { maxBuffer: number };
        expect(opts.maxBuffer).toBe(MAX_OUTPUT_SIZE);
      });
    });

    describe('command blocking', () => {
      it('throws immediately for blocked commands', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockIsCommandBlocked.mockReturnValue(true);

        await expect(scopedExec.exec('rm -rf /')).rejects.toThrow('Command blocked for security reasons.');
        expect(mockExec).not.toHaveBeenCalled();
      });

      it('calls isCommandBlocked with the command string', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockIsCommandBlocked.mockReturnValue(true);

        await expect(scopedExec.exec('dangerous --flag')).rejects.toThrow('Command blocked');

        expect(mockIsCommandBlocked).toHaveBeenCalledWith('dangerous --flag');
      });

      it('allows commands when isCommandBlocked returns false', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockIsCommandBlocked.mockReturnValue(false);
        setupExecSuccess('output');

        const result = await scopedExec.exec('ls -la');

        expect(result.exitCode).toBe(0);
        expect(mockIsCommandBlocked).toHaveBeenCalledWith('ls -la');
      });

      it('checks blocking before spawning process', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockIsCommandBlocked.mockReturnValue(true);

        try {
          await scopedExec.exec('evil');
        } catch {
          // expected
        }

        // exec should never be called if command is blocked
        expect(mockExec).not.toHaveBeenCalled();
      });
    });

    describe('output truncation', () => {
      it('truncates stdout to MAX_OUTPUT_SIZE', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const largeOutput = 'x'.repeat(MAX_OUTPUT_SIZE + 1000);
        setupExecSuccess(largeOutput, '');

        const result = await scopedExec.exec('big-output-cmd');

        expect(result.stdout.length).toBe(MAX_OUTPUT_SIZE);
      });

      it('truncates stderr to MAX_OUTPUT_SIZE', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const largeError = 'e'.repeat(MAX_OUTPUT_SIZE + 500);
        setupExecSuccess('', largeError);

        const result = await scopedExec.exec('noisy-cmd');

        expect(result.stderr.length).toBe(MAX_OUTPUT_SIZE);
      });

      it('truncates both stdout and stderr independently', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const largeOut = 'o'.repeat(MAX_OUTPUT_SIZE + 100);
        const largeErr = 'e'.repeat(MAX_OUTPUT_SIZE + 200);
        setupExecSuccess(largeOut, largeErr);

        const result = await scopedExec.exec('verbose-cmd');

        expect(result.stdout.length).toBe(MAX_OUTPUT_SIZE);
        expect(result.stderr.length).toBe(MAX_OUTPUT_SIZE);
      });

      it('does not truncate output within limit', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const normalOutput = 'abc'.repeat(100);
        setupExecSuccess(normalOutput, '');

        const result = await scopedExec.exec('normal-cmd');

        expect(result.stdout).toBe(normalOutput);
      });

      it('does not truncate output at exactly MAX_OUTPUT_SIZE', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const exactOutput = 'x'.repeat(MAX_OUTPUT_SIZE);
        setupExecSuccess(exactOutput, '');

        const result = await scopedExec.exec('exact-cmd');

        expect(result.stdout.length).toBe(MAX_OUTPUT_SIZE);
        expect(result.stdout).toBe(exactOutput);
      });

      it('truncates stdout on error path too', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const largeOutput = 'x'.repeat(MAX_OUTPUT_SIZE + 500);
        setupExecError({ killed: false, code: 1 }, largeOutput, '');

        const result = await scopedExec.exec('failing-verbose-cmd');

        expect(result.stdout.length).toBe(MAX_OUTPUT_SIZE);
        expect(result.exitCode).toBe(1);
      });

      it('truncates stderr on error path too', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const largeError = 'e'.repeat(MAX_OUTPUT_SIZE + 500);
        setupExecError({ killed: false, code: 1 }, '', largeError);

        const result = await scopedExec.exec('err-verbose-cmd');

        expect(result.stderr.length).toBe(MAX_OUTPUT_SIZE);
      });
    });

    describe('environment sanitization', () => {
      it('passes only safe env vars', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('cmd');

        const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
        const passedEnvKeys = Object.keys(opts.env);

        // All passed keys must be in the safe list
        const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'NODE_ENV', 'TZ',
          'SHELL', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
          'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC',
          'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles',
          'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
        for (const key of passedEnvKeys) {
          expect(SAFE_ENV_KEYS).toContain(key);
        }
      });

      it('does NOT pass API key environment variables', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        // Temporarily set some dangerous env vars
        const originalApiKey = process.env.API_KEY;
        const originalOpenaiKey = process.env.OPENAI_API_KEY;
        const originalDbUrl = process.env.DATABASE_URL;
        process.env.API_KEY = 'secret-api-key';
        process.env.OPENAI_API_KEY = 'sk-secret';
        process.env.DATABASE_URL = 'postgres://secret';

        try {
          setupExecSuccess('ok');
          await scopedExec.exec('cmd');

          const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
          expect(opts.env.API_KEY).toBeUndefined();
          expect(opts.env.OPENAI_API_KEY).toBeUndefined();
          expect(opts.env.DATABASE_URL).toBeUndefined();
        } finally {
          // Restore
          if (originalApiKey === undefined) delete process.env.API_KEY;
          else process.env.API_KEY = originalApiKey;
          if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
          else process.env.OPENAI_API_KEY = originalOpenaiKey;
          if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = originalDbUrl;
        }
      });

      it('does NOT pass SECRET_ prefixed env vars', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const originalSecret = process.env.SECRET_TOKEN;
        process.env.SECRET_TOKEN = 'super-secret';

        try {
          setupExecSuccess('ok');
          await scopedExec.exec('cmd');

          const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
          expect(opts.env.SECRET_TOKEN).toBeUndefined();
        } finally {
          if (originalSecret === undefined) delete process.env.SECRET_TOKEN;
          else process.env.SECRET_TOKEN = originalSecret;
        }
      });

      it('includes PATH in safe env when available', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('cmd');

        const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
        // PATH should be present if it's in process.env (which it almost always is)
        if (process.env.PATH) {
          expect(opts.env.PATH).toBe(process.env.PATH);
        }
      });

      it('includes NODE_ENV in safe env when available', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';

        try {
          setupExecSuccess('ok');
          await scopedExec.exec('cmd');

          const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
          expect(opts.env.NODE_ENV).toBe('test');
        } finally {
          if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = originalNodeEnv;
        }
      });

      it('skips safe env vars that are not set in process.env', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        // TMPDIR might not be set on all platforms
        const originalTmpdir = process.env.TMPDIR;
        delete process.env.TMPDIR;

        try {
          setupExecSuccess('ok');
          await scopedExec.exec('cmd');

          const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
          expect(opts.env.TMPDIR).toBeUndefined();
        } finally {
          if (originalTmpdir !== undefined) process.env.TMPDIR = originalTmpdir;
        }
      });

      it('copies the value of safe env vars exactly', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const originalHome = process.env.HOME;
        process.env.HOME = '/custom/home/path';

        try {
          setupExecSuccess('ok');
          await scopedExec.exec('cmd');

          const opts = mockExec.mock.calls[0]![1] as { env: Record<string, string> };
          expect(opts.env.HOME).toBe('/custom/home/path');
        } finally {
          if (originalHome === undefined) delete process.env.HOME;
          else process.env.HOME = originalHome;
        }
      });
    });

    describe('working directory', () => {
      it('sets cwd to workspaceDir', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('pwd');

        const opts = mockExec.mock.calls[0]![1] as { cwd: string };
        expect(opts.cwd).toBe(WORKSPACE);
      });

      it('uses workspace dir specific to the instance', async () => {
        const customWorkspace = path.resolve('/custom/workspace');
        const scopedExec = createScopedExec(customWorkspace);
        setupExecSuccess('ok');

        await scopedExec.exec('ls');

        const opts = mockExec.mock.calls[0]![1] as { cwd: string };
        expect(opts.cwd).toBe(customWorkspace);
      });
    });

    describe('stdin handling', () => {
      it('calls stdin.end() after spawning', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        const stdin = setupExecSuccess('ok');

        await scopedExec.exec('cmd');

        expect(stdin.end).toHaveBeenCalled();
      });

      it('handles missing stdin gracefully (optional chaining)', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback(null, 'output', '');
          return { stdin: null };
        });

        // Should not throw even when stdin is null (optional chaining: child.stdin?.end())
        const result = await scopedExec.exec('cmd');
        expect(result.exitCode).toBe(0);
      });

      it('handles undefined stdin gracefully', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        mockExec.mockImplementation((_cmd: string, _opts: unknown, callback: (...args: unknown[]) => void) => {
          callback(null, 'output', '');
          return { stdin: undefined };
        });

        const result = await scopedExec.exec('cmd');
        expect(result.exitCode).toBe(0);
      });
    });

    describe('exec options', () => {
      it('passes command as first argument', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('node --version');

        expect(mockExec.mock.calls[0]![0]).toBe('node --version');
      });

      it('passes all expected options together', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('test-cmd', 15000);

        const opts = mockExec.mock.calls[0]![1] as Record<string, unknown>;
        expect(opts.cwd).toBe(WORKSPACE);
        expect(opts.timeout).toBe(15000);
        expect(opts.maxBuffer).toBe(MAX_OUTPUT_SIZE);
        expect(opts.env).toBeDefined();
        expect(typeof opts.env).toBe('object');
      });

      it('passes callback as third argument', async () => {
        const scopedExec = createScopedExec(WORKSPACE);
        setupExecSuccess('ok');

        await scopedExec.exec('cmd');

        expect(typeof mockExec.mock.calls[0]![2]).toBe('function');
      });
    });

    describe('factory behavior', () => {
      it('returns an object with exec method', () => {
        const scopedExec = createScopedExec(WORKSPACE);
        expect(typeof scopedExec.exec).toBe('function');
      });

      it('creates independent instances for different workspaces', async () => {
        const ws1 = path.resolve('/workspace/one');
        const ws2 = path.resolve('/workspace/two');
        const exec1 = createScopedExec(ws1);
        const exec2 = createScopedExec(ws2);

        setupExecSuccess('ok');
        await exec1.exec('cmd1');
        const opts1 = mockExec.mock.calls[0]![1] as { cwd: string };
        expect(opts1.cwd).toBe(ws1);

        vi.clearAllMocks();
        mockIsCommandBlocked.mockReturnValue(false);
        setupExecSuccess('ok');
        await exec2.exec('cmd2');
        const opts2 = mockExec.mock.calls[0]![1] as { cwd: string };
        expect(opts2.cwd).toBe(ws2);
      });
    });
  });

  // ===========================================================================
  // Integration-style tests (multiple methods together)
  // ===========================================================================

  describe('integration scenarios', () => {
    it('writeFile then readFile at same path', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('written content');

      await fs.writeFile('test.txt', 'written content');
      const result = await fs.readFile('test.txt');

      expect(result).toBe('written content');
      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      const readPath = mockReadFile.mock.calls[0]![0] as string;
      expect(writePath).toBe(readPath);
    });

    it('mkdir then writeFile in that directory', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await fs.mkdir('output');
      await fs.writeFile('output/result.json', '{}');

      // mkdir should be called for explicit 'output' dir AND for parent of 'output/result.json'
      expect(mockMkdir).toHaveBeenCalledTimes(2);
    });

    it('exists returns true then unlink then exists returns false', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockAccess.mockResolvedValueOnce(undefined); // first exists -> true
      mockUnlink.mockResolvedValue(undefined);
      mockAccess.mockRejectedValueOnce(new Error('ENOENT')); // second exists -> false

      const existsBefore = await fs.exists('temp.txt');
      await fs.unlink('temp.txt');
      const existsAfter = await fs.exists('temp.txt');

      expect(existsBefore).toBe(true);
      expect(existsAfter).toBe(false);
    });

    it('stat returns file info for written file', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({
        size: 13,
        isFile: () => true,
        isDirectory: () => false,
        mtime: new Date('2026-02-21T12:00:00.000Z'),
      });

      await fs.writeFile('data.txt', 'hello world!!');
      const info = await fs.stat('data.txt');

      expect(info.size).toBe(13);
      expect(info.isFile).toBe(true);
      expect(info.modified).toBe('2026-02-21T12:00:00.000Z');
    });

    it('readdir then readFile each entry', async () => {
      const fs = createScopedFs(WORKSPACE);
      mockReaddir.mockResolvedValue(['a.txt', 'b.txt']);
      mockReadFile.mockResolvedValueOnce('content a');
      mockReadFile.mockResolvedValueOnce('content b');

      const entries = await fs.readdir('docs');
      const contents = await Promise.all(entries.map((e: string) => fs.readFile(`docs/${e}`)));

      expect(contents).toEqual(['content a', 'content b']);
    });
  });
});
