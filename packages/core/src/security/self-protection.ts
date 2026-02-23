/**
 * Self-Protection Module
 *
 * Prevents agent tools from reading, writing, or deleting OwnPilot's own
 * source files. This is a critical security boundary — even fully autonomous
 * agents must NEVER modify the platform that runs them.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

/** Cached root directory (null = not yet resolved, undefined = not found) */
let cachedRoot: string | undefined | null = null;

/**
 * Walk up from a starting directory to find the monorepo root.
 * Looks for package.json with name "ownpilot-monorepo".
 */
export function getOwnPilotRoot(): string | null {
  if (cachedRoot !== null) {
    return cachedRoot ?? null;
  }

  let dir = path.dirname(new URL(import.meta.url).pathname);

  // On Windows, URL pathname starts with /C:/... — strip leading /
  if (process.platform === 'win32' && dir.startsWith('/')) {
    dir = dir.slice(1);
  }

  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name === 'ownpilot-monorepo') {
        cachedRoot = path.resolve(dir);
        return cachedRoot;
      }
    } catch {
      // package.json doesn't exist or isn't valid JSON — continue
    }
    dir = path.dirname(dir);
  }

  cachedRoot = undefined;
  return null;
}

/**
 * Check if a target path falls within OwnPilot's own directory tree.
 * Resolves the path to absolute before comparison.
 * Also blocks: node_modules and .git within the OwnPilot root.
 */
export function isOwnPilotPath(targetPath: string): boolean {
  const ownRoot = getOwnPilotRoot();
  if (!ownRoot) return false;

  const resolved = path.resolve(targetPath);
  const normalizedRoot = path.resolve(ownRoot);

  // Exact match or subdirectory
  return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

/**
 * Throw if the path is within OwnPilot's directory tree.
 */
export function assertNotOwnPilotPath(targetPath: string): void {
  if (isOwnPilotPath(targetPath)) {
    throw new Error('Access to OwnPilot system files is not allowed');
  }
}

/**
 * Reset the cached root (for testing only).
 */
export function _resetCache(): void {
  cachedRoot = null;
}
