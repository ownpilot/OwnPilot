/**
 * Subagent Manager
 *
 * In-memory manager for ephemeral subagent lifecycle:
 * - Spawn: creates runner, starts execution in background
 * - Track: maintains active sessions in memory
 * - Cancel: aborts running subagents
 * - Budget: enforces per-parent concurrency and total limits
 * - Events: emits progress/completion via EventBus
 * - Cleanup: removes completed sessions after TTL
 *
 * Unlike BackgroundAgentManager, this doesn't do scheduling —
 * subagents run once to completion.
 */

import { generateId, getEventSystem, getErrorMessage } from '@ownpilot/core';
import type {
  SpawnSubagentInput,
  SubagentSession,
  SubagentLimits,
  SubagentBudget,
  ToolCall,
} from '@ownpilot/core';
import {
  DEFAULT_SUBAGENT_LIMITS,
  DEFAULT_SUBAGENT_BUDGET,
  MAX_SUBAGENT_DEPTH,
} from '@ownpilot/core';
import { SubagentRunner } from './subagent-runner.js';
import { SubagentsRepository } from '../db/repositories/subagents.js';
import { getLog } from './log.js';

const log = getLog('SubagentManager');

// ============================================================================
// Constants
// ============================================================================

/** How long to keep completed sessions in memory (30 min) */
const COMPLETED_SESSION_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval (5 min) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

interface ManagedSubagent {
  session: SubagentSession;
  runner: SubagentRunner;
}

// ============================================================================
// Manager
// ============================================================================

export class SubagentManager {
  private sessions = new Map<string, ManagedSubagent>();
  private parentIndex = new Map<string, Set<string>>();
  private spawnCounts = new Map<string, number>();
  private budget: SubagentBudget;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private repo: SubagentsRepository;

  constructor(budget?: Partial<SubagentBudget>, repo?: SubagentsRepository) {
    this.budget = { ...DEFAULT_SUBAGENT_BUDGET, ...budget };
    this.repo = repo ?? new SubagentsRepository();
    // Defer cleanup start to allow EventSystem and other services to initialize
    setImmediate(() => this.startCleanup());
  }

