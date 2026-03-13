/**
 * Soul Heartbeat Service
 *
 * Bridges the core HeartbeatRunner with gateway repositories and services.
 * Registers a 'run_heartbeat' action handler with the Trigger Engine.
 *
 * Crew orchestration additions:
 * - runInHeartbeatContext() wraps every agent.chat() call so communication
 *   tools (read_agent_inbox, send_agent_message, crew tools) resolve the
 *   correct soul agent ID instead of the generic human userId.
 * - buildCrewContextForHeartbeat() fetches crew membership + unread count
 *   and prepends a crew context section to each task prompt when the soul
 *   belongs to a crew.
 */

import {
  HeartbeatRunner,
  AgentCommunicationBus,
  BudgetTracker,
  getEventSystem,
} from '@ownpilot/core';
import type {
  IHeartbeatAgentEngine,
  IHeartbeatEventBus,
  ISoulRepository,
  IHeartbeatLogRepository,
} from '@ownpilot/core';
import { buildCrewContextSection } from '@ownpilot/core';
import type { CrewContextInfo } from '@ownpilot/core';
import { getAdapterSync } from '../db/adapters/index.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getHeartbeatLogRepository } from '../db/repositories/heartbeat-log.js';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
import { getCrewsRepository } from '../db/repositories/crews.js';
import { runInHeartbeatContext } from './heartbeat-context.js';
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
    updateHeartbeatChecklist: (agentId, checklist) =>
      repo.updateHeartbeatChecklist(agentId, checklist),
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
// Crew context injection
// ============================================================

/**
 * Fetch crew membership info and build the crew context section to prepend to
 * heartbeat task prompts. Returns null when the agent has no crew or on error.
 */
async function buildCrewContextForHeartbeat(
  agentId: string,
  crewId: string
): Promise<string | null> {
  try {
    const crewRepo = getCrewsRepository();
    const soulsRepo = getSoulsRepository();
    const msgRepo = getAgentMessagesRepository();

    const [crew, members, unreadCount] = await Promise.all([
      crewRepo.getById(crewId),
      crewRepo.getMembers(crewId),
      msgRepo.countUnread(agentId),
    ]);

    if (!crew || members.length === 0) return null;

    const memberInfos = await Promise.all(
      members.map(async (m) => {
        const soul = await soulsRepo.getByAgentId(m.agentId);
        return {
          agentId: m.agentId,
          name: soul?.identity.name ?? m.agentId,
          emoji: soul?.identity.emoji ?? '🤖',
          role: m.role,
          isCurrentAgent: m.agentId === agentId,
        };
      })
    );

    const ctx: CrewContextInfo = {
      crewId,
      crewName: crew.name,
      coordinationPattern: crew.coordinationPattern,
      members: memberInfos,
      unreadCount,
    };

    return buildCrewContextSection(ctx);
  } catch (err) {
    log.warn('Failed to build crew context for heartbeat', { agentId, crewId, error: String(err) });
    return null;
  }
}

// ============================================================
// Minimal Agent Engine (sends heartbeat prompt to the agent)
// ============================================================

