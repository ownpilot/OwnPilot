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
import {
  autonomyApi,
  pulseApi,
  debugApi,
  fileWorkspacesApi,
  channelsApi,
  systemApi,
  workspacesApi,
  customDataApi,
  dashboardApi,
  modelConfigsApi,
  localProvidersApi,
  configServicesApi,
  expensesApi,
} from './misc.js';
import { chatApi } from './chat.js';
import { agentsApi } from './agents.js';
import { toolsApi } from './tools.js';
import { modelRoutingApi, settingsApi } from './settings.js';
import { authApi } from './auth.js';
import { modelsApi } from './models.js';
import { workflowsApi } from './workflows.js';
import { customToolsApi } from './custom-tools.js';
import { composioApi } from './composio.js';
import { executionPermissionsApi } from './execution-permissions.js';
import { mcpApi } from './mcp.js';
import { triggersApi } from './personal-data.js';
import {
  notesApi,
  bookmarksApi,
  contactsApi,
  habitsApi,
  pomodoroApi,
  calendarApi,
  goalsApi,
  memoriesApi,
  plansApi,
  capturesApi,
} from './personal-data.js';
import { tasksApi } from './tasks.js';
import { costsApi, summaryApi } from './summary.js';
import { voiceApi } from './voice.js';
import { clawsApi } from './claws.js';
import { codingAgentsApi, orchestrationApi } from './coding-agents.js';
import { agenticApi } from './agentic.js';
import { skillsApi } from './skills.js';
import { cliToolsApi } from './cli-tools.js';
import { edgeApi } from './edge.js';
import { providerAuthApi } from './providerAuth.js';
import { providersApi } from './providers.js';
import { profileApi } from './profile.js';
import { tunnelApi } from './tunnel.js';
import { securityApi } from './security.js';
import { evalApi } from './eval.js';
import { canvasApi } from './canvas.js';
import { artifactsApi } from './artifacts.js';
import { soulsApi, crewsApi, agentMessagesApi, heartbeatLogsApi } from './souls.js';

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
  it('delegates log listing, stats, detail, and clear routes', async () => {
    mockGet.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await debugApi.listLogs({ level: 'error' });
    expect(mockGet).toHaveBeenLastCalledWith('/chat/logs', { params: { level: 'error' } });
    await debugApi.getLogStats({ range: '24h' });
    expect(mockGet).toHaveBeenLastCalledWith('/chat/logs/stats', { params: { range: '24h' } });
    await debugApi.getLogs('log-1');
    expect(mockGet).toHaveBeenLastCalledWith('/chat/logs/log-1');
    await debugApi.clear();
    expect(mockDelete).toHaveBeenLastCalledWith('/debug');
  });

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
  it('send calls stream with body and options', async () => {
    mockStream.mockResolvedValueOnce({} as Response);
    const signal = new AbortController().signal;
    const body = {
      message: 'hi',
      provider: 'openai',
      model: 'gpt-4',
      stream: true,
      conversationId: 'conv-1',
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      directTools: ['core.search'],
      includeToolList: true,
      historyLength: 12,
    };

    await chatApi.send(body, { signal, headers: { 'X-Test': '1' } });

    expect(mockStream).toHaveBeenCalledWith('/chat', body, {
      signal,
      headers: { 'X-Test': '1' },
    });
  });

  it('resetContext posts provider and model', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    await chatApi.resetContext('openai', 'gpt-4.1');
    expect(mockPost).toHaveBeenCalledWith('/chat/reset-context', {
      provider: 'openai',
      model: 'gpt-4.1',
    });
  });

  it('listHistory passes all supported filters including false booleans', async () => {
    mockGet.mockResolvedValueOnce({ conversations: [], total: 0, limit: 20, offset: 0 });
    await chatApi.listHistory({
      search: 'hello world',
      limit: 10,
      offset: 5,
      agentId: 'agent-1',
      archived: false,
      source: 'channel',
      channelPlatform: 'telegram',
    });
    expect(mockGet).toHaveBeenCalledWith('/chat/history', {
      params: {
        search: 'hello world',
        limit: 10,
        offset: 5,
        agentId: 'agent-1',
        archived: false,
        source: 'channel',
        channelPlatform: 'telegram',
      },
    });
  });

  it('passes history ids through route-based methods', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await chatApi.getHistory('conv-1');
    expect(mockGet).toHaveBeenLastCalledWith('/chat/history/conv-1');
    await chatApi.getUnifiedHistory('conv-1');
    expect(mockGet).toHaveBeenLastCalledWith('/chat/history/conv-1/unified');
    await chatApi.sendChannelMessage('conv-1', 'hello');
    expect(mockPost).toHaveBeenLastCalledWith('/chat/channel-send', {
      conversationId: 'conv-1',
      text: 'hello',
    });
    await chatApi.channelReply('conv-1', 'reply');
    expect(mockPost).toHaveBeenLastCalledWith('/chat/history/conv-1/channel-reply', {
      text: 'reply',
    });
    await chatApi.deleteHistory('conv-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/chat/history/conv-1');
    await chatApi.archiveHistory('conv-1', false);
    expect(mockPatch).toHaveBeenLastCalledWith('/chat/history/conv-1/archive', { archived: false });
    await chatApi.renameConversation('conv-1', 'New title');
    expect(mockPatch).toHaveBeenLastCalledWith('/chat/history/conv-1', { title: 'New title' });
  });

  it('builds bulk history operation bodies', async () => {
    mockPost.mockResolvedValue({});

    await chatApi.bulkDeleteHistory(['a', 'b']);
    expect(mockPost).toHaveBeenLastCalledWith('/chat/history/bulk-delete', { ids: ['a', 'b'] });
    await chatApi.deleteAllHistory();
    expect(mockPost).toHaveBeenLastCalledWith('/chat/history/bulk-delete', { all: true });
    await chatApi.deleteOldHistory(30);
    expect(mockPost).toHaveBeenLastCalledWith('/chat/history/bulk-delete', { olderThanDays: 30 });
    await chatApi.bulkArchiveHistory(['a'], true);
    expect(mockPost).toHaveBeenLastCalledWith('/chat/history/bulk-archive', {
      ids: ['a'],
      archived: true,
    });
  });

  it('delegates context detail and compaction bodies', async () => {
    mockGet.mockResolvedValueOnce({ breakdown: null });
    await chatApi.getContextDetail('openai', 'gpt-4.1');
    expect(mockGet).toHaveBeenCalledWith('/chat/context-detail', {
      params: { provider: 'openai', model: 'gpt-4.1' },
    });

    mockPost.mockResolvedValueOnce({ compacted: true, removedMessages: 4, newTokenEstimate: 100 });
    await chatApi.compactContext('openai', 'gpt-4.1', 8);
    expect(mockPost).toHaveBeenCalledWith('/chat/compact', {
      provider: 'openai',
      model: 'gpt-4.1',
      keepRecentMessages: 8,
    });
  });

  it('encodes fetchUrl query values', async () => {
    mockGet.mockResolvedValueOnce({
      url: 'https://example.test',
      title: 'Example',
      text: '',
      charCount: 0,
    });
    await chatApi.fetchUrl('https://example.test/a path?q=hello world&x=1');
    expect(mockGet).toHaveBeenCalledWith(
      '/chat/fetch-url?url=https%3A%2F%2Fexample.test%2Fa%20path%3Fq%3Dhello%20world%26x%3D1'
    );
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
  it('list fetches flat tools', async () => {
    mockGet.mockResolvedValueOnce([]);
    await toolsApi.list();
    expect(mockGet).toHaveBeenCalledWith('/tools');
  });

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

  it('source fetches tool source by name', async () => {
    mockGet.mockResolvedValueOnce({ source: 'export default {}' });
    await toolsApi.source('core.search');
    expect(mockGet).toHaveBeenCalledWith('/tools/core.search/source');
  });
});

// ---------------------------------------------------------------------------
// composioApi — searchActions has conditional app param
// ---------------------------------------------------------------------------

describe('composioApi', () => {
  it('delegates status, apps, and connections', async () => {
    mockGet.mockResolvedValue({});

    await composioApi.status();
    expect(mockGet).toHaveBeenLastCalledWith('/composio/status');
    await composioApi.apps();
    expect(mockGet).toHaveBeenLastCalledWith('/composio/apps');
    await composioApi.connections();
    expect(mockGet).toHaveBeenLastCalledWith('/composio/connections');
  });

  it('connects to an app and reads single connection', async () => {
    mockPost.mockResolvedValue({});
    mockGet.mockResolvedValue({});

    await composioApi.connect('gmail');
    expect(mockPost).toHaveBeenLastCalledWith('/composio/connections', { appName: 'gmail' });

    await composioApi.getConnection('conn-1');
    expect(mockGet).toHaveBeenLastCalledWith('/composio/connections/conn-1');
  });

  it('disconnects and refreshes a connection', async () => {
    mockDelete.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await composioApi.disconnect('conn-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/composio/connections/conn-1');

    await composioApi.refresh('conn-1');
    expect(mockPost).toHaveBeenLastCalledWith('/composio/connections/conn-1/refresh');
  });

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

  it('delegates stats, create, action, delete, and execute', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await customToolsApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/custom-tools/stats');

    const tool = {
      name: 'My tool',
      description: 'desc',
      code: 'return 1',
      parameters: {},
      permissions: ['fs.read'],
    };
    await customToolsApi.create(tool);
    expect(mockPost).toHaveBeenLastCalledWith('/custom-tools', tool);

    await customToolsApi.action('ct-1', 'enable');
    expect(mockPost).toHaveBeenLastCalledWith('/custom-tools/ct-1/enable');

    await customToolsApi.delete('ct-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/custom-tools/ct-1');

    await customToolsApi.execute('ct-1', { query: 'x' });
    expect(mockPost).toHaveBeenLastCalledWith('/custom-tools/ct-1/execute', {
      arguments: { query: 'x' },
    });
  });

  it('setWorkflowUsable sends PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ workflowUsable: true });
    await customToolsApi.setWorkflowUsable('ct-1', true);
    expect(mockPatch).toHaveBeenCalledWith('/custom-tools/ct-1/workflow-usable', { enabled: true });
  });
});

// ---------------------------------------------------------------------------
// agenticApi — task execution, planning, stats, capabilities
// ---------------------------------------------------------------------------

