/**
 * Tests for file tool executors
 *
 * Covers: create_folder, write_file, read_file, list_files, delete_file, move_file
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
const mockStat = vi.hoisted(() => vi.fn());
const mockReaddir = vi.hoisted(() => vi.fn());
const mockRmdir = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());

const mockResolveWorkspacePath = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  stat: mockStat,
  readdir: mockReaddir,
  rmdir: mockRmdir,
  unlink: mockUnlink,
  rename: mockRename,
}));

vi.mock('./helpers.js', () => ({
  resolveWorkspacePath: mockResolveWorkspacePath,
  getWorkspacePath: () => '/workspace',
  WORKSPACE_DIR: 'workspace',
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { FILE_EXECUTORS } from './file-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVED = '/workspace/test';

function resetMocks() {
  vi.clearAllMocks();
  mockResolveWorkspacePath.mockReturnValue(RESOLVED);
  mockExistsSync.mockReturnValue(true);
}

// =============================================================================
// create_folder
// =============================================================================

describe('FILE_EXECUTORS.create_folder', () => {
  const fn = FILE_EXECUTORS.create_folder!;

  beforeEach(resetMocks);

  it('returns error when path is empty', async () => {
    const result = await fn({ path: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is required');
  });

  it('returns error when path is not provided', async () => {
    const result = await fn({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is required');
  });

  it('returns error when path resolves outside workspace', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ path: '../../etc' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('creates folder successfully', async () => {
    mockMkdir.mockResolvedValue(undefined);
    const result = await fn({ path: 'my-folder' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('Folder created');
    expect(result.content).toContain('my-folder');
    expect(mockMkdir).toHaveBeenCalledWith(RESOLVED, { recursive: true });
  });

  it('returns error when mkdir throws', async () => {
    mockMkdir.mockRejectedValue(new Error('Permission denied'));
    const result = await fn({ path: 'my-folder' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error creating folder');
    expect(result.content).toContain('Permission denied');
  });
});

// =============================================================================
// write_file
// =============================================================================

describe('FILE_EXECUTORS.write_file', () => {
  const fn = FILE_EXECUTORS.write_file!;

  beforeEach(resetMocks);

  it('returns error when path is empty', async () => {
    const result = await fn({ path: '', content: 'data' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is required');
  });

  it('returns error when content is undefined', async () => {
    const result = await fn({ path: 'file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Content is required');
  });

  it('returns error when content is null', async () => {
    const result = await fn({ path: 'file.txt', content: null });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Content is required');
  });

  it('returns error when path resolves outside workspace', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ path: '../file.txt', content: 'data' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('writes file successfully when parent exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 42 });

    const result = await fn({ path: 'file.txt', content: 'hello world' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('File written');
    expect(result.content).toContain('42 bytes');
    expect(mockWriteFile).toHaveBeenCalledWith(RESOLVED, 'hello world', 'utf-8');
  });

  it('creates parent directory when it does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 10 });

    const result = await fn({ path: 'sub/file.txt', content: 'data' });
    expect(result.isError).toBeUndefined();
    expect(mockMkdir).toHaveBeenCalled();
  });

  it('returns error when writeFile throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockRejectedValue(new Error('Disk full'));

    const result = await fn({ path: 'file.txt', content: 'data' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error writing file');
    expect(result.content).toContain('Disk full');
  });
});

// =============================================================================
// read_file
// =============================================================================

describe('FILE_EXECUTORS.read_file', () => {
  const fn = FILE_EXECUTORS.read_file!;

  beforeEach(resetMocks);

  it('returns error when path is empty', async () => {
    const result = await fn({ path: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is required');
  });

  it('returns error when path resolves outside workspace', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ path: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('returns error when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await fn({ path: 'missing.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('File not found');
  });

  it('returns error when path is a directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => true });
    const result = await fn({ path: 'mydir' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is a directory');
  });

  it('reads file successfully', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => false });
    mockReadFile.mockResolvedValue('file contents here');

    const result = await fn({ path: 'file.txt' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe('file contents here');
    expect(mockReadFile).toHaveBeenCalledWith(RESOLVED, 'utf-8');
  });

  it('returns error when readFile throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockRejectedValue(new Error('IO error'));

    const result = await fn({ path: 'file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error reading file');
  });
});

// =============================================================================
// list_files
// =============================================================================

describe('FILE_EXECUTORS.list_files', () => {
  const fn = FILE_EXECUTORS.list_files!;

  beforeEach(resetMocks);

  it('returns error when path resolves outside workspace', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ path: '../../' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('returns error when directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await fn({ path: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Directory not found');
  });

  it('returns error when path is not a directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => false });
    const result = await fn({ path: 'file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not a directory');
  });

  it('returns empty directory message', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockReaddir.mockResolvedValue([]);

    const result = await fn({ path: '' });
    expect(result.content).toContain('Directory is empty');
  });

  it('lists files with size in bytes', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true }) // dir check
      .mockResolvedValueOnce({ size: 512 }); // file size
    mockReaddir.mockResolvedValue([{ name: 'small.txt', isDirectory: () => false }]);

    const result = await fn({ path: '' });
    expect(result.content).toContain('small.txt');
    expect(result.content).toContain('512 B');
  });

  it('lists files with size in KB', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true }) // dir check
      .mockResolvedValueOnce({ size: 2048 }); // file size
    mockReaddir.mockResolvedValue([{ name: 'medium.txt', isDirectory: () => false }]);

    const result = await fn({ path: '' });
    expect(result.content).toContain('KB');
  });

  it('lists files with size in MB', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true }) // dir check
      .mockResolvedValueOnce({ size: 2 * 1024 * 1024 }); // file size
    mockReaddir.mockResolvedValue([{ name: 'large.bin', isDirectory: () => false }]);

    const result = await fn({ path: '' });
    expect(result.content).toContain('MB');
  });

  it('lists directories with folder icon', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true }); // dir check
    mockReaddir.mockResolvedValue([{ name: 'subdir', isDirectory: () => true }]);

    const result = await fn({ path: '' });
    expect(result.content).toContain('subdir/');
  });

  it('lists recursively when recursive flag is set', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true }); // dir check

    // Root readdir returns a subdirectory
    mockReaddir.mockResolvedValueOnce([{ name: 'subdir', isDirectory: () => true }]);
    // Recursive readdir for subdir returns a file
    mockReaddir.mockResolvedValueOnce([{ name: 'nested.txt', isDirectory: () => false }]);
    mockStat.mockResolvedValueOnce({ size: 100 }); // nested file size

    const result = await fn({ path: '', recursive: true });
    expect(result.content).toContain('subdir/');
    expect(result.content).toContain('subdir/nested.txt');
  });

  it('does not recurse when recursive flag is false', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true });
    mockReaddir.mockResolvedValueOnce([{ name: 'subdir', isDirectory: () => true }]);

    const result = await fn({ path: '', recursive: false });
    expect(result.content).toContain('subdir/');
    // readdir only called once (for root), not for subdir
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it('uses default empty path when none provided', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true });
    mockReaddir.mockResolvedValue([]);

    const result = await fn({});
    expect(result.content).toContain('/');
  });

  it('returns error when readdir throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true });
    mockReaddir.mockRejectedValue(new Error('Access denied'));

    const result = await fn({ path: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error listing directory');
  });

  it('shows prefix path for nested files in recursive listing', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValueOnce({ isDirectory: () => true }); // dir check

    mockReaddir.mockResolvedValueOnce([{ name: 'a', isDirectory: () => true }]);
    mockReaddir.mockResolvedValueOnce([{ name: 'b', isDirectory: () => true }]);
    mockReaddir.mockResolvedValueOnce([{ name: 'file.txt', isDirectory: () => false }]);
    mockStat.mockResolvedValueOnce({ size: 50 });

    const result = await fn({ path: 'root', recursive: true });
    expect(result.content).toContain('a/b/file.txt');
  });
});

// =============================================================================
// delete_file
// =============================================================================

describe('FILE_EXECUTORS.delete_file', () => {
  const fn = FILE_EXECUTORS.delete_file!;

  beforeEach(resetMocks);

  it('returns error when path is empty', async () => {
    const result = await fn({ path: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path is required');
  });

  it('returns error when path resolves outside workspace', async () => {
    mockResolveWorkspacePath.mockReturnValue(null);
    const result = await fn({ path: '../secret' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid path');
  });

  it('returns error when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await fn({ path: 'missing.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('File or folder not found');
  });

  it('deletes an empty directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockReaddir.mockResolvedValue([]);
    mockRmdir.mockResolvedValue(undefined);

    const result = await fn({ path: 'empty-dir' });
    expect(result.content).toContain('Folder deleted');
    expect(mockRmdir).toHaveBeenCalledWith(RESOLVED);
  });

  it('returns error for non-empty directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockReaddir.mockResolvedValue(['file.txt']);

    const result = await fn({ path: 'nonempty-dir' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not empty');
  });

  it('deletes a file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => false });
    mockUnlink.mockResolvedValue(undefined);

    const result = await fn({ path: 'file.txt' });
    expect(result.content).toContain('File deleted');
    expect(mockUnlink).toHaveBeenCalledWith(RESOLVED);
  });

  it('returns error when unlink throws', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStat.mockResolvedValue({ isDirectory: () => false });
    mockUnlink.mockRejectedValue(new Error('Busy'));

    const result = await fn({ path: 'file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error deleting');
  });
});

// =============================================================================
// move_file
// =============================================================================

describe('FILE_EXECUTORS.move_file', () => {
  const fn = FILE_EXECUTORS.move_file!;

  beforeEach(resetMocks);

  it('returns error when source is empty', async () => {
    const result = await fn({ source: '', destination: 'dest.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Source path is required');
  });

  it('returns error when destination is empty', async () => {
    const result = await fn({ source: 'src.txt', destination: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Destination path is required');
  });

  it('returns error when source path is invalid', async () => {
    mockResolveWorkspacePath.mockReturnValueOnce(null).mockReturnValueOnce('/workspace/dest');
    const result = await fn({ source: '../../etc', destination: 'dest.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid source path');
  });

  it('returns error when destination path is invalid', async () => {
    mockResolveWorkspacePath.mockReturnValueOnce('/workspace/src').mockReturnValueOnce(null);
    const result = await fn({ source: 'src.txt', destination: '../../etc' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid destination path');
  });

  it('returns error when source does not exist', async () => {
    const srcPath = '/workspace/src.txt';
    const destPath = '/workspace/dest.txt';
    mockResolveWorkspacePath.mockReturnValueOnce(srcPath).mockReturnValueOnce(destPath);
    mockExistsSync.mockReturnValue(false);

    const result = await fn({ source: 'src.txt', destination: 'dest.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Source not found');
  });

  it('creates destination parent directory if it does not exist', async () => {
    const srcPath = '/workspace/src.txt';
    const destPath = '/workspace/sub/dest.txt';
    mockResolveWorkspacePath.mockReturnValueOnce(srcPath).mockReturnValueOnce(destPath);
    // Source exists, dest dir does not
    mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    const result = await fn({ source: 'src.txt', destination: 'sub/dest.txt' });
    expect(result.content).toContain('Moved');
    expect(mockMkdir).toHaveBeenCalled();
  });

  it('moves file successfully when dest dir exists', async () => {
    const srcPath = '/workspace/src.txt';
    const destPath = '/workspace/dest.txt';
    mockResolveWorkspacePath.mockReturnValueOnce(srcPath).mockReturnValueOnce(destPath);
    mockExistsSync.mockReturnValue(true);
    mockRename.mockResolvedValue(undefined);

    const result = await fn({ source: 'src.txt', destination: 'dest.txt' });
    expect(result.content).toContain('Moved');
    expect(result.content).toContain('src.txt');
    expect(result.content).toContain('dest.txt');
    expect(mockRename).toHaveBeenCalledWith(srcPath, destPath);
  });

  it('returns error when rename throws', async () => {
    const srcPath = '/workspace/src.txt';
    const destPath = '/workspace/dest.txt';
    mockResolveWorkspacePath.mockReturnValueOnce(srcPath).mockReturnValueOnce(destPath);
    mockExistsSync.mockReturnValue(true);
    mockRename.mockRejectedValue(new Error('Cross-device'));

    const result = await fn({ source: 'src.txt', destination: 'dest.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error moving');
    expect(result.content).toContain('Cross-device');
  });

  it('returns error when source is not provided', async () => {
    const result = await fn({ destination: 'dest.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Source path is required');
  });

  it('returns error when destination is not provided', async () => {
    const result = await fn({ source: 'src.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Destination path is required');
  });
});
