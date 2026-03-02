/**
 * Agent Messages Repository — inter-agent communication persistence
 */

import { BaseRepository, parseJsonField } from './base.js';
import type { AgentMessage, AgentMessageType } from '@ownpilot/core';

// ── DB Row Types ────────────────────────────────────

interface MessageRow {
  id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  type: string;
  subject: string | null;
  content: string;
  attachments: string;
  priority: string;
  thread_id: string | null;
  requires_response: boolean;
  deadline: string | null;
  status: string;
  crew_id: string | null;
  created_at: string;
  read_at: string | null;
}

// ── Row → Record Mapper ────────────────────────────

function rowToMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    from: row.from_agent_id ?? 'unknown',
    to: row.to_agent_id ?? 'unknown',
    type: row.type as AgentMessageType,
    subject: row.subject ?? '',
    content: row.content,
    attachments: parseJsonField(row.attachments, []),
    priority: row.priority as AgentMessage['priority'],
    threadId: row.thread_id ?? undefined,
    requiresResponse: row.requires_response,
    deadline: row.deadline ? new Date(row.deadline) : undefined,
    status: row.status as AgentMessage['status'],
    crewId: row.crew_id ?? undefined,
    createdAt: new Date(row.created_at),
    readAt: row.read_at ? new Date(row.read_at) : undefined,
  };
}

// ── Repository ──────────────────────────────────────

export class AgentMessagesRepository extends BaseRepository {
  async create(message: AgentMessage): Promise<void> {
    await this.execute(
      `INSERT INTO agent_messages
       (id, from_agent_id, to_agent_id, type, subject, content, attachments,
        priority, thread_id, requires_response, deadline, status, crew_id, created_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        message.id,
        message.from,
        message.to,
        message.type,
        message.subject,
        message.content,
        JSON.stringify(message.attachments ?? []),
        message.priority,
        message.threadId ?? null,
        message.requiresResponse,
        message.deadline?.toISOString() ?? null,
        message.status,
        message.crewId ?? null,
        message.createdAt.toISOString(),
        message.readAt?.toISOString() ?? null,
      ]
    );
  }

  async findForAgent(
    agentId: string,
    options: {
      unreadOnly?: boolean;
      limit?: number;
      types?: AgentMessageType[];
      fromAgent?: string;
    }
  ): Promise<AgentMessage[]> {
    const conditions: string[] = ['to_agent_id = $1'];
    const params: unknown[] = [agentId];
    let paramIdx = 2;

    if (options.unreadOnly) {
      conditions.push(`status != 'read'`);
    }
    if (options.types && options.types.length > 0) {
      conditions.push(`type = ANY($${paramIdx})`);
      params.push(options.types);
      paramIdx++;
    }
    if (options.fromAgent) {
      conditions.push(`from_agent_id = $${paramIdx}`);
      params.push(options.fromAgent);
      paramIdx++;
    }

    const limit = options.limit ?? 20;
    params.push(limit);

    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${paramIdx}`,
      params
    );
    return rows.map(rowToMessage);
  }

  async markAsRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.execute(
      `UPDATE agent_messages SET status = 'read', read_at = NOW() WHERE id = ANY($1)`,
      [ids]
    );
  }

  async getCrewMembers(crewId: string): Promise<string[]> {
    const rows = await this.query<{ agent_id: string }>(
      `SELECT agent_id FROM agent_crew_members WHERE crew_id = $1`,
      [crewId]
    );
    return rows.map((r) => r.agent_id);
  }

  async findConversation(a1: string, a2: string, limit: number): Promise<AgentMessage[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages
       WHERE (from_agent_id = $1 AND to_agent_id = $2)
          OR (from_agent_id = $2 AND to_agent_id = $1)
       ORDER BY created_at DESC
       LIMIT $3`,
      [a1, a2, limit]
    );
    return rows.map(rowToMessage);
  }

  async findByThread(threadId: string): Promise<AgentMessage[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages WHERE thread_id = $1 ORDER BY created_at`,
      [threadId]
    );
    return rows.map(rowToMessage);
  }

  async countUnread(agentId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM agent_messages WHERE to_agent_id = $1 AND status != 'read'`,
      [agentId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async countToday(crewId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM agent_messages
       WHERE crew_id = $1 AND created_at::date = CURRENT_DATE`,
      [crewId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async list(limit: number, offset: number): Promise<AgentMessage[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToMessage);
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM agent_messages`
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async listByAgent(agentId: string, limit: number, offset: number): Promise<AgentMessage[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages
       WHERE from_agent_id = $1 OR to_agent_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );
    return rows.map(rowToMessage);
  }

  async listByCrew(crewId: string, limit: number, offset: number): Promise<AgentMessage[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM agent_messages WHERE crew_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [crewId, limit, offset]
    );
    return rows.map(rowToMessage);
  }
}

// ── Singleton ──

let _instance: AgentMessagesRepository | null = null;

export function getAgentMessagesRepository(): AgentMessagesRepository {
  if (!_instance) {
    _instance = new AgentMessagesRepository();
  }
  return _instance;
}
