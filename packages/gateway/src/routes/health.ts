/**
 * Health check routes
 */

import { Hono } from 'hono';
import { VERSION, getSandboxStatus, resetSandboxCache, ensureImage } from '@ownpilot/core';
import type { HealthResponse, HealthCheck, ApiResponse } from '../types/index.js';

const startTime = Date.now();

export const healthRoutes = new Hono();

/**
 * Basic health check
 */
healthRoutes.get('/', (c) => {
  const uptime = (Date.now() - startTime) / 1000;

  const checks: HealthCheck[] = [
    {
      name: 'core',
      status: 'pass',
      message: 'Core module loaded',
    },
  ];

  const allPassing = checks.every((check) => check.status === 'pass');
  const hasWarnings = checks.some((check) => check.status === 'warn');

  const response: ApiResponse<HealthResponse> = {
    success: true,
    data: {
      status: allPassing ? 'healthy' : hasWarnings ? 'degraded' : 'unhealthy',
      version: VERSION,
      uptime,
      checks,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Liveness probe (Kubernetes)
 */
healthRoutes.get('/live', (c) => {
  return c.json({ status: 'ok' });
});

/**
 * Readiness probe (Kubernetes)
 */
healthRoutes.get('/ready', (c) => {
  // Could check database connections, external services, etc.
  return c.json({ status: 'ok' });
});

/**
 * Sandbox status and diagnostics
 * Returns Docker sandbox availability, security flags support, and available images
 */
healthRoutes.get('/sandbox', async (c) => {
  const refresh = c.req.query('refresh') === 'true';

  try {
    const status = await getSandboxStatus(refresh);

    const response: ApiResponse<typeof status> = {
      success: true,
      data: status,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'SANDBOX_CHECK_FAILED',
        message: error instanceof Error ? error.message : 'Failed to check sandbox status',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    }, 500);
  }
});

/**
 * Reset sandbox cache (useful after Docker restart or configuration changes)
 */
healthRoutes.post('/sandbox/reset', (c) => {
  resetSandboxCache();

  return c.json({
    success: true,
    data: { message: 'Sandbox cache reset. Next execution will re-detect Docker capabilities.' },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
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

  return c.json({
    success: true,
    data: { images: results },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
});
