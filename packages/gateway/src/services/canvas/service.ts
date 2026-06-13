/**
 * Canvas Service (Gateway Implementation)
 *
 * Implements ICanvasService using CanvasRepository for CRUD.
 * Broadcasts `canvas:op` events via WS on every mutation so the UI
 * renders agent-driven canvas changes live.
 */

import { getLog } from '@ownpilot/core/services';
import type {
  ICanvasService,
  CanvasElement,
  AddCanvasElementInput,
  UpdateCanvasElementInput,
  CanvasOpAction,
} from '@ownpilot/core';
import { CanvasRepository } from '../../db/repositories/canvas.js';
import { wsGateway } from '../../ws/server.js';

const log = getLog('CanvasService');

class CanvasServiceImpl implements ICanvasService {
  private getRepo(userId: string): CanvasRepository {
    return new CanvasRepository(userId);
  }

  async listElements(userId: string, canvasId = 'main'): Promise<CanvasElement[]> {
    return this.getRepo(userId).list(canvasId);
  }

  async listCanvases(userId: string): Promise<Array<{ canvasId: string; count: number }>> {
    return this.getRepo(userId).listCanvases();
  }

  async addElement(userId: string, input: AddCanvasElementInput): Promise<CanvasElement> {
    const element = await this.getRepo(userId).add(input);
    log.info(`Added canvas element ${element.id} (${element.type}) for user ${userId}`);
    this.broadcast('add', element.canvasId, { element });
    return element;
  }

  async updateElement(
    userId: string,
    id: string,
    input: UpdateCanvasElementInput
  ): Promise<CanvasElement | null> {
    const element = await this.getRepo(userId).update(id, input);
    if (element) {
      this.broadcast('update', element.canvasId, { element });
    }
    return element;
  }

  async moveElement(
    userId: string,
    id: string,
    x: number,
    y: number
  ): Promise<CanvasElement | null> {
    const element = await this.getRepo(userId).move(id, x, y);
    if (element) {
      this.broadcast('move', element.canvasId, { element });
    }
    return element;
  }

  async removeElement(userId: string, id: string): Promise<boolean> {
    const repo = this.getRepo(userId);
    const existing = await repo.getById(id);
    const removed = await repo.remove(id);
    if (removed && existing) {
      this.broadcast('remove', existing.canvasId, { id });
    }
    return removed;
  }

  async clearCanvas(userId: string, canvasId = 'main'): Promise<number> {
    const count = await this.getRepo(userId).clear(canvasId);
    this.broadcast('clear', canvasId, {});
    log.info(`Cleared ${count} canvas elements (${canvasId}) for user ${userId}`);
    return count;
  }

  private broadcast(
    action: CanvasOpAction,
    canvasId: string,
    extra: { element?: CanvasElement; id?: string }
  ): void {
    try {
      wsGateway.broadcast('canvas:op', { canvasId, action, ...extra });
    } catch {
      // WS not initialized yet (e.g. during tests)
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _service: CanvasServiceImpl | null = null;

export function getCanvasServiceImpl(): CanvasServiceImpl {
  if (!_service) {
    _service = new CanvasServiceImpl();
  }
  return _service;
}
