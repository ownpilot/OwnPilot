/**
 * Model Routes Tests
 *
 * Comprehensive integration tests for the model CRUD API endpoints.
 * Covers listing, filtering, creating, updating, deleting, and toggling model configs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockModelConfigsRepo, mockGetMergedModels, mockWsBroadcast, mockLog } = vi.hoisted(() => {
  const mockLog = vi.fn(() => ({ error: vi.fn(), info: vi.fn() }));
  const mockModelConfigsRepo = {
    upsertModel: vi.fn(),
    deleteModel: vi.fn(),
  };
  const mockGetMergedModels = vi.fn();
  const mockWsBroadcast = vi.fn();

  return { mockModelConfigsRepo, mockGetMergedModels, mockWsBroadcast, mockLog };
});

vi.mock('../../db/repositories/index.js', () => ({
  modelConfigsRepo: mockModelConfigsRepo,
}));

vi.mock('./shared.js', () => ({
  getMergedModels: mockGetMergedModels,
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: mockWsBroadcast },
}));

vi.mock('../../services/log.js', () => ({
  getLog: mockLog,
}));

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleModel = {
  id: 'cfg-1',
  userId: 'user-1',
  providerId: 'anthropic',
  modelId: 'claude-3-sonnet',
  displayName: 'Claude 3 Sonnet',
  capabilities: ['chat', 'code', 'vision'],
  isEnabled: true,
  isCustom: false,
  hasOverride: false,
  contextWindow: 200000,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleModelOpenAI = {
  id: 'cfg-2',
  userId: 'user-1',
  providerId: 'openai',
  modelId: 'gpt-4',
  displayName: 'GPT-4',
  capabilities: ['chat', 'function_calling'],
  isEnabled: true,
  isCustom: false,
  hasOverride: false,
  contextWindow: 128000,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleModelDisabled = {
  id: 'cfg-3',
  userId: 'user-1',
  providerId: 'openai',
  modelId: 'gpt-3.5-turbo',
  displayName: 'GPT-3.5 Turbo',
  capabilities: ['chat'],
  isEnabled: false,
  isCustom: false,
  hasOverride: false,
  contextWindow: 16000,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleCustomModel = {
  id: 'cfg-4',
  userId: 'user-1',
  providerId: 'anthropic',
  modelId: 'claude-custom',
  displayName: 'Custom Claude',
  capabilities: ['chat'],
  isEnabled: true,
  isCustom: true,
  hasOverride: false,
  contextWindow: 100000,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleModelWithOverride = {
  id: 'cfg-5',
  userId: 'user-1',
  providerId: 'openai',
  modelId: 'gpt-4-override',
  displayName: 'GPT-4 Override',
  capabilities: ['chat'],
  isEnabled: true,
  isCustom: false,
  hasOverride: true,
  contextWindow: 128000,
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { modelRoutes } = await import('./models.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/models', modelRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Model Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMergedModels.mockResolvedValue([sampleModel, sampleModelOpenAI, sampleModelDisabled]);
    mockModelConfigsRepo.upsertModel.mockResolvedValue(sampleModel);
    mockModelConfigsRepo.deleteModel.mockResolvedValue(true);
    app = createApp();
  });

  // ========================================================================
  // GET /models - List all models
  // ========================================================================

  describe('GET /models', () => {
    it('returns all models without filters', async () => {
      const res = await app.request('/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(3);
      expect(mockGetMergedModels).toHaveBeenCalledWith('user-1');
    });

    it('returns empty array when no models exist', async () => {
      mockGetMergedModels.mockResolvedValueOnce([]);

      const res = await app.request('/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    it('filters models by provider', async () => {
      const res = await app.request('/models?provider=anthropic');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].providerId).toBe('anthropic');
    });

    it('returns empty array when provider filter matches nothing', async () => {
      const res = await app.request('/models?provider=nonexistent');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    it('filters models by capability', async () => {
      const res = await app.request('/models?capability=vision');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].modelId).toBe('claude-3-sonnet');
    });

    it('returns multiple models matching capability filter', async () => {
      const res = await app.request('/models?capability=chat');

      expect(res.status).toBe(200);
      const json = await res.json();
      // All 3 sample models have 'chat' capability
      expect(json.data).toHaveLength(3);
    });

    it('ignores invalid capability values (not in enum)', async () => {
      const res = await app.request('/models?capability=invalid-capability');

      expect(res.status).toBe(200);
      const json = await res.json();
      // Invalid capability is silently ignored - returns all models
      expect(json.data).toHaveLength(3);
    });

    it('filters models by enabled=true', async () => {
      const res = await app.request('/models?enabled=true');

      expect(res.status).toBe(200);
      const json = await res.json();
      // Only sampleModel and sampleModelOpenAI are enabled
      expect(json.data).toHaveLength(2);
      expect(json.data.every((m: { isEnabled: boolean }) => m.isEnabled)).toBe(true);
    });

    it('does not filter models when enabled param is not "true"', async () => {
      const res = await app.request('/models?enabled=false');

      expect(res.status).toBe(200);
      const json = await res.json();
      // enabled=false does not trigger the filter (only "true" does)
      expect(json.data).toHaveLength(3);
    });

    it('combines provider and capability filters', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleModel, sampleModelOpenAI]);

      const res = await app.request('/models?provider=anthropic&capability=vision');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].providerId).toBe('anthropic');
    });

    it('combines provider and enabled filters', async () => {
      mockGetMergedModels.mockResolvedValueOnce([
        sampleModel,
        sampleModelOpenAI,
        sampleModelDisabled,
      ]);

      const res = await app.request('/models?provider=openai&enabled=true');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].modelId).toBe('gpt-4');
    });

    it('response includes standard meta envelope', async () => {
      const res = await app.request('/models');

      const json = await res.json();
      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });

  // ========================================================================
  // GET /models/capabilities/list
  // ========================================================================

  describe('GET /models/capabilities/list', () => {
    it('returns exactly 10 capabilities', async () => {
      const res = await app.request('/models/capabilities/list');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(10);
    });

    it('returns capabilities with id, name, and description fields', async () => {
      const res = await app.request('/models/capabilities/list');

      const json = await res.json();
      for (const cap of json.data) {
        expect(cap.id).toBeDefined();
        expect(cap.name).toBeDefined();
        expect(cap.description).toBeDefined();
      }
    });

    it('includes expected capability IDs', async () => {
      const res = await app.request('/models/capabilities/list');

      const json = await res.json();
      const ids = json.data.map((c: { id: string }) => c.id);
      expect(ids).toContain('chat');
      expect(ids).toContain('code');
      expect(ids).toContain('vision');
      expect(ids).toContain('function_calling');
      expect(ids).toContain('json_mode');
      expect(ids).toContain('streaming');
      expect(ids).toContain('embeddings');
      expect(ids).toContain('image_generation');
      expect(ids).toContain('audio');
      expect(ids).toContain('reasoning');
    });

    it('is accessible before /:provider route (route ordering)', async () => {
      // This test verifies that /capabilities/list is NOT swallowed by /:provider
      const res = await app.request('/models/capabilities/list');

      expect(res.status).toBe(200);
      await res.json();
      // getMergedModels should NOT be called for capabilities route
      expect(mockGetMergedModels).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // GET /models/:provider
  // ========================================================================

  describe('GET /models/:provider', () => {
    it('returns all models for a provider', async () => {
      const res = await app.request('/models/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data.every((m: { providerId: string }) => m.providerId === 'openai')).toBe(true);
    });

    it('returns empty array for unknown provider', async () => {
      const res = await app.request('/models/unknown-provider');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    it('calls getMergedModels with correct userId', async () => {
      await app.request('/models/anthropic');

      expect(mockGetMergedModels).toHaveBeenCalledWith('user-1');
    });
  });

  // ========================================================================
  // GET /models/:provider/:model
  // ========================================================================

  describe('GET /models/:provider/:model', () => {
    it('returns a specific model when found', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.modelId).toBe('claude-3-sonnet');
      expect(json.data.providerId).toBe('anthropic');
    });

    it('returns 404 when model is not found', async () => {
      const res = await app.request('/models/anthropic/nonexistent-model');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when provider does not match', async () => {
      const res = await app.request('/models/openai/claude-3-sonnet');

      expect(res.status).toBe(404);
    });

    it('decodes URL-encoded model IDs', async () => {
      mockGetMergedModels.mockResolvedValueOnce([
        {
          ...sampleModel,
          modelId: 'claude-3.5-sonnet-20241022',
          providerId: 'anthropic',
        },
      ]);

      const res = await app.request('/models/anthropic/claude-3.5-sonnet-20241022');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.modelId).toBe('claude-3.5-sonnet-20241022');
    });
  });

  // ========================================================================
  // POST /models - Create custom model
  // ========================================================================

  describe('POST /models', () => {
    it('creates a custom model and returns it', async () => {
      const body = {
        providerId: 'anthropic',
        modelId: 'claude-custom',
        displayName: 'My Custom Claude',
      };

      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'anthropic',
          modelId: 'claude-custom',
          userId: 'user-1',
          isCustom: true,
        })
      );
    });

    it('broadcasts data:changed event on creation', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'anthropic', modelId: 'new-model' }),
      });

      expect(res.status).toBe(200);
      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_config',
        action: 'created',
      });
    });

    it('returns 400 when providerId is missing', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: 'some-model' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('Provider ID and Model ID are required');
    });

    it('returns 400 when modelId is missing', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'anthropic' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when both providerId and modelId are missing', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Something' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when upsertModel throws', async () => {
      mockModelConfigsRepo.upsertModel.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'anthropic', modelId: 'new-model' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CREATE_FAILED');
      expect(json.error.message).toContain('Failed to create model');
    });

    it('forces isCustom=true regardless of request body', async () => {
      await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'openai', modelId: 'test', isCustom: false }),
      });

      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({ isCustom: true })
      );
    });
  });

  // ========================================================================
  // PUT /models/:provider/:model - Update model config
  // ========================================================================

  describe('PUT /models/:provider/:model', () => {
    it('updates an existing model and returns updated config', async () => {
      const updatedModel = { ...sampleModel, displayName: 'Updated Name' };
      mockModelConfigsRepo.upsertModel.mockResolvedValueOnce(updatedModel);

      const res = await app.request('/models/anthropic/claude-3-sonnet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('Model updated');
      expect(json.data.data).toBeDefined();
    });

    it('broadcasts data:changed event on update', async () => {
      await app.request('/models/anthropic/claude-3-sonnet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_config',
        action: 'updated',
      });
    });

    it('returns 404 when model does not exist', async () => {
      const res = await app.request('/models/anthropic/nonexistent-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'New Name' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when upsertModel throws', async () => {
      mockModelConfigsRepo.upsertModel.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/models/anthropic/claude-3-sonnet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });

    it('preserves isCustom from the existing model on update', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleCustomModel]);

      await app.request('/models/anthropic/claude-custom', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'New Name' }),
      });

      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({ isCustom: true })
      );
    });
  });

  // ========================================================================
  // DELETE /models/:provider/:model
  // ========================================================================

  describe('DELETE /models/:provider/:model', () => {
    it('deletes a custom model successfully', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleCustomModel]);

      const res = await app.request('/models/anthropic/claude-custom', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('Custom model deleted');
      expect(json.data.deleted).toBe(true);
    });

    it('removes override when model has hasOverride=true but is not custom', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleModelWithOverride]);

      const res = await app.request('/models/openai/gpt-4-override', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Override removed');
    });

    it('broadcasts data:changed event on deletion', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleCustomModel]);

      await app.request('/models/anthropic/claude-custom', {
        method: 'DELETE',
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_config',
        action: 'deleted',
      });
    });

    it('returns 404 when model does not exist', async () => {
      const res = await app.request('/models/anthropic/nonexistent-model', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when model is built-in with no override', async () => {
      // sampleModel has isCustom=false and hasOverride=false
      mockGetMergedModels.mockResolvedValueOnce([sampleModel]);

      const res = await app.request('/models/anthropic/claude-3-sonnet', {
        method: 'DELETE',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
      expect(json.error.message).toContain('Cannot delete built-in model without override');
    });

    it('calls deleteModel with correct parameters', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleCustomModel]);

      await app.request('/models/anthropic/claude-custom', {
        method: 'DELETE',
      });

      expect(mockModelConfigsRepo.deleteModel).toHaveBeenCalledWith(
        'user-1',
        'anthropic',
        'claude-custom'
      );
    });

    it('handles URL-encoded model IDs in DELETE', async () => {
      const modelWithSlash = {
        ...sampleCustomModel,
        modelId: 'org/my-model',
        isCustom: true,
      };
      mockGetMergedModels.mockResolvedValueOnce([modelWithSlash]);
      mockModelConfigsRepo.deleteModel.mockResolvedValueOnce(true);

      const res = await app.request('/models/anthropic/org%2Fmy-model', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // PATCH /models/:provider/:model/toggle - Toggle model enabled
  // ========================================================================

  describe('PATCH /models/:provider/:model/toggle', () => {
    it('enables a model successfully', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('Model enabled');
      expect(json.data.enabled).toBe(true);
    });

    it('disables a model successfully', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Model disabled');
      expect(json.data.enabled).toBe(false);
    });

    it('broadcasts data:changed event on toggle', async () => {
      await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_config',
        action: 'updated',
      });
    });

    it('returns 400 when enabled field is missing', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ somethingElse: true }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('enabled field required');
    });

    it('returns 400 when enabled is a string instead of boolean', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'true' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when model does not exist', async () => {
      const res = await app.request('/models/anthropic/nonexistent-model/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when upsertModel throws during toggle', async () => {
      mockModelConfigsRepo.upsertModel.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('TOGGLE_FAILED');
      expect(json.error.message).toContain('Failed to toggle model');
    });

    it('calls upsertModel with correct isEnabled value', async () => {
      await app.request('/models/anthropic/claude-3-sonnet/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerId: 'anthropic',
          modelId: 'claude-3-sonnet',
          isEnabled: false,
        })
      );
    });

    it('preserves isCustom flag from existing model when toggling', async () => {
      mockGetMergedModels.mockResolvedValueOnce([sampleCustomModel]);

      await app.request('/models/anthropic/claude-custom/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({ isCustom: true })
      );
    });
  });
});
