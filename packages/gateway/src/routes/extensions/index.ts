/**
 * Extensions Routes - Barrel
 *
 * Merges all extension sub-routers into a single Hono app.
 */

import { Hono } from 'hono';
import { crudRoutes } from './crud.js';
import { installRoutes } from './install.js';
import { generationRoutes } from './generation.js';
import { scannerRoutes } from './scanner.js';
import { auditRoutes } from './audit.js';

export const extensionsRoutes = new Hono();

// Mount sub-routers (order matters: specific paths before parameterized ones)
extensionsRoutes.route('', installRoutes);
extensionsRoutes.route('', generationRoutes);
extensionsRoutes.route('', scannerRoutes);
extensionsRoutes.route('', auditRoutes);
extensionsRoutes.route('', crudRoutes);
