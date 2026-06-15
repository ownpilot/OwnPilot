/**
 * Agentic CLI Commands Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function apiOk<T>(data: T) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
function apiErr(status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } }),
  };
}

import {
  agenticRun,
  agenticList,
  agenticStatus,
  agenticCancel,
  agenticRerun,
  agenticPlan,
  agenticCapabilities,
  agenticStats,
} from './agentic.js';

describe('Agentic CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  // ─── agenticRun ────────────────────────────────────────────────────

  describe('agenticRun', () => {
    it('shows usage when no description provided', async () => {
      await agenticRun([], {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: ownpilot agentic run')
      );
    });

    it('sends POST /agentic/execute with description', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-1',
          status: 'completed',
          summary: 'Completed 1/1 steps successfully',
          totalCostUsd: 0.005,
          totalDurationMs: 150,
          steps: [
            { index: 1, executorKind: 'claw', capabilityId: 'c1', status: 'completed', durationMs: 150 },
          ],
        })
      );

      await agenticRun(['Research', 'AI'], {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0] as string;
      const callOpts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(callUrl).toContain('/api/v1/agentic/execute');
      expect(callOpts.method).toBe('POST');

      const body = JSON.parse(callOpts.body as string);
      expect(body.name).toBeDefined();
      expect(body.description).toContain('Research AI');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    });

    it('passes priority option', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-2', status: 'completed', summary: 'Done', totalCostUsd: 0.01, totalDurationMs: 100,
          steps: [],
        })
      );

      await agenticRun(['Critical task'], { priority: 'high' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.priority).toBe('high');
    });

    it('passes interval trigger', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-3', status: 'completed', summary: 'Done', totalCostUsd: 0.01, totalDurationMs: 100,
          steps: [],
        })
      );

      await agenticRun(['Monitor API'], { trigger: 'interval', interval: '60000' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.trigger.type).toBe('interval');
      expect(body.trigger.intervalMs).toBe(60000);
    });

    it('passes continuous trigger', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-4', status: 'completed', summary: 'Done', totalCostUsd: 0.01, totalDurationMs: 100,
          steps: [],
        })
      );

      await agenticRun(['Watch service'], { trigger: 'continuous' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.trigger.type).toBe('continuous');
    });

    it('handles custom task name', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-5', status: 'completed', summary: 'Done', totalCostUsd: 0, totalDurationMs: 0,
          steps: [],
        })
      );

      await agenticRun(['Do something'], { name: 'My Custom Task' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe('My Custom Task');
    });

    it('passes timeout constraint', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-6', status: 'completed', summary: 'Done', totalCostUsd: 0, totalDurationMs: 0,
          steps: [],
        })
      );

      await agenticRun(['Long task'], { timeout: '300000' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      // Commander passes options as strings; parseInt converts in the handler
      expect(body.constraints.timeoutMs).toBe(300000);
    });

    it('handles gateway error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Should not throw — ensureGatewayError calls process.exit
      await agenticRun(['Fail task'], {});
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('shows failed execution with error', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-7', status: 'failed', summary: 'Failed after 0/1 steps',
          totalCostUsd: 0, totalDurationMs: 50,
          error: 'Step 1 failed: timeout',
          steps: [
            { index: 1, executorKind: 'claw', status: 'failed', error: 'timeout', durationMs: 50 },
          ],
        })
      );

      await agenticRun(['Failing task'], {});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    });
  });

  // ─── agenticList ───────────────────────────────────────────────────

  describe('agenticList', () => {
    it('shows "no executions" when list is empty', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ executions: [], total: 0, limit: 20, offset: 0 })
      );

      await agenticList({});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No executions yet'));
    });

    it('renders execution rows', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          executions: [
            { id: 'e1', taskName: 'Research AI', status: 'completed', summary: 'Done',
              totalCostUsd: 0.005, totalDurationMs: 150, stepCount: 1, completedSteps: 1,
              startedAt: '2026-06-15T10:00:00Z', completedAt: '2026-06-15T10:01:00Z' },
            { id: 'e2', taskName: 'Fix bug', status: 'running', summary: 'In progress',
              totalCostUsd: 0.01, totalDurationMs: 3000, stepCount: 2, completedSteps: 1,
              startedAt: '2026-06-15T10:05:00Z', completedAt: null },
          ],
          total: 2, limit: 20, offset: 0,
        })
      );

      await agenticList({});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Research AI'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fix bug'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
    });

    it('passes limit and offset params', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ executions: [], total: 0, limit: 5, offset: 10 })
      );

      await agenticList({ limit: 5, offset: 10 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=5');
      expect(url).toContain('offset=10');
    });

    it('handles gateway error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await agenticList({});
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ─── agenticStatus ─────────────────────────────────────────────────

  describe('agenticStatus', () => {
    it('shows usage when no id provided', async () => {
      await agenticStatus('', {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: ownpilot agentic status')
      );
    });

    it('fetches and displays execution detail', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-1',
          task: { name: 'Test Task', description: 'Test description' },
          status: 'completed',
          summary: 'Completed successfully',
          totalCostUsd: 0.005,
          totalDurationMs: 150,
          startedAt: '2026-06-15T10:00:00Z',
          completedAt: '2026-06-15T10:01:00Z',
          steps: [
            { index: 1, executorKind: 'claw', capabilityId: 'claw:single-shot', status: 'completed', durationMs: 150 },
          ],
        })
      );

      await agenticStatus('exec-1', {});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Task'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
    });

    it('outputs JSON when --json flag set', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-1', task: { name: 'JSON task' }, status: 'completed',
          summary: 'Done', totalCostUsd: 0, totalDurationMs: 0,
          startedAt: '2026-06-15T10:00:00Z', completedAt: null, steps: [],
        })
      );

      // Spy on the actual JSON.stringify output
      logSpy.mockReset();

      await agenticStatus('exec-1', { json: true });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('"status": "completed"')
      );
    });

    it('handles gateway error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await agenticStatus('exec-1', {});
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ─── agenticCancel ─────────────────────────────────────────────────

  describe('agenticCancel', () => {
    it('shows usage when no id provided', async () => {
      await agenticCancel('');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: ownpilot agentic cancel')
      );
    });

    it('sends cancel request', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ id: 'exec-1', status: 'cancelled' })
      );

      await agenticCancel('exec-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      const opts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(url).toContain('/agentic/executions/exec-1/cancel');
      expect(opts.method).toBe('POST');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled'));
    });

    it('handles gateway error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await agenticCancel('exec-1');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ─── agenticPlan ───────────────────────────────────────────────────

  describe('agenticPlan', () => {
    it('shows usage when no description provided', async () => {
      await agenticPlan([], {});
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: ownpilot agentic plan')
      );
    });

    it('sends plan request and displays analysis', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          analysis: {
            suggestedKinds: ['claw', 'direct_llm'],
            requiresOrchestration: false,
            likelyNeedsCodeExecution: false,
            likelyNeedsExternalData: true,
            confidence: 0.85,
            reasoning: 'Research tasks need full claw runtime',
          },
          plan: {
            steps: [
              { index: 1, executorKind: 'claw', capabilityId: 'claw:single-shot', providerId: 'ownpilot:claw', dependsOn: [], timeoutMs: 60000, retryOnFailure: true },
            ],
            estimatedCostUsd: 0.05,
            estimatedDurationMs: 60000,
            requiresApproval: false,
            fallbackStrategy: 'escalate',
          },
        })
      );

      await agenticPlan(['Research', 'topic'], {});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Plan'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('claw'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('85%'));
    });
  });

  // ─── agenticCapabilities ───────────────────────────────────────────

  describe('agenticCapabilities', () => {
    it('lists capabilities grouped by kind', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          capabilities: [
            { id: 'claw:test', name: 'Test Claw', description: 'A test claw', executorKind: 'claw', providerId: 'ownpilot:claw', tags: ['test'], requiresApproval: false },
            { id: 'llm:test', name: 'Test LLM', description: 'A test llm', executorKind: 'direct_llm', providerId: 'ownpilot:llm', tags: ['llm'], requiresApproval: false },
          ],
          total: 2,
        })
      );

      await agenticCapabilities({});
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('claw'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('direct_llm'));
    });

    it('filters by kind', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ capabilities: [], total: 0 })
      );

      await agenticCapabilities({ kind: 'trigger' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('kind=trigger');
    });

    it('filters by provider', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ capabilities: [], total: 0 })
      );

      await agenticCapabilities({ provider: 'ownpilot:claw' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(decodeURIComponent(url)).toContain('provider=ownpilot:claw');
    });
  });

  // ─── agenticStats ──────────────────────────────────────────────────

  describe('agenticStats', () => {
    it('displays aggregated stats', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          totalExecutions: 42,
          activeExecutions: 3,
          totalCostUsd: 0.15,
          successRate: 0.857,
          byExecutorKind: { claw: 30, direct_llm: 12 },
        })
      );

      await agenticStats();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('85.7'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('claw'));
    });
  });

  // ─── agenticRerun ───

  describe('agenticRerun', () => {
    it('shows usage when no id provided', async () => {
      await agenticRerun('', {});
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('fetches execution and re-runs it', async () => {
      // First call: GET execution detail
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-1', task: { name: 'Research AI', description: 'Research topic', priority: 'normal' },
          status: 'failed', provider: 'openai', model: 'gpt-4o',
          totalCostUsd: 0.01, totalDurationMs: 100, startedAt: '', completedAt: null, steps: [],
        })
      );
      // Second call: POST execute
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'exec-2', status: 'completed', summary: 'Completed successfully',
          totalCostUsd: 0.02, totalDurationMs: 200, steps: [],
        })
      );

      await agenticRerun('exec-1', {});
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Re-running'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('exec-2'));
    });

    it('passes override options', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ id: 'exec-1', task: { name: 'Test', description: 'Desc' }, status: 'failed', steps: [] })
      );
      mockFetch.mockResolvedValueOnce(
        apiOk({ id: 'exec-3', status: 'completed', summary: 'Done', totalCostUsd: 0, totalDurationMs: 0, steps: [] })
      );

      await agenticRerun('exec-1', { provider: 'anthropic', model: 'claude-3', priority: 'high' });
      const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      expect(body.provider).toBe('anthropic');
      expect(body.model).toBe('claude-3');
      expect(body.priority).toBe('high');
    });
  });

  // ─── agenticList --json ───

  describe('agenticList --json', () => {
    it('outputs JSON instead of formatted table', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ executions: [], total: 0, limit: 20, offset: 0 })
      );

      await agenticList({ json: true });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"executions"'));
    });
  });

  // ─── agenticStats --json ───

  describe('agenticStats --json', () => {
    it('outputs JSON when --json flag set', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          totalExecutions: 10, activeExecutions: 2, totalCostUsd: 0.05,
          successRate: 0.8, byExecutorKind: { claw: 8 },
        })
      );

      await agenticStats({ json: true });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"totalExecutions"'));
    });
  });

  // ─── agenticWatch export ───

  describe('agenticWatch', () => {
    it('is exported as a function', async () => {
      const mod = await import('./agentic.js');
      expect(typeof mod.agenticWatch).toBe('function');
    });
  });
});
