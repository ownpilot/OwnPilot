/**
 * CLI Chat Routes Tests
 *
 * Tests the CLI chat provider API endpoints:
 * - GET /providers - List all CLI providers
 * - GET /providers/:id - Get specific provider details
 * - POST /test/:id - Test a CLI provider
 * - GET /models/:id - List available models for provider
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mock CLI chat provider service
const mockDetectCliChatProviders = vi.fn();
const mockIsCliChatProvider = vi.fn();
const mockGetCliBinaryFromProviderId = vi.fn();
const mockGetCliChatProviderDefinition = vi.fn();
const mockCreateCliChatProvider = vi.fn();

vi.mock('../services/cli-chat-provider.js', () => ({
  detectCliChatProviders: mockDetectCliChatProviders,
  isCliChatProvider: mockIsCliChatProvider,
  getCliBinaryFromProviderId: mockGetCliBinaryFromProviderId,
  getCliChatProviderDefinition: mockGetCliChatProviderDefinition,
  createCliChatProvider: mockCreateCliChatProvider,
}));

// Mock binary utils
const mockIsBinaryInstalled = vi.fn();
const mockGetBinaryVersion = vi.fn();

vi.mock('../services/binary-utils.js', () => ({
  isBinaryInstalled: mockIsBinaryInstalled,
  getBinaryVersion: mockGetBinaryVersion,
}));

// Import after mocks
const { cliChatRoutes } = await import('./cli-chat.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/', cliChatRoutes);
  app.onError(errorHandler);
  return app;
}

describe('cliChatRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /providers', () => {
    it('returns list of CLI providers', async () => {
      const mockProviders = [
        { id: 'claude-code', name: 'Claude Code', installed: true },
        { id: 'chatgpt-cli', name: 'ChatGPT CLI', installed: false },
      ];
      mockDetectCliChatProviders.mockReturnValue(mockProviders);

      const app = createApp();
      const res = await app.request('/providers');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toEqual(mockProviders);
      expect(mockDetectCliChatProviders).toHaveBeenCalled();
    });
  });

  describe('GET /providers/:id', () => {
    it('returns provider details when found', async () => {
      const mockProvider = {
        id: 'claude-code',
        name: 'Claude Code',
        binary: 'claude',
        installed: true,
        defaultModel: 'claude-3-5-sonnet',
        models: ['claude-3-5-sonnet', 'claude-3-opus'],
      };
      mockGetCliChatProviderDefinition.mockReturnValue(mockProvider);
      mockGetBinaryVersion.mockReturnValue('1.2.3');

      const app = createApp();
      const res = await app.request('/providers/claude-code');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toMatchObject({
        id: 'claude-code',
        name: 'Claude Code',
        version: '1.2.3',
      });
    });

    it('returns 404 when provider not found', async () => {
      mockGetCliChatProviderDefinition.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/providers/unknown');
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('does not include version when not installed', async () => {
      mockGetCliChatProviderDefinition.mockReturnValue({
        id: 'chatgpt-cli',
        name: 'ChatGPT CLI',
        binary: 'chatgpt',
        installed: false,
      });

      const app = createApp();
      const res = await app.request('/providers/chatgpt-cli');
      const body = await res.json();

      expect(body.data.version).toBeUndefined();
      expect(mockGetBinaryVersion).not.toHaveBeenCalled();
    });
  });

  describe('POST /test/:id', () => {
    it('returns 400 for non-CLI provider', async () => {
      mockIsCliChatProvider.mockReturnValue(false);

      const app = createApp();
      const res = await app.request('/test/invalid-provider', { method: 'POST' });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when binary not found', async () => {
      mockIsCliChatProvider.mockReturnValue(true);
      mockGetCliBinaryFromProviderId.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/test/claude-code', { method: 'POST' });
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when binary not installed', async () => {
      mockIsCliChatProvider.mockReturnValue(true);
      mockGetCliBinaryFromProviderId.mockReturnValue('claude');
      mockIsBinaryInstalled.mockReturnValue(false);

      const app = createApp();
      const res = await app.request('/test/claude-code', { method: 'POST' });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('not installed');
    });

    it('returns success on completed test', async () => {
      mockIsCliChatProvider.mockReturnValue(true);
      mockGetCliBinaryFromProviderId.mockReturnValue('claude');
      mockIsBinaryInstalled.mockReturnValue(true);
      mockGetCliChatProviderDefinition.mockReturnValue({
        id: 'claude-code',
        defaultModel: 'claude-3-5-sonnet',
      });

      const mockProvider = {
        complete: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            content: 'CLI chat provider test successful',
            model: 'claude-3-5-sonnet',
          },
        }),
      };
      mockCreateCliChatProvider.mockReturnValue(mockProvider);

      const app = createApp();
      const res = await app.request('/test/claude-code', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toMatchObject({
        success: true,
        response: 'CLI chat provider test successful',
        model: 'claude-3-5-sonnet',
        provider: 'claude-code',
      });
    });

    it('returns failure on provider error', async () => {
      mockIsCliChatProvider.mockReturnValue(true);
      mockGetCliBinaryFromProviderId.mockReturnValue('claude');
      mockIsBinaryInstalled.mockReturnValue(true);
      mockGetCliChatProviderDefinition.mockReturnValue({
        id: 'claude-code',
        defaultModel: 'claude-3-5-sonnet',
      });

      const mockProvider = {
        complete: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'API key not configured' },
        }),
      };
      mockCreateCliChatProvider.mockReturnValue(mockProvider);

      const app = createApp();
      const res = await app.request('/test/claude-code', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toMatchObject({
        success: false,
        error: 'API key not configured',
        provider: 'claude-code',
      });
    });

    it('handles exceptions', async () => {
      mockIsCliChatProvider.mockReturnValue(true);
      mockGetCliBinaryFromProviderId.mockReturnValue('claude');
      mockIsBinaryInstalled.mockReturnValue(true);
      mockGetCliChatProviderDefinition.mockReturnValue({
        id: 'claude-code',
        defaultModel: 'claude-3-5-sonnet',
      });
      mockCreateCliChatProvider.mockImplementation(() => {
        throw new Error('Failed to create provider');
      });

      const app = createApp();
      const res = await app.request('/test/claude-code', { method: 'POST' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toMatchObject({
        success: false,
        error: 'Failed to create provider',
        provider: 'claude-code',
      });
    });
  });

  describe('GET /models/:id', () => {
    it('returns list of models for provider', async () => {
      mockGetCliChatProviderDefinition.mockReturnValue({
        id: 'claude-code',
        models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
        defaultModel: 'claude-3-5-sonnet',
      });

      const app = createApp();
      const res = await app.request('/models/claude-code');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toEqual([
        { id: 'claude-3-5-sonnet', name: 'claude-3-5-sonnet', provider: 'claude-code', isDefault: true },
        { id: 'claude-3-opus', name: 'claude-3-opus', provider: 'claude-code', isDefault: false },
        { id: 'claude-3-haiku', name: 'claude-3-haiku', provider: 'claude-code', isDefault: false },
      ]);
    });

    it('returns 404 when provider not found', async () => {
      mockGetCliChatProviderDefinition.mockReturnValue(null);

      const app = createApp();
      const res = await app.request('/models/unknown');
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
