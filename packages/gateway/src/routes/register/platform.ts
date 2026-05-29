/**
 * Platform & Configuration Route Registration
 *
 * Mounts all platform-related routes: auth, health, settings,
 * profile, providers, models, config services, tools, custom tools,
 * database admin, security, plugins, workspaces, and dashboard.
 */

import type { Hono } from 'hono';
import {
  healthRoutes,
  uiAuthRoutes,
  providerAuthRoutes,
  settingsRoutes,
  profileRoutes,
  providersRoutes,
  modelsRoutes,
  modelConfigsRoutes,
  modelRoutingRoutes,
  configServicesRoutes,
  toolsRoutes,
  customToolsRoutes,
  databaseRoutes,
  dashboardRoutes,
  securityRoutes,
  pluginsRoutes,
  workspaceRoutes,
  fileWorkspaceRoutes,
} from '../index.js';

export function registerPlatformRoutes(app: Hono): void {
  app.route('/health', healthRoutes);
  app.route('/api/v1/auth', uiAuthRoutes);
  // OAuth sign-in for LLM providers (Codex, etc) — distinct from the UI
  // session auth above. Mounted at its own prefix so the two namespaces
  // can't collide (uiAuth owns /login,/logout,/sessions; provider-auth
  // owns /oauth/device/start,/oauth/device/poll,/signout,/providers).
  app.route('/api/v1/provider-auth', providerAuthRoutes);
  app.route('/api/v1/health', healthRoutes); // Also mount at /api/v1 for API consistency

  // Settings & Profile
  app.route('/api/v1/settings', settingsRoutes);
  app.route('/api/v1/profile', profileRoutes);

  // Providers & Models
  app.route('/api/v1/providers', providersRoutes);
  app.route('/api/v1/models', modelsRoutes);
  app.route('/api/v1/model-configs', modelConfigsRoutes);
  app.route('/api/v1/model-routing', modelRoutingRoutes);

  // Config Center (centralized config management)
  app.route('/api/v1/config-services', configServicesRoutes);

  // Tools
  app.route('/api/v1/tools', toolsRoutes);
  app.route('/api/v1/custom-tools', customToolsRoutes);

  // Database Admin (migration, status, backup, restore)
  app.route('/api/v1/db', databaseRoutes);

  // Dashboard (AI-powered daily briefing)
  app.route('/api/v1/dashboard', dashboardRoutes);

  // Security Scanner (unified vulnerability analysis)
  app.route('/api/v1/security', securityRoutes);

  // Plugins (extensible plugin system)
  app.route('/api/v1/plugins', pluginsRoutes);

  // Workspaces (isolated user sandboxes)
  app.route('/api/v1/workspaces', workspaceRoutes);

  // File Workspaces (session-based file storage)
  app.route('/api/v1/file-workspaces', fileWorkspaceRoutes);

  // Prometheus metrics endpoint (under /api/v1 so it inherits auth middleware)
  app.get('/api/v1/metrics', async (c) => {
    const { renderMetrics } = await import('../../services/metric/service.js');
    const metrics = renderMetrics();
    return c.body(metrics, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  });
}
