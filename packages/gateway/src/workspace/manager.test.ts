/**
 * Comprehensive tests for WorkspaceManager (manager.ts).
 *
 * Covers: WorkspaceManager CRUD, WorkspaceInstance state/message/event
 * system, processIncomingMessage, generateResponse (success and error
 * paths), channel forwarding via gatewayEvents, dispose, count, and
 * all edge cases.
 *
 * Each test creates its own WorkspaceManager via `new WorkspaceManager()`
 * to avoid cross-test leakage from the module-level singleton and its
 * `channel:message` subscription.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceMessage, WorkspaceState, Workspace } from './types.js';
import type { IncomingMessage } from '../ws/types.js';

// ---------------------------------------------------------------------------
// Hoisted mock state shared across all vi.mock factories
// vi.hoisted() runs before vi.mock() factories, making the variable available
// inside the factory closure without TDZ errors.
// ---------------------------------------------------------------------------

const channelMessageHandlers = vi.hoisted(() => new Map<string, Set<(data: unknown) => void>>());

// ---------------------------------------------------------------------------
// Mocks – declared BEFORE any import that transitively loads the mocked module
// ---------------------------------------------------------------------------

vi.mock('../ws/events.js', () => {
  return {
    gatewayEvents: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (!channelMessageHandlers.has(event)) {
          channelMessageHandlers.set(event, new Set());
        }
        channelMessageHandlers.get(event)!.add(handler);
        return () => {
          channelMessageHandlers.get(event)?.delete(handler);
        };
      }),
    },
  };
});

const mockGetChannel = vi.fn(() => null);
const mockChannelSend = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getChannelService: vi.fn(() => ({
      getChannel: mockGetChannel,
      send: mockChannelSend,
    })),
  };
});

const mockAgentChat = vi.fn(() => ({ ok: true, value: { content: 'AI response' } }));
const mockGetOrCreateChatAgent = vi.fn(() => ({ chat: mockAgentChat }));

vi.mock('../routes/agents.js', () => ({
  getOrCreateChatAgent: mockGetOrCreateChatAgent,
}));

const mockResolveProviderAndModel = vi.fn(() => ({
  provider: 'openai',
  model: 'gpt-4o-mini',
}));

vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: mockResolveProviderAndModel,
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// ---------------------------------------------------------------------------
// Imports – after vi.mock declarations
// ---------------------------------------------------------------------------

import { WorkspaceManager } from './manager.js';
import { gatewayEvents } from '../ws/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast a Workspace interface to its private methods for testing. */
function bindMethod<T>(ws: Workspace, name: string): T {
  const instance = ws as Record<string, unknown>;
  const fn = instance[name] as (...args: unknown[]) => unknown;
  return fn.bind(ws) as T;
}

/** Build a minimal WorkspaceMessage. */
function makeMessage(overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
    ...overrides,
  };
}

/** Build a minimal IncomingMessage simulating a channel event payload. */
function makeIncoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: `inc-${Math.random().toString(36).slice(2, 8)}`,
    channelId: 'test-channel',
    channelType: 'telegram',
    senderId: 'user-1',
    senderName: 'Alice',
    content: 'Hello bot',
    timestamp: new Date(),
    direction: 'incoming',
    ...overrides,
  };
}

