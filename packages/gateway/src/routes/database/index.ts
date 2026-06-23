/**
 * Database Admin Routes
 *
 * API endpoints for PostgreSQL database management, backup, restore, and maintenance.
 * Barrel module that merges all database sub-route modules into a single Hono app.
 */

import { Hono } from 'hono';
import { apiError, ERROR_CODES, safeKeyCompare } from '../helpers.js';
import { operationRoutes } from './operations.js';
import { backupRoutes } from './backup.js';
import { transferRoutes } from './transfer.js';
import { schemaRoutes } from './schema.js';
import { csvExportRoutes } from './csv-export.js';

export const databaseRoutes = new Hono();

// Admin guard for database operations (fail-closed).
// All routes under /database require X-Admin-Key header.
// GET routes are read-only but still sensitive (expose schema, size, config).
databaseRoutes.use('*', async (c, next) => {
  // Canonical name is ADMIN_API_KEY (shared with the debug routes); the legacy
  // ADMIN_KEY is still honored as a deprecated fallback so existing deployments
  // keep working.
  const adminKey = process.env.ADMIN_API_KEY ?? process.env.ADMIN_KEY;
  if (!adminKey) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'ADMIN_API_KEY environment variable must be set.',
      },
      403
    );
  }
  const providedKey = c.req.header('X-Admin-Key');
  if (!safeKeyCompare(providedKey, adminKey)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Admin key required. Set X-Admin-Key header.',
      },
      403
    );
  }
  return next();
});

// Mount sub-route modules (all paths are relative within sub-routers)
databaseRoutes.route('', operationRoutes);
databaseRoutes.route('', backupRoutes);
databaseRoutes.route('', transferRoutes);
databaseRoutes.route('', schemaRoutes);
databaseRoutes.route('', csvExportRoutes);
