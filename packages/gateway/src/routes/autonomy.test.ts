/**
 * Autonomy Routes Tests
 *
 * Integration tests for the autonomy API endpoints.
 * Mocks getApprovalManager, assessRisk, and autonomy constants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConfig = {
  level: 2,
  allowedTools: ['search'] as string[],
  blockedTools: ['delete_all'] as string[],
  dailyBudget: 10,
  dailySpend: 3.5,
  budgetResetAt: '2026-02-01T00:00:00Z',
  maxCostPerAction: 2,
};

const mockPendingAction = {
  id: 'action-1',
  userId: 'default',
  category: 'tool_execution',
  actionType: 'execute_shell',
  description: 'Run rm -rf /tmp/cache',
  status: 'pending',
  createdAt: '2026-01-31T10:00:00Z',
};

const mockApprovalManager = {
  getUserConfig: vi.fn((_userId: string) => ({ ...mockConfig })),
  setUserConfig: vi.fn(),
  getPendingActions: vi.fn((_userId: string) => [mockPendingAction]),
  getPendingAction: vi.fn((id: string) => (id === 'action-1' ? mockPendingAction : null)),
  requestApproval: vi.fn(),
  processDecision: vi.fn(),
  cancelPending: vi.fn((id: string) => id === 'action-1'),
  clearRememberedDecisions: vi.fn((_userId: string) => 3),
};

vi.mock('../autonomy/index.js', () => ({
  getApprovalManager: vi.fn(() => mockApprovalManager),
  assessRisk: vi.fn(
    (_category: string, _actionType: string, _params: unknown, _context: unknown, _config: unknown) => ({
      level: 'medium',
      score: 0.6,
      reasons: ['Shell command execution'],
      requiresApproval: true,
    })
  ),
  AutonomyLevel: { MANUAL: 0, CAUTIOUS: 1, BALANCED: 2, AUTONOMOUS: 3, FULL_AUTO: 4 },
  AUTONOMY_LEVEL_NAMES: {
    0: 'Manual',
    1: 'Cautious',
    2: 'Balanced',
    3: 'Autonomous',
    4: 'Full Auto',
  },
  AUTONOMY_LEVEL_DESCRIPTIONS: {
    0: 'All actions require approval',
    1: 'Low-risk actions auto-approved',
    2: 'Medium-risk actions auto-approved',
    3: 'Most actions auto-approved',
    4: 'All actions auto-approved',
  },
}));

vi.mock('../middleware/validation.js', () => ({
  validateBody: vi.fn((_schema: unknown, body: unknown) => body),
  autonomyConfigSchema: {},
  autonomyBudgetSchema: {},
}));

// Import after mocks
const { autonomyRoutes } = await import('./autonomy.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/autonomy', autonomyRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Autonomy Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApprovalManager.getUserConfig.mockImplementation(() => ({ ...mockConfig }));
    mockApprovalManager.getPendingActions.mockReturnValue([mockPendingAction]);
    mockApprovalManager.getPendingAction.mockImplementation((id: string) =>
      id === 'action-1' ? mockPendingAction : null
    );
    mockApprovalManager.cancelPending.mockImplementation((id: string) => id === 'action-1');
    mockApprovalManager.clearRememberedDecisions.mockReturnValue(3);
    app = createApp();
  });

  // ========================================================================
  // GET /autonomy/config
  // ========================================================================

  describe('GET /autonomy/config', () => {
    it('returns autonomy configuration with levels', async () => {
      const res = await app.request('/autonomy/config');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.config.level).toBe(2);
      expect(json.data.levels).toHaveLength(5);
      expect(json.data.levels[0].name).toBe('Manual');
    });
  });

  // ========================================================================
  // PATCH /autonomy/config
  // ========================================================================

  describe('PATCH /autonomy/config', () => {
    it('updates autonomy configuration', async () => {
      const res = await app.request('/autonomy/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 3 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('updated');
      expect(mockApprovalManager.setUserConfig).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /autonomy/config/reset
  // ========================================================================

  describe('POST /autonomy/config/reset', () => {
    it('resets configuration to defaults', async () => {
      const res = await app.request('/autonomy/config/reset', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('reset');
      expect(mockApprovalManager.setUserConfig).toHaveBeenCalledWith('default', {});
    });
  });

  // ========================================================================
  // GET /autonomy/levels
  // ========================================================================

  describe('GET /autonomy/levels', () => {
    it('returns all autonomy levels', async () => {
      const res = await app.request('/autonomy/levels');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.levels).toHaveLength(5);
      expect(json.data.levels[2].name).toBe('Balanced');
    });
  });

  // ========================================================================
  // POST /autonomy/level
  // ========================================================================

  describe('POST /autonomy/level', () => {
    it('sets autonomy level', async () => {
      const res = await app.request('/autonomy/level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 3 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.levelName).toBe('Balanced');
      expect(mockApprovalManager.setUserConfig).toHaveBeenCalledWith('default', { level: 3 });
    });

    it('returns 400 for invalid level', async () => {
      const res = await app.request('/autonomy/level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 10 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_LEVEL');
    });
  });

  // ========================================================================
  // POST /autonomy/assess
  // ========================================================================

  describe('POST /autonomy/assess', () => {
    it('assesses risk for an action', async () => {
      const res = await app.request('/autonomy/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'tool_execution',
          actionType: 'execute_shell',
          params: { command: 'ls' },
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.risk.level).toBe('medium');
      expect(json.data.risk.requiresApproval).toBe(true);
      expect(json.data.autonomyLevel).toBe(2);
    });

    it('returns 400 when category or actionType missing', async () => {
      const res = await app.request('/autonomy/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'tool_execution' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /autonomy/approvals
  // ========================================================================

  describe('GET /autonomy/approvals', () => {
    it('returns pending approvals', async () => {
      const res = await app.request('/autonomy/approvals');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pending).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  // ========================================================================
  // POST /autonomy/approvals/request
  // ========================================================================

  describe('POST /autonomy/approvals/request', () => {
    it('returns auto-approved when requestApproval returns null', async () => {
      mockApprovalManager.requestApproval.mockResolvedValue(null);

      const res = await app.request('/autonomy/approvals/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'tool_execution',
          actionType: 'search',
          description: 'Search for files',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.autoApproved).toBe(true);
    });

    it('returns pending request when approval required', async () => {
      mockApprovalManager.requestApproval.mockResolvedValue(mockPendingAction);

      const res = await app.request('/autonomy/approvals/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'tool_execution',
          actionType: 'execute_shell',
          description: 'Run cleanup',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.approved).toBe(false);
      expect(json.data.request).toBeDefined();
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/autonomy/approvals/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'tool_execution' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 on manager error', async () => {
      mockApprovalManager.requestApproval.mockRejectedValue(new Error('Manager failed'));

      const res = await app.request('/autonomy/approvals/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'tool_execution',
          actionType: 'shell',
          description: 'Test',
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('APPROVAL_ERROR');
    });
  });

  // ========================================================================
  // GET /autonomy/approvals/:id
  // ========================================================================

  describe('GET /autonomy/approvals/:id', () => {
    it('returns a specific pending action', async () => {
      const res = await app.request('/autonomy/approvals/action-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('action-1');
    });

    it('returns 404 for unknown action', async () => {
      const res = await app.request('/autonomy/approvals/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /autonomy/approvals/:id/decide
  // ========================================================================

  describe('POST /autonomy/approvals/:id/decide', () => {
    it('processes an approval decision', async () => {
      mockApprovalManager.processDecision.mockReturnValue({ ...mockPendingAction, status: 'approved' });

      const res = await app.request('/autonomy/approvals/action-1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', reason: 'Looks safe' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.action.status).toBe('approved');
    });

    it('returns 400 for invalid decision', async () => {
      const res = await app.request('/autonomy/approvals/action-1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_DECISION');
    });

    it('returns 404 when action not found', async () => {
      mockApprovalManager.processDecision.mockReturnValue(null);

      const res = await app.request('/autonomy/approvals/nonexistent/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /autonomy/approvals/:id/approve
  // ========================================================================

  describe('POST /autonomy/approvals/:id/approve', () => {
    it('approves a pending action', async () => {
      mockApprovalManager.processDecision.mockReturnValue({ ...mockPendingAction, status: 'approved' });

      const res = await app.request('/autonomy/approvals/action-1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Safe to proceed' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('approved');
    });

    it('returns 404 when action not found', async () => {
      mockApprovalManager.getPendingAction.mockReturnValueOnce(null);

      const res = await app.request('/autonomy/approvals/nonexistent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /autonomy/approvals/:id/reject
  // ========================================================================

  describe('POST /autonomy/approvals/:id/reject', () => {
    it('rejects a pending action', async () => {
      mockApprovalManager.processDecision.mockReturnValue({ ...mockPendingAction, status: 'rejected' });

      const res = await app.request('/autonomy/approvals/action-1/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Too risky' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('rejected');
    });
  });

  // ========================================================================
  // DELETE /autonomy/approvals/:id
  // ========================================================================

  describe('DELETE /autonomy/approvals/:id', () => {
    it('cancels a pending action', async () => {
      const res = await app.request('/autonomy/approvals/action-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('cancelled');
    });

    it('returns 404 for unknown action', async () => {
      const res = await app.request('/autonomy/approvals/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /autonomy/tools/allow
  // ========================================================================

  describe('POST /autonomy/tools/allow', () => {
    it('adds tool to allowed list', async () => {
      const res = await app.request('/autonomy/tools/allow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'web_search' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('web_search');
      expect(mockApprovalManager.setUserConfig).toHaveBeenCalled();
    });

    it('returns 400 when tool missing', async () => {
      const res = await app.request('/autonomy/tools/allow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // POST /autonomy/tools/block
  // ========================================================================

  describe('POST /autonomy/tools/block', () => {
    it('adds tool to blocked list', async () => {
      const res = await app.request('/autonomy/tools/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'execute_shell' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('execute_shell');
    });
  });

  // ========================================================================
  // DELETE /autonomy/tools/:tool
  // ========================================================================

  describe('DELETE /autonomy/tools/:tool', () => {
    it('removes tool from allowed/blocked lists', async () => {
      const res = await app.request('/autonomy/tools/search', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('search');
    });
  });

  // ========================================================================
  // DELETE /autonomy/remembered
  // ========================================================================

  describe('DELETE /autonomy/remembered', () => {
    it('clears remembered decisions', async () => {
      const res = await app.request('/autonomy/remembered', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.cleared).toBe(3);
    });
  });

  // ========================================================================
  // GET /autonomy/budget
  // ========================================================================

  describe('GET /autonomy/budget', () => {
    it('returns budget status', async () => {
      const res = await app.request('/autonomy/budget');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.dailyBudget).toBe(10);
      expect(json.data.dailySpend).toBe(3.5);
      expect(json.data.remaining).toBe(6.5);
      expect(json.data.maxCostPerAction).toBe(2);
    });
  });

  // ========================================================================
  // PATCH /autonomy/budget
  // ========================================================================

  describe('PATCH /autonomy/budget', () => {
    it('updates budget settings', async () => {
      const res = await app.request('/autonomy/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyBudget: 20, maxCostPerAction: 5 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('updated');
    });
  });
});
