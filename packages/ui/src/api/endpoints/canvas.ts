/**
 * Canvas API endpoints (Live Canvas)
 */

import { apiClient } from '../client';

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
  createdAt: string;
  updatedAt: string;
}

export interface CreateCanvasElementInput {
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

export const canvasApi = {
  listCanvases: () =>
    apiClient.get<{ canvases: Array<{ canvasId: string; count: number }> }>(`/canvas`),

  listElements: (canvasId = 'main') =>
    apiClient.get<{ canvasId: string; elements: CanvasElement[] }>(`/canvas/${canvasId}/elements`),

  create: (canvasId: string, input: CreateCanvasElementInput) =>
    apiClient.post<CanvasElement>(`/canvas/${canvasId}/elements`, input),

  update: (canvasId: string, id: string, input: UpdateCanvasElementInput) =>
    apiClient.patch<CanvasElement>(`/canvas/${canvasId}/elements/${id}`, input),

  remove: (canvasId: string, id: string) =>
    apiClient.delete<{ id: string; removed: boolean }>(`/canvas/${canvasId}/elements/${id}`),

  clear: (canvasId = 'main') =>
    apiClient.delete<{ canvasId: string; removed: number }>(`/canvas/${canvasId}`),

  move: (id: string, x: number, y: number, canvasId = 'main') =>
    apiClient.post<CanvasElement>(`/canvas/${canvasId}/elements/${id}/move`, { x, y }),
};
