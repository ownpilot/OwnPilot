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

export const databaseRoutes = new Hono();

// Admin guard for database operations (fail-closed).
// Destructive routes (POST/DELETE) and export always require X-Admin-Key header.
// Read-only GET routes (status, stats) are allowed with standard auth only.
databaseRoutes.use('*', async (c, next) => {
  // Allow read-only GET requests (status, stats) — but NOT export
  const path = new URL(c.req.url).pathname;
  if (c.req.method === 'GET' && !path.endsWith('/export')) {
    return next();
  }
  // Destructive operations (POST, DELETE) and export require admin key
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'ADMIN_KEY environment variable must be set for database write operations.',
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
        message: 'Admin key required for this operation. Set X-Admin-Key header.',
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