describe('agenticApi', () => {
  it('delegates execute, plan, and cancel', async () => {
    mockPost.mockResolvedValue({});

    const executeInput = {
      name: 'Plan trip',
      description: 'Find flights',
      prompt: 'Find a flight from IST to JFK',
      provider: 'openai',
      model: 'gpt-4.1',
      priority: 'high' as const,
    };
    await agenticApi.execute(executeInput);
    expect(mockPost).toHaveBeenLastCalledWith('/agentic/execute', executeInput);

    const planInput = {
      name: 'Plan trip',
      description: 'Find flights',
      priority: 'normal' as const,
    };
    await agenticApi.plan(planInput);
    expect(mockPost).toHaveBeenLastCalledWith('/agentic/plan', planInput);

    mockPost.mockResolvedValueOnce({ id: 'exec-1', status: 'cancelled' });
    await agenticApi.cancel('exec-1');
    expect(mockPost).toHaveBeenLastCalledWith('/agentic/executions/exec-1/cancel');
  });

  it('builds list query and delegates get, stats, and capabilities filters', async () => {
    mockGet.mockResolvedValue({});

    await agenticApi.list(10, 20);
    expect(mockGet).toHaveBeenLastCalledWith('/agentic/executions?limit=10&offset=20');

    await agenticApi.get('exec-1');
    expect(mockGet).toHaveBeenLastCalledWith('/agentic/executions/exec-1');

    await agenticApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/agentic/stats');

    await agenticApi.capabilities({ kind: 'claw', search: 'search', provider: 'openai' });
    const url = mockGet.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('/agentic/capabilities?');
    expect(url).toContain('kind=claw');
    expect(url).toContain('search=search');
    expect(url).toContain('provider=openai');

    await agenticApi.capabilities();
    expect(mockGet).toHaveBeenLastCalledWith('/agentic/capabilities');
  });
});

// ---------------------------------------------------------------------------
// codingAgentsApi — sessions, results, permissions, skill attachments, ACP, subs
// ---------------------------------------------------------------------------

describe('codingAgentsApi', () => {
  it('delegates status and provider test', async () => {
    mockGet.mockResolvedValueOnce([]);
    await codingAgentsApi.status();
    expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/status');

    mockPost.mockResolvedValueOnce({ provider: 'claude', available: true });
    await codingAgentsApi.test('claude');
    expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/test', { provider: 'claude' });
  });

  describe('sessions', () => {
    it('lists, creates, gets, terminates, sends input, resizes, and fetches output', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await codingAgentsApi.listSessions();
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/sessions');

      const createInput = {
        provider: 'claude',
        prompt: 'Build a button',
        cwd: 'D:/Code',
        model: 'sonnet',
      };
      await codingAgentsApi.createSession(createInput);
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/sessions', createInput);

      await codingAgentsApi.getSession('sess-1');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1');

      await codingAgentsApi.terminateSession('sess-1');
      expect(mockDelete).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1');

      await codingAgentsApi.sendInput('sess-1', 'ls\n');
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/input', {
        data: 'ls\n',
      });

      await codingAgentsApi.resizeTerminal('sess-1', 120, 40);
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/resize', {
        cols: 120,
        rows: 40,
      });

      await codingAgentsApi.getOutput('sess-1');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/output');
    });
  });

  describe('results', () => {
    it('lists with pagination defaults and fetches a single result', async () => {
      mockGet.mockResolvedValue({});

      await codingAgentsApi.listResults();
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/results?page=1&limit=20');

      await codingAgentsApi.listResults(3, 50);
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/results?page=3&limit=50');

      await codingAgentsApi.getResult('res-1');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/results/res-1');
    });
  });

  describe('permissions, skill attachments, ACP, and subscriptions', () => {
    it('delegates permission CRUD', async () => {
      mockGet.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await codingAgentsApi.listPermissions();
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/permissions');
      await codingAgentsApi.getPermissions('claude');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/permissions/claude');
      await codingAgentsApi.updatePermissions('claude', { networkAccess: false });
      expect(mockPut).toHaveBeenLastCalledWith('/coding-agents/permissions/claude', {
        networkAccess: false,
      });
      await codingAgentsApi.deletePermissions('claude');
      expect(mockDelete).toHaveBeenLastCalledWith('/coding-agents/permissions/claude');
    });

    it('delegates skill attachment CRUD', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await codingAgentsApi.listSkillAttachments('claude');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/skills/claude');
      await codingAgentsApi.attachSkill('claude', { label: 'TypeScript' });
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/skills/claude', {
        label: 'TypeScript',
      });
      await codingAgentsApi.updateSkillAttachment('claude', 'sa-1', { priority: 5 });
      expect(mockPut).toHaveBeenLastCalledWith('/coding-agents/skills/claude/sa-1', {
        priority: 5,
      });
      await codingAgentsApi.detachSkill('claude', 'sa-1');
      expect(mockDelete).toHaveBeenLastCalledWith('/coding-agents/skills/claude/sa-1');
    });

    it('delegates ACP endpoints and subscription CRUD', async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await codingAgentsApi.getAcpData('sess-1');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/acp');
      await codingAgentsApi.promptAcpSession('sess-1', 'continue');
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/acp/prompt', {
        prompt: 'continue',
      });
      await codingAgentsApi.cancelAcpSession('sess-1');
      expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/sessions/sess-1/acp/cancel');

      await codingAgentsApi.listSubscriptions();
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/subscriptions');
      await codingAgentsApi.getSubscription('claude');
      expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/subscriptions/claude');
      await codingAgentsApi.updateSubscription('claude', { monthlyBudgetUsd: 100 });
      expect(mockPut).toHaveBeenLastCalledWith('/coding-agents/subscriptions/claude', {
        monthlyBudgetUsd: 100,
      });
      await codingAgentsApi.deleteSubscription('claude');
      expect(mockDelete).toHaveBeenLastCalledWith('/coding-agents/subscriptions/claude');
    });
  });
});

// ---------------------------------------------------------------------------
// orchestrationApi — agent orchestration runs
// ---------------------------------------------------------------------------

describe('orchestrationApi', () => {
  it('delegates start, list with pagination, get, continue, cancel, and delete', async () => {
    mockPost.mockResolvedValue({});
    mockGet.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    const startInput = {
      goal: 'Refactor auth module',
      provider: 'claude',
      cwd: 'D:/Code',
      maxSteps: 8,
      autoMode: true,
    };
    await orchestrationApi.start(startInput);
    expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/orchestrate', startInput);

    await orchestrationApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/orchestrate?limit=20&offset=0');
    await orchestrationApi.list(50, 100);
    expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/orchestrate?limit=50&offset=100');

    await orchestrationApi.get('run-1');
    expect(mockGet).toHaveBeenLastCalledWith('/coding-agents/orchestrate/run-1');

    await orchestrationApi.continue('run-1', 'Yes, proceed');
    expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/orchestrate/run-1/continue', {
      prompt: 'Yes, proceed',
    });

    await orchestrationApi.cancel('run-1');
    expect(mockPost).toHaveBeenLastCalledWith('/coding-agents/orchestrate/run-1/cancel');

    await orchestrationApi.delete('run-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/coding-agents/orchestrate/run-1');
  });
});

// ---------------------------------------------------------------------------
// clawsApi — claws lifecycle, plan/task, history/audit, stats/eval, escalation
// ---------------------------------------------------------------------------

describe('clawsApi', () => {
  it('delegates list and preset/recommendation reads', async () => {
    mockGet.mockResolvedValue({});

    await clawsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/claws?limit=50&offset=0');
    await clawsApi.list(25, 75);
    expect(mockGet).toHaveBeenLastCalledWith('/claws?limit=25&offset=75');

    await clawsApi.presets();
    expect(mockGet).toHaveBeenLastCalledWith('/claws/presets');

    await clawsApi.recommendations();
    expect(mockGet).toHaveBeenLastCalledWith('/claws/recommendations');
  });

  it('delegates CRUD routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await clawsApi.get('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1');

    await clawsApi.doctor('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/doctor');

    const createInput = {
      name: 'Nightly digest',
      mission: 'Build a daily digest',
      mode: 'interval' as const,
      auto_start: true,
    };
    await clawsApi.create(createInput);
    expect(mockPost).toHaveBeenLastCalledWith('/claws', createInput);

    const updateInput = { name: 'Renamed', auto_start: false };
    await clawsApi.update('claw-1', updateInput);
    expect(mockPut).toHaveBeenLastCalledWith('/claws/claw-1', updateInput);

    await clawsApi.delete('claw-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/claws/claw-1');
  });

  it('delegates recommendations apply and batch apply', async () => {
    mockPost.mockResolvedValue({});

    await clawsApi.applyRecommendations('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/apply-recommendations');

    await clawsApi.applyRecommendationBatch(['claw-1', 'claw-2']);
    expect(mockPost).toHaveBeenLastCalledWith('/claws/recommendations/apply', {
      ids: ['claw-1', 'claw-2'],
    });

    await clawsApi.applyRecommendationBatch();
    expect(mockPost).toHaveBeenLastCalledWith('/claws/recommendations/apply', {});
  });

  it('delegates start/pause/resume/stop/execute/sendMessage', async () => {
    mockPost.mockResolvedValue({});

    await clawsApi.start('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/start');
    await clawsApi.pause('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/pause');
    await clawsApi.resume('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/resume');
    await clawsApi.stop('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/stop');
    await clawsApi.execute('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/execute');
    await clawsApi.sendMessage('claw-1', 'pause');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/message', { message: 'pause' });
  });

  it('delegates plan and task operations', async () => {
    mockPut.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await clawsApi.replacePlan('claw-1', [{ id: 't1', title: 'Step 1', status: 'pending' }]);
    expect(mockPut).toHaveBeenLastCalledWith('/claws/claw-1/plan', {
      tasks: [{ id: 't1', title: 'Step 1', status: 'pending' }],
    });

    await clawsApi.updateTask('claw-1', 't1', { status: 'completed', evidence: 'done' });
    expect(mockPatch).toHaveBeenLastCalledWith('/claws/claw-1/tasks/t1', {
      status: 'completed',
      evidence: 'done',
    });

    await clawsApi.splitTask('claw-1', 't1', [
      { title: 'Subtask A' },
      { title: 'Subtask B', successCriteria: 'returns 200' },
    ]);
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/tasks/t1/split', {
      subtasks: [{ title: 'Subtask A' }, { title: 'Subtask B', successCriteria: 'returns 200' }],
    });
  });

  it('builds history and audit query strings', async () => {
    mockGet.mockResolvedValue({});

    await clawsApi.getHistory('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/history?limit=20&offset=0');
    await clawsApi.getHistory('claw-1', 10, 5);
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/history?limit=10&offset=5');

    await clawsApi.getAuditLog('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/audit?limit=50&offset=0');
    await clawsApi.getAuditLog('claw-1', 25, 0, 'tool call');
    expect(mockGet).toHaveBeenLastCalledWith(
      '/claws/claw-1/audit?limit=25&offset=0&category=tool%20call'
    );

    await clawsApi.exportTrajectory('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/trajectory?limit=100&offset=0');
    await clawsApi.exportTrajectory('claw-1', 20, 10);
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/trajectory?limit=20&offset=10');
  });

  it('delegates eval, fleet eval, and stats', async () => {
    mockGet.mockResolvedValue({});

    await clawsApi.evaluate('claw-1');
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/eval?limit=200&offset=0');
    await clawsApi.evaluate('claw-1', 50, 5);
    expect(mockGet).toHaveBeenLastCalledWith('/claws/claw-1/eval?limit=50&offset=5');

    await clawsApi.fleetEval();
    expect(mockGet).toHaveBeenLastCalledWith('/claws/fleet/eval?limit=200');
    await clawsApi.fleetEval(50);
    expect(mockGet).toHaveBeenLastCalledWith('/claws/fleet/eval?limit=50');

    await clawsApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/claws/stats');
  });

  it('delegates recovery and escalation routes', async () => {
    mockPost.mockResolvedValue({});

    await clawsApi.resetFailures('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/reset-failures');

    await clawsApi.setNextIntent('claw-1', 'rephrase next cycle');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/next-intent', {
      intent: 'rephrase next cycle',
    });

    await clawsApi.approveEscalation('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/approve-escalation');

    await clawsApi.denyEscalation('claw-1');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/deny-escalation', {});

    await clawsApi.denyEscalation('claw-1', 'too risky');
    expect(mockPost).toHaveBeenLastCalledWith('/claws/claw-1/deny-escalation', {
      reason: 'too risky',
    });
  });
});

