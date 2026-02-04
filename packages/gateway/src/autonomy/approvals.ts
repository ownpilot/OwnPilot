/**
 * Approval Flow System
 *
 * Manages pending actions and approval requests.
 */

import { EventEmitter } from 'events';
import {
  type PendingAction,
  type ApprovalRequest,
  type ApprovalDecision,
  type ActionCategory,
  type ActionContext,
  type AutonomyConfig,
  type AutonomyNotification,
  DEFAULT_AUTONOMY_CONFIG,
} from './types.js';
import { assessRisk } from './risk.js';

// ============================================================================
// Approval Manager
// ============================================================================

export interface ApprovalManagerConfig {
  /** Default timeout for approvals in ms */
  defaultTimeout?: number;
  /** Maximum pending actions per user */
  maxPendingPerUser?: number;
  /** Enable auto-approval for low-risk actions */
  autoApproveLowRisk?: boolean;
}

export interface ApprovalManagerEvents {
  'action:pending': (action: PendingAction) => void;
  'action:approved': (action: PendingAction, decision: ApprovalDecision) => void;
  'action:rejected': (action: PendingAction, decision: ApprovalDecision) => void;
  'action:expired': (action: PendingAction) => void;
  'action:auto_approved': (action: PendingAction) => void;
  'notification': (notification: AutonomyNotification) => void;
}

