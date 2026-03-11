/**
 * Tools & Extensions Domain
 *
 * Bounded context for tool execution, custom tools,
 * user extensions, skills, and plugins.
 *
 * Tables: custom_tools, user_extensions, plugins
 *
 * Routes: /tools, /custom-tools, /extensions, /skills, /plugins
 */

export const toolsExtensionsDomain = {
  name: 'tools-extensions' as const,

  routes: [
    '/api/v1/tools',
    '/api/v1/custom-tools',
    '/api/v1/extensions',
    '/api/v1/skills',
    '/api/v1/plugins',
  ],

  tables: [
    'custom_tools',
    'user_extensions',
    'plugins',
  ],

  publicServices: [
    'tool-executor',
    'extension-service',
    'custom-tool-registry',
    'plugin-service',
  ],
} as const;
