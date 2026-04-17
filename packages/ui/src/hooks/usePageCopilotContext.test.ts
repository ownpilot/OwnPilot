/**
 * usePageCopilotContext Tests
 *
 * Tests the route parsing logic and registry lookup.
 * Uses node environment (no DOM) — tests pure functions and registry shape.
 * Hook async behavior is tested via direct parseRoute + registry inspection.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock objects so they're available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockFileWorkspacesApi,
  mockWorkflowsApi,
  mockAgentsApi,
  mockClawsApi,
  mockCodingAgentsApi,
  mockCustomToolsApi,
  mockExtensionsApi,
} = vi.hoisted(() => ({
  mockFileWorkspacesApi: {
    list: vi.fn().mockResolvedValue({ workspaces: [] }),
  },
  mockWorkflowsApi: {
    get: vi.fn().mockResolvedValue({ id: 'wf1', name: 'Test Workflow', status: 'active' }),
  },
  mockAgentsApi: {
    get: vi.fn().mockResolvedValue({ id: 'a1', name: 'Test Agent', tools: [] }),
  },
  mockClawsApi: {
    get: vi.fn().mockResolvedValue({
      id: 'c1',
      name: 'Test Claw',
      workspaceId: '/path/to/ws',
      mode: 'continuous',
    }),
  },
  mockCodingAgentsApi: {
    getSession: vi.fn().mockResolvedValue({
      id: 's1',
      displayName: 'Session 1',
      provider: 'claude',
      cwd: '/home/user/project',
    }),
  },
  mockCustomToolsApi: {
    list: vi.fn().mockResolvedValue({ tools: [] }),
  },
  mockExtensionsApi: {
    getById: vi.fn().mockResolvedValue({
      name: 'my-skill',
      manifest: { format: 'agentskills' },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock react-router-dom
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/' }),
}));

// ---------------------------------------------------------------------------
// Mock react
// ---------------------------------------------------------------------------

vi.mock('react', () => ({
  useState: <T>(init: T): [T, (v: T) => void] => [init, () => {}],
  useEffect: () => {},
  useRef: <T>(init: T) => ({ current: init }),
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

// ---------------------------------------------------------------------------
// Mock API module
// ---------------------------------------------------------------------------

vi.mock('../api', () => ({
  fileWorkspacesApi: mockFileWorkspacesApi,
  workflowsApi: mockWorkflowsApi,
  agentsApi: mockAgentsApi,
  clawsApi: mockClawsApi,
  codingAgentsApi: mockCodingAgentsApi,
  customToolsApi: mockCustomToolsApi,
  extensionsApi: mockExtensionsApi,
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { parseRoute } from './usePageCopilotContext.js';
import { PAGE_COPILOT_REGISTRY } from '../constants/page-copilot-registry.js';

// ---------------------------------------------------------------------------
// parseRoute unit tests
// ---------------------------------------------------------------------------

describe('parseRoute', () => {
  test('parses top-level route', () => {
    const result = parseRoute('/workspaces');
    expect(result.sectionId).toBe('workspaces');
    expect(result.entityId).toBeUndefined();
  });

  test('parses route with entity id', () => {
    const result = parseRoute('/workspaces/abc123');
    expect(result.sectionId).toBe('workspaces');
    expect(result.entityId).toBe('abc123');
  });

  test('parses settings sub-page without entity', () => {
    const result = parseRoute('/settings/mcp-servers');
    expect(result.sectionId).toBe('mcp-servers');
    expect(result.entityId).toBeUndefined();
  });

  test('parses analytics route (no entity)', () => {
    const result = parseRoute('/analytics');
    expect(result.sectionId).toBe('analytics');
    expect(result.entityId).toBeUndefined();
  });

  test('parses coding-agents with entity', () => {
    const result = parseRoute('/coding-agents/session-xyz');
    expect(result.sectionId).toBe('coding-agents');
    expect(result.entityId).toBe('session-xyz');
  });

  test('handles root pathname', () => {
    const result = parseRoute('/');
    expect(result.sectionId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// PAGE_COPILOT_REGISTRY shape tests
// ---------------------------------------------------------------------------

describe('PAGE_COPILOT_REGISTRY', () => {
  test('has at least 20 entries', () => {
    expect(Object.keys(PAGE_COPILOT_REGISTRY).length).toBeGreaterThanOrEqual(20);
  });

  test('every entry has pageType and suggestions', () => {
    for (const [key, config] of Object.entries(PAGE_COPILOT_REGISTRY)) {
      expect(config.pageType, `${key} missing pageType`).toBeTruthy();
      expect(Array.isArray(config.suggestions), `${key} suggestions not array`).toBe(true);
      expect(config.suggestions.length, `${key} needs at least 3 suggestions`).toBeGreaterThanOrEqual(3);
    }
  });

  test('returns workspace config', () => {
    const config = PAGE_COPILOT_REGISTRY['workspaces']!;
    expect(config).toBeDefined();
    expect(config.pageType).toBe('workspace');
    expect(config.preferBridge).toBe(true);
    expect(config.suggestions.length).toBeGreaterThanOrEqual(3);
  });

  test('returns workflow config', () => {
    const config = PAGE_COPILOT_REGISTRY['workflows']!;
    expect(config).toBeDefined();
    expect(config.pageType).toBe('workflow');
    expect(config.preferBridge).toBeFalsy();
    expect(config.systemPromptHint).toBeTruthy();
  });

  test('all path-based pages have preferBridge=true', () => {
    for (const key of ['workspaces', 'coding-agents', 'claws']) {
      expect(PAGE_COPILOT_REGISTRY[key]?.preferBridge, `${key} should have preferBridge=true`).toBe(true);
    }
  });

  test('no-path pages do not have preferBridge=true', () => {
    for (const key of ['workflows', 'agents', 'tools', 'tasks', 'notes']) {
      expect(PAGE_COPILOT_REGISTRY[key]?.preferBridge, `${key} should not have preferBridge=true`).toBeFalsy();
    }
  });

  test('returns undefined for unknown route', () => {
    expect(PAGE_COPILOT_REGISTRY['unknown-page-xyz']).toBeUndefined();
  });

  test('settings routes are keyed by sub-segment', () => {
    const config = PAGE_COPILOT_REGISTRY['mcp-servers']!;
    expect(config).toBeDefined();
    expect(config.pageType).toBe('mcp-server');
  });
});

// ---------------------------------------------------------------------------
// resolveContext behavior tests
// ---------------------------------------------------------------------------

describe('resolveContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    mockFileWorkspacesApi.list.mockResolvedValue({ workspaces: [] });
    mockCodingAgentsApi.getSession.mockResolvedValue({
      id: 's1', displayName: 'Session 1', provider: 'claude', cwd: '/home/user/project',
    });
    mockClawsApi.get.mockResolvedValue({
      id: 'c1', name: 'Test Claw', workspaceId: '/path/to/ws', mode: 'continuous',
    });
    mockWorkflowsApi.get.mockResolvedValue({ id: 'wf1', name: 'Test Workflow', status: 'active' });
    mockExtensionsApi.getById.mockResolvedValue({
      name: 'my-skill', manifest: { format: 'agentskills' },
    });
  });

  test('workspace resolveContext returns empty object when no id', async () => {
    const config = PAGE_COPILOT_REGISTRY['workspaces']!;
    expect(config.resolveContext).toBeDefined();
    const result = await config.resolveContext!({ id: undefined });
    expect(result).toEqual({});
  });

  test('workspace resolveContext returns path and metadata when workspace found', async () => {
    mockFileWorkspacesApi.list.mockResolvedValueOnce({
      workspaces: [{ id: 'ws1', name: 'My Workspace', path: '/home/user/project' }],
    });
    const config = PAGE_COPILOT_REGISTRY['workspaces']!;
    const result = await config.resolveContext!({ id: 'ws1' });
    expect(result.path).toBe('/home/user/project');
    expect(result.metadata?.name).toBe('My Workspace');
  });

  test('workspace resolveContext returns empty when workspace not found', async () => {
    const config = PAGE_COPILOT_REGISTRY['workspaces']!;
    const result = await config.resolveContext!({ id: 'missing-id' });
    expect(result).toEqual({});
  });

  test('resolveContext does not throw on API error', async () => {
    mockFileWorkspacesApi.list.mockRejectedValueOnce(new Error('Network error'));
    const config = PAGE_COPILOT_REGISTRY['workspaces']!;
    await expect(config.resolveContext!({ id: 'ws1' })).resolves.toEqual({});
  });

  test('coding-agent resolveContext returns cwd as path', async () => {
    const config = PAGE_COPILOT_REGISTRY['coding-agents']!;
    const result = await config.resolveContext!({ id: 's1' });
    expect(result.path).toBe('/home/user/project');
    expect(mockCodingAgentsApi.getSession).toHaveBeenCalledWith('s1');
  });

  test('claw resolveContext returns workspaceId as path', async () => {
    const config = PAGE_COPILOT_REGISTRY['claws']!;
    const result = await config.resolveContext!({ id: 'c1' });
    expect(result.path).toBe('/path/to/ws');
    expect(mockClawsApi.get).toHaveBeenCalledWith('c1');
  });

  test('tools has no resolveContext (static page)', () => {
    const config = PAGE_COPILOT_REGISTRY['tools']!;
    expect(config.resolveContext).toBeUndefined();
  });

  test('workflow resolveContext returns definition', async () => {
    const config = PAGE_COPILOT_REGISTRY['workflows']!;
    const result = await config.resolveContext!({ id: 'wf1' });
    expect(result.definition).toBeDefined();
    expect(mockWorkflowsApi.get).toHaveBeenCalledWith('wf1');
  });

  test('skills resolveContext returns name and format metadata', async () => {
    const config = PAGE_COPILOT_REGISTRY['skills']!;
    const result = await config.resolveContext!({ id: 'skill1' });
    expect(result.metadata?.name).toBe('my-skill');
    expect(result.metadata?.format).toBe('agentskills');
    expect(mockExtensionsApi.getById).toHaveBeenCalledWith('skill1');
  });
});
