/**
 * RuntimeContext — the canonical bundle of capabilities a runtime needs.
 *
 * Every autonomous runtime (Claw, Soul Heartbeat, Chat, Workflow, etc.)
 * needs access to roughly the same horizontal capabilities:
 *   - pick an LLM and ask about its context window / cost
 *   - send and receive on user channels (Telegram, Discord, ...)
 *   - look up service configuration (API keys, bot tokens)
 *   - emit and listen for events
 *
 * Without a bundle, each runtime imports the four getters separately,
 * which means (a) a new runtime forgets one, (b) tests have to set up
 * each capability independently, (c) the dependency surface is implicit.
 *
 * With this bundle, `getRuntimeContext()` returns the "system services"
 * every runtime gets. Runtimes can either pull individual capabilities
 * from it (less typing) or accept a RuntimeContext as a constructor
 * parameter (explicit dependency, easy to mock).
 *
 * IMPORTANT: RuntimeContext is for stateless / process-wide capabilities.
 * Per-call state (userId, conversationId, claw cycle context) belongs
 * in a separate execution context (AsyncLocalStorage or explicit args),
 * NOT here.
 */

import type { ILLMRouter } from './llm-router.js';
import type { IChannelService } from '../channels/service.js';
import type { ConfigCenter } from './config-center.js';
import type { IEventSystem } from '../events/event-system.js';
import type { IPermissionGate } from './permission-gate.js';
import type { IMemoryService } from './memory-service.js';
import type { IAuditService } from './audit-service.js';
import { getLLMRouter, hasLLMRouter } from './llm-router.js';
import { getChannelService, hasChannelService } from '../channels/service.js';
import { getConfigCenter, hasConfigCenter } from './config-center.js';
import { getEventSystem } from '../events/event-system.js';
import { getPermissionGate, hasPermissionGate } from './permission-gate.js';
import { getMemoryService, hasMemoryService } from './memory-service.js';
import { getAuditService, hasAuditService } from './audit-service.js';

/**
 * The horizontal capabilities every runtime gets. Add new capabilities here
 * as they're promoted to the two-layer architecture (PermissionGate,
 * MemoryService, etc.).
 */
export interface RuntimeContext {
  /** LLM provider/model selection, context window, cost. */
  readonly llm: ILLMRouter;
  /** Inbound/outbound messaging across channel plugins. */
  readonly channels: IChannelService;
  /** Service configuration (API keys, bot tokens, etc.) — read-only. */
  readonly config: ConfigCenter;
  /** Event bus + hook bus for cross-cutting pub/sub. */
  readonly events: IEventSystem;
  /** Tool-call authorization (allow / deny / require_approval). */
  readonly permissions: IPermissionGate;
  /** Per-user persistent memory (facts, preferences, conversation, events, skills). */
  readonly memory: IMemoryService;
  /** Audit + request logging (chat/tool/agent activity, security events). */
  readonly audit: IAuditService;
}

/**
 * Get the current process-wide runtime context. Throws if any required
 * capability is uninitialized.
 *
 * Most runtimes should just take this once at construction:
 *
 *   class MyRunner {
 *     constructor(private ctx: RuntimeContext = getRuntimeContext()) {}
 *   }
 *
 * That way tests can pass a mock context instead of stubbing each global.
 */
export function getRuntimeContext(): RuntimeContext {
  return {
    llm: getLLMRouter(),
    channels: getChannelService(),
    config: getConfigCenter(),
    events: getEventSystem(),
    permissions: getPermissionGate(),
    memory: getMemoryService(),
    audit: getAuditService(),
  };
}

/**
 * Check whether the runtime context is fully initialized — i.e. every
 * required capability has been registered. Use during early startup or
 * tests where boot order matters.
 *
 * The event system is always available (getEventSystem() lazy-creates a
 * default instance), so only the explicitly-registered capabilities are
 * checked here.
 */
export function hasRuntimeContext(): boolean {
  return (
    hasLLMRouter() &&
    hasChannelService() &&
    hasConfigCenter() &&
    hasPermissionGate() &&
    hasMemoryService() &&
    hasAuditService()
  );
}
