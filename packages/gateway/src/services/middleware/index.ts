/**
 * Pipeline Middleware Setup
 *
 * Registers all middleware stages into the MessageBus.
 * Called during server startup after the MessageBus is created.
 *
 * Pipeline order:
 *   audit → persistence → post-processing → request-preprocessor → context-injection → agent-execution
 *
 * Because middleware wraps inside-out, the first registered runs outermost.
 * So audit runs first (wrapping everything), and agent-execution runs last (innermost).
 */

import type { IMessageBus } from '@ownpilot/core';
import { createContextInjectionMiddleware } from './context-injection.js';
import { createAgentExecutionMiddleware } from './agent-execution.js';
import { createPostProcessingMiddleware } from './post-processing.js';
import { createPersistenceMiddleware } from './persistence.js';
import { createAuditMiddleware } from './audit.js';
import { createRequestPreprocessorMiddleware } from './request-preprocessor.js';

export { createContextInjectionMiddleware } from './context-injection.js';
export { createAgentExecutionMiddleware } from './agent-execution.js';
export { createPostProcessingMiddleware } from './post-processing.js';
export { createPersistenceMiddleware } from './persistence.js';
export { createAuditMiddleware } from './audit.js';
export { createRequestPreprocessorMiddleware } from './request-preprocessor.js';

/**
 * Register all pipeline middleware into the MessageBus.
 *
 * Order matters: middleware registered first wraps the rest.
 * The chain runs top-to-bottom on the way in, bottom-to-top on the way out.
 *
 * Execution flow:
 *   → audit (enter)
 *     → persistence (enter)
 *       → post-processing (enter)
 *         → request-preprocessor (enter — classify request, determine relevant extensions)
 *           → context-injection (enter — inject only relevant extension/skill sections)
 *             → agent-execution (execute agent.chat())
 *           ← context-injection (exit)
 *         ← request-preprocessor (exit)
 *       ← post-processing (exit — memory/goal/trigger extraction)
 *     ← persistence (exit — save to DB)
 *   ← audit (exit — usage tracking, request logging)
 */
export function registerPipelineMiddleware(bus: IMessageBus): void {
  bus.useNamed('audit', createAuditMiddleware());
  bus.useNamed('persistence', createPersistenceMiddleware());
  bus.useNamed('post-processing', createPostProcessingMiddleware());
  bus.useNamed('request-preprocessor', createRequestPreprocessorMiddleware());
  bus.useNamed('context-injection', createContextInjectionMiddleware());
  bus.useNamed('agent-execution', createAgentExecutionMiddleware());
}
