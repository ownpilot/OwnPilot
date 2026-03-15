import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── Mocks ──

const mockFleetService = {
  listFleets: vi.fn(async () => []),
  createFleet: vi.fn(async (userId: string, input: Record<string, unknown>) => ({
    id: 'fleet-1',
    userId,
    ...input,
  })),
  getFleet: vi.fn(async () => null),
  updateFleet: vi.fn(async () => null),
  deleteFleet: vi.fn(async () => true),
  getSession: vi.fn(async () => null),
  startFleet: vi.fn(async () => ({ state: 'running', cyclesCompleted: 0 })),
  stopFleet: vi.fn(async () => true),
  pauseFleet: vi.fn(async () => true),
  resumeFleet: vi.fn(async () => true),
  addTask: vi.fn(async () => ({ id: 'task-1' })),
  listTasks: vi.fn(async () => []),
  getHistory: vi.fn(async () => ({ entries: [], total: 0 })),
};

vi.mock('../services/fleet-service.js', () => ({
  getFleetService: vi.fn(() => mockFleetService),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

const { fleetRoutes } = await import('./fleet.js');

// ── App ──

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/fleet', fleetRoutes);
  return app;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Fleet Routes', () => {
  describe('GET /fleet', () => {
    it('returns list of fleets', async () => {
      mockFleetService.listFleets.mockResolvedValue([
        { id: 'f1', name: 'Fleet A', mission: 'Test' },
      ]);
      const app = createApp();
      const res = await app.request('/fleet');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('returns empty array when no fleets', async () => {
      const app = createApp();
      const res = await app.request('/fleet');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
    });
  });

  describe('POST /fleet', () => {
    it('creates a fleet', async () => {
      const app = createApp();
      const res = await app.request('/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Fleet',
          mission: 'Do stuff',
          workers: [{ name: 'w1', type: 'ai-chat' }],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockFleetService.createFleet).toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      const app = createApp();
      const res = await app.request('/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: 'No name' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /fleet/:id', () => {
    it('returns fleet config', async () => {
      mockFleetService.getFleet.mockResolvedValue({ id: 'f1', name: 'Fleet A' });
      const app = createApp();
      const res = await app.request('/fleet/f1');
      expect(res.status).toBe(200);
    });

    it('returns 404 when not found', async () => {
      mockFleetService.getFleet.mockResolvedValue(null);
      const app = createApp();
      const res = await app.request('/fleet/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /fleet/:id/start', () => {
    it('starts a fleet', async () => {
      mockFleetService.getFleet.mockResolvedValue({ id: 'f1' });
      const app = createApp();
      const res = await app.request('/fleet/f1/start', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockFleetService.startFleet).toHaveBeenCalledWith('f1', 'user-1');
    });
  });

  describe('POST /fleet/:id/stop', () => {
    it('stops a fleet', async () => {
      const app = createApp();
      const res = await app.request('/fleet/f1/stop', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockFleetService.stopFleet).toHaveBeenCalledWith('f1', 'user-1');
    });
  });

  describe('DELETE /fleet/:id', () => {
    it('deletes a fleet', async () => {
      const app = createApp();
      const res = await app.request('/fleet/f1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(mockFleetService.deleteFleet).toHaveBeenCalledWith('f1', 'user-1');
    });
  });
});
