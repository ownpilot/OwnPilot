/**
 * Gateway Service Implementations
 *
 * Barrel export for all service adapters that back the ServiceRegistry.
 * Each implementation wraps a gateway singleton behind its core interface.
 *
 * Usage:
 *   import { createLogService, GatewayConfigCenter } from './services/index.js';
 */

// Log Service
export { LogService, createLogService, type LogServiceOptions } from './log-service-impl.js';

// Session Service
export { SessionService, createSessionService } from './session-service-impl.js';

// Message Bus
export { MessageBus, createMessageBus } from './message-bus-impl.js';

// Config Center
export {
  GatewayConfigCenter,
  gatewayConfigCenter,
  gatewayApiKeyCenter,
} from './config-center-impl.js';

// Tool Service
export { ToolService, createToolService } from './tool-service-impl.js';

// Provider Service
export { ProviderService, createProviderService } from './provider-service-impl.js';

// Audit Service
export { AuditService, createAuditService } from './audit-service-impl.js';

// Plugin Service
export { PluginServiceImpl, createPluginService } from './plugin-service-impl.js';

// Memory Service
export { MemoryServiceImpl, createMemoryServiceImpl } from './memory-service-impl.js';

// Database Service
export { DatabaseServiceImpl, createDatabaseServiceImpl } from './database-service-impl.js';

// Workspace Service
export { WorkspaceServiceImpl, createWorkspaceServiceImpl } from './workspace-service-impl.js';

// Goal Service
export { GoalServiceImpl, createGoalServiceImpl } from './goal-service-impl.js';

// Trigger Service
export { TriggerServiceImpl, createTriggerServiceImpl } from './trigger-service-impl.js';

// Plan Service
export { PlanServiceImpl, createPlanServiceImpl } from './plan-service-impl.js';
