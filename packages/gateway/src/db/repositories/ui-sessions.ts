/**
 * UI Sessions Repository (PostgreSQL)
 *
 * Persistent store for UI and MCP session tokens.
 * Tokens are stored as hashes — raw tokens never touch the database.
 */

import { BaseRepository, ensureTable } from './base.js';

interface UISession {
  tokenHash: string;
  kind: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

interface UISessionRow {
  token_hash: string;
  kind: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  metadata: string;
}

function rowToSession(row: UISessionRow): UISession {
  return {
    tokenHash: row.token_hash,
    kind: row.kind,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    metadata: safeParseJSON(row.metadata),
  };
}

function safeParseJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ui_sessions (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'ui',
    user_id TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    metadata JSONB DEFAULT '{}'
  )
`;

const CREATE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_ui_sessions_expires_at ON ui_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_ui_sessions_kind ON ui_sessions(kind)
`;

export class UISessionsRepository extends BaseRepository {
  /**
   * Initialize the ui_sessions table and indexes
   */
  async initialize(): Promise<void> {
    await ensureTable('ui_sessions', CREATE_TABLE_SQL);
    await this.exec(CREATE_INDEXES_SQL);
  }

  /**
   * Create a new session record
   */
  async createSession(
    tokenHash: string,
    kind: string,
    userId: string,
    expiresAt: Date,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.execute(
      `INSERT INTO ui_sessions (token_hash, kind, user_id, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(token_hash) DO UPDATE SET
         kind = EXCLUDED.kind,
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         metadata = EXCLUDED.metadata`,
      [tokenHash, kind, userId, expiresAt.toISOString(), JSON.stringify(metadata ?? {})]
    );
  }

  /**
   * Get a session by its token hash
   */
  async getByTokenHash(tokenHash: string): Promise<UISession | null> {
    const row = await this.queryOne<UISessionRow>(
      'SELECT * FROM ui_sessions WHERE token_hash = $1',
      [tokenHash]
    );
    return row ? rowToSession(row) : null;
  }

  /**
   * Delete a session by its token hash
   */
  async deleteByTokenHash(tokenHash: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM ui_sessions WHERE token_hash = $1', [tokenHash]);
    return result.changes > 0;
  }

  /**
   * Delete all sessions
   */
  async deleteAll(): Promise<number> {
    const result = await this.execute('DELETE FROM ui_sessions');
    return result.changes;
  }

  /**
   * Delete expired sessions
   */
  async deleteExpired(): Promise<number> {
    const result = await this.execute('DELETE FROM ui_sessions WHERE expires_at < NOW()');
    return result.changes;
  }

  /**
   * Count active (non-expired) sessions
   */
  async countActive(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM ui_sessions WHERE expires_at > NOW()'
    );
    return parseInt(row?.count ?? '0', 10);
  }

  /**
   * List active sessions (for admin/debugging)
   */
  async listActive(limit: number = 100): Promise<UISession[]> {
    const rows = await this.query<UISessionRow>(
      'SELECT * FROM ui_sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows.map(rowToSession);
  }
}

export const uiSessionsRepo = new UISessionsRepository();

export function createUISessionsRepository(): UISessionsRepository {
  return new UISessionsRepository();
}

export async function initializeUISessionsRepo(): Promise<void> {
  await uiSessionsRepo.initialize();
}
