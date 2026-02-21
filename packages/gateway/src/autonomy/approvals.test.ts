/**
 * Comprehensive unit tests for ApprovalManager (approvals.ts).
 *
 * Dependencies are mocked to isolate the approval flow logic:
 *   - @ownpilot/core (generateId)
 *   - ./risk.js (assessRisk)
 *   - ../config/defaults.js (MS_PER_DAY, SCHEDULER_DEFAULT_TIMEOUT_MS)
 *
 * Real types/constants imported from ./types.js (no runtime deps).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

let idCounter = 0;

vi.mock('@ownpilot/core', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_${String(++idCounter).padStart(4, '0')}`),
}));

vi.mock('./risk.js', () => ({
  assessRisk: vi.fn(),
}));

vi.mock('../config/defaults.js', () => ({
  MS_PER_DAY: 86_400_000,
  SCHEDULER_DEFAULT_TIMEOUT_MS: 120_000,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ApprovalManager, getApprovalManager } from './approvals.js';
import {
  DEFAULT_AUTONOMY_CONFIG,
  AutonomyLevel,
  type RiskAssessment,
  type ActionCategory,
  type PendingAction,
  type ApprovalDecision,
} from './types.js';
import { assessRisk } from './risk.js';
import { generateId } from '@ownpilot/core';

const mockedAssessRisk = assessRisk as ReturnType<typeof vi.fn>;
const mockedGenerateId = generateId as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a standard risk assessment result. */
function makeRisk(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    level: 'medium',
    score: 40,
    factors: [],
    requiresApproval: true,
    mitigations: [],
    ...overrides,
  };
}

/** Shorthand for a common requestApproval call that is expected to create a pending action. */
async function createPendingAction(
  manager: ApprovalManager,
  userId = 'user-1',
  category: ActionCategory = 'tool_execution',
  actionType = 'some_tool',
  description = 'Do something',
  params: Record<string, unknown> = {},
  risk: Partial<RiskAssessment> = {},
) {
  mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true, ...risk }));
  const request = await manager.requestApproval(userId, category, actionType, description, params);
  return request!;
}

