/**
 * getLog() Tests
 *
 * Tests the scoped logger factory, ServiceRegistry integration,
 * fallback console logger, and caching behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChild = vi.fn();
const mockLogService = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: mockChild,
};

const mockRegistry = {
  get: vi.fn(() => mockLogService),
};

vi.mock('./registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry.js')>();
  return {
    ...actual,
    hasServiceRegistry: vi.fn(() => false),
    getServiceRegistry: vi.fn(() => mockRegistry),
  };
});

import { getLog } from './get-log.js';
import { hasServiceRegistry, getServiceRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getLog()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasServiceRegistry).mockReturnValue(false);
    vi.mocked(getServiceRegistry).mockReturnValue(mockRegistry as never);
  });

  // ========================================================================
  // Fallback logger (no ServiceRegistry)
  // ========================================================================

  describe('fallback logger', () => {
    it('returns a logger when no registry is available', () => {
      const log = getLog('TestModule');
      expect(log).toBeDefined();
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.child).toBe('function');
    });

    it('debug logs to console.debug with module prefix', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const log = getLog('MyModule');
      log.debug('test message');
      expect(spy).toHaveBeenCalledWith('[MyModule]', 'test message');
      spy.mockRestore();
    });

    it('info logs to console.log with module prefix', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = getLog('InfoMod');
      log.info('hello');
      expect(spy).toHaveBeenCalledWith('[InfoMod]', 'hello');
      spy.mockRestore();
    });

    it('warn logs to console.warn with module prefix', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = getLog('WarnMod');
      log.warn('caution');
      expect(spy).toHaveBeenCalledWith('[WarnMod]', 'caution');
      spy.mockRestore();
    });

    it('error logs to console.error with module prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const log = getLog('ErrMod');
      log.error('failure');
      expect(spy).toHaveBeenCalledWith('[ErrMod]', 'failure');
      spy.mockRestore();
    });

    it('logs with data object when provided', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = getLog('DataMod');
      const data = { key: 'value' };
      log.info('msg', data);
      expect(spy).toHaveBeenCalledWith('[DataMod]', 'msg', data);
      spy.mockRestore();
    });

    it('child() returns a scoped logger', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = getLog('Parent');
      const child = log.child('Sub');
      child.info('child message');
      expect(spy).toHaveBeenCalledWith('[Parent:Sub]', 'child message');
      spy.mockRestore();
    });

    it('caches fallback loggers by module name', () => {
      const log1 = getLog('CachedMod');
      const log2 = getLog('CachedMod');
      expect(log1).toBe(log2);
    });

    it('returns different loggers for different modules', () => {
      const log1 = getLog('ModA');
      const log2 = getLog('ModB');
      expect(log1).not.toBe(log2);
    });
  });

  // ========================================================================
  // ServiceRegistry integration
  // ========================================================================

  describe('ServiceRegistry integration', () => {
    it('uses registry log service when available', () => {
      const childLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
      mockChild.mockReturnValue(childLogger);
      vi.mocked(hasServiceRegistry).mockReturnValue(true);

      const log = getLog('RegModule');
      expect(mockChild).toHaveBeenCalledWith('RegModule');
      expect(log).toBe(childLogger);
    });

    it('falls back to console when registry get() throws', () => {
      vi.mocked(hasServiceRegistry).mockReturnValue(true);
      vi.mocked(getServiceRegistry).mockImplementation(() => {
        throw new Error('Not ready');
      });

      const log = getLog('FallbackMod2');
      expect(log).toBeDefined();
      expect(typeof log.info).toBe('function');
    });
  });
});
