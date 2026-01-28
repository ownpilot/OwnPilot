/**
 * Channels Repository
 */

import { getDatabase } from '../connection.js';

export interface Channel {
  id: string;
  type: string;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  config: Record<string, unknown>;
  createdAt: Date;
  connectedAt?: Date;
  lastActivityAt?: Date;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  status: string;
  config: string;
  created_at: string;
  connected_at: string | null;
  last_activity_at: string | null;
}

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status as Channel['status'],
    config: JSON.parse(row.config || '{}'),
    createdAt: new Date(row.created_at),
    connectedAt: row.connected_at ? new Date(row.connected_at) : undefined,
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : undefined,
  };
}

export class ChannelsRepository {
  private db = getDatabase();

  create(data: {
    id: string;
    type: string;
    name: string;
    config?: Record<string, unknown>;
  }): Channel {
    const stmt = this.db.prepare(`
      INSERT INTO channels (id, type, name, config)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.type,
      data.name,
      JSON.stringify(data.config ?? {})
    );

    return this.getById(data.id)!;
  }

  getById(id: string): Channel | null {
    const stmt = this.db.prepare<string, ChannelRow>(`
      SELECT * FROM channels WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToChannel(row) : null;
  }

  getByType(type: string): Channel[] {
    const stmt = this.db.prepare<string, ChannelRow>(`
      SELECT * FROM channels WHERE type = ? ORDER BY created_at DESC
    `);

    return stmt.all(type).map(rowToChannel);
  }

  getAll(): Channel[] {
    const stmt = this.db.prepare<[], ChannelRow>(`
      SELECT * FROM channels ORDER BY created_at DESC
    `);

    return stmt.all().map(rowToChannel);
  }

  getConnected(): Channel[] {
    const stmt = this.db.prepare<[], ChannelRow>(`
      SELECT * FROM channels WHERE status = 'connected' ORDER BY connected_at DESC
    `);

    return stmt.all().map(rowToChannel);
  }

  updateStatus(id: string, status: Channel['status']): void {
    const stmt = this.db.prepare(`
      UPDATE channels
      SET status = ?,
          connected_at = CASE WHEN ? = 'connected' THEN datetime('now') ELSE connected_at END
      WHERE id = ?
    `);

    stmt.run(status, status, id);
  }

  updateLastActivity(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE channels SET last_activity_at = datetime('now') WHERE id = ?
    `);

    stmt.run(id);
  }

  updateConfig(id: string, config: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      UPDATE channels SET config = ? WHERE id = ?
    `);

    stmt.run(JSON.stringify(config), id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM channels WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM channels
    `);

    return stmt.get()?.count ?? 0;
  }

  countByStatus(status: Channel['status']): number {
    const stmt = this.db.prepare<string, { count: number }>(`
      SELECT COUNT(*) as count FROM channels WHERE status = ?
    `);

    return stmt.get(status)?.count ?? 0;
  }
}

export const channelsRepo = new ChannelsRepository();
