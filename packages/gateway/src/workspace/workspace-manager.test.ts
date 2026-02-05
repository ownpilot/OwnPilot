import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceMessage, WorkspaceState, Workspace } from './types.js';

// ---------------------------------------------------------------------------
// Mocks – must be declared before any import that touches the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../ws/events.js', () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    gatewayEvents: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      }),
      _handlers: handlers,
    },
  };
});

vi.mock('@ownpilot/core', () => ({
  getChannelService: () => ({ getChannel: vi.fn(), send: vi.fn() }),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Import after mocks are set up
import { WorkspaceManager } from './manager.js';
import { gatewayEvents } from '../ws/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkspaceManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // =========================================================================
  // 1. create
  // =========================================================================
  describe('create', () => {
    it('should create a workspace with the given name', () => {
      const ws = manager.create({ name: 'Test Workspace' });

      expect(ws.config.name).toBe('Test Workspace');
      expect(ws.config.id).toBeDefined();
      expect(typeof ws.config.id).toBe('string');
    });

    it('should use the provided id when specified', () => {
      const ws = manager.create({ name: 'WS', id: 'custom-id' });

      expect(ws.config.id).toBe('custom-id');
    });

    it('should generate a unique id when none is provided', () => {
      const ws1 = manager.create({ name: 'WS1' });
      const ws2 = manager.create({ name: 'WS2' });

      expect(ws1.config.id).not.toBe(ws2.config.id);
    });

    it('should apply default settings when none are provided', () => {
      const ws = manager.create({ name: 'WS' });

      expect(ws.config.settings).toEqual({
        autoReply: true,
        replyDelay: 500,
        maxContextMessages: 20,
        enableMemory: true,
        piiDetection: true,
      });
    });

    it('should merge provided settings with defaults', () => {
      const ws = manager.create({
        name: 'WS',
        settings: { autoReply: false, maxContextMessages: 50 },
      });

      expect(ws.config.settings).toEqual({
        autoReply: false,
        replyDelay: 500,
        maxContextMessages: 50,
        enableMemory: true,
        piiDetection: true,
      });
    });

    it('should apply default agent config when none is provided', () => {
      const ws = manager.create({ name: 'WS' });

      expect(ws.config.agent).toEqual({
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a helpful AI assistant.',
        temperature: 0.7,
        maxTokens: 4096,
        tools: [],
      });
    });

    it('should use the provided agent config', () => {
      const agent = { provider: 'anthropic', model: 'claude-3' };
      const ws = manager.create({ name: 'WS', agent });

      expect(ws.config.agent).toEqual(agent);
    });

    it('should default channels to an empty array', () => {
      const ws = manager.create({ name: 'WS' });

      expect(ws.config.channels).toEqual([]);
    });

    it('should associate provided channels with the workspace', () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1', 'ch-2'] });

      expect(ws.config.channels).toEqual(['ch-1', 'ch-2']);
      expect(manager.getByChannel('ch-1')).toBe(ws);
      expect(manager.getByChannel('ch-2')).toBe(ws);
    });

    it('should set the first created workspace as default', () => {
      const ws = manager.create({ name: 'First' });

      expect(manager.getDefault()).toBe(ws);
    });

    it('should not overwrite existing default when creating additional workspaces', () => {
      const first = manager.create({ name: 'First' });
      manager.create({ name: 'Second' });

      expect(manager.getDefault()).toBe(first);
    });

    it('should emit workspace:created event', () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1'] });

      expect(gatewayEvents.emit).toHaveBeenCalledWith('workspace:created', {
        workspace: {
          id: ws.config.id,
          name: 'WS',
          channels: ['ch-1'],
          agentId: ws.config.agent?.provider,
          createdAt: ws.createdAt,
        },
      });
    });

    it('should preserve optional fields like description and userId', () => {
      const ws = manager.create({
        name: 'WS',
        description: 'A test workspace',
        userId: 'user-42',
      });

      expect(ws.config.description).toBe('A test workspace');
      expect(ws.config.userId).toBe('user-42');
    });

    it('should set initial workspace state to idle', () => {
      const ws = manager.create({ name: 'WS' });

      expect(ws.state).toBe('idle');
    });

    it('should set createdAt and lastActivityAt timestamps', () => {
      const before = new Date();
      const ws = manager.create({ name: 'WS' });
      const after = new Date();

      expect(ws.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ws.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(ws.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should assign a conversationId', () => {
      const ws = manager.create({ name: 'WS' });

      expect(ws.conversationId).toBeDefined();
      expect(typeof ws.conversationId).toBe('string');
    });
  });

  // =========================================================================
  // 2. get
  // =========================================================================
  describe('get', () => {
    it('should return the workspace when it exists', () => {
      const ws = manager.create({ name: 'WS', id: 'ws-1' });

      expect(manager.get('ws-1')).toBe(ws);
    });

    it('should return undefined for non-existent id', () => {
      expect(manager.get('non-existent')).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. getByChannel
  // =========================================================================
  describe('getByChannel', () => {
    it('should return the workspace associated with the channel', () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1'] });

      expect(manager.getByChannel('ch-1')).toBe(ws);
    });

    it('should return undefined for an unassociated channel', () => {
      expect(manager.getByChannel('unknown-ch')).toBeUndefined();
    });

    it('should return the correct workspace when multiple exist', () => {
      const ws1 = manager.create({ name: 'WS1', channels: ['ch-1'] });
      const ws2 = manager.create({ name: 'WS2', channels: ['ch-2'] });

      expect(manager.getByChannel('ch-1')).toBe(ws1);
      expect(manager.getByChannel('ch-2')).toBe(ws2);
    });
  });

  // =========================================================================
  // 4. getDefault
  // =========================================================================
  describe('getDefault', () => {
    it('should return undefined when no workspaces exist', () => {
      expect(manager.getDefault()).toBeUndefined();
    });

    it('should return the first created workspace by default', () => {
      const first = manager.create({ name: 'First' });
      manager.create({ name: 'Second' });

      expect(manager.getDefault()).toBe(first);
    });

    it('should return the workspace set via setDefault', () => {
      manager.create({ name: 'First', id: 'ws-1' });
      const second = manager.create({ name: 'Second', id: 'ws-2' });

      manager.setDefault('ws-2');

      expect(manager.getDefault()).toBe(second);
    });
  });

  // =========================================================================
  // 5. getOrCreateDefault
  // =========================================================================
  describe('getOrCreateDefault', () => {
    it('should create a default workspace when none exists', () => {
      const ws = manager.getOrCreateDefault();

      expect(ws).toBeDefined();
      expect(ws.config.name).toBe('Default Workspace');
      expect(manager.count).toBe(1);
    });

    it('should return existing default workspace when one exists', () => {
      const first = manager.create({ name: 'Existing' });
      const result = manager.getOrCreateDefault();

      expect(result).toBe(first);
      expect(manager.count).toBe(1);
    });

    it('should only create one workspace on repeated calls', () => {
      manager.getOrCreateDefault();
      manager.getOrCreateDefault();
      manager.getOrCreateDefault();

      expect(manager.count).toBe(1);
    });
  });

  // =========================================================================
  // 6. setDefault
  // =========================================================================
  describe('setDefault', () => {
    it('should set the default workspace', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });

      manager.setDefault('ws-2');

      expect(manager.getDefault()).toBe(ws2);
    });

    it('should throw when workspace is not found', () => {
      expect(() => manager.setDefault('non-existent')).toThrow(
        'Workspace not found: non-existent',
      );
    });
  });

  // =========================================================================
  // 7. delete
  // =========================================================================
  describe('delete', () => {
    it('should remove the workspace', () => {
      manager.create({ name: 'WS', id: 'ws-1' });

      const result = manager.delete('ws-1');

      expect(result).toBe(true);
      expect(manager.get('ws-1')).toBeUndefined();
      expect(manager.count).toBe(0);
    });

    it('should return false when workspace does not exist', () => {
      expect(manager.delete('non-existent')).toBe(false);
    });

    it('should clean up channel associations', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1', 'ch-2'] });

      manager.delete('ws-1');

      expect(manager.getByChannel('ch-1')).toBeUndefined();
      expect(manager.getByChannel('ch-2')).toBeUndefined();
    });

    it('should update default to another workspace when default is deleted', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });

      manager.delete('ws-1');

      expect(manager.getDefault()).toBe(ws2);
    });

    it('should set default to null when the last workspace is deleted', () => {
      manager.create({ name: 'WS', id: 'ws-1' });

      manager.delete('ws-1');

      expect(manager.getDefault()).toBeUndefined();
    });

    it('should not change default when a non-default workspace is deleted', () => {
      const ws1 = manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });

      manager.delete('ws-2');

      expect(manager.getDefault()).toBe(ws1);
    });

    it('should emit workspace:deleted event', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      vi.mocked(gatewayEvents.emit).mockClear();

      manager.delete('ws-1');

      expect(gatewayEvents.emit).toHaveBeenCalledWith('workspace:deleted', {
        workspaceId: 'ws-1',
      });
    });

    it('should not emit event when workspace does not exist', () => {
      vi.mocked(gatewayEvents.emit).mockClear();

      manager.delete('non-existent');

      expect(gatewayEvents.emit).not.toHaveBeenCalledWith(
        'workspace:deleted',
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // 8. getAll
  // =========================================================================
  describe('getAll', () => {
    it('should return an empty array when no workspaces exist', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('should return all workspaces', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.create({ name: 'WS3', id: 'ws-3' });

      const all = manager.getAll();

      expect(all).toHaveLength(3);
      expect(all.map((w) => w.config.id)).toEqual(
        expect.arrayContaining(['ws-1', 'ws-2', 'ws-3']),
      );
    });
  });

  // =========================================================================
  // 9. associateChannel
  // =========================================================================
  describe('associateChannel', () => {
    it('should associate a channel with a workspace', () => {
      const ws = manager.create({ name: 'WS', id: 'ws-1' });

      manager.associateChannel('ws-1', 'ch-new');

      expect(manager.getByChannel('ch-new')).toBe(ws);
      expect(ws.config.channels).toContain('ch-new');
    });

    it('should not duplicate the channel in config.channels', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });

      manager.associateChannel('ws-1', 'ch-1');

      const ws = manager.get('ws-1') as Workspace;
      const occurrences = ws.config.channels.filter((c) => c === 'ch-1');
      expect(occurrences).toHaveLength(1);
    });

    it('should throw when workspace is not found', () => {
      expect(() => manager.associateChannel('non-existent', 'ch-1')).toThrow(
        'Workspace not found: non-existent',
      );
    });
  });

  // =========================================================================
  // 10. disassociateChannel
  // =========================================================================
  describe('disassociateChannel', () => {
    it('should remove the channel-to-workspace mapping', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });

      manager.disassociateChannel('ch-1');

      expect(manager.getByChannel('ch-1')).toBeUndefined();
    });

    it('should remove the channel from workspace config.channels', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1', 'ch-2'] });

      manager.disassociateChannel('ch-1');

      const ws = manager.get('ws-1') as Workspace;
      expect(ws.config.channels).toEqual(['ch-2']);
    });

    it('should be safe to call with an unknown channel', () => {
      expect(() => manager.disassociateChannel('unknown')).not.toThrow();
    });
  });

  // =========================================================================
  // 11. updateAgentConfig
  // =========================================================================
  describe('updateAgentConfig', () => {
    it('should merge agent config into existing config', () => {
      manager.create({ name: 'WS', id: 'ws-1' });

      manager.updateAgentConfig('ws-1', { model: 'claude-4', temperature: 0.9 });

      const ws = manager.get('ws-1') as Workspace;
      expect(ws.config.agent?.model).toBe('claude-4');
      expect(ws.config.agent?.temperature).toBe(0.9);
      // Untouched fields should remain from default
      expect(ws.config.agent?.provider).toBe('openai');
      expect(ws.config.agent?.systemPrompt).toBe('You are a helpful AI assistant.');
    });

    it('should set defaults when workspace had no agent config', () => {
      // Force-create workspace with undefined agent
      manager.create({ name: 'WS', id: 'ws-1', agent: undefined });

      manager.updateAgentConfig('ws-1', { model: 'gpt-5' });

      const ws = manager.get('ws-1') as Workspace;
      expect(ws.config.agent?.model).toBe('gpt-5');
      expect(ws.config.agent?.provider).toBe('openai');
    });

    it('should throw when workspace is not found', () => {
      expect(() =>
        manager.updateAgentConfig('non-existent', { model: 'gpt-5' }),
      ).toThrow('Workspace not found: non-existent');
    });
  });

  // =========================================================================
  // 12. count
  // =========================================================================
  describe('count', () => {
    it('should return 0 when empty', () => {
      expect(manager.count).toBe(0);
    });

    it('should reflect the number of workspaces', () => {
      manager.create({ name: 'WS1' });
      manager.create({ name: 'WS2' });

      expect(manager.count).toBe(2);
    });

    it('should decrease after deletion', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });

      manager.delete('ws-1');

      expect(manager.count).toBe(1);
    });
  });

  // =========================================================================
  // 13. dispose
  // =========================================================================
  describe('dispose', () => {
    it('should call the unsubscribe function registered in setupChannelForwarding', () => {
      // The constructor calls gatewayEvents.on('channel:message', ...) which
      // returns an unsubscribe function. dispose() should invoke it.
      const mockOn = vi.mocked(gatewayEvents.on);
      const callCountBefore = mockOn.mock.calls.length;

      const localManager = new WorkspaceManager();
      // A new on('channel:message', ...) call should have been made
      expect(mockOn.mock.calls.length).toBeGreaterThan(callCountBefore);

      localManager.dispose();

      // After dispose, a second dispose should be a no-op (no double-free)
      expect(() => localManager.dispose()).not.toThrow();
    });

    it('should clear all unsubscribe handlers so repeated dispose is safe', () => {
      manager.dispose();
      manager.dispose();
      // No errors means success
    });
  });

  // =========================================================================
  // 14. WorkspaceInstance (tested indirectly via manager)
  // =========================================================================
  describe('WorkspaceInstance behavior', () => {
    // Access instance methods by casting: the manager returns `Workspace`
    // (the interface), but the real object has addMessage / getMessages etc.
    // Methods must be bound to preserve `this` context.

    function bindMethod<T>(ws: Workspace, name: string): T {
      const instance = ws as Record<string, unknown>;
      const fn = instance[name] as (...args: unknown[]) => unknown;
      return fn.bind(ws) as T;
    }

    // -----------------------------------------------------------------------
    // 14a. State management
    // -----------------------------------------------------------------------
    describe('setState', () => {
      it('should update state', () => {
        const ws = manager.create({ name: 'WS' });
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        setState('processing');

        expect(ws.state).toBe('processing');
      });

      it('should update error field', () => {
        const ws = manager.create({ name: 'WS' });
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        setState('error', 'Something went wrong');

        expect(ws.state).toBe('error');
        expect(ws.error).toBe('Something went wrong');
      });

      it('should clear error when transitioning to non-error state', () => {
        const ws = manager.create({ name: 'WS' });
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        setState('error', 'fail');
        expect(ws.error).toBe('fail');

        setState('idle');
        expect(ws.error).toBeUndefined();
      });

      it('should update lastActivityAt', () => {
        const ws = manager.create({ name: 'WS' });
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');
        const before = ws.lastActivityAt;

        setState('processing');

        expect(ws.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });

      it('should emit stateChange event', () => {
        const ws = manager.create({ name: 'WS' });
        const on = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'on');
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');
        const handler = vi.fn();

        on('stateChange', handler);
        setState('error', 'timeout');

        expect(handler).toHaveBeenCalledWith('error', 'timeout');
      });
    });

    // -----------------------------------------------------------------------
    // 14b. Message management
    // -----------------------------------------------------------------------
    describe('addMessage', () => {
      it('should store a message', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
        const msg = makeMessage();

        addMessage(msg);

        const messages = getMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual(msg);
      });

      it('should update lastActivityAt', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const before = ws.lastActivityAt;

        addMessage(makeMessage());

        expect(ws.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });

      it('should emit message event', () => {
        const ws = manager.create({ name: 'WS' });
        const on = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'on');
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const handler = vi.fn();
        const msg = makeMessage();

        on('message', handler);
        addMessage(msg);

        expect(handler).toHaveBeenCalledWith(msg);
      });

      it('should prune messages when exceeding maxHistory threshold', () => {
        const ws = manager.create({
          name: 'WS',
          settings: { maxContextMessages: 2 },
        });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

        // maxHistory = maxContextMessages * 5 = 10
        const totalMessages = 12;
        for (let i = 0; i < totalMessages; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        const messages = getMessages();
        // After pruning, should keep the last 10 (maxContextMessages * 5)
        expect(messages).toHaveLength(10);
        // First message should be msg-2 (messages 0 and 1 were pruned)
        expect(messages[0].content).toBe('msg-2');
        expect(messages[messages.length - 1].content).toBe('msg-11');
      });

      it('should not prune when under the threshold', () => {
        const ws = manager.create({
          name: 'WS',
          settings: { maxContextMessages: 20 },
        });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

        // maxHistory = 20 * 5 = 100; add 50 messages (under threshold)
        for (let i = 0; i < 50; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        expect(getMessages()).toHaveLength(50);
      });

      it('should use default maxContextMessages (20) when not specified', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

        // maxHistory = 20 * 5 = 100; add 105 messages
        for (let i = 0; i < 105; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        const messages = getMessages();
        expect(messages).toHaveLength(100);
        expect(messages[0].content).toBe('msg-5');
      });
    });

    // -----------------------------------------------------------------------
    // 14c. getMessages
    // -----------------------------------------------------------------------
    describe('getMessages', () => {
      it('should return an empty array initially', () => {
        const ws = manager.create({ name: 'WS' });
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

        const messages = getMessages();

        expect(messages).toEqual([]);
      });

      it('should return a copy (not a reference to the internal array)', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

        addMessage(makeMessage());

        const first = getMessages();
        const second = getMessages();
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
      });
    });

    // -----------------------------------------------------------------------
    // 14d. getContextMessages
    // -----------------------------------------------------------------------
    describe('getContextMessages', () => {
      it('should return the last N messages based on settings', () => {
        const ws = manager.create({
          name: 'WS',
          settings: { maxContextMessages: 3 },
        });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getContextMessages = bindMethod<(limit?: number) => WorkspaceMessage[]>(
          ws,
          'getContextMessages',
        );

        for (let i = 0; i < 5; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        const context = getContextMessages();

        expect(context).toHaveLength(3);
        expect(context[0].content).toBe('msg-2');
        expect(context[2].content).toBe('msg-4');
      });

      it('should use explicit limit over settings', () => {
        const ws = manager.create({
          name: 'WS',
          settings: { maxContextMessages: 10 },
        });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getContextMessages = bindMethod<(limit?: number) => WorkspaceMessage[]>(
          ws,
          'getContextMessages',
        );

        for (let i = 0; i < 10; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        const context = getContextMessages(2);

        expect(context).toHaveLength(2);
        expect(context[0].content).toBe('msg-8');
        expect(context[1].content).toBe('msg-9');
      });

      it('should default to 20 when no limit or settings provided', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getContextMessages = bindMethod<(limit?: number) => WorkspaceMessage[]>(
          ws,
          'getContextMessages',
        );

        for (let i = 0; i < 30; i++) {
          addMessage(makeMessage({ content: `msg-${i}` }));
        }

        const context = getContextMessages();

        expect(context).toHaveLength(20);
        expect(context[0].content).toBe('msg-10');
      });

      it('should return all messages when fewer than the limit', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getContextMessages = bindMethod<(limit?: number) => WorkspaceMessage[]>(
          ws,
          'getContextMessages',
        );

        addMessage(makeMessage({ content: 'only' }));

        const context = getContextMessages();

        expect(context).toHaveLength(1);
        expect(context[0].content).toBe('only');
      });
    });

    // -----------------------------------------------------------------------
    // 14e. clearMessages
    // -----------------------------------------------------------------------
    describe('clearMessages', () => {
      it('should remove all messages', () => {
        const ws = manager.create({ name: 'WS' });
        const addMessage = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
        const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
        const clearMessages = bindMethod<() => void>(ws, 'clearMessages');

        addMessage(makeMessage());
        addMessage(makeMessage());
        expect(getMessages()).toHaveLength(2);

        clearMessages();

        expect(getMessages()).toHaveLength(0);
      });

      it('should generate a new conversationId', () => {
        const ws = manager.create({ name: 'WS' });
        const clearMessages = bindMethod<() => void>(ws, 'clearMessages');
        const oldConversationId = ws.conversationId;

        clearMessages();

        expect(ws.conversationId).toBeDefined();
        expect(ws.conversationId).not.toBe(oldConversationId);
      });
    });

    // -----------------------------------------------------------------------
    // 14f. Event system (on / off)
    // -----------------------------------------------------------------------
    describe('event handlers', () => {
      it('should call multiple handlers for the same event', () => {
        const ws = manager.create({ name: 'WS' });
        const on = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'on');
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        const handler1 = vi.fn();
        const handler2 = vi.fn();
        on('stateChange', handler1);
        on('stateChange', handler2);

        setState('processing');

        expect(handler1).toHaveBeenCalledWith('processing', undefined);
        expect(handler2).toHaveBeenCalledWith('processing', undefined);
      });

      it('should stop calling a handler after off()', () => {
        const ws = manager.create({ name: 'WS' });
        const on = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'on');
        const off = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'off');
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        const handler = vi.fn();
        on('stateChange', handler);

        setState('processing');
        expect(handler).toHaveBeenCalledTimes(1);

        off('stateChange', handler);
        setState('idle');

        expect(handler).toHaveBeenCalledTimes(1);
      });

      it('should not throw when emitting with no registered handlers', () => {
        const ws = manager.create({ name: 'WS' });
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        expect(() => setState('processing')).not.toThrow();
      });

      it('should catch and log handler errors without crashing', () => {
        const ws = manager.create({ name: 'WS' });
        const on = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'on');
        const setState = bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');

        const errorHandler = vi.fn(() => {
          throw new Error('handler failed');
        });
        const goodHandler = vi.fn();

        on('stateChange', errorHandler);
        on('stateChange', goodHandler);

        // Should not throw despite the failing handler
        expect(() => setState('processing')).not.toThrow();
        // The good handler should still run
        expect(goodHandler).toHaveBeenCalled();
      });

      it('should off() be safe to call for events that have no handlers', () => {
        const ws = manager.create({ name: 'WS' });
        const off = bindMethod<(event: string, handler: (...args: unknown[]) => void) => void>(ws, 'off');

        expect(() => off('stateChange', vi.fn())).not.toThrow();
      });
    });
  });

  // =========================================================================
  // 15. Integration: channel forwarding setup
  // =========================================================================
  describe('channel forwarding', () => {
    it('should register a channel:message handler on construction', () => {
      expect(gatewayEvents.on).toHaveBeenCalledWith(
        'channel:message',
        expect.any(Function),
      );
    });
  });

  // =========================================================================
  // 16. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle creating workspace with empty name', () => {
      const ws = manager.create({ name: '' });
      expect(ws.config.name).toBe('');
    });

    it('should handle multiple channel associations to different workspaces then reassign', () => {
      manager.create({ name: 'WS1', id: 'ws-1', channels: ['ch-shared'] });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });

      // Re-associate the channel to ws-2
      manager.associateChannel('ws-2', 'ch-shared');

      // The channelToWorkspace map now points ch-shared to ws-2
      expect(manager.getByChannel('ch-shared')).toBe(ws2);
    });

    it('should delete workspace that is not the default without affecting default', () => {
      manager.create({ name: 'Default', id: 'ws-default' });
      manager.create({ name: 'Other', id: 'ws-other' });

      manager.delete('ws-other');

      expect(manager.getDefault()?.config.id).toBe('ws-default');
      expect(manager.count).toBe(1);
    });

    it('should handle rapid creation and deletion', () => {
      for (let i = 0; i < 100; i++) {
        manager.create({ name: `WS-${i}`, id: `ws-${i}` });
      }
      expect(manager.count).toBe(100);

      for (let i = 0; i < 50; i++) {
        manager.delete(`ws-${i}`);
      }
      expect(manager.count).toBe(50);
      expect(manager.get('ws-0')).toBeUndefined();
      expect(manager.get('ws-50')).toBeDefined();
    });

    it('should handle disassociating a channel that was already disassociated', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });

      manager.disassociateChannel('ch-1');
      manager.disassociateChannel('ch-1');

      expect(manager.getByChannel('ch-1')).toBeUndefined();
    });

    it('should handle updateAgentConfig with empty partial config', () => {
      manager.create({ name: 'WS', id: 'ws-1' });

      expect(() => manager.updateAgentConfig('ws-1', {})).not.toThrow();

      const ws = manager.get('ws-1') as Workspace;
      // Config should still have defaults
      expect(ws.config.agent?.provider).toBe('openai');
    });
  });
});
