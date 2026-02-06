/**
 * Tool Overrides Tests
 *
 * Tests Gmail tool override registration, including
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

const mockOauthIntegrationsRepo = {
  getByUserProviderService: vi.fn(),
};

vi.mock('../db/repositories/index.js', () => ({
  oauthIntegrationsRepo: {
    getByUserProviderService: (...args: unknown[]) => mockOauthIntegrationsRepo.getByUserProviderService(...args),
  },
}));

import type { ToolRegistry } from '@ownpilot/core';
import {
  registerGmailToolOverrides,
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

      const count = await registerGmailToolOverrides(registry as unknown as ToolRegistry, 'user-1');

      expect(count).toBe(2);
      expect(registry.updateExecutor).toHaveBeenCalledTimes(2);
      expect(registry.updateExecutor).toHaveBeenCalledWith('send_email', expect.any(Function));
      expect(registry.updateExecutor).toHaveBeenCalledWith('read_emails', expect.any(Function));
    });

    it('returns 0 when Gmail is not configured', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue(null);

      const registry = createMockRegistry();
      const count = await registerGmailToolOverrides(registry as unknown as ToolRegistry);

      expect(count).toBe(0);
      expect(registry.updateExecutor).not.toHaveBeenCalled();
    });

    it('returns 0 when Gmail integration is not active', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'expired',
      });

      const registry = createMockRegistry();
      const count = await registerGmailToolOverrides(registry as unknown as ToolRegistry);

      expect(count).toBe(0);
    });

    it('skips tools not in registry', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'active',
      });

      const registry = createMockRegistry();
      registry._addTool('send_email');
      // read_emails NOT added to registry

      const count = await registerGmailToolOverrides(registry as unknown as ToolRegistry);

      expect(count).toBe(1); // only send_email
    });
  });

  // ========================================================================
  // initializeToolOverrides
  // ========================================================================

  describe('initializeToolOverrides', () => {
    it('registers Gmail overrides', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({
        status: 'active',
      });

      const registry = createMockRegistry();
      registry._addTool('send_email');
      registry._addTool('read_emails');

      const result = await initializeToolOverrides(registry as unknown as ToolRegistry, 'user-1');

      expect(result.gmail).toBe(2);
      expect(result.total).toBe(2);
    });

    it('handles Gmail registration failure gracefully', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockRejectedValue(
        new Error('DB connection lost')
      );

      const registry = createMockRegistry();

      const result = await initializeToolOverrides(registry as unknown as ToolRegistry);

      expect(result.gmail).toBe(0);
      expect(result.total).toBe(0);
    });

    it('returns all zeros when nothing is configured', async () => {
      mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue(null);

      const registry = createMockRegistry();

      const result = await initializeToolOverrides(registry as unknown as ToolRegistry);

      expect(result).toEqual({ gmail: 0, total: 0 });
    });
  });
});
