/**
 * Crew Shared Memory Repository — CRUD for crew_shared_memory
 */

import { BaseRepository } from './base.js';

// ── DB Row Type ─────────────────────────────────────

interface MemoryRow {
  id: string;
  crew_id: string;
  agent_id: string;
  category: string;
  title: string;
  content: string;
  metadata: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Record Type ─────────────────────────────────────

export interface CrewMemoryEntry {
  id: string;
  crewId: string;
  agentId: string;
  category: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Row → Record Mapper ─────────────────────────────

function rowToEntry(row: MemoryRow): CrewMemoryEntry {
  return {
    id: row.id,
    crewId: row.crew_id,
    agentId: row.agent_id,
    category: row.category,
    title: row.title,
    content: row.content,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ── Repository ──────────────────────────────────────

export class CrewMemoryRepository extends BaseRepository {
  async create(
    crewId: string,
    agentId: string,
    category: string,
    title: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<CrewMemoryEntry> {
    const rows = await this.query<MemoryRow>(
      `INSERT INTO crew_shared_memory (crew_id, agent_id, category, title, content, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [crewId, agentId, category, title, content, JSON.stringify(metadata ?? {})]
    );
    return rowToEntry(rows[0]!);
  }

  async list(
    crewId: string,
    category?: string,
    limit = 20,
    offset = 0
  ): Promise<{ entries: CrewMemoryEntry[]; total: number }> {
    const whereClause = category
      ? 'WHERE crew_id = $1 AND category = $2'
      : 'WHERE crew_id = $1';
    const params = category ? [crewId, category] : [crewId];

    const countRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM crew_shared_memory ${whereClause}`,
      params
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows = await this.query<MemoryRow>(
      `SELECT * FROM crew_shared_memory ${whereClause}
       ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );

    return { entries: rows.map(rowToEntry), total };
  }

  async search(crewId: string, query: string, limit = 10): Promise<CrewMemoryEntry[]> {
    const pattern = `%${query}%`;
    const rows = await this.query<MemoryRow>(
      `SELECT * FROM crew_shared_memory
       WHERE crew_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY created_at DESC LIMIT $3`,
      [crewId, pattern, limit]
    );
    return rows.map(rowToEntry);
  }

  async getById(id: string): Promise<CrewMemoryEntry | null> {
    const row = await this.queryOne<MemoryRow>(
      `SELECT * FROM crew_shared_memory WHERE id = $1`,
      [id]
    );
    return row ? rowToEntry(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM crew_shared_memory WHERE id = $1`,
      [id]
    );
    return result.changes > 0;
  }
}

// ── Singleton ───────────────────────────────────────

let _instance: CrewMemoryRepository | null = null;

export function getCrewMemoryRepository(): CrewMemoryRepository {
  if (!_instance) {
    _instance = new CrewMemoryRepository();
  }
  return _instance;
}
