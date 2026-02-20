/**
 * Risk Assessment Service
 *
 * Evaluates the risk level of actions for autonomy control.
 */

import {
  type RiskAssessment,
  type RiskFactor,
  type RiskLevel,
  type ActionCategory,
  type AutonomyConfig,
  type ActionContext,
  AutonomyLevel,
} from './types.js';

// ============================================================================
// Risk Factors
// ============================================================================

/**
 * Predefined risk factors for assessment
 */
const RISK_FACTORS: Record<string, Omit<RiskFactor, 'present'>> = {
  // Data risks
  data_deletion: {
    name: 'Data Deletion',
    description: 'Action involves deleting data',
    weight: 0.8,
  },
  data_modification: {
    name: 'Data Modification',
    description: 'Action modifies existing data',
    weight: 0.5,
  },
  sensitive_data: {
    name: 'Sensitive Data',
    description: 'Action involves sensitive or personal data',
    weight: 0.7,
  },
  bulk_operation: {
    name: 'Bulk Operation',
    description: 'Action affects multiple items',
    weight: 0.4,
  },

  // External communication risks
  external_api: {
    name: 'External API',
    description: 'Action calls external APIs',
    weight: 0.5,
  },
  email_send: {
    name: 'Email Send',
    description: 'Action sends emails',
    weight: 0.6,
  },
  notification_send: {
    name: 'Notification Send',
    description: 'Action sends notifications',
    weight: 0.3,
  },

  // System risks
  code_execution: {
    name: 'Code Execution',
    description: 'Action executes arbitrary code',
    weight: 0.9,
  },
  system_command: {
    name: 'System Command',
    description: 'Action runs system commands',
    weight: 0.95,
  },
  file_write: {
    name: 'File Write',
    description: 'Action writes to filesystem',
    weight: 0.6,
  },
  file_delete: {
    name: 'File Delete',
    description: 'Action deletes files',
    weight: 0.8,
  },

  // Financial risks
  financial_transaction: {
    name: 'Financial Transaction',
    description: 'Action involves financial transactions',
    weight: 1.0,
  },
  high_cost: {
    name: 'High Cost',
    description: 'Action has high resource cost',
    weight: 0.6,
  },

  // Irreversibility
  irreversible: {
    name: 'Irreversible',
    description: 'Action cannot be easily undone',
    weight: 0.7,
  },

  // Scope
  affects_others: {
    name: 'Affects Others',
    description: 'Action affects other users or systems',
    weight: 0.5,
  },
  system_wide: {
    name: 'System Wide',
    description: 'Action has system-wide effects',
    weight: 0.8,
  },
};

/**
 * Tool-specific risk mappings
 */
const TOOL_RISK_FACTORS: Record<string, string[]> = {
  // File system tools
  write_file: ['file_write', 'data_modification'],
  delete_file: ['file_delete', 'data_deletion', 'irreversible'],
  create_directory: ['file_write'],
  list_directory: [],
  read_file: [],

  // Code execution tools
  execute_code: ['code_execution', 'irreversible'],
  run_script: ['code_execution', 'system_command'],

  // Data tools
  create_memory: ['data_modification'],
  delete_memory: ['data_deletion'],
  create_goal: ['data_modification'],
  update_goal: ['data_modification'],
  delete_goal: ['data_deletion'],

  // Communication tools
  send_email: ['email_send', 'external_api', 'affects_others'],
  send_notification: ['notification_send'],
  channel_telegram_send: ['notification_send', 'external_api'],

  // External tools
  web_fetch: ['external_api'],
  api_call: ['external_api'],

  // Custom data tools (user's personal data storage - low/medium risk)
  list_custom_tables: [],
  describe_custom_table: [],
  create_custom_table: ['data_modification'],
  delete_custom_table: ['data_deletion'],
  add_custom_record: ['data_modification'],
  list_custom_records: [],
  search_custom_records: [],
  get_custom_record: [],
  update_custom_record: ['data_modification'],
  delete_custom_record: ['data_deletion'],

  // Personal data tools (built-in features - low/medium risk)
  // Tasks
  add_task: ['data_modification'],
  list_tasks: [],
  complete_task: ['data_modification'],
  update_task: ['data_modification'],
  delete_task: ['data_deletion'],
  // Bookmarks
  add_bookmark: ['data_modification'],
  list_bookmarks: [],
  delete_bookmark: ['data_deletion'],
  // Notes
  add_note: ['data_modification'],
  list_notes: [],
  update_note: ['data_modification'],
  delete_note: ['data_deletion'],
  // Calendar
  add_calendar_event: ['data_modification'],
  list_calendar_events: [],
  delete_calendar_event: ['data_deletion'],
  // Contacts
  add_contact: ['data_modification', 'sensitive_data'],
  list_contacts: [],
  update_contact: ['data_modification', 'sensitive_data'],
  delete_contact: ['data_deletion'],
};

