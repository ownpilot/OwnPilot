/**
 * Soul Evolution Engine
 *
 * Handles user feedback, self-reflection, and autonomous evolution.
 * Version history is stored for rollback support.
 */

import type { AgentSoul, SoulFeedback } from './types.js';

// ============================================================
// Repository interfaces (implemented by gateway)
// ============================================================

export interface ISoulRepository {
  getByAgentId(agentId: string): Promise<AgentSoul | null>;
  update(soul: AgentSoul): Promise<void>;
  createVersion(soul: AgentSoul, changeReason: string, changedBy: string): Promise<void>;
  setHeartbeatEnabled(agentId: string, enabled: boolean): Promise<void>;
  /**
   * @deprecated Use updateHeartbeatChecklist() instead.
   * Kept on the interface for backward compatibility; HeartbeatRunner no longer calls this.
   */
  updateTaskStatus(
    agentId: string,
    taskId: string,
    status: {
      lastRunAt: Date;
      lastResult: 'success' | 'failure' | 'skipped';
      lastError?: string;
      consecutiveFailures: number;
    }
  ): Promise<void>;
  /** Batch-update checklist task statuses in a single DB write. */
  updateHeartbeatChecklist(
    agentId: string,
    checklist: import('./types.js').HeartbeatTask[]
  ): Promise<void>;
}

export interface IHeartbeatLogRepository {
  getRecent(agentId: string, limit: number): Promise<HeartbeatLogEntry[]>;
  getLatest(agentId: string): Promise<HeartbeatLogEntry | null>;
  create(entry: Omit<HeartbeatLogEntry, 'id' | 'createdAt'>): Promise<void>;
}

export interface HeartbeatLogEntry {
  id: string;
  agentId: string;
  soulVersion: number;
  tasksRun: { id: string; name: string }[];
  tasksSkipped: { id: string; reason?: string }[];
  tasksFailed: { id: string; error?: string }[];
  durationMs: number;
  tokenUsage: { input: number; output: number };
  cost: number;
  createdAt: Date;
}

// ============================================================
// Minimal agent engine interface for reflection prompts
// ============================================================

export interface IReflectionEngine {
  processMessage(request: {
    agentId: string;
    message: string;
    context?: Record<string, unknown>;
  }): Promise<{ content: string; cost?: number }>;
}

// ============================================================
// Soul Evolution Engine
// ============================================================

/** Maximum learnings to keep */
const MAX_LEARNINGS = 50;
/** Maximum feedback entries to keep */
const MAX_FEEDBACK = 100;
/** Maximum boundary entries to keep */
const MAX_BOUNDARIES = 100;
/** Maximum mutable traits to keep */
const MAX_MUTABLE_TRAITS = 100;

export class SoulEvolutionEngine {
  constructor(
    private soulRepo: ISoulRepository,
    private heartbeatLogRepo: IHeartbeatLogRepository,
    private reflectionEngine?: IReflectionEngine
  ) {}

  /**
   * Apply user feedback to evolve the soul.
   * Creates a version snapshot before mutating.
   */
  async applyFeedback(agentId: string, feedback: SoulFeedback): Promise<AgentSoul> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul) throw new Error('Soul not found');

    // Snapshot before change
    await this.soulRepo.createVersion(soul, feedback.content, feedback.source);

    switch (feedback.type) {
      case 'praise':
        soul.evolution.learnings.push(`Positive: ${feedback.content}`);
        break;
      case 'correction':
        soul.identity.boundaries.push(feedback.content);
        if (soul.identity.boundaries.length > MAX_BOUNDARIES) {
          soul.identity.boundaries = soul.identity.boundaries.slice(-MAX_BOUNDARIES);
        }
        soul.evolution.learnings.push(`Correction: ${feedback.content}`);
        break;
      case 'directive':
        soul.purpose.goals.push(feedback.content);
        break;
      case 'personality_tweak':
        soul.evolution.mutableTraits.push(feedback.content);
        if (soul.evolution.mutableTraits.length > MAX_MUTABLE_TRAITS) {
          soul.evolution.mutableTraits = soul.evolution.mutableTraits.slice(-MAX_MUTABLE_TRAITS);
        }
        soul.evolution.learnings.push(`Personality: ${feedback.content}`);
        break;
    }

    // Cap arrays
    if (soul.evolution.learnings.length > MAX_LEARNINGS) {
      soul.evolution.learnings = soul.evolution.learnings.slice(-MAX_LEARNINGS);
    }
    soul.evolution.feedbackLog.push(feedback);
    if (soul.evolution.feedbackLog.length > MAX_FEEDBACK) {
      soul.evolution.feedbackLog = soul.evolution.feedbackLog.slice(-MAX_FEEDBACK);
    }

    soul.evolution.version++;
    soul.evolution.lastReflectionAt = new Date();
    soul.updatedAt = new Date();

    await this.soulRepo.update(soul);
    return soul;
  }

  /**
   * Self-reflection: agent evaluates its own performance.
   *
   * - manual: no-op
   * - supervised: returns suggestions (user must approve)
   * - autonomous: applies suggestions directly (except coreTraits)
   */
  async selfReflect(agentId: string): Promise<{ suggestions: string[]; applied: boolean }> {
    const soul = await this.soulRepo.getByAgentId(agentId);
    if (!soul || soul.evolution.evolutionMode === 'manual') {
      return { suggestions: [], applied: false };
    }

    if (!this.reflectionEngine) {
      return { suggestions: [], applied: false };
    }

    const recentLogs = await this.heartbeatLogRepo.getRecent(agentId, 20);
    const recentFeedback = soul.evolution.feedbackLog.slice(-10);

    const reflectionPrompt = `
You are ${soul.identity.name}, reflecting on your recent performance.

Recent heartbeat results:
${recentLogs.map((l) => `- ${l.createdAt.toISOString()}: ${l.tasksRun.length} done, ${l.tasksFailed.length} failed, $${l.cost}`).join('\n')}

Recent feedback from user:
${recentFeedback.map((f) => `- [${f.type}] ${f.content}`).join('\n')}

Your current learnings:
${soul.evolution.learnings.slice(-5).join('\n')}

Suggest 1-3 specific, actionable improvements. Each starts with "I should..."
Return ONLY the suggestions, one per line.
    `.trim();

    const response = await this.reflectionEngine.processMessage({
      agentId,
      message: reflectionPrompt,
      context: { isReflection: true, maxTokens: 200 },
    });

    const suggestions = response.content
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.startsWith('I should'));

    if (soul.evolution.evolutionMode === 'autonomous' && suggestions.length > 0) {
      // Snapshot BEFORE mutation (mirrors applyFeedback pattern)
      await this.soulRepo.createVersion(soul, 'Self-reflection', 'self_reflection');
      for (const s of suggestions) {
        soul.evolution.learnings.push(`Self: ${s}`);
      }
      if (soul.evolution.learnings.length > MAX_LEARNINGS) {
        soul.evolution.learnings = soul.evolution.learnings.slice(-MAX_LEARNINGS);
      }
      soul.evolution.version++;
      soul.evolution.lastReflectionAt = new Date();
      await this.soulRepo.update(soul);
      return { suggestions, applied: true };
    }

    return { suggestions, applied: false };
  }
}
