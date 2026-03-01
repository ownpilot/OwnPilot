/**
 * Subagent Service Implementation
 *
 * Public facade wrapping SubagentManager (in-memory) + SubagentsRepository (DB).
 * Registered as Services.Subagent in the ServiceRegistry.
 */

import type {
  ISubagentService,
  SpawnSubagentInput,
  SubagentSession,
  SubagentHistoryEntry,
} from '@ownpilot/core';
import { SubagentManager, getSubagentManager } from './subagent-manager.js';
import { SubagentsRepository } from '../db/repositories/subagents.js';

// ============================================================================
// Service Implementation
// ============================================================================

export class SubagentServiceImpl implements ISubagentService {
  private manager: SubagentManager;
  private repo: SubagentsRepository;

  constructor(manager?: SubagentManager, repo?: SubagentsRepository) {
    this.manager = manager ?? getSubagentManager();
    this.repo = repo ?? new SubagentsRepository();
  }

  async spawn(input: SpawnSubagentInput): Promise<SubagentSession> {
    return this.manager.spawn(input);
  }

  getSession(subagentId: string, userId: string): SubagentSession | null {
    const session = this.manager.getSession(subagentId);
    if (session && session.userId !== userId) return null;
    return session;
  }

  listByParent(parentId: string, userId: string): SubagentSession[] {
    return this.manager.listByParent(parentId).filter((s) => s.userId === userId);
  }

  getResult(subagentId: string, userId: string): SubagentSession | null {
    return this.getSession(subagentId, userId);
  }

  cancel(subagentId: string, userId: string): boolean {
    const session = this.manager.getSession(subagentId);
    if (!session || session.userId !== userId) return false;
    return this.manager.cancel(subagentId);
  }

  async getHistory(
    parentId: string,
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: SubagentHistoryEntry[]; total: number }> {
    const result = await this.repo.getHistory(parentId, limit, offset);
    // Filter by userId for security
    const filtered = result.entries.filter((e) => e.userId === userId);
    return { entries: filtered, total: filtered.length };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _service: SubagentServiceImpl | null = null;

export function getSubagentService(): SubagentServiceImpl {
  if (!_service) {
    _service = new SubagentServiceImpl();
  }
  return _service;
}

export function resetSubagentService(): void {
  _service = null;
}
