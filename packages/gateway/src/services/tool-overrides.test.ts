/**
 * Tool Overrides Tests
 *
 * Tests Gmail and Media tool override registration, including
 * integration checking and conditional registration logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./gmail-tool-executors.js', () => ({
  GMAIL_TOOL_EXECUTORS: {
    send_email: vi.fn(async () => ({ content: 'email sent' })),
    read_emails: vi.fn(async () => ({ content: 'emails read' })),
  },
}));

vi.mock('./media-tool-executors.js', () => ({
  MEDIA_TOOL_EXECUTORS: {
    generate_image: vi.fn(async () => ({ content: 'image generated' })),
    text_to_speech: vi.fn(async () => ({ content: 'audio generated' })),
  },
}));

const mockOauthIntegrationsRepo = {
  getByUserProviderService: vi.fn(),
};

const mockMediaSettingsRepo = {
  getEffective: vi.fn(),
};

vi.mock('../db/repositories/index.js', () => ({
  oauthIntegrationsRepo: {
    getByUserProviderService: (...args: unknown[]) => mockOauthIntegrationsRepo.getByUserProviderService(...args),
  },
  mediaSettingsRepo: {
    getEffective: (...args: unknown[]) => mockMediaSettingsRepo.getEffective(...args),
  },
}));

import {
  registerGmailToolOverrides,
  registerMediaToolOverrides,
  initializeToolOverrides,
} from './tool-overrides.js';

// ---------------------------------------------------------------------------
// Mock ToolRegistry
// ---------------------------------------------------------------------------

function createMockRegistry() {
  const tools = new Set<string>();
  return {
    has: vi.fn((name: string) => tools.has(name)),
    updateExecutor: vi.fn(() => true),
    _addTool(name: string) {
      tools.add(name);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // registerGmailToolOverrides
  // ========================================================================

  describe('registerGmailToolOverrides', () => {
    it('registers Gmail executors when integration is active', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'active',
      });

      const registry = createMockRegistry();
      registry._addTool('send_email');
      registry._addTool('read_emails');

      const count = await registerGmailToolOverrides(registry as any, 'user-1');

      expect(count).toBe(2);
      expect(registry.updateExecutor).toHaveBeenCalledTimes(2);
      expect(registry.updateExecutor).toHaveBeenCalledWith('send_email', expect.any(Function));
      expect(registry.updateExecutor).toHaveBeenCalledWith('read_emails', expect.any(Function));
    });

    it('returns 0 when Gmail is not configured', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue(null);

      const registry = createMockRegistry();
      const count = await registerGmailToolOverrides(registry as any);

      expect(count).toBe(0);
      expect(registry.updateExecutor).not.toHaveBeenCalled();
    });

    it('returns 0 when Gmail integration is not active', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'expired',
      });

      const registry = createMockRegistry();
      const count = await registerGmailToolOverrides(registry as any);

      expect(count).toBe(0);
    });

    it('skips tools not in registry', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'active',
      });

      const registry = createMockRegistry();
      registry._addTool('send_email');
      // read_emails NOT added to registry

      const count = await registerGmailToolOverrides(registry as any);

      expect(count).toBe(1); // only send_email
    });
  });

  // ========================================================================
  // registerMediaToolOverrides
  // ========================================================================

  describe('registerMediaToolOverrides', () => {
    it('registers Media executors when tools exist in registry', async () => {
      const registry = createMockRegistry();
      registry._addTool('generate_image');
      registry._addTool('text_to_speech');

      const count = await registerMediaToolOverrides(registry as any);

      expect(count).toBe(2);
      expect(registry.updateExecutor).toHaveBeenCalledWith('generate_image', expect.any(Function));
      expect(registry.updateExecutor).toHaveBeenCalledWith('text_to_speech', expect.any(Function));
    });

    it('returns 0 when no media tools in registry', async () => {
      const registry = createMockRegistry();

      const count = await registerMediaToolOverrides(registry as any);

      expect(count).toBe(0);
    });

    it('handles partial tool availability', async () => {
      const registry = createMockRegistry();
      registry._addTool('generate_image');
      // text_to_speech NOT in registry

      const count = await registerMediaToolOverrides(registry as any);

      expect(count).toBe(1);
    });
  });

  // ========================================================================
  // initializeToolOverrides
  // ========================================================================

  describe('initializeToolOverrides', () => {
    it('registers both Gmail and Media overrides', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'active',
      });

      const registry = createMockRegistry();
      registry._addTool('send_email');
      registry._addTool('read_emails');
      registry._addTool('generate_image');
      registry._addTool('text_to_speech');

      const result = await initializeToolOverrides(registry as any, 'user-1');

      expect(result.gmail).toBe(2);
      expect(result.media).toBe(2);
      expect(result.total).toBe(4);
    });

    it('handles Gmail registration failure gracefully', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockRejectedValue(
        new Error('DB connection lost')
      );

      const registry = createMockRegistry();
      registry._addTool('generate_image');

      const result = await initializeToolOverrides(registry as any);

      expect(result.gmail).toBe(0);
      expect(result.media).toBe(1);
      expect(result.total).toBe(1);
    });

    it('returns all zeros when nothing is configured', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue(null);

      const registry = createMockRegistry();

      const result = await initializeToolOverrides(registry as any);

      expect(result).toEqual({ gmail: 0, media: 0, total: 0 });
    });
  });
});
