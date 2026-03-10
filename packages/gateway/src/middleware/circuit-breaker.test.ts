/**
 * Circuit Breaker Middleware Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createCircuitBreakerMiddleware,
  createServiceCircuitBreaker,
  CircuitBreakerError,
  getCircuitBreakerStats,
  resetAllCircuits,
  stopAllCircuitBreakers,
} from './circuit-breaker.js';

describe('Circuit Breaker Middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetAllCircuits();
    vi.useRealTimers();
    stopAllCircuitBreakers();
  });

  describe('createCircuitBreakerMiddleware', () => {
    it('should allow requests when circuit is CLOSED', async () => {
      const app = new Hono();
      app.use('/*', createCircuitBreakerMiddleware({ failureThreshold: 3 }));
      app.get('/test', (c) => c.json({ success: true }));

      const req = new Request('http://localhost/test');
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(res.headers.get('X-Circuit-Breaker')).toBe('CLOSED');
    });

    it('should open circuit after failure threshold', async () => {
      let requestCount = 0;
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 3,
          resetTimeoutMs: 10000,
          failureStatusCodes: [500],
        })
      );
      app.get('/test', (c) => {
        requestCount++;
        return c.json({ error: 'fail' }, 500);
      });

      // Send 3 failing requests
      for (let i = 0; i < 3; i++) {
        const req = new Request('http://localhost/test');
        await app.fetch(req);
      }

      // 4th request should be blocked by circuit breaker
      const req = new Request('http://localhost/test');
      const res = await app.fetch(req);

      expect(res.status).toBe(503);
      expect(requestCount).toBe(3); // Handler not called for 4th request
      expect(res.headers.get('X-Circuit-Breaker')).toBe('OPEN');
      expect(res.headers.get('Retry-After')).toBe('10');
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 5000,
          failureStatusCodes: [500],
          halfOpenMaxRate: 1, // Allow all requests in HALF_OPEN for testing
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      // Open the circuit
      const req1 = new Request('http://localhost/test');
      const appWithError = new Hono();
      appWithError.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 5000,
          failureStatusCodes: [500],
        })
      );
      appWithError.get('/test', (c) => c.json({ error: 'fail' }, 500));

      await appWithError.fetch(req1);

      // Advance time past reset timeout
      await vi.advanceTimersByTimeAsync(5001);

      // Should now be HALF_OPEN
      const req2 = new Request('http://localhost/test');
      const res = await app.fetch(req2);

      expect(res.headers.get('X-Circuit-Breaker')).toBe('HALF_OPEN');
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      let shouldFail = true;
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 1000,
          successThreshold: 2,
          failureStatusCodes: [500],
          halfOpenMaxRate: 1,
        })
      );
      app.get('/test', (c) => {
        if (shouldFail) {
          return c.json({ error: 'fail' }, 500);
        }
        return c.json({ success: true });
      });

      // First open the circuit
      await app.fetch(new Request('http://localhost/test'));

      // Advance time
      await vi.advanceTimersByTimeAsync(1001);

      // Now make it succeed
      shouldFail = false;

      // Send 2 successful requests in HALF_OPEN
      await app.fetch(new Request('http://localhost/test'));
      const res = await app.fetch(new Request('http://localhost/test'));

      expect(res.headers.get('X-Circuit-Breaker')).toBe('CLOSED');
    });

    it('should reopen circuit immediately on failure in HALF_OPEN', async () => {
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 1000,
          failureStatusCodes: [500],
          halfOpenMaxRate: 1,
        })
      );
      app.get('/test', (c) => c.json({ error: 'fail' }, 500));

      // Open circuit
      await app.fetch(new Request('http://localhost/test'));

      // Advance time to HALF_OPEN
      await vi.advanceTimersByTimeAsync(1001);

      // Fail in HALF_OPEN - circuit should reopen
      const res = await app.fetch(new Request('http://localhost/test'));

      expect(res.headers.get('X-Circuit-Breaker')).toBe('OPEN');
    });

    it('should exclude specified paths', async () => {
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          excludePaths: ['/health'],
        })
      );
      app.get('/health', (c) => c.json({ status: 'ok' }));
      app.get('/test', (c) => c.json({ error: 'fail' }, 500));

      // Health endpoint should work regardless
      const healthReq = new Request('http://localhost/health');
      const healthRes = await app.fetch(healthReq);
      expect(healthRes.status).toBe(200);

      // Other endpoint should trigger circuit breaker
      const testReq = new Request('http://localhost/test');
      await app.fetch(testReq);
      const testRes = await app.fetch(testReq);
      expect(testRes.headers.get('X-Circuit-Breaker')).toBe('OPEN');
    });

    it('should include Retry-After header when circuit is OPEN', async () => {
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 30000,
          failureStatusCodes: [500],
        })
      );
      app.get('/test', (c) => c.json({ error: 'fail' }, 500));

      await app.fetch(new Request('http://localhost/test'));
      const res = await app.fetch(new Request('http://localhost/test'));

      expect(res.status).toBe(503);
      const retryAfter = res.headers.get('Retry-After');
      expect(retryAfter).toBeDefined();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('should handle exceptions as failures', async () => {
      let requestCount = 0;
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 1,
          resetTimeoutMs: 10000,
          failureStatusCodes: [500],
        })
      );
      app.get('/test', (c) => {
        requestCount++;
        return c.json({ error: 'fail' }, 500);
      });

      // First request fails
      const req1 = new Request('http://localhost/test');
      const res1 = await app.fetch(req1);
      expect(res1.status).toBe(500);

      // Circuit should be open on next request
      const req2 = new Request('http://localhost/test');
      const res2 = await app.fetch(req2);
      expect(res2.status).toBe(503);
      expect(requestCount).toBe(1); // Handler only called once
    });

    it('should track successes correctly in CLOSED state', async () => {
      const app = new Hono();
      app.use(
        '/*',
        createCircuitBreakerMiddleware({
          failureThreshold: 3,
          failureStatusCodes: [500],
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      // Send multiple successful requests
      for (let i = 0; i < 5; i++) {
        const req = new Request('http://localhost/test');
        await app.fetch(req);
      }

      // Circuit should remain CLOSED
      const stats = getCircuitBreakerStats().find((s) => s.key === '/test');
      expect(stats?.state).toBe('CLOSED');
    });
  });

  describe('createServiceCircuitBreaker', () => {
    it('should execute function when circuit is CLOSED', async () => {
      const cb = createServiceCircuitBreaker('test-service');
      const fn = vi.fn().mockResolvedValue('success');

      const result = await cb.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw CircuitBreakerError when circuit is OPEN', async () => {
      const cb = createServiceCircuitBreaker('failing-service', {
        failureThreshold: 1,
        resetTimeoutMs: 10000,
      });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Next call should throw CircuitBreakerError
      await expect(cb.execute(() => Promise.resolve('success'))).rejects.toThrow(
        CircuitBreakerError
      );
    });

    it('should provide retry after in error', async () => {
      const cb = createServiceCircuitBreaker('failing-service', {
        failureThreshold: 1,
        resetTimeoutMs: 30000,
      });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      try {
        await cb.execute(() => Promise.resolve('success'));
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError);
        expect((error as CircuitBreakerError).retryAfter).toBeGreaterThan(0);
      }
    });

    it('should expose state and stats', async () => {
      const cb = createServiceCircuitBreaker('test-service', {
        failureThreshold: 3,
      });

      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats()).toEqual({
        state: 'CLOSED',
        failures: 0,
        successes: 0,
      });
    });

    it('should allow manual reset', async () => {
      const cb = createServiceCircuitBreaker('test-service', {
        failureThreshold: 1,
        resetTimeoutMs: 10000,
      });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(cb.getState()).toBe('OPEN');

      // Reset
      cb.reset();
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  describe('getCircuitBreakerStats', () => {
    it('should return empty array when no circuits', () => {
      const stats = getCircuitBreakerStats();
      expect(stats).toEqual([]);
    });

    it('should return stats for all circuits', async () => {
      const cb1 = createServiceCircuitBreaker('service-1');
      const cb2 = createServiceCircuitBreaker('service-2');

      await cb1.execute(() => Promise.resolve('ok'));
      await cb2.execute(() => Promise.resolve('ok'));

      const stats = getCircuitBreakerStats();
      expect(stats).toHaveLength(2);
      expect(stats.map((s) => s.key)).toContain('service-1');
      expect(stats.map((s) => s.key)).toContain('service-2');
    });
  });

  describe('resetAllCircuits', () => {
    it('should reset all circuits to CLOSED', async () => {
      const cb1 = createServiceCircuitBreaker('service-1', { failureThreshold: 1 });
      const cb2 = createServiceCircuitBreaker('service-2', { failureThreshold: 1 });

      // Open both circuits
      await expect(cb1.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb2.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(cb1.getState()).toBe('OPEN');
      expect(cb2.getState()).toBe('OPEN');

      // Reset all
      resetAllCircuits();

      expect(cb1.getState()).toBe('CLOSED');
      expect(cb2.getState()).toBe('CLOSED');
    });
  });
});
