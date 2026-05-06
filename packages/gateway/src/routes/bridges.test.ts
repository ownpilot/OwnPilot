/**
 * Channel Bridge Routes Tests
 *
 * Integration tests for the bridge management API endpoints.
 * Mocks ChannelBridgesRepository to keep tests fast and database-free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock: ChannelBridgesRepository (class-based, instantiated per-request)
// ---------------------------------------------------------------------------

const mockRepo = {
  getAll: vi.fn(),
  getById: vi.fn(),
  getByChannel: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  isOwnedByUser: vi.fn(),
};

vi.mock('../db/repositories/channel-bridges.js', () => ({
  ChannelBridgesRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

// ---------------------------------------------------------------------------
// Import route after mocks
// ---------------------------------------------------------------------------

const { bridgeRoutes } = await import('./bridges.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/bridges', bridgeRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBridge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bridge-1',
    sourceChannelId: 'channel.telegram',
    targetChannelId: 'channel.whatsapp',
    direction: 'both',
    filterPattern: undefined,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bridge Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user owns the bridge
    mockRepo.isOwnedByUser.mockResolvedValue(true);
    app = createApp();
  });

  // =========================================================================
  // GET / — list all bridges
  // =========================================================================

  describe('GET /bridges', () => {
    it('returns all bridges when no channelId filter is given', async () => {
      const bridges = [makeBridge({ id: 'bridge-1' }), makeBridge({ id: 'bridge-2' })];
      mockRepo.getAll.mockResolvedValue(bridges);

      const res = await app.request('/bridges');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(mockRepo.getAll).toHaveBeenCalledOnce();
      expect(mockRepo.getByChannel).not.toHaveBeenCalled();
    });

    it('filters by channelId when query param is provided', async () => {
      const bridges = [makeBridge({ sourceChannelId: 'channel.telegram' })];
      mockRepo.getByChannel.mockResolvedValue(bridges);

      const res = await app.request('/bridges?channelId=channel.telegram');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(mockRepo.getByChannel).toHaveBeenCalledWith('channel.telegram');
      expect(mockRepo.getAll).not.toHaveBeenCalled();
    });

    it('returns empty array when no bridges exist', async () => {
      mockRepo.getAll.mockResolvedValue([]);

      const res = await app.request('/bridges');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
    });

    it('returns 500 on repository error', async () => {
      mockRepo.getAll.mockRejectedValue(new Error('DB timeout'));

      const res = await app.request('/bridges');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('DB timeout');
    });
  });

  // =========================================================================
  // GET /:id — get a specific bridge
  // =========================================================================

  describe('GET /bridges/:id', () => {
    it('returns the bridge when found', async () => {
      const bridge = makeBridge({ id: 'bridge-42' });
      mockRepo.getById.mockResolvedValue(bridge);

      const res = await app.request('/bridges/bridge-42');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('bridge-42');
      expect(json.data.sourceChannelId).toBe('channel.telegram');
      expect(json.data.targetChannelId).toBe('channel.whatsapp');
      expect(mockRepo.getById).toHaveBeenCalledWith('bridge-42');
    });

    it('returns 404 when bridge does not exist', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/bridges/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('Bridge not found');
    });

    it('returns 500 on repository error', async () => {
      mockRepo.getById.mockRejectedValue(new Error('Read error'));

      const res = await app.request('/bridges/bridge-1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // POST / — create a bridge
  // =========================================================================

  describe('POST /bridges', () => {
    it('creates a bridge with required fields and returns 201', async () => {
      const saved = makeBridge({ id: 'bridge-new', direction: 'both', enabled: true });
      mockRepo.save.mockResolvedValue(saved);

      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('bridge-new');
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'both',
          enabled: true,
        })
      );
    });

    it('accepts optional direction and filterPattern', async () => {
      const saved = makeBridge({
        direction: 'source_to_target',
        filterPattern: '^important:',
        enabled: false,
      });
      mockRepo.save.mockResolvedValue(saved);

      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'source_to_target',
          filterPattern: '^important:',
          enabled: false,
        }),
      });

      expect(res.status).toBe(201);
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'source_to_target',
          filterPattern: '^important:',
          enabled: false,
        })
      );
    });

    it('returns 400 when sourceChannelId is missing', async () => {
      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetChannelId: 'channel.whatsapp' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('sourceChannelId');
    });

    it('returns 400 when targetChannelId is missing', async () => {
      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceChannelId: 'channel.telegram' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when source and target channels are the same', async () => {
      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.telegram',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Cannot bridge a channel to itself');
    });

    it('returns 400 for an invalid direction value', async () => {
      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          direction: 'one_way_only',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Invalid direction');
    });

    it('returns 400 for an invalid regex filterPattern', async () => {
      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
          filterPattern: '[invalid regex(',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Invalid filter pattern');
    });

    it('returns 500 on repository save error', async () => {
      mockRepo.save.mockRejectedValue(new Error('Constraint violation'));

      const res = await app.request('/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChannelId: 'channel.telegram',
          targetChannelId: 'channel.whatsapp',
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // PATCH /:id — update a bridge
  // =========================================================================

  describe('PATCH /bridges/:id', () => {
    it('updates an existing bridge and returns the updated record', async () => {
      const existing = makeBridge({ id: 'bridge-1', enabled: true });
      const updated = makeBridge({ id: 'bridge-1', enabled: false });
      mockRepo.getById.mockResolvedValueOnce(existing).mockResolvedValueOnce(updated);
      mockRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/bridges/bridge-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(false);
      expect(mockRepo.update).toHaveBeenCalledWith('bridge-1', { enabled: false });
    });

    it('returns 404 when bridge does not exist', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/bridges/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('Bridge not found');
    });

    it('returns 400 for an invalid regex filterPattern on update', async () => {
      mockRepo.getById.mockResolvedValue(makeBridge());

      const res = await app.request('/bridges/bridge-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterPattern: '(unclosed' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Invalid filter pattern');
    });

    it('returns 500 on repository update error', async () => {
      mockRepo.getById.mockResolvedValue(makeBridge());
      mockRepo.update.mockRejectedValue(new Error('Write failed'));

      const res = await app.request('/bridges/bridge-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // DELETE /:id — delete a bridge
  // =========================================================================

  describe('DELETE /bridges/:id', () => {
    it('deletes an existing bridge and returns deleted: true', async () => {
      mockRepo.getById.mockResolvedValue(makeBridge({ id: 'bridge-1' }));
      mockRepo.remove.mockResolvedValue(undefined);

      const res = await app.request('/bridges/bridge-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(mockRepo.remove).toHaveBeenCalledWith('bridge-1');
    });

    it('returns 404 when bridge does not exist', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/bridges/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 on repository remove error', async () => {
      mockRepo.getById.mockResolvedValue(makeBridge());
      mockRepo.remove.mockRejectedValue(new Error('Delete failed'));

      const res = await app.request('/bridges/bridge-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // Response format
  // =========================================================================

  describe('Response format', () => {
    it('success responses include meta.timestamp', async () => {
      mockRepo.getAll.mockResolvedValue([]);

      const res = await app.request('/bridges');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
      expect(new Date(json.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('error responses include meta.timestamp', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/bridges/nonexistent');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});
