/**
 * WorkspaceServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures the factory runs before vi.mock hoisting
// ---------------------------------------------------------------------------

const mockManager = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  getByChannel: vi.fn(),
  getDefault: vi.fn(),
  getOrCreateDefault: vi.fn(),
  setDefault: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn().mockReturnValue([]),
  associateChannel: vi.fn(),
  disassociateChannel: vi.fn(),
  updateAgentConfig: vi.fn(),
  count: 0,
}));

vi.mock('../workspace/manager.js', () => ({
  workspaceManager: mockManager,
}));

// ---------------------------------------------------------------------------
// SUT — must be imported after vi.mock declarations
// ---------------------------------------------------------------------------

const { WorkspaceServiceImpl, createWorkspaceServiceImpl } = await import(
  './workspace-service-impl.js'
);

// ---------------------------------------------------------------------------
// Helper factory
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  // Destructure config out of overrides so the top-level spread doesn't
  // stomp the deeply-merged config object we build below.
  const { config: configOverrides, ...topOverrides } = overrides;
  return {
    config: {
      id: 'ws-1',
      name: 'Test Workspace',
      description: 'Test desc',
      userId: 'user-1',
      channels: ['ch-1', 'ch-2'],
      ...((configOverrides as Record<string, unknown>) || {}),
    },
    state: 'active',
    conversationId: 'conv-1',
    createdAt: new Date('2024-06-01'),
    lastActivityAt: new Date('2024-06-02'),
    ...topOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceServiceImpl', () => {
  let service: InstanceType<typeof WorkspaceServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.count = 0;
    mockManager.getAll.mockReturnValue([]);
    service = new WorkspaceServiceImpl();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('delegates to manager.create and returns mapped WorkspaceInfo', () => {
      const ws = makeWorkspace({ config: { id: 'ws-new', name: 'My Workspace' } });
      mockManager.create.mockReturnValue(ws);

      const result = service.create({ name: 'My Workspace' });

      expect(mockManager.create).toHaveBeenCalledOnce();
      expect(result.id).toBe('ws-new');
      expect(result.name).toBe('My Workspace');
      expect(result.state).toBe('active');
      expect(result.createdAt).toEqual(new Date('2024-06-01'));
      expect(result.lastActivityAt).toEqual(new Date('2024-06-02'));
    });

    it('applies default provider and model when agent config omits them', () => {
      mockManager.create.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { systemPrompt: 'Be concise', temperature: 0.3 },
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({
            provider: 'openai',
            model: 'gpt-4.1',
            systemPrompt: 'Be concise',
            temperature: 0.3,
          }),
        }),
      );
    });

    it('uses explicit provider and model when supplied', () => {
      mockManager.create.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { provider: 'anthropic', model: 'claude-3-7-sonnet', maxTokens: 4096 },
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet',
            maxTokens: 4096,
          }),
        }),
      );
    });

    it('passes undefined agent to manager when no agent config supplied', () => {
      mockManager.create.mockReturnValue(makeWorkspace());

      service.create({ name: 'Bare Workspace' });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bare Workspace', agent: undefined }),
      );
    });

    it('forwards all optional top-level fields', () => {
      mockManager.create.mockReturnValue(
        makeWorkspace({
          config: {
            id: 'custom-id',
            name: 'Full',
            description: 'Detailed',
            userId: 'u-99',
            channels: ['ch-x'],
          },
        }),
      );

      service.create({
        name: 'Full',
        id: 'custom-id',
        description: 'Detailed',
        userId: 'u-99',
        channels: ['ch-x'],
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-id',
          description: 'Detailed',
          userId: 'u-99',
          channels: ['ch-x'],
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('returns mapped WorkspaceInfo when workspace exists', () => {
      mockManager.get.mockReturnValue(makeWorkspace());

      const result = service.get('ws-1');

      expect(mockManager.get).toHaveBeenCalledWith('ws-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('ws-1');
      expect(result!.conversationId).toBe('conv-1');
    });

    it('returns undefined when workspace is not found', () => {
      mockManager.get.mockReturnValue(undefined);

      expect(service.get('missing')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getByChannel
  // -------------------------------------------------------------------------

  describe('getByChannel', () => {
    it('delegates to manager and returns mapped WorkspaceInfo', () => {
      mockManager.getByChannel.mockReturnValue(
        makeWorkspace({ config: { channels: ['ch-1', 'ch-2'] } }),
      );

      const result = service.getByChannel('ch-1');

      expect(mockManager.getByChannel).toHaveBeenCalledWith('ch-1');
      expect(result).toBeDefined();
      expect(result!.channels).toContain('ch-1');
    });

    it('returns undefined when no workspace is associated with the channel', () => {
      mockManager.getByChannel.mockReturnValue(undefined);

      expect(service.getByChannel('orphan-channel')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDefault
  // -------------------------------------------------------------------------

  describe('getDefault', () => {
    it('returns mapped WorkspaceInfo for the default workspace', () => {
      mockManager.getDefault.mockReturnValue(makeWorkspace({ config: { name: 'Default' } }));

      const result = service.getDefault();

      expect(result).toBeDefined();
      expect(result!.name).toBe('Default');
    });

    it('returns undefined when no default workspace is set', () => {
      mockManager.getDefault.mockReturnValue(undefined);

      expect(service.getDefault()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getOrCreateDefault
  // -------------------------------------------------------------------------

  describe('getOrCreateDefault', () => {
    it('always returns mapped WorkspaceInfo (never undefined)', () => {
      mockManager.getOrCreateDefault.mockReturnValue(
        makeWorkspace({ config: { name: 'Auto Default' } }),
      );

      const result = service.getOrCreateDefault();

      expect(mockManager.getOrCreateDefault).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      expect(result.name).toBe('Auto Default');
    });
  });

  // -------------------------------------------------------------------------
  // setDefault
  // -------------------------------------------------------------------------

  describe('setDefault', () => {
    it('delegates to manager.setDefault with the given id', () => {
      service.setDefault('ws-1');

      expect(mockManager.setDefault).toHaveBeenCalledWith('ws-1');
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('returns true when manager deletes the workspace', () => {
      mockManager.delete.mockReturnValue(true);

      expect(service.delete('ws-1')).toBe(true);
      expect(mockManager.delete).toHaveBeenCalledWith('ws-1');
    });

    it('returns false when the workspace does not exist', () => {
      mockManager.delete.mockReturnValue(false);

      expect(service.delete('nonexistent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    it('maps every workspace returned by manager to WorkspaceInfo', () => {
      mockManager.getAll.mockReturnValue([
        makeWorkspace({ config: { id: 'ws-1', name: 'First' } }),
        makeWorkspace({ config: { id: 'ws-2', name: 'Second' } }),
      ]);

      const result = service.getAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ws-1');
      expect(result[0].name).toBe('First');
      expect(result[1].id).toBe('ws-2');
      expect(result[1].name).toBe('Second');
    });

    it('returns an empty array when there are no workspaces', () => {
      mockManager.getAll.mockReturnValue([]);

      const result = service.getAll();

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // associateChannel
  // -------------------------------------------------------------------------

  describe('associateChannel', () => {
    it('delegates to manager.associateChannel with workspace and channel IDs', () => {
      service.associateChannel('ws-1', 'ch-1');

      expect(mockManager.associateChannel).toHaveBeenCalledWith('ws-1', 'ch-1');
    });
  });

  // -------------------------------------------------------------------------
  // disassociateChannel
  // -------------------------------------------------------------------------

  describe('disassociateChannel', () => {
    it('delegates to manager.disassociateChannel with the channel ID', () => {
      service.disassociateChannel('ch-1');

      expect(mockManager.disassociateChannel).toHaveBeenCalledWith('ch-1');
    });
  });

  // -------------------------------------------------------------------------
  // updateAgentConfig
  // -------------------------------------------------------------------------

  describe('updateAgentConfig', () => {
    it('delegates to manager.updateAgentConfig with workspace ID and config', () => {
      const agentConfig = { provider: 'anthropic', model: 'claude-3-7-sonnet' };

      service.updateAgentConfig('ws-1', agentConfig);

      expect(mockManager.updateAgentConfig).toHaveBeenCalledWith('ws-1', agentConfig);
    });
  });

  // -------------------------------------------------------------------------
  // getCount
  // -------------------------------------------------------------------------

  describe('getCount', () => {
    it('reads the count property from manager', () => {
      mockManager.count = 7;

      expect(service.getCount()).toBe(7);
    });

    it('returns 0 when manager has no workspaces', () => {
      mockManager.count = 0;

      expect(service.getCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // toWorkspaceInfo mapping
  // -------------------------------------------------------------------------

  describe('toWorkspaceInfo mapping', () => {
    it('returns a shallow copy of the channels array (not the same reference)', () => {
      const ws = makeWorkspace({ config: { channels: ['ch-1', 'ch-2'] } });
      mockManager.get.mockReturnValue(ws);

      const info = service.get('ws-1');

      expect(info!.channels).toEqual(['ch-1', 'ch-2']);
      // The spread inside toWorkspaceInfo must produce a new array instance
      expect(info!.channels).not.toBe((ws as { config: { channels: string[] } }).config.channels);
    });
  });

  // -------------------------------------------------------------------------
  // createWorkspaceServiceImpl factory
  // -------------------------------------------------------------------------

  describe('createWorkspaceServiceImpl', () => {
    it('returns a WorkspaceServiceImpl instance that satisfies IWorkspaceService', () => {
      const svc = createWorkspaceServiceImpl();

      expect(svc).toBeInstanceOf(WorkspaceServiceImpl);
      // Verify the interface contract is satisfied by checking method presence
      expect(typeof svc.create).toBe('function');
      expect(typeof svc.get).toBe('function');
      expect(typeof svc.getByChannel).toBe('function');
      expect(typeof svc.getDefault).toBe('function');
      expect(typeof svc.getOrCreateDefault).toBe('function');
      expect(typeof svc.setDefault).toBe('function');
      expect(typeof svc.delete).toBe('function');
      expect(typeof svc.getAll).toBe('function');
      expect(typeof svc.associateChannel).toBe('function');
      expect(typeof svc.disassociateChannel).toBe('function');
      expect(typeof svc.updateAgentConfig).toBe('function');
      expect(typeof svc.getCount).toBe('function');
    });
  });
});
