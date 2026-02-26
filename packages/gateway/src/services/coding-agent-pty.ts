/**
 * PTY Adapter for Coding Agent Service
 *
 * Provides terminal emulation for CLI coding agents.
 * Two modes:
 *   - runWithPty(): Blocking — collects output, strips ANSI, returns on exit (legacy)
 *   - spawnStreamingPty(): Streaming — returns handle, sends raw ANSI via callbacks (for xterm.js)
 *
 * Requires node-pty as an optional dependency — lazy-loaded at runtime.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { tryImport } from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('CodingAgentPty');

const IS_WINDOWS = process.platform === 'win32';

/**
 * On Windows, node-pty cannot directly spawn .cmd/.bat files (npm global binaries).
 * We resolve this by using cmd.exe /c as the shell.
 */
function resolveCommand(command: string, args: string[]): { file: string; args: string[] } {
  if (!IS_WINDOWS) return { file: command, args };
  // Use cmd.exe /c to handle .cmd scripts and PATH resolution
  return { file: 'cmd.exe', args: ['/c', command, ...args] };
}

// ANSI escape code regex (compatible with strip-ansi)
// eslint-disable-next-line no-control-regex
const ANSI_REGEX =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const MAX_OUTPUT_SIZE = 1_048_576; // 1 MB

interface PtyResult {
  output: string;
  exitCode: number;
}

export interface PtyOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  cols?: number;
  rows?: number;
}

// node-pty types (minimal, to avoid hard dependency)
interface IPty {
  onData: (callback: (data: string) => void) => { dispose: () => void };
  onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  pid: number;
}

interface IPtyModule {
  spawn: (
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ) => IPty;
}

/**
 * Strip ANSI escape codes from text.
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Run a CLI command inside a PTY (pseudo-terminal).
 *
 * Requires node-pty to be installed as an optional dependency.
 * Falls back with a clear error if not available.
 */
export async function runWithPty(
  command: string,
  args: string[],
  options: PtyOptions = {}
): Promise<PtyResult> {
  // Lazy-load node-pty
  let ptyModule: IPtyModule;
  try {
    ptyModule = (await tryImport('node-pty')) as IPtyModule;
  } catch {
    throw new Error(
      'node-pty is not installed. Install it with: pnpm add node-pty\n' +
        'Note: node-pty requires native compilation tools (C++ compiler, Python).'
    );
  }

  const { cwd, env, timeout = 300_000, cols = 120, rows = 40 } = options;

  return new Promise<PtyResult>((resolve, reject) => {
    let output = '';
    let killed = false;
    let exitCode = -1;

    const resolved = resolveCommand(command, args);
    log.debug(`Spawning PTY: ${resolved.file} ${resolved.args.join(' ')}`, { cwd, cols, rows });

    let proc: IPty;
    try {
      proc = ptyModule.spawn(resolved.file, resolved.args, {
        name: 'xterm-color',
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err) {
      // EBADF on macOS or other spawn errors
      reject(new Error(`Failed to spawn PTY process: ${err}`));
      return;
    }

    // Timeout handler
    const timer = setTimeout(() => {
      killed = true;
      try {
        proc.kill('SIGTERM');
        // Force kill after 5s
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
        }, 5000);
      } catch {
        // Process may already be dead
      }
    }, timeout);

    // Collect output
    const dataDisposable = proc.onData((data: string) => {
      const clean = stripAnsi(data);
      if (output.length < MAX_OUTPUT_SIZE) {
        output += clean;
      }
    });

    // Handle exit
    const exitDisposable = proc.onExit((e: { exitCode: number; signal?: number }) => {
      clearTimeout(timer);
      dataDisposable.dispose();
      exitDisposable.dispose();
      exitCode = e.exitCode;

      if (killed) {
        reject(new Error(`PTY process timed out after ${timeout}ms`));
      } else {
        resolve({ output: output.trim(), exitCode });
      }
    });
  });
}

// =============================================================================
// STREAMING PTY (for xterm.js real-time output)
// =============================================================================

/** Callbacks for streaming PTY output */
export interface PtyStreamCallbacks {
  /** Raw PTY data (includes ANSI — xterm.js renders it) */
  onData: (data: string) => void;
  /** Process exited */
  onExit: (exitCode: number, signal?: number) => void;
  /** Error occurred (timeout, spawn failure) */
  onError: (error: string) => void;
}

/** Handle for controlling a spawned streaming PTY process */
export interface PtyHandle {
  /** Process ID */
  pid: number;
  /** Write data to PTY stdin */
  write: (data: string) => void;
  /** Resize the terminal */
  resize: (cols: number, rows: number) => void;
  /** Kill the process */
  kill: (signal?: string) => void;
  /** Cleanup disposables and timers */
  dispose: () => void;
}

/**
 * Spawn a PTY process for streaming mode.
 *
 * Unlike runWithPty(), this function:
 * - Does NOT strip ANSI (xterm.js needs raw escape codes)
 * - Does NOT wait for exit (returns immediately with a handle)
 * - Calls onData() incrementally as output arrives
 */