// ---------------------------------------------------------------------------
// personal-data APIs — notes/bookmarks/contacts/habits/pomodoro/calendar/goals/memories/plans/captures
// ---------------------------------------------------------------------------

describe('personal-data notes/bookmarks/contacts', () => {
  it('delegates notes CRUD and pin', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await notesApi.list({ search: 'idea' });
    expect(mockGet).toHaveBeenLastCalledWith('/notes', { params: { search: 'idea' } });
    await notesApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/notes', { params: undefined });

    await notesApi.create({ title: 'Note' });
    expect(mockPost).toHaveBeenLastCalledWith('/notes', { title: 'Note' });
    await notesApi.update('note-1', { title: 'Renamed' });
    expect(mockPatch).toHaveBeenLastCalledWith('/notes/note-1', { title: 'Renamed' });
    await notesApi.delete('note-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/notes/note-1');
    await notesApi.pin('note-1');
    expect(mockPost).toHaveBeenLastCalledWith('/notes/note-1/pin');
  });

  it('delegates bookmarks CRUD and favorite', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await bookmarksApi.list({ tag: 'rfc' });
    expect(mockGet).toHaveBeenLastCalledWith('/bookmarks', { params: { tag: 'rfc' } });
    await bookmarksApi.create({ url: 'https://example.test' });
    expect(mockPost).toHaveBeenLastCalledWith('/bookmarks', { url: 'https://example.test' });
    await bookmarksApi.update('bm-1', { title: 'Title' });
    expect(mockPatch).toHaveBeenLastCalledWith('/bookmarks/bm-1', { title: 'Title' });
    await bookmarksApi.delete('bm-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/bookmarks/bm-1');
    await bookmarksApi.favorite('bm-1');
    expect(mockPost).toHaveBeenLastCalledWith('/bookmarks/bm-1/favorite');
  });

  it('delegates contacts CRUD and favorite', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await contactsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/contacts', { params: undefined });
    await contactsApi.create({ name: 'Ada' });
    expect(mockPost).toHaveBeenLastCalledWith('/contacts', { name: 'Ada' });
    await contactsApi.update('c-1', { phone: '555' });
    expect(mockPatch).toHaveBeenLastCalledWith('/contacts/c-1', { phone: '555' });
    await contactsApi.delete('c-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/contacts/c-1');
    await contactsApi.favorite('c-1');
    expect(mockPost).toHaveBeenLastCalledWith('/contacts/c-1/favorite');
  });
});

describe('habitsApi and pomodoroApi', () => {
  it('delegates habit reads, CRUD, archive, log, and stats', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await habitsApi.list({ category: 'health' });
    expect(mockGet).toHaveBeenLastCalledWith('/habits', {
      params: { category: 'health' },
    });
    await habitsApi.getToday();
    expect(mockGet).toHaveBeenLastCalledWith('/habits/today');
    await habitsApi.categories();
    expect(mockGet).toHaveBeenLastCalledWith('/habits/categories');
    await habitsApi.get('habit-1');
    expect(mockGet).toHaveBeenLastCalledWith('/habits/habit-1');

    await habitsApi.create({ name: 'Run' });
    expect(mockPost).toHaveBeenLastCalledWith('/habits', { name: 'Run' });
    await habitsApi.update('habit-1', { targetCount: 5 });
    expect(mockPatch).toHaveBeenLastCalledWith('/habits/habit-1', { targetCount: 5 });
    await habitsApi.delete('habit-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/habits/habit-1');
    await habitsApi.archive('habit-1');
    expect(mockPost).toHaveBeenLastCalledWith('/habits/habit-1/archive');

    await habitsApi.log('habit-1', { count: 1 });
    expect(mockPost).toHaveBeenLastCalledWith('/habits/habit-1/log', { count: 1 });
    await habitsApi.log('habit-1');
    expect(mockPost).toHaveBeenLastCalledWith('/habits/habit-1/log', {});

    await habitsApi.getLogs('habit-1', { from: '2026-07-01' });
    expect(mockGet).toHaveBeenLastCalledWith('/habits/habit-1/logs', {
      params: { from: '2026-07-01' },
    });

    await habitsApi.getStats('habit-1');
    expect(mockGet).toHaveBeenLastCalledWith('/habits/habit-1');
  });

  it('delegates pomodoro session lifecycle and settings', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});

    await pomodoroApi.getSession();
    expect(mockGet).toHaveBeenLastCalledWith('/pomodoro/session');

    await pomodoroApi.startSession({ type: 'work', durationMinutes: 25, taskDescription: 'Code' });
    expect(mockPost).toHaveBeenLastCalledWith('/pomodoro/session/start', {
      type: 'work',
      durationMinutes: 25,
      taskDescription: 'Code',
    });

    await pomodoroApi.completeSession('sess-1');
    expect(mockPost).toHaveBeenLastCalledWith('/pomodoro/session/sess-1/complete');

    await pomodoroApi.interruptSession('sess-1');
    expect(mockPost).toHaveBeenLastCalledWith('/pomodoro/session/sess-1/interrupt', {});
    await pomodoroApi.interruptSession('sess-1', 'phone call');
    expect(mockPost).toHaveBeenLastCalledWith('/pomodoro/session/sess-1/interrupt', {
      reason: 'phone call',
    });

    await pomodoroApi.listSessions();
    expect(mockGet).toHaveBeenLastCalledWith('/pomodoro/sessions', { params: undefined });

    await pomodoroApi.getSettings();
    expect(mockGet).toHaveBeenLastCalledWith('/pomodoro/settings');
    await pomodoroApi.updateSettings({ workDuration: 30 });
    expect(mockPatch).toHaveBeenLastCalledWith('/pomodoro/settings', { workDuration: 30 });

    await pomodoroApi.getStats();
    expect(mockGet).toHaveBeenLastCalledWith('/pomodoro/stats');
  });
});

describe('calendarApi, goalsApi, memoriesApi, plansApi, capturesApi', () => {
  it('delegates calendar CRUD', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await calendarApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/calendar', { params: undefined });
    await calendarApi.create({ title: 'Standup' });
    expect(mockPost).toHaveBeenLastCalledWith('/calendar', { title: 'Standup' });
    await calendarApi.update('ev-1', { title: 'Standup (moved)' });
    expect(mockPatch).toHaveBeenLastCalledWith('/calendar/ev-1', {
      title: 'Standup (moved)',
    });
    await calendarApi.delete('ev-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/calendar/ev-1');
  });

  it('delegates goals CRUD, steps, and updateStep', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await goalsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/goals', { params: undefined });
    await goalsApi.create({ title: 'Read 12 books' });
    expect(mockPost).toHaveBeenLastCalledWith('/goals', { title: 'Read 12 books' });
    await goalsApi.update('goal-1', { title: 'Read 24 books' });
    expect(mockPatch).toHaveBeenLastCalledWith('/goals/goal-1', { title: 'Read 24 books' });
    await goalsApi.delete('goal-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/goals/goal-1');

    await goalsApi.steps('goal-1');
    expect(mockGet).toHaveBeenLastCalledWith('/goals/goal-1/steps');
    await goalsApi.updateStep('goal-1', 'step-1', { completed: true });
    expect(mockPatch).toHaveBeenLastCalledWith('/goals/goal-1/steps/step-1', {
      completed: true,
    });
  });

  it('delegates memories CRUD', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await memoriesApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/memories', { params: undefined });
    await memoriesApi.create({ text: 'Remembers Tarsnap' });
    expect(mockPost).toHaveBeenLastCalledWith('/memories', { text: 'Remembers Tarsnap' });
    await memoriesApi.update('mem-1', { text: 'updated' });
    expect(mockPatch).toHaveBeenLastCalledWith('/memories/mem-1', { text: 'updated' });
    await memoriesApi.delete('mem-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/memories/mem-1');
  });

  it('delegates plans CRUD, action, rollback, history, steps, and addStep', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await plansApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/plans', { params: undefined });
    await plansApi.create({ name: 'Roadmap' });
    expect(mockPost).toHaveBeenLastCalledWith('/plans', { name: 'Roadmap' });
    await plansApi.update('plan-1', { name: 'Updated' });
    expect(mockPatch).toHaveBeenLastCalledWith('/plans/plan-1', { name: 'Updated' });
    await plansApi.delete('plan-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/plans/plan-1');

    await plansApi.action('plan-1', 'start');
    expect(mockPost).toHaveBeenLastCalledWith('/plans/plan-1/start');

    await plansApi.rollback('plan-1');
    expect(mockPost).toHaveBeenLastCalledWith('/plans/plan-1/rollback');

    await plansApi.history('plan-1');
    expect(mockGet).toHaveBeenLastCalledWith('/plans/plan-1/history');
    await plansApi.steps('plan-1');
    expect(mockGet).toHaveBeenLastCalledWith('/plans/plan-1/steps');
    await plansApi.addStep('plan-1', { title: 'Step 1' });
    expect(mockPost).toHaveBeenLastCalledWith('/plans/plan-1/steps', { title: 'Step 1' });
  });

  it('delegates captures create', async () => {
    mockPost.mockResolvedValueOnce({ id: 'cap-1' });
    await capturesApi.create({ type: 'note', content: 'Quick capture' });
    expect(mockPost).toHaveBeenLastCalledWith('/captures', {
      type: 'note',
      content: 'Quick capture',
    });
  });
});

// ---------------------------------------------------------------------------
// triggersApi — fire/stats/due/engine surface
// ---------------------------------------------------------------------------

