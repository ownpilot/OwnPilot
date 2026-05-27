/**
 * Canvas Service Types & Interface
 *
 * Core types for the Live Canvas — an agent-driven spatial visual workspace.
 * The agent emits canvas operations (add/update/move/remove/clear) via tools;
 * the UI renders elements at their (x, y) positions and updates live over the
 * `canvas:op` WebSocket event.
 */

// ============================================================================
// Types
// ============================================================================

export type CanvasElementType =
  | 'text'
  | 'note'
  | 'heading'
  | 'image'
  | 'shape'
  | 'markdown'
  | 'html';

export interface CanvasElement {
  id: string;
  userId: string;
  canvasId: string;
  type: CanvasElementType;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  style: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CanvasOpAction = 'add' | 'update' | 'move' | 'remove' | 'clear';

// ============================================================================
// Input Types
// ============================================================================

export interface AddCanvasElementInput {
  canvasId?: string;
  type: CanvasElementType;
  content?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  style?: Record<string, unknown> | null;
}

export interface UpdateCanvasElementInput {
  type?: CanvasElementType;
  content?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  style?: Record<string, unknown> | null;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface ICanvasService {
  listElements(userId: string, canvasId: string): Promise<CanvasElement[]>;
  addElement(userId: string, input: AddCanvasElementInput): Promise<CanvasElement>;
  updateElement(
    userId: string,
    id: string,
    input: UpdateCanvasElementInput
  ): Promise<CanvasElement | null>;
  moveElement(userId: string, id: string, x: number, y: number): Promise<CanvasElement | null>;
  removeElement(userId: string, id: string): Promise<boolean>;
  clearCanvas(userId: string, canvasId: string): Promise<number>;
}

// ============================================================================
// Singleton access — same pattern as ArtifactService / MemoryService / etc.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

export const CanvasToken = new ServiceToken<ICanvasService>('canvas');

let _canvasService: ICanvasService | null = null;

export function setCanvasService(service: ICanvasService): void {
  _canvasService = service;
  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(CanvasToken)) {
        registry.register(CanvasToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

export function getCanvasService(): ICanvasService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(CanvasToken);
    } catch {
      // Fall through
    }
  }
  if (!_canvasService) {
    throw new Error(
      'CanvasService not initialized. Call setCanvasService() during gateway startup.'
    );
  }
  return _canvasService;
}

export function hasCanvasService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(CanvasToken);
    } catch {
      return _canvasService !== null;
    }
  }
  return _canvasService !== null;
}
