import { describe, it, expect, vi } from 'vitest';
import type { AgentInput, AgentResult } from './lifecycle.js';
import { BaseAgentLifecycle } from './lifecycle.js';
import type { AgentType } from './lifecycle.js';

// Concrete test implementation
class TestAgent extends BaseAgentLifecycle {
  readonly id: string;
  readonly type: AgentType = 'regular';

  constructor(id: string) {
    super();
    this.id = id;
  }

  async execute(input: AgentInput): Promise<AgentResult> {
    this.transition('running');
    this.accumulateMetrics({ tokensUsed: 100, toolCallsUsed: 2, costUsd: 0.01 });
    this.transition('completed');
    return {
      success: true,
      output: `Completed: ${input.task}`,
      metrics: this.getResourceUsage(),
    };
  }

  async cancel(): Promise<void> {
    this.transition('cancelled');
  }

  // Expose for testing
  doTransition(state: Parameters<BaseAgentLifecycle['transition']>[0]) {
    this.transition(state);
  }
}

describe('BaseAgentLifecycle', () => {
  it('starts in idle state', () => {
    const agent = new TestAgent('test-1');
    expect(agent.getState()).toBe('idle');
  });

  it('tracks state transitions', () => {
    const agent = new TestAgent('test-2');
    agent.doTransition('starting');
    expect(agent.getState()).toBe('starting');
    agent.doTransition('running');
    expect(agent.getState()).toBe('running');
    agent.doTransition('completed');
    expect(agent.getState()).toBe('completed');
  });

  it('accumulates resource metrics', async () => {
    const agent = new TestAgent('test-3');
    const result = await agent.execute({ task: 'hello' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('Completed: hello');

    const metrics = agent.getResourceUsage();
    expect(metrics.tokensUsed).toBe(100);
    expect(metrics.toolCallsUsed).toBe(2);
    expect(metrics.costUsd).toBe(0.01);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zero metrics initially', () => {
    const agent = new TestAgent('test-4');
    const metrics = agent.getResourceUsage();
    expect(metrics.tokensUsed).toBe(0);
    expect(metrics.toolCallsUsed).toBe(0);
    expect(metrics.costUsd).toBe(0);
    expect(metrics.durationMs).toBe(0);
  });

  it('transitions to cancelled on cancel', async () => {
    const agent = new TestAgent('test-5');
    agent.doTransition('running');
    await agent.cancel();
    expect(agent.getState()).toBe('cancelled');
  });

  it('tracks duration across multiple runs', async () => {
    const agent = new TestAgent('test-6');
    await agent.execute({ task: 'run 1' });
    const metrics1 = agent.getResourceUsage();
    expect(metrics1.tokensUsed).toBe(100);
    expect(metrics1.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('banks running time on pause and excludes the paused wall-clock from duration', () => {
    vi.useFakeTimers();
    try {
      const agent = new TestAgent('test-7');
      vi.setSystemTime(1_000_000);
      agent.doTransition('running');
      vi.advanceTimersByTime(60);
      agent.doTransition('paused');
      // While paused: the banked running time must stay visible and the
      // paused wall-clock must not count.
      expect(agent.getResourceUsage().durationMs).toBe(60);
      vi.advanceTimersByTime(250);
      agent.doTransition('running');
      // After resume: only the banked 60ms counts; the 250ms pause is excluded.
      expect(agent.getResourceUsage().durationMs).toBe(60);
      vi.advanceTimersByTime(60);
      agent.doTransition('completed');
      expect(agent.getResourceUsage().durationMs).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });
});
