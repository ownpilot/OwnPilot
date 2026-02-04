/**
 * Health check routes
 */

import { Hono } from 'hono';
import { VERSION, getSandboxStatus, resetSandboxCache, ensureImage } from '@ownpilot/core';
import type { HealthCheck } from '../types/index.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { getDatabaseConfig } from '../db/adapters/types.js';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js';

const startTime = Date.now();

export const healthRoutes = new Hono();

/**
 * Basic health check - includes Docker sandbox status
 */
healthRoutes.get('/', async (c) => {
  const uptime = (Date.now() - startTime) / 1000;

  // Get sandbox status (cached, fast)
  let sandboxStatus;
  try {
    sandboxStatus = await getSandboxStatus(false);
  } catch {
    sandboxStatus = null;
  }

  // Get PostgreSQL database status
  const config = getDatabaseConfig();
  const databaseStatus: { type: 'postgres'; connected: boolean; host?: string } = {
    type: 'postgres',
    connected: false,
    host: config.postgresHost,
  };

  try {
    const adapter = getAdapterSync();
    databaseStatus.connected = adapter.isConnected();
  } catch {
    // Adapter not initialized yet
  }

  const checks: HealthCheck[] = [
    {
      name: 'core',
      status: 'pass',
      message: 'Core module loaded',
    },
    {
      name: 'database',
      status: databaseStatus.connected ? 'pass' : 'warn',
      message: databaseStatus.connected
        ? `${databaseStatus.type.toUpperCase()} connected${databaseStatus.host ? ` (${databaseStatus.host})` : ''}`
        : `${databaseStatus.type.toUpperCase()} not connected`,
    },
    {
      name: 'docker',
      status: sandboxStatus?.dockerAvailable ? 'pass' : 'fail',
      message: sandboxStatus?.dockerAvailable
        ? `Docker available (v${sandboxStatus.dockerVersion ?? 'unknown'})`
        : 'Docker not available - code execution disabled',
    },
  ];

  const allPassing = checks.every((check) => check.status === 'pass');
  const hasWarnings = checks.some((check) => check.status === 'warn');
  const hasFails = checks.some((check) => check.status === 'fail');

  return apiResponse(c, {
    status: hasFails ? 'degraded' : allPassing ? 'healthy' : hasWarnings ? 'degraded' : 'unhealthy',
    version: VERSION,
    uptime,
    checks,
    database: databaseStatus,
    sandbox: {
      dockerAvailable: sandboxStatus?.dockerAvailable ?? false,
      dockerVersion: sandboxStatus?.dockerVersion ?? null,
      codeExecutionEnabled: sandboxStatus?.dockerAvailable ?? false,
      securityMode: sandboxStatus?.relaxedSecurityRequired ? 'relaxed' : 'strict',
    },
  });
});

/**
 * Liveness probe (Kubernetes)
 */
healthRoutes.get('/live', (c) => {
  return apiResponse(c, { status: 'ok' });
});

/**
 * Readiness probe (Kubernetes)
 */
healthRoutes.get('/ready', (c) => {
  // Could check database connections, external services, etc.
  return apiResponse(c, { status: 'ok' });
});

/**
 * Sandbox status and diagnostics
 * Returns Docker sandbox availability, security flags support, and available images
 */
healthRoutes.get('/sandbox', async (c) => {
  const refresh = c.req.query('refresh') === 'true';

  try {
    const status = await getSandboxStatus(refresh);

    return apiResponse(c, status);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SANDBOX_CHECK_FAILED, message: error instanceof Error ? error.message : 'Failed to check sandbox status' }, 500);
  }
});

/**
 * Reset sandbox cache (useful after Docker restart or configuration changes)
 */
healthRoutes.post('/sandbox/reset', (c) => {
  resetSandboxCache();

  return apiResponse(c, {
    message: 'Sandbox cache reset. Next execution will re-detect Docker capabilities.',
  });
});

/**
 * Pull Docker images for sandbox execution
 */
healthRoutes.post('/sandbox/pull-images', async (c) => {
  const images = [
    { name: 'python', image: 'python:3.11-slim' },
    { name: 'javascript', image: 'node:20-slim' },
    { name: 'shell', image: 'alpine:latest' },
  ];

  const results: Record<string, { success: boolean; error?: string }> = {};

  for (const { name, image } of images) {
    try {
      const success = await ensureImage(image);
      results[name] = { success };
    } catch (error) {
      results[name] = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return apiResponse(c, { images: results });
});
