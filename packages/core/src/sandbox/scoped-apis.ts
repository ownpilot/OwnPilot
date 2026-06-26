/**
 * Scoped APIs for Custom Tool Sandbox
 *
 * Provides workspace-jailed filesystem and shell access for custom tools
 * with the 'local' permission. All paths are resolved relative to the
 * workspace directory, with strict path traversal prevention.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
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
const SCOPED_SHELL_METACHARACTER_PATTERN = /(?:&&|\|\||[|;`<>]|\$\(|[\r\n])/;

/**
 * Split a command string into argv (program + arguments) without a shell.
 *
 * Whitespace separates tokens; single/double quotes group, and a backslash
 * escapes the next character (or `"`/`\` inside double quotes). Shell control
 * characters (`&`, `|`, `;`, `$`, backtick, redirects) are treated as ORDINARY
 * characters here — they become literal parts of an argument. Combined with
 * execFile (no shell, below), this makes shell injection structurally
 * impossible: even a mis-tokenized command can never spawn a second process,
 * because no shell ever interprets the result.
 */
function tokenizeCommand(command: string): string[] {
  const args: string[] = [];
  let current: string | null = null; // null = between tokens
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (
        quote === '"' &&
        ch === '\\' &&
        (command[i + 1] === '"' || command[i + 1] === '\\')
      ) {
        current = (current ?? '') + command[++i];
      } else {
        current = (current ?? '') + ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      current = current ?? '';
      quote = ch;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current = (current ?? '') + command[++i];
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current !== null) {
        args.push(current);
        current = null;
      }
      continue;
    }
    current = (current ?? '') + ch;
  }

  if (quote) {
    throw new Error('Command has unbalanced quotes.');
  }
  if (current !== null) {
    args.push(current);
  }
  return args;
}

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

      // Defense-in-depth only. The real guarantee is below: the command is
      // tokenized and run via execFile WITHOUT a shell, so metacharacters
      // (including a bare `&` in a URL) are literal argument bytes that can
      // never spawn a second process. This early reject is kept so obviously
      // shell-shaped commands fail fast with a clear message.
      // Blocked: | && || ; $(cmd) `cmd` >file >>file <file and line breaks.
      // A bare `&` is allowed (appears in URLs like curl?foo=bar&baz=qux) and is
      // safe because there is no shell to interpret it.
      if (SCOPED_SHELL_METACHARACTER_PATTERN.test(command)) {
        throw new Error(
          'Command blocked: shell metacharacters (| && || ; $( ) ` > >> < newline) are not permitted.'
        );
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

      // Split into argv and run without a shell (execFile, not exec). This is
      // the load-bearing security boundary: no shell means no command
      // substitution, chaining, redirection, or globbing — the program receives
      // exactly these arguments. Note this also means shell features (glob
      // expansion, $VAR expansion, .cmd/.bat shims on Windows) are NOT available
      // to sandboxed commands; pass the resolved program and literal args.
      const argv = tokenizeCommand(command);
      const file = argv[0];
      if (!file) {
        throw new Error('Command is empty.');
      }
      const commandArgs = argv.slice(1);

      return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
        (resolve, reject) => {
          const child = execFile(
            file,
            commandArgs,
            {
              cwd: workspaceDir,
              timeout: execTimeout,
              maxBuffer: MAX_OUTPUT_SIZE,
              env: safeEnv,
            },
            (error, stdout, stderr) => {
              if (error && !error.killed) {
                // Execution error but not timeout-killed. execFile's error.code
                // is `string | number` (it can carry a signal name), so coerce
                // a non-numeric code to a generic failure exit of 1.
                resolve({
                  stdout: stdout?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  stderr: stderr?.slice(0, MAX_OUTPUT_SIZE) ?? '',
                  exitCode: typeof error.code === 'number' ? error.code : 1,
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
