/**
 * Workspace Routes - Barrel
 *
 * Merges all workspace sub-route modules into a single Hono app.
 * Preserves the original API surface so consumers don't need changes.
 */

import { Hono } from 'hono';
import { workspaceCrudRoutes } from './crud.js';
import { workspaceFileRoutes } from './files.js';
import { workspaceExecutionRoutes } from './execution.js';
import { workspaceContainerRoutes } from './container.js';

const app = new Hono();

// System routes must be registered before parameterized routes
// to avoid /system/status being matched as /:id
app.route('', workspaceContainerRoutes);
app.route('', workspaceCrudRoutes);
app.route('', workspaceFileRoutes);
app.route('', workspaceExecutionRoutes);

export const workspaceRoutes = app;
