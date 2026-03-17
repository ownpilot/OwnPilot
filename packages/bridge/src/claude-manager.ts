/**
 * Claude Code Process Manager (Interactive Mode)
 *
 * Architecture (interactive mode — current default):
 *   - Single long-lived CC process per conversation, stdin kept open.
 *   - Messages written as newline-delimited JSON, results streamed back.
 *   - Same session_id throughout, no --resume dance needed.
 *   - 2nd+ message latency ~2s vs ~10s (no init overhead).
 *   - send() routes exclusively via runViaInteractive() — legacy spawn-per-message removed.
 *
 * Key invariants (S38+):
 *   - stdin 'error' events do not crash bridge (EPIPE silenced)
 *   - Zombie processes detected via isProcessAlive() not proc.killed
 *   - Token counting: only result events counted (no double-count from message_delta)
 *   - session.done ownership: only result event handler (not exit handler)
 *   - Hard timeout: runViaInteractive() always terminates within ccSpawnTimeoutMs
 *   - configOverrides (model, effort, additionalDirs, permissionMode) applied at spawn
 *   - Pattern detection fires at most once per turn (patternDetectedThisTurn guard)
 *   - respondUrl uses /input endpoint (interactive stdin, not /respond legacy path)
 *
 * Critical constraints:
 *   - CLAUDECODE env var is deleted before spawn (prevents nested session rejection)
 *   - --verbose is mandatory for stream-json output
 *   - Input format: {\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"...\"}}\\n
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import type { SessionInfo, SpawnOptions, StreamChunk, PendingApproval, SessionConfigOverrides, ProjectSessionDetail, ProjectResourceMetrics } from './types.ts';
import { isSdkAvailable, SdkSessionWrapper } from './sdk-session.ts';
import { worktreeManager } from './worktree-manager.ts';
import { SlidingWindowCircuitBreaker, globalCb, projectCbRegistry } from './circuit-breaker.ts';
import {
  incrementSpawnCount,
  incrementSpawnErrors,
  incrementSpawnSuccess,
  recordFirstChunk,
  recordDuration,
  incrementProjectSpawn,
  recordProjectActiveDuration,
  getProjectMetrics,
} from './metrics.ts';
import { eventBus } from './event-bus.ts';
import { isProcessAlive } from './process-alive.ts';
import { matchPatterns, isBlocking } from './pattern-matcher.ts';
import { fireBlockingWebhooks } from './webhook-sender.ts';

// ---------------------------------------------------------------------------
// P0-3: Orphaned process sweep — runs at startup to clean up CC processes
// from a previous bridge crash (SIGKILL/OOM).
// ---------------------------------------------------------------------------

/**
 * Scan a bridge state directory for session JSON files that record an
 * activeProcessPid. Kill any PIDs that are still alive (orphaned CC processes).
 *
 * @param stateDir Directory to scan (defaults to ~/.claude/bridge-state/sessions).
 * @returns Number of processes killed.
 */
export function sweepOrphanedProcesses(
  stateDir: string = `${process.env.HOME ?? '/home/ayaz'}/.claude/bridge-state/sessions`,
): number {
  let swept = 0;
  try {
    const entries = readdirSync(stateDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(stateDir, entry), 'utf-8')) as Record<string, unknown>;
        const pid = data['activeProcessPid'] as number | undefined;
        if (pid != null && isProcessAlive(pid)) {
          process.kill(pid, 'SIGTERM');
          swept++;
        }
      } catch {
        // Skip unreadable / unparseable files
      }
    }
  } catch {
    // Directory doesn't exist — no orphans
  }
  logger.info({ swept, stateDir }, 'Orphan process sweep complete');
  return swept;
}

// ---------------------------------------------------------------------------
// Internal session record (no persistent process reference)
// ---------------------------------------------------------------------------

interface Session {
  info: SessionInfo;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Promise chain for serialization: each message waits for the previous
   * CC process to finish before spawning the next one.
   * This prevents concurrent access to the same session-id file.
   */
  pendingChain: Promise<void>;
  /**
   * Number of messages sent in this session.
   * First message uses --session-id, subsequent use --resume.
   * CC 2.1.59 locks sessions: --session-id cannot be reused, --resume continues.
   */
  messagesSent: number;
  /**
   * When true, bridge will NOT send new messages to this session.
   * Used for manual takeover: user resumes in terminal, bridge steps aside.
   * Handback restores normal operation.
   */
  paused: boolean;
  pausedAt?: Date;
  pauseReason?: string;
  /**
   * Reference to the currently running CC child process for this session.
   * Set immediately after spawn(), cleared when the process exits.
   * Used to kill orphan processes when the HTTP client disconnects mid-stream.
   */
  activeProcess: ChildProcess | null;
  /**
   * Per-session circuit breaker (Tier-1).
   * Prevents one broken session from blocking the entire bridge.
   */
  circuitBreaker: SlidingWindowCircuitBreaker;
  /**
   * Timer that auto-terminates a paused session if handback never arrives.
   * Prevents indefinite memory leak from abandoned manual takeovers.
   */
  maxPauseTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Set when isBlocking() detects QUESTION or TASK_BLOCKED pattern.
   * Cleared when /respond is called or session terminates.
   */
  pendingApproval: PendingApproval | null;
  /** Interactive mode: long-lived CC process with stdin kept open */
  interactiveProcess: ChildProcess | null;
  /** Interactive mode: readline interface for stdout JSON parsing */
  interactiveRl: ReturnType<typeof createInterface> | null;
  /** Interactive mode: auto-close timer after period of no input */
  interactiveIdleTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True while startInteractive() is between the guard check and spawn completion.
   * Prevents TOCTOU: concurrent calls that both pass the interactiveProcess guard
   * but haven't set interactiveProcess yet (can happen when session exists and both
   * callers resume from the `await getOrCreate` yield in the same microtask batch).
   */
  interactiveStarting: boolean;
  /**
   * B4: Set by processInteractiveOutput when it performs pattern detection (interactive path).
   * sendWithPatternDetection() (Layer 1 in router.ts) checks this flag and skips its own
   * detection to prevent duplicate session.blocking / session.phase_complete events.
   * Reset at the start of each runViaInteractive() invocation.
   */
  patternDetectedThisTurn: boolean;
  /**
   * Per-session config overrides applied to the next CC spawn.
   * Set via command interceptor (/model, /effort, /add-dir, /plan, /fast).
   * Stored in bridge memory only — NEVER written to JSONL.
   */
  configOverrides: SessionConfigOverrides;
  /**
   * User-facing display name for this session.
   * Set via /rename command. Bridge memory only.
   */
  displayName: string | null;
  /**
   * SDK session wrapper for USE_SDK_SESSION=true path.
   * Reused across messages in the same conversation.
   * undefined when CLI spawn path is active.
   */
  sdkSession?: SdkSessionWrapper;
}

// ---------------------------------------------------------------------------
// ClaudeManager
// ---------------------------------------------------------------------------

