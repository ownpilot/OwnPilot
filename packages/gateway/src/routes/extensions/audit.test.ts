/**
 * Extensions Audit Routes Tests
 *
 * Covers:
 *   POST /:id/audit        — static + LLM analysis of an installed extension
 *   POST /audit-manifest   — static + LLM analysis of a manifest before installation
 *   runLlmAudit()          — all failure paths (no provider, no key, bad response, throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Shared mock objects — module-level so tests can override them with
// mockReturnValueOnce / mockResolvedValueOnce
// ---------------------------------------------------------------------------

const mockExtService = {
  getById: vi.fn(),
};

const mockProvider = {
  complete: vi.fn(async () => ({
    ok: true,
    value: { content: '{"verdict":"safe","trustScore":9}' },
  })),
};

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic import so vi.mock hoisting applies
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({ get: vi.fn(() => mockExtService) })),
    createProvider: vi.fn(() => mockProvider),
    getProviderConfig: vi.fn(() => null),
  };
});

vi.mock('../settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({
    provider: 'anthropic',
    model: 'claude-3-5-haiku',
  })),
  getApiKey: vi.fn(async () => 'test-api-key'),
}));

vi.mock('../../db/repositories/index.js', () => ({
  localProvidersRepo: { getProvider: vi.fn(async () => null) },
}));

vi.mock('../../services/skill-security-audit.js', () => ({
  auditSkillSecurity: vi.fn(() => ({ riskLevel: 'low', findings: [] })),
  buildLlmAuditPrompt: vi.fn(() => 'audit prompt text'),
  parseLlmAuditResponse: vi.fn(() => ({
    verdict: 'safe',
    trustScore: 9,
    risks: [],
    recommendations: [],
  })),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------

const { auditRoutes } = await import('./audit.js');

// Grab the mocked modules so tests can override per-call
const { getServiceRegistry, createProvider } = await import('@ownpilot/core');
const { resolveProviderAndModel, getApiKey } = await import('../settings.js');
const { localProvidersRepo } = await import('../../db/repositories/index.js');
const { parseLlmAuditResponse } = await import('../../services/skill-security-audit.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/ext', auditRoutes);
  app.onError(errorHandler);
  return app;
}

function makeRequest(app: Hono, path: string, body?: Record<string, unknown>): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Minimal ExtensionRecord stub for a given userId */
function makeExtRecord(userId = 'user-1') {
  return {
    id: 'ext-1',
    userId,
    name: 'My Extension',
    format: 'ownpilot' as const,
    manifest: {
      id: 'ext-1',
      name: 'My Extension',
      version: '1.0.0',
      description: 'Test extension',
      format: 'ownpilot' as const,
    },
  };
}

