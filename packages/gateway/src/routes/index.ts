/**
 * Route exports
 */

export { healthRoutes } from './health.js';
export { agentRoutes, getAgent, getOrCreateDefaultAgent, getOrCreateChatAgent, getWorkspaceContext } from './agents.js';
export { chatRoutes } from './chat.js';
export { toolsRoutes } from './tools.js';
export { settingsRoutes, hasApiKey, getApiKey, getApiKeySource } from './settings.js';
export { channelRoutes, addIncomingMessage, markMessageReplied } from './channels.js';
export { costRoutes, usageTracker, budgetManager } from './costs.js';
export { modelsRoutes } from './models.js';
export { providersRoutes } from './providers.js';
export { profileRoutes } from './profile.js';
export { personalDataRoutes } from './personal-data.js';
export { executePersonalDataTool } from './personal-data-tools.js';
export { customDataRoutes, executeCustomDataTool } from './custom-data.js';
export { memoriesRoutes, executeMemoryTool } from './memories.js';
export { goalsRoutes, executeGoalTool } from './goals.js';
export { triggersRoutes } from './triggers.js';
export { plansRoutes } from './plans.js';
export { autonomyRoutes } from './autonomy.js';
export { auditRoutes } from './audit.js';
export { workspaceRoutes } from './workspaces.js';
export { fileWorkspaceRoutes } from './file-workspaces.js';
export { pluginsRoutes } from './plugins.js';
export { productivityRoutes } from './productivity.js';
export { authRoutes } from './auth.js';
export { integrationsRoutes } from './integrations.js';

export { modelConfigsRoutes } from './model-configs.js';
export { dashboardRoutes } from './dashboard.js';
export {
  customToolsRoutes,
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
  isCustomTool,
} from './custom-tools.js';
export { databaseRoutes } from './database.js';
export { expensesRoutes } from './expenses.js';
export { configServicesRoutes } from './config-services.js';
export { localProvidersRoutes } from './local-providers.js';
export { channelAuthRoutes } from './channel-auth.js';
export { debugRoutes } from './debug.js';
export { executionPermissionsRoutes } from './execution-permissions.js';