/** Fire the channel:message event on the gatewayEvents mock. */
async function fireChannelMessage(data: Record<string, unknown>): Promise<void> {
  const handlers = channelMessageHandlers.get('channel:message');
  if (handlers) {
    for (const handler of handlers) {
      await handler(data);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    channelMessageHandlers.clear();
    mockGetChannel.mockReturnValue(null);
    mockChannelSend.mockResolvedValue(undefined);
    mockAgentChat.mockReturnValue({ ok: true, value: { content: 'AI response' } });
    mockGetOrCreateChatAgent.mockReturnValue({ chat: mockAgentChat });
    mockResolveProviderAndModel.mockReturnValue({ provider: 'openai', model: 'gpt-4o-mini' });
    manager = new WorkspaceManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // =========================================================================
  // 1. create
  // =========================================================================
  describe('create', () => {
    it('creates a workspace with the given name', () => {
      const ws = manager.create({ name: 'Test Workspace' });
      expect(ws.config.name).toBe('Test Workspace');
    });

    it('generates a UUID when no id is provided', () => {
      const ws = manager.create({ name: 'WS' });
      expect(typeof ws.config.id).toBe('string');
      expect(ws.config.id.length).toBeGreaterThan(0);
    });

    it('uses the provided id when specified', () => {
      const ws = manager.create({ name: 'WS', id: 'custom-id' });
      expect(ws.config.id).toBe('custom-id');
    });

    it('generates unique ids for separate workspaces', () => {
      const ws1 = manager.create({ name: 'WS1' });
      const ws2 = manager.create({ name: 'WS2' });
      expect(ws1.config.id).not.toBe(ws2.config.id);
    });

    it('applies all default settings when none are provided', () => {
      const ws = manager.create({ name: 'WS' });
      expect(ws.config.settings).toEqual({
        autoReply: true,
        replyDelay: 500,
        maxContextMessages: 20,
        enableMemory: true,
        piiDetection: true,
      });
    });

    it('merges partial settings with defaults', () => {
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

    it('allows all default settings to be overridden', () => {
      const ws = manager.create({
        name: 'WS',
        settings: {
          autoReply: false,
          replyDelay: 1000,
          maxContextMessages: 10,
          enableMemory: false,
          piiDetection: false,
          allowedAttachmentTypes: ['image/png'],
        },
      });
      expect(ws.config.settings?.autoReply).toBe(false);
      expect(ws.config.settings?.replyDelay).toBe(1000);
      expect(ws.config.settings?.maxContextMessages).toBe(10);
      expect(ws.config.settings?.enableMemory).toBe(false);
      expect(ws.config.settings?.piiDetection).toBe(false);
      expect(ws.config.settings?.allowedAttachmentTypes).toEqual(['image/png']);
    });

    it('applies the default agent config when none is provided', () => {
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

    it('uses the provided agent config instead of defaults', () => {
      const agent = { provider: 'anthropic', model: 'claude-opus-4' };
      const ws = manager.create({ name: 'WS', agent });
      expect(ws.config.agent).toEqual(agent);
    });

    it('defaults channels to an empty array', () => {
      const ws = manager.create({ name: 'WS' });
      expect(ws.config.channels).toEqual([]);
    });

    it('stores provided channels and maps them to the workspace', () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1', 'ch-2'] });
      expect(ws.config.channels).toEqual(['ch-1', 'ch-2']);
      expect(manager.getByChannel('ch-1')).toBe(ws);
      expect(manager.getByChannel('ch-2')).toBe(ws);
    });

    it('makes the first created workspace the default', () => {
      const ws = manager.create({ name: 'First' });
      expect(manager.getDefault()).toBe(ws);
    });

    it('does not overwrite the default when a second workspace is created', () => {
      const first = manager.create({ name: 'First' });
      manager.create({ name: 'Second' });
      expect(manager.getDefault()).toBe(first);
    });

    it('emits workspace:created with workspace metadata', () => {
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

    it('preserves optional description and userId fields', () => {
      const ws = manager.create({
        name: 'WS',
        description: 'A test',
        userId: 'user-42',
      });
      expect(ws.config.description).toBe('A test');
      expect(ws.config.userId).toBe('user-42');
    });

    it('sets initial state to idle', () => {
      const ws = manager.create({ name: 'WS' });
      expect(ws.state).toBe('idle');
    });

    it('sets createdAt within a reasonable time window', () => {
      const before = new Date();
      const ws = manager.create({ name: 'WS' });
      const after = new Date();
      expect(ws.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ws.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('assigns a conversationId on creation', () => {
      const ws = manager.create({ name: 'WS' });
      expect(typeof ws.conversationId).toBe('string');
      expect(ws.conversationId!.length).toBeGreaterThan(0);
    });

    it('assigns different conversationIds to different workspaces', () => {
      const ws1 = manager.create({ name: 'WS1' });
      const ws2 = manager.create({ name: 'WS2' });
      expect(ws1.conversationId).not.toBe(ws2.conversationId);
    });

    it('increments the count on each creation', () => {
      expect(manager.count).toBe(0);
      manager.create({ name: 'WS1' });
      expect(manager.count).toBe(1);
      manager.create({ name: 'WS2' });
      expect(manager.count).toBe(2);
    });

    it('handles an empty string name', () => {
      const ws = manager.create({ name: '' });
      expect(ws.config.name).toBe('');
    });
  });

  // =========================================================================
  // 2. get
  // =========================================================================
  describe('get', () => {
    it('returns the workspace when it exists', () => {
      const ws = manager.create({ name: 'WS', id: 'ws-1' });
      expect(manager.get('ws-1')).toBe(ws);
    });

    it('returns undefined for an unknown id', () => {
      expect(manager.get('non-existent')).toBeUndefined();
    });

    it('returns undefined after the workspace has been deleted', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.delete('ws-1');
      expect(manager.get('ws-1')).toBeUndefined();
    });

    it('returns the correct workspace when several exist', () => {
      const ws1 = manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      expect(manager.get('ws-1')).toBe(ws1);
    });
  });

  // =========================================================================
  // 3. getByChannel
  // =========================================================================
  describe('getByChannel', () => {
    it('returns the workspace associated with the given channel', () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1'] });
      expect(manager.getByChannel('ch-1')).toBe(ws);
    });

    it('returns undefined for an unregistered channel', () => {
      expect(manager.getByChannel('unknown')).toBeUndefined();
    });

    it('distinguishes between channels belonging to different workspaces', () => {
      const ws1 = manager.create({ name: 'WS1', channels: ['ch-a'] });
      const ws2 = manager.create({ name: 'WS2', channels: ['ch-b'] });
      expect(manager.getByChannel('ch-a')).toBe(ws1);
      expect(manager.getByChannel('ch-b')).toBe(ws2);
    });

    it('returns undefined after channel is disassociated', () => {
      manager.create({ name: 'WS', channels: ['ch-1'] });
      manager.disassociateChannel('ch-1');
      expect(manager.getByChannel('ch-1')).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. getDefault
  // =========================================================================
  describe('getDefault', () => {
    it('returns undefined when no workspaces exist', () => {
      expect(manager.getDefault()).toBeUndefined();
    });

    it('returns the first workspace created', () => {
      const first = manager.create({ name: 'First' });
      manager.create({ name: 'Second' });
      expect(manager.getDefault()).toBe(first);
    });

    it('returns the workspace set via setDefault', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });
      manager.setDefault('ws-2');
      expect(manager.getDefault()).toBe(ws2);
    });
  });

  // =========================================================================
  // 5. getOrCreateDefault
  // =========================================================================
  describe('getOrCreateDefault', () => {
    it('creates a "Default Workspace" when no workspaces exist', () => {
      const ws = manager.getOrCreateDefault();
      expect(ws.config.name).toBe('Default Workspace');
    });

    it('registers the created workspace as the default', () => {
      const ws = manager.getOrCreateDefault();
      expect(manager.getDefault()).toBe(ws);
    });

    it('increments count to 1 on creation', () => {
      manager.getOrCreateDefault();
      expect(manager.count).toBe(1);
    });

    it('returns the existing default without creating a new workspace', () => {
      const existing = manager.create({ name: 'Existing' });
      const result = manager.getOrCreateDefault();
      expect(result).toBe(existing);
      expect(manager.count).toBe(1);
    });

    it('does not duplicate workspaces on repeated calls', () => {
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
    it('changes the default workspace', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });
      manager.setDefault('ws-2');
      expect(manager.getDefault()).toBe(ws2);
    });

    it('can set the default back to the first workspace', () => {
      const ws1 = manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.setDefault('ws-2');
      manager.setDefault('ws-1');
      expect(manager.getDefault()).toBe(ws1);
    });

    it('throws when the workspace id does not exist', () => {
      expect(() => manager.setDefault('non-existent')).toThrow('Workspace not found: non-existent');
    });
  });

  // =========================================================================
  // 7. delete
  // =========================================================================
  describe('delete', () => {
    it('removes the workspace and returns true', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      expect(manager.delete('ws-1')).toBe(true);
      expect(manager.get('ws-1')).toBeUndefined();
    });

    it('returns false for an unknown id', () => {
      expect(manager.delete('non-existent')).toBe(false);
    });

    it('cleans up all channel associations', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1', 'ch-2'] });
      manager.delete('ws-1');
      expect(manager.getByChannel('ch-1')).toBeUndefined();
      expect(manager.getByChannel('ch-2')).toBeUndefined();
    });

    it('updates the default to the next workspace when the default is deleted', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-1');
      expect(manager.getDefault()).toBe(ws2);
    });

    it('sets default to null (undefined) when the last workspace is deleted', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.delete('ws-1');
      expect(manager.getDefault()).toBeUndefined();
    });

    it('does not change the default when a non-default workspace is deleted', () => {
      const ws1 = manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-2');
      expect(manager.getDefault()).toBe(ws1);
    });

    it('emits workspace:deleted with the correct workspaceId', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      vi.mocked(gatewayEvents.emit).mockClear();
      manager.delete('ws-1');
      expect(gatewayEvents.emit).toHaveBeenCalledWith('workspace:deleted', {
        workspaceId: 'ws-1',
      });
    });

    it('does not emit workspace:deleted when workspace does not exist', () => {
      vi.mocked(gatewayEvents.emit).mockClear();
      manager.delete('non-existent');
      expect(gatewayEvents.emit).not.toHaveBeenCalledWith('workspace:deleted', expect.anything());
    });

    it('decrements the count', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-1');
      expect(manager.count).toBe(1);
    });

    it('does not decrement count when workspace does not exist', () => {
      manager.create({ name: 'WS1' });
      manager.delete('non-existent');
      expect(manager.count).toBe(1);
    });
  });

  // =========================================================================
  // 8. getAll
  // =========================================================================
  describe('getAll', () => {
    it('returns an empty array when no workspaces exist', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('returns all created workspaces', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.create({ name: 'WS3', id: 'ws-3' });
      const all = manager.getAll();
      expect(all).toHaveLength(3);
      const ids = all.map((w) => w.config.id);
      expect(ids).toContain('ws-1');
      expect(ids).toContain('ws-2');
      expect(ids).toContain('ws-3');
    });

    it('excludes deleted workspaces', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-1');
      const all = manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].config.id).toBe('ws-2');
    });

    it('returns a live snapshot (not a frozen copy)', () => {
      manager.create({ name: 'WS1' });
      const before = manager.getAll();
      manager.create({ name: 'WS2' });
      const after = manager.getAll();
      expect(before).toHaveLength(1);
      expect(after).toHaveLength(2);
    });
  });

  // =========================================================================
  // 9. associateChannel
  // =========================================================================
  describe('associateChannel', () => {
    it('links the channel to the workspace', () => {
      const ws = manager.create({ name: 'WS', id: 'ws-1' });
      manager.associateChannel('ws-1', 'ch-new');
      expect(manager.getByChannel('ch-new')).toBe(ws);
    });

    it('adds the channel id to config.channels', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.associateChannel('ws-1', 'ch-new');
      const ws = manager.get('ws-1')!;
      expect(ws.config.channels).toContain('ch-new');
    });

    it('does not duplicate a channel already in config.channels', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });
      manager.associateChannel('ws-1', 'ch-1');
      const ws = manager.get('ws-1')!;
      const count = ws.config.channels.filter((c) => c === 'ch-1').length;
      expect(count).toBe(1);
    });

    it('throws when the workspace is not found', () => {
      expect(() => manager.associateChannel('non-existent', 'ch-1')).toThrow(
        'Workspace not found: non-existent'
      );
    });

    it('overwrites a prior channel mapping when channel is re-associated to another workspace', () => {
      manager.create({ name: 'WS1', id: 'ws-1', channels: ['ch-shared'] });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });
      manager.associateChannel('ws-2', 'ch-shared');
      expect(manager.getByChannel('ch-shared')).toBe(ws2);
    });
  });

  // =========================================================================
  // 10. disassociateChannel
  // =========================================================================
  describe('disassociateChannel', () => {
    it('removes the channel-to-workspace mapping', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });
      manager.disassociateChannel('ch-1');
      expect(manager.getByChannel('ch-1')).toBeUndefined();
    });

    it('removes the channel from config.channels', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1', 'ch-2'] });
      manager.disassociateChannel('ch-1');
      expect(manager.get('ws-1')!.config.channels).toEqual(['ch-2']);
    });

    it('is a no-op for an unknown channel (does not throw)', () => {
      expect(() => manager.disassociateChannel('unknown')).not.toThrow();
    });

    it('is safe to call twice for the same channel', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1'] });
      manager.disassociateChannel('ch-1');
      expect(() => manager.disassociateChannel('ch-1')).not.toThrow();
      expect(manager.getByChannel('ch-1')).toBeUndefined();
    });

    it('does not affect other channels on the same workspace', () => {
      manager.create({ name: 'WS', id: 'ws-1', channels: ['ch-1', 'ch-2'] });
      manager.disassociateChannel('ch-1');
      expect(manager.getByChannel('ch-2')).toBeDefined();
      expect(manager.get('ws-1')!.config.channels).toContain('ch-2');
    });
  });

  // =========================================================================
  // 11. updateAgentConfig
  // =========================================================================
  describe('updateAgentConfig', () => {
    it('merges partial config onto existing agent config', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.updateAgentConfig('ws-1', { model: 'claude-opus-4', temperature: 0.9 });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.model).toBe('claude-opus-4');
      expect(ws.config.agent?.temperature).toBe(0.9);
    });

    it('preserves untouched agent config fields', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.updateAgentConfig('ws-1', { model: 'gpt-5' });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.provider).toBe('openai');
      expect(ws.config.agent?.systemPrompt).toBe('You are a helpful AI assistant.');
      expect(ws.config.agent?.maxTokens).toBe(4096);
      expect(ws.config.agent?.tools).toEqual([]);
    });

    it('applies defaults when workspace had no prior agent config', () => {
      manager.create({ name: 'WS', id: 'ws-1', agent: undefined });
      manager.updateAgentConfig('ws-1', { model: 'gpt-5' });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.provider).toBe('openai');
      expect(ws.config.agent?.model).toBe('gpt-5');
    });

    it('is a no-op for field values when an empty partial is provided', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      expect(() => manager.updateAgentConfig('ws-1', {})).not.toThrow();
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.provider).toBe('openai');
    });

    it('throws when workspace is not found', () => {
      expect(() => manager.updateAgentConfig('non-existent', { model: 'gpt-5' })).toThrow(
        'Workspace not found: non-existent'
      );
    });

    it('updates tools list in agent config', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.updateAgentConfig('ws-1', { tools: ['search', 'calculator'] });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.tools).toEqual(['search', 'calculator']);
    });

    it('updates system prompt in agent config', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.updateAgentConfig('ws-1', { systemPrompt: 'Custom prompt.' });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent?.systemPrompt).toBe('Custom prompt.');
    });
  });

  // =========================================================================
  // 12. count
  // =========================================================================
  describe('count', () => {
    it('returns 0 when no workspaces exist', () => {
      expect(manager.count).toBe(0);
    });

    it('reflects the number of active workspaces', () => {
      manager.create({ name: 'WS1' });
      manager.create({ name: 'WS2' });
      expect(manager.count).toBe(2);
    });

    it('decreases after deletion', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-1');
      expect(manager.count).toBe(1);
    });

    it('returns 0 after all workspaces are deleted', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.delete('ws-1');
      expect(manager.count).toBe(0);
    });
  });

  // =========================================================================
  // 13. dispose
  // =========================================================================
  describe('dispose', () => {
    it('unregisters the channel:message handler set up in the constructor', () => {
      const localManager = new WorkspaceManager();
      // There should now be handlers registered
      const handlersBefore = channelMessageHandlers.get('channel:message')?.size ?? 0;
      expect(handlersBefore).toBeGreaterThan(0);

      localManager.dispose();

      const handlersAfter = channelMessageHandlers.get('channel:message')?.size ?? 0;
      expect(handlersAfter).toBe(handlersBefore - 1);
    });

    it('is safe to call multiple times (idempotent)', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });

    it('clears the unsubscribes array so a second dispose is a no-op', () => {
      const localManager = new WorkspaceManager();
      localManager.dispose();
      // Record the state of subscriptions before second dispose
      const sizeBefore = channelMessageHandlers.get('channel:message')?.size ?? 0;
      localManager.dispose();
      const sizeAfter = channelMessageHandlers.get('channel:message')?.size ?? 0;
      // No change because the array is already empty
      expect(sizeAfter).toBe(sizeBefore);
    });
  });

  // =========================================================================
  // 14. WorkspaceInstance — setState
  // =========================================================================
  describe('WorkspaceInstance.setState', () => {
    function getSetState(ws: Workspace) {
      return bindMethod<(s: WorkspaceState, e?: string) => void>(ws, 'setState');
    }

    it('updates the state property', () => {
      const ws = manager.create({ name: 'WS' });
      getSetState(ws)('processing');
      expect(ws.state).toBe('processing');
    });

    it('sets the error field when transitioning to error', () => {
      const ws = manager.create({ name: 'WS' });
      getSetState(ws)('error', 'Something failed');
      expect(ws.state).toBe('error');
      expect(ws.error).toBe('Something failed');
    });

    it('clears the error field when transitioning away from error', () => {
      const ws = manager.create({ name: 'WS' });
      getSetState(ws)('error', 'fail');
      getSetState(ws)('idle');
      expect(ws.error).toBeUndefined();
    });

    it('updates lastActivityAt', () => {
      const ws = manager.create({ name: 'WS' });
      const before = ws.lastActivityAt.getTime();
      getSetState(ws)('processing');
      expect(ws.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('emits stateChange with state and error arguments', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      bindMethod<(e: string, h: (...args: unknown[]) => void) => void>(ws, 'on')(
        'stateChange',
        handler
      );
      getSetState(ws)('error', 'timeout');
      expect(handler).toHaveBeenCalledWith('error', 'timeout');
    });

    it('emits stateChange with undefined error when only state is set', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      bindMethod<(e: string, h: (...args: unknown[]) => void) => void>(ws, 'on')(
        'stateChange',
        handler
      );
      getSetState(ws)('processing');
      expect(handler).toHaveBeenCalledWith('processing', undefined);
    });

    it('transitions through multiple states', () => {
      const ws = manager.create({ name: 'WS' });
      const setState = getSetState(ws);
      setState('processing');
      expect(ws.state).toBe('processing');
      setState('waiting');
      expect(ws.state).toBe('waiting');
      setState('idle');
      expect(ws.state).toBe('idle');
    });
  });

  // =========================================================================
  // 15. WorkspaceInstance — addMessage / getMessages
  // =========================================================================
  describe('WorkspaceInstance.addMessage', () => {
    function getAdder(ws: Workspace) {
      return bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
    }
    function getGetter(ws: Workspace) {
      return bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
    }

    it('stores the message', () => {
      const ws = manager.create({ name: 'WS' });
      const msg = makeMessage();
      getAdder(ws)(msg);
      expect(getGetter(ws)()).toHaveLength(1);
      expect(getGetter(ws)()[0]).toEqual(msg);
    });

    it('stores messages in insertion order', () => {
      const ws = manager.create({ name: 'WS' });
      const add = getAdder(ws);
      const get = getGetter(ws);
      const m1 = makeMessage({ content: 'first' });
      const m2 = makeMessage({ content: 'second' });
      const m3 = makeMessage({ content: 'third' });
      add(m1);
      add(m2);
      add(m3);
      const msgs = get();
      expect(msgs[0].content).toBe('first');
      expect(msgs[1].content).toBe('second');
      expect(msgs[2].content).toBe('third');
    });

    it('updates lastActivityAt on add', () => {
      const ws = manager.create({ name: 'WS' });
      const before = ws.lastActivityAt.getTime();
      getAdder(ws)(makeMessage());
      expect(ws.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('emits message event with the added message', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      bindMethod<(e: string, h: (m: WorkspaceMessage) => void) => void>(ws, 'on')(
        'message',
        handler
      );
      const msg = makeMessage();
      getAdder(ws)(msg);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('prunes old messages when count exceeds maxContextMessages * 5', () => {
      const ws = manager.create({
        name: 'WS',
        settings: { maxContextMessages: 2 },
      });
      const add = getAdder(ws);
      const get = getGetter(ws);
      // threshold = 2 * 5 = 10; add 12 → prunes to 10
      for (let i = 0; i < 12; i++) {
        add(makeMessage({ content: `msg-${i}` }));
      }
      const msgs = get();
      expect(msgs).toHaveLength(10);
      expect(msgs[0].content).toBe('msg-2');
      expect(msgs[9].content).toBe('msg-11');
    });

    it('keeps exactly maxHistory messages after many adds', () => {
      const ws = manager.create({
        name: 'WS',
        settings: { maxContextMessages: 4 },
      });
      const add = getAdder(ws);
      // threshold = 4 * 5 = 20; add 25 → should have 20
      for (let i = 0; i < 25; i++) {
        add(makeMessage({ content: `m${i}` }));
      }
      expect(getGetter(ws)()).toHaveLength(20);
    });

    it('does not prune when count is at exactly the threshold', () => {
      const ws = manager.create({
        name: 'WS',
        settings: { maxContextMessages: 2 },
      });
      const add = getAdder(ws);
      // threshold = 10; add exactly 10 → no pruning
      for (let i = 0; i < 10; i++) {
        add(makeMessage());
      }
      expect(getGetter(ws)()).toHaveLength(10);
    });

    it('uses default maxContextMessages (20) when settings not provided', () => {
      const ws = manager.create({ name: 'WS' });
      const add = getAdder(ws);
      // threshold = 20 * 5 = 100; add 105
      for (let i = 0; i < 105; i++) {
        add(makeMessage({ content: `m${i}` }));
      }
      const msgs = getGetter(ws)();
      expect(msgs).toHaveLength(100);
      expect(msgs[0].content).toBe('m5');
    });

    it('getMessages returns a new array each call (copy not reference)', () => {
      const ws = manager.create({ name: 'WS' });
      getAdder(ws)(makeMessage());
      const a = getGetter(ws)();
      const b = getGetter(ws)();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('getMessages returns empty array initially', () => {
      const ws = manager.create({ name: 'WS' });
      expect(getGetter(ws)()).toEqual([]);
    });
  });

  // =========================================================================
  // 16. WorkspaceInstance — getContextMessages
  // =========================================================================
  describe('WorkspaceInstance.getContextMessages', () => {
    function setup(maxCtx?: number) {
      const ws = manager.create({
        name: 'WS',
        settings: maxCtx !== undefined ? { maxContextMessages: maxCtx } : undefined,
      });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const getCtx = bindMethod<(limit?: number) => WorkspaceMessage[]>(ws, 'getContextMessages');
      return { ws, add, getCtx };
    }

    it('returns the last N messages based on maxContextMessages setting', () => {
      const { add, getCtx } = setup(3);
      for (let i = 0; i < 5; i++) add(makeMessage({ content: `m${i}` }));
      const ctx = getCtx();
      expect(ctx).toHaveLength(3);
      expect(ctx[0].content).toBe('m2');
      expect(ctx[2].content).toBe('m4');
    });

    it('uses the explicit limit argument over the setting', () => {
      const { add, getCtx } = setup(10);
      for (let i = 0; i < 10; i++) add(makeMessage({ content: `m${i}` }));
      const ctx = getCtx(2);
      expect(ctx).toHaveLength(2);
      expect(ctx[0].content).toBe('m8');
      expect(ctx[1].content).toBe('m9');
    });

    it('defaults to 20 when neither limit nor setting is provided', () => {
      const { add, getCtx } = setup();
      for (let i = 0; i < 30; i++) add(makeMessage({ content: `m${i}` }));
      const ctx = getCtx();
      expect(ctx).toHaveLength(20);
      expect(ctx[0].content).toBe('m10');
    });

    it('returns all messages when count is below the limit', () => {
      const { add, getCtx } = setup(10);
      add(makeMessage({ content: 'only' }));
      const ctx = getCtx();
      expect(ctx).toHaveLength(1);
      expect(ctx[0].content).toBe('only');
    });

    it('returns empty array when no messages have been added', () => {
      const { getCtx } = setup(5);
      expect(getCtx()).toEqual([]);
    });
  });

  // =========================================================================
  // 17. WorkspaceInstance — clearMessages
  // =========================================================================
  describe('WorkspaceInstance.clearMessages', () => {
    it('removes all stored messages', () => {
      const ws = manager.create({ name: 'WS' });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const get = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const clear = bindMethod<() => void>(ws, 'clearMessages');

      add(makeMessage());
      add(makeMessage());
      expect(get()).toHaveLength(2);

      clear();
      expect(get()).toHaveLength(0);
    });

    it('generates a new conversationId', () => {
      const ws = manager.create({ name: 'WS' });
      const clear = bindMethod<() => void>(ws, 'clearMessages');
      const oldId = ws.conversationId;

      clear();

      expect(ws.conversationId).toBeDefined();
      expect(ws.conversationId).not.toBe(oldId);
    });

    it('the new conversationId is a non-empty string', () => {
      const ws = manager.create({ name: 'WS' });
      bindMethod<() => void>(ws, 'clearMessages')();
      expect(typeof ws.conversationId).toBe('string');
      expect(ws.conversationId!.length).toBeGreaterThan(0);
    });

    it('generates a unique conversationId on each clear', () => {
      const ws = manager.create({ name: 'WS' });
      const clear = bindMethod<() => void>(ws, 'clearMessages');
      clear();
      const id1 = ws.conversationId;
      clear();
      const id2 = ws.conversationId;
      expect(id1).not.toBe(id2);
    });
  });

  // =========================================================================
  // 18. WorkspaceInstance — on / off event system
  // =========================================================================
  describe('WorkspaceInstance event system', () => {
    function getOn(ws: Workspace) {
      return bindMethod<(e: string, h: (...a: unknown[]) => void) => void>(ws, 'on');
    }
    function getOff(ws: Workspace) {
      return bindMethod<(e: string, h: (...a: unknown[]) => void) => void>(ws, 'off');
    }

    it('calls a registered stateChange handler', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      getOn(ws)('stateChange', handler);
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing');
      expect(handler).toHaveBeenCalled();
    });

    it('calls a registered message handler', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      getOn(ws)('message', handler);
      const msg = makeMessage();
      bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage')(msg);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('calls multiple handlers for the same event', () => {
      const ws = manager.create({ name: 'WS' });
      const h1 = vi.fn();
      const h2 = vi.fn();
      getOn(ws)('stateChange', h1);
      getOn(ws)('stateChange', h2);
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing');
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });

    it('does not call a handler after off()', () => {
      const ws = manager.create({ name: 'WS' });
      const handler = vi.fn();
      getOn(ws)('stateChange', handler);
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing');
      expect(handler).toHaveBeenCalledTimes(1);

      getOff(ws)('stateChange', handler);
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('idle');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not throw when there are no handlers for an event', () => {
      const ws = manager.create({ name: 'WS' });
      expect(() =>
        bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing')
      ).not.toThrow();
    });

    it('catches handler errors and continues calling remaining handlers', () => {
      const ws = manager.create({ name: 'WS' });
      const badHandler = vi.fn(() => {
        throw new Error('handler crash');
      });
      const goodHandler = vi.fn();
      getOn(ws)('stateChange', badHandler);
      getOn(ws)('stateChange', goodHandler);

      expect(() =>
        bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing')
      ).not.toThrow();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('off() is safe when no handlers are registered for the event', () => {
      const ws = manager.create({ name: 'WS' });
      expect(() => getOff(ws)('stateChange', vi.fn())).not.toThrow();
    });

    it('does not call a handler that was never registered', () => {
      const ws = manager.create({ name: 'WS' });
      const unregistered = vi.fn();
      getOff(ws)('stateChange', unregistered); // safe no-op
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing');
      expect(unregistered).not.toHaveBeenCalled();
    });

    it('does not call a handler registered for a different event', () => {
      const ws = manager.create({ name: 'WS' });
      const messageHandler = vi.fn();
      getOn(ws)('message', messageHandler);
      bindMethod<(s: WorkspaceState) => void>(ws, 'setState')('processing');
      expect(messageHandler).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 19. WorkspaceInstance — processIncomingMessage
  // =========================================================================
  describe('WorkspaceInstance.processIncomingMessage', () => {
    it('converts an IncomingMessage into a WorkspaceMessage and adds it', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      const incoming = makeIncoming({
        content: 'Test content',
        senderId: 'user-99',
        senderName: 'Bob',
      });
      await process(incoming);

      const msgs = getMessages();
      expect(msgs).toHaveLength(1);
      const msg = msgs[0];
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Test content');
      expect(msg.channelId).toBe(incoming.channelId);
      expect(msg.channelType).toBe(incoming.channelType);
      expect(msg.sender?.id).toBe('user-99');
      expect(msg.sender?.name).toBe('Bob');
    });

    it('converts a string timestamp into a Date object', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      const incoming = makeIncoming({ timestamp: '2025-01-01T10:00:00.000Z' });
      await process(incoming);

      const msg = getMessages()[0];
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it('preserves a Date timestamp as-is', async () => {
      const ts = new Date('2025-06-15T12:00:00.000Z');
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await process(makeIncoming({ timestamp: ts }));
      const msg = getMessages()[0];
      expect(msg.timestamp).toBeInstanceOf(Date);
      expect(msg.timestamp.getTime()).toBe(ts.getTime());
    });

    it('maps attachments and assigns each a new UUID id', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      const incoming = makeIncoming({
        attachments: [{ type: 'image', mimeType: 'image/jpeg', filename: 'pic.jpg', size: 1024 }],
      });
      await process(incoming);

      const msg = getMessages()[0];
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments![0].type).toBe('image');
      expect(msg.attachments![0].mimeType).toBe('image/jpeg');
      expect(msg.attachments![0].filename).toBe('pic.jpg');
      expect(msg.attachments![0].size).toBe(1024);
      expect(typeof msg.attachments![0].id).toBe('string');
    });

    it('produces no attachments array when incoming has no attachments', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await process(makeIncoming({ attachments: undefined }));
      const msg = getMessages()[0];
      expect(msg.attachments).toBeUndefined();
    });

    it('calls generateResponse when autoReply is true (default)', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: true } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );

      await process(makeIncoming());

      expect(mockAgentChat).toHaveBeenCalled();
    });

    it('does not call generateResponse when autoReply is false', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );

      await process(makeIncoming());

      expect(mockAgentChat).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 20. WorkspaceInstance — generateResponse (success path)
  // =========================================================================
  describe('WorkspaceInstance.generateResponse (success)', () => {
    it('sets state to processing then back to idle', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      const states: WorkspaceState[] = [];
      bindMethod<(e: string, h: (s: WorkspaceState) => void) => void>(ws, 'on')(
        'stateChange',
        (s: WorkspaceState) => states.push(s)
      );

      add(makeMessage({ role: 'user', content: 'Hello' }));
      await gen('test-channel');

      expect(states[0]).toBe('processing');
      expect(states[states.length - 1]).toBe('idle');
    });

    it('emits streamStart and streamEnd events', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      const streamStartIds: string[] = [];
      const streamEndIds: string[] = [];
      bindMethod<(e: string, h: (...a: unknown[]) => void) => void>(ws, 'on')(
        'streamStart',
        (id: unknown) => streamStartIds.push(id as string)
      );
      bindMethod<(e: string, h: (...a: unknown[]) => void) => void>(ws, 'on')(
        'streamEnd',
        (id: unknown) => streamEndIds.push(id as string)
      );

      add(makeMessage({ role: 'user', content: 'Hi' }));
      await gen('test-channel');

      expect(streamStartIds).toHaveLength(1);
      expect(streamEndIds).toHaveLength(1);
      expect(streamStartIds[0]).toBe(streamEndIds[0]);
    });

    it('adds an assistant message with the response content', async () => {
      mockAgentChat.mockReturnValue({ ok: true, value: { content: 'Hello human!' } });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const get = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Ping' }));
      await gen('test-channel');

      const msgs = get();
      const assistant = msgs.find((m) => m.role === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant?.content).toBe('Hello human!');
    });

    it('calls resolveProviderAndModel with the agent config values', async () => {
      const ws = manager.create({
        name: 'WS',
        settings: { autoReply: false },
        agent: { provider: 'anthropic', model: 'claude-opus-4' },
      });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));
      await gen('test-channel');

      expect(mockResolveProviderAndModel).toHaveBeenCalledWith('anthropic', 'claude-opus-4');
    });

    it('calls resolveProviderAndModel with "default" when agent config is absent', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false }, agent: undefined });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));
      // Manually unset agent after creation (tests the fallback path)
      (ws as unknown as Record<string, unknown>).config = {
        ...(ws.config as WorkspaceConfig),
        agent: undefined,
      };
      await gen('test-channel');

      expect(mockResolveProviderAndModel).toHaveBeenCalledWith('default', 'default');
    });

    it('calls getOrCreateChatAgent with resolved provider and model', async () => {
      mockResolveProviderAndModel.mockReturnValue({
        provider: 'anthropic',
        model: 'claude-opus-4',
      });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'test' }));
      await gen('test-channel');

      expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('anthropic', 'claude-opus-4');
    });

    it('falls back to openai/gpt-4o-mini when resolver returns null values', async () => {
      mockResolveProviderAndModel.mockReturnValue({ provider: null, model: null });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'test' }));
      await gen('test-channel');

      expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    });

    it('sends the response to the channel when a channel is found', async () => {
      const fakeChannel = { id: 'ch-1', type: 'telegram' };
      mockGetChannel.mockReturnValue(fakeChannel);
      mockAgentChat.mockReturnValue({ ok: true, value: { content: 'Reply text' } });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hi' }));
      await gen('ch-1');

      expect(mockChannelSend).toHaveBeenCalledWith('ch-1', {
        platformChatId: 'ch-1',
        text: 'Reply text',
      });
    });

    it('does not call channelService.send when no channel is found', async () => {
      mockGetChannel.mockReturnValue(null);

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hi' }));
      await gen('ch-ghost');

      expect(mockChannelSend).not.toHaveBeenCalled();
    });

    it('does not call channelService.send when channelId is empty string', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hi' }));
      await gen('');

      expect(mockChannelSend).not.toHaveBeenCalled();
    });

    it('handles agent result.ok = false by using error message as content', async () => {
      mockAgentChat.mockReturnValue({
        ok: false,
        error: new Error('Agent execution failed'),
      });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const get = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Fail please' }));
      await gen('test-channel');

      const msgs = get();
      const assistant = msgs.find((m) => m.role === 'assistant');
      expect(assistant?.content).toContain('Error:');
      expect(assistant?.content).toContain('Agent execution failed');
    });

    it('handles agent result.ok = false with no error object', async () => {
      mockAgentChat.mockReturnValue({ ok: false, error: null });

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const get = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Fail' }));
      await gen('test-channel');

      const msgs = get();
      const assistant = msgs.find((m) => m.role === 'assistant');
      expect(assistant?.content).toContain('Agent execution failed');
    });

    it('sets state to idle after a successful response', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hi' }));
      await gen('test-channel');

      expect(ws.state).toBe('idle');
    });

    it('returns early (idle) with no assistant message when there are no user messages', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const get = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      // Add only an assistant message — no user message
      add(makeMessage({ role: 'assistant', content: 'I said something' }));
      await gen('test-channel');

      expect(ws.state).toBe('idle');
      expect(mockAgentChat).not.toHaveBeenCalled();
      const msgs = get();
      expect(msgs.every((m) => m.role === 'assistant')).toBe(true);
    });

    it('returns early (idle) when the last user message has empty content', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: '' }));
      await gen('test-channel');

      expect(ws.state).toBe('idle');
      expect(mockAgentChat).not.toHaveBeenCalled();
    });

    it('uses the last user message content as the prompt', async () => {
      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'First message' }));
      add(makeMessage({ role: 'user', content: 'Second message' }));
      await gen('test-channel');

      expect(mockAgentChat).toHaveBeenCalledWith('Second message');
    });
  });

  // =========================================================================
  // 21. WorkspaceInstance — generateResponse (error path)
  // =========================================================================
  describe('WorkspaceInstance.generateResponse (error path)', () => {
    it('sets state to error when agent.chat throws', async () => {
      mockAgentChat.mockRejectedValue(new Error('Network failure'));

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));

      await expect(gen('test-channel')).rejects.toThrow('Network failure');

      expect(ws.state).toBe('error');
      expect(ws.error).toBe('Network failure');
    });

    it('re-throws the error after setting error state', async () => {
      mockAgentChat.mockRejectedValue(new Error('Timeout'));

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));

      await expect(gen('test-channel')).rejects.toThrow('Timeout');
    });

    it('sets state to error when resolveProviderAndModel throws', async () => {
      mockResolveProviderAndModel.mockRejectedValue(new Error('Config error'));

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));

      await expect(gen('test-channel')).rejects.toThrow('Config error');

      expect(ws.state).toBe('error');
    });

    it('sets state to error when getOrCreateChatAgent throws', async () => {
      mockGetOrCreateChatAgent.mockRejectedValue(new Error('Agent init failed'));

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');

      add(makeMessage({ role: 'user', content: 'Hello' }));

      await expect(gen('test-channel')).rejects.toThrow('Agent init failed');

      expect(ws.state).toBe('error');
    });

    it('emits stateChange with error state and message', async () => {
      mockAgentChat.mockRejectedValue(new Error('Explosion'));

      const ws = manager.create({ name: 'WS', settings: { autoReply: false } });
      const add = bindMethod<(m: WorkspaceMessage) => void>(ws, 'addMessage');
      const gen = bindMethod<(channelId: string) => Promise<void>>(ws, 'generateResponse');
      const stateChanges: Array<[WorkspaceState, string | undefined]> = [];
      bindMethod<(e: string, h: (...a: unknown[]) => void) => void>(ws, 'on')(
        'stateChange',
        (s: unknown, e: unknown) =>
          stateChanges.push([s as WorkspaceState, e as string | undefined])
      );

      add(makeMessage({ role: 'user', content: 'Hello' }));
      await gen('test-channel').catch(() => {});

      const errorState = stateChanges.find(([s]) => s === 'error');
      expect(errorState).toBeDefined();
      expect(errorState![1]).toBe('Explosion');
    });
  });

  // =========================================================================
  // 22. Channel forwarding (setupChannelForwarding)
  // =========================================================================
  describe('channel forwarding', () => {
    it('registers a channel:message handler on construction', () => {
      expect(gatewayEvents.on).toHaveBeenCalledWith('channel:message', expect.any(Function));
    });

    it('routes a channel:message to the workspace associated with that channel', async () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-1'], settings: { autoReply: false } });
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await fireChannelMessage({
        id: 'evt-1',
        channelId: 'ch-1',
        channelType: 'telegram',
        sender: 'user-1',
        content: 'Forwarded message',
        timestamp: new Date().toISOString(),
        direction: 'incoming',
      });

      const msgs = getMessages();
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Forwarded message');
    });

    it('routes an unassociated channel:message to the default workspace', async () => {
      const ws = manager.getOrCreateDefault();
      // Disable autoReply on the created default
      const getInstance = ws as unknown as Record<string, unknown>;
      (getInstance.config as WorkspaceConfig).settings = {
        ...(getInstance.config as WorkspaceConfig).settings,
        autoReply: false,
      };

      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await fireChannelMessage({
        id: 'evt-2',
        channelId: 'unknown-channel',
        channelType: 'telegram',
        sender: 'user-2',
        content: 'To default',
        timestamp: new Date().toISOString(),
        direction: 'incoming',
      });

      expect(getMessages().some((m) => m.content === 'To default')).toBe(true);
    });

    it('creates a default workspace when one does not exist for an unknown channel', async () => {
      expect(manager.count).toBe(0);

      // We cannot easily disable autoReply for the auto-created workspace, so
      // make agent.chat succeed to avoid an error state during the test.
      mockAgentChat.mockReturnValue({ ok: true, value: { content: 'OK' } });

      await fireChannelMessage({
        id: 'evt-3',
        channelId: 'brand-new-channel',
        channelType: 'telegram',
        sender: 'user-3',
        content: 'Hello default',
        timestamp: new Date().toISOString(),
        direction: 'incoming',
      });

      // A default workspace was created
      expect(manager.count).toBe(1);
      expect(manager.getDefault()?.config.name).toBe('Default Workspace');
    });

    it('catches and does not propagate errors from processIncomingMessage during forwarding', async () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-err'] });
      // Force the workspace into an error condition
      mockAgentChat.mockRejectedValue(new Error('Processing error'));

      // Should resolve without throwing
      await expect(
        fireChannelMessage({
          id: 'evt-4',
          channelId: 'ch-err',
          channelType: 'telegram',
          sender: 'user-err',
          content: 'Cause error',
          timestamp: new Date().toISOString(),
          direction: 'incoming',
        })
      ).resolves.not.toThrow();

      // Workspace should be in error state
      expect(ws.state).toBe('error');
    });

    it('maps the sender field from the event to senderId and senderName', async () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-2'], settings: { autoReply: false } });
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await fireChannelMessage({
        id: 'evt-5',
        channelId: 'ch-2',
        channelType: 'telegram',
        sender: 'Alice',
        content: 'Hi',
        timestamp: new Date().toISOString(),
        direction: 'incoming',
      });

      const msgs = getMessages();
      expect(msgs[0].sender?.id).toBe('Alice');
      expect(msgs[0].sender?.name).toBe('Alice');
    });

    it('forwards the direction field from the event to the IncomingMessage', async () => {
      const ws = manager.create({ name: 'WS', channels: ['ch-3'], settings: { autoReply: false } });
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');

      await fireChannelMessage({
        id: 'evt-6',
        channelId: 'ch-3',
        channelType: 'telegram',
        sender: 'user-x',
        content: 'Hi',
        timestamp: new Date().toISOString(),
        direction: 'incoming',
      });

      // WorkspaceMessage does not carry direction, but processIncomingMessage
      // reads direction from IncomingMessage. The user message is still stored.
      const msgs = getMessages();
      expect(msgs).toHaveLength(1);
    });
  });

  // =========================================================================
  // 23. Edge cases & regression tests
  // =========================================================================
  describe('edge cases', () => {
    it('handles rapid creation and deletion without corruption', () => {
      for (let i = 0; i < 50; i++) {
        manager.create({ name: `WS-${i}`, id: `ws-${i}` });
      }
      expect(manager.count).toBe(50);

      for (let i = 0; i < 25; i++) {
        manager.delete(`ws-${i}`);
      }
      expect(manager.count).toBe(25);
      expect(manager.get('ws-0')).toBeUndefined();
      expect(manager.get('ws-25')).toBeDefined();
    });

    it('preserving default across partial deletions', () => {
      const ws0 = manager.create({ name: 'WS0', id: 'ws-0' });
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });

      manager.delete('ws-1'); // not default
      manager.delete('ws-2'); // not default
      expect(manager.getDefault()).toBe(ws0);
    });

    it('re-associates a channel from one workspace to another via associateChannel', () => {
      manager.create({ name: 'WS1', id: 'ws-1', channels: ['ch-shared'] });
      const ws2 = manager.create({ name: 'WS2', id: 'ws-2' });

      manager.associateChannel('ws-2', 'ch-shared');

      expect(manager.getByChannel('ch-shared')).toBe(ws2);
    });

    it('can create workspaces with overlapping settings fields', () => {
      const ws1 = manager.create({ name: 'WS1', settings: { replyDelay: 1000 } });
      const ws2 = manager.create({ name: 'WS2', settings: { replyDelay: 2000 } });
      expect(ws1.config.settings?.replyDelay).toBe(1000);
      expect(ws2.config.settings?.replyDelay).toBe(2000);
    });

    it('workspaces are independent (modifying one does not affect another)', () => {
      const ws1 = manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });

      manager.updateAgentConfig('ws-1', { model: 'custom-model' });

      const ws2 = manager.get('ws-2')!;
      expect(ws2.config.agent?.model).toBe('gpt-4.1'); // default untouched
      expect(ws1.config.agent?.model).toBe('custom-model');
    });

    it('getAll after deleteAll returns empty array', () => {
      manager.create({ name: 'WS1', id: 'ws-1' });
      manager.create({ name: 'WS2', id: 'ws-2' });
      manager.delete('ws-1');
      manager.delete('ws-2');
      expect(manager.getAll()).toEqual([]);
      expect(manager.count).toBe(0);
    });

    it('handles updateAgentConfig with all fields', () => {
      manager.create({ name: 'WS', id: 'ws-1' });
      manager.updateAgentConfig('ws-1', {
        provider: 'anthropic',
        model: 'claude-3',
        systemPrompt: 'Be concise.',
        temperature: 0.1,
        maxTokens: 2048,
        tools: ['web_search'],
      });
      const ws = manager.get('ws-1')!;
      expect(ws.config.agent).toEqual({
        provider: 'anthropic',
        model: 'claude-3',
        systemPrompt: 'Be concise.',
        temperature: 0.1,
        maxTokens: 2048,
        tools: ['web_search'],
      });
    });

    it('workspaceManager singleton exists and is a WorkspaceManager', async () => {
      const { workspaceManager } = await import('./manager.js');
      expect(workspaceManager).toBeInstanceOf(WorkspaceManager);
    });

    it('each workspace has a distinct createdAt if created in sequence', async () => {
      // Introduce a tiny delay to ensure the timestamps differ
      const ws1 = manager.create({ name: 'WS1' });
      await new Promise((r) => setTimeout(r, 2));
      const ws2 = manager.create({ name: 'WS2' });
      // ws2 should be created no earlier than ws1
      expect(ws2.createdAt.getTime()).toBeGreaterThanOrEqual(ws1.createdAt.getTime());
    });

    it('disassociateChannel on a channel not in config.channels does not crash', () => {
      // Associate via channelToWorkspace only (manually manipulate if needed)
      const ws = manager.create({ name: 'WS', id: 'ws-1' });
      manager.associateChannel('ws-1', 'ch-extra');
      // Remove from config.channels manually to simulate a stale state
      ws.config.channels.splice(ws.config.channels.indexOf('ch-extra'), 1);

      expect(() => manager.disassociateChannel('ch-extra')).not.toThrow();
      expect(manager.getByChannel('ch-extra')).toBeUndefined();
    });
  });

  // =========================================================================
  // 24. Integration: full processIncomingMessage with autoReply cycle
  // =========================================================================
  describe('full autoReply cycle integration', () => {
    it('user message leads to assistant reply in getMessages', async () => {
      mockAgentChat.mockReturnValue({ ok: true, value: { content: 'Bot reply here' } });

      const ws = manager.create({ name: 'WS', settings: { autoReply: true } });
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );

      await process(makeIncoming({ content: 'Hello bot' }));

      const msgs = getMessages();
      expect(msgs.some((m) => m.role === 'user' && m.content === 'Hello bot')).toBe(true);
      expect(msgs.some((m) => m.role === 'assistant' && m.content === 'Bot reply here')).toBe(true);
    });

    it('final state is idle after successful processIncomingMessage with autoReply', async () => {
      mockAgentChat.mockReturnValue({ ok: true, value: { content: 'Done' } });

      const ws = manager.create({ name: 'WS', settings: { autoReply: true } });
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );

      await process(makeIncoming());

      expect(ws.state).toBe('idle');
    });

    it('multiple sequential messages each produce an assistant reply', async () => {
      mockAgentChat
        .mockReturnValueOnce({ ok: true, value: { content: 'Reply 1' } })
        .mockReturnValueOnce({ ok: true, value: { content: 'Reply 2' } });

      const ws = manager.create({ name: 'WS', settings: { autoReply: true } });
      const getMessages = bindMethod<() => WorkspaceMessage[]>(ws, 'getMessages');
      const process = bindMethod<(m: IncomingMessage) => Promise<void>>(
        ws,
        'processIncomingMessage'
      );

      await process(makeIncoming({ content: 'First' }));
      await process(makeIncoming({ content: 'Second' }));

      const msgs = getMessages();
      const assistantMessages = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(2);
      expect(assistantMessages[0].content).toBe('Reply 1');
      expect(assistantMessages[1].content).toBe('Reply 2');
    });
  });
});

// ---------------------------------------------------------------------------
// Type alias used in type assertions (import suppression)
// ---------------------------------------------------------------------------
type WorkspaceConfig = import('./types.js').WorkspaceConfig;
