/**
 * Multi-Provider Support
 *
 * Config-driven provider system with:
 * - JSON-based provider configurations
 * - Automatic provider selection/routing
 * - Support for 10+ AI providers
 *
 * @packageDocumentation
 */

// Provider configurations (JSON-based)
export * from './configs/index.js';

// Individual providers
export * from './openai-compatible.js';
export * from './google.js';

// Provider router (smart selection)
export * from './router.js';

// Fallback provider (automatic failover)
export * from './fallback.js';

// Aggregator providers (fal.ai, together.ai, groq, etc.)
export * from './aggregators.js';