export class ApprovalManager extends EventEmitter {
  private config: Required<ApprovalManagerConfig>;
  private pendingActions: Map<string, PendingAction> = new Map();
  private userConfigs: Map<string, AutonomyConfig> = new Map();
  private rememberedDecisions: Map<string, 'approve' | 'reject'> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: ApprovalManagerConfig = {}) {
    super();
    this.config = {
      defaultTimeout: config.defaultTimeout ?? 300000, // 5 minutes
      maxPendingPerUser: config.maxPendingPerUser ?? 50,
      autoApproveLowRisk: config.autoApproveLowRisk ?? false,
    };

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Set autonomy config for a user
   */
  setUserConfig(userId: string, config: Partial<AutonomyConfig>): void {
    const existing = this.userConfigs.get(userId);
    const now = new Date();

    this.userConfigs.set(userId, {
      ...DEFAULT_AUTONOMY_CONFIG,
      ...existing,
      ...config,
      userId,
      budgetResetAt: existing?.budgetResetAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Get autonomy config for a user
   */
  getUserConfig(userId: string): AutonomyConfig {
    const existing = this.userConfigs.get(userId);
    const now = new Date();

    if (existing) {
      // Check if budget should reset (daily)
      if (now.getTime() - existing.budgetResetAt.getTime() > 24 * 60 * 60 * 1000) {
        existing.dailySpend = 0;
        existing.budgetResetAt = now;
      }
      return existing;
    }

    // Create default config
    const config: AutonomyConfig = {
      ...DEFAULT_AUTONOMY_CONFIG,
      userId,
      budgetResetAt: now,
      updatedAt: now,
    };
    this.userConfigs.set(userId, config);
    return config;
  }

  /**
   * Request approval for an action
   */
  async requestApproval(
    userId: string,
    category: ActionCategory,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
    context: ActionContext = {}
  ): Promise<ApprovalRequest | null> {
    const config = this.getUserConfig(userId);

    // Assess risk
    const risk = assessRisk(category, actionType, params, context, config);

    // Check if action needs approval
    if (!risk.requiresApproval) {
      // Auto-approve and log
      if (config.auditEnabled) {
        this.logAutoApproval(userId, category, actionType, description, params, risk);
      }
      return null; // No approval needed
    }

    // Check for remembered decision
    const decisionKey = `${userId}:${category}:${actionType}`;
    const remembered = this.rememberedDecisions.get(decisionKey);
    if (remembered === 'approve') {
      this.logAutoApproval(userId, category, actionType, description, params, risk);
      return null;
    }
    if (remembered === 'reject') {
      // Return a rejected request
      const action = this.createPendingAction(
        userId, category, actionType, description, params, context, risk
      );
      action.status = 'rejected';
      action.reason = 'Previously rejected (remembered)';
      return {
        action,
        suggestion: 'reject',
        timeoutSeconds: 0,
      };
    }

    // Check pending limit
    const userPending = this.getUserPendingCount(userId);
    if (userPending >= this.config.maxPendingPerUser) {
      throw new Error(`Maximum pending actions reached for user: ${userId}`);
    }

    // Create pending action
    const action = this.createPendingAction(
      userId, category, actionType, description, params, context, risk
    );

    // Store pending action
    this.pendingActions.set(action.id, action);
    this.emit('action:pending', action);

    // Send notification
    this.sendNotification(userId, 'approval_required', 'Approval Required',
      `Action "${description}" requires your approval.`, action.id, 'warning');

    // Return approval request
    return {
      action,
      suggestion: this.getSuggestion(risk.level),
      alternatives: this.generateAlternatives(category, actionType, params),
      timeoutSeconds: Math.floor(this.config.defaultTimeout / 1000),
    };
  }

  /**
   * Process approval decision
   */
  processDecision(decision: ApprovalDecision): PendingAction | null {
    const action = this.pendingActions.get(decision.actionId);
    if (!action) {
      return null;
    }

    action.decidedAt = new Date();
    action.reason = decision.reason;

    if (decision.decision === 'approve') {
      action.status = 'approved';
      this.emit('action:approved', action, decision);

      // Update daily spend
      const config = this.getUserConfig(action.userId);
      config.dailySpend += action.risk.score; // Simple cost tracking
    } else if (decision.decision === 'reject') {
      action.status = 'rejected';
      this.emit('action:rejected', action, decision);
    } else if (decision.decision === 'modify') {
      // Update params and re-assess
      action.params = { ...action.params, ...decision.modifiedParams };
      action.risk = assessRisk(
        action.category,
        action.type,
        action.params,
        action.context,
        this.getUserConfig(action.userId)
      );
      action.status = 'approved';
      this.emit('action:approved', action, decision);
    }

    // Remember decision if requested
    if (decision.remember) {
      const decisionKey = `${action.userId}:${action.category}:${action.type}`;
      this.rememberedDecisions.set(
        decisionKey,
        decision.decision === 'reject' ? 'reject' : 'approve'
      );
    }

    // Remove from pending
    this.pendingActions.delete(decision.actionId);

    return action;
  }

  /**
   * Get pending actions for a user
   */
  getPendingActions(userId: string): PendingAction[] {
    const actions: PendingAction[] = [];
    for (const action of this.pendingActions.values()) {
      if (action.userId === userId && action.status === 'pending') {
        actions.push(action);
      }
    }
    return actions.sort((a, b) =>
      b.requestedAt.getTime() - a.requestedAt.getTime()
    );
  }

  /**
   * Get pending action by ID
   */
  getPendingAction(actionId: string): PendingAction | null {
    return this.pendingActions.get(actionId) ?? null;
  }

  /**
   * Cancel a pending action
   */
  cancelPending(actionId: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action || action.status !== 'pending') {
      return false;
    }

    action.status = 'expired';
    action.reason = 'Cancelled by user';
    this.pendingActions.delete(actionId);
    this.emit('action:expired', action);
    return true;
  }

  /**
   * Clear remembered decisions for a user
   */
  clearRememberedDecisions(userId: string): number {
    let cleared = 0;
    for (const key of this.rememberedDecisions.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.rememberedDecisions.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Stop the approval manager
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createPendingAction(
    userId: string,
    category: ActionCategory,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
    context: ActionContext,
    risk: ReturnType<typeof assessRisk>
  ): PendingAction {
    const now = new Date();
    return {
      id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      category,
      type: actionType,
      description,
      params,
      risk,
      context,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + this.config.defaultTimeout),
      status: 'pending',
    };
  }

  private getUserPendingCount(userId: string): number {
    let count = 0;
    for (const action of this.pendingActions.values()) {
      if (action.userId === userId && action.status === 'pending') {
        count++;
      }
    }
    return count;
  }

  private getSuggestion(riskLevel: string): 'approve' | 'reject' | 'review' {
    switch (riskLevel) {
      case 'low': return 'approve';
      case 'medium': return 'review';
      case 'high': return 'review';
      case 'critical': return 'reject';
      default: return 'review';
    }
  }

  private generateAlternatives(
    category: ActionCategory,
    actionType: string,
    params: Record<string, unknown>
  ): Array<{ description: string; params: Record<string, unknown>; risk: 'low' | 'medium' | 'high' | 'critical' }> {
    const alternatives: Array<{ description: string; params: Record<string, unknown>; risk: 'low' | 'medium' | 'high' | 'critical' }> = [];

    // Generate alternatives based on action type
    if (params.bulk === true || params.all === true) {
      alternatives.push({
        description: 'Process items one at a time',
        params: { ...params, bulk: false, all: false, limit: 1 },
        risk: 'low',
      });
    }

    if (params.permanent === true || params.force === true) {
      alternatives.push({
        description: 'Use soft-delete instead',
        params: { ...params, permanent: false, force: false, softDelete: true },
        risk: 'medium',
      });
    }

    return alternatives;
  }

  private logAutoApproval(
    userId: string,
    category: ActionCategory,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
    risk: ReturnType<typeof assessRisk>
  ): void {
    const action = this.createPendingAction(
      userId, category, actionType, description, params, {}, risk
    );
    action.status = 'auto_approved';
    this.emit('action:auto_approved', action);

    // Notify if above notification threshold
    const config = this.getUserConfig(userId);
    if (config.level >= config.notificationThreshold) {
      this.sendNotification(userId, 'action_executed', 'Action Executed',
        `"${description}" was automatically executed.`, action.id, 'info');
    }
  }

  private sendNotification(
    userId: string,
    type: AutonomyNotification['type'],
    title: string,
    message: string,
    actionId?: string,
    severity: AutonomyNotification['severity'] = 'info'
  ): void {
    const notification: AutonomyNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      type,
      title,
      message,
      actionId,
      severity,
      createdAt: new Date(),
      read: false,
    };
    this.emit('notification', notification);
  }

  private startCleanup(): void {
    // Clean up expired actions every minute (unref so timer doesn't block process exit)
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      for (const [id, action] of this.pendingActions) {
        if (action.status === 'pending' && action.expiresAt < now) {
          action.status = 'expired';
          action.reason = 'Timed out';
          this.pendingActions.delete(id);
          this.emit('action:expired', action);
        }
      }
    }, 60000);
    this.cleanupInterval.unref();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: ApprovalManager | null = null;

export function getApprovalManager(config?: ApprovalManagerConfig): ApprovalManager {
  if (!managerInstance || config) {
    managerInstance = new ApprovalManager(config);
  }
  return managerInstance;
}
