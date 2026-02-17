/**
 * Local Providers Routes Tests
 *
 * Integration tests for the local AI providers API endpoints.
 * Mocks localProvidersRepo and discoverModels service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  getProvider: vi.fn(async () => null),
  createProvider: vi.fn(async (input: Record<string, unknown>) => ({ id: 'prov-1', ...input })),
  updateProvider: vi.fn(async () => null),
  deleteProvider: vi.fn(async () => false),
  setDefault: vi.fn(),
  listModels: vi.fn(async () => []),
  upsertModel: vi.fn(),
  toggleModel: vi.fn(),
  updateDiscoveredAt: vi.fn(),
};

vi.mock('../db/repositories/local-providers.js', () => ({
  localProvidersRepo: mockLocalProvidersRepo,
}));

vi.mock('../services/local-discovery.js', () => ({
  discoverModels: vi.fn(async () => ({
    models: [
      { modelId: 'llama2', displayName: 'Llama 2', metadata: {} },
      { modelId: 'codellama', displayName: 'Code Llama', metadata: {} },
    ],
    sourceUrl: 'http://localhost:11434/api/tags',
  })),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

// Import after mocks
const { localProvidersRoutes } = await import('./local-providers.js');
const { discoverModels } = await import('../services/local-discovery.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/local-providers', localProvidersRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleProvider = {
  id: 'ollama-1',
  userId: 'default',
  name: 'Ollama',
  providerType: 'ollama',
  baseUrl: 'http://localhost:11434',
  isEnabled: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Local Providers Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalProvidersRepo.listProviders.mockResolvedValue([]);
    mockLocalProvidersRepo.getProvider.mockResolvedValue(null);
    mockLocalProvidersRepo.updateProvider.mockResolvedValue(null);
    mockLocalProvidersRepo.deleteProvider.mockResolvedValue(false);
    mockLocalProvidersRepo.listModels.mockResolvedValue([]);
    app = createApp();
  });

  // ========================================================================
  // GET /local-providers/templates
  // ========================================================================

  describe('GET /local-providers/templates', () => {
    it('returns provider templates', async () => {
      const res = await app.request('/local-providers/templates');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(4);
      expect(json.data.find((t: { id: string }) => t.id === 'ollama')).toBeDefined();
      expect(json.data.find((t: { id: string }) => t.id === 'lmstudio')).toBeDefined();
    });
  });

  // ========================================================================
  // GET /local-providers
  // ========================================================================

  describe('GET /local-providers', () => {
    it('returns empty list', async () => {
      const res = await app.request('/local-providers');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(0);
    });

    it('returns providers with model counts', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([sampleProvider]);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', displayName: 'Llama 2' },
        { modelId: 'codellama', displayName: 'Code Llama' },
      ]);

      const res = await app.request('/local-providers');
      const json = await res.json();

      expect(json.data).toHaveLength(1);
      expect(json.data[0].modelCount).toBe(2);
    });
  });

  // ========================================================================
  // POST /local-providers
  // ========================================================================

  describe('POST /local-providers', () => {
    it('creates a local provider', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ollama', providerType: 'ollama', baseUrl: 'http://localhost:11434' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ollama' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /local-providers/:id
  // ========================================================================

  describe('GET /local-providers/:id', () => {
    it('returns provider with models', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', displayName: 'Llama 2' },
      ]);

      const res = await app.request('/local-providers/ollama-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.models).toHaveLength(1);
    });

    it('returns 404 when not found', async () => {
      const res = await app.request('/local-providers/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /local-providers/:id
  // ========================================================================

  describe('PUT /local-providers/:id', () => {
    it('updates a provider', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockResolvedValue({ ...sampleProvider, name: 'Updated Ollama' });

      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Ollama' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 404 when not found', async () => {
      const res = await app.request('/local-providers/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /local-providers/:id
  // ========================================================================

  describe('DELETE /local-providers/:id', () => {
    it('deletes a provider', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.deleteProvider.mockResolvedValue(true);

      const res = await app.request('/local-providers/ollama-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
    });

    it('returns 404 when not found', async () => {
      const res = await app.request('/local-providers/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/toggle
  // ========================================================================

  describe('PATCH /local-providers/:id/toggle', () => {
    it('toggles provider enabled state', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockResolvedValue({ ...sampleProvider, isEnabled: false });

      const res = await app.request('/local-providers/ollama-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isEnabled).toBe(false);
    });

    it('returns 400 for non-boolean enabled', async () => {
      const res = await app.request('/local-providers/ollama-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when not found', async () => {
      const res = await app.request('/local-providers/nonexistent/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/set-default
  // ========================================================================

  describe('PATCH /local-providers/:id/set-default', () => {
    it('sets default local provider', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);

      const res = await app.request('/local-providers/ollama-1/set-default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockLocalProvidersRepo.setDefault).toHaveBeenCalledWith('default', 'ollama-1');
    });

    it('returns 404 when provider not found', async () => {
      const res = await app.request('/local-providers/nonexistent/set-default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /local-providers/:id/discover
  // ========================================================================

  describe('POST /local-providers/:id/discover', () => {
    it('discovers models from provider', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.listModels.mockResolvedValue([]); // no existing models

      const res = await app.request('/local-providers/ollama-1/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.totalModels).toBe(2);
      expect(json.data.newModels).toBe(2);
      expect(json.data.existingModels).toBe(0);
      expect(mockLocalProvidersRepo.updateDiscoveredAt).toHaveBeenCalled();
    });

    it('returns 404 when provider not found', async () => {
      const res = await app.request('/local-providers/nonexistent/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });

    it('returns 502 when discovery fails', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      vi.mocked(discoverModels).mockResolvedValueOnce({
        models: [],
        error: 'Connection refused',
        sourceUrl: '',
      });

      const res = await app.request('/local-providers/ollama-1/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(502);
    });
  });

  // ========================================================================
  // GET /local-providers/:id/models
  // ========================================================================

  describe('GET /local-providers/:id/models', () => {
    it('returns models for a provider', async () => {
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { id: 'model-1', modelId: 'llama2', displayName: 'Llama 2', isEnabled: true },
      ]);

      const res = await app.request('/local-providers/ollama-1/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/models/:modelId/toggle
  // ========================================================================

  describe('PATCH /local-providers/:id/models/:modelId/toggle', () => {
    it('toggles model enabled state', async () => {
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { id: 'db-id-1', modelId: 'llama2', displayName: 'Llama 2', isEnabled: true },
      ]);

      const res = await app.request('/local-providers/ollama-1/models/llama2/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      expect(mockLocalProvidersRepo.toggleModel).toHaveBeenCalledWith('db-id-1', false);
    });

    it('returns 400 for non-boolean enabled', async () => {
      const res = await app.request('/local-providers/ollama-1/models/llama2/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when model not found', async () => {
      mockLocalProvidersRepo.listModels.mockResolvedValue([]);

      const res = await app.request('/local-providers/ollama-1/models/nonexistent/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });
  });
});
