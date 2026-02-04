/**
 * Media Settings Routes Tests
 *
 * Integration tests for the media settings API endpoints.
 * Mocks mediaSettingsRepo, settingsRepo, and AVAILABLE_PROVIDERS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMediaSettingsRepo = {
  getEffective: vi.fn(async () => null),
  set: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
};

const mockSettingsRepo = {
  get: vi.fn((key: string) => {
    if (key === 'openai_api_key') return 'sk-test-key-123';
    if (key === 'elevenlabs_api_key') return 'el-test-key';
    return null;
  }),
};

const mockAvailableProviders = {
  image_generation: [
    {
      provider: 'openai',
      displayName: 'OpenAI DALL-E',
      models: [
        { id: 'dall-e-3', name: 'DALL-E 3', default: true },
        { id: 'dall-e-2', name: 'DALL-E 2' },
      ],
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
  ],
  vision: [
    {
      provider: 'openai',
      displayName: 'OpenAI Vision',
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
  ],
  tts: [
    {
      provider: 'elevenlabs',
      displayName: 'ElevenLabs',
      apiKeyEnv: 'ELEVENLABS_API_KEY',
      requiresApiKey: true,
    },
  ],
  stt: [
    {
      provider: 'openai',
      displayName: 'OpenAI Whisper',
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
  ],
  weather: [],
};

vi.mock('../db/repositories/index.js', () => ({
  mediaSettingsRepo: mockMediaSettingsRepo,
  settingsRepo: mockSettingsRepo,
  AVAILABLE_PROVIDERS: mockAvailableProviders,
}));

// Import after mocks
const { mediaSettingsRoutes } = await import('./media-settings.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/media', mediaSettingsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Media Settings Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaSettingsRepo.getEffective.mockResolvedValue(null);
    mockSettingsRepo.get.mockImplementation((key: string) => {
      if (key === 'openai_api_key') return 'sk-test-key-123';
      if (key === 'elevenlabs_api_key') return 'el-test-key';
      return null;
    });
    app = createApp();
  });

  // ========================================================================
  // GET /media
  // ========================================================================

  describe('GET /media', () => {
    it('returns all media capability settings', async () => {
      const res = await app.request('/media');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // image_generation, vision, tts, stt
      expect(json.data).toHaveLength(4);
      expect(json.data[0].capability).toBe('image_generation');
      expect(json.data[0].name).toBe('Image Generation');
    });

    it('includes current provider when set', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue({
        provider: 'openai',
        model: 'dall-e-3',
        config: null,
      });

      const res = await app.request('/media');
      const json = await res.json();

      expect(json.data[0].currentProvider).toBe('openai');
      expect(json.data[0].currentModel).toBe('dall-e-3');
    });
  });

  // ========================================================================
  // GET /media/:capability
  // ========================================================================

  describe('GET /media/:capability', () => {
    it('returns settings for a specific capability', async () => {
      const res = await app.request('/media/image_generation');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.capability).toBe('image_generation');
      expect(json.data.name).toBe('Image Generation');
      expect(json.data.availableProviders).toHaveLength(1);
      expect(json.data.availableProviders[0].isConfigured).toBe(true);
    });

    it('returns 400 for invalid capability', async () => {
      const res = await app.request('/media/invalid_cap');

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // ========================================================================
  // POST /media/:capability
  // ========================================================================

  describe('POST /media/:capability', () => {
    it('sets provider for a capability', async () => {
      const res = await app.request('/media/image_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'dall-e-3' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.provider).toBe('openai');
      expect(json.data.model).toBe('dall-e-3');
      expect(mockMediaSettingsRepo.set).toHaveBeenCalled();
    });

    it('returns 400 for invalid capability', async () => {
      const res = await app.request('/media/invalid_cap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when provider missing', async () => {
      const res = await app.request('/media/image_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('required');
    });

    it('returns 400 for invalid provider', async () => {
      const res = await app.request('/media/image_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'nonexistent' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid provider');
    });

    it('returns 400 when provider not configured', async () => {
      mockSettingsRepo.get.mockReturnValue(null);

      const res = await app.request('/media/image_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not configured');
    });

    it('returns 400 for invalid model', async () => {
      const res = await app.request('/media/image_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', model: 'nonexistent-model' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid model');
    });
  });

  // ========================================================================
  // DELETE /media/:capability
  // ========================================================================

  describe('DELETE /media/:capability', () => {
    it('resets setting for a capability', async () => {
      const res = await app.request('/media/image_generation', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('reset');
      expect(mockMediaSettingsRepo.delete).toHaveBeenCalledWith('default', 'image_generation');
    });

    it('returns 400 for invalid capability', async () => {
      const res = await app.request('/media/invalid_cap', { method: 'DELETE' });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /media/providers/all
  // ========================================================================

  describe('GET /media/providers/all', () => {
    it('returns providers for all capabilities', async () => {
      const res = await app.request('/media/providers/all');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.image_generation).toHaveLength(1);
      expect(json.data.tts).toHaveLength(1);
      // Providers include isConfigured status
      expect(json.data.image_generation[0].isConfigured).toBe(true);
    });
  });

  // ========================================================================
  // GET /media/status/summary
  // ========================================================================

  describe('GET /media/status/summary', () => {
    it('returns status summary for all capabilities', async () => {
      const res = await app.request('/media/status/summary');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.summary.total).toBe(4);
      expect(json.data.capabilities).toHaveLength(4);
    });

    it('shows configured status when provider is set', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue({
        provider: 'openai',
        model: 'dall-e-3',
      });

      const res = await app.request('/media/status/summary');
      const json = await res.json();

      const configuredCount = json.data.capabilities.filter(
        (c: { isConfigured: boolean }) => c.isConfigured
      ).length;
      expect(configuredCount).toBeGreaterThan(0);
      expect(json.data.summary.configured).toBe(configuredCount);
    });
  });
});
