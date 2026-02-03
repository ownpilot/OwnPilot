/**
 * WorkspaceServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Workspace, WorkspaceConfig, WorkspaceState } from '../workspace/types.js';

// vi.hoisted ensures mockManager is available when vi.mock is hoisted
const mockManager = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  getByChannel: vi.fn(),
  getDefault: vi.fn(),
  getOrCreateDefault: vi.fn(),
  setDefault: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn(),
  associateChannel: vi.fn(),
  disassociateChannel: vi.fn(),
  updateAgentConfig: vi.fn(),
  count: 0,
  dispose: vi.fn(),
}));

vi.mock('../workspace/manager.js', () => ({
  workspaceManager: mockManager,
}));

// Must import after vi.mock
import { WorkspaceServiceImpl } from './workspace-service-impl.js';

// Create a mock workspace that matches the Workspace interface
function createMockWorkspace(overrides: Partial<WorkspaceConfig> = {}): Workspace {
  const config: WorkspaceConfig = {
    id: 'ws-1',
    name: 'Test Workspace',
    channels: [],
    ...overrides,
  };

  return {
    config,
    state: 'idle' as WorkspaceState,
    conversationId: 'conv-1',
    createdAt: new Date('2024-01-01'),
    lastActivityAt: new Date('2024-01-01'),
  };
}

describe('WorkspaceServiceImpl', () => {
  let service: WorkspaceServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.count = 0;
    service = new WorkspaceServiceImpl();
  });

  describe('create', () => {
    it('creates a workspace and returns WorkspaceInfo', () => {
      const mockWs = createMockWorkspace({ id: 'ws-new', name: 'My Workspace' });
      mockManager.create.mockReturnValue(mockWs);

      const result = service.create({ name: 'My Workspace' });

      expect(result.id).toBe('ws-new');
      expect(result.name).toBe('My Workspace');
      expect(result.state).toBe('idle');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('passes agent config to manager', () => {
      mockManager.create.mockReturnValue(createMockWorkspace());

      service.create({
        name: 'Test',
        agent: {
          provider: 'anthropic',
          model: 'claude-3',
          temperature: 0.5,
        },
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test',
          agent: expect.objectContaining({
            provider: 'anthropic',
            model: 'claude-3',
            temperature: 0.5,
          }),
        }),
      );
    });

    it('passes optional fields', () => {
      mockManager.create.mockReturnValue(
        createMockWorkspace({ description: 'A workspace', userId: 'user-1' }),
      );

      service.create({
        name: 'Test',
        id: 'custom-id',
        description: 'A workspace',
        userId: 'user-1',
        channels: ['ch-1'],
      });

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-id',
          description: 'A workspace',
          userId: 'user-1',
          channels: ['ch-1'],
        }),
      );
    });
  });

  describe('get', () => {
    it('returns workspace info by ID', () => {
      mockManager.get.mockReturnValue(createMockWorkspace());

      const result = service.get('ws-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('ws-1');
    });

    it('returns undefined for unknown ID', () => {
      mockManager.get.mockReturnValue(undefined);
      expect(service.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getByChannel', () => {
    it('finds workspace by channel ID', () => {
      mockManager.getByChannel.mockReturnValue(
        createMockWorkspace({ channels: ['ch-1'] }),
      );

      const result = service.getByChannel('ch-1');
      expect(result).toBeDefined();
      expect(result!.channels).toContain('ch-1');
    });

    it('returns undefined when no workspace for channel', () => {
      mockManager.getByChannel.mockReturnValue(undefined);
      expect(service.getByChannel('unknown')).toBeUndefined();
    });
  });

  describe('getDefault', () => {
    it('returns default workspace', () => {
      mockManager.getDefault.mockReturnValue(createMockWorkspace({ name: 'Default' }));

      const result = service.getDefault();
      expect(result).toBeDefined();
      expect(result!.name).toBe('Default');
    });

    it('returns undefined when no default', () => {
      mockManager.getDefault.mockReturnValue(undefined);
      expect(service.getDefault()).toBeUndefined();
    });
  });

  describe('getOrCreateDefault', () => {
    it('returns or creates default workspace', () => {
      mockManager.getOrCreateDefault.mockReturnValue(
        createMockWorkspace({ name: 'Default Workspace' }),
      );

      const result = service.getOrCreateDefault();
      expect(result.name).toBe('Default Workspace');
    });
  });

  describe('setDefault', () => {
    it('delegates to manager', () => {
      service.setDefault('ws-1');
      expect(mockManager.setDefault).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('delete', () => {
    it('deletes a workspace', () => {
      mockManager.delete.mockReturnValue(true);
      expect(service.delete('ws-1')).toBe(true);
    });

    it('returns false for unknown workspace', () => {
      mockManager.delete.mockReturnValue(false);
      expect(service.delete('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all workspaces as WorkspaceInfo', () => {
      mockManager.getAll.mockReturnValue([
        createMockWorkspace({ id: 'ws-1', name: 'First' }),
        createMockWorkspace({ id: 'ws-2', name: 'Second' }),
      ]);

      const result = service.getAll();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ws-1');
      expect(result[1].id).toBe('ws-2');
    });
  });

  describe('associateChannel', () => {
    it('delegates to manager', () => {
      service.associateChannel('ws-1', 'ch-1');
      expect(mockManager.associateChannel).toHaveBeenCalledWith('ws-1', 'ch-1');
    });
  });

  describe('disassociateChannel', () => {
    it('delegates to manager', () => {
      service.disassociateChannel('ch-1');
      expect(mockManager.disassociateChannel).toHaveBeenCalledWith('ch-1');
    });
  });

  describe('updateAgentConfig', () => {
    it('delegates to manager', () => {
      service.updateAgentConfig('ws-1', { provider: 'anthropic', model: 'claude-3' });
      expect(mockManager.updateAgentConfig).toHaveBeenCalledWith('ws-1', {
        provider: 'anthropic',
        model: 'claude-3',
      });
    });
  });

  describe('getCount', () => {
    it('returns workspace count from manager', () => {
      mockManager.count = 5;
      expect(service.getCount()).toBe(5);
    });

    it('returns 0 when no workspaces', () => {
      mockManager.count = 0;
      expect(service.getCount()).toBe(0);
    });
  });

  describe('WorkspaceInfo mapping', () => {
    it('maps channels as a copy (not reference)', () => {
      const ws = createMockWorkspace({ channels: ['ch-1', 'ch-2'] });
      mockManager.get.mockReturnValue(ws);

      const info = service.get('ws-1');
      expect(info!.channels).toEqual(['ch-1', 'ch-2']);
      // Should be a copy, not the same reference
      expect(info!.channels).not.toBe(ws.config.channels);
    });

    it('maps conversationId from workspace', () => {
      mockManager.get.mockReturnValue(createMockWorkspace());

      const info = service.get('ws-1');
      expect(info!.conversationId).toBe('conv-1');
    });

    it('maps state from workspace', () => {
      const ws = createMockWorkspace();
      (ws as { state: string }).state = 'processing';
      mockManager.get.mockReturnValue(ws);

      const info = service.get('ws-1');
      expect(info!.state).toBe('processing');
    });
  });
});