  /**
   * Spawn a new subagent. Starts execution immediately in background.
   */
  async spawn(input: SpawnSubagentInput): Promise<SubagentSession> {
    // 1. Nesting depth check
    const depth = input._depth ?? 0;
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`Subagent nesting depth limit reached (max: ${MAX_SUBAGENT_DEPTH})`);
    }

    // 2. Budget checks
    const parentSubs = this.parentIndex.get(input.parentId);
    const activeSubs = parentSubs
      ? [...parentSubs].filter((id) => {
          const s = this.sessions.get(id);
          return s && (s.session.state === 'pending' || s.session.state === 'running');
        })
      : [];

    if (activeSubs.length >= this.budget.maxConcurrent) {
      throw new Error(
        `Concurrent subagent limit reached (${this.budget.maxConcurrent}). Wait for running subagents to complete.`
      );
    }

    const totalSpawns = this.spawnCounts.get(input.parentId) ?? 0;
    if (totalSpawns >= this.budget.maxTotalSpawns) {
      throw new Error(
        `Total subagent spawn limit reached (${this.budget.maxTotalSpawns}) for this session.`
      );
    }

    // 3. Create session
    const id = generateId('sub');
    const limits: SubagentLimits = { ...DEFAULT_SUBAGENT_LIMITS, ...input.limits };
    const now = new Date();

    const session: SubagentSession = {
      id,
      parentId: input.parentId,
      parentType: input.parentType,
      userId: input.userId,
      name: input.name,
      task: input.task,
      state: 'pending',
      spawnedAt: now,
      startedAt: null,
      completedAt: null,
      turnsUsed: 0,
      toolCallsUsed: 0,
      tokensUsed: null,
      durationMs: null,
      result: null,
      error: null,
      toolCalls: [],
      provider: input.provider ?? 'pending',
      model: input.model ?? 'pending',
      limits,
    };

    // 4. Create runner
    const runner = new SubagentRunner(input);

    // 5. Store in maps
    const managed: ManagedSubagent = { session, runner };
    this.sessions.set(id, managed);

    if (!this.parentIndex.has(input.parentId)) {
      this.parentIndex.set(input.parentId, new Set());
    }
    this.parentIndex.get(input.parentId)!.add(id);

    this.spawnCounts.set(input.parentId, totalSpawns + 1);

    // 6. Emit spawned event
    try {
      const events = getEventSystem();
      events.emit('subagent.spawned', 'subagent-manager', {
        subagentId: id,
        parentId: input.parentId,
        parentType: input.parentType,
        userId: input.userId,
        name: input.name,
        task: input.task,
      });
    } catch {
      // Event system may not be available in tests
    }

    // 7. Start execution in background (floating promise)
    this.executeInBackground(id, managed, input);

    log.info(`Spawned subagent "${input.name}" [${id}] for parent ${input.parentId}`);

    return { ...session };
  }

  /** Get session by ID */
  getSession(subagentId: string): SubagentSession | null {
    const managed = this.sessions.get(subagentId);
    return managed ? { ...managed.session } : null;
  }

  /** List sessions for a parent */
  listByParent(parentId: string): SubagentSession[] {
    const ids = this.parentIndex.get(parentId);
    if (!ids) return [];

    return [...ids]
      .map((id) => this.sessions.get(id))
      .filter((m): m is ManagedSubagent => m !== undefined)
      .map((m) => ({ ...m.session }));
  }

  /** Cancel a running subagent */
  cancel(subagentId: string): boolean {
    const managed = this.sessions.get(subagentId);
    if (!managed) return false;

    if (managed.session.state !== 'pending' && managed.session.state !== 'running') {
      return false; // Already completed
    }

    managed.runner.cancel();
    managed.session.state = 'cancelled';
    managed.session.completedAt = new Date();
    managed.session.durationMs =
      managed.session.completedAt.getTime() - managed.session.spawnedAt.getTime();

    log.info(`Cancelled subagent "${managed.session.name}" [${subagentId}]`);

    // Persist to DB
    this.persistSession(managed.session);

    // Emit completed event
    this.emitCompleted(managed.session);

    return true;
  }

  /** Remove completed sessions older than TTL */
  cleanup(ttlMs = COMPLETED_SESSION_TTL_MS): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, managed] of this.sessions) {
      const { state, completedAt } = managed.session;
      if (
        state !== 'pending' &&
        state !== 'running' &&
        completedAt &&
        now - completedAt.getTime() > ttlMs
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const managed = this.sessions.get(id);
      if (managed) {
        const parentSubs = this.parentIndex.get(managed.session.parentId);
        parentSubs?.delete(id);
        if (parentSubs?.size === 0) {
          this.parentIndex.delete(managed.session.parentId);
          this.spawnCounts.delete(managed.session.parentId);
        }
      }
      this.sessions.delete(id);
    }

    if (toRemove.length > 0) {
      log.debug(`Cleaned up ${toRemove.length} completed subagent sessions`);
    }
  }

  /** Stop cleanup timer (for graceful shutdown) */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Get stats (for monitoring) */
  getStats(): { active: number; total: number; parents: number } {
    let active = 0;
    for (const managed of this.sessions.values()) {
      if (managed.session.state === 'pending' || managed.session.state === 'running') {
        active++;
      }
    }
    return {
      active,
      total: this.sessions.size,
      parents: this.parentIndex.size,
    };
  }

  // ---------- Private Helpers ----------

  private executeInBackground(
    id: string,
    managed: ManagedSubagent,
    input: SpawnSubagentInput
  ): void {
    // Mark as running
    managed.session.state = 'running';
    managed.session.startedAt = new Date();

    const onToolEnd = (
      tc: ToolCall,
      result: { content: string; isError: boolean; durationMs: number }
    ) => {
      managed.session.toolCallsUsed++;
      managed.session.toolCalls.push({
        tool: tc.name,
        args: safeParseJson(tc.arguments),
        result: result.content,
        success: !result.isError,
        durationMs: result.durationMs,
      });

      // Emit progress event
      try {
        const events = getEventSystem();
        events.emit('subagent.progress', 'subagent-manager', {
          subagentId: id,
          parentId: input.parentId,
          name: input.name,
          turnsUsed: managed.session.turnsUsed,
          toolCallsUsed: managed.session.toolCallsUsed,
          lastToolName: tc.name,
        });
      } catch {
        // Event system may not be available in tests
      }
    };

    // Run and handle completion
    managed.runner
      .run(onToolEnd)
      .then((result) => {
        if (managed.session.state === 'cancelled') return; // Already handled

        managed.session.state = result.success ? 'completed' : 'failed';
        managed.session.result = result.result || null;
        managed.session.error = result.error;
        managed.session.durationMs = result.durationMs;
        managed.session.turnsUsed = result.turnsUsed;
        managed.session.toolCallsUsed = result.toolCallsUsed;
        managed.session.tokensUsed = result.tokensUsed;
        managed.session.completedAt = new Date();
        managed.session.provider = result.provider;
        managed.session.model = result.model;

        // Check for timeout
        if (result.error?.includes('timed out')) {
          managed.session.state = 'timeout';
        }

        log.info(
          `Subagent "${managed.session.name}" [${id}] ${managed.session.state}: ${result.durationMs}ms`
        );

        this.persistSession(managed.session);
        this.emitCompleted(managed.session);
      })
      .catch((err) => {
        if (managed.session.state === 'cancelled') return;

        managed.session.state = 'failed';
        managed.session.error = getErrorMessage(err);
        managed.session.completedAt = new Date();
        managed.session.durationMs =
          managed.session.completedAt.getTime() - managed.session.spawnedAt.getTime();

        log.error('Subagent execution error', {
          subagentId: id,
          name: managed.session.name,
          parentId: managed.session.parentId,
          error: managed.session.error,
        });

        this.persistSession(managed.session);
        this.emitCompleted(managed.session);
      });
  }

  private persistSession(session: SubagentSession): void {
    this.repo.saveExecution(session).catch((err) => {
      log.error('Failed to persist subagent history', {
        subagentId: session.id,
        error: getErrorMessage(err),
      });
    });
  }

  private emitCompleted(session: SubagentSession): void {
    try {
      const events = getEventSystem();
      events.emit('subagent.completed', 'subagent-manager', {
        subagentId: session.id,
        parentId: session.parentId,
        userId: session.userId,
        name: session.name,
        state: session.state,
        result: session.result ?? undefined,
        error: session.error ?? undefined,
        durationMs: session.durationMs ?? 0,
        turnsUsed: session.turnsUsed,
        toolCallsUsed: session.toolCallsUsed,
      });
    } catch {
      // Event system may not be available in tests
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return; // Already started
    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanup();
      } catch (err) {
        log.error('Subagent cleanup error', { error: getErrorMessage(err) });
      }
    }, CLEANUP_INTERVAL_MS);
    // Don't keep process alive just for cleanup
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === 'object' &&
      'unref' in this.cleanupTimer
    ) {
      this.cleanupTimer.unref();
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _manager: SubagentManager | null = null;

export function getSubagentManager(): SubagentManager {
  if (!_manager) {
    _manager = new SubagentManager();
  }
  return _manager;
}

export function resetSubagentManager(): void {
  if (_manager) {
    _manager.dispose();
    _manager = null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str || '{}');
  } catch {
    return { _raw: str };
  }
}
