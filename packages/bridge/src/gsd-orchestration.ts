/**
 * GSD Orchestration Service
 *
 * Manages GSD session lifecycle — triggering, tracking state, and applying
 * config overrides. Routes in Plan 04-02 use this service as the business logic layer.
 *
 * Architecture:
 *   - trigger() is fire-and-forget: returns GsdSessionState{status:'pending'} immediately
 *   - The async CC stream drains in a setImmediate callback (no blocking)
 *   - Synchronous per-project quota check happens BEFORE setImmediate (so callers get 429 fast)
 *   - Sessions stored in an in-memory Map — ephemeral, no persistence
 */

import { randomUUID } from 'node:crypto';
import { claudeManager } from './claude-manager.ts';
import { buildSystemPrompt } from './gsd-adapter.ts';
import { eventBus } from './event-bus.ts';
import { logger } from './utils/logger.ts';
import type { GsdSessionState, GsdTriggerRequest, GsdProgressState } from './types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_PER_PROJECT = 5;

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class GsdOrchestrationService {
  private readonly sessions = new Map<string, GsdSessionState>();
  private readonly progress = new Map<string, GsdProgressState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup every 10 minutes (P0-1)
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Remove completed/failed sessions older than the retention window (P0-1).
   * Retention window configured via GSD_SESSION_RETENTION_MS env var (default 1 hour).
   */
  cleanup(): void {
    const retention = Number(process.env.GSD_SESSION_RETENTION_MS) || 3_600_000;
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status !== 'completed' && session.status !== 'failed') continue;
      const completedAt = session.completedAt ? new Date(session.completedAt).getTime() : null;
      if (completedAt !== null && (now - completedAt) > retention) {
        this.sessions.delete(id);
        this.progress.delete(id);
      }
    }
  }

  /** Stop the cleanup interval (P0-1). Call on server shutdown. */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Trigger a new GSD session.
   *
   * STEP A: Synchronous quota pre-check — throws PROJECT_CONCURRENT_LIMIT if full.
   * STEP B: Session setup — creates state, builds system prompt, applies config overrides.
   * STEP C: Fire-and-forget — drains CC stream in setImmediate, updating state.
   *
   * Returns the initial GsdSessionState (status='pending') before the stream starts.
   */
  async trigger(projectDir: string, req: GsdTriggerRequest): Promise<GsdSessionState> {
    // -------------------------------------------------------------------------
    // STEP A — Synchronous quota pre-check (BEFORE setImmediate)
    // -------------------------------------------------------------------------
    const activeSessions = this.listActive(projectDir);
    if (activeSessions.length >= MAX_CONCURRENT_PER_PROJECT) {
      throw Object.assign(
        new Error(`Project concurrent limit exceeded for ${projectDir} (${activeSessions.length}/${MAX_CONCURRENT_PER_PROJECT} active GSD sessions)`),
        { code: 'PROJECT_CONCURRENT_LIMIT' }
      );
    }

    // -------------------------------------------------------------------------
    // STEP B — Session setup
    // -------------------------------------------------------------------------
    const gsdSessionId = 'gsd-' + randomUUID();
    const conversationId = 'gsd-' + randomUUID();
    const args = req.args ?? {};

    // Create initial state and register it
    const state: GsdSessionState = {
      gsdSessionId,
      conversationId,
      projectDir,
      command: req.command,
      args,
      status: 'pending',
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(gsdSessionId, state);

    const log = logger.child({ gsdSessionId, command: req.command, projectDir });
    log.info('GSD session created');

    // Build system prompt (async — happens before fire-and-forget block)
    const systemPrompt = await buildSystemPrompt(req.command, projectDir);

    // Build user message
    const argsStr = Object.keys(args).length > 0 ? ' ' + JSON.stringify(args) : '';
    const userMessage = `Run GSD command: ${req.command}${argsStr}`;

    // Apply config overrides if provided
    if (req.config) {
      claudeManager.setConfigOverrides(conversationId, req.config);
    }

    // -------------------------------------------------------------------------
    // STEP C — Fire-and-forget: drain CC stream in next event loop tick
    // -------------------------------------------------------------------------
    setImmediate(async () => {
      // Transition to running
      state.status = 'running';
      log.info('GSD session running');

      // Initialize progress state
      const progressState: GsdProgressState = {
        gsdSessionId,
        projectDir,
        command: req.command,
        status: 'running',
        startedAt: state.startedAt,
        phaseNumber: 0,
        plansCompleted: 0,
        plansTotal: 0,
        completionPercent: 0,
      };
      this.progress.set(gsdSessionId, progressState);

      // Emit gsd.phase_started
      eventBus.emit('gsd.phase_started', {
        type: 'gsd.phase_started',
        gsdSessionId,
        projectDir,
        command: req.command,
        timestamp: new Date().toISOString(),
      });

      let errorMessage: string | undefined;
      const runStartTime = Date.now();

      try {
        const stream = claudeManager.send(conversationId, userMessage, projectDir, systemPrompt);
        for await (const chunk of stream) {
          if (chunk.type === 'error') {
            errorMessage = chunk.error;
            // Continue draining — don't break (CC may still emit done)
          }
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        log.error({ err }, 'GSD CC stream threw an error');
      }

      // Transition to completed or failed
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - runStartTime;
      if (errorMessage !== undefined) {
        state.status = 'failed';
        state.error = errorMessage;
        state.completedAt = completedAt;
        progressState.status = 'failed';
        progressState.completedAt = completedAt;
        log.warn({ error: errorMessage }, 'GSD session failed');
        eventBus.emit('gsd.phase_error', {
          type: 'gsd.phase_error',
          gsdSessionId,
          projectDir,
          command: req.command,
          error: errorMessage,
          timestamp: completedAt,
        });
      } else {
        state.status = 'completed';
        state.completedAt = completedAt;
        progressState.status = 'completed';
        progressState.completedAt = completedAt;
        progressState.completionPercent = 100;
        log.info('GSD session completed');
        eventBus.emit('gsd.phase_completed', {
          type: 'gsd.phase_completed',
          gsdSessionId,
          projectDir,
          command: req.command,
          planNumber: 0,
          durationMs,
          commitHash: '',
          timestamp: completedAt,
        });
      }
    });

    // Return the initial pending state before the stream starts
    return state;
  }

  /**
   * Get the current GsdSessionState for a given session ID.
   * Returns undefined if the session is not found.
   */
  getStatus(gsdSessionId: string): GsdSessionState | undefined {
    return this.sessions.get(gsdSessionId);
  }

  /**
   * Get the live progress state for a given GSD session ID.
   * Returns undefined if the session has not started (no progress initialized yet).
   */
  getProgress(gsdSessionId: string): GsdProgressState | undefined {
    return this.progress.get(gsdSessionId);
  }

  /**
   * List all active sessions (status 'pending' or 'running').
   * Optionally filter by projectDir.
   */
  listActive(projectDir?: string): GsdSessionState[] {
    const active: GsdSessionState[] = [];
    for (const session of this.sessions.values()) {
      if (session.status !== 'pending' && session.status !== 'running') continue;
      if (projectDir !== undefined && session.projectDir !== projectDir) continue;
      active.push(session);
    }
    return active;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const gsdOrchestration = new GsdOrchestrationService();
