/**
 * Autonomy Guard
 *
 * Enforces SoulAutonomy.level at runtime for soul agents.
 * Integrates with the ApprovalManager to apply per-agent autonomy rules.
 *
 * Autonomy Level Enforcement:
 * - Level 0 (MANUAL): All actions require approval
 * - Level 1 (ASSISTED): Actions not in allowedActions require approval
 * - Level 2 (SUPERVISED): Risk-based (existing ApprovalManager logic)
 * - Level 3 (AUTONOMOUS): Allow unless in blockedActions, notify on execution
 * - Level 4 (FULL): Allow unless in blockedActions, minimal notifications
 */

import type { SoulAutonomy } from '@ownpilot/core';
import type { ActionCategory } from './types.js';
import { AutonomyLevel } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface AutonomyDecision {
  /** Whether the action is allowed to proceed */
  allowed: boolean;
  /** Whether approval is required */
  requiresApproval: boolean;
  /** Reason for the decision */
  reason: string;
  /** Whether to notify user (for autonomous actions) */
  notify: boolean;
  /** Notification severity if applicable */
  severity?: 'info' | 'warning' | 'error';
}

export interface AutonomyGuardContext {
  /** The soul autonomy configuration */
  autonomy: SoulAutonomy;
  /** Agent ID for logging */
  agentId: string;
  /** Agent name for notifications */
  agentName: string;
}

// ============================================================================
// Guard Logic
// ============================================================================

/**
 * Check if an action is allowed based on soul autonomy configuration.
 * This is called before the action is executed.
 */
export function checkAutonomy(
  context: AutonomyGuardContext,
  _category: ActionCategory,
  actionType: string,
  _description: string
): AutonomyDecision {
  const { autonomy, agentName } = context;
  const level = autonomy.level;

  // Level 0: Manual - all actions require approval
  if (level === AutonomyLevel.MANUAL) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: `${agentName} is in MANUAL mode - all actions require approval`,
      notify: false,
    };
  }

  // Level 1: Assisted - allowedActions bypass approval
  if (level === AutonomyLevel.ASSISTED) {
    // Check if action is explicitly allowed
    if (autonomy.allowedActions.includes(actionType)) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: `Action in allowedActions list`,
        notify: false,
      };
    }

    // Blocked actions are always rejected
    if (autonomy.blockedActions.includes(actionType)) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action is permanently blocked`,
        notify: true,
        severity: 'warning',
      };
    }

    // Everything else requires approval
    return {
      allowed: false,
      requiresApproval: true,
      reason: `${agentName} is in ASSISTED mode - action not in allowedActions`,
      notify: false,
    };
  }

  // Level 2: Supervised - handled by risk-based approval (caller should use ApprovalManager)
  // This level defers to the existing risk assessment
  if (level === AutonomyLevel.SUPERVISED) {
    // Check blocked first
    if (autonomy.blockedActions.includes(actionType)) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action is permanently blocked`,
        notify: true,
        severity: 'warning',
      };
    }

    // Check explicitly allowed (can bypass risk assessment)
    if (autonomy.allowedActions.includes(actionType)) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: `Action in allowedActions list`,
        notify: false,
      };
    }

    // Defer to risk-based approval for requiresApproval list
    if (autonomy.requiresApproval.includes(actionType)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Action requires explicit approval`,
        notify: false,
      };
    }

    // Let the caller decide based on risk (return neutral)
    return {
      allowed: true,
      requiresApproval: false,
      reason: `SUPERVISED mode - risk assessment required`,
      notify: false,
      // Signal that risk assessment should be used
    };
  }

  // Level 3: Autonomous - allow unless blocked, notify on execution
  if (level === AutonomyLevel.AUTONOMOUS) {
    if (autonomy.blockedActions.includes(actionType)) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action is permanently blocked`,
        notify: true,
        severity: 'error',
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      reason: `${agentName} is AUTONOMOUS`,
      notify: true,
      severity: 'info',
    };
  }

  // Level 4: Full - allow unless blocked, minimal notifications
  if (level === AutonomyLevel.FULL) {
    if (autonomy.blockedActions.includes(actionType)) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Action is permanently blocked (even FULL autonomy cannot bypass)`,
        notify: true,
        severity: 'error',
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      reason: `${agentName} has FULL autonomy`,
      notify: false, // Minimal notifications
    };
  }

  // Fallback: require approval for unknown levels
  return {
    allowed: false,
    requiresApproval: true,
    reason: `Unknown autonomy level: ${level}`,
    notify: true,
    severity: 'warning',
  };
}

/**
 * Check if an action should be blocked based on autonomy configuration.
 * Quick check for enforcement points.
 */
export function isActionBlocked(
  autonomy: SoulAutonomy,
  actionType: string
): { blocked: boolean; reason?: string } {
  // BlockedActions always block regardless of level
  if (autonomy.blockedActions.includes(actionType)) {
    return { blocked: true, reason: 'Action is in blockedActions list' };
  }

  // Level 0 blocks everything
  if (autonomy.level === AutonomyLevel.MANUAL) {
    return { blocked: true, reason: 'Agent is in MANUAL mode' };
  }

  return { blocked: false };
}

/**
 * Get a human-readable description of what an autonomy level means.
 */
export function getAutonomyLevelDescription(level: AutonomyLevel): string {
  switch (level) {
    case AutonomyLevel.MANUAL:
      return 'All actions require explicit approval';
    case AutonomyLevel.ASSISTED:
      return 'Only allowedActions execute without approval';
    case AutonomyLevel.SUPERVISED:
      return 'Risk-based approval with exceptions';
    case AutonomyLevel.AUTONOMOUS:
      return 'Execute freely, notify on actions';
    case AutonomyLevel.FULL:
      return 'Full autonomy with minimal notifications';
    default:
      return 'Unknown autonomy level';
  }
}

/**
 * Format autonomy settings for display/logging.
 */
export function formatAutonomySettings(autonomy: SoulAutonomy): string {
  const levelName = AutonomyLevel[autonomy.level] ?? 'Unknown';
  return [
    `Level: ${autonomy.level} (${levelName})`,
    `Allowed Actions: ${autonomy.allowedActions.length}`,
    `Blocked Actions: ${autonomy.blockedActions.length}`,
    `Requires Approval: ${autonomy.requiresApproval.length}`,
    `Daily Budget: $${autonomy.maxCostPerDay}`,
  ].join(', ');
}
