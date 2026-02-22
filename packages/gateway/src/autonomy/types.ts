/**
 * Autonomy Types
 *
 * Types for autonomy levels and action control.
 */

// ============================================================================
// Autonomy Levels
// ============================================================================

/**
 * Autonomy levels from manual to fully autonomous
 */
export enum AutonomyLevel {
  /** Always ask before any action */
  MANUAL = 0,
  /** Suggest actions, ask for approval */
  ASSISTED = 1,
  /** Execute low-risk actions, ask for high-risk */
  SUPERVISED = 2,
  /** Execute all actions, notify user */
  AUTONOMOUS = 3,
  /** Fully autonomous, minimal notifications */
  FULL = 4,
}

export const AUTONOMY_LEVEL_NAMES: Record<AutonomyLevel, string> = {
  [AutonomyLevel.MANUAL]: 'Manual',
  [AutonomyLevel.ASSISTED]: 'Assisted',
  [AutonomyLevel.SUPERVISED]: 'Supervised',
  [AutonomyLevel.AUTONOMOUS]: 'Autonomous',
  [AutonomyLevel.FULL]: 'Full Autonomy',
};

export const AUTONOMY_LEVEL_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  [AutonomyLevel.MANUAL]: 'Always ask before any action. Maximum user control.',
  [AutonomyLevel.ASSISTED]: 'Suggest actions and wait for approval before executing.',
  [AutonomyLevel.SUPERVISED]: 'Execute low-risk actions automatically, ask for high-risk ones.',
  [AutonomyLevel.AUTONOMOUS]: 'Execute all actions automatically, send notifications.',
  [AutonomyLevel.FULL]: 'Fully autonomous operation with minimal notifications.',
};

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Risk levels for actions
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  /** Overall risk level */
  level: RiskLevel;
  /** Numeric score (0-100) */
  score: number;
  /** Factors contributing to risk */
  factors: RiskFactor[];
  /** Whether approval is required based on autonomy config */
  requiresApproval: boolean;
  /** Suggested mitigations */
  mitigations: string[];
}

/**
 * Individual risk factor
 */
export interface RiskFactor {
  /** Factor name */
  name: string;
  /** Factor description */
  description: string;
  /** Weight in risk calculation (0-1) */
  weight: number;
  /** Whether this factor is present */
  present: boolean;
}

// ============================================================================
// Action Types
// ============================================================================

/**
 * Action categories for autonomy control
 */
export type ActionCategory =
  | 'tool_execution'
  | 'data_modification'
  | 'external_communication'
  | 'file_operation'
  | 'code_execution'
  | 'system_command'
  | 'api_call'
  | 'notification'
  | 'plan_execution'
  | 'memory_modification'
  | 'goal_modification'
  | 'financial';

/**
 * Pending action awaiting approval
 */
export interface PendingAction {
  /** Unique action ID */
  id: string;
  /** User ID */
  userId: string;
  /** Action category */
  category: ActionCategory;
  /** Action type/name */
  type: string;
  /** Action description */
  description: string;
  /** Action parameters */
  params: Record<string, unknown>;
  /** Risk assessment */
  risk: RiskAssessment;
  /** Context information */
  context: ActionContext;
  /** When the action was requested */
  requestedAt: Date;
  /** Expiration time */
  expiresAt: Date;
  /** Current status */
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
  /** Approval/rejection reason */
  reason?: string;
  /** Who approved/rejected */
  decidedBy?: string;
  /** When decided */
  decidedAt?: Date;
}

/**
 * Context for action assessment
 */
