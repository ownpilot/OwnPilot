/**
 * Database Routes — Admin Guard Middleware Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./operations.js', () => ({
  operationRoutes: new Hono().get('/status', (c) => c.json({ ok: true })),
}));

vi.mock('./backup.js', () => ({
  backupRoutes: new Hono().get('/backup', (c) => c.json({ backups: [] })),
}));

vi.mock('./transfer.js', () => ({
  transferRoutes: new Hono().get('/export', (c) => c.json({ exported: true })),
}));

vi.mock('./schema.js', () => ({
  schemaRoutes: new Hono(),
}));

import { databaseRoutes } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const savedAdminKey = process.env.ADMIN_KEY;

describe('databaseRoutes admin guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_KEY;
  });

  afterEach(() => {
    if (savedAdminKey !== undefined) process.env.ADMIN_KEY = savedAdminKey;
    else delete process.env.ADMIN_KEY;
  });

  // --- GET requests (read-only) pass without admin key ---

  it('allows GET /status without admin key when ADMIN_KEY not set', async () => {
    const res = await databaseRoutes.request('/status');
    expect(res.status).not.toBe(403);
  });

  it('allows GET /backup without admin key', async () => {
    const res = await databaseRoutes.request('/backup');
    expect(res.status).not.toBe(403);
  });

  // --- GET /export requires admin key (contains /export) ---

  it('blocks GET /export when ADMIN_KEY is not set', async () => {
    const res = await databaseRoutes.request('/export');
    expect(res.status).toBe(403);
  });

  it('blocks GET /export without X-Admin-Key header even when ADMIN_KEY is set', async () => {
    process.env.ADMIN_KEY = 'secret-admin';
    const res = await databaseRoutes.request('/export');
    expect(res.status).toBe(403);
  });

  it('allows GET /export with correct X-Admin-Key header', async () => {
    process.env.ADMIN_KEY = 'secret-admin';
    const res = await databaseRoutes.request('/export', {
      headers: { 'X-Admin-Key': 'secret-admin' },
    });
    expect(res.status).not.toBe(403);
  });

  it('blocks GET /export with wrong X-Admin-Key', async () => {
    process.env.ADMIN_KEY = 'secret-admin';
    const res = await databaseRoutes.request('/export', {
      headers: { 'X-Admin-Key': 'wrong-key' },
    });
    expect(res.status).toBe(403);
  });

  // --- POST requests require admin key ---

  it('blocks POST request when ADMIN_KEY not set', async () => {
    const res = await databaseRoutes.request('/backup', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('blocks POST request when X-Admin-Key is missing', async () => {
    process.env.ADMIN_KEY = 'secret';
    const res = await databaseRoutes.request('/backup', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('blocks POST request with wrong X-Admin-Key', async () => {
    process.env.ADMIN_KEY = 'secret';
    const res = await databaseRoutes.request('/backup', {
      method: 'POST',
      headers: { 'X-Admin-Key': 'bad-key' },
    });
    expect(res.status).toBe(403);
  });

  it('allows POST request with correct X-Admin-Key', async () => {
    process.env.ADMIN_KEY = 'correct-key';
    const res = await databaseRoutes.request('/backup', {
      method: 'POST',
      headers: { 'X-Admin-Key': 'correct-key' },
    });
    // Not 403 (may be 404 since no POST /backup route in mocks)
    expect(res.status).not.toBe(403);
  });

  // --- DELETE requests require admin key ---

  it('blocks DELETE request when ADMIN_KEY not set', async () => {
    const res = await databaseRoutes.request('/backup/file.sql', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('allows DELETE request with correct X-Admin-Key', async () => {
    process.env.ADMIN_KEY = 'admin-pass';
    const res = await databaseRoutes.request('/backup/file.sql', {
      method: 'DELETE',
      headers: { 'X-Admin-Key': 'admin-pass' },
    });
    expect(res.status).not.toBe(403);
  });

  // --- Error response format ---

  it('returns JSON error with UNAUTHORIZED code when admin key not configured', async () => {
    const res = await databaseRoutes.request('/export');
    const body = await res.json();
    expect(body).toMatchObject({
      error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
    });
  });

  it('returns JSON error with UNAUTHORIZED code when wrong key provided', async () => {
    process.env.ADMIN_KEY = 'real-key';
    const res = await databaseRoutes.request('/export', {
      headers: { 'X-Admin-Key': 'wrong-key' },
    });
    const body = await res.json();
    expect(body).toMatchObject({
      error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
    });
  });
});
