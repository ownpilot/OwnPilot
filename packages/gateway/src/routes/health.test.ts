/**
 * Health Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mocks
const mockGetSandboxStatus = vi.fn();
const mockResetSandboxCache = vi.fn();
const mockEnsureImage = vi.fn();
const mockGetExecutionMode = vi.fn();

// Mock execFile to always reject so CLI tool checks show not-installed.
// vi.hoisted() is required here because vi.mock() is hoisted to the top of the file and
// would reference mockExecFile before it is initialized, causing a TDZ error.
const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn(function (
    _file: string,
    _args: string[],
    _opts: Record<string, unknown>,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) {
    callback(new Error(`${_file}: command not found`));
  });
  return { mockExecFile };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    VERSION: '1.0.0-test',
    getSandboxStatus: (...args: unknown[]) => mockGetSandboxStatus(...args),
    resetSandboxCache: (...args: unknown[]) => mockResetSandboxCache(...args),
    ensureImage: (...args: unknown[]) => mockEnsureImage(...args),
    getExecutionMode: () => mockGetExecutionMode(),
  };
});

const mockIsConnected = vi.fn();
const mockGetAdapterSync = vi.fn();

vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: () => mockGetAdapterSync(),
}));

const mockGetDatabaseConfig = vi.fn();

vi.mock('../db/adapters/types.js', () => ({
  getDatabaseConfig: () => mockGetDatabaseConfig(),
}));

import { healthRoutes } from './health.js';
import { requestId } from '../middleware/request-id.js';

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/health', healthRoutes);
  return app;
}

describe('Health Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockGetDatabaseConfig.mockReturnValue({
      postgresHost: 'localhost',
      postgresPort: 5432,
      postgresUser: 'testuser',
      postgresDatabase: 'testdb',
      postgresPassword: 'testpass',
    });
    mockGetAdapterSync.mockReturnValue({ isConnected: mockIsConnected });
    mockIsConnected.mockReturnValue(false);
    mockGetExecutionMode.mockReturnValue('local');
    mockGetSandboxStatus.mockResolvedValue({
      dockerAvailable: false,
      dockerVersion: null,
      relaxedSecurityRequired: false,
    });
  });

  describe('GET /health', () => {
    it('returns health status with version and uptime', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.version).toBe('1.0.0-test');
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
      expect(json.data.checks).toBeInstanceOf(Array);
      expect(json.data.checks).toHaveLength(3);
    });

    it('includes request metadata', async () => {
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.meta).toBeDefined();
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });

    it('reports healthy when all checks pass', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: true,
        dockerVersion: '24.0.5',
        relaxedSecurityRequired: false,
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.status).toBe('healthy');
      const coreCheck = json.data.checks.find((c: { name: string }) => c.name === 'core');
      expect(coreCheck.status).toBe('pass');
      const dbCheck = json.data.checks.find((c: { name: string }) => c.name === 'database');
      expect(dbCheck.status).toBe('pass');
      expect(dbCheck.message).toContain('POSTGRES connected');
      expect(dbCheck.message).toContain('localhost');
      const dockerCheck = json.data.checks.find((c: { name: string }) => c.name === 'docker');
      expect(dockerCheck.status).toBe('pass');
      expect(dockerCheck.message).toContain('Docker available');
      expect(dockerCheck.message).toContain('v24.0.5');
    });
    it('reports degraded when docker not available but mode is not docker', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetExecutionMode.mockReturnValue('local');
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: false,
        dockerVersion: null,
        relaxedSecurityRequired: false,
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.status).toBe('degraded');
      const dockerCheck = json.data.checks.find((c: { name: string }) => c.name === 'docker');
      expect(dockerCheck.status).toBe('warn');
      expect(dockerCheck.message).toContain('Docker not available - using local execution');
      expect(dockerCheck.message).toContain('mode: local');
    });

    it('reports degraded with fail when mode is docker but docker not available', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetExecutionMode.mockReturnValue('docker');
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: false,
        dockerVersion: null,
        relaxedSecurityRequired: false,
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.status).toBe('degraded');
      const dockerCheck = json.data.checks.find((c: { name: string }) => c.name === 'docker');
      expect(dockerCheck.status).toBe('fail');
      expect(dockerCheck.message).toBe('Docker not available - code execution disabled');
    });

    it('reports degraded when database is not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.status).toBe('degraded');
      const dbCheck = json.data.checks.find((c: { name: string }) => c.name === 'database');
      expect(dbCheck.status).toBe('warn');
      expect(dbCheck.message).toBe('POSTGRES not connected');
    });

    it('handles getAdapterSync throwing', async () => {
      mockGetAdapterSync.mockImplementation(() => {
        throw new Error('Not init');
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.database.connected).toBe(false);
    });

    it('handles getSandboxStatus throwing', async () => {
      mockGetSandboxStatus.mockRejectedValue(new Error('Docker check failed'));
      const res = await app.request('/health');
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.sandbox.dockerAvailable).toBe(false);
      expect(json.data.sandbox.dockerVersion).toBeNull();
    });
    it('shows strict security mode when docker available and not relaxed', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: true,
        dockerVersion: '25.0.0',
        relaxedSecurityRequired: false,
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.sandbox.dockerAvailable).toBe(true);
      expect(json.data.sandbox.dockerVersion).toBe('25.0.0');
      expect(json.data.sandbox.codeExecutionEnabled).toBe(true);
      expect(json.data.sandbox.securityMode).toBe('strict');
    });

    it('shows relaxed security mode', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: true,
        dockerVersion: '24.0.0',
        relaxedSecurityRequired: true,
      });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.sandbox.securityMode).toBe('relaxed');
    });

    it('shows local security mode when docker unavailable and mode is local', async () => {
      mockGetExecutionMode.mockReturnValue('local');
      mockGetSandboxStatus.mockResolvedValue({ dockerAvailable: false, dockerVersion: null });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.sandbox.securityMode).toBe('local');
      expect(json.data.sandbox.codeExecutionEnabled).toBe(true);
    });

    it('shows disabled security mode when docker unavailable and mode is docker', async () => {
      mockGetExecutionMode.mockReturnValue('docker');
      mockGetSandboxStatus.mockResolvedValue({ dockerAvailable: false, dockerVersion: null });
      const res = await app.request('/health');
      const json = await res.json();
      expect(json.data.sandbox.securityMode).toBe('disabled');
      expect(json.data.sandbox.codeExecutionEnabled).toBe(false);
    });

    it('shows database host in message when host is present', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetDatabaseConfig.mockReturnValue({
        postgresHost: 'db.example.com',
        postgresPort: 5432,
        postgresUser: 'user',
        postgresDatabase: 'mydb',
      });
      const res = await app.request('/health');
      const json = await res.json();
      const dbCheck = json.data.checks.find((c: { name: string }) => c.name === 'database');
      expect(dbCheck.message).toContain('(db.example.com)');
    });

    it('shows database message without host when host is empty', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetDatabaseConfig.mockReturnValue({
        postgresHost: '',
        postgresPort: 5432,
        postgresUser: 'user',
        postgresDatabase: 'mydb',
      });
      const res = await app.request('/health');
      const json = await res.json();
      const dbCheck = json.data.checks.find((c: { name: string }) => c.name === 'database');
      expect(dbCheck.message).toBe('POSTGRES connected');
    });

    it('shows docker version as unknown when dockerVersion is null', async () => {
      mockGetSandboxStatus.mockResolvedValue({
        dockerAvailable: true,
        dockerVersion: null,
        relaxedSecurityRequired: false,
      });
      const res = await app.request('/health');
      const json = await res.json();
      const dockerCheck = json.data.checks.find((c: { name: string }) => c.name === 'docker');
      expect(dockerCheck.message).toContain('vunknown');
    });
  });

  describe('GET /health/live', () => {
    it('returns liveness status', async () => {
      const res = await app.request('/health/live');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('ok');
    });
  });

  describe('GET /health/ready', () => {
    it('returns readiness status', async () => {
      const res = await app.request('/health/ready');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('ok');
    });
  });

  describe('GET /health/sandbox', () => {
    it('returns sandbox status without refresh', async () => {
      const sandboxData = {
        dockerAvailable: true,
        dockerVersion: '24.0.5',
        relaxedSecurityRequired: false,
      };
      mockGetSandboxStatus.mockResolvedValue(sandboxData);
      const res = await app.request('/health/sandbox');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual(sandboxData);
      expect(mockGetSandboxStatus).toHaveBeenCalledWith(false);
    });

    it('passes refresh=true to getSandboxStatus', async () => {
      mockGetSandboxStatus.mockResolvedValue({ dockerAvailable: false });
      const res = await app.request('/health/sandbox?refresh=true');
      expect(res.status).toBe(200);
      expect(mockGetSandboxStatus).toHaveBeenCalledWith(true);
    });

    it('returns 500 when getSandboxStatus throws Error', async () => {
      mockGetSandboxStatus.mockRejectedValue(new Error('Docker daemon not running'));
      const res = await app.request('/health/sandbox');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('SANDBOX_CHECK_FAILED');
      expect(json.error.message).toBe('Docker daemon not running');
    });

    it('returns fallback message when getSandboxStatus throws non-Error', async () => {
      mockGetSandboxStatus.mockRejectedValue('string error');
      const res = await app.request('/health/sandbox');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Failed to check sandbox status');
    });
  });

  describe('POST /health/sandbox/reset', () => {
    it('resets sandbox cache', async () => {
      const res = await app.request('/health/sandbox/reset', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('Sandbox cache reset');
      expect(mockResetSandboxCache).toHaveBeenCalledOnce();
    });
  });

  describe('POST /health/sandbox/pull-images', () => {
    it('pulls all images successfully', async () => {
      mockEnsureImage.mockResolvedValue(true);
      const res = await app.request('/health/sandbox/pull-images', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.images.python).toEqual({ success: true });
      expect(json.data.images.javascript).toEqual({ success: true });
      expect(json.data.images.shell).toEqual({ success: true });
      expect(mockEnsureImage).toHaveBeenCalledWith('python:3.11-slim');
      expect(mockEnsureImage).toHaveBeenCalledWith('node:20-slim');
      expect(mockEnsureImage).toHaveBeenCalledWith('alpine:latest');
    });

    it('reports failure when ensureImage throws', async () => {
      mockEnsureImage
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Pull failed'))
        .mockResolvedValueOnce(false);
      const res = await app.request('/health/sandbox/pull-images', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.images.python).toEqual({ success: true });
      expect(json.data.images.javascript).toEqual({ success: false, error: 'Pull failed' });
      expect(json.data.images.shell).toEqual({ success: false });
    });

    it('reports fallback error for non-Error throws', async () => {
      mockEnsureImage.mockRejectedValue('unknown');
      const res = await app.request('/health/sandbox/pull-images', { method: 'POST' });
      const json = await res.json();
      expect(json.data.images.python.success).toBe(false);
      expect(json.data.images.python.error).toBe('Unknown error');
    });
  });

  describe('GET /health/tool-dependencies', () => {
    it('returns 200 with packages, cliTools, and summary fields', async () => {
      const res = await app.request('/health/tool-dependencies');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.packages).toBeInstanceOf(Array);
      expect(json.data.cliTools).toBeInstanceOf(Array);
      expect(json.data.summary).toBeDefined();
      expect(typeof json.data.summary.packagesInstalled).toBe('number');
      expect(typeof json.data.summary.packagesTotal).toBe('number');
      expect(typeof json.data.summary.cliInstalled).toBe('number');
      expect(typeof json.data.summary.cliTotal).toBe('number');
    });

    it('packages array contains expected packages', async () => {
      const res = await app.request('/health/tool-dependencies');
      const json = await res.json();
      const packageNames = json.data.packages.map((p: { package: string }) => p.package);
      expect(packageNames).toContain('imapflow');
      expect(packageNames).toContain('nodemailer');
      expect(packageNames).toContain('sharp');
      expect(packageNames).toContain('pdf-parse');
      expect(packageNames).toContain('pdfkit');
    });

    it('summary has correct total counts', async () => {
      const res = await app.request('/health/tool-dependencies');
      const json = await res.json();
      const { summary } = json.data;
      expect(summary.packagesTotal).toBeGreaterThanOrEqual(5);
      expect(summary.cliTotal).toBeGreaterThanOrEqual(3);
      // installed counts must be within bounds
      expect(summary.packagesInstalled).toBeGreaterThanOrEqual(0);
      expect(summary.packagesInstalled).toBeLessThanOrEqual(summary.packagesTotal);
      expect(summary.cliInstalled).toBeGreaterThanOrEqual(0);
      expect(summary.cliInstalled).toBeLessThanOrEqual(summary.cliTotal);
    });

    it('each package entry has the required shape', async () => {
      const res = await app.request('/health/tool-dependencies');
      const json = await res.json();
      for (const pkg of json.data.packages) {
        expect(typeof pkg.package).toBe('string');
        expect(typeof pkg.category).toBe('string');
        expect(typeof pkg.description).toBe('string');
        expect(Array.isArray(pkg.tools)).toBe(true);
        expect(typeof pkg.installed).toBe('boolean');
        // version is either a string or null
        expect(pkg.version === null || typeof pkg.version === 'string').toBe(true);
      }
    });

    it('cliTools are marked as not installed when execFile fails', async () => {
      const res = await app.request('/health/tool-dependencies');
      const json = await res.json();
      const cliTools: Array<{ package: string; installed: boolean; type: string }> =
        json.data.cliTools;

      // All CLI tools should be not-installed because execFile is mocked to reject
      for (const cli of cliTools) {
        expect(cli.installed).toBe(false);
        expect(cli.type).toBe('cli');
      }

      expect(json.data.summary.cliInstalled).toBe(0);
    });

    it('cliTools array contains expected tool names', async () => {
      const res = await app.request('/health/tool-dependencies');
      const json = await res.json();
      const cliNames = json.data.cliTools.map((c: { package: string }) => c.package);
      expect(cliNames).toContain('ffmpeg');
      expect(cliNames).toContain('claude');
      expect(cliNames).toContain('codex');
      expect(cliNames).toContain('gemini');
    });

    it('marks CLI tool as installed when execFile succeeds', async () => {
      // First call succeeds (ffmpeg), rest fail
      mockExecFile.mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _opts: Record<string, unknown>,
          callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
        ) => {
          callback(null, { stdout: '5.1.2\n', stderr: '' });
        }
      );

      const res = await app.request('/health/tool-dependencies');
      expect(res.status).toBe(200);
      const json = await res.json();

      const cliTools: Array<{ package: string; installed: boolean; version: string | null }> =
        json.data.cliTools;
      const ffmpeg = cliTools.find((c) => c.package === 'ffmpeg');
      expect(ffmpeg?.installed).toBe(true);
      expect(ffmpeg?.version).toBe('5.1.2');
      expect(json.data.summary.cliInstalled).toBeGreaterThanOrEqual(1);
    });
  });
});
