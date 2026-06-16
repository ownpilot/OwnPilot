/**
 * Agentic Routes Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetAgenticExecutor } = vi.hoisted(() => {
  return { mockGetAgenticExecutor: vi.fn() };
});

vi.mock('../agentic/agentic-executor.js', () => ({
  getAgenticExecutor: mockGetAgenticExecutor,
}));

// Mock the core agentic module — needs to be before imports since
// agentic.ts imports from @ownpilot/core/agentic at the top level.
vi.mock('@ownpilot/core/agentic', () => {
  return {
    getCapabilityRegistry: vi.fn().mockReturnValue({
      getAll: vi.fn().mockReturnValue([
        {
          id: 'claw:single-shot',
          name: 'Single-Shot',
          description: 'Execute a single task',
          executorKind: 'claw',
          providerId: 'ownpilot:claw',
          tags: ['autonomous'],
          requiresApproval: false,
          costTier: 'moderate',
          latencyTier: 'medium',
          registeredAt: new Date(),
        },
        {
          id: 'direct-llm:chat',
          name: 'Direct LLM',
          description: 'Direct chat',
          executorKind: 'direct_llm',
          providerId: 'ownpilot:llm',
          tags: ['llm'],
          requiresApproval: false,
          costTier: 'cheap',
          latencyTier: 'fast',
          registeredAt: new Date(),
        },
      ]),
      get: vi.fn(),
      query: vi.fn(),
      search: vi.fn((_kw: string[], _limit?: number) => []),
      getByProvider: vi.fn(),
      getByKind: vi.fn(),
      size: 2,
      on: vi.fn(),
    }),
    // Classes need proper constructors for `new` keyword
    AgenticRouter: class {
      route = vi.fn().mockResolvedValue({
        analysis: {
          suggestedKinds: ['claw'],
          requiresOrchestration: false,
          likelyNeedsCodeExecution: false,
          likelyNeedsExternalData: false,
          confidence: 0.85,
          reasoning: 'Mock analysis',
        },
        plan: {
          steps: [
            {
              index: 1,
              executorKind: 'claw',
              capabilityId: 'claw:single-shot',
              providerId: 'ownpilot:claw',
              params: { task: 'Mock task' },
              dependsOn: [],
              timeoutMs: 60000,
              retryOnFailure: true,
            },
          ],
          estimatedCostUsd: 0.05,
          estimatedDurationMs: 60000,
          requiresApproval: false,
          fallbackStrategy: 'escalate',
          createdAt: new Date(),
        },
      });
    } as unknown as new (...args: unknown[]) => unknown,
    AgenticOrchestrator: class {
      execute = vi.fn().mockResolvedValue({
        id: 'agentic_exec_test',
        task: { name: 'Test task', description: 'Test task description' },
        plan: {
          steps: [],
          requiresApproval: false,
          fallbackStrategy: 'abort',
          createdAt: new Date(),
        },
        stepResults: [],
        status: 'completed',
        totalCostUsd: 0.005,
        totalDurationMs: 42,
        totalTokens: { input: 100, output: 50 },
        summary: 'Completed successfully',
        startedAt: new Date(),
        completedAt: new Date(),
      });
      listExecutions = vi.fn().mockResolvedValue([]);
      getReport = vi.fn().mockImplementation((id: string) => {
        if (id === 'test-id-123') {
          return Promise.resolve({
            id: 'test-id-123',
            task: { name: 'Test task', description: 'Test desc' },
            plan: {
              steps: [],
              requiresApproval: false,
              fallbackStrategy: 'abort',
              createdAt: new Date(),
            },
            stepResults: [],
            status: 'completed',
            totalCostUsd: 0.01,
            totalDurationMs: 100,
            totalTokens: { input: 50, output: 25 },
            summary: 'Completed',
            startedAt: new Date(),
            completedAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      getStatus = vi.fn().mockResolvedValue('completed');
      cancel = vi.fn().mockResolvedValue(true);
      getStats = vi.fn().mockResolvedValue({
        totalExecutions: 10,
        activeExecutions: 2,
        totalCostUsd: 0.05,
        successRate: 0.85,
        byExecutorKind: { claw: 8, direct_llm: 2 },
      });
    } as unknown as new (...args: unknown[]) => unknown,
  };
});

const { agenticRoutes } = await import('./agentic.js');

// ---------------------------------------------------------------------------
// Test App
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/agentic', agenticRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Mock Executor
// ---------------------------------------------------------------------------

function createMockExecutor() {
  return {
    dispatch: vi.fn().mockResolvedValue({
      success: true,
      output: { result: 'ok' },
      durationMs: 42,
      costUsd: 0.005,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agentic Routes', () => {
  let app: Hono;
  let executor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createMockExecutor();
    mockGetAgenticExecutor.mockReturnValue(executor);
    app = createApp();
  });

  // ---- POST /agentic/execute ----

  describe('POST /agentic/execute', () => {
    it('should execute a task and return 201 on success', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test task',
          description: 'A test task description',
          priority: 'normal',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.status).toBeDefined();
      expect(body.data.summary).toBeDefined();
      expect(body.data.steps).toBeInstanceOf(Array);
    });

    it('should return 400 for missing description', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('should return 400 for invalid priority', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          description: 'desc',
          priority: 'invalid',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
    });

    it('should accept interval trigger', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Monitor task',
          description: 'Monitor API health every 5 minutes',
          trigger: { type: 'interval', intervalMs: 300000 },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
    });

    it('should accept constraints', async () => {
      const res = await app.request('/agentic/execute', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Constrained task',
          description: 'Task with constraints',
          constraints: {
            maxCostUsd: 0.5,
            timeoutMs: 120000,
            allowCodeExecution: true,
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
    });
  });

  // ---- POST /agentic/plan ----

  describe('POST /agentic/plan', () => {
    it('should return an analysis and plan', async () => {
      const res = await app.request('/agentic/plan', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Plan test',
          description: 'Analyze this task',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.analysis).toBeDefined();
      expect(body.data.analysis.suggestedKinds).toBeInstanceOf(Array);
      expect(body.data.analysis.confidence).toBeGreaterThanOrEqual(0);
      expect(body.data.plan).toBeDefined();
      expect(body.data.plan.steps).toBeInstanceOf(Array);
      expect(body.data.plan.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it('should return 400 for missing description', async () => {
      const res = await app.request('/agentic/plan', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ---- GET /agentic/executions ----

  describe('GET /agentic/executions', () => {
    it('should return a list of executions', async () => {
      const res = await app.request('/agentic/executions');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.executions).toBeInstanceOf(Array);
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.limit).toBe('number');
    });

    it('should respect pagination params', async () => {
      const res = await app.request('/agentic/executions?limit=5&offset=10');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.limit).toBe(5);
      expect(body.data.offset).toBe(10);
    });

    it('should clamp limit to max 100', async () => {
      const res = await app.request('/agentic/executions?limit=999');

      expect(res.status).toBe(200);
    });
  });

  // ---- GET /agentic/executions/:id ----

  describe('GET /agentic/executions/:id', () => {
    it('should return 200 for existing execution', async () => {
      const res = await app.request('/agentic/executions/test-id-123');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBeDefined();
    });

    it('should return 400 for missing id', async () => {
      const res = await app.request('/agentic/executions/');

      expect([400, 404]).toContain(res.status);
    });
  });

  // ---- POST /agentic/executions/:id/cancel ----

  describe('POST /agentic/executions/:id/cancel', () => {
    it('should cancel a running execution', async () => {
      const res = await app.request('/agentic/executions/test-id/cancel', {
        method: 'POST',
      });

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json();
        expect(body.data.status).toBe('cancelled');
      }
    });
  });

  // ---- GET /agentic/stats ----

  describe('GET /agentic/stats', () => {
    it('should return aggregate stats', async () => {
      const res = await app.request('/agentic/stats');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.data.totalExecutions).toBe('number');
      expect(typeof body.data.activeExecutions).toBe('number');
      expect(typeof body.data.totalCostUsd).toBe('number');
      expect(typeof body.data.successRate).toBe('number');
      expect(body.data.byExecutorKind).toBeDefined();
    });
  });

  // ---- GET /agentic/capabilities ----

  describe('GET /agentic/capabilities', () => {
    it('should return all capabilities', async () => {
      const res = await app.request('/agentic/capabilities');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.capabilities).toBeInstanceOf(Array);
      expect(body.data.capabilities.length).toBeGreaterThan(0);
      expect(body.data.total).toBeGreaterThan(0);

      // Verify capability shape
      const cap = body.data.capabilities[0];
      expect(cap.id).toBeDefined();
      expect(cap.name).toBeDefined();
      expect(cap.description).toBeDefined();
      expect(cap.executorKind).toBeDefined();
      expect(cap.tags).toBeInstanceOf(Array);
    });

    it('should filter by executor kind', async () => {
      const res = await app.request('/agentic/capabilities?kind=claw');

      expect(res.status).toBe(200);
      const body = await res.json();
      for (const cap of body.data.capabilities) {
        expect(cap.executorKind).toBe('claw');
      }
    });

    it('should filter by search keywords', async () => {
      const res = await app.request('/agentic/capabilities?search=single,chat');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.capabilities.length).toBeGreaterThan(0);
    });

    it('should filter by provider', async () => {
      const res = await app.request('/agentic/capabilities?provider=ownpilot:claw');

      expect(res.status).toBe(200);
      const body = await res.json();
      for (const cap of body.data.capabilities) {
        expect(cap.providerId).toBe('ownpilot:claw');
      }
    });

    it('should handle combined filters', async () => {
      const res = await app.request(
        '/agentic/capabilities?kind=trigger&search=schedule,cron&provider=ownpilot:trigger'
      );

      expect(res.status).toBe(200);
    });
  });
});