function createHeartbeatAgentEngine(): IHeartbeatAgentEngine {
  return {
    async processMessage(request) {
      // Dynamic import to avoid circular dependencies
      const { getOrCreateChatAgent } = await import('../routes/agents.js');

      // Use provider/model from soul config (passed via context) when available,
      // otherwise fall back to system model routing.
      const ctxProvider = request.context?.provider as string | undefined;
      const ctxModel = request.context?.model as string | undefined;
      const ctxFallbackProvider = request.context?.fallbackProvider as string | undefined;
      const ctxFallbackModel = request.context?.fallbackModel as string | undefined;

      let provider: string;
      let model: string;
      let fallback: { provider: string; model: string } | undefined;

      if (ctxProvider && ctxModel) {
        provider = ctxProvider;
        model = ctxModel;
        fallback =
          ctxFallbackProvider && ctxFallbackModel
            ? { provider: ctxFallbackProvider, model: ctxFallbackModel }
            : undefined;
      } else {
        const { resolveForProcess } = await import('./model-routing.js');
        const resolved = await resolveForProcess('pulse');
        provider = ctxProvider ?? resolved.provider ?? 'anthropic';
        model = ctxModel ?? resolved.model ?? 'claude-sonnet-4-5-20250514';
        fallback =
          resolved.fallbackProvider && resolved.fallbackModel
            ? { provider: resolved.fallbackProvider, model: resolved.fallbackModel }
            : undefined;
      }

      const agent = await getOrCreateChatAgent(provider, model, fallback);

      // Inject crew context at the top of the task prompt when the soul is in a crew.
      const crewId = request.context?.crewId as string | undefined;
      let taskMessage = request.message;
      if (crewId) {
        log.info(`[Heartbeat ${request.agentId}] Injecting crew context (crew: ${crewId})`);
        const crewSection = await buildCrewContextForHeartbeat(request.agentId, crewId);
        if (crewSection) {
          taskMessage = `${crewSection}\n${taskMessage}`;
        }
      }

      // Claw mode (autonomy level 5) — bypass all tool restrictions
      const clawMode = request.context?.clawMode === true;

      // Enforce allowedTools (task-level) and skillAccess (soul-level) restrictions.
      const allowedTools = request.context?.allowedTools as string[] | undefined;
      const skillAccessAllowed = request.context?.skillAccessAllowed as string[] | undefined;
      const skillAccessBlocked = request.context?.skillAccessBlocked as string[] | undefined;

      const hasToolFilter = !clawMode && !!(
        allowedTools?.length ||
        skillAccessAllowed?.length ||
        skillAccessBlocked?.length
      );

      // Wrap agent.chat() in the heartbeat context so communication/crew tools
      // can resolve the correct soul agent ID via AsyncLocalStorage.
      const result = await runInHeartbeatContext({ agentId: request.agentId, crewId }, () =>
        agent.chat(taskMessage, {
          onBeforeToolCall: hasToolFilter
            ? async (toolCall) => {
                const name = toolCall.name;

                // 1. Blocked skill check — extensionId embedded in namespaced tool name (ext.{id}.{tool} / skill.{id}.{tool})
                if (skillAccessBlocked?.length) {
                  const isBlocked = skillAccessBlocked.some(
                    (id) => name.startsWith(`ext.${id}.`) || name.startsWith(`skill.${id}.`)
                  );
                  if (isBlocked) {
                    return {
                      approved: false,
                      reason: `Extension ${name} is blocked for this soul`,
                    };
                  }
                }

                // 2. Allowed skills check — if set, extension tools must belong to an allowed extension
                if (skillAccessAllowed?.length) {
                  const isExtTool = name.startsWith('ext.') || name.startsWith('skill.');
                  if (isExtTool) {
                    const isAllowed = skillAccessAllowed.some(
                      (id) => name.startsWith(`ext.${id}.`) || name.startsWith(`skill.${id}.`)
                    );
                    if (!isAllowed) {
                      return {
                        approved: false,
                        reason: `Extension ${name} not in soul's allowed skills`,
                      };
                    }
                  }
                }

                // 3. Task-level allowedTools check
                if (allowedTools?.length) {
                  const allowed = allowedTools.some((t) => name === t || name.endsWith(`.${t}`));
                  if (!allowed) {
                    return { approved: false, reason: `Tool ${name} not in task allowedTools` };
                  }
                }

                return { approved: true };
              }
            : undefined,
        })
      );

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

    // H4: Implemented — was missing, causing silent output loss for note-type tasks
    async createNote(note) {
      try {
        const { getServiceRegistry, Services } = await import('@ownpilot/core');
        const registry = getServiceRegistry();
        const memorySvc = registry.get(Services.Memory);
        await memorySvc.createMemory('system', {
          content: note.content,
          source: note.source,
          type: 'fact',
          tags: [note.category],
        });
      } catch (err) {
        log.warn('Failed to create heartbeat note', {
          category: note.category,
          error: String(err),
        });
      }
    },

    // M8: Use chatId when provided, not always 'default'
    async sendToChannel(channel, message, chatId) {
      try {
        const { sendTelegramMessage } = await import('../tools/notification-tools.js');
        if (channel === 'telegram') {
          await sendTelegramMessage(chatId ?? 'default', message);
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

// H5: Wire to real EventBus so soul.heartbeat.* events reach UI/WS subscribers
function createEventBusAdapter(): IHeartbeatEventBus {
  return {
    emit(event, payload) {
      try {
        getEventSystem().emit(event as never, 'soul-heartbeat', payload as never);
      } catch {
        // EventSystem may not be initialized in tests — fall through to log
      }
      log.info(`[HeartbeatEvent] ${event}`, payload as Record<string, unknown>);
    },
  };
}

// ============================================================
// Service Singleton
// ============================================================

let runner: HeartbeatRunner | null = null;
let communicationBusInstance: AgentCommunicationBus | null = null;

/**
 * M5: Reset the singleton — disposes the AgentCommunicationBus timer.
 * Call in server shutdown hooks and test teardown.
 */
export function resetHeartbeatRunner(): void {
  communicationBusInstance?.dispose();
  communicationBusInstance = null;
  runner = null;
}

export function getHeartbeatRunner(): HeartbeatRunner {
  if (!runner) {
    const soulRepo = createSoulRepoAdapter();
    const hbLogRepo = createHeartbeatLogRepoAdapter();
    const msgRepo = getAgentMessagesRepository();
    const db = getAdapterSync();

    communicationBusInstance = new AgentCommunicationBus(msgRepo, createEventBusAdapter());
    const budgetTracker = new BudgetTracker(db);
    const agentEngine = createHeartbeatAgentEngine();

    runner = new HeartbeatRunner(
      agentEngine,
      soulRepo,
      communicationBusInstance,
      hbLogRepo,
      budgetTracker,
      createEventBusAdapter()
    );
  }
  return runner;
}

/**
 * Returns the shared AgentCommunicationBus instance (initialises the runner
 * if not yet started). Used by crew-tools.ts for broadcast_to_crew.
 */
export function getCommunicationBus(): AgentCommunicationBus {
  getHeartbeatRunner(); // ensures communicationBusInstance is set
  return communicationBusInstance!;
}

/**
 * Run a heartbeat cycle for a specific agent.
 * Called by the trigger engine's 'run_heartbeat' action handler.
 */
export async function runAgentHeartbeat(
  agentId: string,
  force = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const hbRunner = getHeartbeatRunner();
    const result = await hbRunner.runHeartbeat(agentId, force);
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
