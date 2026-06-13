/**
 * Settings / config sub-path.
 *
 * Re-exports the gateway-side helpers that the CLI needs to read and write
 * application settings (API keys, default provider/model, rate-limit knobs)
 * without pulling in the entire HTTP layer.
 */
export {
  getApiKey,
  hasApiKey,
  getDefaultProvider,
  getDefaultModel,
  setDefaultProvider,
  setDefaultModel,
  loadApiKeysToEnvironment,
  resolveDefaultProviderAndModel,
  isDemoModeFromSettings,
} from './services/app-settings.js';

export { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './config/defaults.js';
