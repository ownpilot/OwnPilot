/**
 * Scheduler sub-path.
 *
 * Re-exports the gateway-side scheduler lifecycle helpers. The CLI uses
 * these when starting the server in detached mode.
 */
export { initializeScheduler, getScheduler, stopScheduler } from './scheduler/index.js';
