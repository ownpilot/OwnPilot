/**
 * API Endpoints Tests
 *
 * Tests endpoint wrappers that contain logic beyond simple apiClient passthrough.
 * Focuses on: URL construction, parameter building, response transforms, FormData upload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock apiClient before importing any endpoints
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
const mockStream = vi.fn();

vi.mock('../client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    stream: (...args: unknown[]) => mockStream(...args),
  },
}));

// Must mock fetch for extensionsApi.upload
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { extensionsApi } from './extensions.js';
import { autonomyApi, pulseApi, debugApi, fileWorkspacesApi, channelsApi } from './misc.js';
import { chatApi } from './chat.js';
import { agentsApi } from './agents.js';
import { toolsApi } from './tools.js';
import { settingsApi } from './settings.js';
import { authApi } from './auth.js';
import { modelsApi } from './models.js';
import { workflowsApi } from './workflows.js';
import { customToolsApi } from './custom-tools.js';
import { composioApi } from './composio.js';
import { executionPermissionsApi } from './execution-permissions.js';
import { mcpApi } from './mcp.js';
import { triggersApi } from './personal-data.js';
import { tasksApi } from './tasks.js';
import { costsApi } from './summary.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// extensionsApi — has URL building, transform logic, FormData upload
// ---------------------------------------------------------------------------

describe('extensionsApi', () => {
  describe('list', () => {
    it('builds URLSearchParams from filter options', async () => {
      mockGet.mockResolvedValueOnce({ packages: [{ id: '1' }], total: 1 });

      const result = await extensionsApi.list({
        status: 'active',
        category: 'tools',
        format: 'ownpilot',
      });

      const url = mockGet.mock.calls[0]![0] as string;
      expect(url).toContain('status=active');
      expect(url).toContain('category=tools');
      expect(url).toContain('format=ownpilot');
      expect(result).toEqual([{ id: '1' }]);
    });

    it('omits empty query string when no params', async () => {
      mockGet.mockResolvedValueOnce({ packages: [{ id: '2' }], total: 1 });

      await extensionsApi.list();

      expect(mockGet.mock.calls[0]![0]).toBe('/extensions');
    });

    it('returns empty array when packages is undefined', async () => {
      mockGet.mockResolvedValueOnce({ total: 0 });

      const result = await extensionsApi.list();
      expect(result).toEqual([]);
    });

    it('omits undefined filter values', async () => {
      mockGet.mockResolvedValueOnce({ packages: [], total: 0 });

      await extensionsApi.list({ status: undefined, category: 'ai' });

      const url = mockGet.mock.calls[0]![0] as string;
      expect(url).not.toContain('status');
      expect(url).toContain('category=ai');
    });
  });

  describe('getById', () => {
    it('unwraps the package field from response', async () => {
      mockGet.mockResolvedValueOnce({ package: { id: 'ext-1', name: 'Test' } });

      const result = await extensionsApi.getById('ext-1');
      expect(result).toEqual({ id: 'ext-1', name: 'Test' });
      expect(mockGet).toHaveBeenCalledWith('/extensions/ext-1');
    });
  });

  describe('upload', () => {
    it('sends FormData with file via raw fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { package: { id: 'up-1' }, message: 'OK' } }),
      });

      const file = new File(['content'], 'test.zip', { type: 'application/zip' });
      const result = await extensionsApi.upload(file);

      expect(result).toEqual({ package: { id: 'up-1' }, message: 'OK' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/extensions/upload',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('throws on non-ok response with string error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'Invalid file' }),
      });

      const file = new File([''], 'bad.zip');
      await expect(extensionsApi.upload(file)).rejects.toThrow('Invalid file');
    });

    it('throws on success:false with object error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, error: { message: 'Parse error' } }),
      });

      const file = new File([''], 'bad.zip');
      await expect(extensionsApi.upload(file)).rejects.toThrow('Parse error');
    });

    it('falls back to "Upload failed" when no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: { code: 'ERR' } }),
      });

      const file = new File([''], 'bad.zip');
      await expect(extensionsApi.upload(file)).rejects.toThrow('Upload failed');
    });
  });

  describe('simple passthrough methods', () => {
    it('install sends POST with manifest', async () => {
      mockPost.mockResolvedValueOnce({ package: {} });
      await extensionsApi.install({ name: 'test' });
      expect(mockPost).toHaveBeenCalledWith('/extensions', { manifest: { name: 'test' } });
    });

    it('uninstall sends DELETE', async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      await extensionsApi.uninstall('ext-1');
      expect(mockDelete).toHaveBeenCalledWith('/extensions/ext-1');
    });

    it('enable sends POST', async () => {
      mockPost.mockResolvedValueOnce({ package: {} });
      await extensionsApi.enable('ext-1');
      expect(mockPost).toHaveBeenCalledWith('/extensions/ext-1/enable');
    });

    it('scan sends POST with optional directory', async () => {
      mockPost.mockResolvedValueOnce({ installed: 0, updated: 0, failed: 0, errors: [] });
      await extensionsApi.scan('/path/to/dir');
      expect(mockPost).toHaveBeenCalledWith('/extensions/scan', { directory: '/path/to/dir' });
    });

    it('scan sends POST without directory', async () => {
      mockPost.mockResolvedValueOnce({ installed: 0, updated: 0, failed: 0, errors: [] });
      await extensionsApi.scan();
      expect(mockPost).toHaveBeenCalledWith('/extensions/scan', {});
    });
  });
});

// ---------------------------------------------------------------------------
// autonomyApi — getApprovals has transform
// ---------------------------------------------------------------------------

describe('autonomyApi', () => {
  it('getApprovals returns pending array', async () => {
    mockGet.mockResolvedValueOnce({ pending: [{ id: 'a1' }], count: 1 });
    const result = await autonomyApi.getApprovals();
    expect(result).toEqual([{ id: 'a1' }]);
  });

  it('getApprovals returns empty array when pending is undefined', async () => {
    mockGet.mockResolvedValueOnce({ count: 0 });
    const result = await autonomyApi.getApprovals();
    expect(result).toEqual([]);
  });

  it('resolveApproval posts correct path', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    await autonomyApi.resolveApproval('act-1', 'approve');
    expect(mockPost).toHaveBeenCalledWith('/autonomy/approvals/act-1/approve');
  });
});

// ---------------------------------------------------------------------------
// pulseApi — history has parameter building logic
// ---------------------------------------------------------------------------

describe('pulseApi', () => {
  describe('history', () => {
    it('passes limit and offset as string params', async () => {
      mockGet.mockResolvedValueOnce({ history: [], total: 0 });
      await pulseApi.history({ limit: 10, offset: 20 });
      expect(mockGet).toHaveBeenCalledWith('/autonomy/pulse/history', {
        params: { limit: '10', offset: '20' },
      });
    });

    it('omits params when none provided', async () => {
      mockGet.mockResolvedValueOnce({ history: [], total: 0 });
      await pulseApi.history();
      expect(mockGet).toHaveBeenCalledWith('/autonomy/pulse/history', { params: undefined });
    });

    it('omits params when values are undefined/null', async () => {
      mockGet.mockResolvedValueOnce({ history: [], total: 0 });
      await pulseApi.history({});
      expect(mockGet).toHaveBeenCalledWith('/autonomy/pulse/history', { params: undefined });
    });
  });
});

// ---------------------------------------------------------------------------
// debugApi — deleteLogs has parameter building logic
// ---------------------------------------------------------------------------

describe('debugApi', () => {
  describe('deleteLogs', () => {
    it('passes olderThanDays as string param', async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      await debugApi.deleteLogs({ olderThanDays: 30 });
      expect(mockDelete).toHaveBeenCalledWith('/chat/logs', {
        params: { olderThanDays: '30' },
      });
    });

    it('passes all=true as string param', async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      await debugApi.deleteLogs({ all: true });
      expect(mockDelete).toHaveBeenCalledWith('/chat/logs', {
        params: { all: 'true' },
      });
    });

    it('omits all when false', async () => {
      mockDelete.mockResolvedValueOnce(undefined);
      await debugApi.deleteLogs({ all: false });
      const params = (mockDelete.mock.calls[0]![1] as { params: Record<string, string> }).params;
      expect(params.all).toBeUndefined();
    });
  });

  describe('get', () => {
    it('passes count when provided', async () => {
      mockGet.mockResolvedValueOnce({});
      await debugApi.get(50);
      expect(mockGet).toHaveBeenCalledWith('/debug', { params: { count: '50' } });
    });

    it('omits params when count is not provided', async () => {
      mockGet.mockResolvedValueOnce({});
      await debugApi.get();
      expect(mockGet).toHaveBeenCalledWith('/debug', { params: undefined });
    });
  });
});

// ---------------------------------------------------------------------------
// fileWorkspacesApi — downloadUrl is a pure function, cleanup has defaults
// ---------------------------------------------------------------------------

describe('fileWorkspacesApi', () => {
  it('downloadUrl returns static URL string', () => {
    expect(fileWorkspacesApi.downloadUrl('ws-1')).toBe('/api/v1/file-workspaces/ws-1/download');
  });

  it('cleanup uses default mode and maxAgeDays', async () => {
    mockPost.mockResolvedValueOnce({ deleted: 0, kept: 0, mode: 'old', stats: {} });
    await fileWorkspacesApi.cleanup();
    expect(mockPost).toHaveBeenCalledWith('/file-workspaces/cleanup', {
      mode: 'old',
      maxAgeDays: 7,
    });
  });

  it('cleanup uses custom options', async () => {
    mockPost.mockResolvedValueOnce({ deleted: 0, kept: 0, mode: 'both', stats: {} });
    await fileWorkspacesApi.cleanup({ mode: 'both', maxAgeDays: 30 });
    expect(mockPost).toHaveBeenCalledWith('/file-workspaces/cleanup', {
      mode: 'both',
      maxAgeDays: 30,
    });
  });

  it('files passes optional path param', async () => {
    mockGet.mockResolvedValueOnce({ path: '/', files: [], count: 0 });
    await fileWorkspacesApi.files('ws-1', '/src');
    expect(mockGet).toHaveBeenCalledWith('/file-workspaces/ws-1/files', {
      params: { path: '/src' },
    });
  });

  it('files omits path param when not provided', async () => {
    mockGet.mockResolvedValueOnce({ path: '/', files: [], count: 0 });
    await fileWorkspacesApi.files('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/file-workspaces/ws-1/files', {
      params: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// chatApi — some methods have params/body logic
// ---------------------------------------------------------------------------

describe('chatApi', () => {
  it('send calls stream with body', async () => {
    mockStream.mockResolvedValueOnce({} as Response);
    await chatApi.send({ message: 'hi', provider: 'openai', model: 'gpt-4' });
    expect(mockStream).toHaveBeenCalledWith(
      '/chat',
      { message: 'hi', provider: 'openai', model: 'gpt-4' },
      undefined
    );
  });

  it('listHistory passes search params', async () => {
    mockGet.mockResolvedValueOnce({ conversations: [], total: 0, limit: 20, offset: 0 });
    await chatApi.listHistory({ search: 'hello', limit: 10 });
    expect(mockGet).toHaveBeenCalledWith('/chat/history', {
      params: { search: 'hello', limit: 10 },
    });
  });

  it('deleteAllHistory posts with all:true', async () => {
    mockPost.mockResolvedValueOnce({ deleted: 5 });
    await chatApi.deleteAllHistory();
    expect(mockPost).toHaveBeenCalledWith('/chat/history/bulk-delete', { all: true });
  });
});

// ---------------------------------------------------------------------------
// agentsApi — list unwraps items
// ---------------------------------------------------------------------------

describe('agentsApi', () => {
  it('list unwraps items from response', async () => {
    mockGet.mockResolvedValueOnce({ items: [{ id: 'a1', name: 'Bot' }] });
    const result = await agentsApi.list();
    expect(result).toEqual([{ id: 'a1', name: 'Bot' }]);
  });

  it('create sends POST with agent data', async () => {
    mockPost.mockResolvedValueOnce({ id: 'a1' });
    await agentsApi.create({ name: 'Bot', systemPrompt: 'You are helpful' });
    expect(mockPost).toHaveBeenCalledWith('/agents', {
      name: 'Bot',
      systemPrompt: 'You are helpful',
    });
  });
});

// ---------------------------------------------------------------------------
// toolsApi
// ---------------------------------------------------------------------------

describe('toolsApi', () => {
  it('listGrouped passes grouped=true param', async () => {
    mockGet.mockResolvedValueOnce({ categories: {}, totalTools: 0 });
    await toolsApi.listGrouped();
    expect(mockGet).toHaveBeenCalledWith('/tools', { params: { grouped: 'true' } });
  });

  it('execute sends tool name and args', async () => {
    mockPost.mockResolvedValueOnce({ result: 'ok' });
    await toolsApi.execute('core.search', { query: 'test' });
    expect(mockPost).toHaveBeenCalledWith('/tools/core.search/execute', {
      arguments: { query: 'test' },
    });
  });
});

// ---------------------------------------------------------------------------
// composioApi — searchActions has conditional app param
// ---------------------------------------------------------------------------

describe('composioApi', () => {
  it('searchActions passes query and app when provided', async () => {
    mockGet.mockResolvedValueOnce({ actions: [], count: 0 });
    await composioApi.searchActions('send email', 'gmail');
    expect(mockGet).toHaveBeenCalledWith('/composio/actions/search', {
      params: { q: 'send email', app: 'gmail' },
    });
  });

  it('searchActions omits app param when not provided', async () => {
    mockGet.mockResolvedValueOnce({ actions: [], count: 0 });
    await composioApi.searchActions('search');
    expect(mockGet).toHaveBeenCalledWith('/composio/actions/search', {
      params: { q: 'search' },
    });
  });
});

// ---------------------------------------------------------------------------
// customToolsApi — list has optional status filter
// ---------------------------------------------------------------------------

describe('customToolsApi', () => {
  it('list passes status filter', async () => {
    mockGet.mockResolvedValueOnce({ tools: [] });
    await customToolsApi.list('active');
    expect(mockGet).toHaveBeenCalledWith('/custom-tools', { params: { status: 'active' } });
  });

  it('list omits status when not provided', async () => {
    mockGet.mockResolvedValueOnce({ tools: [] });
    await customToolsApi.list();
    expect(mockGet).toHaveBeenCalledWith('/custom-tools', { params: undefined });
  });

  it('setWorkflowUsable sends PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ workflowUsable: true });
    await customToolsApi.setWorkflowUsable('ct-1', true);
    expect(mockPatch).toHaveBeenCalledWith('/custom-tools/ct-1/workflow-usable', { enabled: true });
  });
});

// ---------------------------------------------------------------------------
// channelsApi — inbox has optional params
// ---------------------------------------------------------------------------

describe('channelsApi', () => {
  it('inbox passes optional params', async () => {
    mockGet.mockResolvedValueOnce({ messages: [], total: 0, unreadCount: 0 });
    await channelsApi.inbox({ limit: 50, channelId: 'ch-1' });
    expect(mockGet).toHaveBeenCalledWith('/channels/messages/inbox', {
      params: { limit: 50, channelId: 'ch-1' },
    });
  });

  it('clearMessages passes optional channelId', async () => {
    mockDelete.mockResolvedValueOnce({ deleted: 5 });
    await channelsApi.clearMessages('ch-1');
    expect(mockDelete).toHaveBeenCalledWith('/channels/messages', {
      params: { channelId: 'ch-1' },
    });
  });

  it('clearMessages omits channelId when not provided', async () => {
    mockDelete.mockResolvedValueOnce({ deleted: 5 });
    await channelsApi.clearMessages();
    expect(mockDelete).toHaveBeenCalledWith('/channels/messages', { params: undefined });
  });
});

// ---------------------------------------------------------------------------
// workflowsApi — execute/copilot use stream
// ---------------------------------------------------------------------------

describe('workflowsApi', () => {
  it('execute calls stream with workflow id', async () => {
    mockStream.mockResolvedValueOnce({} as Response);
    await workflowsApi.execute('wf-1');
    expect(mockStream).toHaveBeenCalledWith('/workflows/wf-1/execute', {});
  });

  it('copilot calls stream with body and signal', async () => {
    const ctrl = new AbortController();
    mockStream.mockResolvedValueOnce({} as Response);
    await workflowsApi.copilot(
      { messages: [{ role: 'user', content: 'Create a workflow' }] },
      { signal: ctrl.signal }
    );
    expect(mockStream).toHaveBeenCalledWith(
      '/workflows/copilot',
      { messages: [{ role: 'user', content: 'Create a workflow' }] },
      { signal: ctrl.signal }
    );
  });
});

// ---------------------------------------------------------------------------
// triggersApi — history/globalHistory have parameter building logic
// ---------------------------------------------------------------------------

describe('triggersApi', () => {
  describe('history', () => {
    it('builds params from all filter options', async () => {
      mockGet.mockResolvedValueOnce({ items: [], total: 0 });
      await triggersApi.history('tr-1', {
        status: 'success',
        from: '2025-01-01',
        to: '2025-12-31',
        limit: 10,
        offset: 5,
      });
      expect(mockGet).toHaveBeenCalledWith('/triggers/tr-1/history', {
        params: {
          status: 'success',
          from: '2025-01-01',
          to: '2025-12-31',
          limit: '10',
          offset: '5',
        },
      });
    });

    it('omits params when none provided', async () => {
      mockGet.mockResolvedValueOnce({ items: [], total: 0 });
      await triggersApi.history('tr-1');
      expect(mockGet).toHaveBeenCalledWith('/triggers/tr-1/history', { params: undefined });
    });
  });

  describe('globalHistory', () => {
    it('includes triggerId in params', async () => {
      mockGet.mockResolvedValueOnce({ items: [], total: 0 });
      await triggersApi.globalHistory({ triggerId: 'tr-1', limit: 20 });
      expect(mockGet).toHaveBeenCalledWith('/triggers/history', {
        params: { triggerId: 'tr-1', limit: '20' },
      });
    });

    it('omits params when empty', async () => {
      mockGet.mockResolvedValueOnce({ items: [], total: 0 });
      await triggersApi.globalHistory({});
      expect(mockGet).toHaveBeenCalledWith('/triggers/history', { params: undefined });
    });

    it('omits params when not provided', async () => {
      mockGet.mockResolvedValueOnce({ items: [], total: 0 });
      await triggersApi.globalHistory();
      expect(mockGet).toHaveBeenCalledWith('/triggers/history', { params: undefined });
    });
  });
});

// ---------------------------------------------------------------------------
// tasksApi — list has optional status filter
// ---------------------------------------------------------------------------

describe('tasksApi', () => {
  it('list passes status array param', async () => {
    mockGet.mockResolvedValueOnce([]);
    await tasksApi.list({ status: ['pending', 'active'] });
    expect(mockGet).toHaveBeenCalledWith('/tasks', {
      params: { status: ['pending', 'active'] },
    });
  });

  it('list omits status when not provided', async () => {
    mockGet.mockResolvedValueOnce([]);
    await tasksApi.list();
    expect(mockGet).toHaveBeenCalledWith('/tasks', { params: undefined });
  });
});

// ---------------------------------------------------------------------------
// costsApi — methods with params
// ---------------------------------------------------------------------------

describe('costsApi', () => {
  it('getSummary passes period param', async () => {
    mockGet.mockResolvedValueOnce({});
    await costsApi.getSummary('daily');
    expect(mockGet).toHaveBeenCalledWith('/costs', { params: { period: 'daily' } });
  });

  it('setBudget sends POST', async () => {
    mockPost.mockResolvedValueOnce({});
    await costsApi.setBudget({ dailyLimit: 5, monthlyLimit: 100 });
    expect(mockPost).toHaveBeenCalledWith('/costs/budget', { dailyLimit: 5, monthlyLimit: 100 });
  });
});

// ---------------------------------------------------------------------------
// Simple passthrough coverage — verify correct paths
// ---------------------------------------------------------------------------

describe('simple passthrough endpoints', () => {
  it('authApi.status', async () => {
    mockGet.mockResolvedValueOnce({ passwordConfigured: false, authenticated: false });
    await authApi.status();
    expect(mockGet).toHaveBeenCalledWith('/auth/status');
  });

  it('authApi.login', async () => {
    mockPost.mockResolvedValueOnce({ token: 'tok', expiresAt: '' });
    await authApi.login('password123');
    expect(mockPost).toHaveBeenCalledWith('/auth/login', { password: 'password123' });
  });

  it('modelsApi.list', async () => {
    mockGet.mockResolvedValueOnce({});
    await modelsApi.list();
    expect(mockGet).toHaveBeenCalledWith('/models');
  });

  it('settingsApi.saveApiKey', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    await settingsApi.saveApiKey('openai', 'sk-xxx');
    expect(mockPost).toHaveBeenCalledWith('/settings/api-keys', {
      provider: 'openai',
      apiKey: 'sk-xxx',
    });
  });

  it('settingsApi.deleteApiKey', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await settingsApi.deleteApiKey('openai');
    expect(mockDelete).toHaveBeenCalledWith('/settings/api-keys/openai');
  });

  it('executionPermissionsApi.update', async () => {
    mockPut.mockResolvedValueOnce({});
    await executionPermissionsApi.update({ enabled: true });
    expect(mockPut).toHaveBeenCalledWith('/execution-permissions', { enabled: true });
  });

  it('mcpApi.connect', async () => {
    mockPost.mockResolvedValueOnce({ connected: true, tools: [], toolCount: 0 });
    await mcpApi.connect('srv-1');
    expect(mockPost).toHaveBeenCalledWith('/mcp/srv-1/connect');
  });

  it('mcpApi.setToolSettings', async () => {
    mockPatch.mockResolvedValueOnce({});
    await mcpApi.setToolSettings('srv-1', 'tool_a', true);
    expect(mockPatch).toHaveBeenCalledWith('/mcp/srv-1/tool-settings', {
      toolName: 'tool_a',
      workflowUsable: true,
    });
  });
});
