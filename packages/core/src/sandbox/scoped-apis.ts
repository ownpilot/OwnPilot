/**
 * Scoped APIs for Custom Tool Sandbox
 *
 * Provides workspace-jailed filesystem and shell access for custom tools
 * with the 'local' permission. All paths are resolved relative to the
 * workspace directory, with strict path traversal prevention.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { isCommandBlocked } from '../security/index.js';

// =============================================================================
// Types
// =============================================================================

export interface ScopedFs {
  readFile: (filePath: string, encoding?: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  readdir: (dirPath?: string) => Promise<string[]>;
  stat: (
    filePath: string
  ) => Promise<{ size: number; isFile: boolean; isDirectory: boolean; modified: string }>;
  mkdir: (dirPath: string, recursive?: boolean) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
  exists: (filePath: string) => Promise<boolean>;
}

export interface ScopedExec {
  exec: (
    command: string,
    timeout?: number
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}

// =============================================================================
// Path Security
// =============================================================================

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB for sandbox outputs

/**
 * Resolve the real path of `target`, following symlinks. `fs.realpath` only
 * resolves paths that exist, so for a not-yet-existing target (writeFile/mkdir)
 * we resolve the nearest existing ancestor and re-attach the missing remainder.
 * This ensures a symlinked PARENT cannot be used to escape the workspace.
 */
async function realpathAllowingMissing(target: string): Promise<string> {
  let current = target;
  const trailing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return trailing.length ? path.join(real, ...trailing) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.normalize(target);
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve a path within the workspace, preventing traversal attacks.
 * Throws if the resolved path escapes the workspace directory.
 *
 * The lexical resolve below blocks `../` traversal, but `path.resolve` does NOT
 * follow symlinks — a symlinked entry inside the workspace (e.g. pnpm's
 * node_modules links, or a checked-out repo) could otherwise be used to read or
 * write outside the jail. We therefore resolve symlinks on both the target and
 * the workspace before the containment check, and operate on the real path.
 */
async function resolveSafePath(workspaceDir: string, userPath: string): Promise<string> {
  // Normalize backslashes to forward slashes before resolution so that
  // Windows-style traversal (e.g. "..\\..\\secret") is caught on all platforms.
  const sanitized = userPath.replace(/\\/g, '/');
  const resolved = path.resolve(workspaceDir, sanitized);
  const normalizedWorkspace = path.resolve(workspaceDir);

  // Reject lexical escapes early (cheap, and covers the common case).
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    throw new Error(`Path traversal blocked: '${userPath}' resolves outside workspace.`);
  }

  // Then resolve symlinks and re-check, so a symlinked entry inside the
  // workspace cannot redirect the real target outside it.
  const realTarget = await realpathAllowingMissing(resolved);
  const realWorkspace = await realpathAllowingMissing(normalizedWorkspace);
  if (!realTarget.startsWith(realWorkspace + path.sep) && realTarget !== realWorkspace) {
    throw new Error(`Path traversal blocked: '${userPath}' resolves outside workspace.`);
  }

  return realTarget;
}

// =============================================================================
// Scoped Filesystem
// =============================================================================

/**
 * Create a workspace-jailed filesystem API.
 * All paths are resolved relative to workspaceDir.
 * Path traversal (../../) is blocked.
 */
export function createScopedFs(workspaceDir: string): ScopedFs {
  return {
    async readFile(filePath: string, encoding?: string): Promise<string> {
      const safePath = await resolveSafePath(workspaceDir, filePath);
      return fs.readFile(safePath, { encoding: (encoding || 'utf-8') as BufferEncoding });
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const safePath = await resolveSafePath(workspaceDir, filePath);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, 'utf-8');
    },

    async readdir(dirPath?: string): Promise<string[]> {
      const safePath = dirPath ? await resolveSafePath(workspaceDir, dirPath) : workspaceDir;
      const entries = await fs.readdir(safePath);
      return entries;
    },

    async stat(filePath: string) {
      const safePath = await resolveSafePath(workspaceDir, filePath);
      const stats = await fs.stat(safePath);
      return {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        modified: stats.mtime.toISOString(),
      };
    },

    async mkdir(dirPath: string, recursive?: boolean): Promise<void> {
      const safePath = await resolveSafePath(workspaceDir, dirPath);
      await fs.mkdir(safePath, { recursive: recursive ?? true });
    },

    async unlink(filePath: string): Promise<void> {
      const safePath = await resolveSafePath(workspaceDir, filePath);
      await fs.unlink(safePath);
    },

    async exists(filePath: string): Promise<boolean> {
      try {
        const safePath = await resolveSafePath(workspaceDir, filePath);
        await fs.access(safePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// =============================================================================
// Scoped Shell Execution
// =============================================================================

/**
 * Create a workspace-scoped shell execution API.
 * Commands run with cwd=workspaceDir.
 * Dangerous commands are blocked via isCommandBlocked().
 */
export function createScopedExec(workspaceDir: string): ScopedExec {
  return {
    async exec(command: string, timeout?: number) {
      // Security: block dangerous commands (blocklist — critical patterns)
      if (isCommandBlocked(command)) {
        throw new Error('Command blocked for security reasons.');
      }

      // Security: block shell metacharacter injection as a defense-in-depth layer.
      // These are also covered by isCommandBlocked() via CRITICAL_PATTERNS, but
      // an explicit check here ensures the intent is clear and the block survives
      // any future refactoring of isCommandBlocked().
      // Blocked: | $(cmd) >file >>file <file
      // Note: && and ; are excluded from CRITICAL_PATTERNS (not catastrophic alone;
      //       scoped-apis keeps its own defense-in-depth layer).
      // Note: & alone is allowed (appears in URLs like curl?foo=bar&baz=qux).
      if (/\||\$\(|>{1,2}(?:\s|$)|<(?:\s|$)/.test(command)) {
        throw new Error('Command blocked: shell metacharacters (| $( ) > >> <) are not permitted.');
      }

      const execTimeout = timeout ?? 30000;

      // Security: only pass safe env vars to sandboxed commands (no API keys/secrets)
      const safeEnv: Record<string, string> = {};
      const SAFE_ENV_KEYS = [
        'PATH',
        'HOME',
        'USER',
        'LANG',
        'TERM',
        'NODE_ENV',
        'TZ',
        'SHELL',
        'TEMP',
        'TMP',
        'TMPDIR',
        'USERPROFILE',
        'APPDATA',
        'LOCALAPPDATA',
        'SystemRoot',
        'SYSTEMROOT',
        'windir',
        'WINDIR',
        'ComSpec',
        'COMSPEC',
        'ProgramFiles',
        'ProgramFiles(x86)',
        'CommonProgramFiles',
        'NUMBER_OF_PROCESSORS',
        'PROCESSOR_ARCHITECTURE',
        'OS',
      ];
      for (const key of SAFE_ENV_KEYS) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }

      return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
        (resolve, reject) => {
          const child = exec(
            command,
            {
              cwd: workspaceDir,
              timeout: execTimeout,
              maxBuffer: MAX_OUTPUT_SIZE,
              env: safeEnv,
            },
            (error, stdout, stderr) => {
              if (error && !error.killed) {
                // Execution error but not timeout-killed
                resolve({
                  stdout: stdout?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  stderr: stderr?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  exitCode: error.code ?? 1,
                });
              } else if (error?.killed) {
                reject(new Error(`Command timed out after ${execTimeout}ms`));
              } else {
                resolve({
                  stdout: stdout?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  stderr: stderr?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  exitCode: 0,
                });
              }
            }
          );

          // Close stdin
          child.stdin?.end();
        }
      );
    },
  };
}
