import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPluginSecurityMiddleware } from './plugin-security.js';

describe('plugin-security middleware', () => {
  const middleware = createPluginSecurityMiddleware();

  // -----------------------------------------------------------------------
  // before() — trust / source bypass
  // -----------------------------------------------------------------------

  describe('before() — trust and source checks', () => {
    it('skips validation when trustLevel is trusted', async () => {
      // Dangerous args that would normally throw — should be ignored for trusted tools
      await expect(
        middleware.before!({
          toolName: 'my-tool',
          args: { path: '../../etc/passwd' },
          source: 'plugin',
          trustLevel: 'trusted',
        })
      ).resolves.toBeUndefined();
    });

    it('skips validation when source is not set', async () => {
      await expect(
        middleware.before!({
          toolName: 'my-tool',
          args: { cmd: 'rm -rf /; echo oops' },
          // source is undefined
        })
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // before() — argument validation
  // -----------------------------------------------------------------------

  describe('before() — argument validation', () => {
    it('blocks path traversal with forward slash (../)', async () => {
      await expect(
        middleware.before!({
          toolName: 'read-file',
          args: { path: '../../../etc/shadow' },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it('blocks path traversal with backslash (..\\)', async () => {
      await expect(
        middleware.before!({
          toolName: 'read-file',
          args: { path: '..\\..\\windows\\system32' },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it.each([
      [';', 'semicolon'],
      ['&', 'ampersand'],
      ['|', 'pipe'],
      ['`', 'backtick'],
      ['$', 'dollar sign'],
    ])('blocks shell injection character: %s (%s)', async (char, _label) => {
      await expect(
        middleware.before!({
          toolName: 'exec',
          args: { cmd: `echo hello${char} cat /etc/passwd` },
          source: 'custom',
          trustLevel: 'untrusted',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it('blocks XSS attempts with <script>', async () => {
      await expect(
        middleware.before!({
          toolName: 'render',
          args: { html: '<script>alert("xss")</script>' },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it('blocks XSS attempts with <script followed by space', async () => {
      await expect(
        middleware.before!({
          toolName: 'render',
          args: { html: '<script src="evil.js"></script>' },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it('blocks javascript: protocol', async () => {
      await expect(
        middleware.before!({
          toolName: 'navigate',
          args: { url: 'javascript:alert(1)' },
          source: 'plugin',
          trustLevel: 'untrusted',
        })
      ).rejects.toThrow('Potentially dangerous argument value detected');
    });

    it('allows safe arguments', async () => {
      await expect(
        middleware.before!({
          toolName: 'search',
          args: { query: 'hello world', limit: '10', filter: 'active' },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).resolves.toBeUndefined();
    });

    it('only checks string values, ignores numbers and booleans', async () => {
      await expect(
        middleware.before!({
          toolName: 'calc',
          args: { a: 42, b: true, c: false, d: 0 },
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // before() — rate limiting
  // -----------------------------------------------------------------------

  describe('before() — rate limiting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows the first 60 calls', async () => {
      const toolName = `rate-limit-test-${Date.now()}`;
      for (let i = 0; i < 60; i++) {
        await middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        });
      }
    });

    it('throws on the 61st call', async () => {
      const toolName = `rate-limit-61-${Date.now()}`;
      for (let i = 0; i < 60; i++) {
        await middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        });
      }

      await expect(
        middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('uses pluginId as rate limit key when available', async () => {
      const pluginId = `plugin-key-${Date.now()}`;
      // Exhaust rate limit using pluginId
      for (let i = 0; i < 60; i++) {
        await middleware.before!({
          toolName: 'tool-a',
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
          pluginId,
        });
      }

      // Same pluginId but different toolName should also be limited
      await expect(
        middleware.before!({
          toolName: 'tool-b',
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
          pluginId,
        })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('uses toolName as rate limit key when pluginId is not available', async () => {
      const toolName = `tool-no-plugin-${Date.now()}`;
      for (let i = 0; i < 60; i++) {
        await middleware.before!({
          toolName,
          args: {},
          source: 'custom',
          trustLevel: 'untrusted',
        });
      }

      await expect(
        middleware.before!({
          toolName,
          args: {},
          source: 'custom',
          trustLevel: 'untrusted',
        })
      ).rejects.toThrow(`Rate limit exceeded for '${toolName}'`);
    });

    it('refills tokens after 60 seconds', async () => {
      const toolName = `rate-limit-refill-${Date.now()}`;
      // Exhaust all tokens
      for (let i = 0; i < 60; i++) {
        await middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        });
      }

      // Confirm exhausted
      await expect(
        middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).rejects.toThrow('Rate limit exceeded');

      // Advance time past the refill window
      vi.advanceTimersByTime(60_001);

      // Should work again
      await expect(
        middleware.before!({
          toolName,
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        })
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // after() — output sanitization
  // -----------------------------------------------------------------------

  describe('after() — output sanitization', () => {
    it('returns result unchanged for trusted tools', async () => {
      const result = { content: 'x'.repeat(2_000_000), isError: false };
      const output = await middleware.after!(
        {
          toolName: 'my-tool',
          args: {},
          source: 'plugin',
          trustLevel: 'trusted',
        },
        result
      );
      expect(output).toBe(result);
    });

    it('returns result unchanged when source is not set', async () => {
      const result = { content: 'x'.repeat(2_000_000), isError: false };
      const output = await middleware.after!(
        {
          toolName: 'my-tool',
          args: {},
          // source is undefined
        },
        result
      );
      expect(output).toBe(result);
    });

    it('returns result unchanged for normal-sized output', async () => {
      const result = { content: 'This is fine.', isError: false };
      const output = await middleware.after!(
        {
          toolName: 'my-tool',
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        },
        result
      );
      expect(output).toBe(result);
    });

    it('truncates string output exceeding 1MB', async () => {
      const bigContent = 'a'.repeat(1_500_000);
      const result = { content: bigContent, isError: false };
      const output = await middleware.after!(
        {
          toolName: 'big-output',
          args: {},
          source: 'plugin',
          trustLevel: 'sandboxed',
        },
        result
      );
      expect(typeof output.content).toBe('string');
      const text = output.content as string;
      expect(text.length).toBeLessThan(bigContent.length);
      expect(text).toContain('... [output truncated]');
      // First 1MB preserved
      expect(text.startsWith('a'.repeat(1_000_000))).toBe(true);
    });

    it('adds truncated metadata to truncated results', async () => {
      const result = {
        content: 'b'.repeat(1_100_000),
        isError: false,
        metadata: { source: 'test' },
      };
      const output = await middleware.after!(
        {
          toolName: 'big-output',
          args: {},
          source: 'plugin',
          trustLevel: 'untrusted',
        },
        result
      );
      expect(output.metadata).toEqual({ source: 'test', truncated: true });
    });

    it('preserves isError flag on truncated results', async () => {
      const result = {
        content: 'e'.repeat(1_200_000),
        isError: true,
      };
      const output = await middleware.after!(
        {
          toolName: 'failing-tool',
          args: {},
          source: 'custom',
          trustLevel: 'untrusted',
        },
        result
      );
      expect(output.isError).toBe(true);
      expect((output.content as string).length).toBeLessThan(1_200_000);
    });
  });
});
