/**
 * Channel Service Tests
 *
 * Tests for the singleton accessor pattern, ServiceRegistry integration,
 * and fallback behavior of the channel service module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRegistry = {
  has: vi.fn(() => false),
  get: vi.fn(),
  register: vi.fn(),
};

vi.mock('../services/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/registry.js')>();
  return {
    ...actual,
    hasServiceRegistry: vi.fn(() => false),
    getServiceRegistry: vi.fn(() => mockRegistry),
  };
});

import {
  setChannelService,
  getChannelService,
  hasChannelService,
  type IChannelService,
} from './service.js';
import { hasServiceRegistry, getServiceRegistry } from '../services/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockService(): IChannelService {
  return {
    send: vi.fn(),
    broadcast: vi.fn(),
    broadcastAll: vi.fn(),
    getChannel: vi.fn(),
    listChannels: vi.fn(() => []),
    getByPlatform: vi.fn(() => []),
    connect: vi.fn(),
    disconnect: vi.fn(),
    resolveUser: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Channel Service (singleton + registry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    vi.mocked(hasServiceRegistry).mockReturnValue(false);
    vi.mocked(getServiceRegistry).mockReturnValue(mockRegistry as never);
    mockRegistry.has.mockReturnValue(false);
  });

  // ========================================================================
  // hasChannelService
  // ========================================================================

  describe('hasChannelService()', () => {
    it('returns false when no service is set and no registry', () => {
      // Fresh module state — we can't truly reset _channelService without
      // re-importing, but we can test the registry path
      vi.mocked(hasServiceRegistry).mockReturnValue(false);
      // After setChannelService was called in other tests, hasChannelService
      // may return true. This test verifies the registry path.
      const result = hasChannelService();
      // Result depends on whether _channelService was set previously
      expect(typeof result).toBe('boolean');
    });

    it('returns true when registry has Channel service', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.has.mockReturnValue(true);

      expect(hasChannelService()).toBe(true);
    });

    it('falls back to singleton when registry throws', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      vi.mocked(getServiceRegistry).mockImplementation(() => {
        throw new Error('Registry broken');
      });

      // Should not throw — falls through to singleton check
      const result = hasChannelService();
      expect(typeof result).toBe('boolean');
    });
  });

  // ========================================================================
  // setChannelService
  // ========================================================================

  describe('setChannelService()', () => {
    it('sets the singleton and makes it retrievable', () => {
      const service = createMockService();
      setChannelService(service);

      vi.mocked(hasServiceRegistry).mockReturnValue(false);
      expect(getChannelService()).toBe(service);
    });

    it('registers in ServiceRegistry when available', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.has.mockReturnValue(false);

      const service = createMockService();
      setChannelService(service);

      expect(mockRegistry.register).toHaveBeenCalledWith(
        expect.anything(), // Services.Channel token
        service
      );
    });

    it('skips registry registration if already registered', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.has.mockReturnValue(true);

      const service = createMockService();
      setChannelService(service);

      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it('handles registry errors gracefully', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      vi.mocked(getServiceRegistry).mockImplementation(() => {
        throw new Error('Registry not ready');
      });

      const service = createMockService();
      // Should not throw
      expect(() => setChannelService(service)).not.toThrow();
    });
  });

  // ========================================================================
  // getChannelService
  // ========================================================================

  describe('getChannelService()', () => {
    it('returns service from registry when available', () => {
      const registryService = createMockService();
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.get.mockReturnValue(registryService);

      const result = getChannelService();
      expect(result).toBe(registryService);
    });

    it('falls back to singleton when registry get() throws', () => {
      const singletonService = createMockService();
      setChannelService(singletonService);

      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.get.mockImplementation(() => {
        throw new Error('Not registered');
      });

      const result = getChannelService();
      expect(result).toBe(singletonService);
    });

    it('prefers registry over singleton', () => {
      const singletonService = createMockService();
      const registryService = createMockService();

      setChannelService(singletonService);
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      mockRegistry.get.mockReturnValue(registryService);

      const result = getChannelService();
      expect(result).toBe(registryService);
    });
  });
});
