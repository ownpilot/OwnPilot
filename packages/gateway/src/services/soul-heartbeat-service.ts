/**
 * Soul Heartbeat Service
 *
 * Bridges the core HeartbeatRunner with gateway repositories and services.
 * Registers a 'run_heartbeat' action handler with the Trigger Engine.
 */

import { HeartbeatRunner, AgentCommunicationBus, BudgetTracker } from '@ownpilot/core';
import type {
  IHeartbeatAgentEngine,
  IHeartbeatEventBus,
  ISoulRepository,
  IHeartbeatLogRepository,
} from '@ownpilot/core';
import { getAdapterSync } from '../db/adapters/index.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
import { getLog } from '@ownpilot/core';

const log = getLog('SoulHeartbeatService');

// ============================================================
// Gateway Soul Repository Adapter (implements ISoulRepository)
// ============================================================

function createSoulRepoAdapter(): ISoulRepository {
  const repo = getSoulsRepository();
  return {
    getByAgentId: (agentId) => repo.getByAgentId(agentId),
    update: (soul) => repo.update(soul),
    createVersion: (soul, changeReason, changedBy) =>
      repo.createVersion(soul, changeReason, changedBy),
    setHeartbeatEnabled: (agentId, enabled) => repo.setHeartbeatEnabled(agentId, enabled),
    updateTaskStatus: (agentId, taskId, status) => repo.updateTaskStatus(agentId, taskId, status),
  };
}

// ============================================================
// Gateway Heartbeat Log Repository Adapter
// ============================================================

function createHeartbeatLogRepoAdapter(): IHeartbeatLogRepository {
  const repo = getHeartbeatLogRepository();
  return {
    getRecent: (agentId, limit) => repo.getRecent(agentId, limit),
    getLatest: (agentId) => repo.getLatest(agentId),
    create: (entry) => repo.create(entry),
  };
}

// ============================================================
// Minimal Agent Engine (sends heartbeat prompt to the agent)
// ============================================================

function createHeartbeatAgentEngine(): IHeartbeatAgentEngine {
  return {
    async processMessage(request) {
      // Dynamic import to avoid circular dependencies
      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const { resolveForProcess } = await import('./model-routing.js');
      const resolved = await resolveForProcess('pulse');
      const provider = resolved.provider ?? 'anthropic';
      const model = resolved.model ?? 'claude-sonnet-4-5-20250514';
      const fallback =
        resolved.fallbackProvider && resolved.fallbackModel
          ? { provider: resolved.fallbackProvider, model: resolved.fallbackModel }
          : undefined;

      const agent = await getOrCreateChatAgent(provider, model, fallback);

      const result = await agent.chat(request.message);
      if (!result.ok) {
        throw result.error;
      }

      return {
        content: result.value.content,
        tokenUsage: result.value.usage
          ? { input: result.value.usage.promptTokens, output: result.value.usage.completionTokens }
          : undefined,
        cost: undefined,
      };
    },

    async saveMemory(agentId, content, source) {
      try {
        const { getServiceRegistry, Services } = await import('@ownpilot/core');
        const registry = getServiceRegistry();
        const memorySvc = registry.get(Services.Memory);
        await memorySvc.createMemory(agentId, {
          content,
          source,
          type: 'fact',
        });
      } catch (err) {
        log.warn('Failed to save heartbeat memory', { agentId, error: String(err) });
      }
    },

    async sendToChannel(channel, message, _chatId) {
      try {
        const { sendTelegramMessage } = await import('../tools/notification-tools.js');
        if (channel === 'telegram') {
          await sendTelegramMessage('default', message);
        } else {
          log.debug(`Channel ${channel} not supported for heartbeat output`);
        }
      } catch (err) {
        log.warn('Failed to send heartbeat output to channel', { channel, error: String(err) });
      }
    },
  };
}

// ============================================================
// Event Bus Adapter
// ============================================================

function createEventBusAdapter(): IHeartbeatEventBus {
  return {
    emit(event, payload) {
      log.info(`[HeartbeatEvent] ${event}`, payload as Record<string, unknown>);
    },
  };
}

// ============================================================
// Service Singleton
// ============================================================

let runner: HeartbeatRunner | null = null;

export function getHeartbeatRunner(): HeartbeatRunner {
  if (!runner) {
    const soulRepo = createSoulRepoAdapter();
    const hbLogRepo = createHeartbeatLogRepoAdapter();
    const msgRepo = getAgentMessagesRepository();
    const db = getAdapterSync();

    const communicationBus = new AgentCommunicationBus(msgRepo, createEventBusAdapter());
    const budgetTracker = new BudgetTracker(db);
    const agentEngine = createHeartbeatAgentEngine();

    runner = new HeartbeatRunner(
      agentEngine,
      soulRepo,
      communicationBus,
      hbLogRepo,
      budgetTracker,
      createEventBusAdapter()
    );
  }
  return runner;
}

/**
 * Run a heartbeat cycle for a specific agent.
 * Called by the trigger engine's 'run_heartbeat' action handler.
 */
export async function runAgentHeartbeat(
  agentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const hbRunner = getHeartbeatRunner();
    const result = await hbRunner.runHeartbeat(agentId);
    if (result.ok) {
      log.info(`Heartbeat completed for agent ${agentId}`, {
        tasksRun: result.value.tasks.length,
        cost: result.value.totalCost,
        durationMs: result.value.durationMs,
      });
      return { success: true };
    } else {
      log.warn(`Heartbeat failed for agent ${agentId}: ${result.error.message}`);
      return { success: false, error: result.error.message };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Heartbeat error for agent ${agentId}: ${msg}`);
    return { success: false, error: msg };
  }
}
