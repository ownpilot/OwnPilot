/**
 * Tests for executor helper functions
 *
 * Covers: getWorkspacePath, resolveWorkspacePath, WORKSPACE_DIR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockLstatSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  lstatSync: mockLstatSync,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getWorkspacePath,
  resolveWorkspacePath,
  rejectWorkspaceSymlink,
  WORKSPACE_DIR,
} from './helpers.js';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WORKSPACE_DIR', () => {
  it('equals "workspace"', () => {
    expect(WORKSPACE_DIR).toBe('workspace');
  });
});

describe('getWorkspacePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the workspace path under process.cwd()', () => {
    mockExistsSync.mockReturnValue(true);
    const result = getWorkspacePath();
    expect(result).toBe(path.join(process.cwd(), 'workspace'));
  });

  it('creates workspace directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = getWorkspacePath();
    expect(mockMkdirSync).toHaveBeenCalledWith(path.join(process.cwd(), 'workspace'), {
      recursive: true,
    });
    expect(result).toBe(path.join(process.cwd(), 'workspace'));
  });

  it('does not create directory when it already exists', () => {
    mockExistsSync.mockReturnValue(true);
    getWorkspacePath();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe('resolveWorkspacePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // workspace directory always "exists" for these tests
    mockExistsSync.mockReturnValue(true);
  });

  it('resolves a simple filename within workspace', () => {
    const result = resolveWorkspacePath('test.txt');
    expect(result).toBe(path.join(process.cwd(), 'workspace', 'test.txt'));
  });

  it('resolves a nested path within workspace', () => {
    const result = resolveWorkspacePath('sub/dir/file.md');
    expect(result).toBe(path.join(process.cwd(), 'workspace', 'sub', 'dir', 'file.md'));
  });

  it('resolves empty string to workspace root', () => {
    const result = resolveWorkspacePath('');
    expect(result).toBe(path.join(process.cwd(), 'workspace'));
  });

  it('returns null for directory traversal with ../', () => {
    const result = resolveWorkspacePath('../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('returns null for absolute path that escapes workspace', () => {
    // An absolute path resolves outside workspace
    const result = resolveWorkspacePath('/etc/passwd');
    // On Windows this resolves relative to same drive, but may still be outside workspace
    // The important thing is the traversal check catches it
    if (process.platform === 'win32') {
      // On Windows, /etc/passwd resolves to e.g. D:\etc\passwd which is outside workspace
      expect(result).toBeNull();
    } else {
      expect(result).toBeNull();
    }
  });

  it('returns null when path resolves to parent of workspace', () => {
    const result = resolveWorkspacePath('..');
    expect(result).toBeNull();
  });

  it('allows . (current directory = workspace itself)', () => {
    const result = resolveWorkspacePath('.');
    // path.resolve(workspace, '.') === workspace
    expect(result).toBe(path.join(process.cwd(), 'workspace'));
  });

  it('returns null for tricky traversal with encoded dots', () => {
    // ../.. via intermediate dirs
    const result = resolveWorkspacePath('subdir/../../..');
    expect(result).toBeNull();
  });

  it('allows deeply nested paths', () => {
    const result = resolveWorkspacePath('a/b/c/d/e/f.txt');
    expect(result).toBe(path.join(process.cwd(), 'workspace', 'a', 'b', 'c', 'd', 'e', 'f.txt'));
  });

  it('handles path with trailing slash', () => {
    const result = resolveWorkspacePath('mydir/');
    expect(result).not.toBeNull();
    // Should resolve within workspace
    expect(result!.startsWith(path.join(process.cwd(), 'workspace'))).toBe(true);
  });
});

describe('rejectWorkspaceSymlink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when path does not exist (lstat throws ENOENT)', () => {
    mockLstatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => rejectWorkspaceSymlink('/some/path')).not.toThrow();
  });

  it('does nothing when path is a regular file (not a symlink)', () => {
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });

    expect(() => rejectWorkspaceSymlink('/some/file.txt')).not.toThrow();
  });

  it('throws when path is a symlink', () => {
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });

    expect(() => rejectWorkspaceSymlink('/some/link')).toThrow(
      'Symlinks are not permitted in workspace paths'
    );
  });

  it('does nothing when lstat throws non-symlink error (e.g., EACCES)', () => {
    const error = new Error('EACCES: permission denied');
    mockLstatSync.mockImplementation(() => {
      throw error;
    });

    expect(() => rejectWorkspaceSymlink('/restricted')).not.toThrow();
  });

  it('catches lstat errors that happen to have the symlink message prefix and re-throws', () => {
    // Edge case: lstatSync itself throws an error whose message coincidentally
    // starts with "Symlinks are not permitted" — the catch block will re-throw
    // it rather than silently swallowing because the message matches the
    // known prefix (defense in depth).
    mockLstatSync.mockImplementation(() => {
      const err = new Error('Symlinks are not permitted: some lstat failure');
      throw err;
    });

    expect(() => rejectWorkspaceSymlink('/edge')).toThrow('Symlinks are not permitted');
  });
});