describe('triggersApi extras', () => {
  it('delegates fire and stats', async () => {
    mockPost.mockResolvedValue({});
    mockGet.mockResolvedValue({});

    await triggersApi.fire('tr-1');
    expect(mockPost).toHaveBeenLastCalledWith('/triggers/tr-1/fire');

    await triggersApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/stats');
  });

  it('lists due triggers and exposes engine lifecycle', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await triggersApi.due();
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/due');

    await triggersApi.engineStatus();
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/engine/status');

    await triggersApi.engineStart();
    expect(mockPost).toHaveBeenLastCalledWith('/triggers/engine/start');

    await triggersApi.engineStop();
    expect(mockPost).toHaveBeenLastCalledWith('/triggers/engine/stop');
  });

  it('handles null and explicit-zero paging in history', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    // history(id, params) with limit and offset explicitly null/undefined
    await triggersApi.history('tr-1', {
      status: 'success' as const,
      limit: null as unknown as number,
      offset: undefined,
    });
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/tr-1/history', {
      params: { status: 'success' },
    });

    // history(id) with no params object — params is undefined so no params key is set
    await triggersApi.history('tr-1', {});
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/tr-1/history', { params: undefined });
  });

  it('handles null and explicit-zero paging in globalHistory', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    // globalHistory({limit: null}) omits limit from the params
    await triggersApi.globalHistory({
      limit: null as unknown as number,
      from: '2025-01-01',
    });
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/history', {
      params: { from: '2025-01-01' },
    });

    // globalHistory({limit: 0, offset: 0}) — 0 is a valid limit and should be stringified
    await triggersApi.globalHistory({ limit: 0, offset: 0 });
    expect(mockGet).toHaveBeenLastCalledWith('/triggers/history', {
      params: { limit: '0', offset: '0' },
    });
  });

  it('list delegates query params when provided', async () => {
    mockGet.mockResolvedValueOnce({ triggers: [], total: 0 });
    await triggersApi.list({ status: 'active' });
    expect(mockGet).toHaveBeenLastCalledWith('/triggers', { params: { status: 'active' } });

    mockGet.mockResolvedValueOnce({ triggers: [], total: 0 });
    await triggersApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/triggers', { params: undefined });
  });

  it('update and delete pass IDs through to PATCH/DELETE', async () => {
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await triggersApi.update('tr-1', { enabled: false });
    expect(mockPatch).toHaveBeenLastCalledWith('/triggers/tr-1', { enabled: false });

    await triggersApi.delete('tr-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/triggers/tr-1');
  });
});

// ---------------------------------------------------------------------------
// skillsApi — npm search/install/permissions
// ---------------------------------------------------------------------------

describe('skillsApi', () => {
  it('builds search query with default limit and offset', async () => {
    mockGet.mockResolvedValueOnce({ packages: [], total: 0 });
    await skillsApi.search('web fetch');
    const url = mockGet.mock.calls[0]![0] as string;
    expect(url).toBe('/skills/search?q=web%20fetch&limit=20');
  });

  it('includes offset and encodes special characters in search query', async () => {
    mockGet.mockResolvedValueOnce({ packages: [], total: 0 });
    await skillsApi.search('a/b & c', 10, 30);
    const url = mockGet.mock.calls[0]![0] as string;
    expect(url).toContain('q=a%2Fb%20%26%20c');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=30');
  });

  it('encodes npm package name when fetching package info', async () => {
    mockGet.mockResolvedValueOnce({ name: '@scope/pkg', version: '1.0.0', description: '' });
    await skillsApi.getPackageInfo('@scope/pkg');
    expect(mockGet).toHaveBeenCalledWith('/skills/npm/%40scope%2Fpkg');
  });

  it('installs from npm, checks updates, and lists permission categories', async () => {
    mockPost.mockResolvedValue({});
    mockGet.mockResolvedValue({});

    await skillsApi.installNpm('@scope/pkg');
    expect(mockPost).toHaveBeenLastCalledWith('/skills/install-npm', {
      packageName: '@scope/pkg',
    });

    await skillsApi.checkUpdates();
    expect(mockPost).toHaveBeenLastCalledWith('/skills/check-updates');

    await skillsApi.listPermissions();
    expect(mockGet).toHaveBeenLastCalledWith('/skills/permissions');
  });

  it('reads and updates extension-scoped permissions', async () => {
    mockGet.mockResolvedValueOnce({ declared: { required: ['fs'], optional: [] }, granted: [] });
    await skillsApi.getPermissions('ext-1');
    expect(mockGet).toHaveBeenCalledWith('/skills/permissions/ext-1');

    mockPost.mockResolvedValueOnce({ grantedPermissions: ['fs'] });
    await skillsApi.updatePermissions('ext-1', ['fs']);
    expect(mockPost).toHaveBeenCalledWith('/skills/permissions/ext-1', {
      grantedPermissions: ['fs'],
    });
  });
});

// ---------------------------------------------------------------------------
// cliToolsApi — list, policies, install, custom registry
// ---------------------------------------------------------------------------

describe('cliToolsApi', () => {
  it('delegates list, policies, and refresh', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await cliToolsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/cli-tools');
    await cliToolsApi.policies();
    expect(mockGet).toHaveBeenLastCalledWith('/cli-tools/policies');
    await cliToolsApi.refresh();
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/refresh');
  });

  it('sets single policy and batch policy', async () => {
    mockPut.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await cliToolsApi.setPolicy('eslint', 'allowed');
    expect(mockPut).toHaveBeenCalledWith('/cli-tools/policies/eslint', { policy: 'allowed' });

    await cliToolsApi.batchSetPolicy('blocked', { riskLevel: 'high' });
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/policies/batch', {
      policy: 'blocked',
      riskLevel: 'high',
    });

    await cliToolsApi.batchSetPolicy('prompt', { tools: ['eslint', 'prettier'] });
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/policies/batch', {
      policy: 'prompt',
      tools: ['eslint', 'prettier'],
    });
  });

  it('installs using default npm-global method and accepts pnpm-global override', async () => {
    mockPost.mockResolvedValue({ success: true });

    await cliToolsApi.install('eslint');
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/eslint/install', {
      method: 'npm-global',
    });

    await cliToolsApi.install('eslint', 'pnpm-global');
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/eslint/install', {
      method: 'pnpm-global',
    });
  });

  it('registers and removes custom CLI tools', async () => {
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    const input = {
      name: 'mylinter',
      displayName: 'My Linter',
      binaryName: 'my-linter',
      category: 'linter' as const,
      riskLevel: 'low' as const,
    };
    await cliToolsApi.registerCustom(input);
    expect(mockPost).toHaveBeenLastCalledWith('/cli-tools/custom', input);

    await cliToolsApi.deleteCustom('mylinter');
    expect(mockDelete).toHaveBeenLastCalledWith('/cli-tools/custom/mylinter');
  });
});

// ---------------------------------------------------------------------------
// edgeApi — devices, commands, telemetry, mqtt
// ---------------------------------------------------------------------------

describe('edgeApi', () => {
  it('builds list query from filters and omits empty query strings', async () => {
    mockGet.mockResolvedValueOnce({ devices: [], total: 0 });
    await edgeApi.list({
      status: 'online',
      type: 'raspberry-pi',
      search: 'front door',
      limit: 25,
      offset: 5,
    });
    const url = mockGet.mock.calls[0]![0] as string;
    expect(url).toContain('/edge?');
    expect(url).toContain('status=online');
    expect(url).toContain('type=raspberry-pi');
    expect(url).toContain('search=front+door');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=5');

    mockGet.mockResolvedValueOnce({ devices: [], total: 0 });
    await edgeApi.list({ limit: 0, offset: 0 });
    expect(mockGet).toHaveBeenLastCalledWith('/edge');
  });

  it('delegates device CRUD and command operations', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await edgeApi.get('dev-1');
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1');

    const registerInput = { name: 'Doorbell', type: 'esp32' as const };
    await edgeApi.register(registerInput);
    expect(mockPost).toHaveBeenLastCalledWith('/edge', registerInput);

    await edgeApi.update('dev-1', { firmwareVersion: '1.2.3' });
    expect(mockPatch).toHaveBeenLastCalledWith('/edge/dev-1', { firmwareVersion: '1.2.3' });

    await edgeApi.remove('dev-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/edge/dev-1');

    await edgeApi.sendCommand('dev-1', { commandType: 'reboot' });
    expect(mockPost).toHaveBeenLastCalledWith('/edge/dev-1/command', { commandType: 'reboot' });

    await edgeApi.sendCommand('dev-1', { commandType: 'set_led', payload: { color: 'blue' } });
    expect(mockPost).toHaveBeenLastCalledWith('/edge/dev-1/command', {
      commandType: 'set_led',
      payload: { color: 'blue' },
    });
  });

  it('builds commands and telemetry query strings with optional limits', async () => {
    mockGet.mockResolvedValueOnce({ commands: [] });
    await edgeApi.getCommands('dev-1');
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1/commands');

    mockGet.mockResolvedValueOnce({ commands: [] });
    await edgeApi.getCommands('dev-1', 25);
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1/commands?limit=25');

    mockGet.mockResolvedValueOnce({ telemetry: [] });
    await edgeApi.getTelemetry('dev-1');
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1/telemetry');

    mockGet.mockResolvedValueOnce({ telemetry: [] });
    await edgeApi.getSensorHistory('dev-1', 'sensor-1');
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1/telemetry/sensor-1');

    mockGet.mockResolvedValueOnce({ telemetry: [] });
    await edgeApi.getSensorHistory('dev-1', 'sensor-1', 50);
    expect(mockGet).toHaveBeenLastCalledWith('/edge/dev-1/telemetry/sensor-1?limit=50');
  });

  it('delegates MQTT status read', async () => {
    mockGet.mockResolvedValueOnce({ connected: true, brokerUrl: 'mqtt://localhost' });
    await edgeApi.getMqttStatus();
    expect(mockGet).toHaveBeenCalledWith('/edge/mqtt/status');
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

  it('delegates channel lifecycle and auth routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await channelsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/channels');
    const body = { id: 'telegram', type: 'telegram', name: 'Telegram', config: { token: 'x' } };
    await channelsApi.create(body);
    expect(mockPost).toHaveBeenLastCalledWith('/channels', body);
    await channelsApi.send('telegram', { text: 'hi' });
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/send', { text: 'hi' });
    await channelsApi.markRead('msg-1');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/messages/msg-1/read');
    await channelsApi.setup('telegram', { token: 'x' });
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/setup', {
      config: { token: 'x' },
    });
    await channelsApi.connect('telegram');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/connect');
    await channelsApi.disconnect('telegram');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/disconnect');
    await channelsApi.logout('telegram');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/logout');
    await channelsApi.reply('telegram', { text: 'reply', platformChatId: 'chat-1' });
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/reply', {
      text: 'reply',
      platformChatId: 'chat-1',
    });
    await channelsApi.getUsers('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/channels/telegram/users');
    await channelsApi.getStats('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/channels/telegram/stats');
    await channelsApi.reconnect('telegram');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/telegram/reconnect');
    await channelsApi.getDetail('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/channels/telegram');
    await channelsApi.getQr('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/channels/telegram/qr');
    await channelsApi.approveUser('user-1');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/auth/users/user-1/approve');
    await channelsApi.blockUser('user-1');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/auth/users/user-1/block');
    await channelsApi.unblockUser('user-1');
    expect(mockPost).toHaveBeenLastCalledWith('/channels/auth/users/user-1/unblock');
    await channelsApi.deleteUser('user-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/channels/auth/users/user-1');
  });

  it('delegates pairing routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await channelsApi.getPairing();
    expect(mockGet).toHaveBeenCalledWith('/channels/pairing');
    await channelsApi.revokeOwner('telegram');
    expect(mockPost).toHaveBeenCalledWith('/channels/telegram/revoke-owner');
    await channelsApi.approvePairing('telegram', '123456');
    expect(mockPost).toHaveBeenCalledWith('/dm-pairing/approve', {
      platform: 'telegram',
      code: '123456',
    });
    await channelsApi.denyPairing('telegram', 'user-1');
    expect(mockPost).toHaveBeenCalledWith('/dm-pairing/deny', {
      platform: 'telegram',
      platformUserId: 'user-1',
    });
    await channelsApi.getPendingPairingSenders('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/dm-pairing/pending/telegram');
  });
});

