/**
 * Plugins sub-path.
 *
 * Re-exports the gateway-side plugin lifecycle helpers. The CLI uses these
 * to bring the plugin registry online during server bootstrap.
 */
export { initializePlugins } from './plugins/index.js';