/** Minimal ExtensionManifest stub */
const sampleManifest = {
  id: 'manifest-1',
  name: 'Test Manifest',
  version: '1.0.0',
  description: 'A test manifest',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extension Audit Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore defaults after each clear
    vi.mocked(getServiceRegistry).mockReturnValue({ get: vi.fn(() => mockExtService) } as never);
    vi.mocked(createProvider).mockReturnValue(mockProvider as never);
    mockExtService.getById.mockReturnValue(makeExtRecord());
    mockProvider.complete.mockResolvedValue({
      ok: true,
      value: { content: '{"verdict":"safe","trustScore":9}' },
    });
    vi.mocked(resolveProviderAndModel).mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
    });
    vi.mocked(getApiKey).mockResolvedValue('test-api-key');
    vi.mocked(localProvidersRepo.getProvider).mockResolvedValue(null);
    vi.mocked(parseLlmAuditResponse).mockReturnValue({
      verdict: 'safe',
      trustScore: 9,
      risks: [],
      recommendations: [],
    } as never);

    app = createApp();
  });

  // =========================================================================
  // POST /:id/audit — Audit an installed extension
  // =========================================================================

  describe('POST /:id/audit', () => {
    it('returns 200 with static and LLM analysis when extension is found', async () => {
      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.extensionId).toBe('ext-1');
      expect(json.data.extensionName).toBe('My Extension');
      expect(json.data.format).toBe('ownpilot');
      expect(json.data.staticAnalysis).toBeDefined();
      expect(json.data.llmAnalysis).toBeDefined();
      expect(json.data.llmAnalysis.verdict).toBe('safe');
      expect(json.data.llmAnalysis.trustScore).toBe(9);
      expect(json.data.llmError).toBeNull();
    });

    it('returns 404 when extension is not found', async () => {
      mockExtService.getById.mockReturnValueOnce(null);

      const res = await makeRequest(app, '/ext/missing-ext/audit', {});

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when extension belongs to a different user', async () => {
      mockExtService.getById.mockReturnValueOnce(makeExtRecord('other-user'));

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('skips LLM analysis and returns error when no provider model is configured', async () => {
      vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({
        provider: 'anthropic',
        model: null as unknown as string,
      });

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toContain('No AI provider configured');
    });

    it('skips LLM analysis and returns error when no provider is configured', async () => {
      vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({
        provider: null as unknown as string,
        model: 'claude-3-5-haiku',
      });

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toContain('No AI provider configured');
    });

    it('skips LLM analysis and returns error when API key is not configured', async () => {
      vi.mocked(getApiKey).mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toContain('API key not configured for provider: anthropic');
    });

    it('returns LLM error when provider complete returns ok=false', async () => {
      mockProvider.complete.mockResolvedValueOnce({
        ok: false,
        error: { message: 'Rate limit exceeded' },
      });

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toContain('LLM call failed');
      expect(json.data.llmError).toContain('Rate limit exceeded');
    });

    it('returns LLM error when LLM returns empty content', async () => {
      mockProvider.complete.mockResolvedValueOnce({
        ok: true,
        value: { content: '' },
      });

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toBe('LLM returned empty response');
    });

    it('returns LLM error when provider complete throws an exception', async () => {
      mockProvider.complete.mockRejectedValueOnce(new Error('Network timeout'));

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toBe('Network timeout');
    });

    it('uses local provider apiKey when local provider has one', async () => {
      vi.mocked(localProvidersRepo.getProvider).mockResolvedValueOnce({
        id: 'local-prov',
        name: 'Local Ollama',
        providerId: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'local-secret-key',
        isActive: true,
        models: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const res = await makeRequest(app, '/ext/ext-1/audit', {});

      expect(res.status).toBe(200);
      const json = await res.json();
      // LLM analysis should have been attempted and succeeded
      expect(json.data.llmError).toBeNull();
      expect(json.data.llmAnalysis).not.toBeNull();
      // getApiKey should NOT have been called (local provider key was used)
      expect(vi.mocked(getApiKey)).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /audit-manifest — Audit a manifest before installation
  // =========================================================================

  describe('POST /audit-manifest', () => {
    it('returns 200 with static and LLM analysis for a valid manifest', async () => {
      const res = await makeRequest(app, '/ext/audit-manifest', {
        manifest: sampleManifest,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.extensionId).toBe('manifest-1');
      expect(json.data.extensionName).toBe('Test Manifest');
      expect(json.data.format).toBe('ownpilot');
      expect(json.data.staticAnalysis).toBeDefined();
      expect(json.data.llmAnalysis).toBeDefined();
      expect(json.data.llmAnalysis.verdict).toBe('safe');
      expect(json.data.llmError).toBeNull();
    });

    it('returns 200 with format from manifest when provided', async () => {
      const res = await makeRequest(app, '/ext/audit-manifest', {
        manifest: { ...sampleManifest, format: 'agentskills' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.format).toBe('agentskills');
    });

    it('returns 400 when no manifest is present in the body', async () => {
      const res = await makeRequest(app, '/ext/audit-manifest', {});

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('manifest with id and name is required');
    });

    it('returns 400 when manifest is missing the id field', async () => {
      const res = await makeRequest(app, '/ext/audit-manifest', {
        manifest: { name: 'No Id Manifest', version: '1.0.0' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when manifest is missing the name field', async () => {
      const res = await makeRequest(app, '/ext/audit-manifest', {
        manifest: { id: 'some-id', version: '1.0.0' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('skips LLM analysis and returns error when no provider is configured', async () => {
      vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({
        provider: null as unknown as string,
        model: null as unknown as string,
      });

      const res = await makeRequest(app, '/ext/audit-manifest', {
        manifest: sampleManifest,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.llmAnalysis).toBeNull();
      expect(json.data.llmError).toContain('No AI provider configured');
    });
  });
});
