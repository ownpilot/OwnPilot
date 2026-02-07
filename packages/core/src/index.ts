/**
 * @ownpilot/core
 *
 * Zero-dependency secure gateway foundation.
 * Uses only Node.js built-in modules.
 *
 * @packageDocumentation
 */

// Types
export * from './types/index.js';

// Crypto
export * from './crypto/index.js';

// Audit
export * from './audit/index.js';

// Privacy
export * from './privacy/index.js';

// Sandbox
export * from './sandbox/index.js';

// Agent
export * from './agent/index.js';

// Credentials
export * from './credentials/index.js';

// Scheduler
export * from './scheduler/index.js';

// Secure Memory
export * from './memory/index.js';

// Events
export * from './events/index.js';

// Plugins
export * from './plugins/index.js';

// Assistant
export * from './assistant/index.js';

// Integrations
export * from './integrations/index.js';

// Services (ServiceRegistry, interfaces, tokens, media, weather)
export * from './services/index.js';

// Notifications
export * from './notifications/index.js';

// Cost Tracking
export * from './costs/index.js';

// Data Gateway
export * from './data-gateway/index.js';

// User Workspace Isolation
export * from './workspace/index.js';

// Agent Router
export * from './agent-router/index.js';

// Agent Executor
export * from './agent-executor/index.js';

// Agent Builder
export * from './agent-builder/index.js';

// Security (critical pattern blocking, code risk analysis)
export * from './security/index.js';
export * from './security/code-analyzer.js';

// Channels (unified multi-platform messaging)
export * from './channels/index.js';

// Version
export const VERSION = '0.1.0';
