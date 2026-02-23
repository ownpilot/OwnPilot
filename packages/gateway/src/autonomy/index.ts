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

// Pulse System (Autonomy Engine)
export {
  AutonomyEngine,
  getAutonomyEngine,
  createPulseServiceAdapter,
  stopAutonomyEngine,
  DEFAULT_PULSE_DIRECTIVES,
  type AutonomyEngineConfig,
  type PulseDirectives,
} from './engine.js';

export { gatherPulseContext, type PulseContext, type GoalSummary } from './context.js';

export {
  evaluatePulseContext,
  calculateNextInterval,
  RULE_DEFINITIONS,
  DEFAULT_RULE_THRESHOLDS,
  type RuleThresholds,
  type Signal,
  type SignalSeverity,
  type EvaluationResult,
} from './evaluator.js';

export {
  getPulseSystemPrompt,
  buildPulseUserMessage,
  parsePulseDecision,
  type PulseAction,
  type PulseDecision,
} from './prompt.js';

export {
  executePulseActions,
  DEFAULT_ACTION_COOLDOWNS,
  type ActionCooldowns,
} from './executor.js';

export { reportPulseResult, type Broadcaster } from './reporter.js';
