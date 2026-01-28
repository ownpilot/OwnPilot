/**
 * Channels Repository (PostgreSQL)
 */

import { BaseRepository } from './base.js';

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
    config: typeof row.config === 'string' ? JSON.parse(row.config || '{}') : (row.config || {}),
    createdAt: new Date(row.created_at),
    connectedAt: row.connected_at ? new Date(row.connected_at) : undefined,
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : undefined,
  };
}

export class ChannelsRepository extends BaseRepository {
  async create(data: {
    id: string;
    type: string;
    name: string;
    config?: Record<string, unknown>;
  }): Promise<Channel> {
    await this.execute(
      `INSERT INTO channels (id, type, name, config)
       VALUES ($1, $2, $3, $4)`,
      [data.id, data.type, data.name, JSON.stringify(data.config ?? {})]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create channel');
    return result;
  }

  async getById(id: string): Promise<Channel | null> {
    const row = await this.queryOne<ChannelRow>(
      `SELECT * FROM channels WHERE id = $1`,
      [id]
    );
    return row ? rowToChannel(row) : null;
  }

  async getByType(type: string): Promise<Channel[]> {
    const rows = await this.query<ChannelRow>(
      `SELECT * FROM channels WHERE type = $1 ORDER BY created_at DESC`,
      [type]
    );
    return rows.map(rowToChannel);
  }

  async getAll(): Promise<Channel[]> {
    const rows = await this.query<ChannelRow>(
      `SELECT * FROM channels ORDER BY created_at DESC`
    );
    return rows.map(rowToChannel);
  }

  async getConnected(): Promise<Channel[]> {
    const rows = await this.query<ChannelRow>(
      `SELECT * FROM channels WHERE status = 'connected' ORDER BY connected_at DESC`
    );
    return rows.map(rowToChannel);
  }

  async updateStatus(id: string, status: Channel['status']): Promise<void> {
    await this.execute(
      `UPDATE channels
       SET status = $1,
           connected_at = CASE WHEN $2 = 'connected' THEN NOW() ELSE connected_at END
       WHERE id = $3`,
      [status, status, id]
    );
  }

  async updateLastActivity(id: string): Promise<void> {
    await this.execute(
      `UPDATE channels SET last_activity_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    await this.execute(
      `UPDATE channels SET config = $1 WHERE id = $2`,
      [JSON.stringify(config), id]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM channels WHERE id = $1`,
      [id]
    );
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM channels`
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async countByStatus(status: Channel['status']): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM channels WHERE status = $1`,
      [status]
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const channelsRepo = new ChannelsRepository();

// Factory function
export function createChannelsRepository(): ChannelsRepository {
  return new ChannelsRepository();
}
