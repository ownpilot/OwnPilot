/**
 * Custom Tools Routes - Barrel Tests
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockCrudRoutes, mockApprovalRoutes, mockAnalysisRoutes, mockGenerationRoutes } = vi.hoisted(
  () => {
    const { Hono } = require('hono');
    return {
      mockCrudRoutes: new Hono().get('/tools', (c: any) => c.json({ route: 'crud' })),
      mockApprovalRoutes: new Hono().get('/tools/:id/approve', (c: any) =>
        c.json({ route: 'approval' })
      ),
      mockAnalysisRoutes: new Hono().get('/tools/:id/analyze', (c: any) =>
        c.json({ route: 'analysis' })
      ),
      mockGenerationRoutes: new Hono().get('/tools/generate', (c: any) =>
        c.json({ route: 'generation' })
      ),
    };
  }
);

vi.mock('./crud.js', () => ({ crudRoutes: mockCrudRoutes }));
vi.mock('./approval.js', () => ({ approvalRoutes: mockApprovalRoutes }));
vi.mock('./analysis.js', () => ({ analysisRoutes: mockAnalysisRoutes }));
vi.mock('./generation.js', () => ({
  generationRoutes: mockGenerationRoutes,
  executeCustomToolTool: vi.fn(),
  executeActiveCustomTool: vi.fn(),
  getActiveCustomToolDefinitions: vi.fn(),
}));

import {
  customToolsRoutes,
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('customToolsRoutes barrel', () => {
  it('exports a Hono app', () => {
    expect(customToolsRoutes).toBeDefined();
    expect(typeof customToolsRoutes.fetch).toBe('function');
  });

  it('routes GET /tools to crud router', async () => {
    const res = await customToolsRoutes.request('/tools');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('crud');
  });

  it('routes GET /tools/generate to generation router', async () => {
    const res = await customToolsRoutes.request('/tools/generate');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe('generation');
  });
});

describe('customToolsRoutes re-exports', () => {
  it('re-exports executeCustomToolTool', () => {
    expect(executeCustomToolTool).toBeDefined();
  });

  it('re-exports executeActiveCustomTool', () => {
    expect(executeActiveCustomTool).toBeDefined();
  });

  it('re-exports getActiveCustomToolDefinitions', () => {
    expect(getActiveCustomToolDefinitions).toBeDefined();
  });
});
