/**
 * Artifact Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRepo, MockArtifactsRepository } = vi.hoisted(() => {
  const mockRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    togglePin: vi.fn(),
    updateBindings: vi.fn(),
    getVersions: vi.fn(),
  };
  const MockArtifactsRepository = vi.fn(function () {
    return mockRepo;
  });
  return { mockRepo, MockArtifactsRepository };
});

vi.mock('../db/repositories/artifacts.js', () => ({
  ArtifactsRepository: MockArtifactsRepository,
}));

const { mockResolveAllBindings } = vi.hoisted(() => ({
  mockResolveAllBindings: vi.fn(async (_, bindings) => bindings),
}));

vi.mock('./artifact-data-resolver.js', () => ({
  resolveAllBindings: mockResolveAllBindings,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLog: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() })) };
});

import { getArtifactService } from './artifact-service.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleArtifact = {
  id: 'art-1',
  userId: 'user-1',
  type: 'html',
  title: 'My Chart',
  content: '<html/>',
  pinned: false,
  version: 1,
  dataBindings: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArtifactService', () => {
  let service: ReturnType<typeof getArtifactService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = getArtifactService();
    mockRepo.create.mockResolvedValue(sampleArtifact);
    mockRepo.getById.mockResolvedValue(sampleArtifact);
    mockRepo.update.mockResolvedValue(sampleArtifact);
    mockRepo.delete.mockResolvedValue(true);
    mockRepo.list.mockResolvedValue({ artifacts: [sampleArtifact], total: 1 });
    mockRepo.togglePin.mockResolvedValue({ ...sampleArtifact, pinned: true });
    mockRepo.updateBindings.mockResolvedValue(undefined);
    mockRepo.getVersions.mockResolvedValue([
      { version: 1, content: '<html/>', createdAt: new Date() },
    ]);
  });

  describe('createArtifact', () => {
    it('creates artifact via repo and returns it', async () => {
      const input = { type: 'html', title: 'Test', content: '<html/>' };
      const result = await service.createArtifact('user-1', input as any);
      expect(result).toBe(sampleArtifact);
      expect(mockRepo.create).toHaveBeenCalledWith(input);
    });

    it('broadcasts created event', async () => {
      const { wsGateway } = await import('../ws/server.js');
      await service.createArtifact('user-1', {} as any);
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ action: 'created', id: 'art-1' })
      );
    });
  });

  describe('getArtifact', () => {
    it('returns artifact by id', async () => {
      const result = await service.getArtifact('user-1', 'art-1');
      expect(result).toBe(sampleArtifact);
      expect(mockRepo.getById).toHaveBeenCalledWith('art-1');
    });

    it('returns null when not found', async () => {
      mockRepo.getById.mockResolvedValueOnce(null);
      const result = await service.getArtifact('user-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateArtifact', () => {
    it('updates artifact and returns it', async () => {
      const input = { title: 'Updated' };
      const result = await service.updateArtifact('user-1', 'art-1', input as any);
      expect(result).toBe(sampleArtifact);
      expect(mockRepo.update).toHaveBeenCalledWith('art-1', input);
    });

    it('broadcasts updated event when update succeeds', async () => {
      const { wsGateway } = await import('../ws/server.js');
      await service.updateArtifact('user-1', 'art-1', {} as any);
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ action: 'updated', id: 'art-1' })
      );
    });

    it('does not broadcast when update returns null', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockRepo.update.mockResolvedValueOnce(null);
      await service.updateArtifact('user-1', 'art-1', {} as any);
      expect(wsGateway.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('deleteArtifact', () => {
    it('deletes artifact and returns true', async () => {
      const result = await service.deleteArtifact('user-1', 'art-1');
      expect(result).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('art-1');
    });

    it('broadcasts deleted event when deleted', async () => {
      const { wsGateway } = await import('../ws/server.js');
      await service.deleteArtifact('user-1', 'art-1');
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ action: 'deleted', id: 'art-1' })
      );
    });

    it('does not broadcast when delete returns false', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockRepo.delete.mockResolvedValueOnce(false);
      await service.deleteArtifact('user-1', 'art-1');
      expect(wsGateway.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('listArtifacts', () => {
    it('lists artifacts with query params', async () => {
      const result = await service.listArtifacts('user-1', { type: 'html' } as any);
      expect(result).toEqual({ artifacts: [sampleArtifact], total: 1 });
      expect(mockRepo.list).toHaveBeenCalledWith({ type: 'html' });
    });

    it('works without query params', async () => {
      const result = await service.listArtifacts('user-1');
      expect(mockRepo.list).toHaveBeenCalledWith(undefined);
      expect(result.total).toBe(1);
    });
  });

  describe('togglePin', () => {
    it('toggles pin and returns artifact', async () => {
      const result = await service.togglePin('user-1', 'art-1');
      expect(result?.pinned).toBe(true);
      expect(mockRepo.togglePin).toHaveBeenCalledWith('art-1');
    });

    it('broadcasts updated event on pin toggle', async () => {
      const { wsGateway } = await import('../ws/server.js');
      await service.togglePin('user-1', 'art-1');
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ action: 'updated' })
      );
    });

    it('returns null without broadcasting when togglePin returns null', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockRepo.togglePin.mockResolvedValueOnce(null);
      const result = await service.togglePin('user-1', 'art-1');
      expect(result).toBeNull();
      expect(wsGateway.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('refreshBindings', () => {
    it('returns artifact unchanged when no dataBindings', async () => {
      const result = await service.refreshBindings('user-1', 'art-1');
      expect(result).toBe(sampleArtifact);
      expect(mockResolveAllBindings).not.toHaveBeenCalled();
    });

    it('resolves bindings and updates when bindings exist', async () => {
      const binding = {
        variableName: 'tasks',
        source: { type: 'query', entity: 'tasks', filter: {} },
      };
      const artifactWithBindings = { ...sampleArtifact, dataBindings: [binding] };
      const refreshedArtifact = {
        ...artifactWithBindings,
        dataBindings: [{ ...binding, lastValue: [] }],
      };

      mockRepo.getById
        .mockResolvedValueOnce(artifactWithBindings) // first call
        .mockResolvedValueOnce(refreshedArtifact); // after update
      mockResolveAllBindings.mockResolvedValueOnce([{ ...binding, lastValue: [] }]);

      const result = await service.refreshBindings('user-1', 'art-1');
      expect(mockResolveAllBindings).toHaveBeenCalledWith('user-1', [binding]);
      expect(mockRepo.updateBindings).toHaveBeenCalledWith('art-1', [
        { ...binding, lastValue: [] },
      ]);
      expect(result).toBe(refreshedArtifact);
    });

    it('returns null when artifact not found', async () => {
      mockRepo.getById.mockResolvedValueOnce(null);
      const result = await service.refreshBindings('user-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getVersions', () => {
    it('returns version history', async () => {
      const result = await service.getVersions('user-1', 'art-1');
      expect(Array.isArray(result)).toBe(true);
      expect(mockRepo.getVersions).toHaveBeenCalledWith('art-1');
    });
  });

  describe('broadcast error handling', () => {
    it('silently catches wsGateway.broadcast errors', async () => {
      const { wsGateway } = await import('../ws/server.js');
      (wsGateway.broadcast as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('WS not initialized');
      });

      // Should not throw
      await expect(service.createArtifact('user-1', {} as any)).resolves.toBeDefined();
    });
  });
});
