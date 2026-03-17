/**
 * OpenClaw Bridge Daemon — Entry Point
 *
 * Fastify server that bridges OpenClaw (WhatsApp gateway) with Claude Code.
 * Implements OpenAI-compatible /v1/chat/completions endpoint.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import { registerRoutes, setShuttingDown } from './api/routes.ts';
import { claudeManager } from './claude-manager.ts';

// ---------------------------------------------------------------------------
// Build Fastify instance
// ---------------------------------------------------------------------------

const app = Fastify({
  logger: false, // We use pino directly
  disableRequestLogging: false,
  trustProxy: true,
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

await app.register(cors, {
  origin: true, // Allow all origins (OpenClaw gateway may vary)
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

// Rate limiting — per API key (auth token prefix), fallback to IP
await app.register(rateLimit, {
  global: true,
  max: 60,              // 60 requests/minute (general endpoints)
  timeWindow: '1 minute',
  keyGenerator: (request) => {
    const auth = request.headers['authorization'];
    // Use first 12 chars of token as rate-limit key (avoids logging full token)
    if (auth?.startsWith('Bearer ')) return 'tok:' + auth.slice(7, 19);
    return request.ip ?? 'unknown';
  },
  errorResponseBuilder: (_request, context) => {
    const err = new Error(`Rate limit exceeded — max ${context.max} requests per ${context.after}`) as Error & { statusCode?: number };
    err.statusCode = context.statusCode ?? 429;
    return err;
  },
});

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------

app.addHook('onRequest', async (request, _reply) => {
  logger.info(
    {
      method: request.method,
      url: request.url,
      ip: request.ip,
    },
    'Incoming request',
  );
});

app.addHook('onResponse', async (request, reply) => {
  logger.info(
    {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
    },
    'Request completed',
  );
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

await registerRoutes(app);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const DRAIN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received — starting graceful drain');

  // 1. Reject new requests with 503
  setShuttingDown();

  // 2. Hard deadline: force exit after drain timeout
  const forceTimer = setTimeout(() => {
    logger.error('Drain timeout exceeded — forcing exit');
    process.exit(1);
  }, DRAIN_TIMEOUT_MS).unref();

  try {
    // 3. Gracefully terminate all Claude Code sessions (in-flight work drains)
    await claudeManager.shutdownAll();
    logger.info('All sessions terminated');

    // 4. Stop accepting new TCP connections
    await app.close();
    logger.info('Fastify server closed');

    clearTimeout(forceTimer);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Handle uncaught exceptions — graceful shutdown with timeout
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — initiating graceful shutdown');
  // Give in-flight requests 5s to drain, then force exit
  void shutdown('uncaughtException');
  setTimeout(() => {
    logger.error('Graceful shutdown timed out after 5s — forcing exit');
    process.exit(1);
  }, 5_000).unref();
});

// Unhandled rejections: log but do NOT exit — prevents single rejected promise
// from killing all active sessions (R2 CRITICAL audit fix)
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection (non-fatal — continuing)');
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  try {
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info(
      {
        port: config.port,
        nodeEnv: config.nodeEnv,
        claudeModel: config.claudeModel,
        defaultProjectDir: config.defaultProjectDir,
        idleTimeoutMs: config.idleTimeoutMs,
      },
      'OpenClaw Bridge Daemon started',
    );

    // Health check on startup
    const sessions = claudeManager.getSessions();
    logger.info({ activeSessions: sessions.length }, 'Health check: OK');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

await start();
