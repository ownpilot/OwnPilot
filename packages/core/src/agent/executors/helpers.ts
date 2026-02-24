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
