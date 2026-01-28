/**
 * Assistant Module
 *
 * Provides the orchestration layer for the personal AI assistant.
 */

export {
  buildEnhancedSystemPrompt,
  checkToolCallApproval,
  evaluateTriggers,
  extractMemories,
  updateGoalProgress,
  getOrchestratorStats,
  type OrchestratorOptions,
  type EnhancedChatResult,
} from './orchestrator.js';
