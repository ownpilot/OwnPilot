/**
 * OAuthIntegrationsRepository Tests
 *
 * Tests CRUD operations, token encryption/decryption, status updates,
 * listing/filtering, isConnected, and row-to-entity mapping.
 *
 * Note: Encryption helpers (encryptToken, decryptToken) are module-private,
 * so they are tested indirectly through create, getTokens, and updateTokens.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { OAuthIntegrationsRepository, createOAuthIntegrationsRepository } =
  await import('./oauth-integrations.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2024-06-01T12:00:00Z';

function makeIntegrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    user_id: 'default',
    provider: 'google',
    service: 'gmail',
    access_token_encrypted: 'encrypted-access',
    refresh_token_encrypted: null,
    token_iv: 'base64-iv',
    expires_at: null,
    scopes: '["read","send"]',
    email: null,
    status: 'active',
    last_sync_at: null,
    error_message: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthIntegrationsRepository', () => {
  let repo: InstanceType<typeof OAuthIntegrationsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new OAuthIntegrationsRepository();
  });

  // ---- create ----

  describe('create', () => {
    it('inserts an integration with encrypted tokens and returns it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      const result = await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'my-access-token',
        scopes: ['read', 'send'],
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oauth_integrations'),
        expect.arrayContaining([expect.any(String), 'default', 'google', 'gmail']),
      );
      expect(result.id).toBe('int-1');
      expect(result.provider).toBe('google');
      expect(result.service).toBe('gmail');
      expect(result.status).toBe('active');
      expect(result.scopes).toEqual(['read', 'send']);
    });

    it('uses provided userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ user_id: 'user-1' }),
      );

      const result = await repo.create({
        userId: 'user-1',
        provider: 'google',
        service: 'gmail',
        accessToken: 'token',
        scopes: ['read'],
      });

      expect(result.userId).toBe('user-1');
      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('user-1');
    });

    it('defaults userId to "default"', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'token',
        scopes: [],
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('default');
    });

    it('stores encrypted access and refresh tokens', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'my-secret-token',
        refreshToken: 'my-refresh-token',
        scopes: ['read'],
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      // Encrypted access token should not be the raw value
      expect(params[4]).not.toBe('my-secret-token');
      // Encrypted refresh token should be set
      expect(params[5]).not.toBeNull();
      // IV should be set
      expect(params[6]).toBeDefined();
    });

    it('sets refresh token to null when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'token',
        scopes: [],
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[5]).toBeNull();
    });

    it('throws when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          provider: 'google',
          service: 'gmail',
          accessToken: 'token',
          scopes: [],
        }),
      ).rejects.toThrow('Failed to create OAuth integration');
    });

    it('passes expiresAt and email when provided', async () => {
      const expiresAt = new Date('2024-06-01T13:00:00Z');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({
          expires_at: expiresAt.toISOString(),
          email: 'test@gmail.com',
        }),
      );

      const result = await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'token',
        scopes: ['read'],
        expiresAt,
        email: 'test@gmail.com',
      });

      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.email).toBe('test@gmail.com');
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns an integration when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeIntegrationRow());

      const result = await repo.getById('int-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('int-1');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['int-1'],
      );
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('missing');

      expect(result).toBeNull();
    });
  });

  // ---- getByUserProviderService ----

  describe('getByUserProviderService', () => {
    it('returns integration by user/provider/service', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeIntegrationRow());

      const result = await repo.getByUserProviderService('default', 'google', 'gmail');

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('google');
      expect(result!.service).toBe('gmail');
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('provider = $2');
      expect(sql).toContain('service = $3');
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getByUserProviderService('user-1', 'github', 'github');

      expect(result).toBeNull();
    });
  });

  // ---- getTokens ----

  describe('getTokens', () => {
    it('returns null when integration not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getTokens('missing');

      expect(result).toBeNull();
    });

    it('returns decrypted access token for a valid integration', async () => {
      // Create an integration (access token only) to get real encrypted values
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeIntegrationRow());

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'my-access',
        scopes: [],
      });

      // Get the encrypted values and IV that were stored
      const createParams = mockAdapter.execute.mock.calls[0][1] as unknown[];
      const accessEncrypted = createParams[4] as string;
      const iv = createParams[6] as string;

      // Now mock getTokens queryOne to return those encrypted values
      mockAdapter.queryOne.mockResolvedValueOnce({
        access_token_encrypted: accessEncrypted,
        refresh_token_encrypted: null,
        token_iv: iv,
        expires_at: null,
      });

      const result = await repo.getTokens('int-1');

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe('my-access');
      expect(result!.refreshToken).toBeUndefined();
      expect(result!.expiresAt).toBeUndefined();
    });

    it('queries by integration id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getTokens('int-42');

      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('access_token_encrypted');
      expect(sql).toContain('refresh_token_encrypted');
      expect(sql).toContain('token_iv');
      expect(sql).toContain('WHERE id = $1');
      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.any(String),
        ['int-42'],
      );
    });

    it('returns null refreshToken when not stored', async () => {
      // Create without refresh token
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'my-access',
        scopes: [],
      });

      const createParams = mockAdapter.execute.mock.calls[0][1] as unknown[];
      const accessEncrypted = createParams[4] as string;
      const iv = createParams[6] as string;

      mockAdapter.queryOne.mockResolvedValueOnce({
        access_token_encrypted: accessEncrypted,
        refresh_token_encrypted: null,
        token_iv: iv,
        expires_at: null,
      });

      const result = await repo.getTokens('int-1');

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe('my-access');
      expect(result!.refreshToken).toBeUndefined();
    });

    it('returns expiresAt when present', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow(),
      );

      await repo.create({
        provider: 'google',
        service: 'gmail',
        accessToken: 'my-access',
        scopes: [],
      });

      const createParams = mockAdapter.execute.mock.calls[0][1] as unknown[];

      mockAdapter.queryOne.mockResolvedValueOnce({
        access_token_encrypted: createParams[4],
        refresh_token_encrypted: null,
        token_iv: createParams[6],
        expires_at: '2024-06-01T13:00:00Z',
      });

      const result = await repo.getTokens('int-1');

      expect(result!.expiresAt).toBeInstanceOf(Date);
    });

    it('returns null when decryption fails', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        access_token_encrypted: 'bad-data',
        refresh_token_encrypted: null,
        token_iv: 'bad-iv',
        expires_at: null,
      });

      const result = await repo.getTokens('int-1');

      expect(result).toBeNull();
    });
  });

  // ---- updateTokens ----

  describe('updateTokens', () => {
    it('updates encrypted tokens and returns true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateTokens('int-1', {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE oauth_integrations SET'),
        expect.any(Array),
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('access_token_encrypted = $1');
      expect(sql).toContain('token_iv = $3');
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('error_message = NULL');

      // Verify encrypted values are not raw tokens
      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[0]).not.toBe('new-access');
    });

    it('returns false when integration not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateTokens('missing', {
        accessToken: 'new-access',
      });

      expect(result).toBe(false);
    });

    it('sets refresh token to null when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateTokens('int-1', {
        accessToken: 'new-access',
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBeNull();
    });

    it('passes expiresAt when provided', async () => {
      const expiresAt = new Date('2024-06-01T14:00:00Z');
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateTokens('int-1', {
        accessToken: 'new-access',
        expiresAt,
      });

      const params = mockAdapter.execute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe(expiresAt.toISOString());
    });
  });

  // ---- updateStatus ----

  describe('updateStatus', () => {
    it('updates status and returns true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateStatus('int-1', 'expired');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('SET'),
        ['expired', null, 'int-1'],
      );
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('status = $1');
      expect(sql).toContain('error_message = $2');
    });

    it('includes error message when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('int-1', 'error', 'Token expired');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.any(String),
        ['error', 'Token expired', 'int-1'],
      );
    });

    it('returns false when integration not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateStatus('missing', 'active');

      expect(result).toBe(false);
    });
  });

  // ---- updateLastSync ----

  describe('updateLastSync', () => {
    it('updates last_sync_at and returns true', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateLastSync('int-1');

      expect(result).toBe(true);
      const sql = mockAdapter.execute.mock.calls[0][0] as string;
      expect(sql).toContain('last_sync_at = NOW()');
      expect(sql).toContain('updated_at = NOW()');
    });

    it('returns false when integration not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.updateLastSync('missing');

      expect(result).toBe(false);
    });
  });

  // ---- listByUser ----

  describe('listByUser', () => {
    it('returns all integrations for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeIntegrationRow({ id: 'int-1', service: 'gmail' }),
        makeIntegrationRow({ id: 'int-2', service: 'calendar' }),
      ]);

      const result = await repo.listByUser('default');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('ORDER BY provider, service');
    });

    it('uses "default" userId when not specified', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByUser();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['default'],
      );
    });

    it('returns empty array when no integrations', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByUser('user-1');

      expect(result).toEqual([]);
    });
  });

  // ---- listActiveByUser ----

  describe('listActiveByUser', () => {
    it('returns only active integrations', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeIntegrationRow({ status: 'active' }),
      ]);

      const result = await repo.listActiveByUser('default');

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('user_id = $1');
    });

    it('uses "default" userId when not specified', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listActiveByUser();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        ['default'],
      );
    });
  });

  // ---- listByProvider ----

  describe('listByProvider', () => {
    it('returns integrations by user and provider', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeIntegrationRow({ service: 'gmail' }),
        makeIntegrationRow({ service: 'calendar' }),
      ]);

      const result = await repo.listByProvider('default', 'google');

      expect(result).toHaveLength(2);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('provider = $2');
      expect(sql).toContain('ORDER BY service');
    });

    it('returns empty array when no matching integrations', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByProvider('user-1', 'microsoft');

      expect(result).toEqual([]);
    });
  });

  // ---- isConnected ----

  describe('isConnected', () => {
    it('returns true when active integration exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });

      const result = await repo.isConnected('default', 'google', 'gmail');

      expect(result).toBe(true);
      const sql = mockAdapter.queryOne.mock.calls[0][0] as string;
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('provider = $2');
      expect(sql).toContain('service = $3');
      expect(sql).toContain("status = 'active'");
    });

    it('returns false when no active integration', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      const result = await repo.isConnected('default', 'google', 'calendar');

      expect(result).toBe(false);
    });

    it('returns false when result is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.isConnected('default', 'google', 'drive');

      expect(result).toBe(false);
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when integration is deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('int-1');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM oauth_integrations WHERE id = $1'),
        ['int-1'],
      );
    });

    it('returns false when integration not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });
  });

  // ---- deleteByUser ----

  describe('deleteByUser', () => {
    it('returns number of deleted integrations', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      const result = await repo.deleteByUser('user-1');

      expect(result).toBe(3);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM oauth_integrations WHERE user_id = $1'),
        ['user-1'],
      );
    });

    it('returns 0 when no integrations to delete', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deleteByUser('user-empty');

      expect(result).toBe(0);
    });
  });

  // ---- findExpiring ----

  describe('findExpiring', () => {
    it('returns integrations expiring within N minutes', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeIntegrationRow({ expires_at: '2024-06-01T12:04:00Z' }),
      ]);

      const result = await repo.findExpiring(5);

      expect(result).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain('expires_at IS NOT NULL');
      expect(sql).toContain('ORDER BY expires_at ASC');
      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        [5],
      );
    });

    it('uses default 5 minutes when not specified', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.findExpiring();

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.any(String),
        [5],
      );
    });

    it('returns empty array when no expiring integrations', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.findExpiring(10);

      expect(result).toEqual([]);
    });
  });

  // ---- Row mapping edge cases ----

  describe('row mapping', () => {
    it('parses scopes from JSON string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ scopes: '["read","write","admin"]' }),
      );

      const result = await repo.getById('int-1');

      expect(result!.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('handles already-parsed scopes array', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ scopes: ['read', 'write'] }),
      );

      const result = await repo.getById('int-1');

      expect(result!.scopes).toEqual(['read', 'write']);
    });

    it('maps Dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({
          expires_at: '2024-06-01T13:00:00Z',
          last_sync_at: '2024-06-01T12:30:00Z',
          created_at: '2024-06-01T10:00:00Z',
          updated_at: '2024-06-01T12:00:00Z',
        }),
      );

      const result = await repo.getById('int-1');

      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(result!.expiresAt!.toISOString()).toBe('2024-06-01T13:00:00.000Z');
      expect(result!.lastSyncAt).toBeInstanceOf(Date);
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('sets optional Date fields to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({
          expires_at: null,
          last_sync_at: null,
        }),
      );

      const result = await repo.getById('int-1');

      expect(result!.expiresAt).toBeUndefined();
      expect(result!.lastSyncAt).toBeUndefined();
    });

    it('maps email when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ email: 'user@gmail.com' }),
      );

      const result = await repo.getById('int-1');

      expect(result!.email).toBe('user@gmail.com');
    });

    it('sets email to undefined when empty or null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ email: null }),
      );

      const result = await repo.getById('int-1');

      expect(result!.email).toBeUndefined();
    });

    it('maps errorMessage when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ error_message: 'Refresh failed', status: 'error' }),
      );

      const result = await repo.getById('int-1');

      expect(result!.errorMessage).toBe('Refresh failed');
      expect(result!.status).toBe('error');
    });

    it('sets errorMessage to undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeIntegrationRow({ error_message: null }),
      );

      const result = await repo.getById('int-1');

      expect(result!.errorMessage).toBeUndefined();
    });

    it('maps all status values', async () => {
      for (const status of ['active', 'expired', 'revoked', 'error'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(
          makeIntegrationRow({ status }),
        );

        const result = await repo.getById('int-1');

        expect(result!.status).toBe(status);
      }
    });

    it('maps all provider values', async () => {
      for (const provider of ['google', 'microsoft', 'github'] as const) {
        mockAdapter.queryOne.mockResolvedValueOnce(
          makeIntegrationRow({ provider }),
        );

        const result = await repo.getById('int-1');

        expect(result!.provider).toBe(provider);
      }
    });
  });

  // ---- Factory ----

  describe('createOAuthIntegrationsRepository', () => {
    it('returns an OAuthIntegrationsRepository instance', () => {
      const r = createOAuthIntegrationsRepository();
      expect(r).toBeInstanceOf(OAuthIntegrationsRepository);
    });
  });
});
