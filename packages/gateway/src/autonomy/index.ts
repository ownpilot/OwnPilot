/**
 * Autonomy Module
 *
 * Autonomy levels, risk assessment, and approval flow for the AI assistant.
 *
 * This barrel exposes only the surface other gateway modules consume. For
 * the full subsystem surface (constants, pulse engine internals, evaluator
 * config, etc.) import the submodule files directly — see routes/autonomy.ts
 * for the pattern.
 */

export {
  AutonomyLevel,
  AUTONOMY_LEVEL_NAMES,
  AUTONOMY_LEVEL_DESCRIPTIONS,
  type ActionCategory,
  type ApprovalDecision,
} from './types.js';

export { assessRisk } from './risk.js';

export { getApprovalManager } from './approvals.js';

export { getAutonomyEngine } from './engine.js';

export { checkAutonomy } from './autonomy-guard.js';
