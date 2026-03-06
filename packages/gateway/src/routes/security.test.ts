/**
 * Security Routes Tests
 *
 * Integration tests for the unified security scanning API endpoints.
 * Mocks the security-scanner service functions, @ownpilot/core analysis
 * utilities, and the DB repository factory functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPlatformResult = {
  overallScore: 85,
  overallLevel: 'low',
  scannedAt: '2026-03-05T00:00:00.000Z',
  sections: {
    extensions: { count: 0, issues: 0, score: 100, items: [] },
    customTools: { count: 0, issues: 0, score: 100, items: [] },
    triggers: { count: 0, issues: 0, score: 100, items: [] },
    workflows: { count: 0, issues: 0, score: 100, items: [] },
    cliTools: { count: 0, issues: 0, score: 100, items: [] },
  },
  topRisks: [],
  recommendations: [],
};

const mockSectionResult = { count: 2, issues: 0, score: 95, items: [] };

const {
  mockScanPlatform,
  mockScanExtensions,
  mockScanCustomTools,
  mockScanTriggers,
  mockScanWorkflows,
  mockScanCliPolicies,
  mockAnalyzeToolCode,
  mockCalculateSecurityScore,
  mockTriggersRepo,
  mockWorkflowsRepo,
} = vi.hoisted(() => ({
  mockScanPlatform: vi.fn(async () => mockPlatformResult),
  mockScanExtensions: vi.fn(() => mockSectionResult),
  mockScanCustomTools: vi.fn(async () => mockSectionResult),
  mockScanTriggers: vi.fn(async () => mockSectionResult),
  mockScanWorkflows: vi.fn(async () => mockSectionResult),
  mockScanCliPolicies: vi.fn(async () => mockSectionResult),
  mockAnalyzeToolCode: vi.fn(() => ({
    valid: true,
    errors: [],
    warnings: [],
    dataFlowRisks: [],
    bestPractices: [],
    suggestedPermissions: [],
  })),
  mockCalculateSecurityScore: vi.fn(() => ({ score: 90, category: 'safe' })),
  mockTriggersRepo: { get: vi.fn(), list: vi.fn(async () => []) },
  mockWorkflowsRepo: { get: vi.fn(), getPage: vi.fn(async () => []) },
}));

vi.mock('../services/security-scanner.js', () => ({
  scanPlatform: mockScanPlatform,
  scanExtensions: mockScanExtensions,
  scanCustomTools: mockScanCustomTools,
  scanTriggers: mockScanTriggers,
  scanWorkflows: mockScanWorkflows,
  scanCliPolicies: mockScanCliPolicies,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    analyzeToolCode: mockAnalyzeToolCode,
    calculateSecurityScore: mockCalculateSecurityScore,
  };
});

vi.mock('../db/repositories/index.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createTriggersRepository: vi.fn(() => mockTriggersRepo),
    createWorkflowsRepository: vi.fn(() => mockWorkflowsRepo),
  };
});

// Import after mocks
const { securityRoutes } = await import('./security.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/security', securityRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScanPlatform.mockResolvedValue(mockPlatformResult);
    mockScanExtensions.mockReturnValue(mockSectionResult);
    mockScanCustomTools.mockResolvedValue(mockSectionResult);
    mockScanTriggers.mockResolvedValue(mockSectionResult);
    mockScanWorkflows.mockResolvedValue(mockSectionResult);
    mockScanCliPolicies.mockResolvedValue(mockSectionResult);
    app = createApp();
  });

  // -------------------------------------------------------------------------
  // POST /scan — full platform scan
  // -------------------------------------------------------------------------

  describe('POST /security/scan', () => {
    it('returns full platform scan result', async () => {
      const res = await app.request('/security/scan', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.overallScore).toBe(85);
      expect(json.data.overallLevel).toBe('low');
      expect(json.data.sections).toBeDefined();
      expect(mockScanPlatform).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/extensions
  // -------------------------------------------------------------------------

  describe('POST /security/scan/extensions', () => {
    it('returns extension scan result', async () => {
      const res = await app.request('/security/scan/extensions', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.score).toBe(95);
      expect(mockScanExtensions).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/custom-tools
  // -------------------------------------------------------------------------

  describe('POST /security/scan/custom-tools', () => {
    it('returns custom tools scan result', async () => {
      const res = await app.request('/security/scan/custom-tools', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.count).toBe(2);
      expect(mockScanCustomTools).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/custom-tool — single tool scan
  // -------------------------------------------------------------------------

  describe('POST /security/scan/custom-tool', () => {
    it('analyzes provided code and returns security result', async () => {
      const res = await app.request('/security/scan/custom-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return "hello";', name: 'my-tool', permissions: ['read'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('my-tool');
      expect(json.data.score).toBe(90);
      expect(json.data.category).toBe('safe');
      expect(json.data.valid).toBe(true);
      expect(mockAnalyzeToolCode).toHaveBeenCalledWith('return "hello";', ['read']);
      expect(mockCalculateSecurityScore).toHaveBeenCalledWith('return "hello";', ['read']);
    });

    it('uses "unnamed" when name is omitted', async () => {
      const res = await app.request('/security/scan/custom-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return 42;' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('unnamed');
    });

    it('returns 400 when code is missing', async () => {
      const res = await app.request('/security/scan/custom-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my-tool' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('code is required');
    });

    it('returns 400 when code is not a string', async () => {
      const res = await app.request('/security/scan/custom-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 123 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('code is required');
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/triggers
  // -------------------------------------------------------------------------

  describe('POST /security/scan/triggers', () => {
    it('returns triggers scan result', async () => {
      const res = await app.request('/security/scan/triggers', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.issues).toBe(0);
      expect(mockScanTriggers).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/trigger — single trigger scan
  // -------------------------------------------------------------------------

  describe('POST /security/scan/trigger', () => {
    it('returns scan result for existing trigger', async () => {
      mockTriggersRepo.get.mockResolvedValueOnce({ id: 'trg-1', name: 'My Trigger' });
      mockScanTriggers.mockResolvedValueOnce({
        count: 1,
        issues: 0,
        score: 95,
        items: [{ id: 'trg-1', name: 'My Trigger', score: 95, risks: [] }],
      });

      const res = await app.request('/security/scan/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerId: 'trg-1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('trg-1');
      expect(json.data.score).toBe(95);
    });

    it('returns default safe result when trigger not found in scan items', async () => {
      mockTriggersRepo.get.mockResolvedValueOnce({ id: 'trg-2', name: 'Other Trigger' });
      // scanTriggers returns items without trg-2
      mockScanTriggers.mockResolvedValueOnce({ count: 0, issues: 0, score: 100, items: [] });

      const res = await app.request('/security/scan/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerId: 'trg-2' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('trg-2');
      expect(json.data.score).toBe(100);
      expect(json.data.risks).toEqual([]);
    });

    it('returns 400 when triggerId is missing', async () => {
      const res = await app.request('/security/scan/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('triggerId is required');
    });

    it('returns 404 when trigger does not exist in DB', async () => {
      mockTriggersRepo.get.mockResolvedValueOnce(null);

      const res = await app.request('/security/scan/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerId: 'nonexistent' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/workflows
  // -------------------------------------------------------------------------

  describe('POST /security/scan/workflows', () => {
    it('returns workflows scan result', async () => {
      const res = await app.request('/security/scan/workflows', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockScanWorkflows).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/workflow — single workflow scan
  // -------------------------------------------------------------------------

  describe('POST /security/scan/workflow', () => {
    it('returns scan result for existing workflow', async () => {
      mockWorkflowsRepo.get.mockResolvedValueOnce({ id: 'wf-1', name: 'My Workflow' });
      mockScanWorkflows.mockResolvedValueOnce({
        count: 1,
        issues: 0,
        score: 88,
        items: [{ id: 'wf-1', name: 'My Workflow', score: 88, riskyNodes: [] }],
      });

      const res = await app.request('/security/scan/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'wf-1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wf-1');
      expect(json.data.score).toBe(88);
    });

    it('returns default safe result when workflow not found in scan items', async () => {
      mockWorkflowsRepo.get.mockResolvedValueOnce({ id: 'wf-2', name: 'Other Workflow' });
      mockScanWorkflows.mockResolvedValueOnce({ count: 0, issues: 0, score: 100, items: [] });

      const res = await app.request('/security/scan/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'wf-2' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('wf-2');
      expect(json.data.score).toBe(100);
      expect(json.data.riskyNodes).toEqual([]);
    });

    it('returns 400 when workflowId is missing', async () => {
      const res = await app.request('/security/scan/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('workflowId is required');
    });

    it('returns 404 when workflow does not exist in DB', async () => {
      mockWorkflowsRepo.get.mockResolvedValueOnce(null);

      const res = await app.request('/security/scan/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'nonexistent' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /scan/cli-tools
  // -------------------------------------------------------------------------

  describe('POST /security/scan/cli-tools', () => {
    it('returns CLI tool policies scan result', async () => {
      const res = await app.request('/security/scan/cli-tools', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockScanCliPolicies).toHaveBeenCalledOnce();
    });
  });
});
