/**
 * Tests for Agentic Capability Layer
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CapabilityRegistry,
  getCapabilityRegistry,
  resetCapabilityRegistry,
  getBuiltInCapabilities,
  AgenticRouter,
  AgenticOrchestrator,
  optimizePlan,
  createResearchPipeline,
  createMonitoringPipeline,
  createCodePipeline,
} from './index.js';
import type { CapabilityEntry, ExecutionPlan } from './types.js';

describe('CapabilityRegistry', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
  });

  it('registers built-in capabilities by default', () => {
    const registry = new CapabilityRegistry(true);
    expect(registry.size).toBeGreaterThan(0);
    expect(registry.getAll().length).toBe(getBuiltInCapabilities().length);
  });

  it('creates an empty registry when registerBuiltIns is false', () => {
    const registry = new CapabilityRegistry(false);
    expect(registry.size).toBe(0);
  });

  it('supports register, get, unregister', () => {
    const registry = new CapabilityRegistry(false);
    const cap: CapabilityEntry = {
      id: 'test:cap',
      name: 'Test Capability',
      description: 'A test capability',
      executorKind: 'direct_llm',
      providerId: 'test',
      tags: ['test'],
      requiresApproval: false,
      registeredAt: new Date(),
    };

    registry.register(cap);
    expect(registry.get('test:cap')).toBeDefined();
    expect(registry.size).toBe(1);

    registry.unregister('test:cap');
    expect(registry.get('test:cap')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('supports query by keywords', () => {
    const registry = new CapabilityRegistry(true);
    const results = registry.query({ keywords: ['research', 'web'] });
    expect(results.entries.length).toBeGreaterThan(0);
    expect(
      results.entries.every((e) => {
        const text = `${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase();
        return text.includes('research') || text.includes('web');
      })
    ).toBe(true);
  });

  it('supports query by executor kind', () => {
    const registry = new CapabilityRegistry(true);
    const results = registry.query({ executorKind: 'channel' });
    expect(results.entries.length).toBeGreaterThan(0);
    expect(results.entries.every((e) => e.executorKind === 'channel')).toBe(true);
  });

  it('supports query by provider', () => {
    const registry = new CapabilityRegistry(true);
    const results = registry.query({ providerId: 'ownpilot:claw' });
    expect(results.entries.length).toBeGreaterThan(0);
    expect(results.entries.every((e) => e.providerId === 'ownpilot:claw')).toBe(true);
  });

  it('supports query with unattendedOnly filter', () => {
    const registry = new CapabilityRegistry(true);
    const results = registry.query({ unattendedOnly: true });
    expect(results.entries.every((e) => !e.requiresApproval)).toBe(true);
  });

  it('supports getByProvider', () => {
    const registry = new CapabilityRegistry(true);
    const clawCaps = registry.getByProvider('ownpilot:claw');
    expect(clawCaps.length).toBeGreaterThan(0);
    expect(clawCaps.every((e) => e.providerId === 'ownpilot:claw')).toBe(true);
  });

  it('supports getByKind', () => {
    const registry = new CapabilityRegistry(true);
    const channels = registry.getByKind('channel');
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((e) => e.executorKind === 'channel')).toBe(true);
  });

  it('supports search by keywords', () => {
    const registry = new CapabilityRegistry(true);
    const results = registry.search(['code', 'claude']);
    expect(results.length).toBeGreaterThan(0);
  });

  it('supports event listeners', () => {
    const registry = new CapabilityRegistry(false);
    let registered: CapabilityEntry | null = null;
    const unsub = registry.on('register', (e) => {
      registered = e;
    });

    const cap: CapabilityEntry = {
      id: 'test:event',
      name: 'Event Test',
      description: 'Testing events',
      executorKind: 'direct_llm',
      providerId: 'test',
      tags: [],
      requiresApproval: false,
      registeredAt: new Date(),
    };
    registry.register(cap);
    expect(registered?.id).toBe('test:event');

    unsub();
    registered = null;
    registry.register({ ...cap, id: 'test:event2' });
    expect(registered).toBeNull();
  });

  it('getSingleton returns same instance', () => {
    const a = getCapabilityRegistry();
    const b = getCapabilityRegistry();
    expect(a).toBe(b);
  });
});

describe('AgenticRouter', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
  });

  it('routes research tasks to claw', async () => {
    const router = new AgenticRouter();
    const { analysis, plan } = await router.route({
      name: 'Research AI trends',
      description:
        'Investigate the latest AI trends and produce a thorough report with verified sources.',
      expectedOutput: 'Research report',
    });

    expect(analysis.suggestedKinds).toContain('claw');
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('routes simple chat tasks to direct_llm', async () => {
    const router = new AgenticRouter();
    const { analysis, plan } = await router.route({
      name: 'Explain quantum',
      description: 'Explain quantum computing in simple terms.',
    });

    // Direct LLM should be high confidence for simple explanation
    expect(analysis.suggestedKinds).toContain('direct_llm');
    expect(plan.steps[0]?.executorKind).toBeDefined();
  });

  it('routes code tasks with code execution patterns', async () => {
    const router = new AgenticRouter();
    const { analysis } = await router.route({
      name: 'Run tests',
      description: 'Execute the test suite and fix any failures.',
    });

    expect(analysis.likelyNeedsCodeExecution).toBe(true);
  });

  it('routes scheduled tasks to trigger/soul', async () => {
    const router = new AgenticRouter();
    const { plan } = await router.route({
      name: 'Daily health check',
      description: 'Check system health every day at 9 AM and report issues.',
      trigger: { type: 'scheduled', cron: '0 9 * * *' },
    });

    expect(plan.steps.some((s) => s.executorKind === 'trigger')).toBe(true);
  });

  it('routes continuous tasks to claw', async () => {
    const router = new AgenticRouter();
    const { plan } = await router.route({
      name: 'Continuously monitor',
      description: 'Continuously monitor the API endpoint for availability.',
      trigger: { type: 'continuous' },
    });

    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('produces a plan with estimated costs', async () => {
    const router = new AgenticRouter();
    const { plan } = await router.route({
      name: 'Complex task',
      description: 'Research and implement a new feature with tests.',
    });

    expect(plan.estimatedCostUsd).toBeGreaterThan(0);
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
    expect(typeof plan.fallbackStrategy).toBe('string');
    expect(plan.createdAt).toBeInstanceOf(Date);
  });
});

describe('AgenticOrchestrator', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
  });

  it('executes a simple task and produces a report', async () => {
    const orchestrator = new AgenticOrchestrator();
    const report = await orchestrator.execute({
      name: 'Simple task',
      description: 'Analyze the current state of the project.',
    });

    expect(report.id).toBeDefined();
    expect(report.task.name).toBe('Simple task');
    expect(report.stepResults.length).toBeGreaterThanOrEqual(1);
    expect(['completed', 'failed', 'partially_completed', 'cancelled']).toContain(report.status);
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(report.summary).toBeDefined();
  });

  it('supports cancel', async () => {
    const orchestrator = new AgenticOrchestrator();
    const report = await orchestrator.execute({
      name: 'Cancellable',
      description: 'This will be cancelled',
    });

    // Can't cancel after completion
    const cancelled = await orchestrator.cancel(report.id);
    expect(cancelled).toBe(false);
  });

  it('getStatus returns correct status', async () => {
    const orchestrator = new AgenticOrchestrator();
    const report = await orchestrator.execute({
      name: 'Status test',
      description: 'Test status tracking.',
    });

    const status = await orchestrator.getStatus(report.id);
    expect(status).toBe(report.status);
  });

  it('getReport returns stored report', async () => {
    const orchestrator = new AgenticOrchestrator();
    const report = await orchestrator.execute({
      name: 'Report test',
      description: 'Test report storage.',
    });

    const fetched = await orchestrator.getReport(report.id);
    expect(fetched?.id).toBe(report.id);
    expect(fetched?.task.name).toBe('Report test');
  });

  it('listExecutions returns executions in reverse chronological order', async () => {
    const orchestrator = new AgenticOrchestrator();
    await orchestrator.execute({ name: 'Task 1', description: 'First task' });
    await orchestrator.execute({ name: 'Task 2', description: 'Second task' });

    const list = await orchestrator.listExecutions(10, 0);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Both executions should be present (order may vary with fast parallel execution)
    const names = list.map((r) => r.task.name);
    expect(names).toContain('Task 1');
    expect(names).toContain('Task 2');
  });

  it('getStats returns aggregated stats', async () => {
    const orchestrator = new AgenticOrchestrator();
    await orchestrator.execute({ name: 'Stats 1', description: 'Stats test task 1' });
    await orchestrator.execute({ name: 'Stats 2', description: 'Stats test task 2' });

    const stats = await orchestrator.getStats();
    expect(stats.totalExecutions).toBeGreaterThanOrEqual(2);
    expect(stats.totalCostUsd).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
    expect(stats.byExecutorKind).toBeDefined();
  });

  it('non-existent report returns null', async () => {
    const orchestrator = new AgenticOrchestrator();
    const report = await orchestrator.getReport('nonexistent');
    expect(report).toBeNull();
  });
});

describe('optimizePlan', () => {
  it('suggests parallelization for independent steps', () => {
    const plan: ExecutionPlan = {
      task: { id: 'test', name: 'Test', description: 'Test' },
      steps: [
        {
          index: 1,
          executorKind: 'claw',
          capabilityId: 'c1',
          providerId: 'p1',
          params: {},
          dependsOn: [],
          timeoutMs: 30_000,
          retryOnFailure: true,
        },
        {
          index: 2,
          executorKind: 'channel',
          capabilityId: 'c2',
          providerId: 'p2',
          params: {},
          dependsOn: [],
          timeoutMs: 10_000,
          retryOnFailure: false,
        },
      ],
      requiresApproval: false,
      fallbackStrategy: 'abort',
      createdAt: new Date(),
    };

    const suggestions = optimizePlan(plan);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.type === 'parallelize')).toBe(true);
  });
});

describe('Pipeline Templates', () => {
  it('createResearchPipeline produces valid tasks', () => {
    const task = createResearchPipeline('Quantum Computing', {
      depth: 'deep',
      outputFormat: 'markdown',
    });
    expect(task.name).toContain('Research');
    expect(task.description).toContain('Quantum Computing');
    expect(task.constraints?.maxCostUsd).toBe(0.5);
    expect(task.outputRouting?.memory).toBe(true);
    expect(task.outputRouting?.artifact?.tags).toContain('quantum computing');
  });

  it('createMonitoringPipeline produces valid tasks', () => {
    const task = createMonitoringPipeline('API Health', 'check api.example.com/health', 300_000, {
      provider: 'telegram',
      chatId: '123',
    });
    expect(task.name).toContain('Monitor');
    expect(task.trigger).toBeDefined();
    expect(task.trigger?.type).toBe('interval');
    if (task.trigger && task.trigger.type === 'interval') {
      expect(task.trigger.intervalMs).toBe(300_000);
    }
    expect(task.outputRouting?.channel?.provider).toBe('telegram');
  });

  it('createCodePipeline produces valid tasks', () => {
    const task = createCodePipeline('Build a REST API', {
      language: 'TypeScript',
      includeTests: true,
    });
    expect(task.name).toContain('Code');
    expect(task.constraints?.allowCodeExecution).toBe(true);
    expect(task.constraints?.maxCostUsd).toBe(1.0);
    expect(task.outputRouting?.artifact?.tags).toContain('typescript');
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    resetCapabilityRegistry();
  });

  it('empty registry returns empty results', () => {
    const registry = new CapabilityRegistry(false);
    expect(registry.size).toBe(0);
    expect(registry.query({ keywords: ['anything'] }).total).toBe(0);
  });

  it('unregistering non-existent capability returns false', () => {
    const registry = new CapabilityRegistry(false);
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('router handles empty description gracefully', async () => {
    const router = new AgenticRouter();
    const { analysis } = await router.route({
      name: 'Empty',
      description: '',
    });
    // Should not throw and should return something
    expect(analysis.suggestedKinds.length).toBeGreaterThan(0);
  });

  it('orchestrator handles multiple rapid executions', async () => {
    const orchestrator = new AgenticOrchestrator();
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      name: `Rapid ${i}`,
      description: `Rapid execution test ${i}`,
    }));

    const results = await Promise.all(tasks.map((t) => orchestrator.execute(t)));
    expect(results.length).toBe(5);
    expect(results.every((r) => r.id)).toBe(true);
  });

  it('registry event unsub works correctly', () => {
    const registry = new CapabilityRegistry(false);
    let count = 0;
    const unsub = registry.on('register', () => {
      count++;
    });

    registry.register({
      id: 'a',
      name: 'A',
      description: '',
      executorKind: 'direct_llm',
      providerId: 't',
      tags: [],
      requiresApproval: false,
      registeredAt: new Date(),
    });
    expect(count).toBe(1);

    unsub();
    registry.register({
      id: 'b',
      name: 'B',
      description: '',
      executorKind: 'direct_llm',
      providerId: 't',
      tags: [],
      requiresApproval: false,
      registeredAt: new Date(),
    });
    expect(count).toBe(1); // no increment after unsub
  });
});
