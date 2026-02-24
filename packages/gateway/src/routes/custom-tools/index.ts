/**
 * Custom Tools Routes - Barrel
 *
 * Merges sub-routers into a single Hono app and re-exports public functions.
 */

import { Hono } from 'hono';
import { crudRoutes } from './crud.js';
import { approvalRoutes } from './approval.js';
import { analysisRoutes } from './analysis.js';
import { generationRoutes } from './generation.js';

const customToolsRoutes = new Hono();

customToolsRoutes.route('', crudRoutes);
customToolsRoutes.route('', approvalRoutes);
customToolsRoutes.route('', analysisRoutes);
customToolsRoutes.route('', generationRoutes);

export { customToolsRoutes };

// Re-export public functions used by other modules
export {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} from './generation.js';
