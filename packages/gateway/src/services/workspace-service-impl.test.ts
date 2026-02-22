/**
 * WorkspaceServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures the factory runs before vi.mock hoisting
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockGetByChannel = vi.hoisted(() => vi.fn());
const mockGetDefault = vi.hoisted(() => vi.fn());
const mockGetOrCreateDefault = vi.hoisted(() => vi.fn());
const mockSetDefault = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockGetAll = vi.hoisted(() => vi.fn());
const mockAssociateChannel = vi.hoisted(() => vi.fn());
const mockDisassociateChannel = vi.hoisted(() => vi.fn());
const mockUpdateAgentConfig = vi.hoisted(() => vi.fn());
let mockCount = vi.hoisted(() => 3);

vi.mock('../workspace/manager.js', () => ({
  workspaceManager: {
    create: (...a: unknown[]) => mockCreate(...a),
    get: (...a: unknown[]) => mockGet(...a),
    getByChannel: (...a: unknown[]) => mockGetByChannel(...a),
    getDefault: () => mockGetDefault(),
    getOrCreateDefault: () => mockGetOrCreateDefault(),
    setDefault: (...a: unknown[]) => mockSetDefault(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
    getAll: () => mockGetAll(),
    associateChannel: (...a: unknown[]) => mockAssociateChannel(...a),
    disassociateChannel: (...a: unknown[]) => mockDisassociateChannel(...a),
    updateAgentConfig: (...a: unknown[]) => mockUpdateAgentConfig(...a),
    get count() {
      return mockCount;
    },
  },
}));

// ---------------------------------------------------------------------------
// SUT — must be imported after vi.mock declarations
// ---------------------------------------------------------------------------

const { WorkspaceServiceImpl, createWorkspaceServiceImpl } =
  await import('./workspace-service-impl.js');

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
    mockCount = 0;
    mockGetAll.mockReturnValue([]);
    service = new WorkspaceServiceImpl();
  });

  // =========================================================================
  // toWorkspaceInfo mapping
  // =========================================================================

  describe('toWorkspaceInfo mapping', () => {
    it('maps all workspace fields to WorkspaceInfo', () => {
      const ws = makeWorkspace();
      mockGet.mockReturnValue(ws);

      const info = service.get('ws-1');

      expect(info).toBeDefined();
      expect(info!.id).toBe('ws-1');
      expect(info!.name).toBe('Test Workspace');
      expect(info!.description).toBe('Test desc');
      expect(info!.userId).toBe('user-1');
      expect(info!.channels).toEqual(['ch-1', 'ch-2']);
      expect(info!.state).toBe('active');
      expect(info!.conversationId).toBe('conv-1');
      expect(info!.createdAt).toEqual(new Date('2024-06-01'));
      expect(info!.lastActivityAt).toEqual(new Date('2024-06-02'));
    });

    it('returns a shallow copy of the channels array (not same reference)', () => {
      const ws = makeWorkspace({ config: { channels: ['ch-1', 'ch-2'] } });
      mockGet.mockReturnValue(ws);

      const info = service.get('ws-1');

      expect(info!.channels).toEqual(['ch-1', 'ch-2']);
      expect(info!.channels).not.toBe((ws as { config: { channels: string[] } }).config.channels);
    });

    it('handles empty channels array', () => {
      const ws = makeWorkspace({ config: { channels: [] } });
      mockGet.mockReturnValue(ws);

      const info = service.get('ws-1');

      expect(info!.channels).toEqual([]);
    });

    it('handles undefined optional fields', () => {
      const ws = makeWorkspace({
        config: {
          id: 'ws-bare',
          name: 'Bare',
          channels: [],
          description: undefined,
          userId: undefined,
        },
        conversationId: undefined,
      });
      mockGet.mockReturnValue(ws);

      const info = service.get('ws-bare');

      expect(info!.description).toBeUndefined();
      expect(info!.userId).toBeUndefined();
      expect(info!.conversationId).toBeUndefined();
    });

    it('preserves Date objects for createdAt and lastActivityAt', () => {
      const ws = makeWorkspace({
        createdAt: new Date('2025-12-25T10:00:00Z'),
        lastActivityAt: new Date('2025-12-31T23:59:59Z'),
      });
      mockGet.mockReturnValue(ws);

      const info = service.get('ws-1');

      expect(info!.createdAt).toBeInstanceOf(Date);
      expect(info!.lastActivityAt).toBeInstanceOf(Date);
      expect(info!.createdAt.toISOString()).toBe('2025-12-25T10:00:00.000Z');
      expect(info!.lastActivityAt.toISOString()).toBe('2025-12-31T23:59:59.000Z');
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('delegates to manager.create and returns mapped WorkspaceInfo', () => {
      const ws = makeWorkspace({ config: { id: 'ws-new', name: 'My Workspace' } });
      mockCreate.mockReturnValue(ws);

      const result = service.create({ name: 'My Workspace' });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(result.id).toBe('ws-new');
      expect(result.name).toBe('My Workspace');
      expect(result.state).toBe('active');
    });

    it('applies default provider "openai" when agent config omits provider', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { systemPrompt: 'Be concise' },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.provider).toBe('openai');
    });

    it('applies default model "gpt-4.1" when agent config omits model', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { temperature: 0.5 },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.model).toBe('gpt-4.1');
    });

    it('applies both default provider and model together', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { systemPrompt: 'Hello', temperature: 0.3 },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({
            provider: 'openai',
            model: 'gpt-4.1',
            systemPrompt: 'Hello',
            temperature: 0.3,
          }),
        })
      );
    });

    it('uses explicit provider when supplied', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { provider: 'anthropic' },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.provider).toBe('anthropic');
    });

    it('uses explicit model when supplied', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { model: 'claude-3-7-sonnet' },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.model).toBe('claude-3-7-sonnet');
    });

    it('uses all explicit agent fields when fully specified', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: {
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          systemPrompt: 'You are helpful',
          temperature: 0.8,
          maxTokens: 4096,
          tools: ['tool1', 'tool2'],
        },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: {
            provider: 'anthropic',
            model: 'claude-3-7-sonnet',
            systemPrompt: 'You are helpful',
            temperature: 0.8,
            maxTokens: 4096,
            tools: ['tool1', 'tool2'],
          },
        })
      );
    });

    it('passes undefined agent to manager when no agent config supplied', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({ name: 'Bare Workspace' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bare Workspace', agent: undefined })
      );
    });

    it('forwards id field to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({ name: 'Test', id: 'custom-id' });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.id).toBe('custom-id');
    });

    it('forwards description field to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({ name: 'Test', description: 'A description' });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.description).toBe('A description');
    });

    it('forwards userId field to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({ name: 'Test', userId: 'u-42' });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.userId).toBe('u-42');
    });

    it('forwards channels field to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({ name: 'Test', channels: ['ch-a', 'ch-b'] });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.channels).toEqual(['ch-a', 'ch-b']);
    });

    it('forwards settings field to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      const settings = { autoReply: true, replyDelay: 500 };
      service.create({ name: 'Test', settings });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.settings).toEqual(settings);
    });

    it('forwards all optional top-level fields together', () => {
      mockCreate.mockReturnValue(
        makeWorkspace({
          config: {
            id: 'custom-id',
            name: 'Full',
            description: 'Detailed',
            userId: 'u-99',
            channels: ['ch-x'],
          },
        })
      );

      service.create({
        name: 'Full',
        id: 'custom-id',
        description: 'Detailed',
        userId: 'u-99',
        channels: ['ch-x'],
        settings: { autoReply: false },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Full',
          id: 'custom-id',
          description: 'Detailed',
          userId: 'u-99',
          channels: ['ch-x'],
          settings: { autoReply: false },
        })
      );
    });

    it('maps agent tools array to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { tools: ['get_time', 'search_web'] },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.tools).toEqual(['get_time', 'search_web']);
    });

    it('maps agent maxTokens to manager', () => {
      mockCreate.mockReturnValue(makeWorkspace());

      service.create({
        name: 'Test',
        agent: { maxTokens: 2048 },
      });

      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.agent.maxTokens).toBe(2048);
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('returns mapped WorkspaceInfo when workspace exists', () => {
      mockGet.mockReturnValue(makeWorkspace());

      const result = service.get('ws-1');

      expect(mockGet).toHaveBeenCalledWith('ws-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('ws-1');
      expect(result!.conversationId).toBe('conv-1');
    });

    it('returns undefined when workspace is not found', () => {
      mockGet.mockReturnValue(undefined);

      expect(service.get('missing')).toBeUndefined();
    });

    it('passes the exact id to manager', () => {
      mockGet.mockReturnValue(undefined);

      service.get('some-specific-id');

      expect(mockGet).toHaveBeenCalledWith('some-specific-id');
    });
  });

  // =========================================================================
  // getByChannel
  // =========================================================================

  describe('getByChannel', () => {
    it('delegates to manager and returns mapped WorkspaceInfo', () => {
      mockGetByChannel.mockReturnValue(makeWorkspace({ config: { channels: ['ch-1', 'ch-2'] } }));

      const result = service.getByChannel('ch-1');

      expect(mockGetByChannel).toHaveBeenCalledWith('ch-1');
      expect(result).toBeDefined();
      expect(result!.channels).toContain('ch-1');
    });

    it('returns undefined when no workspace is associated with the channel', () => {
      mockGetByChannel.mockReturnValue(undefined);

      expect(service.getByChannel('orphan-channel')).toBeUndefined();
    });

    it('passes the exact channelId to manager', () => {
      mockGetByChannel.mockReturnValue(undefined);

      service.getByChannel('telegram-12345');

      expect(mockGetByChannel).toHaveBeenCalledWith('telegram-12345');
    });
  });

  // =========================================================================
  // getDefault
  // =========================================================================

  describe('getDefault', () => {
    it('returns mapped WorkspaceInfo for the default workspace', () => {
      mockGetDefault.mockReturnValue(makeWorkspace({ config: { name: 'Default' } }));

      const result = service.getDefault();

      expect(mockGetDefault).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      expect(result!.name).toBe('Default');
    });

    it('returns undefined when no default workspace is set', () => {
      mockGetDefault.mockReturnValue(undefined);

      expect(service.getDefault()).toBeUndefined();
    });
  });

  // =========================================================================
  // getOrCreateDefault
  // =========================================================================

  describe('getOrCreateDefault', () => {
    it('always returns mapped WorkspaceInfo (never undefined)', () => {
      mockGetOrCreateDefault.mockReturnValue(makeWorkspace({ config: { name: 'Auto Default' } }));

      const result = service.getOrCreateDefault();

      expect(mockGetOrCreateDefault).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      expect(result.name).toBe('Auto Default');
    });

    it('returns a complete WorkspaceInfo with all fields', () => {
      mockGetOrCreateDefault.mockReturnValue(makeWorkspace());

      const result = service.getOrCreateDefault();

      expect(result.id).toBeDefined();
      expect(result.name).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.channels).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.lastActivityAt).toBeDefined();
    });
  });

  // =========================================================================
  // setDefault
  // =========================================================================

  describe('setDefault', () => {
    it('delegates to manager.setDefault with the given id', () => {
      service.setDefault('ws-1');

      expect(mockSetDefault).toHaveBeenCalledWith('ws-1');
    });

    it('passes the exact id string', () => {
      service.setDefault('workspace-with-long-id-123');

      expect(mockSetDefault).toHaveBeenCalledWith('workspace-with-long-id-123');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('returns true when manager deletes the workspace', () => {
      mockDelete.mockReturnValue(true);

      expect(service.delete('ws-1')).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('ws-1');
    });

    it('returns false when the workspace does not exist', () => {
      mockDelete.mockReturnValue(false);

      expect(service.delete('nonexistent')).toBe(false);
    });

    it('passes the exact id to manager', () => {
      mockDelete.mockReturnValue(false);

      service.delete('ws-to-delete');

      expect(mockDelete).toHaveBeenCalledWith('ws-to-delete');
    });
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('maps every workspace returned by manager to WorkspaceInfo', () => {
      mockGetAll.mockReturnValue([
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
      mockGetAll.mockReturnValue([]);

      const result = service.getAll();

      expect(result).toEqual([]);
    });

    it('maps channels as copies for each workspace', () => {
      const ws1 = makeWorkspace({ config: { id: 'ws-1', channels: ['ch-a'] } });
      const ws2 = makeWorkspace({ config: { id: 'ws-2', channels: ['ch-b'] } });
      mockGetAll.mockReturnValue([ws1, ws2]);

      const result = service.getAll();

      expect(result[0].channels).toEqual(['ch-a']);
      expect(result[1].channels).toEqual(['ch-b']);
      expect(result[0].channels).not.toBe(ws1.config.channels);
      expect(result[1].channels).not.toBe(ws2.config.channels);
    });

    it('handles a single workspace in the array', () => {
      mockGetAll.mockReturnValue([makeWorkspace({ config: { id: 'only-one' } })]);

      const result = service.getAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('only-one');
    });

    it('preserves order from manager', () => {
      mockGetAll.mockReturnValue([
        makeWorkspace({ config: { id: 'z-last' } }),
        makeWorkspace({ config: { id: 'a-first' } }),
        makeWorkspace({ config: { id: 'm-middle' } }),
      ]);

      const result = service.getAll();

      expect(result.map((r) => r.id)).toEqual(['z-last', 'a-first', 'm-middle']);
    });
  });

  // =========================================================================
  // associateChannel
  // =========================================================================

  describe('associateChannel', () => {
    it('delegates to manager.associateChannel with workspace and channel IDs', () => {
      service.associateChannel('ws-1', 'ch-1');

      expect(mockAssociateChannel).toHaveBeenCalledWith('ws-1', 'ch-1');
    });

    it('passes both arguments in correct order', () => {
      service.associateChannel('workspace-abc', 'channel-xyz');

      expect(mockAssociateChannel).toHaveBeenCalledWith('workspace-abc', 'channel-xyz');
    });
  });

  // =========================================================================
  // disassociateChannel
  // =========================================================================

  describe('disassociateChannel', () => {
    it('delegates to manager.disassociateChannel with the channel ID', () => {
      service.disassociateChannel('ch-1');

      expect(mockDisassociateChannel).toHaveBeenCalledWith('ch-1');
    });

    it('passes the exact channelId', () => {
      service.disassociateChannel('telegram-channel-42');

      expect(mockDisassociateChannel).toHaveBeenCalledWith('telegram-channel-42');
    });
  });

  // =========================================================================
  // updateAgentConfig
  // =========================================================================

  describe('updateAgentConfig', () => {
    it('delegates to manager.updateAgentConfig with workspace ID and config', () => {
      const agentConfig = { provider: 'anthropic', model: 'claude-3-7-sonnet' };

      service.updateAgentConfig('ws-1', agentConfig);

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('ws-1', agentConfig);
    });

    it('passes the full agent config object without modification', () => {
      const agentConfig = {
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are helpful',
        temperature: 0.7,
        maxTokens: 8192,
        tools: ['tool1', 'tool2'],
      };

      service.updateAgentConfig('ws-2', agentConfig);

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('ws-2', agentConfig);
    });

    it('passes empty agent config object', () => {
      service.updateAgentConfig('ws-1', {});

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('ws-1', {});
    });

    it('passes partial agent config', () => {
      service.updateAgentConfig('ws-1', { temperature: 0.3 });

      expect(mockUpdateAgentConfig).toHaveBeenCalledWith('ws-1', { temperature: 0.3 });
    });
  });

  // =========================================================================
  // getCount
  // =========================================================================

  describe('getCount', () => {
    it('returns the count property from manager', () => {
      mockCount = 7;

      expect(service.getCount()).toBe(7);
    });

    it('returns 0 when manager has no workspaces', () => {
      mockCount = 0;

      expect(service.getCount()).toBe(0);
    });

    it('returns large count values', () => {
      mockCount = 1000;

      expect(service.getCount()).toBe(1000);
    });

    it('reflects current count (not cached)', () => {
      mockCount = 1;
      expect(service.getCount()).toBe(1);

      mockCount = 5;
      expect(service.getCount()).toBe(5);
    });
  });

  // =========================================================================
  // createWorkspaceServiceImpl factory
  // =========================================================================

  describe('createWorkspaceServiceImpl', () => {
    it('returns a WorkspaceServiceImpl instance', () => {
      const svc = createWorkspaceServiceImpl();

      expect(svc).toBeInstanceOf(WorkspaceServiceImpl);
    });

    it('returned instance satisfies IWorkspaceService interface', () => {
      const svc = createWorkspaceServiceImpl();

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

    it('factory-created instance delegates to manager correctly', () => {
      const svc = createWorkspaceServiceImpl();
      mockGet.mockReturnValue(makeWorkspace());

      const result = svc.get('ws-1');

      expect(mockGet).toHaveBeenCalledWith('ws-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('ws-1');
    });
  });
});