/**
 * Category-specific base risk scores
 */
const CATEGORY_BASE_RISK: Record<ActionCategory, number> = {
  tool_execution: 20,
  data_modification: 30,
  external_communication: 40,
  file_operation: 25,
  code_execution: 70,
  system_command: 80,
  api_call: 35,
  notification: 15,
  plan_execution: 45,
  memory_modification: 25,
  goal_modification: 20,
  financial: 90,
};

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Assess the risk of an action
 */
export function assessRisk(
  category: ActionCategory,
  actionType: string,
  params: Record<string, unknown>,
  context: ActionContext,
  config: AutonomyConfig
): RiskAssessment {
  const factors: RiskFactor[] = [];
  let totalWeight = 0;
  let presentWeight = 0;

  // Get base risk from category
  const baseRisk = CATEGORY_BASE_RISK[category] ?? 30;

  // Get tool-specific factors
  const toolFactors = TOOL_RISK_FACTORS[actionType] ?? [];

  // Evaluate predefined factors
  for (const [factorId, factor] of Object.entries(RISK_FACTORS)) {
    const present = evaluateFactor(factorId, toolFactors, params, context);
    factors.push({ ...factor, present });
    totalWeight += factor.weight;
    if (present) {
      presentWeight += factor.weight;
    }
  }

  // Calculate risk score (0-100)
  const factorScore = totalWeight > 0 ? (presentWeight / totalWeight) * 100 : 0;
  const score = Math.min(100, Math.round((baseRisk + factorScore) / 2));

  // Determine risk level
  const level = scoreToLevel(score);

  // Determine if approval is required
  const requiresApproval = checkApprovalRequired(
    category,
    actionType,
    level,
    config
  );

  // Generate mitigations
  const mitigations = generateMitigations(factors.filter((f) => f.present));

  return {
    level,
    score,
    factors,
    requiresApproval,
    mitigations,
  };
}

/**
 * Evaluate if a risk factor is present
 */
function evaluateFactor(
  factorId: string,
  toolFactors: string[],
  params: Record<string, unknown>,
  _context: ActionContext
): boolean {
  // Check if explicitly in tool factors
  if (toolFactors.includes(factorId)) {
    return true;
  }

  // Parameter-based evaluation
  switch (factorId) {
    case 'bulk_operation':
      return (
        Array.isArray(params.items) && params.items.length > 10 ||
        params.bulk === true ||
        params.all === true
      );

    case 'sensitive_data':
      return (
        params.sensitive === true ||
        containsSensitiveKeywords(params)
      );

    case 'high_cost':
      return (
        typeof params.cost === 'number' && params.cost > 1000 ||
        typeof params.tokens === 'number' && params.tokens > 5000
      );

    case 'irreversible':
      return (
        params.force === true ||
        params.permanent === true ||
        params.noUndo === true
      );

    case 'affects_others':
      return (
        params.recipients !== undefined ||
        params.broadcast === true ||
        (Array.isArray(params.users) && params.users.length > 0)
      );

    case 'system_wide':
      return (
        params.global === true ||
        params.systemWide === true
      );

    default:
      return false;
  }
}

