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
export { MemoryService, getMemoryService } from './memory-service.js';

// Database Service
export { CustomDataService, getCustomDataService } from './custom-data-service.js';

// Workspace Service
export { WorkspaceServiceImpl, createWorkspaceServiceImpl } from './workspace-service-impl.js';

// Goal Service
export { GoalService, getGoalService } from './goal-service.js';

// Trigger Service
export { TriggerService, getTriggerService } from './trigger-service.js';

// Plan Service
export { PlanService, getPlanService } from './plan-service.js';

// Resource Service
export { ResourceServiceImpl, createResourceServiceImpl } from './resource-service-impl.js';
