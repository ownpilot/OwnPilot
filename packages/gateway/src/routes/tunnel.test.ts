/**
 * Tunnel Routes Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { tunnelRoutes } from './tunnel.js';

describe('TunnelRoutes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/api/v1/tunnel', tunnelRoutes);
  });

  describe('GET /api/v1/tunnel', () => {
    it('returns tunnel status wrapped in apiResponse envelope', async () => {
      const res = await app.request('/api/v1/tunnel');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('status');
      expect(['stopped', 'starting', 'running', 'error']).toContain(json.data.status);
    });
  });

  describe('GET /api/v1/tunnel/url', () => {
    it('returns 404 with TUNNEL_NOT_RUNNING when no url', async () => {
      const res = await app.request('/api/v1/tunnel/url');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('TUNNEL_NOT_RUNNING');
    });
  });

  describe('POST /api/v1/tunnel/stop', () => {
    it('returns stopped status', async () => {
      const res = await app.request('/api/v1/tunnel/stop', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('stopped');
    });
  });

  describe('POST /api/v1/tunnel/start', () => {
    it('rejects password shorter than 8 chars', async () => {
      const res = await app.request('/api/v1/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'short' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toMatch(/password/i);
    });

    it('rejects password containing ":"', async () => {
      const res = await app.request('/api/v1/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'has:colon' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('rejects password containing whitespace', async () => {
      const res = await app.request('/api/v1/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'has space!' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('rejects non-string password', async () => {
      const res = await app.request('/api/v1/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 12345678 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('PUT /api/v1/tunnel/config', () => {
    it('accepts valid configuration update', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 9000, password: 'StrongPass#1' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('configured');
    });

    it('treats empty password as "unset" (not a validation error)', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects port out of range', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 70000 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toMatch(/port/i);
    });

    it('rejects non-integer port', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 'eighty' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('rejects malformed hostname', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'bad host!' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toMatch(/hostname/i);
    });

    it('accepts valid hostname', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'tunnel.example.com' }),
      });
      expect(res.status).toBe(200);
    });

    it('ignores garbage body and returns configured', async () => {
      const res = await app.request('/api/v1/tunnel/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('configured');
    });
  });
});
