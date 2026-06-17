/**
 * Integration tests for AgenticGatewayExecutor.
 *
 * Verifies that dispatch() routes each executor kind to the correct gateway service
 * with the right parameters and returns a properly shaped DispatchResult.
 *
 * Coverage: dispatchClaw (persistent + single-shot), dispatchCodingAgent, dispatchWorkflow,
 * dispatchTrigger (scheduled + event + condition + continuous), dispatchTool, dispatchSandbox.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionStep } from '@ownpilot/core/agentic';
import type {
  ClawService,
  WorkflowService,
  CodingAgentService,
  TriggerService,
  RuntimeContext,
} from '@ownpilot/core/services';

// =============================================================================
// Mocks — vi.hoisted() ensures variables are evaluated in hoisting order
// =============================================================================

const {
  mockClawService,
  mockWorkflowExecute,
  mockWorkflowService,
  mockCodingAgentService,
  mockTriggerService,
  mockRuntimeContext,
  mockExecuteTool,
  mockGetOrCreateChatAgent,
  mockGetEventSystem,
  mockHasProviderService,
  mockGetProviderService,
  mockTriggerEngine,
  mockRunInSandbox,
} = vi.hoisted(() => {
  const mockExecuteNow = vi.fn();
  const mockCreateClaw = vi.fn();
  const mockStartClaw = vi.fn();
  const mockClawSvc = {
    executeNow: mockExecuteNow,
    createClaw: mockCreateClaw,
    startClaw: mockStartClaw,
  } as unknown as ClawService;

  const mockWorkflowExec = vi.fn(() =>
    Promise.resolve({ id: 'wl-1', status: 'completed' as const, nodeResults: [], durationMs: 100 })
  );
  const mockWorkflowSvc = { executeWorkflow: mockWorkflowExec } as unknown as WorkflowService;

  const mockRunTask = vi.fn();
  const mockCodingSvc = { runTask: mockRunTask } as unknown as CodingAgentService;

  const mockCreateTrigger = vi.fn();
  const mockTriggerSvc = { createTrigger: mockCreateTrigger } as unknown as TriggerService;

  const mockTriggerEmit = vi.fn();
  const mockTriggerEng = { emit: mockTriggerEmit };

  const mockPick = vi.fn();
  const mockChannelSend = vi.fn();
  const mockRuntimeCtx = {
    llm: { pick: mockPick },
    channels: { send: mockChannelSend },
  } as unknown as RuntimeContext;

  const mockExecuteToolFn = vi.fn();
  const mockGetOrCreateChatAgentFn = vi.fn();
  const mockGetEventSystemFn = vi.fn(() => ({ emit: vi.fn() }));
  const mockHasProviderServiceFn = vi.fn(() => false);
  const mockGetProviderServiceFn = vi.fn();
  const mockRunInSandboxFn = vi.fn();

  return {
    mockClawService: mockClawSvc,
    mockExecuteNow,
    mockCreateClaw,
    mockStartClaw,
    mockWorkflowExecute: mockWorkflowExec,
    mockWorkflowService: mockWorkflowSvc,
    mockCodingAgentService: mockCodingSvc,
    mockRunTask,
    mockTriggerService: mockTriggerSvc,
    mockCreateTrigger,
    mockTriggerEngine: mockTriggerEng,
    mockTriggerEmit,
    mockRuntimeContext: mockRuntimeCtx,
    mockExecuteTool: mockExecuteToolFn,
    mockGetOrCreateChatAgent: mockGetOrCreateChatAgentFn,
    mockGetEventSystem: mockGetEventSystemFn,
    mockHasProviderService: mockHasProviderServiceFn,
    mockGetProviderService: mockGetProviderServiceFn,
    mockRunInSandbox: mockRunInSandboxFn,
  };
});

vi.mock('@ownpilot/core/services', () => ({
  getWorkflowService: () => mockWorkflowService,
  getTriggerService: () => mockTriggerService,
  hasProviderService: mockHasProviderService,
  getProviderService: mockGetProviderService,
  getRuntimeContext: () => mockRuntimeContext,
  getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@ownpilot/core/services/claw', () => ({
  getClawService: () => mockClawService,
}));

vi.mock('@ownpilot/core/services/coding-agent', () => ({
  getCodingAgentService: () => mockCodingAgentService,
}));

vi.mock('../triggers/engine.js', () => ({
  getTriggerEngine: () => mockTriggerEngine,
}));

vi.mock('../services/tool/executor.js', () => ({
  executeTool: mockExecuteTool,
}));

vi.mock('../services/agent/service.js', () => ({
  getOrCreateChatAgent: mockGetOrCreateChatAgent,
}));

vi.mock('@ownpilot/core/events', () => ({
  getEventSystem: mockGetEventSystem,
}));

vi.mock('@ownpilot/core/sandbox', () => ({
  runInSandbox: mockRunInSandbox,
}));

// =============================================================================
// Import under test — must be after mocks
// =============================================================================

import {
  AgenticGatewayExecutor,
  getAgenticExecutor,
  resetAgenticExecutor,
} from './agentic-executor.js';

// =============================================================================
// Helpers
// =============================================================================

function makeStep(executorKind: string, params: Record<string, unknown> = {}): ExecutionStep {
  return {
    index: 0,
    executorKind: executorKind as ExecutionStep['executorKind'],
    capabilityId: 'cap-test',
    params,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('AgenticGatewayExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgenticExecutor();
    // Default: no provider service
    mockHasProviderService.mockReturnValue(false);
  });

  afterEach(() => {
    resetAgenticExecutor();
  });

  // ── dispatchClaw ────────────────────────────────────────────────────────────

  describe('dispatchClaw', () => {
    it('returns error when no provider is configured and no clawId given', async () => {
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('claw', { task: 'hello', clawId: undefined })
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No AI provider configured/i);
    });

    it('calls ClawService.executeNow when clawId is provided', async () => {
      mockClawService.executeNow.mockResolvedValue({ costUsd: 0.01 } as never);
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('claw', { task: 'hello', clawId: 'claw-42', userId: 'user-1' })
      );
      expect(mockClawService.executeNow).toHaveBeenCalledWith('claw-42', 'user-1');
      expect(result.success).toBe(true);
      expect(result.costUsd).toBe(0.01);
    });

    it('uses chat agent when no clawId and provider is set via env', async () => {
      // Simulate provider resolved via env (DEFAULT_PROVIDER set)
      const mockAgent = { chat: vi.fn(), updateSystemPrompt: vi.fn() };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent as never);
      mockAgent.chat.mockResolvedValue({
        ok: true,
        value: { content: 'Hello!' },
      });

      // Override the env for this test
      const origProvider = process.env.DEFAULT_PROVIDER;
      const origModel = process.env.DEFAULT_MODEL;
      process.env.DEFAULT_PROVIDER = 'openai';
      process.env.DEFAULT_MODEL = 'gpt-4o';

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('claw', { task: 'say hello' }));

      expect(mockGetOrCreateChatAgent).toHaveBeenCalledWith('openai', 'gpt-4o');
      expect(mockAgent.chat).toHaveBeenCalledWith('say hello');
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ content: 'Hello!' });

      process.env.DEFAULT_PROVIDER = origProvider ?? '';
      process.env.DEFAULT_MODEL = origModel ?? '';
    });

    it('returns error when chat agent returns failure', async () => {
      const mockAgent = { chat: vi.fn(), updateSystemPrompt: vi.fn() };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent as never);
      mockAgent.chat.mockResolvedValue({ ok: false, error: { message: 'Model overloaded' } });

      const origProvider = process.env.DEFAULT_PROVIDER;
      const origModel = process.env.DEFAULT_MODEL;
      process.env.DEFAULT_PROVIDER = 'openai';
      process.env.DEFAULT_MODEL = 'gpt-4o';

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('claw', { task: 'fail me' }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Model overloaded');

      process.env.DEFAULT_PROVIDER = origProvider ?? '';
      process.env.DEFAULT_MODEL = origModel ?? '';
    });

    it('applies custom system prompt when provided', async () => {
      const mockAgent = { chat: vi.fn(), updateSystemPrompt: vi.fn() };
      mockGetOrCreateChatAgent.mockResolvedValue(mockAgent as never);
      mockAgent.chat.mockResolvedValue({ ok: true, value: { content: 'done' } });

      const origProvider = process.env.DEFAULT_PROVIDER;
      const origModel = process.env.DEFAULT_MODEL;
      process.env.DEFAULT_PROVIDER = 'openai';
      process.env.DEFAULT_MODEL = 'gpt-4o';

      const executor = new AgenticGatewayExecutor();
      await executor.dispatch(
        makeStep('claw', { task: 'do it', prompt: 'You are a pirate assistant' })
      );

      expect(mockAgent.updateSystemPrompt).toHaveBeenCalledWith('You are a pirate assistant');

      process.env.DEFAULT_PROVIDER = origProvider ?? '';
      process.env.DEFAULT_MODEL = origModel ?? '';
    });
  });

  // ── dispatchWorkflow ────────────────────────────────────────────────────────

  describe('dispatchWorkflow', () => {
    it('returns error when workflowId is missing', async () => {
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('workflow', {}));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workflowId/i);
    });

    it('calls WorkflowService.executeWorkflow with correct params', async () => {
      mockWorkflowExecute.mockResolvedValueOnce({
        id: 'wl-run-1',
        status: 'completed',
        nodeResults: [{ nodeId: 'n1', status: 'done' }],
        durationMs: 500,
      });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('workflow', {
          workflowId: 'wf-123',
          userId: 'alice',
          inputs: { name: 'Alice' },
        })
      );

      expect(mockWorkflowExecute).toHaveBeenCalledWith('wf-123', 'alice', undefined, {
        inputs: { name: 'Alice' },
      });
      expect(result.success).toBe(true);
      expect(result.output).toEqual([{ nodeId: 'n1', status: 'done' }]);
    });

    it('returns failure when workflow completes with error', async () => {
      mockWorkflowExecute.mockResolvedValueOnce({
        id: 'wl-run-2',
        status: 'failed',
        error: 'Node n1 timed out',
        durationMs: 500,
      });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('workflow', { workflowId: 'wf-bad' }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Node n1 timed out');
    });
  });

  // ── dispatchCodingAgent ────────────────────────────────────────────────────

  describe('dispatchCodingAgent', () => {
    it('calls CodingAgentService.runTask with correct params', async () => {
      mockCodingAgentService.runTask.mockResolvedValueOnce({
        success: true,
        output: 'Files created: 3',
        durationMs: 42_000,
      });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('coding_agent', {
          task: 'Create a REST API',
          provider: 'claude-code',
          cwd: '/workspace',
          timeoutMs: 60_000,
        })
      );

      expect(mockCodingAgentService.runTask).toHaveBeenCalledWith({
        provider: 'claude-code',
        prompt: 'Create a REST API',
        cwd: '/workspace',
        timeout: 60_000,
      });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Files created: 3');
    });

    it('defaults provider to claude-code and uses task description', async () => {
      mockCodingAgentService.runTask.mockResolvedValueOnce({
        success: true,
        output: 'done',
        durationMs: 10_000,
      });

      const executor = new AgenticGatewayExecutor();
      await executor.dispatch(makeStep('coding_agent', { task: 'Write tests' }));

      expect(mockCodingAgentService.runTask).toHaveBeenCalledWith({
        provider: 'claude-code',
        prompt: 'Write tests',
        cwd: undefined,
        timeout: 300_000,
      });
    });

    it('returns failure when runTask reports failure', async () => {
      mockCodingAgentService.runTask.mockResolvedValueOnce({
        success: false,
        error: 'Provider not configured',
        output: '',
        durationMs: 1_000,
      });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('coding_agent', { task: 'test' }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Provider not configured');
    });
  });

  // ── dispatchTrigger ────────────────────────────────────────────────────────

  describe('dispatchTrigger', () => {
    it('returns error when trigger or action is missing', async () => {
      const executor = new AgenticGatewayExecutor();
      const result1 = await executor.dispatch(
        makeStep('trigger', { trigger: { type: 'scheduled' } })
      );
      expect(result1.success).toBe(false);
      expect(result1.error).toMatch(/trigger.*action/i);

      const result2 = await executor.dispatch(makeStep('trigger', { action: { type: 'chat' } }));
      expect(result2.success).toBe(false);
    });

    it('creates a scheduled trigger with intervalMs converted to cron', async () => {
      mockTriggerService.createTrigger.mockResolvedValueOnce({
        id: 'trig-1',
        name: 'test-trigger',
        nextFire: new Date('2026-06-18T10:00:00Z'),
      } as never);

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('trigger', {
          taskName: 'morning-check',
          trigger: { type: 'interval', intervalMs: 3_600_000 }, // 1 hour
          action: { type: 'chat', payload: { task: 'Check emails', expectedOutput: 'Summary' } },
        })
      );

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'local',
        expect.objectContaining({
          type: 'schedule',
          config: expect.objectContaining({ cron: '0 */1 * * *' }),
        })
      );
      expect(result.success).toBe(true);
      expect((result.output as Record<string, unknown>).type).toBe('schedule');
    });

    it('creates an event trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValueOnce({
        id: 'trig-2',
        name: 'event-trigger',
      } as never);

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('trigger', {
          trigger: { type: 'event', eventType: 'user.signup' },
          action: { type: 'chat', payload: { task: 'Send welcome' } },
        })
      );

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'local',
        expect.objectContaining({
          type: 'event',
          config: expect.objectContaining({ eventType: 'user.signup' }),
        })
      );
      expect(result.success).toBe(true);
    });

    it('creates a condition trigger', async () => {
      mockTriggerService.createTrigger.mockResolvedValueOnce({
        id: 'trig-3',
        name: 'condition-trigger',
      } as never);

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('trigger', {
          trigger: {
            type: 'condition',
            condition: 'cpu_usage > 80',
            threshold: 80,
            checkIntervalMs: 60_000,
          },
          action: { type: 'chat', payload: { task: 'Alert admin' } },
        })
      );

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'local',
        expect.objectContaining({
          type: 'condition',
          config: expect.objectContaining({
            condition: 'cpu_usage > 80',
            threshold: 80,
          }),
        })
      );
      expect(result.success).toBe(true);
    });

    it('creates a continuous Claw for continuous trigger type', async () => {
      const mockClaw = { id: 'claw-continuous' };
      const mockSession = { state: 'running' };
      mockClawService.createClaw.mockResolvedValueOnce(mockClaw as never);
      mockClawService.startClaw.mockResolvedValueOnce(mockSession as never);

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('trigger', {
          taskName: 'always-on',
          trigger: { type: 'continuous' },
          action: { type: 'chat', payload: { task: 'Monitor system' } },
        })
      );

      expect(mockClawService.createClaw).toHaveBeenCalledWith({
        userId: 'local',
        name: 'always-on',
        mission: 'Monitor system',
        mode: 'continuous',
        createdBy: 'claw',
      });
      expect(result.success).toBe(true);
      expect((result.output as Record<string, unknown>).clawId).toBe('claw-continuous');
    });

    it('emits as one-shot for unsupported trigger types', async () => {
      mockTriggerEngine.emit.mockResolvedValueOnce(undefined);

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('trigger', {
          trigger: { type: 'webhook' },
          action: { type: 'chat', payload: { task: 'webhook action' } },
        })
      );

      expect(mockTriggerEngine.emit).toHaveBeenCalledWith('agentic:trigger', {
        triggerType: 'webhook',
        actionType: 'chat',
        task: 'webhook action',
      });
      expect(result.success).toBe(true);
      expect((result.output as Record<string, unknown>).note).toMatch(/one-shot/i);
    });
  });

  // ── dispatchTool ───────────────────────────────────────────────────────────

  describe('dispatchTool', () => {
    it('returns error when tool name is missing', async () => {
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('tool_catalog', {}));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/tool name/i);
    });

    it('calls executeTool with correct name and args', async () => {
      mockExecuteTool.mockResolvedValueOnce({ success: true, result: { rows: 5 } });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('tool_catalog', {
          tool: 'list_emails',
          args: { since: '2026-01-01', limit: 10 },
        })
      );

      expect(mockExecuteTool).toHaveBeenCalledWith(
        'list_emails',
        { since: '2026-01-01', limit: 10 },
        'local'
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ rows: 5 });
    });

    it('returns failure when executeTool reports failure', async () => {
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        error: 'SMTP auth failed',
      });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('tool_catalog', { tool: 'send_email', args: { to: 'a@b.com' } })
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP auth failed');
    });
  });

  // ── dispatchSandbox ────────────────────────────────────────────────────────

  describe('dispatchSandbox', () => {
    it('returns error when code is missing', async () => {
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('sandbox_code', {}));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/code/i);
    });

    it('calls runInSandbox with correct params', async () => {
      vi.resetModules();
      // Re-import to get fresh module with our dynamic mock
      const { runInSandbox } = await import('@ownpilot/core/sandbox');
      (runInSandbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout: '42' });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('sandbox_code', {
          code: 'console.log(21 * 2)',
          language: 'javascript',
          timeoutMs: 5_000,
        })
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ stdout: '42' });
    });
  });

  // ── Unknown executor kind ─────────────────────────────────────────────────

  describe('unknown executor kind', () => {
    it('returns an error result for unknown executor kinds', async () => {
      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(makeStep('unknown_kind' as never, {}));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown executor kind/);
    });
  });

  // ── Singleton ─────────────────────────────────────────────────────────────

  describe('singleton access', () => {
    it('returns the same instance via getAgenticExecutor()', () => {
      const a = getAgenticExecutor();
      const b = getAgenticExecutor();
      expect(a).toBe(b);
    });

    it('resetAgenticExecutor clears the singleton', () => {
      const a = getAgenticExecutor();
      resetAgenticExecutor();
      const b = getAgenticExecutor();
      expect(a).not.toBe(b);
    });
  });

  // ── Cancellation ───────────────────────────────────────────────────────────

  describe('cancellation via AbortSignal', () => {
    it('returns cancelled result when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('tool_catalog', { tool: 'get_weather', args: { city: 'Tokyo' } }),
        controller.signal
      );

      expect(result.cancelled).toBe(true);
      expect(result.success).toBe(false);
    });

    it('emits cancelled flag in the step.fail WebSocket event', async () => {
      const controller = new AbortController();
      controller.abort();

      const executor = new AgenticGatewayExecutor();
      await executor.dispatch(
        makeStep('tool_catalog', { tool: 'get_weather', args: { city: 'Tokyo' } }),
        controller.signal
      );

      // Find the event system mock call — it's the last one
      const emitCall = mockGetEventSystem.mock.results.at(-1)?.value.emit as ReturnType<
        typeof vi.fn
      >;
      const eventName = emitCall.mock.calls.at(-1)?.[0];
      const eventData = emitCall.mock.calls.at(-1)?.[2] as Record<string, unknown>;

      expect(eventName).toBe('agentic.step.fail');
      expect(eventData.cancelled).toBe(true);
      expect(eventData.error).toBe('Cancelled');
    });

    it('dispatches normally when no signal is provided', async () => {
      mockExecuteTool.mockResolvedValueOnce({ success: true, result: { rows: 5 } });

      const executor = new AgenticGatewayExecutor();
      const result = await executor.dispatch(
        makeStep('tool_catalog', { tool: 'send_email', args: { to: 'a@b.com' } })
      );

      expect(result.cancelled).toBeUndefined();
      expect(result.success).toBe(true);
    });
  });

  // ── Event emission ────────────────────────────────────────────────────────

  describe('event emission', () => {
    it('emits agentic.step.start before dispatch', async () => {
      const emit = vi.fn();
      mockGetEventSystem.mockReturnValueOnce({ emit } as never);

      const executor = new AgenticGatewayExecutor();
      // Make it short-circuit so we can check the start event
      mockHasProviderService.mockReturnValue(true);
      mockGetProviderService.mockReturnValueOnce({
        resolve: vi.fn().mockRejectedValue(new Error('nope')),
      });

      await executor.dispatch(makeStep('claw', { task: 'hello' }));

      // The first emit call should be 'agentic.step.start'
      expect(emit).toHaveBeenCalledWith(
        'agentic.step.start',
        'agentic-executor',
        expect.objectContaining({
          stepIndex: 0,
          executorKind: 'claw',
          capabilityId: 'cap-test',
        })
      );
    });

    it('emits agentic.step.complete on success', async () => {
      const emit = vi.fn();
      mockGetEventSystem.mockReturnValueOnce({ emit } as never);

      mockCodingAgentService.runTask.mockResolvedValueOnce({
        success: true,
        output: 'ok',
        durationMs: 100,
      });

      const executor = new AgenticGatewayExecutor();
      await executor.dispatch(makeStep('coding_agent', { task: 'test' }));

      const completeCall = emit.mock.calls.find(([type]) => type === 'agentic.step.complete');
      expect(completeCall).toBeDefined();
      expect(completeCall![2]).toMatchObject({ executorKind: 'coding_agent' });
    });

    it('emits agentic.step.fail on error', async () => {
      const emit = vi.fn();
      mockGetEventSystem.mockReturnValueOnce({ emit } as never);

      mockCodingAgentService.runTask.mockResolvedValueOnce({
        success: false,
        error: 'boom',
        durationMs: 10,
      });

      const executor = new AgenticGatewayExecutor();
      await executor.dispatch(makeStep('coding_agent', { task: 'test' }));

      const failCall = emit.mock.calls.find(([type]) => type === 'agentic.step.fail');
      expect(failCall).toBeDefined();
    });
  });
});
