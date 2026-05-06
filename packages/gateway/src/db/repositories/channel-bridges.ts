/**
 * Channel Bridges Repository
 *
 * CRUD for channel_bridges table — stores cross-channel bridge configurations.
 * Implements the BridgeStore interface from @ownpilot/core.
 */

import { generateId } from '@ownpilot/core';
import type { UCPBridgeConfig, BridgeDirection, BridgeStore } from '@ownpilot/core';
import { BaseRepository } from './base.js';

// ============================================================================
// Row Type
// ============================================================================

interface BridgeRow {
  id: string;
  source_channel_id: string;
  target_channel_id: string;
  direction: string;
  filter_pattern: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Row Mapper
// ============================================================================

function rowToBridge(row: BridgeRow): UCPBridgeConfig {
  return {
    id: row.id,
    sourceChannelId: row.source_channel_id,
    targetChannelId: row.target_channel_id,
    direction: row.direction as BridgeDirection,
    filterPattern: row.filter_pattern ?? undefined,
    enabled: row.enabled,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ChannelBridgesRepository extends BaseRepository implements BridgeStore {
  async getAll(): Promise<UCPBridgeConfig[]> {
    const rows = await this.query<BridgeRow>(
      'SELECT * FROM channel_bridges ORDER BY created_at DESC',
      []
    );
    return rows.map(rowToBridge);
  }

  async getById(id: string): Promise<UCPBridgeConfig | null> {
    const row = await this.queryOne<BridgeRow>('SELECT * FROM channel_bridges WHERE id = $1', [id]);
    return row ? rowToBridge(row) : null;
  }

  /**
   * Check if a bridge is owned by a user — user must have at least one active
   * channel session (via channel_users → channel_sessions) for either the
   * source or target channel of the bridge.
   */
  async isOwnedByUser(bridgeId: string, userId: string): Promise<boolean> {
    const bridge = await this.getById(bridgeId);
    if (!bridge) return false;
    const rows = await this.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM channel_sessions cs
       JOIN channel_users cu ON cu.id = cs.channel_user_id
       WHERE cs.channel_plugin_id IN ($1, $2) AND cu.ownpilot_user_id = $3`,
      [bridge.sourceChannelId, bridge.targetChannelId, userId]
    );
    return parseInt(rows[0]?.count ?? '0', 10) > 0;
  }

  async getByChannel(channelId: string): Promise<UCPBridgeConfig[]> {
    const rows = await this.query<BridgeRow>(
      `SELECT * FROM channel_bridges
       WHERE (source_channel_id = $1 OR target_channel_id = $1)
         AND enabled = true
       ORDER BY created_at DESC`,
      [channelId]
    );
    return rows.map(rowToBridge);
  }

  async save(config: Omit<UCPBridgeConfig, 'id' | 'createdAt'>): Promise<UCPBridgeConfig> {
    const id = generateId('bridge');
    const now = new Date();

    await this.query(
      `INSERT INTO channel_bridges (id, source_channel_id, target_channel_id, direction, filter_pattern, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        id,
        config.sourceChannelId,
        config.targetChannelId,
        config.direction,
        config.filterPattern ?? null,
        config.enabled,
        now.toISOString(),
      ]
    );

    return {
      id,
      ...config,
      createdAt: now,
    };
  }

  async update(id: string, changes: Partial<UCPBridgeConfig>): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (changes.sourceChannelId !== undefined) {
      setClauses.push(`source_channel_id = $${paramIndex++}`);
      params.push(changes.sourceChannelId);
    }
    if (changes.targetChannelId !== undefined) {
      setClauses.push(`target_channel_id = $${paramIndex++}`);
      params.push(changes.targetChannelId);
    }
    if (changes.direction !== undefined) {
      setClauses.push(`direction = $${paramIndex++}`);
      params.push(changes.direction);
    }
    if (changes.filterPattern !== undefined) {
      setClauses.push(`filter_pattern = $${paramIndex++}`);
      params.push(changes.filterPattern);
    }
    if (changes.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      params.push(changes.enabled);
    }

    if (setClauses.length === 0) return;

    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());

    params.push(id);

    await this.query(
      `UPDATE channel_bridges SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params
    );
  }

  async remove(id: string): Promise<void> {
    await this.query('DELETE FROM channel_bridges WHERE id = $1', [id]);
  }
}
