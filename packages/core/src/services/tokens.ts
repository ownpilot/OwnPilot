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
} as const;
