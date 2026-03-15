/**
 * Coding Agent Session Manager
 *
 * Manages up to 3 concurrent sessions per user. Each session runs an
 * external coding CLI (Claude Code, Codex, Gemini CLI).
 *
 * Two spawn strategies:
 *   - Auto mode: child_process.spawn (no node-pty required)
 *   - Interactive mode: node-pty PTY (requires node-pty, provides full terminal)
 *
 * Output is streamed in real-time to subscribed WebSocket clients via
 * the gateway's SessionManager.
 */

import { randomUUID } from 'node:crypto';
import type {
  CodingAgentSession,
  CodingAgentSessionState,
  CreateCodingSessionInput,
} from '@ownpilot/core';
import { isBuiltinProvider } from '@ownpilot/core';
import type { PtyHandle } from './coding-agent-pty.js';
import { spawnStreamingPty, spawnStreamingProcess, type PtyOptions } from './coding-agent-pty.js';
import { sessionManager as wsSessionManager } from '../ws/session.js';
import { codingAgentResultsRepo } from '../db/repositories/coding-agent-results.js';
import { getLog } from './log.js';

const log = getLog('CodingAgentSessions');

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_SESSIONS_PER_USER = 3;
const SESSION_TIMEOUT_MS = 1_800_000; // 30 min default
const CLEANUP_INTERVAL_MS = 60_000; // 1 min
const OUTPUT_BUFFER_MAX = 102_400; // 100 KB ring buffer for reconnection

// =============================================================================
// TYPES
// =============================================================================

interface ManagedSession {
  session: CodingAgentSession;
  pty: PtyHandle | null;
  /** ACP client instance (if using ACP mode) */
  acpClient: import('../acp/acp-client.js').AcpClient | null;
  /** Ring buffer of recent output (last ~100KB) for reconnection replay */
  outputBuffer: string;
  /** WS session IDs subscribed to this coding agent session's output */
  subscribers: Set<string>;
  /** Callbacks fired when the session completes (exit or error) */
  completionCallbacks: Array<(session: CodingAgentSession) => void>;
  /** Structured tool calls from ACP (empty for non-ACP sessions) */
  acpToolCalls: import('../acp/types.js').AcpToolCall[];
  /** Current plan from ACP (null for non-ACP sessions) */
  acpPlan: import('../acp/types.js').AcpPlan | null;
}

// =============================================================================
// SESSION MANAGER
// =============================================================================

