/**
 * Platform & Config Domain
 *
 * Bounded context for system configuration:
 * auth, settings, providers, models, config center,
 * security, workspaces, costs, dashboard, database admin.
 *
 * Tables: config_services, config_entries, settings,
 *         system_settings, user_model_configs, custom_providers,
 *         user_provider_configs, local_providers, local_models,
 *         costs, user_workspaces, user_containers, expenses
 *
 * Routes: /auth, /health, /settings, /profile, /providers,
 *         /models, /model-configs, /model-routing,
 *         /config-services, /db, /security, /workspaces,
 *         /costs, /expenses, /dashboard, /file-workspaces
 */

export const platformDomain = {
  name: 'platform' as const,

  routes: [
    '/health',
    '/api/v1/auth',
    '/api/v1/health',
    '/api/v1/settings',
    '/api/v1/profile',
    '/api/v1/providers',
    '/api/v1/models',
    '/api/v1/model-configs',
    '/api/v1/model-routing',
    '/api/v1/config-services',
    '/api/v1/db',
    '/api/v1/dashboard',
    '/api/v1/security',
    '/api/v1/workspaces',
    '/api/v1/file-workspaces',
    '/api/v1/costs',
    '/api/v1/expenses',
  ],

  tables: [
    'config_services',
    'config_entries',
    'settings',
    'system_settings',
    'user_model_configs',
    'custom_providers',
    'user_provider_configs',
    'local_providers',
    'local_models',
    'costs',
    'expenses',
    'user_workspaces',
    'user_containers',
  ],

  publicServices: [
    'config-center',
    'provider-service',
    'model-routing',
    'workspace-service',
  ],
} as const;
