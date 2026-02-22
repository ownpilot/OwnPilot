/**
 * MCP Servers Repository
 *
 * Manages external MCP server configurations and connection state.
 * Supports stdio, SSE, and Streamable HTTP transports.
 */

import { BaseRepository, parseJsonField } from './base.js';
import { getLog } from '../../services/log.js';

const log = getLog('McpServersRepo');

// =============================================================================
// ROW TYPES
// =============================================================================

interface McpServerRow {
  id: string;
  user_id: string;
  name: string;
  display_name: string;
  transport: string;
  command: string | null;
  args: string | null;  // JSONB
  env: string | null;   // JSONB
  url: string | null;
  headers: string | null; // JSONB
  enabled: number | boolean;
  auto_connect: number | boolean;
  status: string;
  error_message: string | null;
  tool_count: number;
  metadata: string | null; // JSONB
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

export interface McpServerRecord {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  transport: McpTransport;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  enabled: boolean;
  autoConnect: boolean;
  status: McpStatus;
  errorMessage?: string;
  toolCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpServerInput {
  name: string;
  displayName: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
  userId?: string;
}

export interface UpdateMcpServerInput {
  name?: string;
  displayName?: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// HELPERS
// =============================================================================


function rowToRecord(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    displayName: row.display_name,
    transport: row.transport as McpTransport,
    command: row.command ?? undefined,
    args: parseJsonField<string[]>(row.args, []),
    env: parseJsonField<Record<string, string>>(row.env, {}),
    url: row.url ?? undefined,
    headers: parseJsonField<Record<string, string>>(row.headers, {}),
    enabled: Boolean(row.enabled),
    autoConnect: Boolean(row.auto_connect),
    status: row.status as McpStatus,
    errorMessage: row.error_message ?? undefined,
    toolCount: row.tool_count,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

class McpServersRepository extends BaseRepository {

  async getAll(userId = 'default'): Promise<McpServerRecord[]> {
    const rows = await this.query<McpServerRow>(
      'SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY display_name',
      [userId],
    );
    return rows.map(rowToRecord);
  }

  async getById(id: string): Promise<McpServerRecord | null> {
    const rows = await this.query<McpServerRow>(
      'SELECT * FROM mcp_servers WHERE id = ?',
      [id],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByName(name: string, userId = 'default'): Promise<McpServerRecord | null> {
    const rows = await this.query<McpServerRow>(
      'SELECT * FROM mcp_servers WHERE name = ? AND user_id = ?',
      [name, userId],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getEnabled(userId = 'default'): Promise<McpServerRecord[]> {
    const rows = await this.query<McpServerRow>(
      'SELECT * FROM mcp_servers WHERE user_id = ? AND enabled = TRUE AND auto_connect = TRUE ORDER BY display_name',
      [userId],
    );
    return rows.map(rowToRecord);
  }

  async create(input: CreateMcpServerInput): Promise<McpServerRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userId = input.userId ?? 'default';

    await this.execute(
      `INSERT INTO mcp_servers (id, user_id, name, display_name, transport, command, args, env, url, headers, enabled, auto_connect, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disconnected', ?, ?)`,
      [
        id,
        userId,
        input.name,
        input.displayName,
        input.transport,
        input.command ?? null,
        JSON.stringify(input.args ?? []),
        JSON.stringify(input.env ?? {}),
        input.url ?? null,
        JSON.stringify(input.headers ?? {}),
        input.enabled !== false,
        input.autoConnect !== false,
        now,
        now,
      ],
    );

    const record = await this.getById(id);
    if (!record) throw new Error('Failed to create MCP server record');
    return record;
  }

  async update(id: string, input: UpdateMcpServerInput): Promise<McpServerRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { setClauses.push('name = ?'); values.push(input.name); }
    if (input.displayName !== undefined) { setClauses.push('display_name = ?'); values.push(input.displayName); }
    if (input.transport !== undefined) { setClauses.push('transport = ?'); values.push(input.transport); }
    if (input.command !== undefined) { setClauses.push('command = ?'); values.push(input.command); }
    if (input.args !== undefined) { setClauses.push('args = ?'); values.push(JSON.stringify(input.args)); }
    if (input.env !== undefined) { setClauses.push('env = ?'); values.push(JSON.stringify(input.env)); }
    if (input.url !== undefined) { setClauses.push('url = ?'); values.push(input.url); }
    if (input.headers !== undefined) { setClauses.push('headers = ?'); values.push(JSON.stringify(input.headers)); }
    if (input.enabled !== undefined) { setClauses.push('enabled = ?'); values.push(input.enabled); }
    if (input.autoConnect !== undefined) { setClauses.push('auto_connect = ?'); values.push(input.autoConnect); }
    if (input.metadata !== undefined) { setClauses.push('metadata = ?'); values.push(JSON.stringify(input.metadata)); }

    if (setClauses.length === 0) return existing;

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.execute(
      `UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM mcp_servers WHERE id = ?', [id]);
    return (result?.changes ?? 0) > 0;
  }

  async updateStatus(
    id: string,
    status: McpStatus,
    errorMessage?: string,
    toolCount?: number,
  ): Promise<void> {
    const setClauses = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, new Date().toISOString()];

    if (errorMessage !== undefined) {
      setClauses.push('error_message = ?');
      values.push(errorMessage || null);
    }
    if (toolCount !== undefined) {
      setClauses.push('tool_count = ?');
      values.push(toolCount);
    }

    values.push(id);
    await this.execute(
      `UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
  }
}

// =============================================================================
// SINGLETON + INITIALIZATION
// =============================================================================

let instance: McpServersRepository | null = null;

export function getMcpServersRepo(): McpServersRepository {
  if (!instance) {
    instance = new McpServersRepository();
  }
  return instance;
}

export async function initializeMcpServersRepo(): Promise<void> {
  const repo = getMcpServersRepo();
  // Ensure the repository is functional (table should already exist from schema)
  try {
    await repo.getAll();
    log.info('MCP Servers repository initialized');
  } catch (err) {
    log.warn('MCP Servers table may not exist yet', { error: String(err) });
  }
}