// ---------------------------------------------------------------------------
// misc endpoint groups — low-risk wrapper contracts
// ---------------------------------------------------------------------------

describe('systemApi', () => {
  it('delegates health, dependencies, database reads, and download URL generation', async () => {
    mockGet.mockResolvedValue({});

    await systemApi.health();
    expect(mockGet).toHaveBeenLastCalledWith('/health');
    await systemApi.toolDependencies();
    expect(mockGet).toHaveBeenLastCalledWith('/health/tool-dependencies');
    await systemApi.databaseStatus();
    expect(mockGet).toHaveBeenLastCalledWith('/db/status');
    await systemApi.databaseStats();
    expect(mockGet).toHaveBeenLastCalledWith('/db/stats');
    await systemApi.databaseOperationStatus();
    expect(mockGet).toHaveBeenLastCalledWith('/db/operation/status');
    await systemApi.listBackups();
    expect(mockGet).toHaveBeenLastCalledWith('/db/backups');
    expect(systemApi.downloadBackup('backup 1.sql')).toBe(
      '/api/v1/db/backups/backup%201.sql/download'
    );
  });

  it('passes admin headers and query params for database operations', async () => {
    mockPost.mockResolvedValue({});
    mockGet.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await systemApi.databaseOperation('vacuum', { dryRun: true }, 'admin-key');
    expect(mockPost).toHaveBeenCalledWith(
      '/db/vacuum',
      { dryRun: true },
      { headers: { 'X-Admin-Key': 'admin-key' } }
    );
    await systemApi.deleteBackup('backup.sql', 'admin-key');
    expect(mockDelete).toHaveBeenCalledWith('/db/backup/backup.sql', {
      headers: { 'X-Admin-Key': 'admin-key' },
    });
    await systemApi.exportJson(['users', 'tasks'], 'admin-key');
    expect(mockGet).toHaveBeenCalledWith('/db/export', {
      params: { tables: 'users,tasks' },
      headers: { 'X-Admin-Key': 'admin-key' },
    });
    await systemApi.importJson({ users: [] }, { truncate: true }, 'admin-key');
    expect(mockPost).toHaveBeenCalledWith(
      '/db/import',
      { data: { users: [] }, options: { truncate: true } },
      { headers: { 'X-Admin-Key': 'admin-key' } }
    );
    await systemApi.exportCsvTable('users', 'admin-key');
    expect(mockGet).toHaveBeenCalledWith('/db/export/csv/users', {
      headers: { 'X-Admin-Key': 'admin-key' },
    });
    await systemApi.importCsv('users', 'id,name', 'admin-key');
    expect(mockPost).toHaveBeenCalledWith('/db/import/csv/users', 'id,name', {
      headers: { 'Content-Type': 'text/csv', 'X-Admin-Key': 'admin-key' },
    });
  });
});

describe('workspace and custom data APIs', () => {
  it('delegates workspace CRUD', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await workspacesApi.list();
    expect(mockGet).toHaveBeenCalledWith('/workspaces');
    await workspacesApi.create('Research');
    expect(mockPost).toHaveBeenCalledWith('/workspaces', { name: 'Research' });
    await workspacesApi.delete('ws-1');
    expect(mockDelete).toHaveBeenCalledWith('/workspaces/ws-1');
  });

  it('delegates custom data table and record operations', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await customDataApi.tables();
    expect(mockGet).toHaveBeenLastCalledWith('/custom-data/tables');
    await customDataApi.search('tbl-1', 'needle');
    expect(mockGet).toHaveBeenLastCalledWith('/custom-data/tables/tbl-1/search', {
      params: { q: 'needle' },
    });
    await customDataApi.records('tbl-1', 20);
    expect(mockGet).toHaveBeenLastCalledWith('/custom-data/tables/tbl-1/records', {
      params: { limit: '20' },
    });
    await customDataApi.records('tbl-1');
    expect(mockGet).toHaveBeenLastCalledWith('/custom-data/tables/tbl-1/records', {
      params: undefined,
    });
    const table = { name: 'books', displayName: 'Books', columns: [] };
    await customDataApi.createTable(table);
    expect(mockPost).toHaveBeenLastCalledWith('/custom-data/tables', table);
    await customDataApi.deleteTable('tbl-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/custom-data/tables/tbl-1');
    await customDataApi.createRecord('tbl-1', { title: 'Dune' });
    expect(mockPost).toHaveBeenLastCalledWith('/custom-data/tables/tbl-1/records', {
      data: { title: 'Dune' },
    });
    await customDataApi.updateRecord('rec-1', { title: 'Dune Messiah' });
    expect(mockPut).toHaveBeenLastCalledWith('/custom-data/records/rec-1', {
      data: { title: 'Dune Messiah' },
    });
    await customDataApi.deleteRecord('rec-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/custom-data/records/rec-1');
  });
});

describe('dashboard and model config APIs', () => {
  it('delegates dashboard reads and briefing stream', async () => {
    mockGet.mockResolvedValue({});
    mockStream.mockResolvedValue({} as Response);

    await dashboardApi.data();
    expect(mockGet).toHaveBeenCalledWith('/dashboard/data');
    const signal = new AbortController().signal;
    await dashboardApi.briefing({ signal });
    expect(mockGet).toHaveBeenLastCalledWith('/dashboard/briefing', { signal });
    await dashboardApi.briefingStream({ headers: { Accept: 'text/event-stream' } });
    expect(mockStream).toHaveBeenCalledWith(
      '/dashboard/briefing/stream',
      {},
      { headers: { Accept: 'text/event-stream' } }
    );
  });

  it('delegates model config and local provider routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await modelConfigsApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/model-configs');
    await modelConfigsApi.availableProviders();
    expect(mockGet).toHaveBeenLastCalledWith('/model-configs/providers/available');
    await modelConfigsApi.capabilities();
    expect(mockGet).toHaveBeenLastCalledWith('/model-configs/capabilities/list');
    await modelConfigsApi.syncApply();
    expect(mockPost).toHaveBeenLastCalledWith('/model-configs/sync/apply');
    await modelConfigsApi.syncReset();
    expect(mockPost).toHaveBeenLastCalledWith('/model-configs/sync/reset');

    await localProvidersApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/local-providers');
    await localProvidersApi.templates();
    expect(mockGet).toHaveBeenLastCalledWith('/local-providers/templates');
    const data = { name: 'Local', providerType: 'openai', baseUrl: 'http://localhost:11434' };
    await localProvidersApi.create(data);
    expect(mockPost).toHaveBeenLastCalledWith('/local-providers', data);
    await localProvidersApi.models('local-1');
    expect(mockGet).toHaveBeenLastCalledWith('/local-providers/local-1/models');
  });
});

describe('configServicesApi and expensesApi', () => {
  it('delegates config service routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await configServicesApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/config-services');
    await configServicesApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/config-services/stats');
    await configServicesApi.categories();
    expect(mockGet).toHaveBeenLastCalledWith('/config-services/categories');
    await configServicesApi.createEntry('github', { token: 'x' });
    expect(mockPost).toHaveBeenLastCalledWith('/config-services/github/entries', { token: 'x' });
    await configServicesApi.updateEntry('github', 'entry-1', { token: 'y' });
    expect(mockPut).toHaveBeenLastCalledWith('/config-services/github/entries/entry-1', {
      token: 'y',
    });
    await configServicesApi.deleteEntry('github', 'entry-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/config-services/github/entries/entry-1');
    await configServicesApi.setDefault('github', 'entry-1');
    expect(mockPut).toHaveBeenLastCalledWith('/config-services/github/entries/entry-1/default');
  });

  it('delegates expense routes with params and bodies', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await expensesApi.monthly(2026);
    expect(mockGet).toHaveBeenCalledWith('/expenses/monthly', { params: { year: 2026 } });
    await expensesApi.summary({ month: '2026-07' });
    expect(mockGet).toHaveBeenCalledWith('/expenses/summary', { params: { month: '2026-07' } });
    await expensesApi.list({ category: 'tools' });
    expect(mockGet).toHaveBeenCalledWith('/expenses', { params: { category: 'tools' } });
    const expense = {
      date: '2026-07-07',
      amount: 12,
      currency: 'USD',
      category: 'tools',
      description: 'API',
    };
    await expensesApi.create(expense);
    expect(mockPost).toHaveBeenCalledWith('/expenses', expense);
    await expensesApi.update('exp-1', { amount: 15 });
    expect(mockPut).toHaveBeenCalledWith('/expenses/exp-1', { amount: 15 });
    await expensesApi.delete('exp-1');
    expect(mockDelete).toHaveBeenCalledWith('/expenses/exp-1');
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

  it('delegates task create, update, complete, and delete', async () => {
    mockPost.mockResolvedValue({ id: 'task-1' });
    mockPatch.mockResolvedValue({ id: 'task-1' });
    mockDelete.mockResolvedValue(undefined);

    await tasksApi.create({ title: 'Write tests' });
    expect(mockPost).toHaveBeenLastCalledWith('/tasks', { title: 'Write tests' });

    await tasksApi.update('task-1', { status: 'completed' });
    expect(mockPatch).toHaveBeenCalledWith('/tasks/task-1', { status: 'completed' });

    await tasksApi.complete('task-1');
    expect(mockPost).toHaveBeenLastCalledWith('/tasks/task-1/complete');

    await tasksApi.delete('task-1');
    expect(mockDelete).toHaveBeenCalledWith('/tasks/task-1');
  });
});

// ---------------------------------------------------------------------------
// costsApi — methods with params
// ---------------------------------------------------------------------------

