import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolGetOrchestrationHistory, type BridgeConfig } from '../../mcp/tools.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

const projectDir = '/home/ayaz/myproject';

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── toolGetOrchestrationHistory ──────────────────────────────────────────────

describe('toolGetOrchestrationHistory', () => {
  it('returns all orchestrations when no status filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          orchestrationId: 'orch-1',
          projectDir,
          message: '/gsd:execute-phase 10',
          status: 'running',
          currentStage: 'plan_generation',
          startedAt: '2026-03-01T10:00:00.000Z',
          stageProgress: { research: {}, devil_advocate: {} },
        },
        {
          orchestrationId: 'orch-2',
          projectDir,
          message: '/gsd:execute-phase 11',
          status: 'completed',
          currentStage: null,
          startedAt: '2026-03-01T09:00:00.000Z',
          completedAt: '2026-03-01T09:30:00.000Z',
          stageProgress: { research: {}, devil_advocate: {}, plan_generation: {}, execute: {}, verify: {} },
        },
      ],
    });

    const result = await toolGetOrchestrationHistory(projectDir, undefined, testConfig);

    expect(result).toHaveLength(2);
    expect(result[0].orchestrationId).toBe('orch-1');
    expect(result[0].status).toBe('running');
    expect(result[0].stageCount).toBe(2);
    expect(result[1].orchestrationId).toBe('orch-2');
    expect(result[1].status).toBe('completed');
    expect(result[1].stageCount).toBe(5);
    expect(result[1].completedAt).toBe('2026-03-01T09:30:00.000Z');
  });

  it('filters by status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          orchestrationId: 'orch-1',
          projectDir,
          message: '/gsd:execute-phase 10',
          status: 'running',
          currentStage: 'plan_generation',
          startedAt: '2026-03-01T10:00:00.000Z',
          stageProgress: {},
        },
        {
          orchestrationId: 'orch-2',
          projectDir,
          message: '/gsd:execute-phase 9',
          status: 'completed',
          currentStage: null,
          startedAt: '2026-03-01T08:00:00.000Z',
          completedAt: '2026-03-01T08:45:00.000Z',
          stageProgress: { research: {} },
        },
      ],
    });

    const result = await toolGetOrchestrationHistory(projectDir, 'completed', testConfig);

    expect(result).toHaveLength(1);
    expect(result[0].orchestrationId).toBe('orch-2');
    expect(result[0].status).toBe('completed');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(toolGetOrchestrationHistory(projectDir, undefined, testConfig)).rejects.toThrow(
      'Bridge get_orchestration_history error (HTTP 500)',
    );
  });

  it('handles empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await toolGetOrchestrationHistory(projectDir, undefined, testConfig);
    expect(result).toEqual([]);
  });

  it('stageCount — counts completed stages correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          orchestrationId: 'orch-3',
          projectDir,
          message: '/gsd:execute-phase 12',
          status: 'running',
          currentStage: 'plan_generation',
          startedAt: '2026-03-01T11:00:00.000Z',
          stageProgress: { research: { foo: 1 }, devil_advocate: { bar: 2 }, plan_generation: { baz: 3 } },
        },
      ],
    });

    const result = await toolGetOrchestrationHistory(projectDir, undefined, testConfig);

    expect(result).toHaveLength(1);
    expect(result[0].stageCount).toBe(3);
  });
});
