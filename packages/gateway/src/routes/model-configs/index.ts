/**
 * Model Configs Routes - Barrel
 *
 * Merges sub-routers (models, providers, pricing) into a single Hono app
 * that is mounted at /api/v1/model-configs in the server.
 */

import { Hono } from 'hono';
import { modelRoutes } from './models.js';
import { providerRoutes } from './providers.js';
import { pricingRoutes } from './pricing.js';

const app = new Hono();

// Pricing/sync routes must come before models to avoid /:provider catching /sync
app.route('', pricingRoutes);
// Provider routes must come before parameterized model routes
app.route('', providerRoutes);
// Model routes include parameterized /:provider and /:provider/:model (must be last)
app.route('', modelRoutes);

export const modelConfigsRoutes = app;
export default app;
