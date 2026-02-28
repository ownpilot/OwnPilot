/**
 * Service Tokens - Typed keys for ServiceRegistry
 *
 * All service tokens are defined here. Each token is typed
 * to the interface it resolves to, ensuring type safety.
 *
 * Usage:
 *   import { Services } from '@ownpilot/core';
 *   const log = registry.get(Services.Log);       // typed as ILogService
 *   const events = registry.get(Services.Event);   // typed as IEventSystem
 */

import { ServiceToken } from './registry.js';
import type { ILogService } from './log-service.js';
import type { ISessionService } from './session-service.js';
import type { IMessageBus } from './message-bus.js';
import type { IToolService } from './tool-service.js';
import type { IProviderService } from './provider-service.js';
import type { IAuditService } from './audit-service.js';
import type { IEventSystem } from '../events/event-system.js';
import type { IChannelService } from '../channels/service.js';
import type { ConfigCenter } from './config-center.js';
import type { IPluginService } from './plugin-service.js';
import type { IMemoryService } from './memory-service-interface.js';
import type { IDatabaseService } from './database-service.js';
import type { IWorkspaceService } from './workspace-service.js';
import type { IGoalService } from './goal-service.js';
import type { ITriggerService } from './trigger-service.js';
import type { IPlanService } from './plan-service.js';
import type { IResourceService } from './resource-service.js';
import type { IWorkflowService } from './workflow-service.js';
import type { IMcpClientService } from './mcp-client-service.js';
import type { IExtensionService } from './extension-service.js';
import type { IEmbeddingService } from './embedding-service.js';
import type { IHeartbeatService } from './heartbeat-service.js';
import type { IPulseService } from './pulse-service.js';
import type { ICodingAgentService } from './coding-agent-service.js';
import type { ICliToolService } from './cli-tool-service.js';
import type { IBackgroundAgentService } from './background-agent-service.js';

/**
 * All service tokens.
 */
export const Services = {
  /** Structured logging */
  Log: new ServiceToken<ILogService>('log'),

  /** Event system (EventBus + HookBus) */
  Event: new ServiceToken<IEventSystem>('event'),

  /** Unified session management */
  Session: new ServiceToken<ISessionService>('session'),

  /** Unified message processing pipeline */
  Message: new ServiceToken<IMessageBus>('message'),

  /** Unified tool access */
  Tool: new ServiceToken<IToolService>('tool'),

  /** Unified channel service (multi-platform messaging) */
  Channel: new ServiceToken<IChannelService>('channel'),

  /** AI provider management */
  Provider: new ServiceToken<IProviderService>('provider'),

  /** Audit and request logging */
  Audit: new ServiceToken<IAuditService>('audit'),

  /** Config center (service configuration management) */
  Config: new ServiceToken<ConfigCenter>('config'),

  /** Plugin management */
  Plugin: new ServiceToken<IPluginService>('plugin'),

  /** Memory management (per-user) */
  Memory: new ServiceToken<IMemoryService>('memory'),

  /** Custom database tables and records */
  Database: new ServiceToken<IDatabaseService>('database'),

  /** Workspace management */
  Workspace: new ServiceToken<IWorkspaceService>('workspace'),

  /** Goal tracking and decomposition */
  Goal: new ServiceToken<IGoalService>('goal'),

  /** Proactive trigger management */
  Trigger: new ServiceToken<ITriggerService>('trigger'),

  /** Autonomous plan execution */
  Plan: new ServiceToken<IPlanService>('plan'),

  /** Resource type registry (metadata for tools & audit) */
  Resource: new ServiceToken<IResourceService>('resource'),

  /** Workflow execution engine */
  Workflow: new ServiceToken<IWorkflowService>('workflow'),

  /** MCP client (external tool server connections) */
  McpClient: new ServiceToken<IMcpClientService>('mcp-client'),

  /** User extensions (native bundles + AgentSkills) */
  Extension: new ServiceToken<IExtensionService>('extension'),

  /** Embedding generation for semantic search */
  Embedding: new ServiceToken<IEmbeddingService>('embedding'),

  /** Heartbeat management (NL-to-cron periodic tasks) */
  Heartbeat: new ServiceToken<IHeartbeatService>('heartbeat'),

  /** Autonomy Engine (Pulse System) */
  Pulse: new ServiceToken<IPulseService>('pulse'),

  /** External coding agent orchestration (Claude Code, Codex, Gemini CLI) */
  CodingAgent: new ServiceToken<ICodingAgentService>('coding-agent'),

  /** CLI tool discovery, execution, and management */
  CliTool: new ServiceToken<ICliToolService>('cli-tool'),

  /** Background agents (persistent, long-running autonomous agents) */
  BackgroundAgent: new ServiceToken<IBackgroundAgentService>('background-agent'),
} as const;
