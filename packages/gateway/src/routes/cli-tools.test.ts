/**
 * CLI Tools Routes Tests
 *
 * Integration tests for the CLI tool discovery, policy management,
 * installation, and custom tool registration API.
 * Mocks getCliToolService, cliProvidersRepo, cliToolPoliciesRepo,
 * CLI_TOOLS_BY_NAME, and clearDiscoveryCache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock: CliToolService singleton factory
// ---------------------------------------------------------------------------

const mockCliToolService = {
  listTools: vi.fn(),
  setToolPolicy: vi.fn(),
  getToolPolicy: vi.fn(),
  installTool: vi.fn(),
  refreshDiscovery: vi.fn(),
};

vi.mock('../services/cli-tool-service.js', () => ({
  getCliToolService: vi.fn(() => mockCliToolService),
}));

// ---------------------------------------------------------------------------
// Mock: CLI Tools Catalog — controls collision check for custom tool names
// ---------------------------------------------------------------------------

vi.mock('../services/cli-tools-catalog.js', () => ({
  CLI_TOOLS_BY_NAME: new Map([
    ['eslint', { name: 'eslint' }],
    ['prettier', { name: 'prettier' }],
  ]),
}));

// ---------------------------------------------------------------------------
// Mock: cliProvidersRepo (singleton instance)
// ---------------------------------------------------------------------------

const mockCliProvidersRepo = {
  create: vi.fn(),
  getByName: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../db/repositories/cli-providers.js', () => ({
  cliProvidersRepo: mockCliProvidersRepo,
}));

// ---------------------------------------------------------------------------
// Mock: cliToolPoliciesRepo (singleton instance)
// ---------------------------------------------------------------------------

const mockCliToolPoliciesRepo = {
  batchSetPolicies: vi.fn(),
  setPolicy: vi.fn(),
  deletePolicy: vi.fn(),
};

vi.mock('../db/repositories/cli-tool-policies.js', () => ({
  cliToolPoliciesRepo: mockCliToolPoliciesRepo,
}));

// ---------------------------------------------------------------------------
// Mock: clearDiscoveryCache
// ---------------------------------------------------------------------------

vi.mock('../services/cli-tools-discovery.js', () => ({
  clearDiscoveryCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import route after mocks
// ---------------------------------------------------------------------------

const { cliToolsRoutes } = await import('./cli-tools.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/cli-tools', cliToolsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeToolStatus(overrides: Record<string, unknown> = {}) {
  return {
    name: 'eslint',
    displayName: 'ESLint',
    category: 'linter',
    riskLevel: 'low',
    policy: 'allowed',
    source: 'catalog',
    installed: true,
    version: '8.0.0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI Tools Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // =========================================================================
  // GET /cli-tools — list all tools
  // =========================================================================

  describe('GET /cli-tools', () => {
    it('returns list of all CLI tools', async () => {
      const tools = [
        makeToolStatus({ name: 'eslint' }),
        makeToolStatus({ name: 'prettier', category: 'formatter' }),
      ];
      mockCliToolService.listTools.mockResolvedValue(tools);

      const res = await app.request('/cli-tools');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(mockCliToolService.listTools).toHaveBeenCalledWith('default');
    });

    it('returns 500 when service throws', async () => {
      mockCliToolService.listTools.mockRejectedValue(new Error('Discovery failed'));

      const res = await app.request('/cli-tools');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('Discovery failed');
    });
  });

  // =========================================================================
  // GET /cli-tools/policies
  // =========================================================================

  describe('GET /cli-tools/policies', () => {
    it('returns policies summary for all tools', async () => {
      const tools = [
        makeToolStatus({ name: 'eslint', policy: 'allowed' }),
        makeToolStatus({ name: 'docker', riskLevel: 'high', policy: 'blocked' }),
      ];
      mockCliToolService.listTools.mockResolvedValue(tools);

      const res = await app.request('/cli-tools/policies');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      // Each entry should have trimmed fields only
      expect(json.data[0]).toHaveProperty('name');
      expect(json.data[0]).toHaveProperty('policy');
      expect(json.data[0]).toHaveProperty('riskLevel');
      expect(json.data[0]).not.toHaveProperty('installed');
    });

    it('returns 500 when service throws', async () => {
      mockCliToolService.listTools.mockRejectedValue(new Error('Repo error'));

      const res = await app.request('/cli-tools/policies');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // PUT /cli-tools/policies/:toolName
  // =========================================================================

  describe('PUT /cli-tools/policies/:toolName', () => {
    it('updates tool policy and returns new policy', async () => {
      mockCliToolService.setToolPolicy.mockResolvedValue(undefined);
      mockCliToolService.getToolPolicy.mockResolvedValue('blocked');

      const res = await app.request('/cli-tools/policies/eslint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'blocked' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.toolName).toBe('eslint');
      expect(json.data.policy).toBe('blocked');
      expect(mockCliToolService.setToolPolicy).toHaveBeenCalledWith('eslint', 'blocked', 'default');
    });

    it('returns 400 when policy value is invalid', async () => {
      const res = await app.request('/cli-tools/policies/eslint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'yolo' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain("policy must be 'allowed'");
    });

    it('returns 400 when body is not valid JSON', async () => {
      const res = await app.request('/cli-tools/policies/eslint', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when service throws', async () => {
      mockCliToolService.setToolPolicy.mockRejectedValue(new Error('Policy save failed'));

      const res = await app.request('/cli-tools/policies/eslint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'allowed' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Policy save failed');
    });
  });

  // =========================================================================
  // POST /cli-tools/:name/install
  // =========================================================================

  describe('POST /cli-tools/:name/install', () => {
    it('installs a tool and returns result', async () => {
      const result = { success: true, method: 'npm-global', output: 'installed eslint@8.0.0' };
      mockCliToolService.installTool.mockResolvedValue(result);

      const res = await app.request('/cli-tools/eslint/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'npm-global' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.success).toBe(true);
      expect(mockCliToolService.installTool).toHaveBeenCalledWith(
        'eslint',
        'npm-global',
        'default'
      );
    });

    it('returns 422 when install fails', async () => {
      const result = { success: false, error: 'npm not found' };
      mockCliToolService.installTool.mockResolvedValue(result);

      const res = await app.request('/cli-tools/eslint/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'npm-global' }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.data.success).toBe(false);
    });

    it('returns 400 when install method is invalid', async () => {
      const res = await app.request('/cli-tools/eslint/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'apt-get' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain("method must be 'npm-global'");
    });

    it('defaults method to npm-global when not provided', async () => {
      const result = { success: true };
      mockCliToolService.installTool.mockResolvedValue(result);

      await app.request('/cli-tools/prettier/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockCliToolService.installTool).toHaveBeenCalledWith(
        'prettier',
        'npm-global',
        'default'
      );
    });

    it('returns 500 when service throws', async () => {
      mockCliToolService.installTool.mockRejectedValue(new Error('spawn error'));

      const res = await app.request('/cli-tools/eslint/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'npm-global' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /cli-tools/refresh
  // =========================================================================

  describe('POST /cli-tools/refresh', () => {
    it('refreshes tool discovery and returns refreshed: true', async () => {
      mockCliToolService.refreshDiscovery.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/refresh', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.refreshed).toBe(true);
      expect(mockCliToolService.refreshDiscovery).toHaveBeenCalledOnce();
    });

    it('returns 500 when service throws', async () => {
      mockCliToolService.refreshDiscovery.mockRejectedValue(new Error('Scan error'));

      const res = await app.request('/cli-tools/refresh', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('Scan error');
    });
  });

  // =========================================================================
  // POST /cli-tools/policies/batch
  // =========================================================================

  describe('POST /cli-tools/policies/batch', () => {
    it('batch-updates policies by riskLevel', async () => {
      const tools = [
        makeToolStatus({ name: 'docker', riskLevel: 'high' }),
        makeToolStatus({ name: 'kubectl', riskLevel: 'high' }),
      ];
      mockCliToolService.listTools.mockResolvedValue(tools);
      mockCliToolPoliciesRepo.batchSetPolicies.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'blocked', riskLevel: 'high' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(2);
      expect(json.data.policy).toBe('blocked');
    });

    it('batch-updates policies by explicit tool list', async () => {
      mockCliToolService.listTools.mockResolvedValue([]);
      mockCliToolPoliciesRepo.batchSetPolicies.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'allowed', tools: ['eslint', 'prettier'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).toBe(2);
      expect(mockCliToolPoliciesRepo.batchSetPolicies).toHaveBeenCalledWith(
        expect.arrayContaining([
          { toolName: 'eslint', policy: 'allowed' },
          { toolName: 'prettier', policy: 'allowed' },
        ]),
        'default'
      );
    });

    it('returns 400 when policy is missing', async () => {
      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskLevel: 'high' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain("policy must be 'allowed'");
    });

    it('returns 400 when neither riskLevel nor tools is provided', async () => {
      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'blocked' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Provide 'riskLevel' or 'tools' array");
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'bad',
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when repository throws', async () => {
      mockCliToolService.listTools.mockResolvedValue([
        makeToolStatus({ name: 'docker', riskLevel: 'high' }),
      ]);
      mockCliToolPoliciesRepo.batchSetPolicies.mockRejectedValue(new Error('Batch write failed'));

      const res = await app.request('/cli-tools/policies/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'blocked', riskLevel: 'high' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /cli-tools/custom
  // =========================================================================

  describe('POST /cli-tools/custom', () => {
    it('registers a custom tool and returns 201', async () => {
      const provider = { id: 'prov-1', name: 'my-tool' };
      mockCliProvidersRepo.create.mockResolvedValue(provider);
      mockCliToolPoliciesRepo.setPolicy.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my-tool',
          displayName: 'My Tool',
          binaryName: 'my-tool',
          category: 'utility',
          riskLevel: 'low',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('custom:my-tool');
      expect(json.data.policy).toBe('allowed'); // low risk → allowed
      expect(json.data.providerId).toBe('prov-1');
    });

    it('sets policy to blocked for critical risk tools', async () => {
      const provider = { id: 'prov-2', name: 'danger-tool' };
      mockCliProvidersRepo.create.mockResolvedValue(provider);
      mockCliToolPoliciesRepo.setPolicy.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'danger-tool',
          displayName: 'Danger Tool',
          binaryName: 'danger',
          riskLevel: 'critical',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.policy).toBe('blocked');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my-tool' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('name, displayName, and binaryName are required');
    });

    it('returns 400 when name has invalid characters', async () => {
      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Tool!',
          displayName: 'My Tool',
          binaryName: 'my-tool',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('lowercase alphanumeric');
    });

    it('returns 400 when name collides with catalog tool', async () => {
      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'eslint',
          displayName: 'ESLint Custom',
          binaryName: 'eslint',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('already exists in the catalog');
    });

    it('returns 400 for invalid category', async () => {
      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my-tool',
          displayName: 'My Tool',
          binaryName: 'my-tool',
          category: 'magic',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid category');
    });

    it('returns 400 for invalid riskLevel', async () => {
      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my-tool',
          displayName: 'My Tool',
          binaryName: 'my-tool',
          riskLevel: 'extreme',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Invalid riskLevel');
    });

    it('returns 500 when repository create throws', async () => {
      mockCliProvidersRepo.create.mockRejectedValue(new Error('Unique constraint'));

      const res = await app.request('/cli-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'unique-tool',
          displayName: 'Unique Tool',
          binaryName: 'unique',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // DELETE /cli-tools/custom/:name
  // =========================================================================

  describe('DELETE /cli-tools/custom/:name', () => {
    it('deletes an existing custom tool', async () => {
      const provider = { id: 'prov-1', name: 'my-tool' };
      mockCliProvidersRepo.getByName.mockResolvedValue(provider);
      mockCliProvidersRepo.delete.mockResolvedValue(undefined);
      mockCliToolPoliciesRepo.deletePolicy.mockResolvedValue(undefined);

      const res = await app.request('/cli-tools/custom/my-tool', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(json.data.name).toBe('custom:my-tool');
      expect(mockCliProvidersRepo.delete).toHaveBeenCalledWith('prov-1');
    });

    it('returns 404 when custom tool not found', async () => {
      mockCliProvidersRepo.getByName.mockResolvedValue(null);

      const res = await app.request('/cli-tools/custom/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain("Custom tool 'nonexistent' not found");
    });

    it('returns 500 when repository throws', async () => {
      mockCliProvidersRepo.getByName.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/cli-tools/custom/my-tool', { method: 'DELETE' });

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
      mockCliToolService.listTools.mockResolvedValue([]);

      const res = await app.request('/cli-tools');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
      expect(new Date(json.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('error responses include meta.timestamp', async () => {
      mockCliProvidersRepo.getByName.mockResolvedValue(null);

      const res = await app.request('/cli-tools/custom/missing', { method: 'DELETE' });
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});
