/**
 * OAuth Integrations Repository
 *
 * Manages OAuth connections to external services (Gmail, Calendar, Drive, etc.)
 * Tokens are encrypted using AES-256-GCM before storage.
 */

import { getDatabase } from '../connection.js';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

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
  const crypto = require('node:crypto');
  const secret = process.env.JWT_SECRET || process.env.API_KEYS || 'ownpilot-default-key';
  return crypto.createHash('sha256').update(secret).digest();
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
    scopes: JSON.parse(row.scopes),
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

export class OAuthIntegrationsRepository {
  private db = getDatabase();

  /**
   * Create a new OAuth integration
   */
  create(input: CreateIntegrationInput): OAuthIntegration {
    const id = randomUUID();
    const userId = input.userId || 'default';

    // Encrypt tokens
    const { encrypted: accessEncrypted, iv } = encryptToken(input.accessToken);
    const refreshEncrypted = input.refreshToken
      ? encryptToken(input.refreshToken).encrypted
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO oauth_integrations (
        id, user_id, provider, service,
        access_token_encrypted, refresh_token_encrypted, token_iv,
        expires_at, scopes, email, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);

    stmt.run(
      id,
      userId,
      input.provider,
      input.service,
      accessEncrypted,
      refreshEncrypted,
      iv,
      input.expiresAt?.toISOString() || null,
      JSON.stringify(input.scopes),
      input.email || null
    );

    return this.getById(id)!;
  }

  /**
   * Get integration by ID
   */
  getById(id: string): OAuthIntegration | null {
    const stmt = this.db.prepare<string, IntegrationRow>(`
      SELECT * FROM oauth_integrations WHERE id = ?
    `);
    const row = stmt.get(id);
    return row ? rowToIntegration(row) : null;
  }

  /**
   * Get integration by user, provider, and service
   */
  getByUserProviderService(
    userId: string,
    provider: OAuthProvider,
    service: OAuthService
  ): OAuthIntegration | null {
    const stmt = this.db.prepare<[string, string, string], IntegrationRow>(`
      SELECT * FROM oauth_integrations
      WHERE user_id = ? AND provider = ? AND service = ?
    `);
    const row = stmt.get(userId, provider, service);
    return row ? rowToIntegration(row) : null;
  }

  /**
   * Get decrypted tokens for an integration
   */
  getTokens(id: string): { accessToken: string; refreshToken?: string; expiresAt?: Date } | null {
    const stmt = this.db.prepare<string, IntegrationRow>(`
      SELECT access_token_encrypted, refresh_token_encrypted, token_iv, expires_at
      FROM oauth_integrations WHERE id = ?
    `);
    const row = stmt.get(id);

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
  updateTokens(
    id: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date }
  ): boolean {
    const { encrypted: accessEncrypted, iv } = encryptToken(tokens.accessToken);
    const refreshEncrypted = tokens.refreshToken
      ? encryptToken(tokens.refreshToken).encrypted
      : null;

    const stmt = this.db.prepare(`
      UPDATE oauth_integrations SET
        access_token_encrypted = ?,
        refresh_token_encrypted = COALESCE(?, refresh_token_encrypted),
        token_iv = ?,
        expires_at = ?,
        status = 'active',
        error_message = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(
      accessEncrypted,
      refreshEncrypted,
      iv,
      tokens.expiresAt?.toISOString() || null,
      id
    );

    return result.changes > 0;
  }

  /**
   * Update integration status
   */
  updateStatus(id: string, status: IntegrationStatus, errorMessage?: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE oauth_integrations SET
        status = ?,
        error_message = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(status, errorMessage || null, id);
    return result.changes > 0;
  }

  /**
   * Update last sync time
   */
  updateLastSync(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE oauth_integrations SET
        last_sync_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * List all integrations for a user
   */
  listByUser(userId: string = 'default'): OAuthIntegration[] {
    const stmt = this.db.prepare<string, IntegrationRow>(`
      SELECT * FROM oauth_integrations
      WHERE user_id = ?
      ORDER BY provider, service
    `);
    return stmt.all(userId).map(rowToIntegration);
  }

  /**
   * List active integrations for a user
   */
  listActiveByUser(userId: string = 'default'): OAuthIntegration[] {
    const stmt = this.db.prepare<string, IntegrationRow>(`
      SELECT * FROM oauth_integrations
      WHERE user_id = ? AND status = 'active'
      ORDER BY provider, service
    `);
    return stmt.all(userId).map(rowToIntegration);
  }

  /**
   * List integrations by provider
   */
  listByProvider(userId: string, provider: OAuthProvider): OAuthIntegration[] {
    const stmt = this.db.prepare<[string, string], IntegrationRow>(`
      SELECT * FROM oauth_integrations
      WHERE user_id = ? AND provider = ?
      ORDER BY service
    `);
    return stmt.all(userId, provider).map(rowToIntegration);
  }

  /**
   * Check if a service is connected
   */
  isConnected(userId: string, provider: OAuthProvider, service: OAuthService): boolean {
    const stmt = this.db.prepare<[string, string, string], { count: number }>(`
      SELECT COUNT(*) as count FROM oauth_integrations
      WHERE user_id = ? AND provider = ? AND service = ? AND status = 'active'
    `);
    const result = stmt.get(userId, provider, service);
    return (result?.count ?? 0) > 0;
  }

  /**
   * Delete an integration
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM oauth_integrations WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete all integrations for a user
   */
  deleteByUser(userId: string): number {
    const stmt = this.db.prepare(`DELETE FROM oauth_integrations WHERE user_id = ?`);
    const result = stmt.run(userId);
    return result.changes;
  }

  /**
   * Find expired integrations that need token refresh
   */
  findExpiring(minutesBeforeExpiry: number = 5): OAuthIntegration[] {
    const stmt = this.db.prepare<number, IntegrationRow>(`
      SELECT * FROM oauth_integrations
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND datetime(expires_at) <= datetime('now', '+' || ? || ' minutes')
      ORDER BY expires_at ASC
    `);
    return stmt.all(minutesBeforeExpiry).map(rowToIntegration);
  }
}

export const oauthIntegrationsRepo = new OAuthIntegrationsRepository();
