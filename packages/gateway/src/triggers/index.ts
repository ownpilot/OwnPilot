/**
 * Triggers Module
 *
 * Proactive automation for the autonomous AI assistant.
 */

export {
  TriggerEngine,
  getTriggerEngine,
  startTriggerEngine,
  stopTriggerEngine,
  type TriggerEngineConfig,
  type ActionResult,
  type EventHandler,
  type TriggerEvent,
  type ChatHandler,
} from './engine.js';

export {
  DEFAULT_TRIGGERS,
  initializeDefaultTriggers,
  getProactiveStatus,
  enableProactiveFeature,
  disableProactiveFeature,
  enableAllProactive,
  disableAllProactive,
} from './proactive.js';
