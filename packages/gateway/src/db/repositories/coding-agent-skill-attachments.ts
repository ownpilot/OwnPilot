/**
 * Coding Agent Skill Attachments Repository
 *
 * Skills/instructions attached to a coding agent provider.
 * These are injected into the agent's system prompt when creating sessions.
 */

import { BaseRepository, parseBool } from './base.js';

// =============================================================================
// ROW TYPE
// =============================================================================

interface SkillAttachmentRow {
  id: string;
  user_id: string;
  provider_ref: string;
  type: string;
  extension_id: string | null;
  label: string | null;
  instructions: string | null;
  priority: number;
  active: boolean | number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type SkillAttachmentType = 'extension' | 'inline';

export interface SkillAttachmentRecord {
  id: string;
  userId: string;
  providerRef: string;
  type: SkillAttachmentType;
  extensionId?: string;
  label?: string;
  instructions?: string;
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillAttachmentInput {
  providerRef: string;
  type: SkillAttachmentType;
  extensionId?: string;
  label?: string;
  instructions?: string;
  priority?: number;
}

export interface UpdateSkillAttachmentInput {
  label?: string;
  instructions?: string;
  priority?: number;
  active?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: SkillAttachmentRow): SkillAttachmentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    providerRef: row.provider_ref,
    type: row.type as SkillAttachmentType,
    extensionId: row.extension_id ?? undefined,
    label: row.label ?? undefined,
    instructions: row.instructions ?? undefined,
    priority: Number(row.priority),
    active: parseBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CodingAgentSkillAttachmentsRepository extends BaseRepository {
  async create(
    input: CreateSkillAttachmentInput,
    userId = 'default'
  ): Promise<SkillAttachmentRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO coding_agent_skill_attachments (
        id, user_id, provider_ref, type, extension_id, label, instructions,
        priority, active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        userId,
        input.providerRef,
        input.type,
        input.extensionId ?? null,
        input.label ?? null,
        input.instructions ?? null,
        input.priority ?? 0,
        true,
        now,
        now,
      ]
    );

    const record = await this.getById(id, userId);
    if (!record) throw new Error('Failed to create skill attachment');
    return record;
  }

  async getById(id: string, userId = 'default'): Promise<SkillAttachmentRecord | null> {
    const row = await this.queryOne<SkillAttachmentRow>(
      'SELECT * FROM coding_agent_skill_attachments WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async listByProvider(
    providerRef: string,
    userId = 'default'
  ): Promise<SkillAttachmentRecord[]> {
    const rows = await this.query<SkillAttachmentRow>(
      `SELECT * FROM coding_agent_skill_attachments
       WHERE provider_ref = $1 AND user_id = $2
       ORDER BY priority ASC, created_at ASC`,
      [providerRef, userId]
    );
    return rows.map(rowToRecord);
  }

  async listAllActive(userId = 'default'): Promise<SkillAttachmentRecord[]> {
    const rows = await this.query<SkillAttachmentRow>(
      `SELECT * FROM coding_agent_skill_attachments
       WHERE user_id = $1 AND active = TRUE
       ORDER BY provider_ref, priority ASC`,
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async update(
    id: string,
    input: UpdateSkillAttachmentInput,
    userId = 'default'
  ): Promise<SkillAttachmentRecord | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`);
      values.push(value);
    };

    if (input.label !== undefined) addField('label', input.label);
    if (input.instructions !== undefined) addField('instructions', input.instructions);
    if (input.priority !== undefined) addField('priority', input.priority);
    if (input.active !== undefined) addField('active', input.active);

    if (setClauses.length === 0) return existing;

    addField('updated_at', new Date().toISOString());
    values.push(id, userId);

    await this.execute(
      `UPDATE coding_agent_skill_attachments SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx} AND user_id = $${paramIdx + 1}`,
      values
    );

    return this.getById(id, userId);
  }

  async delete(id: string, userId = 'default'): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM coding_agent_skill_attachments WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (result?.changes ?? 0) > 0;
  }

  async deleteByProvider(providerRef: string, userId = 'default'): Promise<number> {
    const result = await this.execute(
      'DELETE FROM coding_agent_skill_attachments WHERE provider_ref = $1 AND user_id = $2',
      [providerRef, userId]
    );
    return result?.changes ?? 0;
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const codingAgentSkillAttachmentsRepo = new CodingAgentSkillAttachmentsRepository();

export function createCodingAgentSkillAttachmentsRepository(): CodingAgentSkillAttachmentsRepository {
  return new CodingAgentSkillAttachmentsRepository();
}
