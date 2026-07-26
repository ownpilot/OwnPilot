/**
 * Tests for claw workflow executor — creates and starts claw sessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateClaw = vi.fn();
const mockStartClaw = vi.fn();
const mockGetSession = vi.fn();
const mockStopClaw = vi.fn();
const mockDeleteClaw = vi.fn();
const mockGetHistory = vi.fn();

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../claw/service.js', () => {
  const mockService = {
    createClaw: mockCreateClaw,
    startClaw: mockStartClaw,
    getSession: mockGetSession,
    stopClaw: mockStopClaw,
    deleteClaw: mockDeleteClaw,
    getHistory: mockGetHistory,
  };
  return {
    getClawService: () => mockService,
  };
});

vi.mock('../../../db/repositories/workflows/index.js', () => ({
  createWorkflowsRepository: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'node-0',
    type: 'claw' as const,
    data: {},
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeResult(
  status: 'success' | 'error' | 'skipped',
  output: Record<string, unknown> = {}
): NodeResult {
  return { status, output, nodeId: 'node-0', startedAt: new Date().toISOString() };
}

describe('executeClawNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClaw.mockResolvedValue({ id: 'claw-1' });
    mockStartClaw.mockResolvedValue({ state: 'running' });
    mockGetHistory.mockResolvedValue({ entries: [] });
    mockGetSession.mockReturnValue(null);
  });

  it('starts a claw with name and mission', async () => {
    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({
      type: 'claw',
      data: { name: 'Research Assistant', mission: 'Analyze the data', waitForCompletion: false },
    });

    const result = await executeClawNode(node, {}, {}, 'user-1');
    expect(result.status).toBe('success');
    expect(mockCreateClaw).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Research Assistant',
        mission: 'Analyze the data',
        userId: 'user-1',
      })
    );
    expect(mockStartClaw).toHaveBeenCalledWith('claw-1', 'user-1');
  });

  it('returns error when name is missing', async () => {
    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({ type: 'claw', data: { mission: 'Mission' } });

    const result = await executeClawNode(node, {}, {}, 'user-1');

    expect(result.status).toBe('error');
    expect(result.error).toContain('name');
  });

  it('returns error when mission is missing', async () => {
    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({ type: 'claw', data: { name: 'Name' } });

    const result = await executeClawNode(node, {}, {}, 'user-1');

    expect(result.status).toBe('error');
    expect(result.error).toContain('mission');
  });

  it('handles createClaw failure gracefully', async () => {
    mockCreateClaw.mockRejectedValue(new Error('Storage quota exceeded'));

    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({
      type: 'claw',
      data: { name: 'Test', mission: 'Test mission' },
    });

    const result = await executeClawNode(node, {}, {}, 'user-1');

    expect(result.status).toBe('error');
    expect(result.error).toContain('Storage quota exceeded');
  });

  it('resolves name from node output template', async () => {
    mockCreateClaw.mockResolvedValue({ id: 'claw-2' });

    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({
      type: 'claw',
      data: { name: '{{node-0.output.name}}', mission: 'Template test', waitForCompletion: false },
    });
    const outputs = { 'node-0': makeResult('success', { name: 'Inherited Task' }) };

    const result = await executeClawNode(node, outputs, {}, 'user-1');

    expect(result.status).toBe('success');
    expect(mockCreateClaw).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Inherited Task' })
    );
  });

  it('resolves mission from variable', async () => {
    mockCreateClaw.mockResolvedValue({ id: 'claw-3' });

    const { executeClawNode } = await import('./claw.js');
    const node = makeNode({
      type: 'claw',
      data: { name: 'Test', mission: '{{variables.missionText}}', waitForCompletion: false },
    });

    const result = await executeClawNode(node, {}, { missionText: 'Resolved mission' }, 'user-1');

    expect(result.status).toBe('success');
    expect(mockCreateClaw).toHaveBeenCalledWith(
      expect.objectContaining({ mission: 'Resolved mission' })
    );
  });
});
