/**
 * Autonomy Module
 *
 * Autonomy levels, risk assessment, and approval flow for the AI assistant.
 */

export {
  AutonomyLevel,
  AUTONOMY_LEVEL_NAMES,
  AUTONOMY_LEVEL_DESCRIPTIONS,
  DEFAULT_AUTONOMY_CONFIG,
  type RiskLevel,
  type RiskAssessment,
  type RiskFactor,
  type ActionCategory,
  type PendingAction,
  type ActionContext,
  type AutonomyConfig,
  type TimeRestriction,
  type ApprovalRequest,
  type AlternativeAction,
  type ApprovalDecision,
  type AutonomyNotification,
} from './types.js';

export {
  assessRisk,
  riskLevelToNumber,
  compareRiskLevels,
  isRiskAtOrAbove,
  getRiskLevelColor,
} from './risk.js';

export {
  ApprovalManager,
  getApprovalManager,
  type ApprovalManagerConfig,
  type ApprovalManagerEvents,
} from './approvals.js';
