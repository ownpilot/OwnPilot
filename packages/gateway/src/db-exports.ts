/**
 * Database bootstrap sub-path.
 *
 * Re-exports the gateway-side helpers that the CLI needs to bring the
 * database adapter, settings, and seed data online before it can read
 * configuration or start the server.
 */
export { initializeAdapter, closeAdapter, getAdapter } from './db/adapters/index.js';

export { settingsRepo } from './db/repositories/index.js';

export {
  initializeSettingsRepo,
  initializeConfigServicesRepo,
  initializeLocalProvidersRepo,
  initializePluginsRepo,
} from './db/repositories/index.js';

export { getDatabasePath } from './paths/index.js';
export { seedConfigServices } from './db/seeds/config-services-seed.js';
