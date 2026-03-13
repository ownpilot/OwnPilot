/**
 * Fleet Service — Gateway Implementation
 *
 * Facade that wraps the FleetManager (lifecycle) + FleetRepository (persistence)
 * into a single IFleetService implementation.
 */

import { generateId, getErrorMessage, DEFAULT_FLEET_LIMITS } from '@ownpilot/core';
import type {
  IFleetService,
  FleetConfig,
  FleetSession,
  FleetTask,
  FleetWorkerResult,
  CreateFleetInput,
  UpdateFleetInput,
  CreateFleetTaskInput,
} from '@ownpilot/core';
import { FleetManager, getFleetManager } from './fleet-manager.js';
import { getFleetRepository } from '../db/repositories/fleet.js';
import { getLog } from './log.js';

const log = getLog('FleetService');

// ============================================================================
// Service Implementation
// ============================================================================

export class FleetServiceImpl implements IFleetService {
  private manager: FleetManager;

  constructor(manager?: FleetManager) {
    this.manager = manager ?? getFleetManager();
  }

  // ---- Fleet CRUD ----

  async createFleet(input: CreateFleetInput): Promise<FleetConfig> {
    const repo = getFleetRepository();

    const config = await repo.create({
      id: generateId('fl'),
      ...input,
      concurrencyLimit: input.concurrencyLimit ?? DEFAULT_FLEET_LIMITS.concurrencyLimit,
    });

    log.info(`Created fleet: ${config.name} [${config.id}]`);

    // Auto-start the fleet immediately if requested
    if (input.autoStart) {
      try {
        await this.manager.startFleet(config);
        log.info(`Auto-started fleet on creation: ${config.name} [${config.id}]`);
      } catch (err) {
        log.warn(`Failed to auto-start fleet on creation: ${getErrorMessage(err)}`);
      }
    }

    return config;
  }

  async getFleet(fleetId: string, userId: string): Promise<FleetConfig | null> {
    const repo = getFleetRepository();
    return repo.getById(fleetId, userId);
  }

  async listFleets(userId: string): Promise<FleetConfig[]> {
    const repo = getFleetRepository();
    return repo.getAll(userId);
  }

  async updateFleet(
    fleetId: string,
    userId: string,
    updates: UpdateFleetInput
  ): Promise<FleetConfig | null> {
    const repo = getFleetRepository();

    // If fleet is running, stop it first (will restart with new config if needed)
    const wasRunning = this.manager.isRunning(fleetId);
    if (wasRunning) {
      await this.manager.stopFleet(fleetId, 'config_update');
    }

    const updated = await repo.update(fleetId, userId, updates);
    if (!updated) return null;

    // If fleet was running, update config and restart
    if (wasRunning) {
      this.manager.updateFleetConfig(fleetId, updated);
      try {
        await this.manager.startFleet(updated);
      } catch (err) {
        log.error(`Failed to restart fleet after update: ${getErrorMessage(err)}`);
      }
    }

    return updated;
  }

  async deleteFleet(fleetId: string, userId: string): Promise<boolean> {
    if (this.manager.isRunning(fleetId)) {
      await this.manager.stopFleet(fleetId, 'deleted');
    }

    const repo = getFleetRepository();
    return repo.delete(fleetId, userId);
  }

  // ---- Lifecycle ----

  async startFleet(fleetId: string, userId: string): Promise<FleetSession> {
    const repo = getFleetRepository();
    const config = await repo.getById(fleetId, userId);
    if (!config) throw new Error(`Fleet not found: ${fleetId}`);

    return this.manager.startFleet(config);
  }

  async pauseFleet(fleetId: string, _userId: string): Promise<boolean> {
    return this.manager.pauseFleet(fleetId);
  }

  async resumeFleet(fleetId: string, _userId: string): Promise<boolean> {
    return this.manager.resumeFleet(fleetId);
  }

  async stopFleet(fleetId: string, _userId: string): Promise<boolean> {
    return this.manager.stopFleet(fleetId, 'user');
  }

  // ---- Tasks ----

  async addTask(
    fleetId: string,
    _userId: string,
    task: CreateFleetTaskInput
  ): Promise<FleetTask> {
    const repo = getFleetRepository();
    const created = await repo.createTask(fleetId, task);

    // If fleet is running, trigger immediate cycle to pick up new task
    if (this.manager.isRunning(fleetId)) {
      this.manager.executeNow(fleetId);
    }

    return created;
  }

  async addTasks(
    fleetId: string,
    _userId: string,
    tasks: CreateFleetTaskInput[]
  ): Promise<FleetTask[]> {
    const repo = getFleetRepository();
    const created: FleetTask[] = [];

    for (const task of tasks) {
      created.push(await repo.createTask(fleetId, task));
    }

    // Trigger cycle for new tasks
    if (this.manager.isRunning(fleetId)) {
      this.manager.executeNow(fleetId);
    }

    return created;
  }

  async getTask(taskId: string): Promise<FleetTask | null> {
    const repo = getFleetRepository();
    return repo.getTask(taskId);
  }

  async listTasks(fleetId: string, status?: string): Promise<FleetTask[]> {
    const repo = getFleetRepository();
    return repo.listTasks(fleetId, status);
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const repo = getFleetRepository();
    return repo.cancelTask(taskId);
  }

  // ---- Queries ----

  async getSession(fleetId: string): Promise<FleetSession | null> {
    // Try in-memory first, then DB
    const inMemory = this.manager.getSession(fleetId);
    if (inMemory) return inMemory;

    const repo = getFleetRepository();
    return repo.getSession(fleetId);
  }

  async listSessions(userId: string): Promise<FleetSession[]> {
    const repo = getFleetRepository();
    return repo.listSessions(userId);
  }

  async getWorkerHistory(
    fleetId: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: FleetWorkerResult[]; total: number }> {
    const repo = getFleetRepository();
    return repo.getWorkerHistory(fleetId, limit, offset);
  }

  // ---- Communication ----

  async broadcastToFleet(fleetId: string, message: string): Promise<void> {
    if (!this.manager.isRunning(fleetId)) {
      throw new Error(`Fleet ${fleetId} is not running`);
    }
    await this.manager.broadcastToFleet(fleetId, message);
  }

  // ---- Service Lifecycle ----

  async start(): Promise<void> {
    await this.manager.start();
    log.info('FleetService started');
  }

  async stop(): Promise<void> {
    await this.manager.stop();
    log.info('FleetService stopped');
  }
}

// ============================================================================
// Factory
// ============================================================================

let _service: FleetServiceImpl | null = null;

export function getFleetService(): FleetServiceImpl {
  if (!_service) {
    _service = new FleetServiceImpl();
  }
  return _service;
}
