/**
 * Claw Service
 *
 * Thin facade over ClawManager + ClawsRepository.
 * Provides the IClawService interface for REST API routes.
 */

import type {
  IClawService,
  ClawConfig,
  ClawSession,
  ClawCycleResult,
  ClawHistoryEntry,
  CreateClawInput,
  UpdateClawInput,
} from '@ownpilot/core';
import { generateId, DEFAULT_CLAW_LIMITS, MAX_CLAW_DEPTH } from '@ownpilot/core';
import { getClawManager } from './claw-manager.js';
import { getClawsRepository } from '../db/repositories/claws.js';

/**
 * Validate user-provided claw limits/intervals before they reach the runtime.
 * Catches values that would make a claw unrunnable (zero/negative caps),
 * dangerous (cycle timeouts in the days), or impossible to schedule
 * (interval-mode without a positive intervalMs).
 */
function validateClawLimitsAndMode(input: CreateClawInput | UpdateClawInput): void {
  const limits = input.limits;
  if (limits) {
    const checks: Array<[string, number | undefined, number, number]> = [
      ['maxTurnsPerCycle', limits.maxTurnsPerCycle, 1, 100],
      ['maxToolCallsPerCycle', limits.maxToolCallsPerCycle, 1, 1000],
      ['maxCyclesPerHour', limits.maxCyclesPerHour, 1, 3600],
      ['cycleTimeoutMs', limits.cycleTimeoutMs, 1000, 3_600_000],
    ];
    for (const [field, value, min, max] of checks) {
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(
          `Invalid limits.${field}: must be a finite number between ${min} and ${max} (got ${value})`
        );
      }
    }
    if (
      limits.totalBudgetUsd !== undefined &&
      (!Number.isFinite(limits.totalBudgetUsd) || limits.totalBudgetUsd < 0)
    ) {
      throw new Error(
        `Invalid limits.totalBudgetUsd: must be a non-negative finite number (got ${limits.totalBudgetUsd})`
      );
    }
  }

  // intervalMs is only meaningful for interval-mode claws; when set it must
  // be at least 1s and at most 24h to avoid hot loops or impossible-to-trigger
  // schedules.
  const mode = (input as CreateClawInput).mode;
  const intervalMs = input.intervalMs;
  if (mode === 'interval' && (intervalMs === undefined || intervalMs <= 0)) {
    throw new Error('mode "interval" requires a positive intervalMs');
  }
  if (intervalMs !== undefined) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 86_400_000) {
      throw new Error(
        `Invalid intervalMs: must be between 1000 (1s) and 86400000 (24h) (got ${intervalMs})`
      );
    }
  }
}

export class ClawServiceImpl implements IClawService {
  // ---- CRUD ----

  async createClaw(input: CreateClawInput): Promise<ClawConfig> {
    if (!input.name?.trim()) throw new Error('Claw name is required');
    if (!input.mission?.trim()) throw new Error('Claw mission is required');
    if (input.mission.length > 10_000) throw new Error('Mission exceeds 10,000 character limit');

    validateClawLimitsAndMode(input);

    const repo = getClawsRepository();

    // Resolve parent depth and validate parent claw
    let depth = 0;
    if (input.parentClawId) {
      const parent = await repo.getByIdAnyUser(input.parentClawId);
      if (!parent) throw new Error('Parent claw not found');
      if (parent.userId !== input.userId) throw new Error('Parent claw belongs to another user');
      depth = parent.depth + 1;
      if (depth > MAX_CLAW_DEPTH) throw new Error(`Maximum claw depth (${MAX_CLAW_DEPTH}) exceeded`);
    }

    return repo.create({
      id: generateId('claw'),
      userId: input.userId,
      name: input.name,
      mission: input.mission,
      mode: input.mode ?? 'continuous',
      allowedTools: input.allowedTools ?? [],
      limits: { ...DEFAULT_CLAW_LIMITS, ...input.limits },
      intervalMs: input.intervalMs,
      eventFilters: input.eventFilters,
      autoStart: input.autoStart ?? false,
      stopCondition: input.stopCondition,
      provider: input.provider,
      model: input.model,
      soulId: input.soulId,
      parentClawId: input.parentClawId,
      depth,
      sandbox: input.sandbox ?? 'auto',
      codingAgentProvider: input.codingAgentProvider,
      skills: input.skills,
      preset: input.preset,
      missionContract: input.missionContract,
      autonomyPolicy: input.autonomyPolicy,
      createdBy: input.createdBy ?? 'user',
    });
  }

  async getClaw(clawId: string, userId: string): Promise<ClawConfig | null> {
    return getClawsRepository().getById(clawId, userId);
  }

  async listClaws(userId: string): Promise<ClawConfig[]> {
    return getClawsRepository().getAll(userId);
  }