export class CodingAgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private userSessions = new Map<string, Set<string>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  async createSession(
    input: CreateCodingSessionInput,
    userId: string,
    env: Record<string, string>,
    binary: string,
    cliArgs: string[]
  ): Promise<CodingAgentSession> {
    // Enforce max sessions per user
    const userSet = this.userSessions.get(userId) ?? new Set<string>();
    const activeCount = this.countActiveSessions(userSet);
    if (activeCount >= MAX_SESSIONS_PER_USER) {
      throw new Error(
        `Maximum ${MAX_SESSIONS_PER_USER} concurrent sessions allowed. Terminate an existing session first.`
      );
    }

    const sessionId = randomUUID();
    const cwd = input.cwd ?? process.cwd();
    const mode = input.mode ?? 'auto';

    const session: CodingAgentSession = {
      id: sessionId,
      provider: input.provider,
      displayName: this.buildDisplayName(input.provider, input.prompt),
      state: 'starting',
      mode,
      cwd,
      prompt: input.prompt,
      model: input.model,
      startedAt: new Date().toISOString(),
      userId,
      source: input.source,
    };

    const managed: ManagedSession = {
      session,
      pty: null,
      acpClient: null,
      outputBuffer: '',
      subscribers: new Set(),
      completionCallbacks: [],
      acpToolCalls: [],
      acpPlan: null,
    };

    this.sessions.set(sessionId, managed);
    userSet.add(sessionId);
    this.userSessions.set(userId, userSet);

    // Spawn process
    try {
      const spawnOptions: PtyOptions = {
        cwd,
        env,
        timeout: input.timeout ?? SESSION_TIMEOUT_MS,
        cols: 120,
        rows: 40,
      };

      const streamCallbacks = {
        onData: (data: string) => {
          // Append to ring buffer
          managed.outputBuffer += data;
          if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX) {
            managed.outputBuffer = managed.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
          }
          // Send to all subscribed WS clients
          this.sendToSubscribers(managed, 'coding-agent:session:output', {
            sessionId,
            data,
          });
        },

        onExit: (exitCode: number, signal?: number) => {
          const newState: CodingAgentSessionState = exitCode === 0 ? 'completed' : 'failed';
          session.state = newState;
          session.exitCode = exitCode;
          session.completedAt = new Date().toISOString();

          this.sendToSubscribers(managed, 'coding-agent:session:exit', {
            sessionId,
            exitCode,
            signal,
          });
          this.sendToSubscribers(managed, 'coding-agent:session:state', {
            sessionId,
            state: newState,
          });

          managed.pty?.dispose();
          managed.pty = null;

          // Fire completion callbacks
          this.fireCompletionCallbacks(managed);

          // Persist result to DB (fire-and-forget)
          this.persistResult(managed, exitCode).catch((err) => {
            log.warn(`Failed to persist result for session ${sessionId}`, { error: String(err) });
          });

          log.info(`Coding agent session ${sessionId} exited`, {
            exitCode,
            provider: input.provider,
          });
        },

        onError: (error: string) => {
          session.state = 'failed';
          session.completedAt = new Date().toISOString();

          this.sendToSubscribers(managed, 'coding-agent:session:error', {
            sessionId,
            error,
          });

          // Fire completion callbacks on error too
          this.fireCompletionCallbacks(managed);

          // Persist failed result
          this.persistResult(managed, undefined, error).catch((err) => {
            log.warn(`Failed to persist error result for session ${sessionId}`, {
              error: String(err),
            });
          });

          log.error(`Coding agent session ${sessionId} error: ${error}`);
        },
      };

      let handle: PtyHandle;

      // Always prefer PTY for real terminal experience (colors, cursor, stdin).
      // Fall back to simple spawn only when node-pty is not available.
      try {
        handle = await spawnStreamingPty(binary, cliArgs, spawnOptions, streamCallbacks);
      } catch (ptyErr) {
        if (mode === 'interactive') {
          // Interactive mode requires PTY — no fallback
          throw ptyErr;
        }
        // Auto mode: graceful fallback to simple process spawn
        log.info(`PTY not available, falling back to process spawn for session ${sessionId}`);
        handle = spawnStreamingProcess(binary, cliArgs, spawnOptions, streamCallbacks);
      }

      managed.pty = handle;
      session.state = 'running';

      // Broadcast session creation to all WS clients (for MiniTerminal on other pages)
      wsSessionManager.broadcast(
        'coding-agent:session:created' as never,
        {
          session: {
            id: session.id,
            provider: session.provider,
            displayName: session.displayName,
            state: session.state,
            mode: session.mode,
            cwd: session.cwd,
            prompt: session.prompt,
            startedAt: session.startedAt,
            userId: session.userId,
          },
        } as never
      );

      log.info(`Coding agent session ${sessionId} started`, {
        provider: input.provider,
        mode,
        pid: handle.pid,
        cwd,
        usesPty: mode === 'interactive',
      });

      return session;
    } catch (err) {
      // Cleanup on spawn failure
      this.sessions.delete(sessionId);
      userSet.delete(sessionId);
      throw err;
    }
  }

  /**
   * Create an ACP-mode session: spawns the agent with ACP protocol
   * for structured tool call, plan, and permission tracking.
   */
  async createAcpSession(
    input: CreateCodingSessionInput,
    userId: string,
    env: Record<string, string>,
    binary: string,
    acpArgs: string[],
    mcpServers?: import('../acp/types.js').AcpMcpServerConfig[]
  ): Promise<CodingAgentSession> {
    // Enforce max sessions per user
    const userSet = this.userSessions.get(userId) ?? new Set<string>();
    const activeCount = this.countActiveSessions(userSet);
    if (activeCount >= MAX_SESSIONS_PER_USER) {
      throw new Error(
        `Maximum ${MAX_SESSIONS_PER_USER} concurrent sessions allowed. Terminate an existing session first.`
      );
    }

    const sessionId = randomUUID();
    const cwd = input.cwd ?? process.cwd();

    const session: CodingAgentSession = {
      id: sessionId,
      provider: input.provider,
      displayName: this.buildDisplayName(input.provider, input.prompt),
      state: 'starting',
      mode: 'auto',
      cwd,
      prompt: input.prompt,
      model: input.model,
      startedAt: new Date().toISOString(),
      userId,
      source: input.source,
    };

    const managed: ManagedSession = {
      session,
      pty: null,
      acpClient: null,
      outputBuffer: '',
      subscribers: new Set(),
      completionCallbacks: [],
      acpToolCalls: [],
      acpPlan: null,
    };

    this.sessions.set(sessionId, managed);
    userSet.add(sessionId);
    this.userSessions.set(userId, userSet);

    try {
      const { AcpClient } = await import('../acp/acp-client.js');

      const acpClient = new AcpClient({
        binary,
        args: acpArgs,
        cwd,
        env,
        ownerSessionId: sessionId,
        mcpServers,
        onUpdate: (eventType: string, payload: Record<string, unknown>) => {
          // Forward all ACP events to WS subscribers in real-time
          this.sendToSubscribers(managed, eventType, { sessionId, ...payload });

          // Update tracked ACP data from streaming events
          if (eventType === 'coding-agent:acp:tool-call') {
            const tc = (payload as { toolCall?: import('../acp/types.js').AcpToolCall }).toolCall;
            if (tc) managed.acpToolCalls.push(tc);
          }
          if (eventType === 'coding-agent:acp:plan') {
            const plan = (payload as { plan?: import('../acp/types.js').AcpPlan }).plan;
            if (plan) managed.acpPlan = plan;
          }
        },
        onStateChange: (state) => {
          log.debug(`ACP state change for session ${sessionId}: ${state}`);
          if (state === 'closed' || state === 'error') {
            const newState = state === 'error' ? 'failed' : 'completed';
            session.state = newState as import('@ownpilot/core').CodingAgentSessionState;
            session.completedAt = new Date().toISOString();
            this.sendToSubscribers(managed, 'coding-agent:session:state', {
              sessionId,
              state: newState,
            });
            this.fireCompletionCallbacks(managed);
            this.persistResult(managed, state === 'error' ? 1 : 0).catch((err) => {
              log.warn(`Failed to persist ACP result for session ${sessionId}`, {
                error: String(err),
              });
            });
          }
        },
        onError: (err) => {
          log.error(`ACP error for session ${sessionId}: ${err.message}`);
          session.state = 'failed';
          session.completedAt = new Date().toISOString();
          this.sendToSubscribers(managed, 'coding-agent:session:error', {
            sessionId,
            error: err.message,
          });
          this.fireCompletionCallbacks(managed);
        },
      });

      managed.acpClient = acpClient;

      // Connect (spawn + initialize)
      await acpClient.connect();
      session.state = 'running';

      // Create ACP session with MCP servers
      await acpClient.createSession({ cwd, mcpServers });

      // Broadcast session creation
      wsSessionManager.broadcast(
        'coding-agent:session:created' as never,
        {
          session: {
            id: session.id,
            provider: session.provider,
            displayName: session.displayName,
            state: session.state,
            mode: session.mode,
            cwd: session.cwd,
            prompt: session.prompt,
            startedAt: session.startedAt,
            userId: session.userId,
            acpEnabled: true,
          },
        } as never
      );

      log.info(`ACP session ${sessionId} created`, {
        provider: input.provider,
        pid: acpClient.pid,
        cwd,
        agentInfo: acpClient.currentSession?.agentInfo,
      });

      // Start the prompt turn (fire-and-forget — results stream via events)
      this.runAcpPrompt(managed, input.prompt).catch((err) => {
        log.error(`ACP prompt failed for session ${sessionId}`, { error: String(err) });
      });

      return session;
    } catch (err) {
      this.sessions.delete(sessionId);
      userSet.delete(sessionId);
      throw err;
    }
  }

  /**
   * Send a prompt to an existing ACP session.
   * Returns the prompt result when the turn completes.
   */
  async promptAcpSession(
    sessionId: string,
    userId: string,
    prompt: string
  ): Promise<{ stopReason: string; output: string }> {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!managed.acpClient) {
      throw new Error(`Session ${sessionId} is not an ACP session`);
    }

    const result = await managed.acpClient.prompt(prompt);
    // Update tracked data
    managed.acpToolCalls = result.toolCalls;
    managed.acpPlan = result.plan;
    // Append text output to buffer
    managed.outputBuffer += result.output;
    if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX) {
      managed.outputBuffer = managed.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
    }

    return { stopReason: result.stopReason, output: result.output };
  }

  /**
   * Cancel an ongoing ACP prompt turn.
   */
  async cancelAcpSession(sessionId: string, userId: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId || !managed.acpClient) return false;
    await managed.acpClient.cancel();
    return true;
  }

  /**
   * Get ACP-specific data for a session (tool calls, plan).
   */
  getAcpData(
    sessionId: string,
    userId: string
  ):
    | {
        toolCalls: import('../acp/types.js').AcpToolCall[];
        plan: import('../acp/types.js').AcpPlan | null;
        isAcp: boolean;
      }
    | undefined {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) return undefined;
    return {
      toolCalls: managed.acpToolCalls,
      plan: managed.acpPlan,
      isAcp: managed.acpClient !== null,
    };
  }

  /** Run ACP prompt and handle streaming events */
  private async runAcpPrompt(managed: ManagedSession, prompt: string): Promise<void> {
    if (!managed.acpClient) return;

    const sessionId = managed.session.id;
    try {
      managed.session.state = 'running';
      const result = await managed.acpClient.prompt(prompt);

      managed.acpToolCalls = result.toolCalls;
      managed.acpPlan = result.plan;
      managed.outputBuffer += result.output;
      if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX) {
        managed.outputBuffer = managed.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
      }

      // Send text output to legacy subscribers
      if (result.output) {
        this.sendToSubscribers(managed, 'coding-agent:session:output', {
          sessionId,
          data: result.output,
        });
      }

      // Mark completed
      managed.session.state = result.stopReason === 'cancelled' ? 'terminated' : 'completed';
      managed.session.exitCode = 0;
      managed.session.completedAt = new Date().toISOString();

      this.sendToSubscribers(managed, 'coding-agent:session:exit', {
        sessionId,
        exitCode: 0,
        stopReason: result.stopReason,
      });
      this.sendToSubscribers(managed, 'coding-agent:session:state', {
        sessionId,
        state: managed.session.state,
      });

      this.fireCompletionCallbacks(managed);
      this.persistResult(managed, 0).catch((err) => {
        log.warn(`Failed to persist ACP result for session ${sessionId}`, { error: String(err) });
      });
    } catch (err) {
      managed.session.state = 'failed';
      managed.session.completedAt = new Date().toISOString();

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.sendToSubscribers(managed, 'coding-agent:session:error', {
        sessionId,
        error: errorMsg,
      });
      this.fireCompletionCallbacks(managed);
    }
  }

  getSession(sessionId: string, userId: string): CodingAgentSession | undefined {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) return undefined;
    return managed.session;
  }

  listSessions(userId: string): CodingAgentSession[] {
    const userSet = this.userSessions.get(userId);
    if (!userSet) return [];

    const result: CodingAgentSession[] = [];
    for (const sessionId of userSet) {
      const managed = this.sessions.get(sessionId);
      if (managed) result.push(managed.session);
    }
    return result;
  }

  writeToSession(sessionId: string, userId: string, data: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      log.debug(`writeToSession: session ${sessionId} not found`);
      return false;
    }
    if (managed.session.userId !== userId) {
      log.debug(`writeToSession: userId mismatch`, {
        expected: managed.session.userId,
        got: userId,
      });
      return false;
    }
    if (!managed.pty) {
      log.debug(`writeToSession: no PTY for session ${sessionId} (state=${managed.session.state})`);
      return false;
    }
    managed.pty.write(data);
    return true;
  }

  resizeSession(sessionId: string, userId: string, cols: number, rows: number): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId || !managed.pty) return false;
    managed.pty.resize(cols, rows);
    return true;
  }

  terminateSession(sessionId: string, userId: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) return false;

    // Close ACP client if present
    if (managed.acpClient) {
      managed.acpClient.close().catch((e) => log.debug('ACP client close error', { error: String(e) }));
      managed.acpClient = null;
    }

    if (managed.pty) {
      managed.pty.kill('SIGTERM');
      managed.pty.dispose();
      managed.pty = null;
    }

    managed.session.state = 'terminated';
    managed.session.completedAt = new Date().toISOString();

    this.sendToSubscribers(managed, 'coding-agent:session:state', {
      sessionId,
      state: 'terminated' as CodingAgentSessionState,
    });

    log.info(`Coding agent session ${sessionId} terminated by user`);
    return true;
  }

  // ===========================================================================
  // WS Subscriber Management
  // ===========================================================================

  /**
   * Subscribe a WebSocket session to receive output from a coding agent session.
   * Also sends the output buffer as a replay for reconnection.
   */
  subscribe(codingSessionId: string, wsSessionId: string, userId: string): boolean {
    const managed = this.sessions.get(codingSessionId);
    if (!managed) {
      log.debug(`Subscribe failed: session ${codingSessionId} not found`);
      return false;
    }
    if (managed.session.userId !== userId) {
      log.debug(`Subscribe failed: userId mismatch for session ${codingSessionId}`, {
        expected: managed.session.userId,
        got: userId,
      });
      return false;
    }

    managed.subscribers.add(wsSessionId);
    log.debug(`WS ${wsSessionId} subscribed to session ${codingSessionId}`, {
      bufferSize: managed.outputBuffer.length,
      state: managed.session.state,
    });

    // Send current state first so UI knows context before output replay
    wsSessionManager.send(
      wsSessionId,
      'coding-agent:session:state' as never,
      {
        sessionId: codingSessionId,
        state: managed.session.state,
      } as never
    );

    // Replay output buffer for reconnection
    if (managed.outputBuffer.length > 0) {
      wsSessionManager.send(
        wsSessionId,
        'coding-agent:session:output' as never,
        {
          sessionId: codingSessionId,
          data: managed.outputBuffer,
        } as never
      );
    }

    // Send ACP snapshot on reconnect (tool calls, plan)
    if (managed.acpClient) {
      wsSessionManager.send(
        wsSessionId,
        'coding-agent:acp:snapshot' as never,
        {
          sessionId: codingSessionId,
          toolCalls: managed.acpToolCalls,
          plan: managed.acpPlan,
          acpEnabled: true,
        } as never
      );
    }

    return true;
  }

  /**
   * Unsubscribe a WebSocket session from a coding agent session.
   */
  unsubscribe(codingSessionId: string, wsSessionId: string): void {
    const managed = this.sessions.get(codingSessionId);
    if (managed) {
      managed.subscribers.delete(wsSessionId);
    }
  }

  /**
   * Remove a WS session from all coding agent session subscriptions
   * (called when a WS connection disconnects).
   */
  removeSubscriber(wsSessionId: string): void {
    for (const managed of this.sessions.values()) {
      managed.subscribers.delete(wsSessionId);
    }
  }

  /**
   * Get the output buffer for a session (for REST-based reconnection).
   */
  getOutputBuffer(sessionId: string, userId: string): string | undefined {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) return undefined;
    return managed.outputBuffer;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /** Stop cleanup timer and terminate all sessions (for graceful shutdown) */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close all ACP clients
    for (const managed of this.sessions.values()) {
      if (managed.acpClient) {
        managed.acpClient.close().catch((e) => log.debug('ACP client close error on shutdown', { error: String(e) }));
        managed.acpClient = null;
      }
    }

    // Terminate all active sessions with SIGTERM then SIGKILL fallback
    for (const managed of this.sessions.values()) {
      if (managed.pty) {
        try {
          managed.pty.kill('SIGTERM');
        } catch {
          // Process already dead
        }
        // Schedule a SIGKILL fallback if process doesn't exit in 5 seconds
        const pty = managed.pty;
        setTimeout(() => {
          try {
            pty.kill('SIGKILL');
          } catch {
            // Already dead
          }
          try {
            pty.dispose();
          } catch {
            // Best effort
          }
        }, 5000).unref();
        managed.pty = null;
      }
    }
  }

  // ===========================================================================
  // Completion & Persistence
  // ===========================================================================

  /**
   * Wait for a session to complete (exit or error).
   * Returns the session when done. Rejects on timeout.
   */
  waitForCompletion(
    sessionId: string,
    userId: string,
    timeoutMs = SESSION_TIMEOUT_MS
  ): Promise<CodingAgentSession> {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.userId !== userId) {
      return Promise.reject(new Error(`Session ${sessionId} not found`));
    }

    // Already completed?
    const { state } = managed.session;
    if (state === 'completed' || state === 'failed' || state === 'terminated') {
      return Promise.resolve(managed.session);
    }

    return new Promise<CodingAgentSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this callback
        const idx = managed.completionCallbacks.indexOf(onComplete);
        if (idx >= 0) managed.completionCallbacks.splice(idx, 1);
        reject(new Error(`Session ${sessionId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onComplete = (session: CodingAgentSession) => {
        clearTimeout(timer);
        resolve(session);
      };

      managed.completionCallbacks.push(onComplete);
    });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private fireCompletionCallbacks(managed: ManagedSession): void {
    const callbacks = managed.completionCallbacks.splice(0);
    for (const cb of callbacks) {
      try {
        cb(managed.session);
      } catch (err) {
        log.warn('Completion callback error', { error: String(err) });
      }
    }
  }

  private async persistResult(
    managed: ManagedSession,
    exitCode?: number,
    error?: string
  ): Promise<void> {
    const { session, outputBuffer } = managed;
    const startedAt = new Date(session.startedAt).getTime();
    const completedAt = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
    const durationMs = completedAt - startedAt;

    // Strip ANSI escape codes from output
    const cleanOutput = stripAnsi(outputBuffer);

    try {
      await codingAgentResultsRepo.save({
        id: randomUUID(),
        userId: session.userId,
        sessionId: session.id,
        provider: session.provider,
        prompt: session.prompt,
        cwd: session.cwd,
        model: session.model,
        success: session.state === 'completed',
        output: cleanOutput,
        exitCode,
        error,
        durationMs,
        mode: session.mode,
      });
      log.info(`Persisted result for session ${session.id}`);
    } catch (err) {
      log.warn(`Failed to persist result for session ${session.id}`, { error: String(err) });
    }
  }

  private sendToSubscribers(managed: ManagedSession, event: string, payload: unknown): void {
    for (const wsId of managed.subscribers) {
      wsSessionManager.send(wsId, event as never, payload as never);
    }
  }

  private countActiveSessions(userSet: Set<string>): number {
    let count = 0;
    for (const sessionId of userSet) {
      const managed = this.sessions.get(sessionId);
      if (
        managed &&
        (managed.session.state === 'starting' ||
          managed.session.state === 'running' ||
          managed.session.state === 'waiting')
      ) {
        count++;
      }
    }
    return count;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, managed] of this.sessions) {
      const { session } = managed;

      // Remove completed/failed/terminated sessions older than 5 minutes
      if (
        session.completedAt &&
        (session.state === 'completed' ||
          session.state === 'failed' ||
          session.state === 'terminated')
      ) {
        const completedAt = new Date(session.completedAt).getTime();
        if (now - completedAt > 300_000) {
          this.sessions.delete(sessionId);
          const userSet = this.userSessions.get(session.userId);
          if (userSet) {
            userSet.delete(sessionId);
            if (userSet.size === 0) this.userSessions.delete(session.userId);
          }
        }
      }
    }
  }

  private buildDisplayName(provider: string, prompt: string): string {
    const builtinNames: Record<string, string> = {
      'claude-code': 'Claude Code',
      codex: 'Codex',
      'gemini-cli': 'Gemini CLI',
    };
    const name = isBuiltinProvider(provider)
      ? builtinNames[provider]
      : provider.startsWith('custom:')
        ? provider.slice(7)
        : provider;
    const truncated = prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt;
    return `${name}: ${truncated}`;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/** Strip ANSI escape codes from output text */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: CodingAgentSessionManager | null = null;

export function getCodingAgentSessionManager(): CodingAgentSessionManager {
  if (!instance) {
    instance = new CodingAgentSessionManager();
  }
  return instance;
}