/**
 * Check if params contain sensitive keywords
 */
function containsSensitiveKeywords(params: Record<string, unknown>): boolean {
  const sensitiveKeywords = [
    'password', 'secret', 'token', 'api_key', 'apikey',
    'credential', 'private', 'ssn', 'credit_card', 'bank',
  ];

  const paramsStr = JSON.stringify(params).toLowerCase();
  return sensitiveKeywords.some((kw) => paramsStr.includes(kw));
}

/**
 * Convert risk score to level
 */
function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Check if approval is required based on config
 */
function checkApprovalRequired(
  category: ActionCategory,
  actionType: string,
  riskLevel: RiskLevel,
  config: AutonomyConfig
): boolean {
  // Always require approval for blocked tools/categories
  if (config.blockedTools.includes(actionType)) {
    return true;
  }
  if (config.blockedCategories.includes(category)) {
    return true;
  }

  // Always require approval for confirmation-required actions
  if (config.confirmationRequired.includes(actionType)) {
    return true;
  }

  // Check if allowed regardless of level
  if (config.allowedTools.includes(actionType)) {
    return false;
  }
  if (config.allowedCategories.includes(category)) {
    return false;
  }

  // Check based on autonomy level
  switch (config.level) {
    case AutonomyLevel.MANUAL:
      // Always require approval
      return true;

    case AutonomyLevel.ASSISTED:
      // Require approval for everything
      return true;

    case AutonomyLevel.SUPERVISED:
      // Require approval for medium+ risk
      return riskLevel !== 'low';

    case AutonomyLevel.AUTONOMOUS:
      // Require approval for critical only
      return riskLevel === 'critical';

    case AutonomyLevel.FULL:
      // Never require approval (except blocked)
      return false;

    default:
      return true;
  }
}

/**
 * Generate mitigation suggestions
 */
function generateMitigations(presentFactors: RiskFactor[]): string[] {
  const mitigations: string[] = [];

  for (const factor of presentFactors) {
    switch (factor.name) {
      case 'Data Deletion':
        mitigations.push('Create a backup before deletion');
        mitigations.push('Use soft-delete if available');
        break;
      case 'Code Execution':
        mitigations.push('Review code before execution');
        mitigations.push('Run in sandboxed environment');
        break;
      case 'System Command':
        mitigations.push('Verify command safety');
        mitigations.push('Limit permissions');
        break;
      case 'External API':
        mitigations.push('Verify API endpoint');
        mitigations.push('Limit data sent');
        break;
      case 'Bulk Operation':
        mitigations.push('Process in smaller batches');
        mitigations.push('Add confirmation for each batch');
        break;
      case 'Sensitive Data':
        mitigations.push('Mask or redact sensitive fields');
        mitigations.push('Use encryption');
        break;
    }
  }

  return [...new Set(mitigations)]; // Remove duplicates
}

// ============================================================================
// Risk Level Utilities
// ============================================================================

/**
 * Get numeric value for risk level
 */
export function riskLevelToNumber(level: RiskLevel): number {
  switch (level) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 3;
    case 'critical': return 4;
  }
}

/**
 * Compare risk levels
 */
export function compareRiskLevels(a: RiskLevel, b: RiskLevel): number {
  return riskLevelToNumber(a) - riskLevelToNumber(b);
}

/**
 * Check if risk level is at or above threshold
 */
export function isRiskAtOrAbove(level: RiskLevel, threshold: RiskLevel): boolean {
  return riskLevelToNumber(level) >= riskLevelToNumber(threshold);
}

/**
 * Get color for risk level (for UI)
 */
export function getRiskLevelColor(level: RiskLevel): string {
  switch (level) {
    case 'low': return '#22c55e'; // green
    case 'medium': return '#f59e0b'; // amber
    case 'high': return '#ef4444'; // red
    case 'critical': return '#7c2d12'; // dark red
  }
}