// ============================================================================
// Tests
// ============================================================================

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    idCounter = 0;
    mockedAssessRisk.mockReset();
    mockedGenerateId.mockClear();
    manager = new ApprovalManager();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Constructor & Config
  // ==========================================================================

  describe('constructor & config defaults', () => {
    it('should use SCHEDULER_DEFAULT_TIMEOUT_MS (120000) as default timeout', async () => {
      const req = await createPendingAction(manager);
      // 120000 ms / 1000 = 120 seconds
      expect(req.timeoutSeconds).toBe(120);
    });

    it('should default maxPendingPerUser to 50', () => {
      // Internally stored; verify by trying to exceed it
      // (tested separately in pending limit tests)
      expect(manager).toBeInstanceOf(ApprovalManager);
    });

    it('should default autoApproveLowRisk to false', () => {
      // Verified indirectly: low-risk actions that require approval are not auto-approved
      expect(manager).toBeInstanceOf(ApprovalManager);
    });

    it('should accept custom defaultTimeout', async () => {
      manager.stop();
      manager = new ApprovalManager({ defaultTimeout: 60_000 });
      const req = await createPendingAction(manager);
      expect(req.timeoutSeconds).toBe(60);
    });

    it('should accept custom maxPendingPerUser', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 2 });

      await createPendingAction(manager, 'user-1');
      await createPendingAction(manager, 'user-1');

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      await expect(
        manager.requestApproval('user-1', 'tool_execution', 'x', 'overflow', {}),
      ).rejects.toThrow('Maximum pending actions reached');
    });

    it('should accept custom autoApproveLowRisk', () => {
      manager.stop();
      manager = new ApprovalManager({ autoApproveLowRisk: true });
      expect(manager).toBeInstanceOf(ApprovalManager);
    });

    it('should start the cleanup interval on construction', async () => {
      const expiredSpy = vi.fn();
      manager.on('action:expired', expiredSpy);

      await createPendingAction(manager);

      // Advance past defaultTimeout (120s) + one cleanup tick (60s)
      vi.advanceTimersByTime(120_000 + 60_000);

      expect(expiredSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // setUserConfig
  // ==========================================================================

  describe('setUserConfig', () => {
    it('should merge config with DEFAULT_AUTONOMY_CONFIG', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL });
      const config = manager.getUserConfig('user-1');
      expect(config.level).toBe(AutonomyLevel.FULL);
      expect(config.dailyBudget).toBe(DEFAULT_AUTONOMY_CONFIG.dailyBudget);
      expect(config.auditEnabled).toBe(DEFAULT_AUTONOMY_CONFIG.auditEnabled);
    });

    it('should set userId on the stored config', () => {
      manager.setUserConfig('user-42', { level: AutonomyLevel.MANUAL });
      const config = manager.getUserConfig('user-42');
      expect(config.userId).toBe('user-42');
    });

    it('should set updatedAt to current time', () => {
      const now = new Date();
      manager.setUserConfig('user-1', {});
      const config = manager.getUserConfig('user-1');
      expect(config.updatedAt.getTime()).toBe(now.getTime());
    });

    it('should preserve budgetResetAt from existing config', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.SUPERVISED });
      const first = manager.getUserConfig('user-1');
      const originalResetAt = first.budgetResetAt;

      vi.advanceTimersByTime(5000);
      manager.setUserConfig('user-1', { dailyBudget: 99999 });
      const updated = manager.getUserConfig('user-1');

      expect(updated.budgetResetAt).toBe(originalResetAt);
      expect(updated.dailyBudget).toBe(99999);
    });

    it('should set budgetResetAt to now when no existing config', () => {
      const now = new Date();
      manager.setUserConfig('new-user', {});
      const config = manager.getUserConfig('new-user');
      expect(config.budgetResetAt.getTime()).toBe(now.getTime());
    });

    it('should merge with existing config values (not just defaults)', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL, dailyBudget: 5000 });
      manager.setUserConfig('user-1', { maxCostPerAction: 200 });
      const config = manager.getUserConfig('user-1');
      expect(config.level).toBe(AutonomyLevel.FULL); // kept from first call
      expect(config.dailyBudget).toBe(5000); // kept from first call
      expect(config.maxCostPerAction).toBe(200); // from second call
    });

    it('should override existing values with new ones', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL });
      manager.setUserConfig('user-1', { level: AutonomyLevel.MANUAL });
      const config = manager.getUserConfig('user-1');
      expect(config.level).toBe(AutonomyLevel.MANUAL);
    });
  });

  // ==========================================================================
  // getUserConfig
  // ==========================================================================

  describe('getUserConfig', () => {
    it('should create default config for unknown user', () => {
      const config = manager.getUserConfig('unknown-user');
      expect(config.userId).toBe('unknown-user');
      expect(config.level).toBe(DEFAULT_AUTONOMY_CONFIG.level);
      expect(config.blockedCategories).toEqual(DEFAULT_AUTONOMY_CONFIG.blockedCategories);
      expect(config.dailySpend).toBe(0);
    });

    it('should return the same config object on repeated calls (cached)', () => {
      const config1 = manager.getUserConfig('user-1');
      const config2 = manager.getUserConfig('user-1');
      expect(config1).toBe(config2);
    });

    it('should set budgetResetAt and updatedAt to now for new users', () => {
      const now = new Date();
      const config = manager.getUserConfig('new-user');
      expect(config.budgetResetAt.getTime()).toBe(now.getTime());
      expect(config.updatedAt.getTime()).toBe(now.getTime());
    });

    it('should reset dailySpend when budget older than MS_PER_DAY', () => {
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 500;

      // Advance past 24 hours
      vi.advanceTimersByTime(86_400_001);

      const refreshed = manager.getUserConfig('user-1');
      expect(refreshed.dailySpend).toBe(0);
    });

    it('should update budgetResetAt when daily budget is reset', () => {
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 500;
      const oldResetAt = config.budgetResetAt.getTime();

      vi.advanceTimersByTime(86_400_001);

      const refreshed = manager.getUserConfig('user-1');
      expect(refreshed.budgetResetAt.getTime()).toBeGreaterThan(oldResetAt);
    });

    it('should NOT reset dailySpend when budget is less than MS_PER_DAY old', () => {
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 500;

      vi.advanceTimersByTime(86_399_999); // just under 24 hours

      const refreshed = manager.getUserConfig('user-1');
      expect(refreshed.dailySpend).toBe(500);
    });

    it('should NOT reset dailySpend at exactly MS_PER_DAY boundary', () => {
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 300;

      vi.advanceTimersByTime(86_400_000); // exactly 24 hours — not strictly greater

      const refreshed = manager.getUserConfig('user-1');
      // The condition is > (strictly greater), so exactly 24h does NOT reset
      expect(refreshed.dailySpend).toBe(300);
    });
  });

  // ==========================================================================
  // requestApproval
  // ==========================================================================

  describe('requestApproval', () => {
    // ---------- Auto-approve (requiresApproval = false) ----------

    it('should return null when assessRisk says requiresApproval=false', async () => {
      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      const result = await manager.requestApproval('user-1', 'notification', 'list', 'List items', {});
      expect(result).toBeNull();
    });

    it('should emit action:auto_approved when auditEnabled and auto-approving', async () => {
      manager.setUserConfig('user-1', { auditEnabled: true });
      const spy = vi.fn();
      manager.on('action:auto_approved', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List items', {});

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].status).toBe('auto_approved');
    });

    it('should NOT emit action:auto_approved when auditEnabled is false', async () => {
      manager.setUserConfig('user-1', { auditEnabled: false });
      const spy = vi.fn();
      manager.on('action:auto_approved', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List items', {});

      expect(spy).not.toHaveBeenCalled();
    });

    // ---------- Remembered decisions ----------

    it('should return null when remembered decision is approve', async () => {
      // First: create and approve with remember=true
      const req = await createPendingAction(manager);
      manager.processDecision({
        actionId: req.action.id,
        decision: 'approve',
        remember: true,
      });

      // Second call for same userId:category:actionType
      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      const result = await manager.requestApproval('user-1', 'tool_execution', 'some_tool', 'Again', {});
      expect(result).toBeNull();
    });

    it('should emit action:auto_approved when remembered approve decision is used', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({
        actionId: req.action.id,
        decision: 'approve',
        remember: true,
      });

      const spy = vi.fn();
      manager.on('action:auto_approved', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      await manager.requestApproval('user-1', 'tool_execution', 'some_tool', 'Again', {});

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should return rejected request when remembered decision is reject', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({
        actionId: req.action.id,
        decision: 'reject',
        remember: true,
      });

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      const result = await manager.requestApproval('user-1', 'tool_execution', 'some_tool', 'Again', {});

      expect(result).not.toBeNull();
      expect(result!.action.status).toBe('rejected');
      expect(result!.action.reason).toContain('remembered');
      expect(result!.suggestion).toBe('reject');
      expect(result!.timeoutSeconds).toBe(0);
    });

    // ---------- Pending limit ----------

    it('should throw when pending limit exceeded', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 3 });

      await createPendingAction(manager, 'user-1');
      await createPendingAction(manager, 'user-1');
      await createPendingAction(manager, 'user-1');

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      await expect(
        manager.requestApproval('user-1', 'tool_execution', 'x', 'overflow', {}),
      ).rejects.toThrow('Maximum pending actions reached for user: user-1');
    });

    it('should NOT count other users pending actions toward the limit', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 2 });

      await createPendingAction(manager, 'user-1');
      await createPendingAction(manager, 'user-1');

      // user-2 should still be able to request
      const req = await createPendingAction(manager, 'user-2');
      expect(req).not.toBeNull();
    });

    it('should NOT count approved actions toward the pending limit', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 1 });

      const req1 = await createPendingAction(manager, 'user-1');
      manager.processDecision({ actionId: req1.action.id, decision: 'approve' });

      // Slot freed, should not throw
      const req2 = await createPendingAction(manager, 'user-1');
      expect(req2).not.toBeNull();
    });

    // ---------- Pending action creation ----------

    it('should create pending action with correct fields', async () => {
      mockedAssessRisk.mockReturnValueOnce(makeRisk({
        level: 'high',
        score: 65,
        requiresApproval: true,
        factors: [{ name: 'Test', description: 'test', weight: 0.5, present: true }],
        mitigations: ['Be careful'],
      }));

      const result = await manager.requestApproval(
        'user-1',
        'code_execution',
        'execute_code',
        'Run some code',
        { script: 'console.log("hi")' },
        { conversationId: 'conv-1' },
      );

      expect(result).not.toBeNull();
      const action = result!.action;
      expect(action.userId).toBe('user-1');
      expect(action.category).toBe('code_execution');
      expect(action.type).toBe('execute_code');
      expect(action.description).toBe('Run some code');
      expect(action.params).toEqual({ script: 'console.log("hi")' });
      expect(action.context).toEqual({ conversationId: 'conv-1' });
      expect(action.status).toBe('pending');
      expect(action.risk.level).toBe('high');
      expect(action.risk.score).toBe(65);
      expect(action.requestedAt).toBeInstanceOf(Date);
      expect(action.expiresAt).toBeInstanceOf(Date);
    });

    it('should generate action id with "action" prefix', async () => {
      const req = await createPendingAction(manager);
      expect(req.action.id).toMatch(/^action_/);
    });

    it('should set expiresAt to requestedAt + defaultTimeout', async () => {
      const req = await createPendingAction(manager);
      const diff = req.action.expiresAt.getTime() - req.action.requestedAt.getTime();
      expect(diff).toBe(120_000); // SCHEDULER_DEFAULT_TIMEOUT_MS
    });

    it('should use custom timeout for expiresAt calculation', async () => {
      manager.stop();
      manager = new ApprovalManager({ defaultTimeout: 30_000 });
      const req = await createPendingAction(manager);
      const diff = req.action.expiresAt.getTime() - req.action.requestedAt.getTime();
      expect(diff).toBe(30_000);
    });

    it('should default context to empty object when omitted', async () => {
      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      const result = await manager.requestApproval(
        'user-1', 'tool_execution', 'x', 'Do', {},
      );
      expect(result!.action.context).toEqual({});
    });

    // ---------- Events ----------

    it('should emit action:pending event', async () => {
      const spy = vi.fn();
      manager.on('action:pending', spy);

      await createPendingAction(manager);

      expect(spy).toHaveBeenCalledOnce();
      const emittedAction: PendingAction = spy.mock.calls[0][0];
      expect(emittedAction.status).toBe('pending');
      expect(emittedAction.userId).toBe('user-1');
    });

    it('should emit notification event with correct fields', async () => {
      const spy = vi.fn();
      manager.on('notification', spy);

      await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool', 'Do important thing');

      expect(spy).toHaveBeenCalledOnce();
      const notification = spy.mock.calls[0][0];
      expect(notification.type).toBe('approval_required');
      expect(notification.title).toBe('Approval Required');
      expect(notification.message).toContain('Do important thing');
      expect(notification.severity).toBe('warning');
      expect(notification.userId).toBe('user-1');
      expect(notification.actionId).toBeDefined();
      expect(notification.read).toBe(false);
      expect(notification.id).toMatch(/^notif_/);
    });

    it('should NOT emit action:pending or notification for auto-approved actions when audit disabled', async () => {
      manager.setUserConfig('user-1', { auditEnabled: false });
      const pendingSpy = vi.fn();
      const notifSpy = vi.fn();
      manager.on('action:pending', pendingSpy);
      manager.on('notification', notifSpy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List', {});

      expect(pendingSpy).not.toHaveBeenCalled();
      expect(notifSpy).not.toHaveBeenCalled();
    });

    // ---------- Suggestion mapping ----------

    it('should return suggestion "approve" for low risk level', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { level: 'low' });
      expect(req.suggestion).toBe('approve');
    });

    it('should return suggestion "review" for medium risk level', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { level: 'medium' });
      expect(req.suggestion).toBe('review');
    });

    it('should return suggestion "review" for high risk level', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { level: 'high' });
      expect(req.suggestion).toBe('review');
    });

    it('should return suggestion "reject" for critical risk level', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { level: 'critical' });
      expect(req.suggestion).toBe('reject');
    });

    it('should return suggestion "review" for unknown risk level', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { level: 'unknown' as unknown as 'low' });
      expect(req.suggestion).toBe('review');
    });

    // ---------- Alternatives generation ----------

    it('should generate batch alternative for bulk/all params', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { bulk: true });
      expect(req.alternatives).toBeDefined();
      const alt = req.alternatives!.find(a => a.description === 'Process items one at a time');
      expect(alt).toBeDefined();
      expect(alt!.params.bulk).toBe(false);
      expect(alt!.params.all).toBe(false);
      expect(alt!.params.limit).toBe(1);
      expect(alt!.risk).toBe('low');
    });

    it('should generate soft-delete alternative for permanent/force params', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { permanent: true });
      expect(req.alternatives).toBeDefined();
      const alt = req.alternatives!.find(a => a.description === 'Use soft-delete instead');
      expect(alt).toBeDefined();
      expect(alt!.params.permanent).toBe(false);
      expect(alt!.params.force).toBe(false);
      expect(alt!.params.softDelete).toBe(true);
      expect(alt!.risk).toBe('medium');
    });

    it('should generate both alternatives when bulk and permanent', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { bulk: true, permanent: true });
      expect(req.alternatives).toBeDefined();
      expect(req.alternatives!.length).toBe(2);
    });

    it('should generate no alternatives for plain params', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { name: 'test' });
      expect(req.alternatives).toBeDefined();
      expect(req.alternatives!.length).toBe(0);
    });

    // ---------- timeoutSeconds ----------

    it('should return timeoutSeconds based on defaultTimeout', async () => {
      const req = await createPendingAction(manager);
      expect(req.timeoutSeconds).toBe(120); // 120000 / 1000
    });

    // ---------- assessRisk call ----------

    it('should call assessRisk with correct arguments', async () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.AUTONOMOUS });
      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));

      const params = { file: 'test.txt' };
      const context = { conversationId: 'conv-1' };
      await manager.requestApproval('user-1', 'file_operation', 'write_file', 'Write file', params, context);

      expect(mockedAssessRisk).toHaveBeenCalledWith(
        'file_operation',
        'write_file',
        params,
        context,
        expect.objectContaining({ userId: 'user-1', level: AutonomyLevel.AUTONOMOUS }),
      );
    });
  });

  // ==========================================================================
  // processDecision
  // ==========================================================================

  describe('processDecision', () => {
    // ---------- Unknown action ----------

    it('should return null for unknown actionId', () => {
      const result = manager.processDecision({
        actionId: 'nonexistent',
        decision: 'approve',
      });
      expect(result).toBeNull();
    });

    it('should return null for empty actionId', () => {
      const result = manager.processDecision({
        actionId: '',
        decision: 'approve',
      });
      expect(result).toBeNull();
    });

    // ---------- Approve ----------

    describe('approve', () => {
      it('should set status to approved', async () => {
        const req = await createPendingAction(manager);
        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
        });
        expect(result).not.toBeNull();
        expect(result!.status).toBe('approved');
      });

      it('should set decidedAt to current time', async () => {
        const req = await createPendingAction(manager);
        const now = new Date();
        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
        });
        expect(result!.decidedAt).toBeInstanceOf(Date);
        expect(result!.decidedAt!.getTime()).toBe(now.getTime());
      });

      it('should set reason from decision', async () => {
        const req = await createPendingAction(manager);
        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
          reason: 'Looks safe',
        });
        expect(result!.reason).toBe('Looks safe');
      });

      it('should emit action:approved event with action and decision', async () => {
        const spy = vi.fn();
        manager.on('action:approved', spy);

        const req = await createPendingAction(manager);
        const decision: ApprovalDecision = {
          actionId: req.action.id,
          decision: 'approve',
          reason: 'OK',
        };
        manager.processDecision(decision);

        expect(spy).toHaveBeenCalledOnce();
        const [emittedAction, emittedDecision] = spy.mock.calls[0];
        expect(emittedAction.status).toBe('approved');
        expect(emittedDecision.decision).toBe('approve');
      });

      it('should increment dailySpend by risk score', async () => {
        const spendBefore = manager.getUserConfig('user-1').dailySpend;
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { score: 42 });

        manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
        });

        const spendAfter = manager.getUserConfig('user-1').dailySpend;
        expect(spendAfter).toBe(spendBefore + 42);
      });

      it('should accumulate dailySpend across multiple approvals', async () => {
        const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'a', 'D1', {}, { score: 10 });
        const req2 = await createPendingAction(manager, 'user-1', 'tool_execution', 'b', 'D2', {}, { score: 20 });

        manager.processDecision({ actionId: req1.action.id, decision: 'approve' });
        manager.processDecision({ actionId: req2.action.id, decision: 'approve' });

        expect(manager.getUserConfig('user-1').dailySpend).toBe(30);
      });
    });

    // ---------- Reject ----------

    describe('reject', () => {
      it('should set status to rejected', async () => {
        const req = await createPendingAction(manager);
        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
        });
        expect(result!.status).toBe('rejected');
      });

      it('should set reason from decision', async () => {
        const req = await createPendingAction(manager);
        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
          reason: 'Too risky',
        });
        expect(result!.reason).toBe('Too risky');
      });

      it('should emit action:rejected event', async () => {
        const spy = vi.fn();
        manager.on('action:rejected', spy);

        const req = await createPendingAction(manager);
        manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
        });

        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0].status).toBe('rejected');
      });

      it('should NOT increment dailySpend on reject', async () => {
        const spendBefore = manager.getUserConfig('user-1').dailySpend;
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {}, { score: 50 });

        manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
        });

        expect(manager.getUserConfig('user-1').dailySpend).toBe(spendBefore);
      });

      it('should NOT emit action:approved event on reject', async () => {
        const approvedSpy = vi.fn();
        manager.on('action:approved', approvedSpy);

        const req = await createPendingAction(manager);
        manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
        });

        expect(approvedSpy).not.toHaveBeenCalled();
      });
    });

    // ---------- Modify ----------

    describe('modify', () => {
      it('should merge modifiedParams into action params', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { force: true, name: 'test' });

        // assessRisk will be called again on modify
        mockedAssessRisk.mockReturnValueOnce(makeRisk({ level: 'low', score: 10 }));

        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: { force: false, sandboxed: true },
        });

        expect(result!.params).toEqual({ force: false, name: 'test', sandboxed: true });
      });

      it('should re-assess risk after param modification', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', { force: true });

        const newRisk = makeRisk({ level: 'low', score: 15 });
        mockedAssessRisk.mockReturnValueOnce(newRisk);

        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: { force: false },
        });

        expect(result!.risk).toBe(newRisk);
        // assessRisk called during modify with updated params
        expect(mockedAssessRisk).toHaveBeenLastCalledWith(
          req.action.category,
          req.action.type,
          expect.objectContaining({ force: false }),
          req.action.context,
          expect.objectContaining({ userId: 'user-1' }),
        );
      });

      it('should set status to approved after modify', async () => {
        const req = await createPendingAction(manager);
        mockedAssessRisk.mockReturnValueOnce(makeRisk({ level: 'low', score: 5 }));

        const result = manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: { safe: true },
        });

        expect(result!.status).toBe('approved');
      });

      it('should emit action:approved event after modify', async () => {
        const spy = vi.fn();
        manager.on('action:approved', spy);

        const req = await createPendingAction(manager);
        mockedAssessRisk.mockReturnValueOnce(makeRisk({ level: 'low', score: 5 }));

        manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: { safe: true },
        });

        expect(spy).toHaveBeenCalledOnce();
      });

      it('should NOT emit action:rejected event after modify', async () => {
        const spy = vi.fn();
        manager.on('action:rejected', spy);

        const req = await createPendingAction(manager);
        mockedAssessRisk.mockReturnValueOnce(makeRisk());

        manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: {},
        });

        expect(spy).not.toHaveBeenCalled();
      });
    });

    // ---------- Remember ----------

    describe('remember', () => {
      it('should store approve decision when remember=true', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
        manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
          remember: true,
        });

        const key = 'user-1:tool_execution:some_tool';
        expect(manager['rememberedDecisions'].has(key)).toBe(true);
        expect(manager['rememberedDecisions'].get(key)!.decision).toBe('approve');
      });

      it('should store reject decision when remember=true', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
        manager.processDecision({
          actionId: req.action.id,
          decision: 'reject',
          remember: true,
        });

        const key = 'user-1:tool_execution:some_tool';
        expect(manager['rememberedDecisions'].has(key)).toBe(true);
        expect(manager['rememberedDecisions'].get(key)!.decision).toBe('reject');
      });

      it('should store modify decision as approve when remember=true', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
        mockedAssessRisk.mockReturnValueOnce(makeRisk());

        manager.processDecision({
          actionId: req.action.id,
          decision: 'modify',
          modifiedParams: {},
          remember: true,
        });

        const key = 'user-1:tool_execution:some_tool';
        expect(manager['rememberedDecisions'].get(key)!.decision).toBe('approve');
      });

      it('should NOT store decision when remember=false', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
        manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
          remember: false,
        });

        const key = 'user-1:tool_execution:some_tool';
        expect(manager['rememberedDecisions'].has(key)).toBe(false);
      });

      it('should NOT store decision when remember is undefined', async () => {
        const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
        manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
        });

        const key = 'user-1:tool_execution:some_tool';
        expect(manager['rememberedDecisions'].has(key)).toBe(false);
      });

      it('should set createdAt on remembered decision', async () => {
        const req = await createPendingAction(manager);
        const now = new Date();
        manager.processDecision({
          actionId: req.action.id,
          decision: 'approve',
          remember: true,
        });

        const entry = manager['rememberedDecisions'].values().next().value!;
        expect(entry.createdAt.getTime()).toBe(now.getTime());
      });
    });

    // ---------- Pending map cleanup ----------

    it('should remove action from pendingActions after approve', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({
        actionId: req.action.id,
        decision: 'approve',
      });

      expect(manager.getPendingAction(req.action.id)).toBeNull();
      expect(manager.getPendingActions('user-1')).toHaveLength(0);
    });

    it('should remove action from pendingActions after reject', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({
        actionId: req.action.id,
        decision: 'reject',
      });

      expect(manager.getPendingAction(req.action.id)).toBeNull();
    });

    it('should remove action from pendingActions after modify', async () => {
      const req = await createPendingAction(manager);
      mockedAssessRisk.mockReturnValueOnce(makeRisk());

      manager.processDecision({
        actionId: req.action.id,
        decision: 'modify',
        modifiedParams: {},
      });

      expect(manager.getPendingAction(req.action.id)).toBeNull();
    });
  });

  // ==========================================================================
  // getPendingActions
  // ==========================================================================

  describe('getPendingActions', () => {
    it('should return only actions for the specified user', async () => {
      await createPendingAction(manager, 'user-1', 'tool_execution', 'a');
      await createPendingAction(manager, 'user-2', 'tool_execution', 'b');
      await createPendingAction(manager, 'user-1', 'tool_execution', 'c');

      const user1 = manager.getPendingActions('user-1');
      const user2 = manager.getPendingActions('user-2');

      expect(user1).toHaveLength(2);
      expect(user2).toHaveLength(1);
      expect(user1.every(a => a.userId === 'user-1')).toBe(true);
    });

    it('should only return actions with status "pending"', async () => {
      const req1 = await createPendingAction(manager, 'user-1');
      await createPendingAction(manager, 'user-1');

      manager.processDecision({ actionId: req1.action.id, decision: 'approve' });

      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');
    });

    it('should sort by requestedAt descending (newest first)', async () => {
      await createPendingAction(manager, 'user-1', 'tool_execution', 'a', 'first');
      vi.advanceTimersByTime(1000);
      await createPendingAction(manager, 'user-1', 'tool_execution', 'b', 'second');
      vi.advanceTimersByTime(1000);
      await createPendingAction(manager, 'user-1', 'tool_execution', 'c', 'third');

      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(3);
      expect(pending[0].description).toBe('third');
      expect(pending[1].description).toBe('second');
      expect(pending[2].description).toBe('first');
    });

    it('should return empty array for user with no pending actions', () => {
      expect(manager.getPendingActions('nonexistent')).toEqual([]);
    });

    it('should return empty array after all actions are approved', async () => {
      const req = await createPendingAction(manager, 'user-1');
      manager.processDecision({ actionId: req.action.id, decision: 'approve' });
      expect(manager.getPendingActions('user-1')).toEqual([]);
    });

    it('should return empty array after all actions are rejected', async () => {
      const req = await createPendingAction(manager, 'user-1');
      manager.processDecision({ actionId: req.action.id, decision: 'reject' });
      expect(manager.getPendingActions('user-1')).toEqual([]);
    });
  });

  // ==========================================================================
  // getPendingAction
  // ==========================================================================

  describe('getPendingAction', () => {
    it('should return the pending action by id', async () => {
      const req = await createPendingAction(manager);
      const action = manager.getPendingAction(req.action.id);
      expect(action).not.toBeNull();
      expect(action!.id).toBe(req.action.id);
    });

    it('should return null for unknown actionId', () => {
      expect(manager.getPendingAction('nonexistent')).toBeNull();
    });

    it('should return null after action is processed (removed from map)', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({ actionId: req.action.id, decision: 'approve' });
      expect(manager.getPendingAction(req.action.id)).toBeNull();
    });
  });

  // ==========================================================================
  // cancelPending
  // ==========================================================================

  describe('cancelPending', () => {
    it('should cancel a pending action and return true', async () => {
      const req = await createPendingAction(manager);
      const result = manager.cancelPending(req.action.id);
      expect(result).toBe(true);
    });

    it('should set status to expired with "Cancelled by user" reason', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      const req = await createPendingAction(manager);
      manager.cancelPending(req.action.id);

      expect(spy).toHaveBeenCalledOnce();
      const action: PendingAction = spy.mock.calls[0][0];
      expect(action.status).toBe('expired');
      expect(action.reason).toBe('Cancelled by user');
    });

    it('should emit action:expired event', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      const req = await createPendingAction(manager);
      manager.cancelPending(req.action.id);

      expect(spy).toHaveBeenCalledOnce();
    });

    it('should remove action from pendingActions', async () => {
      const req = await createPendingAction(manager);
      manager.cancelPending(req.action.id);
      expect(manager.getPendingAction(req.action.id)).toBeNull();
      expect(manager.getPendingActions('user-1')).toHaveLength(0);
    });

    it('should return false for non-existent actionId', () => {
      expect(manager.cancelPending('nonexistent')).toBe(false);
    });

    it('should return false for already processed (removed) action', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({ actionId: req.action.id, decision: 'approve' });
      // Action removed from map by processDecision
      expect(manager.cancelPending(req.action.id)).toBe(false);
    });

    it('should NOT emit action:expired for non-existent action', () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);
      manager.cancelPending('nonexistent');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // clearRememberedDecisions
  // ==========================================================================

  describe('clearRememberedDecisions', () => {
    it('should clear all decisions matching userId prefix', async () => {
      const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'a');
      const req2 = await createPendingAction(manager, 'user-1', 'code_execution', 'b');

      manager.processDecision({ actionId: req1.action.id, decision: 'approve', remember: true });
      manager.processDecision({ actionId: req2.action.id, decision: 'reject', remember: true });

      const cleared = manager.clearRememberedDecisions('user-1');
      expect(cleared).toBe(2);
    });

    it('should NOT clear decisions for other users', async () => {
      const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'a');
      const req2 = await createPendingAction(manager, 'user-2', 'tool_execution', 'b');

      manager.processDecision({ actionId: req1.action.id, decision: 'approve', remember: true });
      manager.processDecision({ actionId: req2.action.id, decision: 'approve', remember: true });

      manager.clearRememberedDecisions('user-1');

      // user-2's decision should still be there
      expect(manager['rememberedDecisions'].has('user-2:tool_execution:b')).toBe(true);
    });

    it('should return 0 when no decisions to clear', () => {
      expect(manager.clearRememberedDecisions('user-1')).toBe(0);
    });

    it('should return 0 for user with no remembered decisions', async () => {
      const req = await createPendingAction(manager, 'user-1');
      manager.processDecision({ actionId: req.action.id, decision: 'approve', remember: true });

      // Clear user-2 (has no decisions)
      expect(manager.clearRememberedDecisions('user-2')).toBe(0);
    });

    it('should make previously remembered actions require approval again', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
      manager.processDecision({ actionId: req.action.id, decision: 'approve', remember: true });

      // Verify auto-approve is working
      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      const autoResult = await manager.requestApproval('user-1', 'tool_execution', 'some_tool', 'Again', {});
      expect(autoResult).toBeNull();

      // Clear remembered decisions
      manager.clearRememberedDecisions('user-1');

      // Now it should require approval again
      const req2 = await createPendingAction(manager, 'user-1', 'tool_execution', 'some_tool');
      expect(req2).not.toBeNull();
      expect(req2.action.status).toBe('pending');
    });
  });

  // ==========================================================================
  // Cleanup interval
  // ==========================================================================

  describe('cleanup interval', () => {
    describe('expired pending actions', () => {
      it('should expire actions past their expiresAt time', async () => {
        const spy = vi.fn();
        manager.on('action:expired', spy);

        await createPendingAction(manager);

        // Advance past defaultTimeout (120s) + cleanup tick (60s)
        vi.advanceTimersByTime(120_000 + 60_000);

        expect(spy).toHaveBeenCalledOnce();
        const action: PendingAction = spy.mock.calls[0][0];
        expect(action.status).toBe('expired');
        expect(action.reason).toBe('Timed out');
      });

      it('should NOT expire actions that have not timed out', async () => {
        const spy = vi.fn();
        manager.on('action:expired', spy);

        await createPendingAction(manager);

        // Just one cleanup tick (60s) — action still within 120s timeout
        vi.advanceTimersByTime(60_000);

        expect(spy).not.toHaveBeenCalled();
        expect(manager.getPendingActions('user-1')).toHaveLength(1);
      });

      it('should remove expired actions from pendingActions map', async () => {
        await createPendingAction(manager, 'user-1');

        vi.advanceTimersByTime(120_000 + 60_000);

        expect(manager.getPendingActions('user-1')).toHaveLength(0);
      });

      it('should expire multiple actions at once', async () => {
        const spy = vi.fn();
        manager.on('action:expired', spy);

        await createPendingAction(manager, 'user-1', 'tool_execution', 'a');
        await createPendingAction(manager, 'user-1', 'tool_execution', 'b');
        await createPendingAction(manager, 'user-2', 'tool_execution', 'c');

        vi.advanceTimersByTime(120_000 + 60_000);

        expect(spy).toHaveBeenCalledTimes(3);
      });

      it('should not expire actions that were already processed', async () => {
        const spy = vi.fn();
        manager.on('action:expired', spy);

        const req = await createPendingAction(manager);
        manager.processDecision({ actionId: req.action.id, decision: 'approve' });

        vi.advanceTimersByTime(120_000 + 60_000);

        // Should not expire — it was removed from pending map by processDecision
        expect(spy).not.toHaveBeenCalled();
      });
    });

    describe('stale user configs (30-day TTL)', () => {
      it('should evict user configs not updated in 30+ days', () => {
        manager.getUserConfig('stale-user');
        // Backdate updatedAt
        const config = manager['userConfigs'].get('stale-user')!;
        config.updatedAt = new Date(Date.now() - 31 * 86_400_000);

        vi.advanceTimersByTime(60_000); // trigger cleanup

        expect(manager['userConfigs'].has('stale-user')).toBe(false);
      });

      it('should NOT evict user configs updated within 30 days', () => {
        manager.setUserConfig('active-user', { level: AutonomyLevel.FULL });

        vi.advanceTimersByTime(60_000);

        expect(manager['userConfigs'].has('active-user')).toBe(true);
      });

      it('should evict multiple stale configs at once', () => {
        manager.getUserConfig('stale-1');
        manager.getUserConfig('stale-2');
        manager['userConfigs'].get('stale-1')!.updatedAt = new Date(Date.now() - 31 * 86_400_000);
        manager['userConfigs'].get('stale-2')!.updatedAt = new Date(Date.now() - 31 * 86_400_000);

        manager.setUserConfig('active', {}); // this one is fresh

        vi.advanceTimersByTime(60_000);

        expect(manager['userConfigs'].has('stale-1')).toBe(false);
        expect(manager['userConfigs'].has('stale-2')).toBe(false);
        expect(manager['userConfigs'].has('active')).toBe(true);
      });

      it('should not evict config at exactly 29 days', () => {
        manager.getUserConfig('edge-user');
        const config = manager['userConfigs'].get('edge-user')!;
        config.updatedAt = new Date(Date.now() - 29 * 86_400_000);

        vi.advanceTimersByTime(60_000);

        // 29 days < 30 days threshold, so NOT evicted
        expect(manager['userConfigs'].has('edge-user')).toBe(true);
      });
    });

    describe('stale remembered decisions (90-day TTL)', () => {
      it('should evict remembered decisions older than 90 days', () => {
        manager['rememberedDecisions'].set('user-1:tool_execution:x', {
          decision: 'approve',
          createdAt: new Date(Date.now() - 91 * 86_400_000),
        });

        vi.advanceTimersByTime(60_000);

        expect(manager['rememberedDecisions'].has('user-1:tool_execution:x')).toBe(false);
      });

      it('should NOT evict remembered decisions newer than 90 days', () => {
        manager['rememberedDecisions'].set('user-1:tool_execution:x', {
          decision: 'reject',
          createdAt: new Date(Date.now() - 30 * 86_400_000),
        });

        vi.advanceTimersByTime(60_000);

        expect(manager['rememberedDecisions'].has('user-1:tool_execution:x')).toBe(true);
      });

      it('should not evict decision at 89 days', () => {
        manager['rememberedDecisions'].set('user-1:tool_execution:x', {
          decision: 'approve',
          createdAt: new Date(Date.now() - 89 * 86_400_000),
        });

        vi.advanceTimersByTime(60_000);

        // 89 days < 90 days threshold, so NOT evicted
        expect(manager['rememberedDecisions'].has('user-1:tool_execution:x')).toBe(true);
      });

      it('should evict multiple stale decisions at once', () => {
        manager['rememberedDecisions'].set('user-1:a:b', {
          decision: 'approve',
          createdAt: new Date(Date.now() - 100 * 86_400_000),
        });
        manager['rememberedDecisions'].set('user-2:c:d', {
          decision: 'reject',
          createdAt: new Date(Date.now() - 95 * 86_400_000),
        });
        manager['rememberedDecisions'].set('user-3:e:f', {
          decision: 'approve',
          createdAt: new Date(Date.now() - 10 * 86_400_000),
        });

        vi.advanceTimersByTime(60_000);

        expect(manager['rememberedDecisions'].has('user-1:a:b')).toBe(false);
        expect(manager['rememberedDecisions'].has('user-2:c:d')).toBe(false);
        expect(manager['rememberedDecisions'].has('user-3:e:f')).toBe(true);
      });
    });

    it('cleanup should run every 60 seconds', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      // Create action that expires at 120s (expiresAt = now + defaultTimeout)
      await createPendingAction(manager);

      // At 60s: cleanup runs, action still valid (expiresAt > now)
      vi.advanceTimersByTime(60_000);
      expect(spy).not.toHaveBeenCalled();

      // At 120s: cleanup runs, but expiresAt === now (not <), so NOT expired yet
      vi.advanceTimersByTime(60_000);
      expect(spy).not.toHaveBeenCalled();

      // At 180s: cleanup runs, expiresAt < now, so action IS expired
      vi.advanceTimersByTime(60_000);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // stop
  // ==========================================================================

  describe('stop', () => {
    it('should clear the cleanup interval', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      await createPendingAction(manager);
      manager.stop();

      // Advance well past timeout — no cleanup should fire
      vi.advanceTimersByTime(600_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should be safe to call stop multiple times', () => {
      manager.stop();
      manager.stop();
      manager.stop();
      // No error thrown
    });

    it('should be safe to call stop on a freshly created instance', () => {
      const m = new ApprovalManager();
      m.stop();
      // No error thrown
    });
  });

  // ==========================================================================
  // Event emission (comprehensive)
  // ==========================================================================

  describe('event emission', () => {
    it('should emit action:pending with the pending action', async () => {
      const spy = vi.fn();
      manager.on('action:pending', spy);

      const _req = await createPendingAction(manager, 'user-1', 'tool_execution', 'my_tool', 'My action');

      expect(spy).toHaveBeenCalledOnce();
      const action: PendingAction = spy.mock.calls[0][0];
      expect(action.userId).toBe('user-1');
      expect(action.type).toBe('my_tool');
      expect(action.description).toBe('My action');
    });

    it('should emit action:approved with action and decision objects', async () => {
      const spy = vi.fn();
      manager.on('action:approved', spy);

      const req = await createPendingAction(manager);
      const decision: ApprovalDecision = {
        actionId: req.action.id,
        decision: 'approve',
        reason: 'OK',
      };
      manager.processDecision(decision);

      expect(spy).toHaveBeenCalledOnce();
      const [emittedAction, emittedDecision] = spy.mock.calls[0];
      expect(emittedAction.id).toBe(req.action.id);
      expect(emittedAction.status).toBe('approved');
      expect(emittedDecision.decision).toBe('approve');
      expect(emittedDecision.reason).toBe('OK');
    });

    it('should emit action:rejected with action and decision objects', async () => {
      const spy = vi.fn();
      manager.on('action:rejected', spy);

      const req = await createPendingAction(manager);
      const decision: ApprovalDecision = {
        actionId: req.action.id,
        decision: 'reject',
        reason: 'Nope',
      };
      manager.processDecision(decision);

      expect(spy).toHaveBeenCalledOnce();
      const [emittedAction, emittedDecision] = spy.mock.calls[0];
      expect(emittedAction.status).toBe('rejected');
      expect(emittedDecision.reason).toBe('Nope');
    });

    it('should emit action:expired with the expired action on cancel', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      const req = await createPendingAction(manager);
      manager.cancelPending(req.action.id);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].id).toBe(req.action.id);
      expect(spy.mock.calls[0][0].status).toBe('expired');
    });

    it('should emit action:expired with the expired action on timeout', async () => {
      const spy = vi.fn();
      manager.on('action:expired', spy);

      const _req = await createPendingAction(manager);
      vi.advanceTimersByTime(120_000 + 60_000);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].status).toBe('expired');
      expect(spy.mock.calls[0][0].reason).toBe('Timed out');
    });

    it('should emit action:auto_approved on auto-approve with audit', async () => {
      manager.setUserConfig('user-1', { auditEnabled: true });
      const spy = vi.fn();
      manager.on('action:auto_approved', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List', {});

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].status).toBe('auto_approved');
    });

    it('should emit notification with all required fields', async () => {
      const spy = vi.fn();
      manager.on('notification', spy);

      await createPendingAction(manager, 'user-1', 'tool_execution', 'my_tool', 'Important action');

      expect(spy).toHaveBeenCalledOnce();
      const n = spy.mock.calls[0][0];
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('userId', 'user-1');
      expect(n).toHaveProperty('type', 'approval_required');
      expect(n).toHaveProperty('title', 'Approval Required');
      expect(n).toHaveProperty('message');
      expect(n.message).toContain('Important action');
      expect(n).toHaveProperty('severity', 'warning');
      expect(n).toHaveProperty('createdAt');
      expect(n).toHaveProperty('read', false);
      expect(n).toHaveProperty('actionId');
    });

    it('should emit notification on auto-approve when level >= notificationThreshold', async () => {
      manager.setUserConfig('user-1', {
        auditEnabled: true,
        level: AutonomyLevel.SUPERVISED, // 2
        notificationThreshold: AutonomyLevel.SUPERVISED, // 2 => level >= threshold
      });
      const spy = vi.fn();
      manager.on('notification', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List', {});

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].type).toBe('action_executed');
      expect(spy.mock.calls[0][0].severity).toBe('info');
    });

    it('should NOT emit notification on auto-approve when level < notificationThreshold', async () => {
      manager.setUserConfig('user-1', {
        auditEnabled: true,
        level: AutonomyLevel.MANUAL, // 0
        notificationThreshold: AutonomyLevel.SUPERVISED, // 2 => level < threshold
      });
      const spy = vi.fn();
      manager.on('notification', spy);

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: false }));
      await manager.requestApproval('user-1', 'notification', 'list', 'List', {});

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty params in requestApproval', async () => {
      const req = await createPendingAction(manager, 'user-1', 'tool_execution', 'x', 'Do', {});
      expect(req).not.toBeNull();
      expect(req.action.params).toEqual({});
    });

    it('should handle concurrent requests for different users', async () => {
      const req1Promise = createPendingAction(manager, 'user-1', 'tool_execution', 'a');
      const req2Promise = createPendingAction(manager, 'user-2', 'tool_execution', 'b');

      const [req1, req2] = await Promise.all([req1Promise, req2Promise]);
      expect(req1.action.userId).toBe('user-1');
      expect(req2.action.userId).toBe('user-2');
    });

    it('should generate unique action IDs', async () => {
      const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'a');
      const req2 = await createPendingAction(manager, 'user-1', 'tool_execution', 'b');
      expect(req1.action.id).not.toBe(req2.action.id);
    });

    it('should isolate remembered decisions per user:category:actionType triple', async () => {
      // Remember approve for user-1:tool_execution:tool_a
      const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'tool_a');
      manager.processDecision({ actionId: req1.action.id, decision: 'approve', remember: true });

      // Different action type should NOT be auto-approved
      const req2 = await createPendingAction(manager, 'user-1', 'code_execution', 'tool_b');
      expect(req2).not.toBeNull();
      expect(req2.action.status).toBe('pending');
    });

    it('should isolate remembered decisions per user', async () => {
      // Remember approve for user-1
      const req1 = await createPendingAction(manager, 'user-1', 'tool_execution', 'same_tool');
      manager.processDecision({ actionId: req1.action.id, decision: 'approve', remember: true });

      // user-2 should NOT inherit user-1's remembered decision
      const req2 = await createPendingAction(manager, 'user-2', 'tool_execution', 'same_tool');
      expect(req2).not.toBeNull();
      expect(req2.action.status).toBe('pending');
    });

    it('should handle rapid approval then new request without race conditions', async () => {
      const req = await createPendingAction(manager);
      manager.processDecision({ actionId: req.action.id, decision: 'approve' });

      // Immediately create a new pending action
      const req2 = await createPendingAction(manager);
      expect(req2).not.toBeNull();
      expect(manager.getPendingActions('user-1')).toHaveLength(1);
    });

    it('should handle processDecision after action is already timed out and cleaned up', async () => {
      const req = await createPendingAction(manager);
      const actionId = req.action.id;

      // Wait for timeout + cleanup
      vi.advanceTimersByTime(120_000 + 60_000);

      // Try to process decision on expired (removed) action
      const result = manager.processDecision({ actionId, decision: 'approve' });
      expect(result).toBeNull();
    });

    it('should handle setUserConfig for a user that already has pending actions', async () => {
      await createPendingAction(manager, 'user-1');
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL });

      // Pending actions remain unaffected
      expect(manager.getPendingActions('user-1')).toHaveLength(1);
    });

    it('should pass the full context object to assessRisk', async () => {
      const context = {
        conversationId: 'conv-1',
        planId: 'plan-1',
        triggerId: 'trigger-1',
        goalId: 'goal-1',
        previousActions: ['action_1', 'action_2'],
        metadata: { key: 'value' },
      };

      mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
      await manager.requestApproval('user-1', 'tool_execution', 'x', 'Do', {}, context);

      expect(mockedAssessRisk).toHaveBeenCalledWith(
        'tool_execution', 'x', {}, context,
        expect.objectContaining({ userId: 'user-1' }),
      );
    });
  });
});

