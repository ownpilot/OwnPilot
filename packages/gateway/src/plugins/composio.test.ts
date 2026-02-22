/**
 * Composio Plugin Tests
 *
 * Tests all 4 tool executors: composio_search, composio_execute,
 * composio_connect, and composio_status.
 *
 * Executors are extracted by intercepting the createPlugin() builder calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock values
// ---------------------------------------------------------------------------

const { mockComposioService, mockLog } = vi.hoisted(() => ({
  mockComposioService: {
    isConfigured: vi.fn(),
    searchActions: vi.fn(),
    executeAction: vi.fn(),
    getConnectionStatus: vi.fn(),
    initiateConnection: vi.fn(),
    getConnections: vi.fn(),
  },
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tool executor capture infrastructure
// ---------------------------------------------------------------------------

// Populated each time buildComposioPlugin() calls createPlugin().
let capturedTools: Array<{
  definition: Record<string, unknown>;
  executor: (args: Record<string, unknown>) => Promise<unknown>;
}> = [];

vi.mock('@ownpilot/core', () => {
  const mockBuilder = {
    meta: vi.fn(function (this: unknown) {
      return mockBuilder;
    }),
    tool: vi.fn(function (
      this: unknown,
      def: Record<string, unknown>,
      fn: (args: Record<string, unknown>) => Promise<unknown>
    ) {
      capturedTools.push({ definition: def, executor: fn });
      return mockBuilder;
    }),
    build: vi.fn(() => ({
      manifest: {
        id: 'composio',
        name: 'Composio Integration',
        version: '1.0.0',
        description: '1000+ OAuth app integrations via Composio',
        pluginConfigSchema: [
          {
            name: 'auto_suggest',
            label: 'Auto-suggest Composio tools',
            type: 'boolean',
            defaultValue: true,
          },
        ],
        requiredServices: [
          {
            name: 'composio',
            displayName: 'Composio',
            configSchema: [{ name: 'api_key', type: 'secret', required: true }],
          },
        ],
        defaultConfig: { auto_suggest: true },
      },
      implementation: {},
    })),
  };

  return {
    createPlugin: vi.fn(() => {
      capturedTools = [];
      return mockBuilder;
    }),
  };
});

vi.mock('../services/composio-service.js', () => ({
  composioService: mockComposioService,
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { buildComposioPlugin } from './composio.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToolExecutor(name: string) {
  const entry = capturedTools.find((t) => t.definition.name === name);
  if (!entry) {
    throw new Error(
      'Tool "' +
        name +
        '" not found. Available: ' +
        capturedTools.map((t) => t.definition.name).join(', ')
    );
  }
  return entry.executor;
}

function parseContent(result: unknown): unknown {
  const r = result as { content: string };
  return JSON.parse(r.content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildComposioPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildComposioPlugin();
  });

  // =========================================================================
  // Plugin structure
  // =========================================================================

  describe('plugin structure', () => {
    it('returns manifest and implementation from build()', () => {
      const result = buildComposioPlugin();
      expect(result).toHaveProperty('manifest');
      expect(result).toHaveProperty('implementation');
    });

    it('manifest has correct id', () => {
      const { manifest } = buildComposioPlugin();
      expect(manifest.id).toBe('composio');
    });

    it('manifest has correct name', () => {
      const { manifest } = buildComposioPlugin();
      expect(manifest.name).toBe('Composio Integration');
    });

    it('manifest has correct version', () => {
      const { manifest } = buildComposioPlugin();
      expect(manifest.version).toBe('1.0.0');
    });

    it('manifest has a non-empty description', () => {
      const { manifest } = buildComposioPlugin();
      expect(manifest.description).toBeTruthy();
    });

    it('registers exactly 4 tools', () => {
      expect(capturedTools).toHaveLength(4);
    });

    it('registers composio_search tool', () => {
      expect(capturedTools.map((t) => t.definition.name)).toContain('composio_search');
    });

    it('registers composio_execute tool', () => {
      expect(capturedTools.map((t) => t.definition.name)).toContain('composio_execute');
    });

    it('registers composio_connect tool', () => {
      expect(capturedTools.map((t) => t.definition.name)).toContain('composio_connect');
    });

    it('registers composio_status tool', () => {
      expect(capturedTools.map((t) => t.definition.name)).toContain('composio_status');
    });

    it('plugin config schema has auto_suggest field', () => {
      const { manifest } = buildComposioPlugin();
      const schema = manifest.pluginConfigSchema as Array<{ name: string }>;
      expect(schema.some((f) => f.name === 'auto_suggest')).toBe(true);
    });

    it('requiredServices includes composio service', () => {
      const { manifest } = buildComposioPlugin();
      const services = manifest.requiredServices as Array<{ name: string }>;
      expect(services.some((s) => s.name === 'composio')).toBe(true);
    });

    it('composio service config schema has api_key field', () => {
      const { manifest } = buildComposioPlugin();
      const services = manifest.requiredServices as Array<{
        name: string;
        configSchema: Array<{ name: string }>;
      }>;
      const svc = services.find((s) => s.name === 'composio');
      expect(svc?.configSchema.some((f) => f.name === 'api_key')).toBe(true);
    });
  });

  // =========================================================================
  // composio_search
  // =========================================================================

  describe('composio_search', () => {
    it('returns not-configured error when isConfigured() is false', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const fn = getToolExecutor('composio_search');
      const result = (await fn({ query: 'send email' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio API key not configured');
    });

    it('searches with query only (no app filter)', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([
        {
          slug: 'GMAIL_SEND_EMAIL',
          name: 'Send Email',
          appName: 'gmail',
          description: 'Send an email',
        },
      ]);
      const fn = getToolExecutor('composio_search');
      await fn({ query: 'send email' });
      expect(mockComposioService.searchActions).toHaveBeenCalledWith('send email', undefined, 10);
    });

    it('searches with query and app filter', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      await fn({ query: 'send email', app: 'gmail' });
      expect(mockComposioService.searchActions).toHaveBeenCalledWith('send email', 'gmail', 10);
    });

    it('uses default limit of 10 when not specified', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      await fn({ query: 'create issue' });
      expect(mockComposioService.searchActions).toHaveBeenCalledWith('create issue', undefined, 10);
    });

    it('uses custom limit when provided', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      await fn({ query: 'create issue', limit: 5 });
      expect(mockComposioService.searchActions).toHaveBeenCalledWith('create issue', undefined, 5);
    });

    it('returns no-actions message when empty results without app filter', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      const result = (await fn({ query: 'nonexistent action' })) as { content: string };
      expect(result.content).toContain('No Composio actions found for "nonexistent action"');
      expect(result.content).not.toContain('in app');
    });

    it('returns no-actions message including app name when app filter set', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      const result = (await fn({ query: 'nonexistent', app: 'github' })) as { content: string };
      expect(result.content).toContain('No Composio actions found for "nonexistent"');
      expect(result.content).toContain('in app "github"');
    });

    it('formats results correctly with action slug mapped to action key', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([
        {
          slug: 'GITHUB_CREATE_ISSUE',
          name: 'Create Issue',
          appName: 'github',
          description: 'Creates a GitHub issue',
        },
      ]);
      const fn = getToolExecutor('composio_search');
      const result = await fn({ query: 'create issue' });
      const parsed = parseContent(result) as {
        actions: Array<{ action: string; name: string; app: string; description: string }>;
      };
      expect(parsed.actions[0].action).toBe('GITHUB_CREATE_ISSUE');
      expect(parsed.actions[0].name).toBe('Create Issue');
      expect(parsed.actions[0].app).toBe('github');
      expect(parsed.actions[0].description).toBe('Creates a GitHub issue');
    });

    it('includes hint about composio_execute in results payload', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([
        {
          slug: 'SLACK_SEND_MESSAGE',
          name: 'Send Message',
          appName: 'slack',
          description: 'Send a Slack message',
        },
      ]);
      const fn = getToolExecutor('composio_search');
      const result = await fn({ query: 'send message' });
      const parsed = parseContent(result) as { hint: string };
      expect(parsed.hint).toContain('composio_execute');
    });

    it('includes query and result count in response', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([
        {
          slug: 'GITHUB_CREATE_ISSUE',
          name: 'Create Issue',
          appName: 'github',
          description: 'desc',
        },
        {
          slug: 'GITHUB_LIST_ISSUES',
          name: 'List Issues',
          appName: 'github',
          description: 'desc2',
        },
      ]);
      const fn = getToolExecutor('composio_search');
      const result = await fn({ query: 'issues', app: 'github' });
      const parsed = parseContent(result) as { query: string; count: number; app: string };
      expect(parsed.query).toBe('issues');
      expect(parsed.count).toBe(2);
      expect(parsed.app).toBe('github');
    });

    it('sets app to null in results when no app filter provided', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([
        { slug: 'GMAIL_SEND_EMAIL', name: 'Send Email', appName: 'gmail', description: 'desc' },
      ]);
      const fn = getToolExecutor('composio_search');
      const result = await fn({ query: 'email' });
      const parsed = parseContent(result) as { app: null };
      expect(parsed.app).toBeNull();
    });

    it('handles search error gracefully with isError flag', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockRejectedValue(new Error('Network timeout'));
      const fn = getToolExecutor('composio_search');
      const result = (await fn({ query: 'test' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio search failed');
      expect(result.content).toContain('Network timeout');
    });

    it('logs error on search failure', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const err = new Error('Network timeout');
      mockComposioService.searchActions.mockRejectedValue(err);
      const fn = getToolExecutor('composio_search');
      await fn({ query: 'test' });
      expect(mockLog.error).toHaveBeenCalledWith('composio_search failed:', err);
    });

    it('handles missing query by defaulting to empty string', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      await fn({});
      expect(mockComposioService.searchActions).toHaveBeenCalledWith('', undefined, 10);
    });

    it('handles non-Error thrown objects in search errors', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockRejectedValue('plain string error');
      const fn = getToolExecutor('composio_search');
      const result = (await fn({ query: 'test' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('plain string error');
    });

    it('handles empty args object without throwing', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.searchActions.mockResolvedValue([]);
      const fn = getToolExecutor('composio_search');
      const result = (await fn({})) as { content: string };
      expect(result.content).toBeTruthy();
    });
  });

  // =========================================================================
  // composio_execute
  // =========================================================================

  describe('composio_execute', () => {
    it('returns not-configured error when isConfigured() is false', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as {
        content: string;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio API key not configured');
    });

    it('returns error when action parameter is absent', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({})) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: action');
    });

    it('returns error when action is an empty string', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: '' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: action');
    });

    it('executes action with provided arguments object', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({ issueNumber: 42 });
      const fn = getToolExecutor('composio_execute');
      await fn({
        action: 'GITHUB_CREATE_ISSUE',
        arguments: { title: 'Bug report', body: 'Something broke' },
      });
      expect(mockComposioService.executeAction).toHaveBeenCalledWith(
        'default',
        'GITHUB_CREATE_ISSUE',
        { title: 'Bug report', body: 'Something broke' }
      );
    });

    it('executes action with empty object when arguments is absent', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({ ok: true });
      const fn = getToolExecutor('composio_execute');
      await fn({ action: 'GITHUB_LIST_REPOS' });
      expect(mockComposioService.executeAction).toHaveBeenCalledWith(
        'default',
        'GITHUB_LIST_REPOS',
        {}
      );
    });

    it('uses DEFAULT_USER_ID "default" as first argument to executeAction', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({});
      const fn = getToolExecutor('composio_execute');
      await fn({ action: 'GITHUB_LIST_REPOS' });
      expect(mockComposioService.executeAction.mock.calls[0][0]).toBe('default');
    });

    it('returns success result with action name and service response', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({ id: 123, status: 'created' });
      const fn = getToolExecutor('composio_execute');
      const result = await fn({ action: 'GITHUB_CREATE_ISSUE', arguments: { title: 'test' } });
      const parsed = parseContent(result) as {
        action: string;
        success: boolean;
        result: { id: number; status: string };
      };
      expect(parsed.action).toBe('GITHUB_CREATE_ISSUE');
      expect(parsed.success).toBe(true);
      expect(parsed.result).toEqual({ id: 123, status: 'created' });
    });

    it('handles generic execution error with isError flag', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(
        new Error('Request failed with status 500')
      );
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as {
        content: string;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio action execution failed');
      expect(result.content).toContain('Request failed with status 500');
    });

    it('detects connected account error phrase and suggests composio_connect', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(
        new Error('No connected account found for this user')
      );
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as {
        content: string;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('composio_connect');
    });

    it('detects ConnectedAccountNotFound error phrase and suggests composio_connect', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(
        new Error('ConnectedAccountNotFound for toolkit github')
      );
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as {
        content: string;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('composio_connect');
    });

    it('extracts app hint from action name prefix on connected account error', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(new Error('connected account not found'));
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as { content: string };
      expect(result.content).toContain('"github"');
    });

    it('extracts lowercased app hint from GMAIL action', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(new Error('ConnectedAccountNotFound'));
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GMAIL_SEND_EMAIL' })) as { content: string };
      expect(result.content).toContain('"gmail"');
    });

    it('handles action name without underscores for app hint extraction', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue(new Error('connected account not found'));
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'ACTION' })) as { content: string };
      expect(result.content).toContain('"action"');
    });

    it('logs error on execution failure', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const err = new Error('Server error');
      mockComposioService.executeAction.mockRejectedValue(err);
      const fn = getToolExecutor('composio_execute');
      await fn({ action: 'GITHUB_CREATE_ISSUE' });
      expect(mockLog.error).toHaveBeenCalledWith('composio_execute failed:', err);
    });

    it('handles non-Error thrown objects', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockRejectedValue('plain string error');
      const fn = getToolExecutor('composio_execute');
      const result = (await fn({ action: 'GITHUB_CREATE_ISSUE' })) as {
        content: string;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('plain string error');
    });

    it('falls back to empty object when arguments is not an object type', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({});
      const fn = getToolExecutor('composio_execute');
      await fn({ action: 'GITHUB_LIST_REPOS', arguments: 'not-an-object' });
      expect(mockComposioService.executeAction).toHaveBeenCalledWith(
        'default',
        'GITHUB_LIST_REPOS',
        {}
      );
    });

    it('passes through valid arguments object to executeAction', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.executeAction.mockResolvedValue({});
      const fn = getToolExecutor('composio_execute');
      await fn({ action: 'SLACK_SEND_MESSAGE', arguments: { channel: '#general', text: 'Hello' } });
      expect(mockComposioService.executeAction).toHaveBeenCalledWith(
        'default',
        'SLACK_SEND_MESSAGE',
        { channel: '#general', text: 'Hello' }
      );
    });
  });

  // =========================================================================
  // composio_connect
  // =========================================================================

  describe('composio_connect', () => {
    it('returns not-configured error when isConfigured() is false', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const fn = getToolExecutor('composio_connect');
      const result = (await fn({ app: 'github' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio API key not configured');
    });

    it('returns error when app parameter is absent', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const fn = getToolExecutor('composio_connect');
      const result = (await fn({})) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: app');
    });

    it('returns error when app is an empty string', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const fn = getToolExecutor('composio_connect');
      const result = (await fn({ app: '' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: app');
    });

    it('returns already_connected status when existing connection is ACTIVE', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'conn-123',
        appName: 'github',
        status: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as { status: string; app: string };
      expect(parsed.status).toBe('already_connected');
      expect(parsed.app).toBe('github');
    });

    it('message mentions composio_execute when already connected', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'conn-123',
        appName: 'github',
        status: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as { message: string };
      expect(parsed.message).toContain('composio_execute');
    });

    it('does not call initiateConnection when already connected', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'conn-123',
        appName: 'github',
        status: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_connect');
      await fn({ app: 'github' });
      expect(mockComposioService.initiateConnection).not.toHaveBeenCalled();
    });

    it('returns redirect URL and authorization_required status when OAuth redirect available', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: 'https://oauth.github.com/authorize?client_id=xyz',
        connectedAccountId: 'acc-456',
        connectionStatus: 'INITIATED',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as {
        status: string;
        redirectUrl: string;
        connectionId: string;
      };
      expect(parsed.status).toBe('authorization_required');
      expect(parsed.redirectUrl).toBe('https://oauth.github.com/authorize?client_id=xyz');
      expect(parsed.connectionId).toBe('acc-456');
    });

    it('message includes the redirect URL when authorization required', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: 'https://oauth.example.com/auth',
        connectedAccountId: 'acc-789',
        connectionStatus: 'INITIATED',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'gmail' });
      const parsed = parseContent(result) as { message: string };
      expect(parsed.message).toContain('https://oauth.example.com/auth');
    });

    it('returns connectionStatus when no redirect URL is provided', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: null,
        connectedAccountId: 'acc-789',
        connectionStatus: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as { status: string; connectionId: string };
      expect(parsed.status).toBe('ACTIVE');
      expect(parsed.connectionId).toBe('acc-789');
    });

    it('calls getConnectionStatus with DEFAULT_USER_ID', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: null,
        connectedAccountId: 'acc-001',
        connectionStatus: 'INITIATED',
      });
      const fn = getToolExecutor('composio_connect');
      await fn({ app: 'github' });
      expect(mockComposioService.getConnectionStatus).toHaveBeenCalledWith('default', 'github');
    });

    it('calls initiateConnection with DEFAULT_USER_ID and app name', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: 'https://oauth.slack.com/authorize',
        connectedAccountId: 'acc-001',
        connectionStatus: 'INITIATED',
      });
      const fn = getToolExecutor('composio_connect');
      await fn({ app: 'slack' });
      expect(mockComposioService.initiateConnection).toHaveBeenCalledWith('default', 'slack');
    });

    it('handles connection error gracefully with isError flag', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockRejectedValue(new Error('Service unavailable'));
      const fn = getToolExecutor('composio_connect');
      const result = (await fn({ app: 'github' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Failed to connect app');
      expect(result.content).toContain('Service unavailable');
    });

    it('logs error on connection failure', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const err = new Error('Network error');
      mockComposioService.getConnectionStatus.mockRejectedValue(err);
      const fn = getToolExecutor('composio_connect');
      await fn({ app: 'github' });
      expect(mockLog.error).toHaveBeenCalledWith('composio_connect failed:', err);
    });

    it('handles non-Error thrown objects in connect errors', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockRejectedValue('connection refused');
      const fn = getToolExecutor('composio_connect');
      const result = (await fn({ app: 'github' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('connection refused');
    });

    it('proceeds to initiateConnection when existing connection is not ACTIVE', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'conn-old',
        appName: 'github',
        status: 'INITIATED',
      });
      mockComposioService.initiateConnection.mockResolvedValue({
        redirectUrl: 'https://oauth.github.com/authorize',
        connectedAccountId: 'acc-new',
        connectionStatus: 'INITIATED',
      });
      const fn = getToolExecutor('composio_connect');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as { status: string };
      expect(parsed.status).toBe('authorization_required');
      expect(mockComposioService.initiateConnection).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // composio_status
  // =========================================================================

  describe('composio_status', () => {
    it('returns not-configured error when isConfigured() is false', async () => {
      mockComposioService.isConfigured.mockReturnValue(false);
      const fn = getToolExecutor('composio_status');
      const result = (await fn({ app: 'github' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Composio API key not configured');
    });

    it('returns connected status and details for a specific app', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'conn-123',
        appName: 'github',
        status: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_status');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as {
        app: string;
        connected: boolean;
        status: string;
        connectionId: string;
      };
      expect(parsed.app).toBe('github');
      expect(parsed.connected).toBe(true);
      expect(parsed.status).toBe('ACTIVE');
      expect(parsed.connectionId).toBe('conn-123');
    });

    it('calls getConnectionStatus with DEFAULT_USER_ID when app is provided', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue({
        id: 'c-1',
        appName: 'slack',
        status: 'ACTIVE',
      });
      const fn = getToolExecutor('composio_status');
      await fn({ app: 'slack' });
      expect(mockComposioService.getConnectionStatus).toHaveBeenCalledWith('default', 'slack');
    });

    it('returns not-connected response for specific app when no connection exists', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockResolvedValue(null);
      const fn = getToolExecutor('composio_status');
      const result = await fn({ app: 'github' });
      const parsed = parseContent(result) as { app: string; connected: boolean; message: string };
      expect(parsed.app).toBe('github');
      expect(parsed.connected).toBe(false);
      expect(parsed.message).toContain('composio_connect');
    });

    it('lists all connections when no app argument provided', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockResolvedValue([
        { id: 'conn-1', appName: 'github', status: 'ACTIVE' },
        { id: 'conn-2', appName: 'gmail', status: 'ACTIVE' },
      ]);
      const fn = getToolExecutor('composio_status');
      await fn({});
      expect(mockComposioService.getConnections).toHaveBeenCalledWith('default');
      expect(mockComposioService.getConnectionStatus).not.toHaveBeenCalled();
    });

    it('returns empty connections list message with hints when no apps connected', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockResolvedValue([]);
      const fn = getToolExecutor('composio_status');
      const result = await fn({});
      const parsed = parseContent(result) as {
        connections: unknown[];
        count: number;
        message: string;
      };
      expect(parsed.connections).toHaveLength(0);
      expect(parsed.count).toBe(0);
      expect(parsed.message).toContain('composio_search');
      expect(parsed.message).toContain('composio_connect');
    });

    it('formats connection list entries with app, status, and connectionId', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockResolvedValue([
        { id: 'conn-1', appName: 'github', status: 'ACTIVE' },
        { id: 'conn-2', appName: 'gmail', status: 'ACTIVE' },
      ]);
      const fn = getToolExecutor('composio_status');
      const result = await fn({});
      const parsed = parseContent(result) as {
        connections: Array<{ app: string; status: string; connectionId: string }>;
        count: number;
      };
      expect(parsed.count).toBe(2);
      expect(parsed.connections[0]).toEqual({
        app: 'github',
        status: 'ACTIVE',
        connectionId: 'conn-1',
      });
      expect(parsed.connections[1]).toEqual({
        app: 'gmail',
        status: 'ACTIVE',
        connectionId: 'conn-2',
      });
    });

    it('returns correct count for multiple connections', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockResolvedValue([
        { id: 'c-1', appName: 'github', status: 'ACTIVE' },
        { id: 'c-2', appName: 'slack', status: 'ACTIVE' },
        { id: 'c-3', appName: 'notion', status: 'ACTIVE' },
      ]);
      const fn = getToolExecutor('composio_status');
      const result = await fn({});
      const parsed = parseContent(result) as { count: number };
      expect(parsed.count).toBe(3);
    });

    it('handles status check error gracefully for a specific app', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnectionStatus.mockRejectedValue(new Error('Service down'));
      const fn = getToolExecutor('composio_status');
      const result = (await fn({ app: 'github' })) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Failed to check status');
      expect(result.content).toContain('Service down');
    });

    it('handles status check error gracefully when listing all connections', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockRejectedValue(new Error('DB connection lost'));
      const fn = getToolExecutor('composio_status');
      const result = (await fn({})) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Failed to check status');
      expect(result.content).toContain('DB connection lost');
    });

    it('logs error on status check failure', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      const err = new Error('Timeout');
      mockComposioService.getConnectionStatus.mockRejectedValue(err);
      const fn = getToolExecutor('composio_status');
      await fn({ app: 'github' });
      expect(mockLog.error).toHaveBeenCalledWith('composio_status failed:', err);
    });

    it('handles non-Error thrown objects in status check', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockRejectedValue('unexpected failure');
      const fn = getToolExecutor('composio_status');
      const result = (await fn({})) as { content: string; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content).toContain('unexpected failure');
    });

    it('treats app: undefined as a list-all request', async () => {
      mockComposioService.isConfigured.mockReturnValue(true);
      mockComposioService.getConnections.mockResolvedValue([]);
      const fn = getToolExecutor('composio_status');
      await fn({ app: undefined });
      expect(mockComposioService.getConnections).toHaveBeenCalled();
      expect(mockComposioService.getConnectionStatus).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Shared isConfigured guard across all 4 executors
  // =========================================================================

  describe('isConfigured guard (all executors)', () => {
    const scenarios: Array<{ toolName: string; args: Record<string, unknown> }> = [
      { toolName: 'composio_search', args: { query: 'test' } },
      { toolName: 'composio_execute', args: { action: 'GITHUB_LIST_REPOS' } },
      { toolName: 'composio_connect', args: { app: 'github' } },
      { toolName: 'composio_status', args: { app: 'github' } },
    ];

    for (const { toolName, args } of scenarios) {
      it(`${toolName} returns isError:true when not configured`, async () => {
        mockComposioService.isConfigured.mockReturnValue(false);
        const fn = getToolExecutor(toolName);
        const result = (await fn(args)) as { isError: boolean };
        expect(result.isError).toBe(true);
      });

      it(`${toolName} does not invoke any service method when not configured`, async () => {
        mockComposioService.isConfigured.mockReturnValue(false);
        const fn = getToolExecutor(toolName);
        await fn(args);
        expect(mockComposioService.searchActions).not.toHaveBeenCalled();
        expect(mockComposioService.executeAction).not.toHaveBeenCalled();
        expect(mockComposioService.getConnectionStatus).not.toHaveBeenCalled();
        expect(mockComposioService.initiateConnection).not.toHaveBeenCalled();
        expect(mockComposioService.getConnections).not.toHaveBeenCalled();
      });
    }
  });
});