describe('summaryApi and costsApi', () => {
  it('summaryApi.get fetches summary', async () => {
    mockGet.mockResolvedValueOnce({});
    await summaryApi.get();
    expect(mockGet).toHaveBeenCalledWith('/summary');
  });

  it('costsApi.usage fetches usage', async () => {
    mockGet.mockResolvedValueOnce({});
    await costsApi.usage();
    expect(mockGet).toHaveBeenCalledWith('/costs/usage');
  });

  it('getSummary passes period param', async () => {
    mockGet.mockResolvedValueOnce({});
    await costsApi.getSummary('daily');
    expect(mockGet).toHaveBeenCalledWith('/costs', { params: { period: 'daily' } });
  });

  it('getBreakdown passes period param', async () => {
    mockGet.mockResolvedValueOnce({});
    await costsApi.getBreakdown('monthly');
    expect(mockGet).toHaveBeenCalledWith('/costs/breakdown', { params: { period: 'monthly' } });
  });

  it('setBudget sends POST', async () => {
    mockPost.mockResolvedValueOnce({});
    await costsApi.setBudget({ dailyLimit: 5, monthlyLimit: 100 });
    expect(mockPost).toHaveBeenCalledWith('/costs/budget', { dailyLimit: 5, monthlyLimit: 100 });
  });

  it('getSubscriptions fetches subscription summary', async () => {
    mockGet.mockResolvedValueOnce({ subscriptions: [], totalMonthlyUsd: 0 });
    await costsApi.getSubscriptions();
    expect(mockGet).toHaveBeenCalledWith('/costs/subscriptions');
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

  it('voiceApi.getConfig', async () => {
    mockGet.mockResolvedValueOnce({});
    await voiceApi.getConfig();
    expect(mockGet).toHaveBeenCalledWith('/voice/config');
  });

  it('voiceApi.getStatus', async () => {
    mockGet.mockResolvedValueOnce({});
    await voiceApi.getStatus();
    expect(mockGet).toHaveBeenCalledWith('/voice/status');
  });

  it('voiceApi.getVoices', async () => {
    mockGet.mockResolvedValueOnce({});
    await voiceApi.getVoices();
    expect(mockGet).toHaveBeenCalledWith('/voice/voices');
  });

  it('voiceApi.getDiagnostics', async () => {
    mockGet.mockResolvedValueOnce({});
    await voiceApi.getDiagnostics();
    expect(mockGet).toHaveBeenCalledWith('/voice/diagnostics');
  });

  it('voiceApi.transcribe posts multipart form data with optional language', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { text: 'hello', language: 'en' } }),
    });

    const result = await voiceApi.transcribe(new Blob(['audio']), 'en');

    expect(result).toEqual({ text: 'hello', language: 'en' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/voice/transcribe',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
    const body = mockFetch.mock.calls.at(-1)?.[1]?.body as FormData;
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('language')).toBe('en');
  });

  it('voiceApi.transcribe surfaces JSON error messages and fallback errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Bad audio' } }),
    });
    await expect(voiceApi.transcribe(new Blob(['bad']))).rejects.toThrow('Bad audio');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(voiceApi.transcribe(new Blob(['bad']))).rejects.toThrow('Transcription failed');
  });

  it('voiceApi.synthesize posts JSON and returns an audio blob', async () => {
    const audio = new Blob(['audio'], { type: 'audio/mpeg' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => audio,
    });

    const result = await voiceApi.synthesize('hello', {
      voice: 'alloy',
      format: 'mp3',
      speed: 1.2,
    });

    expect(result).toBe(audio);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello', voice: 'alloy', format: 'mp3', speed: 1.2 }),
      credentials: 'same-origin',
    });
  });

  it('voiceApi.synthesize handles JSON and non-JSON errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: { message: 'No voice' } }),
    });
    await expect(voiceApi.synthesize('hello')).rejects.toThrow('No voice');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: { get: () => 'text/plain' },
    });
    await expect(voiceApi.synthesize('hello')).rejects.toThrow('Synthesis failed: HTTP 503');
  });

  it('settingsApi.get and getProviders fetch settings data', async () => {
    mockGet.mockResolvedValueOnce({});
    await settingsApi.get();
    expect(mockGet).toHaveBeenCalledWith('/settings');

    mockGet.mockResolvedValueOnce({ providers: [] });
    await settingsApi.getProviders();
    expect(mockGet).toHaveBeenCalledWith('/providers');
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

  it('settingsApi updates default provider and model', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    await settingsApi.setDefaultProvider('openai');
    expect(mockPost).toHaveBeenCalledWith('/settings/default-provider', { provider: 'openai' });

    mockPost.mockResolvedValueOnce(undefined);
    await settingsApi.setDefaultModel('gpt-4.1');
    expect(mockPost).toHaveBeenCalledWith('/settings/default-model', { model: 'gpt-4.1' });
  });

  it('settingsApi manages tool groups and allowed dirs', async () => {
    mockGet.mockResolvedValueOnce({ groups: [], enabledGroupIds: [] });
    await settingsApi.getToolGroups();
    expect(mockGet).toHaveBeenCalledWith('/settings/tool-groups');

    mockPut.mockResolvedValueOnce({ enabledGroupIds: ['core'] });
    await settingsApi.saveToolGroups(['core']);
    expect(mockPut).toHaveBeenCalledWith('/settings/tool-groups', { enabledGroupIds: ['core'] });

    mockGet.mockResolvedValueOnce({ dirs: [] });
    await settingsApi.getAllowedDirs();
    expect(mockGet).toHaveBeenCalledWith('/settings/coding-agents/allowed-dirs');

    mockPut.mockResolvedValueOnce({ dirs: ['D:/Code'] });
    await settingsApi.setAllowedDirs(['D:/Code']);
    expect(mockPut).toHaveBeenCalledWith('/settings/coding-agents/allowed-dirs', {
      dirs: ['D:/Code'],
    });
  });

  it('modelRoutingApi delegates process and channel routing routes', async () => {
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await modelRoutingApi.getAll();
    expect(mockGet).toHaveBeenLastCalledWith('/model-routing');
    await modelRoutingApi.get('chat');
    expect(mockGet).toHaveBeenLastCalledWith('/model-routing/chat');
    await modelRoutingApi.update('pulse', { provider: 'openai' });
    expect(mockPut).toHaveBeenLastCalledWith('/model-routing/pulse', { provider: 'openai' });
    await modelRoutingApi.clear('channel');
    expect(mockDelete).toHaveBeenLastCalledWith('/model-routing/channel');

    await modelRoutingApi.getChannels();
    expect(mockGet).toHaveBeenLastCalledWith('/model-routing/channels');
    await modelRoutingApi.getChannel('telegram');
    expect(mockGet).toHaveBeenLastCalledWith('/model-routing/channels/telegram?kind=default');
    await modelRoutingApi.getChannel('telegram', 'media');
    expect(mockGet).toHaveBeenLastCalledWith('/model-routing/channels/telegram?kind=media');
    await modelRoutingApi.updateChannel('telegram', { model: 'gpt-4.1' }, 'media');
    expect(mockPut).toHaveBeenLastCalledWith('/model-routing/channels/telegram?kind=media', {
      model: 'gpt-4.1',
    });
    await modelRoutingApi.clearChannel('telegram');
    expect(mockDelete).toHaveBeenLastCalledWith('/model-routing/channels/telegram?kind=default');
  });

  it('executionPermissionsApi.update', async () => {
    mockPut.mockResolvedValueOnce({});
    await executionPermissionsApi.update({ enabled: true });
    expect(mockPut).toHaveBeenCalledWith('/execution-permissions', { enabled: true });
  });

  it('executionPermissionsApi.get, reset, and resolveApproval', async () => {
    mockGet.mockResolvedValueOnce({ enabled: true });
    await executionPermissionsApi.get();
    expect(mockGet).toHaveBeenLastCalledWith('/execution-permissions');

    mockPost.mockResolvedValueOnce({ reset: true });
    await executionPermissionsApi.reset();
    expect(mockPost).toHaveBeenLastCalledWith('/execution-permissions/reset');

    mockPost.mockResolvedValueOnce({ resolved: true, approved: false });
    await executionPermissionsApi.resolveApproval('apr-1', false);
    expect(mockPost).toHaveBeenLastCalledWith('/execution-permissions/approvals/apr-1/resolve', {
      approved: false,
    });
  });

  it('authApi.logout, setPassword, removePassword, and sessions', async () => {
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
    mockGet.mockResolvedValue({});

    await authApi.logout();
    expect(mockPost).toHaveBeenLastCalledWith('/auth/logout');

    await authApi.setPassword({ password: 'new' });
    expect(mockPost).toHaveBeenLastCalledWith('/auth/password', { password: 'new' });

    await authApi.setPassword({ password: 'new', currentPassword: 'old' });
    expect(mockPost).toHaveBeenLastCalledWith('/auth/password', {
      password: 'new',
      currentPassword: 'old',
    });

    await authApi.removePassword();
    expect(mockDelete).toHaveBeenLastCalledWith('/auth/password');

    await authApi.sessions();
    expect(mockGet).toHaveBeenLastCalledWith('/auth/sessions');
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

// ---------------------------------------------------------------------------
// mcpApi — server info, presets, and full CRUD surface
// ---------------------------------------------------------------------------

describe('mcpApi', () => {
  it('delegates server info and presets', async () => {
    mockGet.mockResolvedValue({});

    await mcpApi.serverInfo();
    expect(mockGet).toHaveBeenLastCalledWith('/mcp/serve/info');
    await mcpApi.presets();
    expect(mockGet).toHaveBeenLastCalledWith('/mcp/presets');
  });

  it('delegates CRUD and lifecycle', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await mcpApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/mcp');

    const createInput = {
      name: 'playwright',
      displayName: 'Playwright',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    };
    await mcpApi.create(createInput);
    expect(mockPost).toHaveBeenLastCalledWith('/mcp', createInput);

    await mcpApi.get('srv-1');
    expect(mockGet).toHaveBeenLastCalledWith('/mcp/srv-1');

    const updateInput = { enabled: false };
    await mcpApi.update('srv-1', updateInput);
    expect(mockPut).toHaveBeenLastCalledWith('/mcp/srv-1', updateInput);

    await mcpApi.delete('srv-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/mcp/srv-1');

    await mcpApi.disconnect('srv-1');
    expect(mockPost).toHaveBeenLastCalledWith('/mcp/srv-1/disconnect');

    await mcpApi.tools('srv-1');
    expect(mockGet).toHaveBeenLastCalledWith('/mcp/srv-1/tools');
  });

  it('installs preset with and without overrides', async () => {
    mockPost.mockResolvedValue({});

    await mcpApi.installPreset('playwright');
    expect(mockPost).toHaveBeenLastCalledWith('/mcp/presets/playwright/install', {});

    const input = { displayName: 'My Playwright', enabled: false };
    await mcpApi.installPreset('playwright', input);
    expect(mockPost).toHaveBeenLastCalledWith('/mcp/presets/playwright/install', input);
  });
});

// ---------------------------------------------------------------------------
// agentsApi — full surface
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

  it('delegates get, update, and delete', async () => {
    mockGet.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await agentsApi.get('a-1');
    expect(mockGet).toHaveBeenLastCalledWith('/agents/a-1');

    await agentsApi.update('a-1', { name: 'Renamed' });
    expect(mockPatch).toHaveBeenLastCalledWith('/agents/a-1', { name: 'Renamed' });

    await agentsApi.delete('a-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/agents/a-1');
  });
});

// ---------------------------------------------------------------------------
// workflowsApi — full CRUD, execution, logs, versions, approvals, public API
// ---------------------------------------------------------------------------

