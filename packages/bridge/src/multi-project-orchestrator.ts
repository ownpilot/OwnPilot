/**
 * Multi-Project Orchestrator (H6)
 *
 * Manages parallel GSD execution across multiple projects with dependency-aware
 * wave scheduling. Uses dependency-graph.ts for topological sort + wave assignment.
 *
 * Architecture:
 *   - trigger() is fire-and-forget: returns MultiProjectState{status:'pending'} immediately
 *   - runOrchestration() executes wave-by-wave in setImmediate callback
 *   - Each wave: projects with no outstanding dependencies run in parallel
 *   - A failed project marks all dependents as 'cancelled'
 *   - Final status: 'completed' | 'partial' | 'failed'
 *
 * SSE events: multi_project.started → wave_started → project_started →
 *             project_completed/failed/cancelled → completed
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { assignWaves, validateGraph } from './dependency-graph.ts';
import type { DependencyNode, WaveAssignment } from './dependency-graph.ts';
import { gsdOrchestration } from './gsd-orchestration.ts';
import { eventBus } from './event-bus.ts';
import { logger } from './utils/logger.ts';
import type {
  MultiProjectItem,
  MultiProjectState,
  MultiProjectProjectState,
} from './types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = Number(process.env.MULTI_ORCH_POLL_MS) || 5_000;
const DEFAULT_TIMEOUT_MS = Number(process.env.MULTI_ORCH_TIMEOUT_MS) || 60 * 60 * 1_000;

// Resolved (internal) form of a MultiProjectItem — all optional fields filled in
interface ResolvedItem {
  id: string;
  dir: string;
  command: string;
  phase?: number;
  args: Record<string, unknown>;
  depends_on: string[];
}

// ---------------------------------------------------------------------------
// MultiProjectOrchestrator
// ---------------------------------------------------------------------------

export class MultiProjectOrchestrator {
  private readonly sessions = new Map<string, MultiProjectState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options?: { pollIntervalMs?: number; timeoutMs?: number }) {
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /** Remove completed/failed sessions older than retention window. */
  cleanup(): void {
    const retention = Number(process.env.MULTI_ORCH_RETENTION_MS) || 3_600_000;
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status === 'pending' || session.status === 'running') continue;
      const completedAt = session.completedAt ? new Date(session.completedAt).getTime() : null;
      if (completedAt !== null && now - completedAt > retention) {
        this.sessions.delete(id);
      }
    }
  }

  /** Stop cleanup interval. Call on server shutdown. */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Trigger a multi-project orchestration.
   *
   * Validates the dependency graph synchronously (throws on error),
   * then returns pending state immediately. Pipeline runs asynchronously.
   */
  async trigger(items: MultiProjectItem[]): Promise<MultiProjectState> {
    if (items.length === 0) {
      throw new Error('At least one project item is required');
    }

    // Resolve IDs (fill defaults)
    const resolved: ResolvedItem[] = items.map((item, i) => ({
      ...item,
      id: item.id ?? (basename(item.dir) || `project-${i}`),
      args: item.args ?? {},
      depends_on: item.depends_on ?? [],
    }));

    // Build dependency nodes
    const nodes: DependencyNode[] = resolved.map((item) => ({
      id: item.id,
      dependsOn: item.depends_on,
    }));

    // Validate graph (throws on duplicate IDs, missing refs, self-refs)
    const validation = validateGraph(nodes);
    if (!validation.valid) {
      throw Object.assign(
        new Error(`Invalid dependency graph: ${validation.errors.join('; ')}`),
        { code: 'INVALID_DEPENDENCY_GRAPH', errors: validation.errors },
      );
    }

    // Assign waves (throws on cycle)
    const waves = assignWaves(nodes);

    // Build per-project states
    const projectStates: MultiProjectProjectState[] = resolved.map((item) => {
      const wave = waves.find((w) => w.nodeIds.includes(item.id))!.wave;
      return {
        id: item.id,
        dir: item.dir,
        command: item.command,
        wave,
        status: 'pending',
      };
    });

    const multiOrchId = 'multi-orch-' + randomUUID();
    const state: MultiProjectState = {
      multiOrchId,
      status: 'pending',
      projects: projectStates,
      totalWaves: waves.length,
      currentWave: 0,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(multiOrchId, state);

    // Fire-and-forget
    setImmediate(() => {
      void this.runOrchestration(multiOrchId, resolved, waves);
    });

    return state;
  }

  /** Get state by ID. */
  getById(multiOrchId: string): MultiProjectState | undefined {
    return this.sessions.get(multiOrchId);
  }

  /** List all sessions. */
  listAll(): MultiProjectState[] {
    return [...this.sessions.values()];
  }

  // ---------------------------------------------------------------------------
  // Private: pipeline
  // ---------------------------------------------------------------------------

  private async runOrchestration(
    multiOrchId: string,
    items: ResolvedItem[],
    waves: WaveAssignment[],
  ): Promise<void> {
    const state = this.sessions.get(multiOrchId);
    if (!state) return;

    const log = logger.child({ multiOrchId });
    state.status = 'running';

    log.info({ totalWaves: waves.length, projectCount: items.length }, 'Multi-project orchestration started');

    eventBus.emit('multi_project.started', {
      type: 'multi_project.started',
      multiOrchId,
      projectCount: items.length,
      totalWaves: waves.length,
      timestamp: state.startedAt,
    });

    const failedIds = new Set<string>();

    for (const wave of waves) {
      state.currentWave = wave.wave;

      log.info({ wave: wave.wave, projects: wave.nodeIds }, 'Starting wave');

      eventBus.emit('multi_project.wave_started', {
        type: 'multi_project.wave_started',
        multiOrchId,
        wave: wave.wave,
        projects: wave.nodeIds,
        timestamp: new Date().toISOString(),
      });

      // Execute all projects in this wave in parallel
      const wavePromises = wave.nodeIds.map((projectId) =>
        this.runProject(multiOrchId, projectId, items, failedIds),
      );

      await Promise.all(wavePromises);
    }

    // Determine final status
    const completedAt = new Date().toISOString();
    state.completedAt = completedAt;

    const completedCount = state.projects.filter((p) => p.status === 'completed').length;
    const failedCount = state.projects.filter((p) => p.status === 'failed').length;
    const cancelledCount = state.projects.filter((p) => p.status === 'cancelled').length;

    if (failedCount === 0 && cancelledCount === 0) {
      state.status = 'completed';
    } else if (completedCount > 0) {
      state.status = 'partial';
    } else {
      state.status = 'failed';
    }

    log.info({ status: state.status, completedCount, failedCount, cancelledCount }, 'Multi-project orchestration finished');

    eventBus.emit('multi_project.completed', {
      type: 'multi_project.completed',
      multiOrchId,
      status: state.status,
      completedCount,
      failedCount,
      cancelledCount,
      timestamp: completedAt,
    });
  }

  private async runProject(
    multiOrchId: string,
    projectId: string,
    items: ResolvedItem[],
    failedIds: Set<string>,
  ): Promise<void> {
    const state = this.sessions.get(multiOrchId)!;
    const projectState = state.projects.find((p) => p.id === projectId)!;
    const item = items.find((i) => i.id === projectId)!;

    const log = logger.child({ multiOrchId, projectId });

    // Check if any dependency failed → cancel this project
    const failedDep = item.depends_on.find((dep) => failedIds.has(dep));
    if (failedDep) {
      projectState.status = 'cancelled';
      projectState.completedAt = new Date().toISOString();

      log.warn({ failedDep }, 'Project cancelled due to dependency failure');

      eventBus.emit('multi_project.project_cancelled', {
        type: 'multi_project.project_cancelled',
        multiOrchId,
        projectId,
        dir: item.dir,
        reason: `Dependency "${failedDep}" failed`,
        timestamp: projectState.completedAt,
      });
      return;
    }

    // Mark running
    projectState.status = 'running';
    projectState.startedAt = new Date().toISOString();

    // Build GSD command string
    const gsdCommand =
      item.phase !== undefined ? `${item.command} ${item.phase}` : item.command;

    eventBus.emit('multi_project.project_started', {
      type: 'multi_project.project_started',
      multiOrchId,
      projectId,
      dir: item.dir,
      command: gsdCommand,
      wave: projectState.wave,
      timestamp: projectState.startedAt,
    });

    try {
      // Trigger GSD session
      const gsdState = await gsdOrchestration.trigger(item.dir, {
        command: gsdCommand,
        args: item.args,
      });

      projectState.gsdSessionId = gsdState.gsdSessionId;

      // Poll until completed or failed
      await this.pollUntilDone(gsdState.gsdSessionId, multiOrchId, projectId);

      const finalGsd = gsdOrchestration.getStatus(gsdState.gsdSessionId);

      if (finalGsd?.status === 'completed') {
        projectState.status = 'completed';
        projectState.completedAt = finalGsd.completedAt ?? new Date().toISOString();

        log.info('Project completed');

        eventBus.emit('multi_project.project_completed', {
          type: 'multi_project.project_completed',
          multiOrchId,
          projectId,
          dir: item.dir,
          gsdSessionId: gsdState.gsdSessionId,
          timestamp: projectState.completedAt,
        });
      } else {
        const err = finalGsd?.error ?? 'GSD session did not complete successfully';
        projectState.status = 'failed';
        projectState.error = err;
        projectState.completedAt = finalGsd?.completedAt ?? new Date().toISOString();
        failedIds.add(projectId);

        log.error({ err }, 'Project failed');

        eventBus.emit('multi_project.project_failed', {
          type: 'multi_project.project_failed',
          multiOrchId,
          projectId,
          dir: item.dir,
          error: err,
          timestamp: projectState.completedAt,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      projectState.status = 'failed';
      projectState.error = errMsg;
      projectState.completedAt = new Date().toISOString();
      failedIds.add(projectId);

      log.error({ err }, 'Project trigger failed');

      eventBus.emit('multi_project.project_failed', {
        type: 'multi_project.project_failed',
        multiOrchId,
        projectId,
        dir: item.dir,
        error: errMsg,
        timestamp: projectState.completedAt,
      });
    }
  }

  /** Poll gsdOrchestration.getStatus() until session completes or times out. */
  private pollUntilDone(
    gsdSessionId: string,
    multiOrchId: string,
    projectId: string,
  ): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    const pollMs = this.pollIntervalMs;
    const log = logger.child({ multiOrchId, projectId, gsdSessionId });

    return new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (Date.now() > deadline) {
          reject(
            new Error(
              `Timeout waiting for GSD session ${gsdSessionId} after ${this.timeoutMs}ms`,
            ),
          );
          return;
        }

        const session = gsdOrchestration.getStatus(gsdSessionId);
        if (!session) {
          // Session not found yet (race condition on trigger) — retry
          setTimeout(check, pollMs);
          return;
        }

        if (session.status === 'completed' || session.status === 'failed') {
          log.info({ finalStatus: session.status }, 'GSD session finished');
          resolve();
          return;
        }

        setTimeout(check, pollMs);
      };

      check();
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const multiProjectOrchestrator = new MultiProjectOrchestrator();
