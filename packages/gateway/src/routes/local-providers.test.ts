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
        body: JSON.stringify({
          name: 'Ollama',
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434',
        }),
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
      mockLocalProvidersRepo.updateProvider.mockResolvedValue({
        ...sampleProvider,
        name: 'Updated Ollama',
      });

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
      mockLocalProvidersRepo.updateProvider.mockResolvedValue({
        ...sampleProvider,
        isEnabled: false,
      });

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

  // ========================================================================
  // POST /local-providers -- error paths
  // ========================================================================

  describe('POST /local-providers -- error and validation paths', () => {
    it('returns 400 for invalid baseUrl (SSRF prevention)', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Evil',
          providerType: 'custom',
          baseUrl: 'ftp://localhost:8080',
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 for cloud metadata baseUrl', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Metadata',
          providerType: 'custom',
          baseUrl: 'http://169.254.169.254/latest/meta-data/',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 on createProvider failure', async () => {
      mockLocalProvidersRepo.createProvider.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ollama',
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434',
        }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CREATE_FAILED');
    });

    it('broadcasts WebSocket event on create', async () => {
      const { wsGateway } = await import('../ws/server.js');
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ollama',
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434',
        }),
      });
      expect(res.status).toBe(201);
      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', expect.objectContaining({
        entity: 'local_provider',
        action: 'created',
      }));
    });
  });

  // ========================================================================
  // GET /local-providers -- error path
  // ========================================================================

  describe('GET /local-providers -- error path', () => {
    it('returns 500 on listProviders failure', async () => {
      mockLocalProvidersRepo.listProviders.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('LIST_FAILED');
    });
  });

  // ========================================================================
  // GET /local-providers/:id -- error paths
  // ========================================================================

  describe('GET /local-providers/:id -- error paths', () => {
    it('returns 404 when userId does not match', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue({ ...sampleProvider, userId: 'other-user' });
      const res = await app.request('/local-providers/ollama-1');
      expect(res.status).toBe(404);
    });

    it('returns 500 on getProvider failure', async () => {
      mockLocalProvidersRepo.getProvider.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });
  });

  // ========================================================================
  // PUT /local-providers/:id -- additional paths
  // ========================================================================

  describe('PUT /local-providers/:id -- additional paths', () => {
    it('returns 400 for invalid baseUrl in update', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'ftp://evil.com' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 404 when updateProvider returns null', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockResolvedValue(null);
      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid JSON body', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 on updateProvider error', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });

    it('broadcasts WebSocket event on update', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockResolvedValue({ ...sampleProvider, name: 'Updated' });
      const res = await app.request('/local-providers/ollama-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(res.status).toBe(200);
      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', expect.objectContaining({
        entity: 'local_provider', action: 'updated', id: 'ollama-1',
      }));
    });
  });

  // ========================================================================
  // DELETE /local-providers/:id -- additional paths
  // ========================================================================

  describe('DELETE /local-providers/:id -- additional paths', () => {
    it('returns 404 when deleteProvider returns false after ownership check', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.deleteProvider.mockResolvedValue(false);
      const res = await app.request('/local-providers/ollama-1', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on deleteProvider error', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.deleteProvider.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DELETE_FAILED');
    });

    it('broadcasts WebSocket event on delete', async () => {
      const { wsGateway } = await import('../ws/server.js');
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.deleteProvider.mockResolvedValue(true);
      const res = await app.request('/local-providers/ollama-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', expect.objectContaining({
        entity: 'local_provider', action: 'deleted', id: 'ollama-1',
      }));
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/toggle -- additional paths
  // ========================================================================

  describe('PATCH /local-providers/:id/toggle -- additional paths', () => {
    it('returns 404 when updateProvider returns null after toggle', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockResolvedValue(null);
      const res = await app.request('/local-providers/ollama-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 on toggle error', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.updateProvider.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('TOGGLE_FAILED');
    });

    it('returns 400 for missing body', async () => {
      const res = await app.request('/local-providers/ollama-1/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/set-default -- error path
  // ========================================================================

  describe('PATCH /local-providers/:id/set-default -- error path', () => {
    it('returns 500 on setDefault error', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.setDefault.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1/set-default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });
  });

  // ========================================================================
  // POST /local-providers/:id/discover -- additional paths
  // ========================================================================

  describe('POST /local-providers/:id/discover -- additional paths', () => {
    it('tracks existing models correctly', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', displayName: 'Llama 2' },
      ]);
      const res = await app.request('/local-providers/ollama-1/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.totalModels).toBe(2);
      expect(json.data.existingModels).toBe(1);
      expect(json.data.newModels).toBe(1);
    });

    it('returns 500 on discover error', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue(sampleProvider);
      vi.mocked(discoverModels).mockRejectedValueOnce(new Error('Network error'));
      const res = await app.request('/local-providers/ollama-1/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });

    it('returns 404 when userId does not match', async () => {
      mockLocalProvidersRepo.getProvider.mockResolvedValue({ ...sampleProvider, userId: 'other' });
      const res = await app.request('/local-providers/ollama-1/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /local-providers/:id/models -- error path
  // ========================================================================

  describe('GET /local-providers/:id/models -- error path', () => {
    it('returns 500 on listModels failure', async () => {
      mockLocalProvidersRepo.listModels.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1/models');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('LIST_FAILED');
    });
  });

  // ========================================================================
  // PATCH /local-providers/:id/models/:modelId/toggle -- error path
  // ========================================================================

  describe('PATCH /local-providers/:id/models/:modelId/toggle -- error path', () => {
    it('returns 500 on toggleModel failure', async () => {
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { id: 'db-id-1', modelId: 'llama2', displayName: 'Llama 2', isEnabled: true },
      ]);
      mockLocalProvidersRepo.toggleModel.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/local-providers/ollama-1/models/llama2/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('TOGGLE_FAILED');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/local-providers/ollama-1/models/llama2/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      });
      expect(res.status).toBe(400);
    });

    it('handles URI-encoded modelId with slashes', async () => {
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { id: 'db-id-2', modelId: 'org/model-name', displayName: 'Org Model', isEnabled: true },
      ]);
      const encodedModelId = encodeURIComponent('org/model-name');
      const res = await app.request('/local-providers/ollama-1/models/' + encodedModelId + '/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(mockLocalProvidersRepo.toggleModel).toHaveBeenCalledWith('db-id-2', false);
    });
  });


  describe('POST /local-providers -- URL validation edge cases', () => {
    it('returns 400 for unparseable baseUrl', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad URL',
          providerType: 'custom',
          baseUrl: 'not-a-url',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for GCP metadata baseUrl', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'GCP Metadata',
          providerType: 'custom',
          baseUrl: 'http://metadata.google.internal/computeMetadata',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for baseUrl longer than 2048 chars', async () => {
      const res = await app.request('/local-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Long URL',
          providerType: 'custom',
          baseUrl: 'http://localhost:8080/' + 'a'.repeat(2100),
        }),
      });
      expect(res.status).toBe(400);
    });
  });

});
