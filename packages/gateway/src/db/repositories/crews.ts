/**
 * Crew Repository — CRUD for agent_crews and agent_crew_members
 */

import { BaseRepository } from './base.js';
import type { AgentCrew, CrewMember, CrewCoordinationPattern, CrewStatus } from '@ownpilot/core';

// ── DB Row Types ────────────────────────────────────

interface CrewRow {
  id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  coordination_pattern: string;
  status: string;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  crew_id: string;
  agent_id: string;
  role: string;
  joined_at: string;
}

// ── Row → Record Mappers ────────────────────────────

function rowToCrew(row: CrewRow): AgentCrew {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    templateId: row.template_id ?? undefined,
    coordinationPattern: row.coordination_pattern as CrewCoordinationPattern,
    status: row.status as CrewStatus,
    workspaceId: row.workspace_id ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToMember(row: MemberRow): CrewMember {
  return {
    crewId: row.crew_id,
    agentId: row.agent_id,
    role: row.role,
    joinedAt: new Date(row.joined_at),
  };
}

// ── Repository ──────────────────────────────────────

export class CrewsRepository extends BaseRepository {
  async create(data: {
    name: string;
    description?: string;
    templateId?: string;
    coordinationPattern: CrewCoordinationPattern;
    status: CrewStatus;
    workspaceId?: string | null;
  }): Promise<AgentCrew> {
    const rows = await this.query<CrewRow>(
      `INSERT INTO agent_crews (name, description, template_id, coordination_pattern, status, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.name,
        data.description ?? null,
        data.templateId ?? null,
        data.coordinationPattern,
        data.status,
        data.workspaceId ?? null,
      ]
    );
    return rowToCrew(rows[0]!);
  }

  async getById(id: string, userId?: string | null): Promise<AgentCrew | null> {
    const row = userId
      ? await this.queryOne<CrewRow>(
          `SELECT * FROM agent_crews WHERE id = $1 AND workspace_id = $2`,
          [id, userId]
        )
      : await this.queryOne<CrewRow>(`SELECT * FROM agent_crews WHERE id = $1`, [id]);
    return row ? rowToCrew(row) : null;
  }

  async list(userId: string | null, limit: number, offset: number): Promise<AgentCrew[]> {
    const rows = userId
      ? await this.query<CrewRow>(
          `SELECT * FROM agent_crews WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        )
      : await this.query<CrewRow>(
          `SELECT * FROM agent_crews ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
    return rows.map(rowToCrew);
  }

  async count(userId?: string | null): Promise<number> {
    const row = userId
      ? await this.queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM agent_crews WHERE workspace_id = $1`,
          [userId]
        )
      : await this.queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM agent_crews`);
    return parseInt(row?.count ?? '0', 10);
  }

  async updateStatus(crewId: string, status: CrewStatus): Promise<void> {
    await this.execute(`UPDATE agent_crews SET status = $1, updated_at = NOW() WHERE id = $2`, [
      status,
      crewId,
    ]);
  }

  async addMember(crewId: string, agentId: string, role: string): Promise<void> {
    await this.execute(
      `INSERT INTO agent_crew_members (crew_id, agent_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (crew_id, agent_id) DO UPDATE SET role = $3`,
      [crewId, agentId, role]
    );
  }

  async getMembers(crewId: string): Promise<CrewMember[]> {
    const rows = await this.query<MemberRow>(
      `SELECT * FROM agent_crew_members WHERE crew_id = $1 ORDER BY joined_at`,
      [crewId]
    );
    return rows.map(rowToMember);
  }

  async removeMember(crewId: string, agentId: string): Promise<void> {
    await this.execute(`DELETE FROM agent_crew_members WHERE crew_id = $1 AND agent_id = $2`, [
      crewId,
      agentId,
    ]);
  }

  async removeAllMembers(crewId: string): Promise<void> {
    await this.execute(`DELETE FROM agent_crew_members WHERE crew_id = $1`, [crewId]);
  }

  async delete(crewId: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM agent_crews WHERE id = $1`, [crewId]);
    return result.changes > 0;
  }
}

// ── Singleton ──

let _instance: CrewsRepository | null = null;

export function getCrewsRepository(): CrewsRepository {
  if (!_instance) {
    _instance = new CrewsRepository();
  }
  return _instance;
}
