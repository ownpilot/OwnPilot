/**
 * Test helper: builds a Fastify app with routes registered but NOT started.
 * Mirrors src/index.ts setup for use with fastify.inject().
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from '../../src/api/routes.ts';
import { config } from '../../src/config.ts';

// Use the REAL config key (config.ts loads .env at module init, before our code runs)
export const TEST_API_KEY = config.bridgeApiKey;
export const TEST_AUTH_HEADER = `Bearer ${TEST_API_KEY}`;

export async function buildApp() {
  if (!process.env.SPAWN_RATE_LIMIT_MAX) process.env.SPAWN_RATE_LIMIT_MAX = '9999';
  if (!process.env.ORCH_RATE_LIMIT_MAX) process.env.ORCH_RATE_LIMIT_MAX = '9999';
  if (!process.env.MULTI_ORCH_RATE_LIMIT_MAX) process.env.MULTI_ORCH_RATE_LIMIT_MAX = '9999';

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Conversation-Id',
      'X-Project-Dir',
      'X-Session-Id',
    ],
    exposedHeaders: ['X-Conversation-Id', 'X-Session-Id', 'X-Bridge-Pattern', 'X-Bridge-Blocking'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const auth = request.headers['authorization'];
      if (auth?.startsWith('Bearer ')) return 'tok:' + auth.slice(7, 19);
      return request.ip ?? 'unknown';
    },
    errorResponseBuilder: (_request, context) => {
      const err = Object.assign(
        new Error(`Rate limit exceeded — max ${context.max} requests per ${context.after}`),
        { statusCode: context.statusCode ?? 429, error: { type: 'rate_limit_error', code: 'RATE_LIMITED' } },
      );
      return err;
    },
  });

  await registerRoutes(app);
  await app.ready();

  return app;
}
