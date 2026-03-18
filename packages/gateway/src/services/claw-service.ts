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
import { generateId, DEFAULT_CLAW_LIMITS } from '@ownpilot/core';
import { getClawManager } from './claw-manager.js';
import { getClawsRepository } from '../db/repositories/claws.js';

export class ClawServiceImpl implements IClawService {
  // ---- CRUD ----

  async createClaw(input: CreateClawInput): Promise<ClawConfig> {
    if (!input.name?.trim()) throw new Error('Claw name is required');
    if (!input.mission?.trim()) throw new Error('Claw mission is required');
    if (input.mission.length > 10_000) throw new Error('Mission exceeds 10,000 character limit');

    const repo = getClawsRepository();

    // Resolve parent depth
    let depth = 0;
    if (input.parentClawId) {
      const parent = await repo.getByIdAnyUser(input.parentClawId);
      if (parent) depth = parent.depth + 1;
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
      createdBy: input.createdBy ?? 'user',
    });
  }

  async getClaw(clawId: string, userId: string): Promise<ClawConfig | null> {
    return getClawsRepository().getById(clawId, userId);
  }

  async listClaws(userId: string): Promise<ClawConfig[]> {
    return getClawsRepository().getAll(userId);
  }

  async updateClaw(
    clawId: string,
    userId: string,
    updates: UpdateClawInput
  ): Promise<ClawConfig | null> {
    return getClawsRepository().update(clawId, userId, updates);
  }

  async deleteClaw(clawId: string, userId: string): Promise<boolean> {
    const manager = getClawManager();
    if (manager.isRunning(clawId)) {
      await manager.stopClaw(clawId, userId);
    }
    return getClawsRepository().delete(clawId, userId);
  }

  // ---- Lifecycle ----

  async startClaw(clawId: string, userId: string): Promise<ClawSession> {
    return getClawManager().startClaw(clawId, userId);
  }

  async pauseClaw(clawId: string, userId: string): Promise<boolean> {
    return getClawManager().pauseClaw(clawId, userId);
  }

  async resumeClaw(clawId: string, userId: string): Promise<boolean> {
    return getClawManager().resumeClaw(clawId, userId);
  }

  async stopClaw(clawId: string, userId: string): Promise<boolean> {
    return getClawManager().stopClaw(clawId, userId);
  }

  async executeNow(clawId: string, _userId: string): Promise<ClawCycleResult> {
    const result = await getClawManager().executeNow(clawId);
    if (!result) throw new Error('Claw not running or cycle in progress');
    return result;
  }

  // ---- Sessions ----

  getSession(clawId: string, _userId: string): ClawSession | null {
    return getClawManager().getSession(clawId);
  }

  listSessions(userId: string): ClawSession[] {
    return getClawManager().getSessionsByUser(userId);
  }

  // ---- History ----

  async getHistory(
    clawId: string,
    _userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: ClawHistoryEntry[]; total: number }> {
    return getClawsRepository().getHistory(clawId, limit, offset);
  }

  // ---- Communication ----

  async sendMessage(clawId: string, _userId: string, message: string): Promise<void> {
    const sent = await getClawManager().sendMessage(clawId, message);
    if (!sent) throw new Error('Claw not running');
  }

  // ---- Escalation ----

  async approveEscalation(clawId: string, _userId: string): Promise<boolean> {
    return getClawManager().approveEscalation(clawId);
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