export class ClaudeManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  // LRU eviction: max sessions before oldest idle session is evicted
  private readonly MAX_SESSIONS = 500;
  // Concurrency limit: max simultaneous active CC processes (each consumes ~3s CPU + memory)
  private readonly MAX_CONCURRENT_ACTIVE = 10;
  // Per-project concurrency limit: fair resource allocation across projects
  private readonly MAX_CONCURRENT_PER_PROJECT = config.maxConcurrentPerProject;
  // Per-project session cap: prevent one project from consuming all session slots
  private readonly MAX_SESSIONS_PER_PROJECT = config.maxSessionsPerProject;
  // Interactive mode: max concurrent interactive CC processes
  // Matches MAX_CONCURRENT_ACTIVE since send() now uses interactive mode internally
  private readonly MAX_CONCURRENT_INTERACTIVE = 10;
  // Interactive mode: auto-close after 5 min of no input
  private readonly INTERACTIVE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  constructor() {
    super();
    // Sweep orphaned CC processes from previous crash (P0-3)
    try { sweepOrphanedProcesses(); } catch { /* non-fatal */ }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get existing session metadata or create a new one.
   * Does NOT spawn a process — processes are spawned per-message in send().
   *
   * Session ID resolution (priority order):
   *   1. Already tracked in-memory → reuse
   *   2. options.sessionId provided by caller → use that UUID
   *   3. Generate new randomUUID()
   *
   * Disk detection: if the resolved sessionId already has a .jsonl on disk,
   * set messagesSent=1 so subsequent calls use --resume instead of --session-id.
   * This prevents "Session ID already in use" errors when:
   *   - Bridge restarts (in-memory state lost, disk sessions survive)
   *   - User passes their own session UUID from a manual CC session
   */
  async getOrCreate(
    conversationId: string,
    options: Partial<SpawnOptions> = {},
  ): Promise<SessionInfo> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.resetIdleTimer(conversationId);
      return { ...existing.info };
    }

    const sessionId = options.sessionId ?? randomUUID();
    const projectDir = options.projectDir ?? config.defaultProjectDir;

    // Detect if this session already exists on CC disk
    const existsOnDisk = await this.sessionExistsOnDisk(sessionId, projectDir);

    const info: SessionInfo = {
      conversationId,
      sessionId,
      processAlive: false, // No process at creation time; updated dynamically
      lastActivity: new Date(),
      projectDir,
      tokensUsed: 0,
      budgetUsed: 0,
      pendingApproval: null,
    };

    // Per-project session cap: prevent one project from consuming all slots
    const projectSessions = [...this.sessions.values()].filter(
      (s) => s.info.projectDir === projectDir,
    );
    if (projectSessions.length >= this.MAX_SESSIONS_PER_PROJECT) {
      // Try to evict oldest idle session from THIS project first
      let oldestProjectId: string | null = null;
      let oldestProjectTime = Infinity;
      for (const s of projectSessions) {
        if (!s.activeProcess && !s.paused) {
          const t = s.info.lastActivity.getTime();
          if (t < oldestProjectTime) { oldestProjectTime = t; oldestProjectId = s.info.conversationId; }
        }
      }
      if (oldestProjectId) {
        logger.warn(
          { evictedId: oldestProjectId, projectDir, projectSessionCount: projectSessions.length },
          'MAX_SESSIONS_PER_PROJECT reached — evicting oldest idle project session',
        );
        this.terminate(oldestProjectId);
      }
      // If no idle session to evict, let it proceed (global LRU will handle it)
    }

    // LRU eviction: if at capacity, evict the oldest idle (non-active, non-paused) session
    if (this.sessions.size >= this.MAX_SESSIONS) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of this.sessions) {
        if (!s.activeProcess && !s.paused) {
          const t = s.info.lastActivity.getTime();
          if (t < oldestTime) { oldestTime = t; oldestId = id; }
        }
      }
      if (oldestId) {
        logger.warn({ evictedId: oldestId, sessionCount: this.sessions.size }, 'MAX_SESSIONS reached — evicting oldest idle session');
        this.terminate(oldestId);
      }
    }

    const session: Session = {
      info,
      idleTimer: null,
      pendingChain: Promise.resolve(),
      // If session exists on disk, treat as already-messaged → --resume will be used
      messagesSent: existsOnDisk ? 1 : 0,
      paused: false,
      activeProcess: null,
      circuitBreaker: new SlidingWindowCircuitBreaker({ failureThreshold: 5, successThreshold: 2, halfOpenTimeout: 30_000, windowSize: 10 }),
      maxPauseTimer: null,
      pendingApproval: null,
      interactiveProcess: null,
      interactiveRl: null,
      interactiveIdleTimer: null,
      interactiveStarting: false,
      patternDetectedThisTurn: false,
      configOverrides: {},
      displayName: null,
    };

    this.sessions.set(conversationId, session);
    this.resetIdleTimer(conversationId);
    logger.info(
      { conversationId, sessionId, existsOnDisk, messagesSent: session.messagesSent },
      existsOnDisk
        ? 'Resuming existing CC disk session'
        : 'New conversation session created',
    );

    // Emit project stats changed (MON-04)
    const statsForProject = this.getProjectStats().find(s => s.projectDir === info.projectDir);
    eventBus.emit('project.stats_changed', {
      type: 'project.stats_changed',
      projectDir: info.projectDir,
      active: statsForProject?.active ?? 0,
      paused: statsForProject?.paused ?? 0,
      total: statsForProject?.total ?? 1,
      reason: 'session_created',
      timestamp: new Date().toISOString(),
    });

    return { ...info };
  }

  /**
   * Send a message to Claude Code and stream back chunks.
   *
   * Spawns a fresh CC process per message, writes to stdin, then closes stdin
   * so CC processes the message and emits stream-json events.
   *
   * Messages per conversation are serialized to prevent concurrent session-id file access.
   */
  async *send(
    conversationId: string,
    message: string,
    projectDir?: string,
    systemPrompt?: string,
    options?: { worktree?: boolean; worktreeName?: string },
  ): AsyncGenerator<StreamChunk> {
    await this.getOrCreate(conversationId, { projectDir });

    const session = this.sessions.get(conversationId);
    if (!session) {
      yield { type: 'error', error: 'Session not found after creation' };
      return;
    }

    // Pause guard: if session is paused (manual takeover), reject new messages
    if (session.paused) {
      yield {
        type: 'error',
        error: `Session paused for manual takeover since ${session.pausedAt?.toISOString() ?? 'unknown'}. Reason: ${session.pauseReason ?? 'manual intervention'}. Use POST /v1/sessions/:id/handback to release.`,
      };
      return;
    }

    // Concurrency guard: limit simultaneous active CC processes to avoid resource exhaustion
    // Counts both spawn-per-message (activeProcess) and interactive (interactiveProcess)
    const activeCount = [...this.sessions.values()].filter(
      (s) => isProcessAlive(s.activeProcess?.pid) || isProcessAlive(s.interactiveProcess?.pid),
    ).length;
    if (activeCount >= this.MAX_CONCURRENT_ACTIVE) {
      const concErr: Error & { code?: string } = new Error(
        `Too many concurrent sessions (${activeCount}/${this.MAX_CONCURRENT_ACTIVE} active). Retry later.`,
      );
      concErr.code = 'CONCURRENT_LIMIT';
      throw concErr;
    }

    // Per-project concurrency guard: fair resource allocation
    const sessionProjectDir = session.info.projectDir;
    const projectActiveCount = [...this.sessions.values()].filter(
      (s) => (isProcessAlive(s.activeProcess?.pid) || isProcessAlive(s.interactiveProcess?.pid))
        && s.info.projectDir === sessionProjectDir,
    ).length;
    if (projectActiveCount >= this.MAX_CONCURRENT_PER_PROJECT) {
      const projErr: Error & { code?: string } = new Error(
        `Too many concurrent sessions for project ${sessionProjectDir} (${projectActiveCount}/${this.MAX_CONCURRENT_PER_PROJECT}). Other projects can still proceed.`,
      );
      projErr.code = 'PROJECT_CONCURRENT_LIMIT';
      throw projErr;
    }

    // Tier-3: Global circuit breaker check — emergency brake for all CC spawning
    if (!globalCb.canExecute()) {
      const globalErr: Error & { code?: string } = new Error(
        'Global circuit breaker OPEN — too many CC failures globally. Retry later.',
      );
      globalErr.code = 'GLOBAL_CIRCUIT_OPEN';
      throw globalErr;
    }

    // Tier-2: Per-project circuit breaker check — stops spawning for broken projects
    const projectCb = projectCbRegistry.get(sessionProjectDir);
    if (!projectCb.canExecute()) {
      const projCbErr: Error & { code?: string } = new Error(
        `Project circuit breaker OPEN for ${sessionProjectDir}. Too many CC failures. Retry later.`,
      );
      projCbErr.code = 'PROJECT_CIRCUIT_OPEN';
      throw projCbErr;
    }

    const log = logger.child({
      conversationId,
      sessionId: session.info.sessionId,
    });

    // Serialization: wait for previous message to finish, then register ours
    const prevChain = session.pendingChain;
    let resolveMyChain!: () => void;
    const myChain = new Promise<void>((resolve) => {
      resolveMyChain = resolve;
    });
    session.pendingChain = myChain;

    try {
      // Wait for the previous message's CC process to finish
      await prevChain;

      // Interactive mode guard: reject when an EXTERNAL interactive process is active
      // (moved here from before pendingChain so serialized send() calls work)
      if (session.interactiveProcess) {
        yield {
          type: 'error',
          error: `Session has an active interactive process (PID ${session.interactiveProcess.pid}). Close it first or use POST /v1/sessions/:id/input.`,
        };
        return;
      }

      session.info.lastActivity = new Date();
      this.resetIdleTimer(conversationId);

      // WORK-04: If worktree isolation requested and this session doesn't have one yet,
      // create a worktree and override the session's projectDir with the worktree path.
      // Only create once per session (check worktreeName to avoid re-creating on 2nd message).
      if (options?.worktree && !session.info.worktreeName) {
        const originalProjectDir = session.info.projectDir;
        try {
          const wt = await worktreeManager.create(originalProjectDir, {
            conversationId,
            name: options.worktreeName,
          });
          // Override: CC spawns in worktree path
          session.info.worktreeName = wt.name;
          session.info.worktreePath = wt.path;
          session.info.worktreeBranch = wt.branch;
          session.info.projectDir = wt.path;
          eventBus.emit('worktree.created', {
            type: 'worktree.created',
            projectDir: wt.projectDir,
            name: wt.name,
            branch: wt.branch,
            path: wt.path,
            timestamp: new Date().toISOString(),
          });
          log.info({ worktreeName: wt.name, worktreePath: wt.path }, 'Worktree created for session isolation');
        } catch (err) {
          log.warn({ err, conversationId }, 'Worktree creation failed — falling back to direct spawn');
          // Graceful degradation: spawn in original projectDir (session.info.projectDir unchanged)
        }
      }

      // Spawn CC, write message, stream events
      for await (const chunk of this.runClaude(session, message, systemPrompt, log)) {
        yield chunk;
      }
    } finally {
      resolveMyChain();
      session.info.lastActivity = new Date();
      this.resetIdleTimer(conversationId);
      log.debug('Message response complete');
    }
  }

  /**
   * Terminate (forget) a specific session.
   * Next message will create a new session-id (losing conversation history).
   */
  terminate(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    // Capture projectDir BEFORE deleting session (MON-04)
    const projectDir = session.info.projectDir;
    logger.info({ conversationId }, 'Terminating conversation session');
    // Kill interactive process if still alive (isProcessAlive guards against dead PIDs)
    if (session.interactiveProcess && isProcessAlive(session.interactiveProcess.pid)) {
      try { session.interactiveProcess.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.cleanupInteractive(conversationId);
    this.clearIdleTimer(conversationId);
    if (session.maxPauseTimer) {
      clearTimeout(session.maxPauseTimer);
      session.maxPauseTimer = null;
    }
    // Kill activeProcess if still alive (P0-4)
    if (session.activeProcess && isProcessAlive(session.activeProcess.pid)) {
      const proc = session.activeProcess;
      proc.kill('SIGTERM');
      // Escalate to SIGKILL after 2 seconds if process ignores SIGTERM
      setTimeout(() => {
        if (proc.pid != null && isProcessAlive(proc.pid)) {
          proc.kill('SIGKILL');
        }
      }, 2000);
    }
    this.sessions.delete(conversationId);

    // Emit project stats changed after deletion — compute updated stats (MON-04)
    const updatedStats = this.getProjectStats().find(s => s.projectDir === projectDir);
    eventBus.emit('project.stats_changed', {
      type: 'project.stats_changed',
      projectDir,
      active: updatedStats?.active ?? 0,
      paused: updatedStats?.paused ?? 0,
      total: updatedStats?.total ?? 0,
      reason: 'session_terminated',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Graceful shutdown of all sessions.
   */
  async shutdownAll(): Promise<void> {
    logger.info({ sessionCount: this.sessions.size }, 'Shutting down all sessions');
    for (const id of Array.from(this.sessions.keys())) {
      this.terminate(id);
    }
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      ...s.info,
      processAlive: isProcessAlive(s.activeProcess?.pid),
      pendingApproval: s.pendingApproval,
    }));
  }

  getSession(conversationId: string): SessionInfo | null {
    const s = this.sessions.get(conversationId);
    if (!s) return null;
    return { ...s.info, processAlive: isProcessAlive(s.activeProcess?.pid), pendingApproval: s.pendingApproval };
  }

  // -------------------------------------------------------------------------
  // Public: config overrides + display name (command interceptor)
  // -------------------------------------------------------------------------

  /**
   * Set per-session config overrides for the next CC spawn.
   * Merges with existing overrides (does not replace).
   */
  setConfigOverrides(conversationId: string, overrides: Partial<SessionConfigOverrides>): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.configOverrides = { ...session.configOverrides, ...overrides };
  }

  /**
   * Get current per-session config overrides.
   */
  getConfigOverrides(conversationId: string): SessionConfigOverrides {
    const session = this.sessions.get(conversationId);
    return session?.configOverrides ?? {};
  }

  /**
   * Set a user-facing display name for a session.
   * Stored in bridge memory only — NEVER written to JSONL.
   */
  setDisplayName(conversationId: string, name: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.displayName = name;
  }

  /**
   * Get the display name for a session (null if not set).
   */
  getDisplayName(conversationId: string): string | null {
    const session = this.sessions.get(conversationId);
    return session?.displayName ?? null;
  }

  /**
   * Get the file path to a session's JSONL file.
   * Returns null if no session is tracked for this conversationId.
   */
  getSessionJsonlPath(conversationId: string): string | null {
    const session = this.sessions.get(conversationId);
    if (!session) return null;
    const dir = this.getSessionsDir(session.info.projectDir);
    return join(dir, `${session.info.sessionId}.jsonl`);
  }

  // -------------------------------------------------------------------------
  // Public: pause / handback (manual takeover support)
  // -------------------------------------------------------------------------

  /**
   * Pause a session — bridge stops sending messages, user can safely resume in terminal.
   * Returns the session UUID for `claude --resume UUID`.
   */
  pause(conversationId: string, reason?: string): { sessionId: string; resumeCommand: string } | null {
    const session = this.sessions.get(conversationId);
    if (!session) return null;

    session.paused = true;
    session.pausedAt = new Date();
    session.pauseReason = reason ?? 'manual takeover';
    this.clearIdleTimer(conversationId); // Don't expire while paused

    // Paused sessions must eventually be cleaned up — auto-terminate after 24 hours
    // if handback never arrives (prevents indefinite memory leak)
    session.maxPauseTimer = setTimeout(() => {
      logger.warn({ conversationId }, 'Paused session max duration (24h) exceeded — auto-terminating');
      this.terminate(conversationId);
    }, 24 * 60 * 60 * 1000);

    logger.info(
      { conversationId, sessionId: session.info.sessionId, reason: session.pauseReason },
      'Session paused for manual takeover',
    );

    return {
      sessionId: session.info.sessionId,
      resumeCommand: `claude --resume ${session.info.sessionId}`,
    };
  }

  /**
   * Handback a paused session — bridge resumes control, can send messages again.
   */
  async handback(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId);
    if (!session) return false;

    const wasPaused = session.paused;
    session.paused = false;
    session.pausedAt = undefined;
    session.pauseReason = undefined;
    // Clear the max pause timer — handback arrived in time
    if (session.maxPauseTimer) {
      clearTimeout(session.maxPauseTimer);
      session.maxPauseTimer = null;
    }
    // Bump messagesSent in case user sent messages during manual takeover
    // (re-detect from disk to be safe)
    const existsOnDisk = await this.sessionExistsOnDisk(session.info.sessionId, session.info.projectDir);
    if (existsOnDisk && session.messagesSent === 0) {
      session.messagesSent = 1;
    }
    this.resetIdleTimer(conversationId);

    logger.info(
      { conversationId, sessionId: session.info.sessionId, wasPaused },
      'Session handed back to bridge',
    );

    return true;
  }

  /**
   * Get pause status for a session.
   */
  isPaused(conversationId: string): { paused: boolean; pausedAt?: string; reason?: string } {
    const session = this.sessions.get(conversationId);
    if (!session) return { paused: false };
    return {
      paused: session.paused,
      pausedAt: session.pausedAt?.toISOString(),
      reason: session.pauseReason,
    };
  }

  // -------------------------------------------------------------------------
  // Public: pending approval tracking (notification layer)
  // -------------------------------------------------------------------------

  /**
   * Set pending approval on a session when a blocking pattern is detected.
   */
  setPendingApproval(conversationId: string, pattern: 'QUESTION' | 'TASK_BLOCKED', text: string): boolean {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    const approval: PendingApproval = { pattern, text, detectedAt: Date.now() };
    session.pendingApproval = approval;
    session.info.pendingApproval = approval;
    logger.info({ conversationId, pattern }, 'Pending approval set');
    return true;
  }

  /**
   * Clear pending approval on a session (e.g., after user responds).
   */
  clearPendingApproval(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    session.pendingApproval = null;
    session.info.pendingApproval = null;
    logger.info({ conversationId }, 'Pending approval cleared');
    return true;
  }

  /**
   * Get all sessions that have a pending approval (blocking pattern active).
   */
  getPendingSessions(): Array<SessionInfo & { pendingApproval: PendingApproval }> {
    const results: Array<SessionInfo & { pendingApproval: PendingApproval }> = [];
    for (const session of this.sessions.values()) {
      if (session.pendingApproval) {
        results.push({
          ...session.info,
          processAlive: isProcessAlive(session.activeProcess?.pid),
          pendingApproval: session.pendingApproval,
        });
      }
    }
    return results;
  }

  /**
   * Kill the currently active CC process for a conversation (e.g., on HTTP client disconnect).
   * Safe to call even if no process is active — does nothing in that case.
   */
  killActiveProcess(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    const proc = session.activeProcess;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      session.activeProcess = null;
      logger.info({ conversationId, pid: proc.pid }, 'Killed active CC process on client disconnect');
    }
  }

  // -------------------------------------------------------------------------
  // Public: interactive session mode (Phase 4b)
  // -------------------------------------------------------------------------

  /**
   * Start an interactive CC session with stdin kept open.
   * Unlike send() (spawn-per-message), the CC process stays alive between messages.
   * Messages are injected via writeToSession(), output is emitted via EventBus.
   */
  async startInteractive(
    conversationId: string,
    options: {
      projectDir?: string;
      sessionId?: string;
      systemPrompt?: string;
      maxTurns?: number;
    } = {},
  ): Promise<{ conversationId: string; sessionId: string; pid: number }> {
    await this.getOrCreate(conversationId, {
      projectDir: options.projectDir,
      sessionId: options.sessionId,
    });

    const session = this.sessions.get(conversationId);
    if (!session) throw new Error('Session not found after creation');

    if (session.interactiveStarting) {
      throw new Error(`Session '${conversationId}' is already starting an interactive process — retry after spawn completes`);
    }
    session.interactiveStarting = true;

    try {
    if (session.interactiveProcess) {
      if (isProcessAlive(session.interactiveProcess.pid)) {
        throw new Error(`Session already has an interactive process (PID ${session.interactiveProcess.pid})`);
      }
      // Zombie: process died externally (OOM/SIGKILL), .kill() was never called
      this.cleanupInteractive(conversationId);
    }
    if (session.activeProcess) {
      throw new Error('Session has an active spawn-per-message process — wait for it to complete');
    }
    if (session.paused) {
      throw new Error('Session is paused for manual takeover');
    }

    const interactiveCount = [...this.sessions.values()]
      .filter((s) => isProcessAlive(s.interactiveProcess?.pid)).length;
    if (interactiveCount >= this.MAX_CONCURRENT_INTERACTIVE) {
      throw new Error(
        `Too many interactive sessions (${interactiveCount}/${this.MAX_CONCURRENT_INTERACTIVE}). Close one first.`,
      );
    }

    const log = logger.child({ conversationId, sessionId: session.info.sessionId, mode: 'interactive' });

    // Build env (same as runClaude)
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    delete env['CLAUDECODE'];
    delete env['ANTHROPIC_API_KEY'];
    if (config.anthropicApiKey && !config.anthropicApiKey.startsWith('sk-ant-placeholder')) {
      env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
    }

    const isFirstMessage = session.messagesSent === 0;
    const sessionArg = isFirstMessage
      ? ['--session-id', session.info.sessionId]
      : ['--resume', session.info.sessionId];

    const maxTurns = options.maxTurns ?? 50;

    // Apply per-session config overrides (command interceptor: /model, /effort, etc.)
    const overrides = session.configOverrides ?? {};
    const effectiveModel = overrides.model ?? config.claudeModel;

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      ...sessionArg,
      '--dangerously-skip-permissions',
      '--model', effectiveModel,
      '--allowedTools', config.allowedTools.join(','),
      '--add-dir', session.info.projectDir,
      '--max-budget-usd', String(config.claudeMaxBudgetUsd),
      '--max-turns', String(maxTurns),
      '--strict-mcp-config',
      '--mcp-config', JSON.stringify({ mcpServers: config.mcpServers ?? {} }),
    ];

    if (options.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }

    if (overrides.effort) {
      args.push('--effort', overrides.effort);
    }
    if (overrides.additionalDirs?.length) {
      for (const dir of overrides.additionalDirs) {
        args.push('--add-dir', dir);
      }
    }
    if (overrides.permissionMode) {
      args.push('--permission-mode', overrides.permissionMode);
    }

    log.info(
      { claudePath: config.claudePath, model: config.claudeModel, maxTurns, projectDir: session.info.projectDir },
      'Starting interactive CC session',
    );

    const proc = spawn(config.claudePath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: session.info.projectDir,
    });

    session.interactiveProcess = proc;
    log.info({ pid: proc.pid }, 'Interactive CC process spawned');

    proc.stdin!.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
        log.warn({ err: err.message }, 'Interactive CC stdin unexpected error');
      }
      // EPIPE expected when CC exits — do not propagate as uncaught exception
    });

    proc.on('error', (err) => {
      log.error({ err: err.message }, 'Interactive CC spawn error');
      eventBus.emit('session.error', {
        type: 'session.error',
        conversationId: session.info.conversationId,
        sessionId: session.info.sessionId,
        projectDir: session.info.projectDir,
        error: `Interactive CC spawn error: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      this.cleanupInteractive(conversationId);
    });

    proc.on('exit', (code, signal) => {
      log.info({ code, signal }, 'Interactive CC process exited');
      void this.sessionExistsOnDisk(session.info.sessionId, session.info.projectDir).then((onDisk) => {
        if (onDisk && session.messagesSent === 0) {
          session.messagesSent = 1;
        }
      });
      // processInteractiveOutput owns session.done emission via 'result' event.
      // Only emit error here for abnormal exit (process died without a result event).
      if (code !== 0 && code !== null) {
        eventBus.emit('session.error', {
          type: 'session.error',
          conversationId: session.info.conversationId,
          sessionId: session.info.sessionId,
          projectDir: session.info.projectDir,
          error: `Interactive CC exited abnormally (code=${code}, signal=${signal})`,
          timestamp: new Date().toISOString(),
        });
      }
      this.cleanupInteractive(conversationId);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log.debug({ stderr: text.slice(0, 200) }, 'Interactive CC stderr');
    });

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity, terminal: false });
    session.interactiveRl = rl;

    this.processInteractiveOutput(session, rl, log);
    this.resetInteractiveIdleTimer(conversationId);

    return {
      conversationId,
      sessionId: session.info.sessionId,
      pid: proc.pid!,
    };
    } finally {
      session.interactiveStarting = false;
    }
  }

  /**
   * Write a message to an interactive CC session's stdin.
   * Output is emitted async via EventBus → SSE clients.
   */
  writeToSession(conversationId: string, message: string): boolean {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    if (!session.interactiveProcess || !isProcessAlive(session.interactiveProcess.pid)) return false;
    if (!session.interactiveProcess.stdin?.writable) return false;

    const log = logger.child({ conversationId, mode: 'interactive' });

    if (session.pendingApproval) {
      this.clearPendingApproval(conversationId);
    }

    const inputLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
    }) + '\n';

    try {
      session.interactiveProcess.stdin!.write(inputLine);
      log.info({ messageLength: message.length }, 'Message written to interactive stdin');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to write to interactive stdin');
      eventBus.emit('session.error', {
        type: 'session.error',
        conversationId: session.info.conversationId,
        sessionId: session.info.sessionId,
        projectDir: session.info.projectDir,
        error: `Failed to write to interactive stdin: ${String(err)}`,
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    session.info.lastActivity = new Date();
    this.resetInteractiveIdleTimer(conversationId);
    return true;
  }

  /**
   * Close an interactive CC session.
   * Closes stdin (EOF), waits for exit, then cleans up.
   */
  async closeInteractive(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    if (!session.interactiveProcess) return false;

    const log = logger.child({ conversationId, mode: 'interactive' });
    const proc = session.interactiveProcess;

    log.info({ pid: proc.pid }, 'Closing interactive session');

    try { proc.stdin?.end(); } catch { /* already closed */ }

    let exited = false;
    const exitPromise = new Promise<void>((resolve) => proc.once('exit', () => { exited = true; resolve(); }));
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await Promise.race([exitPromise, timeoutPromise]);

    if (!exited) {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      log.warn({ pid: proc.pid }, 'Interactive CC SIGTERM after 3s — will escalate to SIGKILL if needed');

      // B3: SIGKILL escalation — 2s after SIGTERM, force-kill if process ignores it
      const sigkillExit = new Promise<void>((resolve) => proc.once('exit', resolve));
      const sigkillWait = new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await Promise.race([sigkillExit, sigkillWait]);

      if (!proc.killed) {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        log.warn({ pid: proc.pid }, 'Interactive CC SIGKILL escalation (ignored SIGTERM)');
      }
    }

    this.cleanupInteractive(conversationId);
    return true;
  }

  /**
   * Check if a session is in interactive mode.
   */
  isInteractive(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    return !!session?.interactiveProcess && isProcessAlive(session.interactiveProcess.pid);
  }

  /**
   * B4: Returns true if processInteractiveOutput() already ran pattern detection this turn.
   * Used by sendWithPatternDetection() (router.ts) to skip duplicate detection on interactive path.
   */
  wasPatternDetected(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.patternDetectedThisTurn ?? false;
  }

  /**
   * Get all interactive sessions.
   */
  getInteractiveSessions(): Array<SessionInfo & { pid: number }> {
    const results: Array<SessionInfo & { pid: number }> = [];
    for (const session of this.sessions.values()) {
      if (session.interactiveProcess && isProcessAlive(session.interactiveProcess.pid)) {
        results.push({
          ...session.info,
          processAlive: isProcessAlive(session.interactiveProcess.pid),
          pendingApproval: session.pendingApproval,
          pid: session.interactiveProcess.pid!,
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Internal: interactive session helpers
  // -------------------------------------------------------------------------

  /**
   * Background processor for interactive CC stdout.
   * Parses stream-json events, emits to EventBus, handles pattern detection per turn.
   */
  private processInteractiveOutput(
    session: Session,
    rl: ReturnType<typeof createInterface>,
    log: ReturnType<typeof logger.child>,
  ): void {
    const turnText: string[] = [];

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        log.debug({ line: trimmed.slice(0, 80) }, 'Non-JSON line from interactive CC');
        return;
      }

      const type = event['type'] as string | undefined;

      switch (type) {
        case 'content_block_delta': {
          // B2: reset idle timer on CC output — prevents killing an actively-generating session
          this.resetInteractiveIdleTimer(session.info.conversationId);
          const delta = event['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            const text = delta['text'] as string;
            turnText.push(text);
            eventBus.emit('session.output', {
              type: 'session.output',
              conversationId: session.info.conversationId,
              sessionId: session.info.sessionId,
              projectDir: session.info.projectDir,
              text,
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case 'message_delta':
          // Token usage tracked only from 'result' events to avoid double-counting.
          // message_delta and result report overlapping usage data — per FIX 6 in legacy path.
          break;

        case 'result': {
          // B2: reset idle timer on turn complete — session is still active
          this.resetInteractiveIdleTimer(session.info.conversationId);
          const resultText = event['result'] as string | undefined;
          const subtype = event['subtype'] as string | undefined;
          const resultUsage = event['usage'] as Record<string, number> | undefined;
          const usage = resultUsage
            ? { input_tokens: resultUsage['input_tokens'] ?? 0, output_tokens: resultUsage['output_tokens'] ?? 0 }
            : undefined;
          if (usage) {
            session.info.tokensUsed += usage.input_tokens + usage.output_tokens;
          }

          // result.result may contain final text when no content_block_deltas came
          if (resultText && resultText.trim() && turnText.length === 0) {
            turnText.push(resultText);
            eventBus.emit('session.output', {
              type: 'session.output',
              conversationId: session.info.conversationId,
              sessionId: session.info.sessionId,
              projectDir: session.info.projectDir,
              text: resultText,
              timestamp: new Date().toISOString(),
            });
          }

          if (subtype === 'error') {
            eventBus.emit('session.error', {
              type: 'session.error',
              conversationId: session.info.conversationId,
              sessionId: session.info.sessionId,
              projectDir: session.info.projectDir,
              error: resultText ?? 'Interactive CC returned an error result',
              timestamp: new Date().toISOString(),
            });
          }

          // Emit turn-complete
          eventBus.emit('session.done', {
            type: 'session.done',
            conversationId: session.info.conversationId,
            sessionId: session.info.sessionId,
            projectDir: session.info.projectDir,
            usage,
            timestamp: new Date().toISOString(),
          });

          // Pattern detection on this turn's text
          const fullTurnText = turnText.join('');
          if (fullTurnText.trim()) {
            const patterns = matchPatterns(fullTurnText);

            const phasePattern = patterns.find((p) => p.key === 'PHASE_COMPLETE');
            if (phasePattern) {
              session.patternDetectedThisTurn = true; // B4: signal Layer 1 to skip
              eventBus.emit('session.phase_complete', {
                type: 'session.phase_complete',
                conversationId: session.info.conversationId,
                sessionId: session.info.sessionId,
                projectDir: session.info.projectDir,
                pattern: 'PHASE_COMPLETE',
                text: phasePattern.value,
                timestamp: new Date().toISOString(),
              });
            }

            if (!session.patternDetectedThisTurn && isBlocking(fullTurnText)) {
              const blockingPattern = patterns.find((p) => p.key === 'QUESTION' || p.key === 'TASK_BLOCKED');
              if (blockingPattern) {
                session.patternDetectedThisTurn = true; // B4: signal Layer 1 to skip
                this.setPendingApproval(
                  session.info.conversationId,
                  blockingPattern.key as 'QUESTION' | 'TASK_BLOCKED',
                  blockingPattern.value,
                );
                const bridgeBaseUrl = `http://localhost:${config.port}`;
                eventBus.emit('session.blocking', {
                  type: 'session.blocking',
                  conversationId: session.info.conversationId,
                  sessionId: session.info.sessionId,
                  projectDir: session.info.projectDir,
                  pattern: blockingPattern.key as 'QUESTION' | 'TASK_BLOCKED',
                  text: blockingPattern.value,
                  respondUrl: `${bridgeBaseUrl}/v1/sessions/${session.info.sessionId}/input`,
                  timestamp: new Date().toISOString(),
                });
                fireBlockingWebhooks(
                  session.info.conversationId,
                  session.info.sessionId,
                  { pattern: blockingPattern.key as 'QUESTION' | 'TASK_BLOCKED', text: blockingPattern.value, detectedAt: Date.now() },
                  bridgeBaseUrl,
                );
              }
            }
          }

          // Track for --resume switching
          if (session.messagesSent === 0) session.messagesSent = 1;

          // Reset for next turn
          turnText.length = 0;
          log.debug('Interactive turn complete — waiting for next input');
          break;
        }

        case 'assistant': {
          // Parse assistant messages for tool_use blocks (e.g. AskUserQuestion)
          const msg = event['message'] as Record<string, unknown> | undefined;
          const content = msg?.['content'] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block['type'] === 'text' && typeof block['text'] === 'string') {
                turnText.push(block['text']);
                eventBus.emit('session.output', {
                  type: 'session.output',
                  conversationId: session.info.conversationId,
                  sessionId: session.info.sessionId,
                  projectDir: session.info.projectDir,
                  text: block['text'] as string,
                  timestamp: new Date().toISOString(),
                });
              }
              if (block['type'] === 'tool_use' && block['name'] === 'AskUserQuestion') {
                const input = block['input'] as Record<string, unknown> | undefined;
                const questionText = JSON.stringify(input ?? {});
                log.info({ toolUseId: block['id'], input }, 'AskUserQuestion tool_use detected');
                session.patternDetectedThisTurn = true; // B4: signal Layer 1 to skip
                this.setPendingApproval(
                  session.info.conversationId,
                  'QUESTION',
                  questionText,
                );
                const bridgeBaseUrl = `http://localhost:${config.port}`;
                eventBus.emit('session.blocking', {
                  type: 'session.blocking',
                  conversationId: session.info.conversationId,
                  sessionId: session.info.sessionId,
                  projectDir: session.info.projectDir,
                  pattern: 'QUESTION',
                  text: questionText,
                  toolUseId: block['id'] as string,
                  respondUrl: `${bridgeBaseUrl}/v1/sessions/${session.info.sessionId}/input`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
          break;
        }

        case 'user':
          // Tool results — skip, don't add to turnText
          break;

        case 'system':
        case 'message_start':
        case 'content_block_start':
        case 'content_block_stop':
        case 'message_stop':
        case 'rate_limit_event':
          break;

        default:
          log.debug({ type }, 'Unknown event type from interactive CC');
      }
    });

    rl.on('close', () => {
      log.info('Interactive stdout readline closed');
    });
  }

  private cleanupInteractive(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    if (session.interactiveRl) {
      try { session.interactiveRl.close(); } catch { /* ignore */ }
      session.interactiveRl = null;
    }
    if (session.interactiveProcess) {
      session.interactiveProcess = null;
    }
    this.clearInteractiveIdleTimer(conversationId);
    logger.debug({ conversationId }, 'Interactive session cleaned up');
  }

  private resetInteractiveIdleTimer(conversationId: string): void {
    this.clearInteractiveIdleTimer(conversationId);
    const session = this.sessions.get(conversationId);
    if (!session) return;

    session.interactiveIdleTimer = setTimeout(() => {
      logger.info({ conversationId }, 'Interactive session idle timeout (5 min) — auto-closing');
      this.closeInteractive(conversationId).catch(() => {
        this.cleanupInteractive(conversationId);
      });
    }, this.INTERACTIVE_IDLE_TIMEOUT_MS);
  }

  private clearInteractiveIdleTimer(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session?.interactiveIdleTimer) {
      clearTimeout(session.interactiveIdleTimer);
      session.interactiveIdleTimer = null;
    }
  }

  /**
   * Find a conversation by session UUID (reverse lookup).
   * Useful when you only know the CC session-id, not the bridge conversation-id.
   */
  findBySessionId(sessionId: string): string | null {
    for (const [convId, session] of this.sessions) {
      if (session.info.sessionId === sessionId) return convId;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Public: list CC sessions on disk (all projects or specific)
  // -------------------------------------------------------------------------

  /**
   * Encode a project directory path to CC's session directory name.
   * CC uses the path with '/' replaced by '-' and strips trailing dashes.
   * Examples: /home/ayaz/ → -home-ayaz, /home/ayaz → -home-ayaz
   */
  private encodeProjectDir(projectDir: string): string {
    return projectDir.replace(/\//g, '-').replace(/-+$/, '');
  }

  /**
   * Get the CC sessions base directory for a project.
   */
  private getSessionsDir(projectDir: string): string {
    const home = process.env.HOME ?? '/home/ayaz';
    const encoded = this.encodeProjectDir(projectDir);
    return join(home, '.claude', 'projects', encoded);
  }

  /**
   * Check if a session ID already has a .jsonl file on CC disk.
   * This means CC has already created the session — use --resume, not --session-id.
   */
  // FIX 8 (audit): async file check — avoids blocking event loop
  private async sessionExistsOnDisk(sessionId: string, projectDir: string): Promise<boolean> {
    const sessionsDir = this.getSessionsDir(projectDir);
    const sessionFile = join(sessionsDir, `${sessionId}.jsonl`);
    try {
      await access(sessionFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all CC sessions stored on disk for a given project directory.
   * Returns session IDs with file stats (size, modification time).
   * This is the programmatic equivalent of the kitty session-listing function.
   */
  async listDiskSessions(projectDir?: string): Promise<Array<{
    sessionId: string;
    sizeBytes: number;
    lastModified: string;
    hasSubagents: boolean;
    isTracked: boolean; // true if bridge is actively tracking this session
  }>> {
    const dir = this.getSessionsDir(projectDir ?? config.defaultProjectDir);
    const results: Array<{
      sessionId: string;
      sizeBytes: number;
      lastModified: string;
      hasSubagents: boolean;
      isTracked: boolean;
    }> = [];

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        // Session files are {UUID}.jsonl
        if (!entry.endsWith('.jsonl')) continue;
        const sessionId = entry.replace('.jsonl', '');
        // Validate UUID format
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) continue;

        try {
          const filePath = join(dir, entry);
          const fileStat = await stat(filePath);
          const subagentDir = join(dir, sessionId, 'subagents');
          let hasSubagents = false;
          try { await access(subagentDir); hasSubagents = true; } catch { /* no subagents */ }

          // Check if bridge is currently tracking this session (must match both sessionId AND projectDir)
          const isTracked = Array.from(this.sessions.values()).some(
            (s) => s.info.sessionId === sessionId && s.info.projectDir === (projectDir ?? config.defaultProjectDir),
          );

          results.push({
            sessionId,
            sizeBytes: fileStat.size,
            lastModified: fileStat.mtime.toISOString(),
            hasSubagents,
            isTracked,
          });
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Directory doesn't exist — no sessions
    }

    // Sort by last modified, newest first
    results.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    return results;
  }

  // -------------------------------------------------------------------------
  // Public: circuit breaker state (for /health endpoint)
  // -------------------------------------------------------------------------

  /**
   * Get active session statistics grouped by project directory.
   * Useful for monitoring resource distribution across projects.
   */
  getProjectStats(): Array<{ projectDir: string; total: number; active: number; paused: number }> {
    const stats = new Map<string, { total: number; active: number; paused: number }>();
    for (const [, s] of this.sessions) {
      const pd = s.info.projectDir;
      const existing = stats.get(pd) ?? { total: 0, active: 0, paused: 0 };
      existing.total++;
      if (s.activeProcess) existing.active++;
      if (s.paused) existing.paused++;
      stats.set(pd, existing);
    }
    return [...stats.entries()].map(([projectDir, s]) => ({ projectDir, ...s }));
  }

  /**
   * MON-02: Returns session details for a specific project directory.
   * Status derived from: isProcessAlive() -> 'active', paused -> 'paused', else -> 'idle'.
   */
  getProjectSessionDetails(projectDir: string): ProjectSessionDetail[] {
    const result: ProjectSessionDetail[] = [];
    for (const [, s] of this.sessions) {
      if (s.info.projectDir !== projectDir) continue;
      let status: 'active' | 'paused' | 'idle';
      if (isProcessAlive(s.activeProcess?.pid)) {
        status = 'active';
      } else if (s.paused) {
        status = 'paused';
      } else {
        status = 'idle';
      }
      result.push({
        sessionId: s.info.sessionId,
        conversationId: s.info.conversationId,
        status,
        tokens: { input: 0, output: s.info.tokensUsed },
        projectDir: s.info.projectDir,
        createdAt: s.info.lastActivity.toISOString(),
      });
    }
    return result;
  }

  /**
   * MON-03: Returns aggregated resource metrics per project.
   * Combines getProjectStats() session counts with getProjectMetrics() spawn/duration data
   * and per-project token sums from sessions.
   */
  getProjectResourceMetrics(): ProjectResourceMetrics[] {
    // Aggregate tokens from sessions
    const tokensByProject = new Map<string, number>();
    const sessionCountByProject = new Map<string, number>();
    for (const [, s] of this.sessions) {
      const pd = s.info.projectDir;
      tokensByProject.set(pd, (tokensByProject.get(pd) ?? 0) + s.info.tokensUsed);
      sessionCountByProject.set(pd, (sessionCountByProject.get(pd) ?? 0) + 1);
    }

    // Merge with per-project metrics (spawn count, active duration)
    const projectMetrics = getProjectMetrics();
    const result = new Map<string, ProjectResourceMetrics>();

    // Start with projects that have spawn metrics
    for (const pm of projectMetrics) {
      result.set(pm.projectDir, {
        projectDir: pm.projectDir,
        totalTokens: tokensByProject.get(pm.projectDir) ?? 0,
        spawnCount: pm.spawnCount,
        activeDurationMs: pm.activeDurationMs,
        sessionCount: sessionCountByProject.get(pm.projectDir) ?? 0,
      });
    }

    // Also include projects that have sessions but no spawn metrics yet
    for (const [pd, count] of sessionCountByProject) {
      if (!result.has(pd)) {
        result.set(pd, {
          projectDir: pd,
          totalTokens: tokensByProject.get(pd) ?? 0,
          spawnCount: 0,
          activeDurationMs: 0,
          sessionCount: count,
        });
      }
    }

    return [...result.values()];
  }

  /**
   * Returns aggregate circuit breaker state across all sessions.
   * Reports "open" if any session CB is open (worst-case for /health visibility).
   */
  getCircuitBreakerState(): { failures: number; state: string; openedAt: Date | null } {
    let worstState: 'closed' | 'open' | 'half-open' = 'closed';
    let maxFailures = 0;
    let earliestOpen: Date | null = null;

    for (const s of this.sessions.values()) {
      const m = s.circuitBreaker.getMetrics();
      if (m.failures > maxFailures) maxFailures = m.failures;
      if (m.state === 'open') {
        worstState = 'open';
        const openedAt = m.openedAt !== null ? new Date(m.openedAt) : null;
        if (!earliestOpen || (openedAt && openedAt < earliestOpen)) {
          earliestOpen = openedAt;
        }
      } else if (m.state === 'half-open' && worstState !== 'open') {
        worstState = 'half-open';
      }
    }
    return { failures: maxFailures, state: worstState, openedAt: earliestOpen };
  }

  // -------------------------------------------------------------------------
  // Internal: circuit breaker (per-session)
  // -------------------------------------------------------------------------

  private checkCircuitBreaker(session: Session): void {
    if (!session.circuitBreaker.canExecute()) {
      const metrics = session.circuitBreaker.getMetrics();
      throw new Error(`Circuit breaker OPEN — too many CC spawn failures (${metrics.failures}). Retry later.`);
    }
    if (session.circuitBreaker.getState() !== 'closed') {
      logger.info({ conversationId: session.info.conversationId, state: session.circuitBreaker.getState() }, 'Session circuit breaker probing (half-open)');
    }
  }

  private recordCircuitBreakerSuccess(session: Session): void {
    const prevState = session.circuitBreaker.getState();
    session.circuitBreaker.recordSuccess();
    if (prevState !== 'closed' && session.circuitBreaker.getState() === 'closed') {
      logger.info({ conversationId: session.info.conversationId, previousState: prevState }, 'Session circuit breaker → closed (recovered)');
    }
    // Propagate to tier-2 and tier-3
    globalCb.recordSuccess();
    projectCbRegistry.get(session.info.projectDir).recordSuccess();
  }

  private recordCircuitBreakerFailure(session: Session): void {
    session.circuitBreaker.recordFailure();
    const metrics = session.circuitBreaker.getMetrics();
    if (metrics.state === 'open') {
      logger.error({ conversationId: session.info.conversationId, failures: metrics.failures }, 'Session circuit breaker OPEN — CC spawn failures exceeded threshold');
    }
    // Propagate to tier-2 and tier-3
    globalCb.recordFailure();
    projectCbRegistry.get(session.info.projectDir).recordFailure();
  }

  // -------------------------------------------------------------------------
  // Internal: spawn one CC process for one message
  // -------------------------------------------------------------------------

  /**
   * SDK path: USE_SDK_SESSION=true + isSdkAvailable() → use SdkSessionWrapper.
   * Graceful fallback: if SDK unavailable → warn + fall through to CLI spawn.
   * If SDK throws after yielding → yields error chunk (no partial-output retry).
   */
  private async *runWithSdk(
    session: Session,
    message: string,
    log: ReturnType<typeof logger.child>,
  ): AsyncGenerator<StreamChunk> {
    incrementSpawnCount();
    incrementProjectSpawn(session.info.projectDir);

    try {
      // Reuse wrapper across messages in same conversation (single long-lived stub/session)
      if (!session.sdkSession || !session.sdkSession.isAlive()) {
        session.sdkSession = new SdkSessionWrapper();
        await session.sdkSession.create({ projectDir: session.info.projectDir });
        log.info({ sessionId: session.info.sessionId }, 'SDK session wrapper created');
      }

      for await (const chunk of session.sdkSession.send(message)) {
        yield chunk;
      }

      session.messagesSent++;
      incrementSpawnSuccess();
      this.recordCircuitBreakerSuccess(session);
      log.info({ sessionId: session.info.sessionId }, 'SDK session message complete');
    } catch (err) {
      log.error({ err, sessionId: session.info.sessionId }, 'SDK session error');
      // Clean up failed wrapper so next message can retry
      if (session.sdkSession) {
        await session.sdkSession.terminate().catch(() => {});
        session.sdkSession = undefined;
      }
      yield { type: 'error', error: `SDK session failed: ${String(err)}` };
    }
  }

  private async *runClaude(
    session: Session,
    message: string,
    systemPrompt: string | undefined,
    log: ReturnType<typeof logger.child>,
  ): AsyncGenerator<StreamChunk> {
    // SDK path: USE_SDK_SESSION=true + SDK available → bypass CLI spawn
    if (process.env.USE_SDK_SESSION === 'true') {
      if (isSdkAvailable()) {
        log.info({ sessionId: session.info.sessionId }, 'SDK session active');
        yield* this.runWithSdk(session, message, log);
        return;
      }
      log.warn(
        { sessionId: session.info.sessionId },
        'USE_SDK_SESSION=true but @anthropic-ai/claude-agent-sdk not available — falling back to CLI spawn',
      );
    }

    // Circuit breaker: reject immediately if too many recent failures (per-session)
    this.checkCircuitBreaker(session);

    incrementSpawnCount(); // Bug #11: track every spawn attempt
    incrementProjectSpawn(session.info.projectDir); // MON-03: per-project spawn tracking

    // Interactive-backed execution: spawn CC with stdin open, bridge EventBus → StreamChunk
    yield* this.runViaInteractive(session, message, systemPrompt, log);
  }

  // -------------------------------------------------------------------------
  // Internal: interactive-backed CC execution
  // -------------------------------------------------------------------------

  /**
   * Run a CC message via interactive mode.
   * Starts an interactive session, writes the message, yields StreamChunks
   * from EventBus events, and auto-closes after result.
   *
   * This replaces the old spawn-per-message CLI path (stdin.end() immediately).
   * Advantages: stdin stays open so CC can receive follow-up input (e.g. AskUserQuestion
   * responses via respond_cc), and process stays alive for multi-turn conversations.
   */
  private async *runViaInteractive(
    session: Session,
    message: string,
    systemPrompt: string | undefined,
    log: ReturnType<typeof logger.child>,
  ): AsyncGenerator<StreamChunk> {
    const convId = session.info.conversationId;
    session.patternDetectedThisTurn = false; // B4: reset for this send() invocation
    const spawnStart = Date.now();

    // Async queue: EventBus events → StreamChunk yields
    const chunks: StreamChunk[] = [];
    let waitResolve: (() => void) | null = null;
    let finished = false;
    let firstChunkMs: number | null = null;

    const wake = () => {
      if (waitResolve) { const r = waitResolve; waitResolve = null; r(); }
    };

    const onOutput = (evt: { conversationId: string; text: string }) => {
      if (evt.conversationId !== convId) return;
      if (firstChunkMs === null) firstChunkMs = Date.now() - spawnStart;
      chunks.push({ type: 'text', text: evt.text });
      wake();
    };

    const onDone = (evt: { conversationId: string; usage?: { input_tokens: number; output_tokens: number } }) => {
      if (evt.conversationId !== convId) return;
      if (finished) return; // Ignore duplicate (exit handler fires session.done again)
      chunks.push({ type: 'done', usage: evt.usage });
      finished = true;
      wake();
    };

    const onError = (evt: { conversationId: string; error: string }) => {
      if (evt.conversationId !== convId) return;
      if (finished) return;
      chunks.push({ type: 'error', error: evt.error });
      finished = true;
      wake();
    };

    // Set up listeners BEFORE starting interactive to avoid race
    eventBus.on('session.output', onOutput);
    eventBus.on('session.done', onDone);
    eventBus.on('session.error', onError);

    let resultReceived = false;
    let hardTimedOut = false;

    const hardTimeoutMs = config.ccSpawnTimeoutMs ?? 900_000;
    const hardTimeout = setTimeout(() => {
      if (!finished) {
        log.error({ convId, hardTimeoutMs }, 'Interactive CC hard timeout — forcing termination');
        chunks.push({ type: 'error', error: `Interactive CC timed out after ${hardTimeoutMs}ms` });
        hardTimedOut = true;
        finished = true;
        wake();
      }
    }, hardTimeoutMs);

    try {
      await this.startInteractive(convId, {
        projectDir: session.info.projectDir,
        sessionId: session.info.sessionId,
        systemPrompt,
      });

      const wrote = this.writeToSession(convId, message);
      if (!wrote) {
        yield { type: 'error', error: 'Failed to write message to interactive session' };
        return;
      }

      // Yield chunks until finished
      while (!finished) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          await new Promise<void>((r) => { waitResolve = r; });
        }
      }

      // Drain remaining chunks
      while (chunks.length > 0) {
        yield chunks.shift()!;
      }

      if (!hardTimedOut) {
        resultReceived = true;
        incrementSpawnSuccess();
        this.recordCircuitBreakerSuccess(session);
      }
    } catch (err) {
      incrementSpawnErrors();
      this.recordCircuitBreakerFailure(session);
      yield { type: 'error', error: `Interactive CC failed: ${String(err)}` };
    } finally {
      clearTimeout(hardTimeout);
      eventBus.off('session.output', onOutput);
      eventBus.off('session.done', onDone);
      eventBus.off('session.error', onError);

      await this.closeInteractive(convId);

      const totalMs = Date.now() - spawnStart;
      log.info({ spawnStart, firstChunkMs, totalMs }, 'Interactive CC session timing');
      recordDuration(totalMs);
      if (firstChunkMs !== null) recordFirstChunk(firstChunkMs);
      recordProjectActiveDuration(session.info.projectDir, totalMs);

      // Bug #14: timeout/error desync — if result not received but session is on disk,
      // switch to --resume mode to avoid "Session ID already in use" on next message
      if (!resultReceived) {
        const onDisk = await this.sessionExistsOnDisk(session.info.sessionId, session.info.projectDir);
        if (onDisk && session.messagesSent === 0) {
          session.messagesSent = 1;
          log.info({ sessionId: session.info.sessionId }, 'Post-failure disk check: session on disk, switching to --resume mode');
        }
      }

      // WORK-04: Auto-merge worktree on session message done (if worktree was created)
      if (session.info.worktreeName) {
        const worktreeName = session.info.worktreeName;
        const originalProjectDir = session.info.worktreePath
          ? session.info.worktreePath.replace(`/.claude/worktrees/${worktreeName}`, '')
          : session.info.projectDir;
        try {
          const mergeResult = await worktreeManager.mergeBack(originalProjectDir, worktreeName, { deleteAfter: false });
          if (mergeResult.success) {
            eventBus.emit('worktree.merged', {
              type: 'worktree.merged',
              projectDir: originalProjectDir,
              name: worktreeName,
              branch: session.info.worktreeBranch ?? '',
              strategy: mergeResult.strategy as 'fast-forward' | 'merge-commit',
              commitHash: mergeResult.commitHash,
              timestamp: new Date().toISOString(),
            });
            await worktreeManager.remove(originalProjectDir, worktreeName);
            eventBus.emit('worktree.removed', {
              type: 'worktree.removed',
              projectDir: originalProjectDir,
              name: worktreeName,
              timestamp: new Date().toISOString(),
            });
            session.info.worktreeName = undefined;
            session.info.worktreePath = undefined;
            session.info.worktreeBranch = undefined;
            session.info.projectDir = originalProjectDir;
            log.info({ worktreeName, originalProjectDir }, 'Auto-merged and removed worktree after session done');
          } else {
            eventBus.emit('worktree.conflict', {
              type: 'worktree.conflict',
              projectDir: originalProjectDir,
              name: worktreeName,
              branch: session.info.worktreeBranch ?? '',
              conflictFiles: mergeResult.conflictFiles ?? [],
              timestamp: new Date().toISOString(),
            });
            log.warn({ worktreeName, conflictFiles: mergeResult.conflictFiles }, 'Auto-merge conflict — worktree preserved for manual resolution');
          }
        } catch (err) {
          log.error({ err, conversationId: convId, worktreeName }, 'Auto-merge failed after session done');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal: idle timer
  // -------------------------------------------------------------------------

  private resetIdleTimer(conversationId: string): void {
    this.clearIdleTimer(conversationId);
    const session = this.sessions.get(conversationId);
    if (!session) return;

    session.idleTimer = setTimeout(() => {
      logger.info({ conversationId }, 'Session idle timeout — removing session metadata');
      this.terminate(conversationId);
    }, config.idleTimeoutMs);
  }

  private clearIdleTimer(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session?.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }
}

// Singleton instance
export const claudeManager = new ClaudeManager();
