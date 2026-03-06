/**
 * Request ID Middleware Tests
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestId } from './request-id.js';

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.get('/test', (c) => c.json({ requestId: c.get('requestId') }));
  return app;
}

describe('requestId middleware', () => {
  it('generates a UUID when no X-Request-ID header provided', async () => {
    const app = createApp();
    const res = await app.request('/test');
    const json = await res.json();
    // UUID v4 format
    expect(json.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('uses X-Request-ID header when valid', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'my-custom-id-123' },
    });
    const json = await res.json();
    expect(json.requestId).toBe('my-custom-id-123');
  });

  it('echoes the request ID back in response header', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'test-id-456' },
    });
    expect(res.headers.get('X-Request-ID')).toBe('test-id-456');
  });

  it('sets X-Request-ID response header even without incoming header', async () => {
    const app = createApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('rejects X-Request-ID with invalid characters (spaces)', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'invalid id with spaces' },
    });
    const json = await res.json();
    // Falls back to UUID
    expect(json.requestId).not.toBe('invalid id with spaces');
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('rejects X-Request-ID that is too long (>128 chars)', async () => {
    const app = createApp();
    const longId = 'a'.repeat(129);
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': longId },
    });
    const json = await res.json();
    expect(json.requestId).not.toBe(longId);
  });

  it('accepts X-Request-ID with allowed special chars (-, _, ., :, =)', async () => {
    const app = createApp();
    const id = 'req-id_v1.0:session=abc';
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': id },
    });
    const json = await res.json();
    expect(json.requestId).toBe(id);
  });

  it('accepts X-Request-ID exactly 128 chars long', async () => {
    const app = createApp();
    const id = 'a'.repeat(128);
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': id },
    });
    const json = await res.json();
    expect(json.requestId).toBe(id);
  });

  it('sets requestId context variable accessible in handlers', async () => {
    const app = createApp();
    const customId = 'ctx-test-id';
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': customId },
    });
    const json = await res.json();
    expect(json.requestId).toBe(customId);
  });
});