export interface ActionContext {
  /** Conversation ID if applicable */
  conversationId?: string;
  /** Plan ID if part of a plan */
  planId?: string;
  /** Trigger ID if triggered automatically */
  triggerId?: string;
  /** Goal ID if related to a goal */
  goalId?: string;
  /** Previous actions in this context */
  previousActions?: string[];
  /** Custom context data */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Autonomy configuration for a user
 */
export interface AutonomyConfig {
  /** User ID */
  userId: string;
  /** Global autonomy level */
  level: AutonomyLevel;
  /** Tools that can run without approval (overrides level) */
  allowedTools: string[];
  /** Tools that always need approval (overrides level) */
  blockedTools: string[];
  /** Categories that can run without approval */
  allowedCategories: ActionCategory[];
  /** Categories that always need approval */
  blockedCategories: ActionCategory[];
  /** Maximum cost per autonomous action (in tokens or currency) */
  maxCostPerAction: number;
  /** Daily budget for autonomous actions */
  dailyBudget: number;
  /** Current daily spend */
  dailySpend: number;
  /** Budget reset time */
  budgetResetAt: Date;
  /** Notification threshold (notify for actions >= this level) */
  notificationThreshold: AutonomyLevel;
  /** Actions requiring explicit confirmation regardless of level */
  confirmationRequired: string[];
  /** Enable audit logging */
  auditEnabled: boolean;
  /** Time-based restrictions */
  timeRestrictions?: TimeRestriction[];
  /** Last updated */
  updatedAt: Date;
}

/**
 * Time-based restriction for autonomy
 */
export interface TimeRestriction {
  /** Days of week (0-6, Sunday=0) */
  daysOfWeek: number[];
  /** Start hour (0-23) */
  startHour: number;
  /** End hour (0-23) */
  endHour: number;
  /** Autonomy level during this period */
  level: AutonomyLevel;
}

/**
 * Default autonomy configuration
 */
export const DEFAULT_AUTONOMY_CONFIG: Omit<
  AutonomyConfig,
  'userId' | 'budgetResetAt' | 'updatedAt'
> = {
  level: AutonomyLevel.SUPERVISED, // Auto-approve low/medium risk tools, ask for high risk
  allowedTools: [],
  blockedTools: [],
  allowedCategories: [],
  blockedCategories: ['system_command', 'code_execution'],
  maxCostPerAction: 1000, // tokens
  dailyBudget: 10000, // tokens
  dailySpend: 0,
  notificationThreshold: AutonomyLevel.SUPERVISED,
  confirmationRequired: ['delete_data', 'send_email', 'make_payment', 'modify_system'],
  auditEnabled: true,
  timeRestrictions: [],
};

// ============================================================================
// Approval Flow
// ============================================================================

/**
 * Approval request sent to user
 */
export interface ApprovalRequest {
  /** Action to approve */
  action: PendingAction;
  /** Suggested response based on risk */
  suggestion: 'approve' | 'reject' | 'review';
  /** Alternative actions if rejected */
  alternatives?: AlternativeAction[];
  /** Time remaining to decide */
  timeoutSeconds: number;
}

/**
 * Alternative action suggestion
 */
export interface AlternativeAction {
  /** Description of alternative */
  description: string;
  /** Modified parameters */
  params: Record<string, unknown>;
  /** Risk of alternative */
  risk: RiskLevel;
}

/**
 * Approval decision from user
 */
export interface ApprovalDecision {
  /** Action ID */
  actionId: string;
  /** Decision */
  decision: 'approve' | 'reject' | 'modify';
  /** Reason for decision */
  reason?: string;
  /** Modified parameters if decision is 'modify' */
  modifiedParams?: Record<string, unknown>;
  /** Remember this decision for similar actions */
  remember?: boolean;
}

// ============================================================================
// Notifications
// ============================================================================

/**
 * Notification about autonomous action
 */
export interface AutonomyNotification {
  /** Notification ID */
  id: string;
  /** User ID */
  userId: string;
  /** Notification type */
  type:
    | 'action_executed'
    | 'action_blocked'
    | 'approval_required'
    | 'budget_warning'
    | 'budget_exceeded';
  /** Notification title */
  title: string;
  /** Notification message */
  message: string;
  /** Related action if applicable */
  actionId?: string;
  /** Severity */
  severity: 'info' | 'warning' | 'error';
  /** Created at */
  createdAt: Date;
  /** Read status */
  read: boolean;
}
