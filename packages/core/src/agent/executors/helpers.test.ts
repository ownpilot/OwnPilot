/**
 * Tests for executor helper functions
 *
 * Covers: getWorkspacePath, resolveWorkspacePath, WORKSPACE_DIR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { getWorkspacePath, resolveWorkspacePath, WORKSPACE_DIR } from './helpers.js';
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
    const result = resolveWorkspacePath('../../etc/passwd');
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
