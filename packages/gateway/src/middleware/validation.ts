/**
 * Request validation middleware — Public Facade
 *
 * Zod schemas for every JSON-accepting API endpoint. Schemas are grouped by
 * domain under `./schemas/`:
 *
 *   agent.ts            — agent CRUD, chat, autonomy, command center,
 *                         agent-to-agent messaging, subagents
 *   productivity.ts     — plans, goals, memories, expenses, pomodoro/habits/
 *                         captures
 *   workflow-claws.ts   — workflows, custom tools, claws, triggers, artifacts,
 *                         pulse directives, tool execution
 *   data.ts             — custom data tables, workspaces (incl. file write +
 *                         code execute), profile
 *   integrations.ts     — bridges, browser, config-services, costs, crews,
 *                         edge devices, local + remote providers, MCP, plugins,
 *                         settings, souls, voice
 *   common.ts           — `validateBody` helper
 *
 * 21 route files import from this facade — keep every symbol re-exported.
 */

export { validateBody } from './schemas/common.js';

export {
  createAgentSchema,
  updateAgentSchema,
  chatMessageSchema,
  autonomyConfigSchema,
  autonomyLevelSchema,
  autonomyBudgetSchema,
  pulseSettingsSchema,
  autonomyDecisionSchema,
  autonomyApproveRejectSchema,
  autonomyToolPermissionSchema,
  autonomyAssessSchema,
  autonomyApprovalRequestSchema,
  agentCommandSchema,
  deployFleetSchema,
  agentMissionSchema,
  agentExecuteSchema,
  agentToolsBatchUpdateSchema,
  sendAgentMessageSchema,
  spawnSubagentSchema,
} from './schemas/agent.js';

export {
  createPlanSchema,
  updatePlanSchema,
  createPlanStepSchema,
  updatePlanStepSchema,
  createGoalSchema,
  updateGoalSchema,
  createGoalStepsSchema,
  updateGoalStepSchema,
  completeGoalStepSchema,
  createMemorySchema,
  updateMemorySchema,
  boostMemorySchema,
  decayMemoriesSchema,
  cleanupMemoriesSchema,
  createExpenseSchema,
  updateExpenseSchema,
  startPomodoroSchema,
  createHabitSchema,
  createCaptureSchema,
  processCaptureSchema,
  createTaskSchema,
  updateTaskSchema,
  createBookmarkSchema,
  updateBookmarkSchema,
  createNoteSchema,
  updateNoteSchema,
  createContactSchema,
  updateContactSchema,
  createCalendarEventSchema,
  updateCalendarEventSchema,
} from './schemas/productivity.js';

export {
  TRIGGER_MIN_INTERVAL_MS,
  createTriggerSchema,
  pulseDirectivesSchema,
  createCustomToolSchema,
  updateCustomToolSchema,
  createWorkflowSchema,
  updateWorkflowSchema,
  workflowCopilotSchema,
  createArtifactSchema,
  updateArtifactSchema,
  clawLimitsSchema,
  createClawSchema,
  updateClawSchema,
  clawMessageSchema,
  clawDenyEscalationSchema,
  clawApplyRecommendationsSchema,
  executeToolSchema,
  batchExecuteToolsSchema,
  createFleetSchema,
  updateFleetSchema,
  addFleetTasksSchema,
  broadcastToFleetSchema,
} from './schemas/workflow-claws.js';

export {
  createCustomTableSchema,
  updateCustomTableSchema,
  createCustomRecordSchema,
  updateCustomRecordSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  toggleEnabledSchema,
  workspaceWriteFileSchema,
  workspaceExecuteCodeSchema,
  profileSetDataSchema,
  profileDeleteDataSchema,
  profileImportSchema,
  profileQuickSetupSchema,
} from './schemas/data.js';

export {
  createBridgeSchema,
  updateBridgeSchema,
  browserNavigateSchema,
  browserActionSchema,
  createBrowserWorkflowSchema,
  createConfigServiceSchema,
  updateConfigServiceSchema,
  createConfigEntrySchema,
  updateConfigEntrySchema,
  costEstimateSchema,
  costBudgetSchema,
  costRecordSchema,
  crewDeploySchema,
  crewMessageSchema,
  crewDelegateSchema,
  crewSyncSchema,
  createEdgeDeviceSchema,
  updateEdgeDeviceSchema,
  edgeDeviceCommandSchema,
  createLocalProviderSchema,
  updateLocalProviderSchema,
  providerConfigSchema,
  mcpToolCallSchema,
  createMcpServerSchema,
  mcpToolSettingsSchema,
  pluginSettingsSchema,
  setDefaultProviderSchema,
  setDefaultModelSchema,
  setApiKeySchema,
  setAllowedDirsSchema,
  setToolGroupsSchema,
  createSoulSchema,
  soulGoalSchema,
  soulMissionSchema,
  soulToolsSchema,
  soulCommandSchema,
  soulFeedbackSchema,
  synthesizeVoiceSchema,
  sendNotificationSchema,
  sendChannelNotificationSchema,
  broadcastNotificationSchema,
  notificationPreferencesSchema,
} from './schemas/integrations.js';
