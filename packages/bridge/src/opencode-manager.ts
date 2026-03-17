/**
 * OpenCode Process Manager
 *
 * Manages OpenCode CLI sessions via `opencode run --format json`.
 * Each conversation maintains a pending promise chain to serialize messages.
 * Session continuity is achieved via --session <ses_xxx> flag after first spawn.
 *
 * Key differences from ClaudeManager:
 *   - Message is a CLI argument (not stdin NDJSON)
 *   - Session ID format: "ses_xxx" (returned in first event's sessionID field)
 *   - No --print, --verbose, --output-format flags
 *   - Model format: "provider/model" (e.g. "anthropic/claude-sonnet-4-6")
 *   - Completion signal: process exit(0) (not a `result` event)
 */

import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { parseOpenCodeStream } from './opencode-stream-parser.ts';
import { logger } from './utils/logger.ts';
import type { StreamChunk } from './types.ts';
import { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenCodeSessionInfo {
  conversationId: string;
  /** "ses_xxx" — null until first spawn completes with sessionID */
  openCodeSessionId: string | null;
  projectDir: string;
  lastActivity: Date;
  messagesSent: number;
}

export interface OpenCodeManagerOptions {
  opencodePath: string;
  defaultModel: string;
  /** Injectable spawn function for testing */
  spawnFn?: (cmd: string, args: string[], opts: SpawnOptionsWithoutStdio) => ChildProcess;
}

// ---------------------------------------------------------------------------
// Internal session record
// ---------------------------------------------------------------------------

interface Session {
  info: OpenCodeSessionInfo;
  /** Serializes concurrent sends on the same conversationId */
  pendingChain: Promise<void>;
  activeProcess: ChildProcess | null;
}

// ---------------------------------------------------------------------------
// OpenCodeManager
// ---------------------------------------------------------------------------

export class OpenCodeManager {
  private readonly sessions = new Map<string, Session>();
  private readonly opencodePath: string;
  private readonly defaultModel: string;

  /** Exposed for test type-checking — do not call directly in production */
  _spawnFn: (cmd: string, args: string[], opts: SpawnOptionsWithoutStdio) => ChildProcess;

  constructor(options: OpenCodeManagerOptions) {
    this.opencodePath = options.opencodePath;
    this.defaultModel = options.defaultModel;
    this._spawnFn = options.spawnFn ?? spawn;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a message to OpenCode. Returns an async generator of StreamChunk.
   * Messages on the same conversationId are automatically serialized.
   */
  async *send(
    conversationId: string,
    message: string,
    projectDir: string,
    model?: string,
    timeoutMs: number = 1_800_000,
  ): AsyncGenerator<StreamChunk> {
    // Get or create session
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = {
        info: {
          conversationId,
          openCodeSessionId: null,
          projectDir,
          lastActivity: new Date(),
          messagesSent: 0,
        },
        pendingChain: Promise.resolve(),
        activeProcess: null,
      };
      this.sessions.set(conversationId, session);
    }

    // Collect chunks outside the chain for yielding
    const chunks: StreamChunk[] = [];
    let chainError: unknown = null;

    // Serialize via promise chain
    const prevChain = session.pendingChain;
    let resolveChain!: () => void;
    session.pendingChain = new Promise<void>((res) => {
      resolveChain = res;
    });

    // Wait for previous message to finish
    await prevChain;

    // Build spawn args
    const args = this.buildArgs(message, session.info.openCodeSessionId, projectDir, model ?? this.defaultModel);

    // Build env: inherit + NO_COLOR + CI + delete OPENCODE
    const env: Record<string, string | undefined> = { ...process.env };
    env['NO_COLOR'] = '1';
    env['CI'] = 'true';
    delete env['OPENCODE'];

    // Spawn
    const controller = { aborted: false, timer: null as ReturnType<typeof setTimeout> | null };
    const proc = this._spawnFn(this.opencodePath, args, {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    session.activeProcess = proc;
    session.info.messagesSent++;
    session.info.lastActivity = new Date();

    let exitCode: number | null = null;
    let sessionIdCaptured = false;

    // Register close listener BEFORE reading stream to avoid race condition
    // (process may exit before we finish reading stdout)
    const exitPromise = new Promise<number>((resolve) => {
      proc.on('close', (code: number | null) => {
        resolve(code ?? 0);
      });
    });

    const timeoutTimer = setTimeout(() => {
      controller.aborted = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    try {
      // Collect chunks from stream
      for await (const ev of parseOpenCodeStream(proc.stdout as Readable)) {
        if (ev.kind === 'session_id' && !sessionIdCaptured) {
          sessionIdCaptured = true;
          session.info.openCodeSessionId = ev.sessionId;
        } else if (ev.kind === 'text') {
          chunks.push({ type: 'text', text: ev.text });
        } else if (ev.kind === 'done') {
          break;
        }
      }

      // Wait for process to exit
      exitCode = await exitPromise;
    } catch (err) {
      chainError = err;
    } finally {
      clearTimeout(timeoutTimer);
      session.activeProcess = null;
      session.info.lastActivity = new Date();
      resolveChain();
    }

    // Yield collected text chunks
    for (const chunk of chunks) {
      yield chunk;
    }

    // Yield error or done
    if (chainError) {
      yield { type: 'error', error: String(chainError) };
    } else if (controller.aborted) {
      yield { type: 'error', error: `OpenCode timed out after ${timeoutMs}ms` };
    } else if (exitCode !== 0 && exitCode !== null) {
      yield { type: 'error', error: `OpenCode exited with code ${exitCode}` };
    } else {
      yield { type: 'done' };
    }
  }

  terminate(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session?.activeProcess) {
      session.activeProcess.kill('SIGTERM');
      session.activeProcess = null;
    }
  }

  getSessions(): OpenCodeSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }));
  }

  getSession(conversationId: string): OpenCodeSessionInfo | null {
    const session = this.sessions.get(conversationId);
    return session ? { ...session.info } : null;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private buildArgs(
    message: string,
    openCodeSessionId: string | null,
    projectDir: string,
    model: string,
  ): string[] {
    const args = ['run', message, '--format', 'json', '--dir', projectDir, '--model', model];
    if (openCodeSessionId) {
      args.push('--session', openCodeSessionId);
    }
    return args;
  }
}

// ---------------------------------------------------------------------------
// Singleton (for routes.ts usage)
// ---------------------------------------------------------------------------

import { config } from './config.ts';

export const openCodeManager = new OpenCodeManager({
  opencodePath: config.opencodePath,
  defaultModel: config.opencodeModel,
});