describe('workflowsApi', () => {
  it('delegates CRUD routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await workflowsApi.list({ status: 'active' });
    expect(mockGet).toHaveBeenLastCalledWith('/workflows', { params: { status: 'active' } });

    await workflowsApi.get('wf-1');
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/wf-1');

    const createInput = { name: 'Hello workflow' };
    await workflowsApi.create(createInput);
    expect(mockPost).toHaveBeenLastCalledWith('/workflows', createInput);

    await workflowsApi.update('wf-1', { name: 'Renamed' });
    expect(mockPatch).toHaveBeenLastCalledWith('/workflows/wf-1', { name: 'Renamed' });

    await workflowsApi.delete('wf-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/workflows/wf-1');

    await workflowsApi.clone('wf-1');
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/wf-1/clone');
  });

  it('execute calls stream with optional dryRun and signal', async () => {
    mockStream.mockResolvedValue({} as Response);

    await workflowsApi.execute('wf-1');
    expect(mockStream).toHaveBeenLastCalledWith('/workflows/wf-1/execute', {});

    const ctrl = new AbortController();
    await workflowsApi.execute('wf-1', { dryRun: true, signal: ctrl.signal });
    expect(mockStream).toHaveBeenLastCalledWith(
      '/workflows/wf-1/execute?dryRun=true',
      {},
      { signal: ctrl.signal }
    );

    mockPost.mockResolvedValueOnce({ message: 'canceled' });
    await workflowsApi.cancel('wf-1');
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/wf-1/cancel');
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

  it('delegates logs, versions, approvals, replay, and public API', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockStream.mockResolvedValue({} as Response);

    await workflowsApi.logs('wf-1', { level: 'error' });
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/wf-1/logs', {
      params: { level: 'error' },
    });

    await workflowsApi.recentLogs({ limit: '10' });
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/logs/recent', {
      params: { limit: '10' },
    });

    await workflowsApi.logDetail('log-1');
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/logs/log-1');

    await workflowsApi.versions('wf-1', { limit: '5' });
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/wf-1/versions', {
      params: { limit: '5' },
    });

    await workflowsApi.restoreVersion('wf-1', 3);
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/wf-1/versions/3/restore');

    await workflowsApi.activeToolNames();
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/active-tool-names');

    await workflowsApi.pendingApprovals({ status: 'pending' });
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/approvals/pending', {
      params: { status: 'pending' },
    });
    await workflowsApi.allApprovals();
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/approvals/all', {
      params: undefined,
    });

    await workflowsApi.approveApproval('apr-1');
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/approvals/apr-1/approve');
    await workflowsApi.rejectApproval('apr-1');
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/approvals/apr-1/reject');

    await workflowsApi.replayLog('log-1');
    expect(mockStream).toHaveBeenLastCalledWith('/workflows/logs/log-1/replay', {});

    await workflowsApi.apiRun('wf-1');
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/wf-1/run', {});
    await workflowsApi.apiRun('wf-1', { input1: 'v' });
    expect(mockPost).toHaveBeenLastCalledWith('/workflows/wf-1/run', { inputs: { input1: 'v' } });

    await workflowsApi.apiRunStatus('wf-1', 'log-1');
    expect(mockGet).toHaveBeenLastCalledWith('/workflows/wf-1/run/log-1');
  });
});

// ---------------------------------------------------------------------------
// providerAuthApi/providersApi/profileApi — low-risk wrapper contracts
// ---------------------------------------------------------------------------

describe('providerAuthApi', () => {
  it('starts and polls OAuth device flow with provider body', async () => {
    mockPost.mockResolvedValueOnce({ provider: 'anthropic' });
    await providerAuthApi.startDeviceFlow('anthropic');
    expect(mockPost).toHaveBeenLastCalledWith('/provider-auth/oauth/device/start', {
      provider: 'anthropic',
    });

    mockPost.mockResolvedValueOnce({ provider: 'anthropic', status: 'pending', intervalSec: 5 });
    await providerAuthApi.pollDeviceFlow('anthropic');
    expect(mockPost).toHaveBeenLastCalledWith('/provider-auth/oauth/device/poll', {
      provider: 'anthropic',
    });
  });

  it('encodes provider ids in config routes', async () => {
    mockGet.mockResolvedValueOnce({ provider: 'open ai', override: null });
    await providerAuthApi.getConfig('open ai/slash');
    expect(mockGet).toHaveBeenCalledWith('/provider-auth/config/open%20ai%2Fslash');

    const override = { clientId: 'client', scopes: ['read'] };
    mockPut.mockResolvedValueOnce({ provider: 'open ai', override });
    await providerAuthApi.setConfig('open ai/slash', override);
    expect(mockPut).toHaveBeenCalledWith('/provider-auth/config/open%20ai%2Fslash', override);

    mockDelete.mockResolvedValueOnce({ provider: 'open ai', cleared: true });
    await providerAuthApi.clearConfig('open ai/slash');
    expect(mockDelete).toHaveBeenCalledWith('/provider-auth/config/open%20ai%2Fslash');
  });

  it('signOut and listProviders call their expected routes', async () => {
    mockPost.mockResolvedValueOnce({ provider: 'openai', signedOut: true });
    await providerAuthApi.signOut('openai');
    expect(mockPost).toHaveBeenCalledWith('/provider-auth/signout', { provider: 'openai' });

    mockGet.mockResolvedValueOnce({ providers: [] });
    await providerAuthApi.listProviders();
    expect(mockGet).toHaveBeenCalledWith('/provider-auth/providers');
  });
});

describe('providersApi', () => {
  it('delegates provider catalog and category reads', async () => {
    mockGet.mockResolvedValueOnce({ providers: [], total: 0 });
    await providersApi.list();
    expect(mockGet).toHaveBeenLastCalledWith('/providers');

    mockGet.mockResolvedValueOnce({ categories: {}, uncategorized: [] });
    await providersApi.categories();
    expect(mockGet).toHaveBeenLastCalledWith('/providers/categories');
  });

  it('delegates provider config mutations', async () => {
    mockGet.mockResolvedValueOnce({});
    await providersApi.getConfig('openai');
    expect(mockGet).toHaveBeenCalledWith('/providers/openai/config');

    mockPut.mockResolvedValueOnce(undefined);
    await providersApi.updateConfig('openai', { enabled: true });
    expect(mockPut).toHaveBeenCalledWith('/providers/openai/config', { enabled: true });

    mockPatch.mockResolvedValueOnce(undefined);
    await providersApi.toggle('openai', false);
    expect(mockPatch).toHaveBeenCalledWith('/providers/openai/toggle', { enabled: false });

    mockDelete.mockResolvedValueOnce(undefined);
    await providersApi.resetConfig('openai');
    expect(mockDelete).toHaveBeenCalledWith('/providers/openai/config');
  });

  it('delegates model listing', async () => {
    mockGet.mockResolvedValueOnce({ models: [] });
    await providersApi.models('openai');
    expect(mockGet).toHaveBeenCalledWith('/providers/openai/models');
  });
});

describe('profileApi', () => {
  it('delegates profile reads and writes', async () => {
    mockGet.mockResolvedValueOnce({});
    await profileApi.get();
    expect(mockGet).toHaveBeenCalledWith('/profile');

    mockPost.mockResolvedValueOnce({ profile: {} });
    await profileApi.quickSetup({ name: 'Ada' });
    expect(mockPost).toHaveBeenCalledWith('/profile/quick', { name: 'Ada' });

    mockPost.mockResolvedValueOnce(undefined);
    await profileApi.setData('preferences', 'theme', 'dark');
    expect(mockPost).toHaveBeenCalledWith('/profile/data', {
      category: 'preferences',
      key: 'theme',
      value: 'dark',
    });
  });

  it('encodes category and key query params', async () => {
    mockDelete.mockResolvedValueOnce({ deleted: true });
    await profileApi.deleteData('prefs/theme', 'display name');
    expect(mockDelete).toHaveBeenCalledWith(
      '/profile/data?category=prefs%2Ftheme&key=display%20name'
    );

    mockPost.mockResolvedValueOnce({ id: 'inf-1' });
    await profileApi.confirmInferred('skills', 'TypeScript/React');
    expect(mockPost).toHaveBeenCalledWith(
      '/profile/inferred/confirm?category=skills&key=TypeScript%2FReact'
    );
  });

  it('delegates inferred list, export, and import', async () => {
    mockGet.mockResolvedValueOnce({ entries: [], count: 0 });
    await profileApi.listInferred();
    expect(mockGet).toHaveBeenCalledWith('/profile/inferred');

    mockGet.mockResolvedValueOnce({ entries: [] });
    await profileApi.export();
    expect(mockGet).toHaveBeenCalledWith('/profile/export');

    mockPost.mockResolvedValueOnce(undefined);
    await profileApi.import([{ category: 'skills' }]);
    expect(mockPost).toHaveBeenCalledWith('/profile/import', { entries: [{ category: 'skills' }] });
  });
});

// ---------------------------------------------------------------------------
// tunnelApi/securityApi/evalApi/canvasApi/artifactsApi — wrapper contracts
// ---------------------------------------------------------------------------

describe('tunnelApi', () => {
  it('delegates status, url, start, stop, and configure routes', async () => {
    mockGet.mockResolvedValueOnce({ status: 'stopped' });
    await tunnelApi.getStatus();
    expect(mockGet).toHaveBeenLastCalledWith('/tunnel');

    mockGet.mockResolvedValueOnce({ url: 'https://example.test' });
    await tunnelApi.getUrl();
    expect(mockGet).toHaveBeenLastCalledWith('/tunnel/url');

    mockPost.mockResolvedValueOnce({ url: 'https://example.test', status: 'running' });
    await tunnelApi.start('secret');
    expect(mockPost).toHaveBeenLastCalledWith('/tunnel/start', { password: 'secret' });

    mockPost.mockResolvedValueOnce({ status: 'stopped' });
    await tunnelApi.stop();
    expect(mockPost).toHaveBeenLastCalledWith('/tunnel/stop');

    mockPut.mockResolvedValueOnce({ status: 'saved' });
    await tunnelApi.configure({ port: 3000, hostname: 'localhost' });
    expect(mockPut).toHaveBeenCalledWith('/tunnel/config', { port: 3000, hostname: 'localhost' });
  });
});

describe('securityApi', () => {
  it('delegates platform and collection scan routes', async () => {
    mockPost.mockResolvedValue({});

    await securityApi.scan();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan');
    await securityApi.scanExtensions();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/extensions');
    await securityApi.scanCustomTools();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/custom-tools');
    await securityApi.scanTriggers();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/triggers');
    await securityApi.scanWorkflows();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/workflows');
    await securityApi.scanCliTools();
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/cli-tools');
  });

  it('delegates single-resource scans with request bodies', async () => {
    mockPost.mockResolvedValue({});

    await securityApi.scanCustomTool('return 1', 'math', ['network']);
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/custom-tool', {
      code: 'return 1',
      name: 'math',
      permissions: ['network'],
    });
    await securityApi.scanTrigger('tr-1');
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/trigger', { triggerId: 'tr-1' });
    await securityApi.scanWorkflow('wf-1');
    expect(mockPost).toHaveBeenLastCalledWith('/security/scan/workflow', { workflowId: 'wf-1' });
  });
});