  async listClawsPaginated(
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ claws: ClawConfig[]; total: number }> {
    return getClawsRepository().getAllPaginated(userId, limit, offset);
  }

  async updateClaw(
    clawId: string,
    userId: string,
    updates: UpdateClawInput
  ): Promise<ClawConfig | null> {
    if (updates.mission !== undefined && updates.mission.length > 10_000) {
      throw new Error('Mission exceeds 10,000 character limit');
    }
    validateClawLimitsAndMode(updates);
    return getClawsRepository().update(clawId, userId, updates);
  }

  async deleteClaw(clawId: string, userId: string): Promise<boolean> {
    const manager = getClawManager();
    if (manager.isRunning(clawId)) {
      await manager.stopClaw(clawId, userId);
    }

    // Capture workspaceId BEFORE delete so we can clean disk after the row is
    // gone. Workspace dirs can hold installed packages, scripts, .claw/
    // directives, and arbitrary files a runaway claw wrote — leaving them
    // around after delete is a real disk leak (especially for users who
    // create+delete claws in CI/automation).
    const repo = getClawsRepository();
    const config = await repo.getById(clawId, userId);
    const workspaceId = config?.workspaceId;

    const deleted = await repo.delete(clawId, userId);
    if (!deleted) return false;

    if (workspaceId) {
      try {
        const { deleteSessionWorkspace } = await import('../workspace/file-workspace.js');
        deleteSessionWorkspace(workspaceId);
      } catch {
        // Best-effort — workspace may already be gone or path invalid.
        // The DB row is already deleted; orphaned files can be reclaimed by
        // a separate workspace garbage-collection pass if needed.
      }
    }

    return true;
  }

  // ---- Lifecycle ----

  async startClaw(clawId: string, userId: string): Promise<ClawSession> {
    return getClawManager().startClaw(clawId, userId);
  }

  async pauseClaw(clawId: string, userId: string): Promise<boolean> {
    // Pre-check ownership — the manager's pauseClaw signature accepts userId
    // but doesn't enforce it (manager lookups are by clawId only). Without
    // this check, user A could pause user B's claws via this service entry
    // point, which is reachable from the REST API and management tools.
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return false;
    return getClawManager().pauseClaw(clawId, userId);
  }

  async resumeClaw(clawId: string, userId: string): Promise<boolean> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return false;
    return getClawManager().resumeClaw(clawId, userId);
  }

  async stopClaw(clawId: string, userId: string): Promise<boolean> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return false;
    return getClawManager().stopClaw(clawId, userId);
  }

  async executeNow(clawId: string, userId: string): Promise<ClawCycleResult> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) throw new Error('Claw not found');
    const manager = getClawManager();
    const session = manager.getSession(clawId);
    if (!session) {
      throw new Error('Claw not running — start it first');
    }
    if (session.state === 'paused') {
      throw new Error('Claw is paused — resume it before triggering execute-now');
    }
    if (session.state === 'escalation_pending') {
      throw new Error('Claw is waiting on an escalation — approve or deny it first');
    }
    const result = await manager.executeNow(clawId);
    if (!result) throw new Error('Cycle in progress — wait for the current cycle to finish');
    return result;
  }

  // ---- Sessions ----

  getSession(clawId: string, userId: string): ClawSession | null {
    const session = getClawManager().getSession(clawId);
    if (!session || session.config.userId !== userId) return null;
    return session;
  }

  listSessions(userId: string): ClawSession[] {
    return getClawManager().getSessionsByUser(userId);
  }

  // ---- History ----

  async getHistory(
    clawId: string,
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: ClawHistoryEntry[]; total: number }> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return { entries: [], total: 0 };
    return getClawsRepository().getHistory(clawId, limit, offset);
  }

  // ---- Communication ----

  async sendMessage(clawId: string, userId: string, message: string): Promise<void> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) throw new Error('Claw not found');
    const sent = await getClawManager().sendMessage(clawId, message);
    if (!sent) throw new Error('Claw not running');
  }

  // ---- Escalation ----

  async approveEscalation(clawId: string, userId: string): Promise<boolean> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return false;
    return getClawManager().approveEscalation(clawId);
  }

  async denyEscalation(clawId: string, userId: string, reason?: string): Promise<boolean> {
    const claw = await getClawsRepository().getById(clawId, userId);
    if (!claw) return false;
    return getClawManager().denyEscalation(clawId, reason);
  }

  // ---- Service lifecycle ----

  async start(): Promise<void> {
    return getClawManager().start();
  }

  async stop(): Promise<void> {
    return getClawManager().stop();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _service: ClawServiceImpl | null = null;

export function getClawService(): ClawServiceImpl {
  if (!_service) {
    _service = new ClawServiceImpl();
  }
  return _service;
}