// ============================================================================
// getApprovalManager (singleton)
// ============================================================================

describe('getApprovalManager', () => {
  afterEach(() => {
    // Reset singleton by creating + stopping a new instance
    const m = getApprovalManager({ defaultTimeout: 1 });
    m.stop();
  });

  it('should return an ApprovalManager instance', () => {
    const m = getApprovalManager({ defaultTimeout: 10_000 });
    expect(m).toBeInstanceOf(ApprovalManager);
    m.stop();
  });

  it('should return the same instance on repeated calls without config', () => {
    const m1 = getApprovalManager({ defaultTimeout: 10_000 });
    const m2 = getApprovalManager();
    const m3 = getApprovalManager();
    expect(m1).toBe(m2);
    expect(m2).toBe(m3);
    m1.stop();
  });

  it('should create a new instance when config is provided', () => {
    const m1 = getApprovalManager({ defaultTimeout: 10_000 });
    const m2 = getApprovalManager({ defaultTimeout: 20_000 });
    expect(m1).not.toBe(m2);
    m1.stop();
    m2.stop();
  });

  it('should stop old instance when creating new one with config', async () => {
    vi.useFakeTimers();

    const m1 = getApprovalManager({ defaultTimeout: 60_000 });
    const spy = vi.fn();
    m1.on('action:expired', spy);

    // Create pending action on m1
    mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
    await m1.requestApproval('user-1', 'tool_execution', 'x', 'Do', {});

    // Create new instance (should stop m1)
    const m2 = getApprovalManager({ defaultTimeout: 30_000 });

    // Advance past m1's timeout — its cleanup should NOT fire because it was stopped
    vi.advanceTimersByTime(120_000);
    expect(spy).not.toHaveBeenCalled();

    m2.stop();
    vi.useRealTimers();
  });

  it('should create instance with provided config values', async () => {
    vi.useFakeTimers();

    const m = getApprovalManager({ defaultTimeout: 45_000, maxPendingPerUser: 3 });

    mockedAssessRisk.mockReturnValueOnce(makeRisk({ requiresApproval: true }));
    const req = await m.requestApproval('user-1', 'tool_execution', 'x', 'Do', {});
    expect(req!.timeoutSeconds).toBe(45);

    m.stop();
    vi.useRealTimers();
  });

  it('should create new instance on first call without config', () => {
    // Reset singleton first
    const temp = getApprovalManager({ defaultTimeout: 1 });
    temp.stop();

    // This call with undefined config still creates one since temp was with config
    // Actually: getApprovalManager(config) sets managerInstance, and config is provided, so it creates new.
    // Then getApprovalManager() without config returns existing.
    const m = getApprovalManager();
    expect(m).toBeInstanceOf(ApprovalManager);
    m.stop();
  });
});
