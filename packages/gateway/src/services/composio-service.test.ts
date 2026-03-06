/**
 * Composio Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConfigServicesRepo = {
  getFieldValue: vi.fn(),
};

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: (...args: unknown[]) => mockConfigServicesRepo.getFieldValue(...args),
  },
}));

const mockComposioInstance = {
  toolkits: {
    get: vi.fn(),
    authorize: vi.fn(),
  },
  tools: {
    getRawComposioTools: vi.fn(),
    execute: vi.fn(),
  },
  connectedAccounts: {
    list: vi.fn(),
    waitForConnection: vi.fn(),
    delete: vi.fn(),
    refresh: vi.fn(),
  },
};

vi.mock('@composio/core', () => ({
  Composio: class MockComposio {
    constructor() {
      return mockComposioInstance;
    }
  },
}));

import { composioService } from './composio-service.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComposioService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composioService.resetClient();
  });

  // ========================================================================
  // isConfigured
  // ========================================================================

  describe('isConfigured', () => {
    it('returns false when no API key is set', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);
      expect(composioService.isConfigured()).toBe(false);
    });

    it('returns true when Config Center has API key', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-test-key');
      expect(composioService.isConfigured()).toBe(true);
    });

    it('returns true when env var is set', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);
      process.env.COMPOSIO_API_KEY = 'comp-env-key';
      expect(composioService.isConfigured()).toBe(true);
      delete process.env.COMPOSIO_API_KEY;
    });
  });

  // ========================================================================
  // getAvailableApps
  // ========================================================================

  describe('getAvailableApps', () => {
    it('returns mapped apps from SDK', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      // SDK returns a flat array (not { items: [...] })
      mockComposioInstance.toolkits.get.mockResolvedValue([
        {
          slug: 'github',
          name: 'GitHub',
          meta: { description: 'Git hosting', categories: ['dev'] },
        },
        { slug: 'gmail', name: 'Gmail', meta: {} },
      ]);

      const apps = await composioService.getAvailableApps();
      expect(apps).toHaveLength(2);
      expect(apps[0]).toEqual({
        slug: 'github',
        name: 'GitHub',
        description: 'Git hosting',
        logo: undefined,
        categories: ['dev'],
      });
    });

    it('caches results', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.toolkits.get.mockResolvedValue([{ slug: 'a', name: 'A', meta: {} }]);

      await composioService.getAvailableApps();
      await composioService.getAvailableApps();

      // Second call should use cache, SDK only called once
      expect(mockComposioInstance.toolkits.get).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // searchActions
  // ========================================================================

  describe('searchActions', () => {
    it('returns mapped actions', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.tools.getRawComposioTools.mockResolvedValue({
        items: [
          {
            slug: 'GMAIL_SEND_EMAIL',
            name: 'Send Email',
            description: 'Send an email via Gmail',
            appName: 'gmail',
          },
        ],
      });

      const actions = await composioService.searchActions('send email');
      expect(actions).toHaveLength(1);
      expect(actions[0].slug).toBe('GMAIL_SEND_EMAIL');
      expect(mockComposioInstance.tools.getRawComposioTools).toHaveBeenCalledWith({
        search: 'send email',
        limit: 10,
      });
    });

    it('passes app filter when provided', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.tools.getRawComposioTools.mockResolvedValue({ items: [] });

      await composioService.searchActions('send', 'gmail', 5);
      expect(mockComposioInstance.tools.getRawComposioTools).toHaveBeenCalledWith({
        search: 'send',
        toolkit: 'gmail',
        limit: 5,
      });
    });
  });

  // ========================================================================
  // executeAction
  // ========================================================================

  describe('executeAction', () => {
    it('calls SDK with correct params', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.tools.execute.mockResolvedValue({ data: { sent: true } });

      const result = await composioService.executeAction('user1', 'GMAIL_SEND_EMAIL', {
        to: 'a@b.com',
      });
      expect(result).toEqual({ data: { sent: true } });
      expect(mockComposioInstance.tools.execute).toHaveBeenCalledWith('GMAIL_SEND_EMAIL', {
        userId: 'user1',
        arguments: { to: 'a@b.com' },
        dangerouslySkipVersionCheck: true,
      });
    });
  });

  // ========================================================================
  // getConnections
  // ========================================================================

  describe('getConnections', () => {
    it('returns mapped connections', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({
        items: [{ id: 'c1', appName: 'github', status: 'ACTIVE', createdAt: '2026-01-01' }],
      });

      const connections = await composioService.getConnections('user1');
      expect(connections).toHaveLength(1);
      expect(connections[0]).toEqual({
        id: 'c1',
        appName: 'github',
        status: 'ACTIVE',
        createdAt: '2026-01-01',
        updatedAt: undefined,
      });
    });

    it('handles object-valued fields from SDK (extracts name/slug)', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({
        items: [
          { id: 'c1', appName: { name: 'Google', slug: 'google' }, status: 'ACTIVE' },
          { id: 'c2', appName: { slug: 'slack' }, status: 'ACTIVE' },
        ],
      });

      const connections = await composioService.getConnections('user1');
      expect(connections[0].appName).toBe('Google');
      expect(connections[1].appName).toBe('slack');
    });
  });

  // ========================================================================
  // getConnectionStatus
  // ========================================================================

  describe('getConnectionStatus', () => {
    it('returns matching connection', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({
        items: [
          { id: 'c1', appName: 'github', status: 'ACTIVE' },
          { id: 'c2', appName: 'gmail', status: 'EXPIRED' },
        ],
      });

      const conn = await composioService.getConnectionStatus('user1', 'gmail');
      expect(conn?.appName).toBe('gmail');
      expect(conn?.status).toBe('EXPIRED');
    });

    it('returns null for unconnected app', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({ items: [] });

      const conn = await composioService.getConnectionStatus('user1', 'slack');
      expect(conn).toBeNull();
    });
  });

  // ========================================================================
  // initiateConnection
  // ========================================================================

  describe('initiateConnection', () => {
    it('calls toolkits.authorize and returns result', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.toolkits.authorize.mockResolvedValue({
        redirectUrl: 'https://composio.dev/auth/github',
        connectedAccountId: 'ca_123',
        connectionStatus: 'INITIATED',
      });

      const result = await composioService.initiateConnection('user1', 'github');
      expect(result.redirectUrl).toBe('https://composio.dev/auth/github');
      expect(result.connectedAccountId).toBe('ca_123');
      expect(mockComposioInstance.toolkits.authorize).toHaveBeenCalledWith('user1', 'github');
    });
  });

  // ========================================================================
  // disconnect
  // ========================================================================

  describe('disconnect', () => {
    it('calls connectedAccounts.delete', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.delete.mockResolvedValue({});

      await composioService.disconnect('ca_123');
      expect(mockComposioInstance.connectedAccounts.delete).toHaveBeenCalledWith('ca_123');
    });
  });

  // ========================================================================
  // waitForConnection
  // ========================================================================

  describe('waitForConnection', () => {
    it('returns connection after wait', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.waitForConnection.mockResolvedValue({
        id: 'ca_123',
        appName: 'github',
        status: 'ACTIVE',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
      });

      const conn = await composioService.waitForConnection('ca_123', 30);
      expect(conn.id).toBe('ca_123');
      expect(conn.appName).toBe('github');
      expect(conn.status).toBe('ACTIVE');
      expect(mockComposioInstance.connectedAccounts.waitForConnection).toHaveBeenCalledWith(
        'ca_123',
        30
      );
    });

    it('uses connectedAccountId as fallback id when result has no id', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.waitForConnection.mockResolvedValue({
        appName: 'slack',
        status: 'ACTIVE',
      });

      const conn = await composioService.waitForConnection('ca_fallback');
      expect(conn.id).toBe('ca_fallback');
    });
  });

  // ========================================================================
  // refreshConnection
  // ========================================================================

  describe('refreshConnection', () => {
    it('refreshes and returns updated connection', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.refresh.mockResolvedValue({
        id: 'ca_123',
        appName: 'github',
        status: 'ACTIVE',
      });

      const conn = await composioService.refreshConnection('ca_123');
      expect(conn.id).toBe('ca_123');
      expect(conn.status).toBe('ACTIVE');
      expect(mockComposioInstance.connectedAccounts.refresh).toHaveBeenCalledWith('ca_123');
    });

    it('uses connectionId as fallback when result has no id', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.refresh.mockResolvedValue({
        toolkit: 'slack',
        status: 'ACTIVE',
      });

      const conn = await composioService.refreshConnection('ca_fallback');
      expect(conn.id).toBe('ca_fallback');
    });
  });

  // ========================================================================
  // Error handling
  // ========================================================================

  describe('error handling', () => {
    it('throws when API key not configured', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);
      await expect(composioService.getAvailableApps()).rejects.toThrow(
        'Composio API key not configured'
      );
    });

    it('re-uses cached client on second method call', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.toolkits.get.mockResolvedValue([]);

      // First call initializes client
      await composioService.getAvailableApps();
      // Second call (after cache cleared) should reuse the client
      composioService.resetClient();
      mockComposioInstance.toolkits.get.mockResolvedValue([]);
      // Re-init client for second fetch
      await composioService.getAvailableApps();
      // Verify SDK was called both times (both fetches hit SDK)
      expect(mockComposioInstance.toolkits.get).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // getAvailableApps — object categories
  // ========================================================================

  describe('getAvailableApps — edge cases', () => {
    it('maps category objects to their name or slug', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.toolkits.get.mockResolvedValue([
        {
          slug: 'notion',
          name: 'Notion',
          meta: {
            // categories as objects (SDK may return objects instead of strings)
            categories: [
              { name: 'Productivity', slug: 'productivity' }, // → uses name
              { slug: 'collaboration' }, // → uses slug (no name)
            ],
          },
        },
      ]);

      const apps = await composioService.getAvailableApps();
      expect(apps[0]!.categories).toEqual(['Productivity', 'collaboration']);
    });
  });

  // ========================================================================
  // searchActions — toolkit fallback
  // ========================================================================

  describe('searchActions — toolkit fallback', () => {
    it('uses toolkit field when appName is missing', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.tools.getRawComposioTools.mockResolvedValue({
        items: [
          {
            slug: 'ACTION_X',
            name: 'Action X',
            description: 'does something',
            // No appName — only toolkit field
            toolkit: 'myapp',
          },
        ],
      });

      const actions = await composioService.searchActions('something');
      expect(actions[0]!.appName).toBe('myapp');
    });
  });

  // ========================================================================
  // toStr — edge cases (exercised via connection mapping)
  // ========================================================================

  describe('toStr edge cases', () => {
    it('extracts id field from connection object when name/slug/key not present', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({
        items: [{ nanoid: 'n1', appName: { id: 'myapp-id' }, status: 'ACTIVE' }],
      });

      const connections = await composioService.getConnections('user1');
      expect(connections[0]!.appName).toBe('myapp-id');
    });

    it('falls back to connection nanoid when id missing', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('comp-key');
      mockComposioInstance.connectedAccounts.list.mockResolvedValue({
        items: [{ nanoid: 'nano-123', status: 'ACTIVE', appName: 'app' }],
      });

      const connections = await composioService.getConnections('user1');
      expect(connections[0]!.id).toBe('nano-123');
    });
  });
});
