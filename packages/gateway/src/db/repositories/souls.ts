/**
 * Soul Repository — CRUD for agent_souls and agent_soul_versions
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';
import type {
  AgentSoul,
  SoulVersion,
  SoulIdentity,
  SoulPurpose,
  SoulAutonomy,
  SoulHeartbeat,
  SoulRelationships,
  SoulEvolution,
  SoulBootSequence,
} from '@ownpilot/core';

// ── DB Row Types ────────────────────────────────────

interface SoulRow {
  id: string;
  agent_id: string;
  identity: string;
  purpose: string;
  autonomy: string;
  heartbeat: string;
  relationships: string;
  evolution: string;
  boot_sequence: string;
  provider: string | null;
  skill_access: string | null;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SoulVersionRow {
  id: string;
  soul_id: string;
  version: number;
  snapshot: string;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

// ── Row → Record Mappers ────────────────────────────

function rowToSoul(row: SoulRow): AgentSoul {
  return {
    id: row.id,
    agentId: row.agent_id,
    identity: parseJsonField<SoulIdentity>(row.identity, {
      name: '',
      emoji: '',
      role: '',
      personality: '',
      voice: { tone: 'neutral', language: 'en' },
      boundaries: [],
    }),
    purpose: parseJsonField<SoulPurpose>(row.purpose, {
      mission: '',
      goals: [],
      expertise: [],
      toolPreferences: [],
    }),
    autonomy: parseJsonField<SoulAutonomy>(row.autonomy, {
      level: 0,
      allowedActions: [],
      blockedActions: [],
      requiresApproval: [],
      maxCostPerCycle: 0,
      maxCostPerDay: 0,
      maxCostPerMonth: 0,
      pauseOnConsecutiveErrors: 5,
      pauseOnBudgetExceeded: true,
      notifyUserOnPause: true,
    }),
    heartbeat: parseJsonField<SoulHeartbeat>(row.heartbeat, {
      enabled: false,
      interval: '*/30 * * * *',
      checklist: [],
      selfHealingEnabled: false,
      maxDurationMs: 120000,
    }),
    relationships: parseJsonField<SoulRelationships>(row.relationships, {
      delegates: [],
      peers: [],
      channels: [],
    }),
    evolution: parseJsonField<SoulEvolution>(row.evolution, {
      version: 1,
      evolutionMode: 'manual',
      coreTraits: [],
      mutableTraits: [],
      learnings: [],
      feedbackLog: [],
    }),
    bootSequence: parseJsonField<SoulBootSequence>(row.boot_sequence, {
      onStart: [],
      onHeartbeat: [],
      onMessage: [],
    }),
    provider: row.provider ? parseJsonField(row.provider, undefined) : undefined,
    skillAccess: row.skill_access ? parseJsonField(row.skill_access, undefined) : undefined,
    workspaceId: row.workspace_id ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToSoulVersion(row: SoulVersionRow): SoulVersion {
  return {
    id: row.id,
    soulId: row.soul_id,
    version: row.version,
    snapshot: parseJsonFieldNullable<AgentSoul>(row.snapshot),
    changeReason: row.change_reason ?? undefined,
    changedBy: row.changed_by ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

// ── Repository ──────────────────────────────────────

export class SoulsRepository extends BaseRepository {
  // ── CRUD ──

  async create(data: Omit<AgentSoul, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentSoul> {
    await this.execute(
      `INSERT INTO agent_souls (agent_id, identity, purpose, autonomy, heartbeat, relationships, evolution, boot_sequence, provider, skill_access, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        data.agentId,
        JSON.stringify(data.identity),
        JSON.stringify(data.purpose),
        JSON.stringify(data.autonomy),
        JSON.stringify(data.heartbeat),
        JSON.stringify(data.relationships),
        JSON.stringify(data.evolution),
        JSON.stringify(data.bootSequence),
        data.provider ? JSON.stringify(data.provider) : null,
        data.skillAccess ? JSON.stringify(data.skillAccess) : null,
        data.workspaceId ?? null,
      ]
    );
    const soul = await this.getByAgentId(data.agentId);
    if (!soul) throw new Error('Failed to create soul');
    return soul;
  }

  async getById(id: string): Promise<AgentSoul | null> {
    const row = await this.queryOne<SoulRow>(`SELECT * FROM agent_souls WHERE id = $1`, [id]);
    return row ? rowToSoul(row) : null;
  }

  async getByAgentId(agentId: string): Promise<AgentSoul | null> {
    const row = await this.queryOne<SoulRow>(`SELECT * FROM agent_souls WHERE agent_id = $1`, [
      agentId,
    ]);
    return row ? rowToSoul(row) : null;
  }

  async list(userId: string | null, limit: number, offset: number): Promise<AgentSoul[]> {
    const rows = userId
      ? await this.query<SoulRow>(
          `SELECT * FROM agent_souls WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        )
      : await this.query<SoulRow>(
          `SELECT * FROM agent_souls ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
    return rows.map(rowToSoul);
  }

  async listByAgentIds(agentIds: string[]): Promise<AgentSoul[]> {
    if (agentIds.length === 0) return [];
    const placeholders = agentIds.map((_, i) => `$${i + 1}`).join(',');
    const rows = await this.query<SoulRow>(
      `SELECT * FROM agent_souls WHERE agent_id IN (${placeholders})`,
      agentIds
    );
    return rows.map(rowToSoul);
  }

  async count(userId: string | null): Promise<number> {
    const row = userId
      ? await this.queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM agent_souls WHERE workspace_id = $1`,
          [userId]
        )
      : await this.queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM agent_souls`);
    return parseInt(row?.count ?? '0', 10);
  }

  async update(soul: AgentSoul): Promise<void> {
    await this.execute(
      `UPDATE agent_souls
       SET identity = $1, purpose = $2, autonomy = $3, heartbeat = $4,
           relationships = $5, evolution = $6, boot_sequence = $7,
           provider = $8, skill_access = $9, workspace_id = $10, updated_at = NOW()
       WHERE agent_id = $11`,
      [
        JSON.stringify(soul.identity),
        JSON.stringify(soul.purpose),
        JSON.stringify(soul.autonomy),
        JSON.stringify(soul.heartbeat),
        JSON.stringify(soul.relationships),
        JSON.stringify(soul.evolution),
        JSON.stringify(soul.bootSequence),
        soul.provider ? JSON.stringify(soul.provider) : null,
        soul.skillAccess ? JSON.stringify(soul.skillAccess) : null,
        soul.workspaceId ?? null,
        soul.agentId,
      ]
    );
  }

  async delete(agentId: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM agent_souls WHERE agent_id = $1`, [agentId]);
    return result.changes > 0;
  }

  // ── Heartbeat helpers ──

  async setHeartbeatEnabled(agentId: string, enabled: boolean): Promise<void> {
    await this.execute(
      `UPDATE agent_souls
       SET heartbeat = jsonb_set(heartbeat, '{enabled}', $1::jsonb),
           updated_at = NOW()
       WHERE agent_id = $2`,
      [JSON.stringify(enabled), agentId]
    );
  }

  /**
   * @deprecated Use updateHeartbeatChecklist() for batch updates.
   * HeartbeatRunner no longer calls this method — it is kept for backward
   * compatibility with the ISoulRepository interface until the next cleanup pass.
   */
  async updateTaskStatus(
    agentId: string,
    taskId: string,
    status: {
      lastRunAt: Date;
      lastResult: string;
      lastError?: string;
      consecutiveFailures: number;
    }
  ): Promise<void> {
    // Update task status within the heartbeat.checklist JSONB array
    const soul = await this.getByAgentId(agentId);
    if (!soul) return;

    const checklist = soul.heartbeat.checklist.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          lastRunAt: status.lastRunAt,
          lastResult: status.lastResult,
          lastError: status.lastError,
          consecutiveFailures: status.consecutiveFailures,
        };
      }
      return t;
    });

    await this.execute(
      `UPDATE agent_souls
       SET heartbeat = jsonb_set(heartbeat, '{checklist}', $1::jsonb),
           updated_at = NOW()
       WHERE agent_id = $2`,
      [JSON.stringify(checklist), agentId]
    );
  }

  /** Batch-update the full checklist in a single SQL statement. */
  async updateHeartbeatChecklist(
    agentId: string,
    checklist: AgentSoul['heartbeat']['checklist']
  ): Promise<void> {
    await this.execute(
      `UPDATE agent_souls
       SET heartbeat = jsonb_set(heartbeat, '{checklist}', $1::jsonb),
           updated_at = NOW()
       WHERE agent_id = $2`,
      [JSON.stringify(checklist), agentId]
    );
  }

  // ── Versioning ──

  async createVersion(soul: AgentSoul, changeReason: string, changedBy: string): Promise<void> {
    await this.execute(
      `INSERT INTO agent_soul_versions (soul_id, version, snapshot, change_reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [soul.id, soul.evolution.version, JSON.stringify(soul), changeReason, changedBy]
    );
  }

  async getVersions(soulId: string, limit: number, offset: number): Promise<SoulVersion[]> {
    const rows = await this.query<SoulVersionRow>(
      `SELECT * FROM agent_soul_versions
       WHERE soul_id = $1
       ORDER BY version DESC
       LIMIT $2 OFFSET $3`,
      [soulId, limit, offset]
    );
    return rows.map(rowToSoulVersion);
  }

  async getVersion(soulId: string, version: number): Promise<SoulVersion | null> {
    const row = await this.queryOne<SoulVersionRow>(
      `SELECT * FROM agent_soul_versions
       WHERE soul_id = $1 AND version = $2`,
      [soulId, version]
    );
    return row ? rowToSoulVersion(row) : null;
  }
}

// ── Singleton ──

let _instance: SoulsRepository | null = null;

export function getSoulsRepository(): SoulsRepository {
  if (!_instance) {
    _instance = new SoulsRepository();
  }
  return _instance;
}
