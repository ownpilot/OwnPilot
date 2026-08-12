/**
 * Tests for shutdown-cleanup.ts — centralized service shutdown.
 *
 * Every module in the RESETTERS table is mocked at its boundary. That is not
 * incidental: `shutdownAllServices` dynamically imports ~35 modules, which in a
 * test meant pulling in the entire gateway service graph. The import cost alone
 * used to blow past the per-test timeout under full-suite parallelism, making
 * this one of the two files that flaked on every full run. Mocked, it runs in
 * milliseconds.
 *
 * It also lets the test assert the actual contract — every resetter runs, a
 * throwing resetter is caught and logged, and the rest still run — instead of
 * only that the call resolves.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('./log.js', () => ({ getLog: () => mockLog }));

// ─── Resetter spies ───────────────────────────────────────────────────────
// One spy per entry in RESETTERS, so the test can assert the whole table ran.

const spies = vi.hoisted(() => {
  const make = () => vi.fn();
  return {
    disconnectAll: make(),
    tunnelStop: make(),
    unregisterWebhookHandler: make(),
    stopTriggerEngine: make(),
    stopAllRateLimiters: make(),
    stopCleanup: make(),
    approvalStop: make(),
    stopAutonomyEngine: make(),
    stopScheduler: make(),
    stopWorkflowNodeWorker: make(),
    resetEmbeddingQueue: make(),
    resetHeartbeatRunner: make(),
    resetPulseMetricsService: make(),
    stopAllCircuitBreakers: make(),
    codingSessionStop: make(),
    resetCodingAgentSessionManager: make(),
    resetHeartbeatService: make(),
    resetMemoryService: make(),
    resetGoalService: make(),
    resetPlanService: make(),
    resetExtensionService: make(),
    resetCliToolService: make(),
    resetCodingAgentService: make(),
    stopMetricsService: make(),
    clawStop: make(),
    resetClawManager: make(),
    resetBrowserService: make(),
    resetExtensionSandbox: make(),
    resetEdgeMqttClient: make(),
    resetEmbeddingService: make(),
    resetVoiceService: make(),
    resetNpmInstaller: make(),
    resetLlmSemaphore: make(),
    resetCustomDataService: make(),
    resetTriggerService: make(),
    resetResourceRegistry: make(),
    invalidateMcpServer: make(),
  };
});

vi.mock('./mcp/client.js', () => ({
  mcpClientService: { disconnectAll: spies.disconnectAll },
}));
vi.mock('./tunnel-service.js', () => ({
  getTunnelService: () => ({ stop: spies.tunnelStop }),
}));
vi.mock('../channels/plugins/telegram/webhook.js', () => ({
  getWebhookHandler: () => ({}),
  unregisterWebhookHandler: spies.unregisterWebhookHandler,
}));
vi.mock('../triggers/index.js', () => ({ stopTriggerEngine: spies.stopTriggerEngine }));
vi.mock('../middleware/rate-limit.js', () => ({
  stopAllRateLimiters: spies.stopAllRateLimiters,
}));
vi.mock('./ui-session.js', () => ({ stopCleanup: spies.stopCleanup }));
vi.mock('../autonomy/approvals.js', () => ({
  getApprovalManager: () => ({ stop: spies.approvalStop }),
}));
vi.mock('../autonomy/engine.js', () => ({ stopAutonomyEngine: spies.stopAutonomyEngine }));
vi.mock('../scheduler/index.js', () => ({ stopScheduler: spies.stopScheduler }));
vi.mock('./workflow/workflow-node-job-handler.js', () => ({
  stopWorkflowNodeWorker: spies.stopWorkflowNodeWorker,
}));
vi.mock('./embedding/queue.js', () => ({ resetEmbeddingQueue: spies.resetEmbeddingQueue }));
vi.mock('./heartbeat/soul-service.js', () => ({
  resetHeartbeatRunner: spies.resetHeartbeatRunner,
}));
vi.mock('./metric/pulse.js', () => ({
  resetPulseMetricsService: spies.resetPulseMetricsService,
}));
vi.mock('../middleware/circuit-breaker.js', () => ({
  stopAllCircuitBreakers: spies.stopAllCircuitBreakers,
}));
vi.mock('./coding-agent/sessions.js', () => ({
  getCodingAgentSessionManager: () => ({ stop: spies.codingSessionStop }),
  resetCodingAgentSessionManager: spies.resetCodingAgentSessionManager,
}));
vi.mock('./heartbeat/service.js', () => ({
  resetHeartbeatService: spies.resetHeartbeatService,
}));
vi.mock('./memory-service.js', () => ({ resetMemoryService: spies.resetMemoryService }));
vi.mock('./goal-service.js', () => ({ resetGoalService: spies.resetGoalService }));
vi.mock('./plan-service.js', () => ({ resetPlanService: spies.resetPlanService }));
vi.mock('./extension/service.js', () => ({ resetExtensionService: spies.resetExtensionService }));
vi.mock('./cli/tool-service.js', () => ({ resetCliToolService: spies.resetCliToolService }));
vi.mock('./coding-agent/service.js', () => ({
  resetCodingAgentService: spies.resetCodingAgentService,
}));
vi.mock('./metric/service.js', () => ({ stopMetricsService: spies.stopMetricsService }));
vi.mock('./claw/manager.js', () => ({
  getClawManager: () => ({ stop: spies.clawStop }),
  resetClawManager: spies.resetClawManager,
}));
vi.mock('./browser-service.js', () => ({ resetBrowserService: spies.resetBrowserService }));
vi.mock('./extension/sandbox.js', () => ({ resetExtensionSandbox: spies.resetExtensionSandbox }));
vi.mock('./edge/mqtt-client.js', () => ({ resetEdgeMqttClient: spies.resetEdgeMqttClient }));
vi.mock('./embedding/service.js', () => ({ resetEmbeddingService: spies.resetEmbeddingService }));
vi.mock('./voice-service.js', () => ({ resetVoiceService: spies.resetVoiceService }));
vi.mock('./skill/npm-installer.js', () => ({ resetNpmInstaller: spies.resetNpmInstaller }));
vi.mock('./llm/semaphore.js', () => ({ resetLlmSemaphore: spies.resetLlmSemaphore }));
vi.mock('./custom/data-service.js', () => ({
  resetCustomDataService: spies.resetCustomDataService,
}));
vi.mock('./trigger-service.js', () => ({ resetTriggerService: spies.resetTriggerService }));
vi.mock('./resource/registry.js', () => ({ resetResourceRegistry: spies.resetResourceRegistry }));
vi.mock('./mcp/server.js', () => ({ invalidateMcpServer: spies.invalidateMcpServer }));

const { shutdownAllServices } = await import('./shutdown-cleanup.js');

const allSpies = Object.entries(spies);

describe('shutdown-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves without throwing', async () => {
    await expect(shutdownAllServices(mockLog)).resolves.toBeUndefined();
  });

  it('invokes every registered resetter exactly once', async () => {
    await shutdownAllServices(mockLog);

    for (const [name, spy] of allSpies) {
      expect(spy, `${name} should have been called`).toHaveBeenCalledTimes(1);
    }
  });

  it('logs and continues when a resetter throws', async () => {
    spies.stopScheduler.mockImplementation(() => {
      throw new Error('scheduler exploded');
    });

    await expect(shutdownAllServices(mockLog)).resolves.toBeUndefined();

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Scheduler shutdown error',
      expect.objectContaining({ error: expect.stringContaining('scheduler exploded') })
    );
    // Everything after the failure must still run — a single bad resetter
    // cannot strand the remaining services.
    expect(spies.invalidateMcpServer).toHaveBeenCalledTimes(1);
    expect(spies.resetMemoryService).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when a resetter rejects', async () => {
    spies.resetMemoryService.mockRejectedValue(new Error('memory reset failed'));

    await expect(shutdownAllServices(mockLog)).resolves.toBeUndefined();

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Memory service shutdown error',
      expect.objectContaining({ error: expect.stringContaining('memory reset failed') })
    );
    expect(spies.invalidateMcpServer).toHaveBeenCalledTimes(1);
  });

  it('stops the claw manager before dropping its singleton', async () => {
    // stop() must be awaited so in-flight cycles persist before the DB pool
    // closes; resetting first would race the persist against pool teardown.
    const order: string[] = [];
    spies.clawStop.mockImplementation(async () => {
      order.push('stop');
    });
    spies.resetClawManager.mockImplementation(() => {
      order.push('reset');
    });

    await shutdownAllServices(mockLog);

    expect(order).toEqual(['stop', 'reset']);
  });

  it('shuts network and timer services down before service singletons', async () => {
    const order: string[] = [];
    spies.disconnectAll.mockImplementation(() => void order.push('mcp-client'));
    spies.stopScheduler.mockImplementation(() => void order.push('scheduler'));
    spies.resetMemoryService.mockImplementation(() => void order.push('memory'));

    await shutdownAllServices(mockLog);

    expect(order).toEqual(['mcp-client', 'scheduler', 'memory']);
  });
});
