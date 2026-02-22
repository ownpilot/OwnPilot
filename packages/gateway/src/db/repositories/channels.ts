/**
 * Channels Repository (PostgreSQL)
 *
 * Stores channel metadata. Required for the channel_messages FK constraint.
 */

import { BaseRepository } from './base.js';

export interface ChannelRow {
  id: string;
  type: string;
  name: string;
  status: string;
  config: string;
  created_at: string;
  connected_at: string | null;
  last_activity_at: string | null;
}

export class ChannelsRepository extends BaseRepository {
  /**
   * Upsert a channel row — creates if missing, updates status/name if exists.
   * This keeps the channels table in sync with in-memory channel state
   * and satisfies the FK constraint on channel_messages.
   */
  async upsert(data: { id: string; type: string; name: string; status: string }): Promise<void> {
    await this.execute(
      `INSERT INTO channels (id, type, name, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         name = EXCLUDED.name,
         connected_at = CASE WHEN EXCLUDED.status = 'connected' THEN NOW() ELSE channels.connected_at END,
         last_activity_at = NOW()`,
      [data.id, data.type, data.name, data.status]
    );
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.execute(`UPDATE channels SET status = $1, last_activity_at = NOW() WHERE id = $2`, [
      status,
      id,
    ]);
  }

  async updateLastActivity(id: string): Promise<void> {
    await this.execute(`UPDATE channels SET last_activity_at = NOW() WHERE id = $1`, [id]);
  }
}

export const channelsRepo = new ChannelsRepository();
