/**
 * OpenAPI / Docs Routes
 *
 * GET /openapi.json — auto-generated OpenAPI 3.1 spec covering all v1 routes.
 * GET /docs         — Swagger UI explorer for the spec above.
 *
 * The spec is generated once on first request (the route table is fixed for
 * the lifetime of the process) and then cached. Pass the root Hono instance
 * to `registerOpenApiRoutes` so the generator can walk its `.routes` array.
 */

import type { Hono } from 'hono';
import { generateOpenApiSpec, type OpenApiSpec } from '../openapi/generator.js';
import { SWAGGER_UI_HTML } from '../openapi/swagger-html.js';
import { VERSION } from '@ownpilot/core';

export function registerOpenApiRoutes(app: Hono): void {
  // API-001: the OpenAPI spec and Swagger UI disclose the entire API surface to
  // anonymous callers. They are a development aid, so they are disabled in
  // production unless an operator explicitly opts in via ENABLE_API_DOCS=true.
  // Outside production they remain on for convenience. This deliberately avoids
  // wiring docs into the session-auth model (which has had IDOR/login-loop
  // regressions) — a hard on/off switch is the lower-risk control.
  const docsEnabled =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';
  if (!docsEnabled) return;

  let cached: OpenApiSpec | null = null;

  app.get('/openapi.json', (c) => {
    if (!cached) cached = generateOpenApiSpec(app, VERSION);
    return c.json(cached);
  });

  app.get('/docs', (c) => c.html(SWAGGER_UI_HTML));
}
