/**
 * Shared helpers for core tool executors
 *
 * Workspace path utilities used by file-based executors.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Workspace directory for file operations (relative to process.cwd())
export const WORKSPACE_DIR = 'workspace';

/**
 * Get the workspace directory path, creating it if it doesn't exist
 */
export function getWorkspacePath(): string {
  const workspacePath = path.join(process.cwd(), WORKSPACE_DIR);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
  return workspacePath;
}

/**
 * Resolve and validate a path within the workspace
 * Prevents directory traversal attacks
 */
export function resolveWorkspacePath(relativePath: string): string | null {
  const workspacePath = getWorkspacePath();
  const resolvedPath = path.resolve(workspacePath, relativePath);

  // Ensure the resolved path is within the workspace (trailing sep prevents prefix collision)
  if (resolvedPath !== workspacePath && !resolvedPath.startsWith(workspacePath + path.sep)) {
    return null;
  }

  return resolvedPath;
}

/**
 * Defense-in-depth: refuse to read or write through a symlink in a
 * workspace path. The `startsWith` containment check defends against
 * `..` traversal, but a symlink placed inside the workspace (e.g. by
 * an agent via `execute_command` / `ln -s`) can satisfy that check
 * while resolving to an arbitrary host file. `lstat` detects the
 * symlink without following it; we refuse outright rather than try
 * to resolve and re-check, because workspace data is expected to be
 * regular files only.
 *
 * Throws on symlink detection; no-ops when the path doesn't exist
 * or when lstat fails (e.g. file removed in a race) — the caller's
 * subsequent fs operation will surface any genuine error.
 */
export function rejectWorkspaceSymlink(fullPath: string): void {
  try {
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      throw new Error('Symlinks are not permitted in workspace paths');
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Symlinks are not permitted')) throw err;
    // lstat failure (ENOENT race, EACCES) — let the caller's fs op
    // surface the underlying error.
  }
}
