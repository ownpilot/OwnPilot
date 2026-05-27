/**
 * Canvas Repository (PostgreSQL)
 *
 * Persistence for Live Canvas elements — agent-driven spatial visual workspace.
 * Scoped by userId + canvasId.
 */

import { generateId } from '@ownpilot/core';
import type {
  CanvasElement,
  CanvasElementType,
  AddCanvasElementInput,
  UpdateCanvasElementInput,
} from '@ownpilot/core';
import { BaseRepository, parseJsonFieldNullable } from './base.js';

// ============================================================================
// Row Types
// ============================================================================

interface CanvasElementRow {
  id: string;
  user_id: string;
  canvas_id: string;
  type: string;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  style: string | null;
  created_at: string;
  updated_at: string;
}

function rowToElement(row: CanvasElementRow): CanvasElement {
  return {
    id: row.id,
    userId: row.user_id,
    canvasId: row.canvas_id,
    type: row.type as CanvasElementType,
    content: row.content,
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    z: Number(row.z),
    style: parseJsonFieldNullable<Record<string, unknown>>(row.style),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class CanvasRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async list(canvasId = 'main'): Promise<CanvasElement[]> {
    const rows = await this.query<CanvasElementRow>(
      'SELECT * FROM canvas_elements WHERE user_id = $1 AND canvas_id = $2 ORDER BY z ASC, created_at ASC',
      [this.userId, canvasId]
    );
    return rows.map(rowToElement);
  }

  /** Distinct canvases for this user, with element counts. 'main' is always present. */
  async listCanvases(): Promise<Array<{ canvasId: string; count: number }>> {
    const rows = await this.query<{ canvas_id: string; count: string }>(
      'SELECT canvas_id, COUNT(*) AS count FROM canvas_elements WHERE user_id = $1 GROUP BY canvas_id ORDER BY canvas_id ASC',
      [this.userId]
    );
    const list = rows.map((r) => ({ canvasId: r.canvas_id, count: parseInt(r.count, 10) }));
    if (!list.some((c) => c.canvasId === 'main')) {
      list.unshift({ canvasId: 'main', count: 0 });
    }
    return list;
  }

  async getById(id: string): Promise<CanvasElement | null> {
    const row = await this.queryOne<CanvasElementRow>(
      'SELECT * FROM canvas_elements WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToElement(row) : null;
  }

  async add(input: AddCanvasElementInput): Promise<CanvasElement> {
    const id = generateId('canv');
    const now = new Date().toISOString();
    const sql = `
      INSERT INTO canvas_elements (
        id, user_id, canvas_id, type, content, x, y, w, h, z, style, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    `;
    await this.query(sql, [
      id,
      this.userId,
      input.canvasId ?? 'main',
      input.type,
      input.content ?? '',
      input.x ?? 0,
      input.y ?? 0,
      input.w ?? 200,
      input.h ?? 120,
      input.z ?? 0,
      input.style != null ? JSON.stringify(input.style) : null,
      now,
    ]);
    return this.getById(id) as Promise<CanvasElement>;
  }

  async update(id: string, input: UpdateCanvasElementInput): Promise<CanvasElement | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const merged = {
      type: input.type ?? existing.type,
      content: input.content ?? existing.content,
      x: input.x ?? existing.x,
      y: input.y ?? existing.y,
      w: input.w ?? existing.w,
      h: input.h ?? existing.h,
      z: input.z ?? existing.z,
      style: input.style !== undefined ? input.style : existing.style,
    };

    await this.query(
      `UPDATE canvas_elements
       SET type = $1, content = $2, x = $3, y = $4, w = $5, h = $6, z = $7, style = $8, updated_at = NOW()
       WHERE id = $9 AND user_id = $10`,
      [
        merged.type,
        merged.content,
        merged.x,
        merged.y,
        merged.w,
        merged.h,
        merged.z,
        merged.style != null ? JSON.stringify(merged.style) : null,
        id,
        this.userId,
      ]
    );
    return this.getById(id);
  }

  async move(id: string, x: number, y: number): Promise<CanvasElement | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    await this.query(
      'UPDATE canvas_elements SET x = $1, y = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
      [x, y, id, this.userId]
    );
    return this.getById(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM canvas_elements WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async clear(canvasId = 'main'): Promise<number> {
    const result = await this.execute(
      'DELETE FROM canvas_elements WHERE user_id = $1 AND canvas_id = $2',
      [this.userId, canvasId]
    );
    return result.changes;
  }
}

export function createCanvasRepository(userId = 'default'): CanvasRepository {
  return new CanvasRepository(userId);
}
