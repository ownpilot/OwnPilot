/**
 * Bridge-wide Typed Event Bus
 *
 * Central event system for real-time notifications.
 * ClaudeManager emits events → EventBus → SSE clients receive them.
 *
 * Event types:
 *   session.output         — CC text output chunk
 *   session.blocking       — QUESTION or TASK_BLOCKED detected
 *   session.phase_complete — PHASE_COMPLETE detected
 *   session.error          — CC error or spawn failure
 *   session.done           — CC process finished
 */

import { EventEmitter } from 'node:events';
import { replayBuffer } from './event-replay-buffer.ts';
import type { OrchestrationStage } from './types.ts';

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface SessionOutputEvent {
  type: 'session.output';
  conversationId: string;
  sessionId: string;
  projectDir?: string;
  text: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface SessionBlockingEvent {
  type: 'session.blocking';
  conversationId: string;
  sessionId: string;
  projectDir?: string;
  pattern: 'QUESTION' | 'TASK_BLOCKED';
  text: string;
  respondUrl: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface SessionPhaseCompleteEvent {
  type: 'session.phase_complete';
  conversationId: string;
  sessionId: string;
  projectDir?: string;
  pattern: 'PHASE_COMPLETE';
  text: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface SessionErrorEvent {
  type: 'session.error';
  conversationId: string;
  sessionId: string;
  projectDir?: string;
  error: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface SessionDoneEvent {
  type: 'session.done';
  conversationId: string;
  sessionId: string;
  projectDir?: string;
  usage?: { input_tokens: number; output_tokens: number };
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface WorktreeCreatedEvent {
  type: 'worktree.created';
  projectDir: string;
  name: string;
  branch: string;
  path: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface WorktreeMergedEvent {
  type: 'worktree.merged';
  projectDir: string;
  name: string;
  branch: string;
  strategy: 'fast-forward' | 'merge-commit';
  commitHash?: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface WorktreeConflictEvent {
  type: 'worktree.conflict';
  projectDir: string;
  name: string;
  branch: string;
  conflictFiles: string[];
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface WorktreeRemovedEvent {
  type: 'worktree.removed';
  projectDir: string;
  name: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface GsdPhaseStartedEvent {
  type: 'gsd.phase_started';
  gsdSessionId: string;
  projectDir: string;
  command: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface GsdPhaseCompletedEvent {
  type: 'gsd.phase_completed';
  gsdSessionId: string;
  projectDir: string;
  command: string;
  /** Plan number that just completed (0 when session-level completion) */
  planNumber: number;
  /** Duration of this plan execution in milliseconds */
  durationMs: number;
  /** Git commit hash produced by this plan (empty string if none) */
  commitHash: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface GsdPhaseErrorEvent {
  type: 'gsd.phase_error';
  gsdSessionId: string;
  projectDir: string;
  command: string;
  error: string;
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

export interface OrchStageStartedEvent {
  type: 'orch.stage_started';
  orchestrationId: string;
  projectDir: string;
  stage: OrchestrationStage;
  agentCount?: number;
  timestamp: string;
  id?: number;
}

export interface OrchStageCompletedEvent {
  type: 'orch.stage_completed';
  orchestrationId: string;
  projectDir: string;
  stage: OrchestrationStage;
  /** Stage-specific data (research: findingCount, devil_advocate: highestRisk, verify: passed) */
  data?: Record<string, unknown>;
  timestamp: string;
  id?: number;
}

export interface OrchCompletedEvent {
  type: 'orch.completed';
  orchestrationId: string;
  projectDir: string;
  startedAt: string;
  completedAt: string;
  id?: number;
}

export interface OrchFailedEvent {
  type: 'orch.failed';
  orchestrationId: string;
  projectDir: string;
  error: string;
  stage: OrchestrationStage | null;
  timestamp: string;
  id?: number;
}

export interface ProjectStatsChangedEvent {
  type: 'project.stats_changed';
  /** Project directory that changed */
  projectDir: string;
  /** Number of currently active sessions */
  active: number;
  /** Number of currently paused sessions */
  paused: number;
  /** Total sessions (active + paused + idle) */
  total: number;
  /** What triggered this stats change */
  reason: 'session_created' | 'session_terminated' | 'quota_exceeded';
  timestamp: string;
  orchestratorId?: string;
  id?: number;
}

// ---------------------------------------------------------------------------
// Multi-Project Orchestration event types (H6)
// ---------------------------------------------------------------------------

export interface MultiProjectStartedEvent {
  type: 'multi_project.started';
  multiOrchId: string;
  projectCount: number;
  totalWaves: number;
  timestamp: string;
  id?: number;
}

export interface MultiProjectWaveStartedEvent {
  type: 'multi_project.wave_started';
  multiOrchId: string;
  wave: number;
  projects: string[];
  timestamp: string;
  id?: number;
}

export interface MultiProjectProjectStartedEvent {
  type: 'multi_project.project_started';
  multiOrchId: string;
  projectId: string;
  dir: string;
  command: string;
  wave: number;
  timestamp: string;
  id?: number;
}

export interface MultiProjectProjectCompletedEvent {
  type: 'multi_project.project_completed';
  multiOrchId: string;
  projectId: string;
  dir: string;
  gsdSessionId: string;
  timestamp: string;
  id?: number;
}

export interface MultiProjectProjectFailedEvent {
  type: 'multi_project.project_failed';
  multiOrchId: string;
  projectId: string;
  dir: string;
  error: string;
  timestamp: string;
  id?: number;
}

export interface MultiProjectProjectCancelledEvent {
  type: 'multi_project.project_cancelled';
  multiOrchId: string;
  projectId: string;
  dir: string;
  reason: string;
  timestamp: string;
  id?: number;
}

export interface MultiProjectCompletedEvent {
  type: 'multi_project.completed';
  multiOrchId: string;
  status: string;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  timestamp: string;
  id?: number;
}

// Self-Reflection event types (H7)
export interface ReflectStartedEvent {
  type: 'reflect.started';
  reflectId: string;
  projectDir: string;
  scopeIn?: string;
  timestamp: string;
  id?: number;
}

export interface ReflectCheckCompletedEvent {
  type: 'reflect.check_completed';
  reflectId: string;
  projectDir: string;
  attempt: number;
  checkName: string;
  passed: boolean;
  timestamp: string;
  id?: number;
}

export interface ReflectFixStartedEvent {
  type: 'reflect.fix_started';
  reflectId: string;
  projectDir: string;
  attempt: number;
  conversationId: string;
  timestamp: string;
  id?: number;
}

export interface ReflectPassedEvent {
  type: 'reflect.passed';
  reflectId: string;
  projectDir: string;
  attemptsUsed: number;
  timestamp: string;
  id?: number;
}

export interface ReflectFailedEvent {
  type: 'reflect.failed';
  reflectId: string;
  projectDir: string;
  attemptsUsed: number;
  timestamp: string;
  id?: number;
}

export type BridgeEvent =
  | SessionOutputEvent
  | SessionBlockingEvent
  | SessionPhaseCompleteEvent
  | SessionErrorEvent
  | SessionDoneEvent
  | WorktreeCreatedEvent
  | WorktreeMergedEvent
  | WorktreeConflictEvent
  | WorktreeRemovedEvent
  | GsdPhaseStartedEvent      // NEW
  | GsdPhaseCompletedEvent    // NEW
  | GsdPhaseErrorEvent        // NEW
  | OrchStageStartedEvent
  | OrchStageCompletedEvent
  | OrchCompletedEvent
  | OrchFailedEvent
  | ProjectStatsChangedEvent  // MON-04
  | MultiProjectStartedEvent
  | MultiProjectWaveStartedEvent
  | MultiProjectProjectStartedEvent
  | MultiProjectProjectCompletedEvent
  | MultiProjectProjectFailedEvent
  | MultiProjectProjectCancelledEvent
  | MultiProjectCompletedEvent
  | ReflectStartedEvent
  | ReflectCheckCompletedEvent
  | ReflectFixStartedEvent
  | ReflectPassedEvent
  | ReflectFailedEvent;

/** A BridgeEvent that has been assigned a numeric ID by the event bus. */
export type BufferedEvent = BridgeEvent & { id: number };

// ---------------------------------------------------------------------------
// Typed event map for type-safe on/emit
// ---------------------------------------------------------------------------

export interface BridgeEventMap {
  'session.output': SessionOutputEvent;
  'session.blocking': SessionBlockingEvent;
  'session.phase_complete': SessionPhaseCompleteEvent;
  'session.error': SessionErrorEvent;
  'session.done': SessionDoneEvent;
  'worktree.created': WorktreeCreatedEvent;
  'worktree.merged': WorktreeMergedEvent;
  'worktree.conflict': WorktreeConflictEvent;
  'worktree.removed': WorktreeRemovedEvent;
  'gsd.phase_started': GsdPhaseStartedEvent;
  'gsd.phase_completed': GsdPhaseCompletedEvent;
  'gsd.phase_error': GsdPhaseErrorEvent;
  'orch.stage_started': OrchStageStartedEvent;
  'orch.stage_completed': OrchStageCompletedEvent;
  'orch.completed': OrchCompletedEvent;
  'orch.failed': OrchFailedEvent;
  'project.stats_changed': ProjectStatsChangedEvent;
  'multi_project.started': MultiProjectStartedEvent;
  'multi_project.wave_started': MultiProjectWaveStartedEvent;
  'multi_project.project_started': MultiProjectProjectStartedEvent;
  'multi_project.project_completed': MultiProjectProjectCompletedEvent;
  'multi_project.project_failed': MultiProjectProjectFailedEvent;
  'multi_project.project_cancelled': MultiProjectProjectCancelledEvent;
  'multi_project.completed': MultiProjectCompletedEvent;
  'reflect.started': ReflectStartedEvent;
  'reflect.check_completed': ReflectCheckCompletedEvent;
  'reflect.fix_started': ReflectFixStartedEvent;
  'reflect.passed': ReflectPassedEvent;
  'reflect.failed': ReflectFailedEvent;
}

// ---------------------------------------------------------------------------
// BridgeEventBus
// ---------------------------------------------------------------------------

export class BridgeEventBus {
  private emitter = new EventEmitter();
  private nextEventId: number = 1;

  constructor() {
    // Allow many SSE clients to subscribe without warning
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit a typed bridge event.
   * Assigns an auto-incrementing numeric ID to each event before emitting.
   */
  emit<K extends keyof BridgeEventMap>(event: K, payload: BridgeEventMap[K]): void {
    payload.id = this.nextEventId++;
    replayBuffer.push(payload as BufferedEvent);
    this.emitter.emit(event, payload);
    // Also emit on wildcard channel for SSE broadcast
    this.emitter.emit('*', payload);
  }

  /**
   * Subscribe to a specific event type.
   */
  on<K extends keyof BridgeEventMap>(event: K, listener: (payload: BridgeEventMap[K]) => void): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Subscribe to ALL events (wildcard). Used by SSE handler.
   */
  onAny(listener: (payload: BridgeEvent) => void): void {
    this.emitter.on('*', listener as (...args: unknown[]) => void);
  }

  /**
   * Unsubscribe from a specific event type.
   */
  off<K extends keyof BridgeEventMap>(event: K, listener: (payload: BridgeEventMap[K]) => void): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Unsubscribe from wildcard channel.
   */
  offAny(listener: (payload: BridgeEvent) => void): void {
    this.emitter.off('*', listener as (...args: unknown[]) => void);
  }

  /**
   * Get listener count for monitoring.
   */
  listenerCount(event?: keyof BridgeEventMap | '*'): number {
    return this.emitter.listenerCount(event ?? '*');
  }

  /**
   * Remove all listeners (for testing/cleanup).
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

// Singleton instance
export const eventBus = new BridgeEventBus();
