/**
 * Background Agent Service — Gateway Implementation
 *
 * Facade that wraps the Manager (lifecycle) + Repository (persistence)
 * into a single IBackgroundAgentService implementation.
 *
 * Registered as Services.BackgroundAgent in the ServiceRegistry.
 */

import { generateId, getErrorMessage, DEFAULT_BACKGROUND_AGENT_LIMITS } from '@ownpilot/core';
import type {
  IBackgroundAgentService,
  BackgroundAgentConfig,
  BackgroundAgentSession,
  BackgroundAgentHistoryEntry,
  CreateBackgroundAgentInput,
  UpdateBackgroundAgentInput,
} from '@ownpilot/core';
import { BackgroundAgentManager, getBackgroundAgentManager } from './background-agent-manager.js';
import { getBackgroundAgentsRepository } from '../db/repositories/background-agents.js';
import { getLog } from './log.js';

const log = getLog('BackgroundAgentService');

// ============================================================================
// Service Implementation
// ============================================================================

export class BackgroundAgentServiceImpl implements IBackgroundAgentService {
  private manager: BackgroundAgentManager;

  constructor(manager?: BackgroundAgentManager) {
    this.manager = manager ?? getBackgroundAgentManager();
  }

  // ---- Agent Configuration CRUD ----

  async createAgent(input: CreateBackgroundAgentInput): Promise<BackgroundAgentConfig> {
    const repo = getBackgroundAgentsRepository();

    const limits = {
      ...DEFAULT_BACKGROUND_AGENT_LIMITS,
      ...input.limits,
    };

    const config = await repo.create({
      id: generateId('bg'),
      userId: input.userId,
      name: input.name,
      mission: input.mission,
      mode: input.mode,
      allowedTools: input.allowedTools ?? [],
      limits,
      intervalMs: input.intervalMs,
      eventFilters: input.eventFilters,
      autoStart: input.autoStart ?? false,
      stopCondition: input.stopCondition,
      createdBy: input.createdBy ?? 'user',
    });

    log.info(`Created background agent: ${config.name} [${config.id}]`);
    return config;
  }

  async getAgent(agentId: string, userId: string): Promise<BackgroundAgentConfig | null> {
    const repo = getBackgroundAgentsRepository();
    return repo.getById(agentId, userId);
  }

  async listAgents(userId: string): Promise<BackgroundAgentConfig[]> {
    const repo = getBackgroundAgentsRepository();
    return repo.getAll(userId);
  }

  async updateAgent(
    agentId: string,
    userId: string,
    updates: UpdateBackgroundAgentInput
  ): Promise<BackgroundAgentConfig | null> {
    const repo = getBackgroundAgentsRepository();

    // If agent is running, stop it first (will restart with new config)
    const wasRunning = this.manager.isRunning(agentId);
    if (wasRunning) {
      await this.manager.stopAgent(agentId, 'user');
    }

    const updated = await repo.update(agentId, userId, updates);
    if (!updated) return null;

    // If agent was running, update config and restart
    if (wasRunning) {
      this.manager.updateAgentConfig(agentId, updated);
      try {
        await this.manager.startAgent(updated);
      } catch (err) {
        log.error(`Failed to restart agent after update: ${getErrorMessage(err)}`);
      }
    }

    return updated;
  }

  async deleteAgent(agentId: string, userId: string): Promise<boolean> {
    // Stop agent if running
    if (this.manager.isRunning(agentId)) {
      await this.manager.stopAgent(agentId, 'user');
    }

    const repo = getBackgroundAgentsRepository();

    // Delete session and history (cascades via FK)
    await repo.deleteSession(agentId);
    return repo.delete(agentId, userId);
  }

  // ---- Session Lifecycle ----

  async startAgent(agentId: string, userId: string): Promise<BackgroundAgentSession> {
    const repo = getBackgroundAgentsRepository();
    const config = await repo.getById(agentId, userId);
    if (!config) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return this.manager.startAgent(config);
  }

  async pauseAgent(agentId: string, _userId: string): Promise<boolean> {
    return this.manager.pauseAgent(agentId);
  }

  async resumeAgent(agentId: string, _userId: string): Promise<boolean> {
    return this.manager.resumeAgent(agentId);
  }

  async stopAgent(agentId: string, _userId: string): Promise<boolean> {
    return this.manager.stopAgent(agentId, 'user');
  }

  // ---- Session Queries ----

  getSession(agentId: string, _userId: string): BackgroundAgentSession | null {
    return this.manager.getSession(agentId);
  }

  listSessions(userId: string): BackgroundAgentSession[] {
    return this.manager.getSessionsByUser(userId);
  }

  // ---- Execution History ----

  async getHistory(
    agentId: string,
    _userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: BackgroundAgentHistoryEntry[]; total: number }> {
    const repo = getBackgroundAgentsRepository();
    return repo.getHistory(agentId, limit, offset);
  }

  // ---- Communication ----

  async sendMessage(agentId: string, _userId: string, message: string): Promise<void> {
    // Also persist to DB (so it survives restarts)
    const repo = getBackgroundAgentsRepository();
    await repo.appendToInbox(agentId, message);

    // And send to in-memory manager
    const sent = await this.manager.sendMessage(agentId, 'user', message);
    if (!sent) {
      throw new Error(`Agent ${agentId} is not running`);
    }
  }

  // ---- Service Lifecycle ----

  async start(): Promise<void> {
    await this.manager.start();
    log.info('BackgroundAgentService started');
  }

  async stop(): Promise<void> {
    await this.manager.stop();
    log.info('BackgroundAgentService stopped');
  }
}

// ============================================================================
// Factory
// ============================================================================

let _service: BackgroundAgentServiceImpl | null = null;

export function getBackgroundAgentService(): BackgroundAgentServiceImpl {
  if (!_service) {
    _service = new BackgroundAgentServiceImpl();
  }
  return _service;
}
