/**
 * Canvas Service Tests
 *
 * Verifies the gateway CanvasService delegates to CanvasRepository and
 * broadcasts `canvas:op` WS events on every mutation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRepo, MockCanvasRepository } = vi.hoisted(() => {
  const mockRepo = {
    list: vi.fn(),
    getById: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  };
  const MockCanvasRepository = vi.fn(function () {
    return mockRepo;
  });
  return { mockRepo, MockCanvasRepository };
});

vi.mock('../../db/repositories/canvas.js', () => ({
  CanvasRepository: MockCanvasRepository,
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('@ownpilot/core/services', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getLog: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() })) };
});

import { getCanvasServiceImpl } from './service.js';

const sampleElement = {
  id: 'canv-1',
  userId: 'user-1',
  canvasId: 'main',
  type: 'note',
  content: 'hello',
  x: 10,
  y: 20,
  w: 200,
  h: 120,
  z: 0,
  style: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CanvasService', () => {
  let service: ReturnType<typeof getCanvasServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = getCanvasServiceImpl();
    mockRepo.list.mockResolvedValue([sampleElement]);
    mockRepo.getById.mockResolvedValue(sampleElement);
    mockRepo.add.mockResolvedValue(sampleElement);
    mockRepo.update.mockResolvedValue(sampleElement);
    mockRepo.move.mockResolvedValue({ ...sampleElement, x: 99, y: 88 });
    mockRepo.remove.mockResolvedValue(true);
    mockRepo.clear.mockResolvedValue(2);
  });

  it('listElements delegates to repo', async () => {
    const result = await service.listElements('user-1', 'main');
    expect(result).toEqual([sampleElement]);
    expect(mockRepo.list).toHaveBeenCalledWith('main');
  });

  it('addElement broadcasts a canvas:op add', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    const result = await service.addElement('user-1', { type: 'note' } as never);
    expect(result).toBe(sampleElement);
    expect(wsGateway.broadcast).toHaveBeenCalledWith(
      'canvas:op',
      expect.objectContaining({ action: 'add', canvasId: 'main', element: sampleElement })
    );
  });

  it('updateElement broadcasts a canvas:op update', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    await service.updateElement('user-1', 'canv-1', { content: 'x' });
    expect(wsGateway.broadcast).toHaveBeenCalledWith(
      'canvas:op',
      expect.objectContaining({ action: 'update' })
    );
  });

  it('updateElement does not broadcast when element missing', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    mockRepo.update.mockResolvedValueOnce(null);
    const result = await service.updateElement('user-1', 'missing', {});
    expect(result).toBeNull();
    expect(wsGateway.broadcast).not.toHaveBeenCalled();
  });

  it('moveElement broadcasts a canvas:op move with new position', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    await service.moveElement('user-1', 'canv-1', 99, 88);
    expect(mockRepo.move).toHaveBeenCalledWith('canv-1', 99, 88);
    expect(wsGateway.broadcast).toHaveBeenCalledWith(
      'canvas:op',
      expect.objectContaining({ action: 'move' })
    );
  });

  it('removeElement broadcasts remove with the element id', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    const result = await service.removeElement('user-1', 'canv-1');
    expect(result).toBe(true);
    expect(wsGateway.broadcast).toHaveBeenCalledWith(
      'canvas:op',
      expect.objectContaining({ action: 'remove', id: 'canv-1' })
    );
  });

  it('removeElement does not broadcast when nothing removed', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    mockRepo.getById.mockResolvedValueOnce(null);
    mockRepo.remove.mockResolvedValueOnce(false);
    const result = await service.removeElement('user-1', 'missing');
    expect(result).toBe(false);
    expect(wsGateway.broadcast).not.toHaveBeenCalled();
  });

  it('clearCanvas broadcasts clear and returns count', async () => {
    const { wsGateway } = await import('../../ws/server.js');
    const count = await service.clearCanvas('user-1', 'main');
    expect(count).toBe(2);
    expect(mockRepo.clear).toHaveBeenCalledWith('main');
    expect(wsGateway.broadcast).toHaveBeenCalledWith(
      'canvas:op',
      expect.objectContaining({ action: 'clear', canvasId: 'main' })
    );
  });
});
