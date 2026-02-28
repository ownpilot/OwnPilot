/**
 * Health check routes
 */

import { Hono } from 'hono';
import {
  VERSION,
  getSandboxStatus,
  resetSandboxCache,
  ensureImage,
  getExecutionMode,
} from '@ownpilot/core';
import type { HealthCheck } from '../types/index.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { getDatabaseConfig } from '../db/adapters/types.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

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
  const executionMode = getExecutionMode();

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
      status: sandboxStatus?.dockerAvailable
        ? 'pass'
        : executionMode !== 'docker'
          ? 'warn'
          : 'fail',
      message: sandboxStatus?.dockerAvailable
        ? `Docker available (v${sandboxStatus.dockerVersion ?? 'unknown'})`
        : executionMode !== 'docker'
          ? `Docker not available - using local execution (mode: ${executionMode})`
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
      codeExecutionEnabled: (sandboxStatus?.dockerAvailable ?? false) || executionMode !== 'docker',
      executionMode,
      securityMode: sandboxStatus?.dockerAvailable
        ? sandboxStatus?.relaxedSecurityRequired
          ? 'relaxed'
          : 'strict'
        : executionMode !== 'docker'
          ? 'local'
          : 'disabled',
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
    return apiError(
      c,
      {
        code: ERROR_CODES.SANDBOX_CHECK_FAILED,
        message: getErrorMessage(error, 'Failed to check sandbox status'),
      },
      500
    );
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
 * Tool dependencies status — checks which optional packages are installed
 * and what tools/features they enable.
 */
healthRoutes.get('/tool-dependencies', async (c) => {
  // Define all known optional dependencies with their tool mappings
  const deps: Array<{
    package: string;
    category: string;
    tools: string[];
    description: string;
  }> = [
    {
      package: 'imapflow',
      category: 'Email',
      tools: ['list_emails', 'read_email', 'delete_email', 'search_emails'],
      description: 'Read emails via IMAP',
    },
    {
      package: 'nodemailer',
      category: 'Email',
      tools: ['send_email', 'reply_email'],
      description: 'Send emails via SMTP',
    },
    {
      package: 'sharp',
      category: 'Image',
      tools: ['resize_image'],
      description: 'Image processing (resize, convert, compress)',
    },
    {
      package: 'pdf-parse',
      category: 'PDF',
      tools: ['read_pdf', 'get_pdf_info'],
      description: 'Parse and extract text from PDFs',
    },
    {
      package: 'pdfkit',
      category: 'PDF',
      tools: ['create_pdf'],
      description: 'Create PDF documents',
    },
    {
      package: 'music-metadata',
      category: 'Audio',
      tools: ['get_audio_info'],
      description: 'Extract audio metadata (duration, codec, tags)',
    },
    {
      package: '@anthropic-ai/claude-agent-sdk',
      category: 'Coding Agents',
      tools: ['run_coding_task'],
      description: 'Claude Code SDK for coding agent tasks',
    },
    {
      package: 'node-pty',
      category: 'Coding Agents',
      tools: ['run_coding_task'],
      description: 'Interactive terminal sessions for coding agents',
    },
  ];

  const results = await Promise.all(
    deps.map(async (dep) => {
      let installed = false;
      let version: string | null = null;

      try {
        const mod = await import(dep.package);
        installed = true;
        // Try to get version from the module or its package.json
        version = mod.version ?? mod.default?.version ?? null;
      } catch {
        // Not importable — try to read version from node_modules
        try {
          const pkgJson = await import(`${dep.package}/package.json`, { with: { type: 'json' } });
          installed = true;
          version = pkgJson.default?.version ?? pkgJson.version ?? null;
        } catch {
          // Package not installed
        }
      }

      return {
        package: dep.package,
        category: dep.category,
        tools: dep.tools,
        description: dep.description,
        installed,
        version,
      };
    })
  );

  // Also check external CLI tools
  const cliTools = [
    {
      name: 'ffmpeg',
      category: 'Audio',
      tools: ['split_audio'],
      description: 'Audio splitting and processing',
    },
    {
      name: 'claude',
      category: 'Coding Agents',
      tools: ['run_coding_task'],
      description: 'Claude Code CLI',
    },
    {
      name: 'codex',
      category: 'Coding Agents',
      tools: ['run_coding_task'],
      description: 'OpenAI Codex CLI',
    },
    {
      name: 'gemini',
      category: 'Coding Agents',
      tools: ['run_coding_task'],
      description: 'Google Gemini CLI',
    },
  ];

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);

  const cliResults = await Promise.all(
    cliTools.map(async (cli) => {
      let installed = false;
      let version: string | null = null;

      try {
        const { stdout } = await execFileP(cli.name, ['--version'], { timeout: 3000 });
        installed = true;
        // Extract version from output (first line, trim)
        const match = stdout.trim().match(/(\d+\.\d+[\w.-]*)/);
        version = match?.[1] ?? stdout.trim().split('\n')[0]!.slice(0, 50);
      } catch {
        // CLI not found or errored
      }

      return {
        package: cli.name,
        category: cli.category,
        tools: cli.tools,
        description: cli.description,
        installed,
        version,
        type: 'cli' as const,
      };
    })
  );

  const installedCount = results.filter((r) => r.installed).length;
  const cliInstalledCount = cliResults.filter((r) => r.installed).length;

  return apiResponse(c, {
    packages: results,
    cliTools: cliResults,
    summary: {
      packagesInstalled: installedCount,
      packagesTotal: results.length,
      cliInstalled: cliInstalledCount,
      cliTotal: cliResults.length,
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
        error: getErrorMessage(error),
      };
    }
  }

  return apiResponse(c, { images: results });
});
