/**
 * Timing Middleware Tests
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { timing } from './timing.js';

function createApp() {
  const app = new Hono();
  app.use('*', timing);
  app.get('/test', (c) => {
    return c.json({ startTime: c.get('startTime') });
  });
  return app;
}

describe('timing middleware', () => {
  it('sets X-Response-Time header on response', async () => {
    const app = createApp();
    const res = await app.request('/test');
    const responseTime = res.headers.get('X-Response-Time');
    expect(responseTime).toBeTruthy();
    expect(responseTime).toMatch(/^\d+\.\d{2}ms$/);
  });

  it('sets startTime context variable', async () => {
    const app = createApp();
    const res = await app.request('/test');
    const json = await res.json();
    expect(typeof json.startTime).toBe('number');
    expect(json.startTime).toBeGreaterThan(0);
  });

  it('response time is a non-negative number', async () => {
    const app = createApp();
    const res = await app.request('/test');
    const responseTime = res.headers.get('X-Response-Time');
    const ms = parseFloat(responseTime!);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
