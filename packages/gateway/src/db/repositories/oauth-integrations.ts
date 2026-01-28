/**
 * OAuth Integrations Repository
 *
 * Manages OAuth connections to external services (Gmail, Calendar, Drive, etc.)
 * Tokens are encrypted using AES-256-GCM before storage.
 */

import { BaseRepository } from './base.js';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export type OAuthProvider = 'google' | 'microsoft' | 'github';
export type OAuthService = 'gmail' | 'calendar' | 'drive' | 'outlook' | 'onedrive' | 'github';
export type IntegrationStatus = 'active' | 'expired' | 'revoked' | 'error';

export interface OAuthIntegration {
  id: string;
  userId: string;
  provider: OAuthProvider;
  service: OAuthService;
  expiresAt?: Date;
  scopes: string[];
  email?: string;
  status: IntegrationStatus;
  lastSyncAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIntegrationInput {
  userId?: string;
  provider: OAuthProvider;
  service: OAuthService;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  email?: string;
}

export interface UpdateIntegrationInput {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  status?: IntegrationStatus;
  lastSyncAt?: Date;
  errorMessage?: string;
}

interface IntegrationRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  provider: string;
  service: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_iv: string;
  expires_at: string | null;
  scopes: string;
  email: string | null;
  status: string;
  last_sync_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Encryption Helpers
// ============================================================================

// Encryption key from environment or generate a default (should be set in production)
function getEncryptionKey(): Buffer {
  const keyHex = process.env.OAUTH_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (keyHex && keyHex.length === 64) {
    return Buffer.from(keyHex, 'hex');
  }
  // Fallback: derive from a secret (less secure, but works for development)
  const secret = process.env.JWT_SECRET || process.env.API_KEYS || 'ownpilot-default-key';
  return createHash('sha256').update(secret).digest();
}

function encryptToken(token: string): { encrypted: string; iv: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Combine encrypted data and auth tag
  return {
    encrypted: encrypted + '.' + authTag.toString('base64'),
    iv: iv.toString('base64'),
  };
}

function decryptToken(encrypted: string, ivBase64: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivBase64, 'base64');

