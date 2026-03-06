/**
 * Workspace Routes - Barrel Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./crud.js', () => ({
  workspaceCrudRoutes: new Hono().get('/workspaces', (c: any) => c.json({ route: 'crud' })),
}));
vi.mock('./files.js', () => ({
  workspaceFileRoutes: new Hono().get('/workspaces/:id/files', (c: any) =>
    c.json({ route: 'files' })
  ),
}));
vi.mock('./execution.js', () => ({
  workspaceExecutionRoutes: new Hono().post('/workspaces/:id/exec', (c: any) =>
    c.json({ route: 'execution' })
  ),
}));
vi.mock('./container.js', () => ({
  workspaceContainerRoutes: new Hono().get('/system/status', (c: any) =>
    c.json({ route: 'container' })
  ),
}));

import { workspaceRoutes } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workspaceRoutes barrel', () => {
  it('exports a Hono app', () => {
    expect(workspaceRoutes).toBeDefined();
    expect(typeof workspaceRoutes.fetch).toBe('function');
  });

  it('routes GET /workspaces to crud router', async () => {
    const res = await workspaceRoutes.request('/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('crud');
  });

  it('routes GET /system/status to container router (before parameterized routes)', async () => {
    const res = await workspaceRoutes.request('/system/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('container');
  });

  it('routes GET /workspaces/:id/files to file router', async () => {
    const res = await workspaceRoutes.request('/workspaces/ws-1/files');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('files');
  });

  it('routes POST /workspaces/:id/exec to execution router', async () => {
    const res = await workspaceRoutes.request('/workspaces/ws-1/exec', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('execution');
  });
});