describe('evalApi', () => {
  it('delegates eval run, grade, and optimize calls', async () => {
    mockPost.mockResolvedValue({});

    await evalApi.runTest('skill-1', 'hello', true);
    expect(mockPost).toHaveBeenLastCalledWith('/extensions/skill-1/eval/run', {
      query: 'hello',
      withSkill: true,
    });

    await evalApi.gradeResponse('skill-1', 'query', 'response', ['keyword'], 'notes');
    expect(mockPost).toHaveBeenLastCalledWith('/extensions/skill-1/eval/grade', {
      query: 'query',
      response: 'response',
      expectedKeywords: ['keyword'],
      notes: 'notes',
    });

    await evalApi.optimizeDescription('skill-1', 'current', ['q1']);
    expect(mockPost).toHaveBeenLastCalledWith('/extensions/skill-1/eval/optimize-description', {
      currentDescription: 'current',
      testQueries: ['q1'],
      iterations: 3,
    });
  });
});

describe('canvasApi', () => {
  it('delegates canvas list and element CRUD routes', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await canvasApi.listCanvases();
    expect(mockGet).toHaveBeenLastCalledWith('/canvas');
    await canvasApi.listElements();
    expect(mockGet).toHaveBeenLastCalledWith('/canvas/main/elements');
    await canvasApi.listElements('board-1');
    expect(mockGet).toHaveBeenLastCalledWith('/canvas/board-1/elements');

    const input = { type: 'text' as const, content: 'hello' };
    await canvasApi.create('board-1', input);
    expect(mockPost).toHaveBeenLastCalledWith('/canvas/board-1/elements', input);

    await canvasApi.update('board-1', 'el-1', { content: 'updated' });
    expect(mockPatch).toHaveBeenLastCalledWith('/canvas/board-1/elements/el-1', {
      content: 'updated',
    });

    await canvasApi.remove('board-1', 'el-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/canvas/board-1/elements/el-1');
    await canvasApi.clear();
    expect(mockDelete).toHaveBeenLastCalledWith('/canvas/main');
    await canvasApi.move('el-1', 10, 20, 'board-1');
    expect(mockPost).toHaveBeenLastCalledWith('/canvas/board-1/elements/el-1/move', {
      x: 10,
      y: 20,
    });
  });
});

describe('artifactsApi', () => {
  it('builds list query strings from filters', async () => {
    mockGet.mockResolvedValueOnce({ artifacts: [], total: 0 });
    await artifactsApi.list({
      type: 'html',
      pinned: false,
      conversationId: 'conv 1',
      search: 'hello world',
      limit: 25,
      offset: 50,
    });

    const url = mockGet.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('/artifacts?');
    expect(url).toContain('type=html');
    expect(url).toContain('pinned=false');
    expect(url).toContain('conversationId=conv+1');
    expect(url).toContain('search=hello+world');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
  });

  it('omits empty artifact list query strings and falsy numeric filters', async () => {
    mockGet.mockResolvedValueOnce({ artifacts: [], total: 0 });
    await artifactsApi.list({ limit: 0, offset: 0 });
    expect(mockGet).toHaveBeenCalledWith('/artifacts');
  });

  it('delegates artifact CRUD and actions', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    await artifactsApi.get('art-1');
    expect(mockGet).toHaveBeenLastCalledWith('/artifacts/art-1');
    await artifactsApi.create({ type: 'html', title: 'Demo', content: '<p />' });
    expect(mockPost).toHaveBeenLastCalledWith('/artifacts', {
      type: 'html',
      title: 'Demo',
      content: '<p />',
    });
    await artifactsApi.update('art-1', { title: 'Updated' });
    expect(mockPatch).toHaveBeenLastCalledWith('/artifacts/art-1', { title: 'Updated' });
    await artifactsApi.delete('art-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/artifacts/art-1');
    await artifactsApi.togglePin('art-1');
    expect(mockPost).toHaveBeenLastCalledWith('/artifacts/art-1/pin');
    await artifactsApi.refresh('art-1');
    expect(mockPost).toHaveBeenLastCalledWith('/artifacts/art-1/refresh');
    await artifactsApi.getVersions('art-1');
    expect(mockGet).toHaveBeenLastCalledWith('/artifacts/art-1/versions');
  });
});

// ── soulsApi ──

describe('soulsApi', () => {
  it('list fetches souls', async () => {
    mockGet.mockResolvedValueOnce({ items: [], total: 0 });
    await soulsApi.list();
    expect(mockGet).toHaveBeenCalledWith('/souls');
  });

  it('delegates CRUD and actions', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPut.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await soulsApi.get('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/souls/agent-1');
    await soulsApi.create({
      identity: { name: 'Test', emoji: 'T', role: 'dev', personality: 'helpful', boundaries: [] },
    });
    expect(mockPost).toHaveBeenLastCalledWith('/souls', expect.any(Object));
    await soulsApi.deploy({ identity: { name: 'Test' } });
    expect(mockPost).toHaveBeenLastCalledWith('/souls/deploy', { identity: { name: 'Test' } });
    await soulsApi.update('agent-1', { identity: { name: 'Updated' } } as never);
    expect(mockPut).toHaveBeenLastCalledWith('/souls/agent-1', expect.any(Object));
    await soulsApi.delete('agent-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/souls/agent-1');
    await soulsApi.getVersions('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/souls/agent-1/versions');
    await soulsApi.getVersion('agent-1', 2);
    expect(mockGet).toHaveBeenLastCalledWith('/souls/agent-1/versions/2');
    await soulsApi.getTools('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/souls/agent-1/tools');
    await soulsApi.updateTools('agent-1', { allowed: ['core.search'] });
    expect(mockPut).toHaveBeenLastCalledWith('/souls/agent-1/tools', { allowed: ['core.search'] });
    await soulsApi.sendCommand('agent-1', 'run_heartbeat');
    expect(mockPost).toHaveBeenLastCalledWith('/souls/agent-1/command', {
      command: 'run_heartbeat',
      params: undefined,
    });
    await soulsApi.getStats('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/souls/agent-1/stats');
    await soulsApi.runTest('agent-1');
    expect(mockPost).toHaveBeenLastCalledWith('/souls/agent-1/test');
    await soulsApi.feedback('agent-1', { type: 'praise', content: 'Good job' });
    expect(mockPost).toHaveBeenLastCalledWith('/souls/agent-1/feedback', {
      type: 'praise',
      content: 'Good job',
    });
    await soulsApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/souls/stats');
    await soulsApi.health();
    expect(mockGet).toHaveBeenLastCalledWith('/souls/health');
  });

  it('getLogs builds query string', async () => {
    mockGet.mockResolvedValueOnce({
      agentId: 'agent-1',
      logs: [],
      stats: { totalCycles: 0, successRate: 0, avgCost: 0, avgDurationMs: 0 },
    });
    await soulsApi.getLogs('agent-1', 10, 5);
    expect(mockGet).toHaveBeenCalledWith('/souls/agent-1/logs?limit=10&offset=5');
  });

  it('getLogDetail fetches single cycle', async () => {
    mockGet.mockResolvedValueOnce({} as never);
    await soulsApi.getLogDetail('agent-1', 'log-1');
    expect(mockGet).toHaveBeenCalledWith('/souls/agent-1/logs/log-1');
  });
});

// ── crewsApi ──

describe('crewsApi', () => {
  it('list fetches crews', async () => {
    mockGet.mockResolvedValueOnce({ items: [], total: 0 });
    await crewsApi.list();
    expect(mockGet).toHaveBeenCalledWith('/crews');
  });

  it('delegates crew CRUD, lifecycle, and query methods', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    await crewsApi.get('crew-1');
    expect(mockGet).toHaveBeenLastCalledWith('/crews/crew-1');
    await crewsApi.deploy('template-1');
    expect(mockPost).toHaveBeenLastCalledWith('/crews/deploy', { templateId: 'template-1' });
    await crewsApi.pause('crew-1');
    expect(mockPost).toHaveBeenLastCalledWith('/crews/crew-1/pause');
    await crewsApi.resume('crew-1');
    expect(mockPost).toHaveBeenLastCalledWith('/crews/crew-1/resume');
    await crewsApi.disband('crew-1');
    expect(mockDelete).toHaveBeenLastCalledWith('/crews/crew-1');
    await crewsApi.getTemplates();
    expect(mockGet).toHaveBeenLastCalledWith('/crews/templates');
    await crewsApi.getTemplate('tpl-1');
    expect(mockGet).toHaveBeenLastCalledWith('/crews/templates/tpl-1');
    await crewsApi.stats();
    expect(mockGet).toHaveBeenLastCalledWith('/crews/stats');
    await crewsApi.health();
    expect(mockGet).toHaveBeenLastCalledWith('/crews/health');
    await crewsApi.getStatus('crew-1');
    expect(mockGet).toHaveBeenLastCalledWith('/crews/crew-1/status');
  });

  it('getMemory builds query params', async () => {
    mockGet.mockResolvedValueOnce({ entries: [], total: 0 });
    await crewsApi.getMemory('crew-1', 'notes', 'test', 10, 0);
    expect(mockGet).toHaveBeenCalledWith(
      '/crews/crew-1/memory?category=notes&query=test&limit=10&offset=0'
    );
  });

  it('getTasks builds query params', async () => {
    mockGet.mockResolvedValueOnce({ tasks: [], total: 0 });
    await crewsApi.getTasks('crew-1', 'pending', 5, 0);
    expect(mockGet).toHaveBeenCalledWith('/crews/crew-1/tasks?status=pending&limit=5&offset=0');
  });
});

// ── agentMessagesApi ──

describe('agentMessagesApi', () => {
  it('list fetches messages', async () => {
    mockGet.mockResolvedValueOnce({ items: [], total: 0 });
    await agentMessagesApi.list(10, 0);
    expect(mockGet).toHaveBeenCalledWith('/agent-messages?limit=10&offset=0');
  });

  it('delegates scoped queries and send', async () => {
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await agentMessagesApi.listByAgent('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/agent-messages/agent/agent-1?limit=50&offset=0');
    await agentMessagesApi.getThread('thread-1');
    expect(mockGet).toHaveBeenLastCalledWith('/agent-messages/thread/thread-1');
    await agentMessagesApi.getByCrew('crew-1', 20, 10);
    expect(mockGet).toHaveBeenLastCalledWith('/agent-messages/crew/crew-1?limit=20&offset=10');
    await agentMessagesApi.send({ to: 'agent-2', content: 'Hello' });
    expect(mockPost).toHaveBeenLastCalledWith('/agent-messages', {
      to: 'agent-2',
      content: 'Hello',
    });
  });
});

// ── heartbeatLogsApi ──

describe('heartbeatLogsApi', () => {
  it('list fetches logs', async () => {
    mockGet.mockResolvedValueOnce({ items: [], total: 0 });
    await heartbeatLogsApi.list(10, 0);
    expect(mockGet).toHaveBeenCalledWith('/heartbeat-logs?limit=10&offset=0');
  });

  it('delegates scoped queries and stats', async () => {
    mockGet.mockResolvedValue({} as never);

    await heartbeatLogsApi.listByAgent('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/heartbeat-logs/agent/agent-1?limit=50&offset=0');
    await heartbeatLogsApi.getStats();
    expect(mockGet).toHaveBeenLastCalledWith('/heartbeat-logs/stats');
    await heartbeatLogsApi.getStats('agent-1');
    expect(mockGet).toHaveBeenLastCalledWith('/heartbeat-logs/stats?agentId=agent-1');
  });
});