  const parts = encrypted.split('.');
  const encryptedData = parts[0] ?? '';
  const authTagBase64 = parts[1] ?? '';
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ============================================================================
// Row Mapping
// ============================================================================

function rowToIntegration(row: IntegrationRow): OAuthIntegration {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as OAuthProvider,
    service: row.service as OAuthService,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes,
    email: row.email || undefined,
    status: row.status as IntegrationStatus,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : undefined,
    errorMessage: row.error_message || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class OAuthIntegrationsRepository extends BaseRepository {
  /**
   * Create a new OAuth integration
   */
  async create(input: CreateIntegrationInput): Promise<OAuthIntegration> {
    const id = randomUUID();
    const userId = input.userId || 'default';
    const now = new Date().toISOString();

    // Encrypt tokens
    const { encrypted: accessEncrypted, iv } = encryptToken(input.accessToken);
    const refreshEncrypted = input.refreshToken
      ? encryptToken(input.refreshToken).encrypted
      : null;

    await this.execute(
      `INSERT INTO oauth_integrations (
        id, user_id, provider, service,
        access_token_encrypted, refresh_token_encrypted, token_iv,
        expires_at, scopes, email, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)`,
      [
        id,
        userId,
        input.provider,
        input.service,
        accessEncrypted,
        refreshEncrypted,
        iv,
        input.expiresAt?.toISOString() || null,
        JSON.stringify(input.scopes),
        input.email || null,
        now,
        now,
      ]
    );

    return (await this.getById(id))!;
  }

  /**
   * Get integration by ID
   */
  async getById(id: string): Promise<OAuthIntegration | null> {
    const row = await this.queryOne<IntegrationRow>(
      'SELECT * FROM oauth_integrations WHERE id = $1',
      [id]
    );
    return row ? rowToIntegration(row) : null;
  }

  /**
   * Get integration by user, provider, and service
   */
  async getByUserProviderService(
    userId: string,
    provider: OAuthProvider,
    service: OAuthService
  ): Promise<OAuthIntegration | null> {
    const row = await this.queryOne<IntegrationRow>(
      `SELECT * FROM oauth_integrations
       WHERE user_id = $1 AND provider = $2 AND service = $3`,
      [userId, provider, service]
    );
    return row ? rowToIntegration(row) : null;
  }

  /**
   * Get decrypted tokens for an integration
   */
  async getTokens(id: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null> {
    const row = await this.queryOne<IntegrationRow>(
      `SELECT access_token_encrypted, refresh_token_encrypted, token_iv, expires_at
       FROM oauth_integrations WHERE id = $1`,
      [id]
    );

    if (!row) return null;

    try {
      const accessToken = decryptToken(row.access_token_encrypted, row.token_iv);
      const refreshToken = row.refresh_token_encrypted
        ? decryptToken(row.refresh_token_encrypted, row.token_iv)
        : undefined;
      const expiresAt = row.expires_at ? new Date(row.expires_at) : undefined;

      return { accessToken, refreshToken, expiresAt };
    } catch (error) {
      console.error('Failed to decrypt tokens:', error);
      return null;
    }
  }

  /**
   * Update integration tokens
   */
  async updateTokens(
    id: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date }
  ): Promise<boolean> {
    const { encrypted: accessEncrypted, iv } = encryptToken(tokens.accessToken);
    const refreshEncrypted = tokens.refreshToken
      ? encryptToken(tokens.refreshToken).encrypted
      : null;

    const result = await this.execute(
      `UPDATE oauth_integrations SET
        access_token_encrypted = $1,
        refresh_token_encrypted = COALESCE($2, refresh_token_encrypted),
        token_iv = $3,
        expires_at = $4,
        status = 'active',
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $5`,
      [
        accessEncrypted,
        refreshEncrypted,
        iv,
        tokens.expiresAt?.toISOString() || null,
        id,
      ]
    );

    return result.changes > 0;
  }

  /**
   * Update integration status
   */
  async updateStatus(id: string, status: IntegrationStatus, errorMessage?: string): Promise<boolean> {
    const result = await this.execute(
      `UPDATE oauth_integrations SET
        status = $1,
        error_message = $2,
        updated_at = NOW()
      WHERE id = $3`,
      [status, errorMessage || null, id]
    );

    return result.changes > 0;
  }

  /**
   * Update last sync time
   */
  async updateLastSync(id: string): Promise<boolean> {
    const result = await this.execute(
      `UPDATE oauth_integrations SET
        last_sync_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [id]
    );

    return result.changes > 0;
  }

  /**
   * List all integrations for a user
   */
  async listByUser(userId: string = 'default'): Promise<OAuthIntegration[]> {
    const rows = await this.query<IntegrationRow>(
      `SELECT * FROM oauth_integrations
       WHERE user_id = $1
       ORDER BY provider, service`,
      [userId]
    );
    return rows.map(rowToIntegration);
  }

  /**
   * List active integrations for a user
   */
  async listActiveByUser(userId: string = 'default'): Promise<OAuthIntegration[]> {
    const rows = await this.query<IntegrationRow>(
      `SELECT * FROM oauth_integrations
       WHERE user_id = $1 AND status = 'active'
       ORDER BY provider, service`,
      [userId]
    );
    return rows.map(rowToIntegration);
  }

  /**
   * List integrations by provider
   */
  async listByProvider(userId: string, provider: OAuthProvider): Promise<OAuthIntegration[]> {
    const rows = await this.query<IntegrationRow>(
      `SELECT * FROM oauth_integrations
       WHERE user_id = $1 AND provider = $2
       ORDER BY service`,
      [userId, provider]
    );
    return rows.map(rowToIntegration);
  }

  /**
   * Check if a service is connected
   */
  async isConnected(userId: string, provider: OAuthProvider, service: OAuthService): Promise<boolean> {
    const result = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM oauth_integrations
       WHERE user_id = $1 AND provider = $2 AND service = $3 AND status = 'active'`,
      [userId, provider, service]
    );
    return parseInt(result?.count ?? '0', 10) > 0;
  }

  /**
   * Delete an integration
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM oauth_integrations WHERE id = $1', [id]);
    return result.changes > 0;
  }

  /**
   * Delete all integrations for a user
   */
  async deleteByUser(userId: string): Promise<number> {
    const result = await this.execute('DELETE FROM oauth_integrations WHERE user_id = $1', [userId]);
    return result.changes;
  }

  /**
   * Find expired integrations that need token refresh
   */
  async findExpiring(minutesBeforeExpiry: number = 5): Promise<OAuthIntegration[]> {
    const rows = await this.query<IntegrationRow>(
      `SELECT * FROM oauth_integrations
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at <= NOW() + ($1 || ' minutes')::INTERVAL
       ORDER BY expires_at ASC`,
      [minutesBeforeExpiry]
    );
    return rows.map(rowToIntegration);
  }
}

// Singleton instance
export const oauthIntegrationsRepo = new OAuthIntegrationsRepository();

// Factory function
export function createOAuthIntegrationsRepository(): OAuthIntegrationsRepository {
  return new OAuthIntegrationsRepository();
}
