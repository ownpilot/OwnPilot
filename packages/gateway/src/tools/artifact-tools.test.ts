/**
 * Artifact Tools Tests
 *
 * Tests the executeArtifactTool function and ARTIFACT_TOOLS definitions.
 * Covers the data-bindings + type cast fixes, list filters, and error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockArtifactService = {
  createArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  refreshBindings: vi.fn(),
};

vi.mock('../services/artifact-service.js', () => ({
  getArtifactService: () => mockArtifactService,
}));

import { ARTIFACT_TOOLS, ARTIFACT_TOOL_NAMES, executeArtifactTool } from './artifact-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeArtifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'art-1',
  type: 'html' as const,
  title: 'My Chart',
  content: '<html/>',
  version: 1,
  pinned: false,
  tags: [],
  dataBindings: [],
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Artifact Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // ARTIFACT_TOOLS definitions
  // ========================================================================

  describe('ARTIFACT_TOOLS', () => {
    it('exports 3 tool definitions', () => {
      expect(ARTIFACT_TOOLS).toHaveLength(3);
    });

    it('exports matching ARTIFACT_TOOL_NAMES', () => {
      expect(ARTIFACT_TOOL_NAMES).toEqual(ARTIFACT_TOOLS.map((t) => t.name));
    });

    it('all tools have required fields', () => {
      for (const tool of ARTIFACT_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Artifacts');
      }
    });

    it('contains expected tool names', () => {
      expect(ARTIFACT_TOOL_NAMES).toContain('create_artifact');
      expect(ARTIFACT_TOOL_NAMES).toContain('update_artifact');
      expect(ARTIFACT_TOOL_NAMES).toContain('list_artifacts');
    });

    it('all tools are workflowUsable: false', () => {
      for (const tool of ARTIFACT_TOOLS) {
        expect(tool.workflowUsable).toBe(false);
      }
    });
  });

  // ========================================================================
  // create_artifact
  // ========================================================================

  describe('create_artifact', () => {
    it('creates artifact and returns id/type/title', async () => {
      mockArtifactService.createArtifact.mockResolvedValue(makeArtifact());
      mockArtifactService.refreshBindings.mockResolvedValue(null);

      const result = await executeArtifactTool(
        'create_artifact',
        { title: 'My Chart', type: 'html', content: '<html/>' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('art-1');
      expect(r.type).toBe('html');
      expect(r.title).toBe('My Chart');
      expect(r.version).toBe(1);
      expect(r.pinned).toBe(false);
    });

    it('passes type correctly to service (fixes "as undefined" bug)', async () => {
      mockArtifactService.createArtifact.mockResolvedValue(makeArtifact({ type: 'chart' }));

      await executeArtifactTool(
        'create_artifact',
        { title: 'Chart', type: 'chart', content: '<canvas/>' },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.createArtifact).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'chart' })
      );
    });

    it('passes data_bindings to service (fixes "as undefined" bug)', async () => {
      const bindings = [
        { id: 'b1', variableName: 'tasks', source: { type: 'query', entity: 'tasks' } },
      ];
      mockArtifactService.createArtifact.mockResolvedValue(
        makeArtifact({ dataBindings: bindings })
      );
      mockArtifactService.refreshBindings.mockResolvedValue(null);

      await executeArtifactTool(
        'create_artifact',
        { title: 'Dashboard', type: 'html', content: '<html/>', data_bindings: bindings },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.createArtifact).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ dataBindings: bindings })
      );
    });

    it('calls refreshBindings when artifact has data bindings', async () => {
      const bindings = [
        { id: 'b1', variableName: 'tasks', source: { type: 'query', entity: 'tasks' } },
      ];
      mockArtifactService.createArtifact.mockResolvedValue(
        makeArtifact({ dataBindings: bindings })
      );
      mockArtifactService.refreshBindings.mockResolvedValue(null);

      await executeArtifactTool(
        'create_artifact',
        { title: 'Dashboard', type: 'html', content: '<html/>', data_bindings: bindings },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.refreshBindings).toHaveBeenCalledWith('user-1', 'art-1');
    });

    it('skips refreshBindings when no data bindings', async () => {
      mockArtifactService.createArtifact.mockResolvedValue(makeArtifact());

      await executeArtifactTool(
        'create_artifact',
        { title: 'Plain', type: 'markdown', content: '# Hello' },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.refreshBindings).not.toHaveBeenCalled();
    });

    it('passes pin_to_dashboard and tags', async () => {
      mockArtifactService.createArtifact.mockResolvedValue(
        makeArtifact({ pinned: true, tags: ['report'], dashboardSize: 'large' })
      );

      await executeArtifactTool(
        'create_artifact',
        {
          title: 'Pinned',
          type: 'chart',
          content: '<canvas/>',
          pin_to_dashboard: true,
          dashboard_size: 'large',
          tags: ['report'],
        },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.createArtifact).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          pinToDashboard: true,
          dashboardSize: 'large',
          tags: ['report'],
        })
      );
    });

    it('includes "Pinned to dashboard." in message when pinned', async () => {
      mockArtifactService.createArtifact.mockResolvedValue(makeArtifact({ pinned: true }));

      const result = await executeArtifactTool(
        'create_artifact',
        { title: 'T', type: 'html', content: '<div/>', pin_to_dashboard: true },
        'user-1',
        'conv-1'
      );

      expect((result.result as Record<string, unknown>).message).toContain('Pinned to dashboard.');
    });

    it('returns error on service failure', async () => {
      mockArtifactService.createArtifact.mockRejectedValue(new Error('DB error'));

      const result = await executeArtifactTool(
        'create_artifact',
        { title: 'T', type: 'html', content: '<div/>' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  // ========================================================================
  // update_artifact
  // ========================================================================

  describe('update_artifact', () => {
    it('updates artifact and returns version bump message', async () => {
      mockArtifactService.updateArtifact.mockResolvedValue(
        makeArtifact({ id: 'art-1', title: 'Updated Title', version: 2 })
      );

      const result = await executeArtifactTool(
        'update_artifact',
        { artifact_id: 'art-1', title: 'Updated Title' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.version).toBe(2);
      expect(r.message).toContain('v2');
    });

    it('passes data_bindings to service on update (fixes "as undefined" bug)', async () => {
      const bindings = [
        { id: 'b2', variableName: 'goals', source: { type: 'goal', goalId: 'g1' } },
      ];
      mockArtifactService.updateArtifact.mockResolvedValue(
        makeArtifact({ dataBindings: bindings })
      );

      await executeArtifactTool(
        'update_artifact',
        { artifact_id: 'art-1', data_bindings: bindings },
        'user-1',
        'conv-1'
      );

      expect(mockArtifactService.updateArtifact).toHaveBeenCalledWith(
        'user-1',
        'art-1',
        expect.objectContaining({ dataBindings: bindings })
      );
    });

    it('returns error when artifact not found', async () => {
      mockArtifactService.updateArtifact.mockResolvedValue(null);

      const result = await executeArtifactTool(
        'update_artifact',
        { artifact_id: 'nonexistent' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
    });

    it('returns error on service throw', async () => {
      mockArtifactService.updateArtifact.mockRejectedValue(new Error('Constraint violation'));

      const result = await executeArtifactTool(
        'update_artifact',
        { artifact_id: 'art-1', content: 'new' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Constraint violation');
    });
  });

  // ========================================================================
  // list_artifacts
  // ========================================================================

  describe('list_artifacts', () => {
    it('lists artifacts with total count', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({
        total: 2,
        artifacts: [
          makeArtifact({ id: 'a1', title: 'Chart 1', type: 'chart' }),
          makeArtifact({ id: 'a2', title: 'Form 1', type: 'form' }),
        ],
      });

      const result = await executeArtifactTool('list_artifacts', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.total).toBe(2);
      expect((r.artifacts as unknown[]).length).toBe(2);
    });

    it('passes type filter to service (fixes "as undefined" bug)', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({ total: 0, artifacts: [] });

      await executeArtifactTool('list_artifacts', { type: 'chart' }, 'user-1', 'conv-1');

      expect(mockArtifactService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'chart' })
      );
    });

    it('passes pinned filter to service', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({ total: 0, artifacts: [] });

      await executeArtifactTool('list_artifacts', { pinned: true }, 'user-1', 'conv-1');

      expect(mockArtifactService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ pinned: true })
      );
    });

    it('passes search filter to service', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({ total: 0, artifacts: [] });

      await executeArtifactTool('list_artifacts', { search: 'weekly' }, 'user-1', 'conv-1');

      expect(mockArtifactService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ search: 'weekly' })
      );
    });

    it('uses default limit 20 when not specified', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({ total: 0, artifacts: [] });

      await executeArtifactTool('list_artifacts', {}, 'user-1', 'conv-1');

      expect(mockArtifactService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ limit: 20 })
      );
    });

    it('formats artifact dates as ISO strings', async () => {
      mockArtifactService.listArtifacts.mockResolvedValue({
        total: 1,
        artifacts: [
          makeArtifact({ createdAt: new Date('2025-03-01'), updatedAt: new Date('2025-03-02') }),
        ],
      });

      const result = await executeArtifactTool('list_artifacts', {}, 'user-1', 'conv-1');

      const artifacts = (result.result as Record<string, unknown>).artifacts as Record<
        string,
        unknown
      >[];
      expect(artifacts[0].createdAt).toBe('2025-03-01T00:00:00.000Z');
      expect(artifacts[0].updatedAt).toBe('2025-03-02T00:00:00.000Z');
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeArtifactTool('nonexistent_tool', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown artifact tool');
    });
  });
});