export async function spawnStreamingPty(
  command: string,
  args: string[],
  options: PtyOptions,
  callbacks: PtyStreamCallbacks
): Promise<PtyHandle> {
  // Lazy-load node-pty
  let ptyModule: IPtyModule;
  try {
    ptyModule = (await tryImport('node-pty')) as IPtyModule;
  } catch {
    throw new Error(
      'node-pty is not installed. Install it with: pnpm add node-pty\n' +
        'Note: node-pty requires native compilation tools (C++ compiler, Python).'
    );
  }

  const { cwd, env, timeout = 1_800_000, cols = 120, rows = 40 } = options;

  const resolved = resolveCommand(command, args);
  log.debug(`Spawning streaming PTY: ${resolved.file} ${resolved.args.join(' ')}`, {
    cwd,
    cols,
    rows,
  });

  let proc: IPty;
  try {
    proc = ptyModule.spawn(resolved.file, resolved.args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err) {
    throw new Error(`Failed to spawn PTY process: ${err}`);
  }

  let killed = false;

  // Timeout handler
  const timer = setTimeout(() => {
    killed = true;
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
      }, 5000);
    } catch {
      // Process may already be dead
    }
    callbacks.onError(`Process timed out after ${timeout}ms`);
  }, timeout);

  // Stream raw data (no ANSI stripping — xterm.js needs it)
  const dataDisposable = proc.onData((data: string) => {
    callbacks.onData(data);
  });

  // Handle exit
  const exitDisposable = proc.onExit((e: { exitCode: number; signal?: number }) => {
    clearTimeout(timer);
    if (!killed) {
      callbacks.onExit(e.exitCode, e.signal);
    }
  });

  return {
    pid: proc.pid,
    write: (data: string) => proc.write(data),
    resize: (c: number, r: number) => proc.resize(c, r),
    kill: (signal?: string) => {
      killed = true;
      clearTimeout(timer);
      try {
        proc.kill(signal);
      } catch {
        // Process may already be dead
      }
    },
    dispose: () => {
      clearTimeout(timer);
      dataDisposable.dispose();
      exitDisposable.dispose();
    },
  };
}

// =============================================================================
// STREAMING SPAWN (for auto mode — no node-pty dependency)
// =============================================================================

/**
 * Spawn a process for streaming auto mode.
 *
 * Uses child_process.spawn with piped stdio (NOT a PTY). This means:
 * - No node-pty dependency required
 * - No terminal emulation (no colors unless the CLI forces them)
 * - stdin is available for write() but auto-mode CLIs shouldn't need it
 * - resize() is a no-op (no terminal dimensions)
 *
 * Returns the same PtyHandle interface for compatibility with the session manager.
 */
export function spawnStreamingProcess(
  command: string,
  args: string[],
  options: PtyOptions,
  callbacks: PtyStreamCallbacks
): PtyHandle {
  const { cwd, env, timeout = 1_800_000 } = options;

  const resolved = resolveCommand(command, args);
  log.info(`Spawning auto-mode process: ${resolved.file} ${resolved.args.join(' ')}`, { cwd });

  let proc: ChildProcess;
  try {
    proc = nodeSpawn(resolved.file, resolved.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    throw new Error(`Failed to spawn process: ${err}`);
  }

  let killed = false;

  // Register error handler FIRST — before any PID check or throw.
  // If spawn fails asynchronously (ENOENT, bad cwd), the error event fires
  // on the next tick. Without an early handler, it becomes an uncaught exception
  // that crashes the entire server.
  proc.on('error', (err) => {
    if (!killed) {
      callbacks.onError(err.message);
    }
  });

  if (!proc.pid) {
    // Spawn failed synchronously (no PID assigned). The async 'error' event
    // is already handled above, so it won't crash the server. We still throw
    // to let the caller know session creation failed.
    throw new Error(`Failed to spawn process: no PID (command=${command})`);
  }

  // Close stdin immediately — auto-mode CLIs read prompts from args, not stdin.
  // Without this, some CLIs (e.g. Claude Code) block waiting for stdin EOF
  // before processing the -p prompt, causing zero output.
  try {
    proc.stdin?.end();
  } catch {
    /* stdin may already be closed */
  }

  const pid = proc.pid;

  // Timeout handler
  const timer = setTimeout(() => {
    killed = true;
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000);
    callbacks.onError(`Process timed out after ${timeout}ms`);
  }, timeout);

  // Stream stdout
  proc.stdout?.on('data', (chunk: Buffer) => {
    callbacks.onData(chunk.toString());
  });

  // Stream stderr (merge into same output stream)
  proc.stderr?.on('data', (chunk: Buffer) => {
    callbacks.onData(chunk.toString());
  });

  // Handle exit
  proc.on('close', (code, signal) => {
    clearTimeout(timer);
    if (!killed) {
      callbacks.onExit(code ?? 1, signal ? undefined : undefined);
    }
  });

  return {
    pid,
    write: (data: string) => {
      try {
        proc.stdin?.write(data);
      } catch {
        // stdin may be closed
      }
    },
    resize: () => {
      // No-op: spawn mode has no terminal dimensions
    },
    kill: (signal?: string) => {
      killed = true;
      clearTimeout(timer);
      try {
        proc.kill((signal as NodeJS.Signals) ?? 'SIGTERM');
      } catch {
        // Process may already be dead
      }
    },
    dispose: () => {
      clearTimeout(timer);
    },
  };
}
