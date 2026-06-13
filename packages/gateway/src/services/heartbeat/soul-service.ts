/**
 * Soul Heartbeat Service
 *
 * Bridges the core HeartbeatRunner with gateway repositories and services.
 * Registers a 'run_heartbeat' action handler with the Trigger Engine.
 *
 * Architecture:
 * - `SoulHeartbeatService` is the canonical class — takes a RuntimeContext
 *   in its constructor (defaults to the process-wide singleton) so tests
 *   can swap individual capabilities without per-global mocking.
 * - Module-level exports (`getHeartbeatRunner`, `runAgentHeartbeat`, etc.)
 *   delegate to a process-default instance for backward compatibility.
 *
 * Crew orchestration:
 * - runInHeartbeatContext() wraps every agent.chat() call so communication
 *   tools (read_agent_inbox, send_agent_message, crew tools) resolve the
 *   correct soul agent ID instead of the generic human userId.
 * - Crew context (members, unread count, coordination pattern) is fetched
 *   on demand and prepended to each task prompt when the soul belongs to
 *   a crew. Results are cached per agent for short-lived re-use.
 */

import {
  HeartbeatRunner,
  AgentCommunicationBus,
  BudgetTracker,
  calculateCost,
  getRuntimeContext,
  runInExecContext,
} from '@ownpilot/core';
import type {
  AIProvider,
  HeartbeatToolCallRecord,
  IHeartbeatAgentEngine,
  IHeartbeatEventBus,
  ISoulRepository,
  IHeartbeatLogRepository,
  RuntimeContext,
} from '@ownpilot/core';
import { buildCrewContextSection } from '@ownpilot/core';
import type { CrewContextInfo } from '@ownpilot/core';
import { getAdapterSync } from '../../db/adapters/index.js';
import { getSoulsRepository } from '../../db/repositories/souls.js';
import { getHeartbeatLogRepository } from '../../db/repositories/heartbeats/log.js';
import { getAgentMessagesRepository } from '../../db/repositories/agents/messages.js';
import { getCrewsRepository } from '../../db/repositories/crew/index.js';
import { runInHeartbeatContext } from './context.js';
import { getSessionWorkspacePath } from '../../workspace/file-workspace.js';
import { getLog } from '@ownpilot/core/services';
import { HeartbeatCircuitBreaker } from '@ownpilot/core';
import { HeartbeatMetricsCollector } from '@ownpilot/core';
import type { BudgetForecaster } from '@ownpilot/core';
import { HEARTBEAT_CREW_CONTEXT_CACHE_TTL_MS } from '../../config/defaults.js';
import { TTLCache } from '../../utils/ttl-cache.js';

const log = getLog('SoulHeartbeatService');

const CREW_CONTEXT_CACHE_TTL_MS =
  parseInt(process.env.SOUL_CREW_CONTEXT_CACHE_TTL_MS ?? '', 10) ||
  HEARTBEAT_CREW_CONTEXT_CACHE_TTL_MS;

/** Bound the size of stored tool-call previews so heartbeat_log rows stay small. */
const TOOL_CALL_PREVIEW_MAX_CHARS = 500;

/** Max query-relevant memories injected per heartbeat task prompt. */
const HEARTBEAT_MEMORY_RECALL_LIMIT = 5;
/** Min task-prompt length before we bother with relevance recall. */
const HEARTBEAT_MEMORY_RECALL_MIN_CHARS = 8;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * Query the MemoryService for entries relevant to this heartbeat task and
 * render them as a markdown section to prepend to the prompt. Mirrors the
 * chat path's buildRelevantMemorySection so heartbeats with the opt-in flag
 * get the same auto-recall affordance. Returns '' on miss / error / no
 * MemoryService — never throws, never blocks the heartbeat.
 *
 * The first argument is the soul's `agentId`, which is what
 * `runtime.memory.createMemory(agentId, …)` uses as the scope key in
 * soul-service's saveMemory adapter — so a soul recalls its own memories,
 * not the human user's.
 */
async function buildRelevantMemorySection(agentId: string, taskPrompt: string): Promise<string> {
  const text = taskPrompt.trim();
  if (text.length < HEARTBEAT_MEMORY_RECALL_MIN_CHARS) return '';
  const { hasMemoryService, getMemoryService } = await import('@ownpilot/core');
  if (!hasMemoryService()) return '';

  try {
    const hits = await getMemoryService().hybridSearch(agentId, text, {
      limit: HEARTBEAT_MEMORY_RECALL_LIMIT,
    });
    if (hits.length === 0) return '';

    const lines: string[] = [];
    for (const m of hits) {
      const content = m.content.trim();
      if (!content) continue;
      lines.push(`- ${content}`);
    }
    if (lines.length === 0) return '';

    return `## Relevant memories (from recall)\n${lines.join('\n')}`;
  } catch (err) {
    log.debug('Heartbeat memory recall failed (non-fatal)', { agentId, error: String(err) });
    return '';
  }
}

/**
 * Build a lean record from a raw tool call + result for persistence on the
 * heartbeat log. Args are truncated; tool output bodies are intentionally
 * dropped (only the error preview is kept when the call failed) so storage
 * stays bounded even when an agent makes many large tool calls.
 */
function buildToolCallRecord(
  toolCall: { name: string; arguments: string },
  toolResult: { content: string; isError: boolean; durationMs: number }
): HeartbeatToolCallRecord {
  const record: HeartbeatToolCallRecord = {
    tool: toolCall.name,
    durationMs: toolResult.durationMs,
    success: !toolResult.isError,
  };
  if (toolCall.arguments) {
    record.argsPreview = truncate(toolCall.arguments, TOOL_CALL_PREVIEW_MAX_CHARS);
  }
  if (toolResult.isError && toolResult.content) {
    record.errorPreview = truncate(toolResult.content, TOOL_CALL_PREVIEW_MAX_CHARS);
  }
  return record;
}

// ============================================================================
// Gateway repository adapters
// ============================================================================

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

function createHeartbeatLogRepoAdapter(): IHeartbeatLogRepository {
  const repo = getHeartbeatLogRepository();
  return {
    getRecent: (agentId, limit) => repo.getRecent(agentId, limit),
    getLatest: (agentId) => repo.getLatest(agentId),
    create: (entry) => repo.create(entry),
  };
}

// ============================================================================
// SoulHeartbeatService — class form (takes RuntimeContext explicitly)
// ============================================================================

export class SoulHeartbeatService {
  private runner: HeartbeatRunner | null = null;
  private communicationBus: AgentCommunicationBus | null = null;
  private circuitBreaker: HeartbeatCircuitBreaker | null = null;
  private metricsCollector: HeartbeatMetricsCollector | null = null;
  private readonly budgetForecasters = new Map<string, BudgetForecaster>();
  private readonly crewContextCache: TTLCache<string, string | null>;
  private readonly runtimeOverride: RuntimeContext | null;

  /**
   * Capabilities resolved on demand. Construction stays cheap and does not
   * require the runtime context to be fully wired — that's only needed when
   * a heartbeat cycle actually runs. Tests can pass an explicit context to
   * pin every capability without touching globals.
   */
  private get runtime(): RuntimeContext {
    return this.runtimeOverride ?? getRuntimeContext();
  }

  constructor(runtime: RuntimeContext | null = null) {
    this.runtimeOverride = runtime;
    this.crewContextCache = new TTLCache<string, string | null>({
      defaultTtlMs: CREW_CONTEXT_CACHE_TTL_MS,
    });
  }

  /**
   * Dispose the AgentCommunicationBus timer and clear cached state. Call in
   * shutdown hooks or test teardown.
   */
  reset(): void {
    this.communicationBus?.dispose();
    this.communicationBus = null;
    this.runner = null;
    this.circuitBreaker = null;
    this.metricsCollector = null;
    this.budgetForecasters.clear();
  }

  /** Lazily build (and cache) the HeartbeatRunner. */
  getRunner(): HeartbeatRunner {
    if (!this.runner) {
      const soulRepo = createSoulRepoAdapter();
      const hbLogRepo = createHeartbeatLogRepoAdapter();
      const msgRepo = getAgentMessagesRepository();
      const db = getAdapterSync();

      this.communicationBus = new AgentCommunicationBus(msgRepo, this.createEventBusAdapter());
      const budgetTracker = new BudgetTracker(db);
      const agentEngine = this.createAgentEngine();

      this.circuitBreaker = new HeartbeatCircuitBreaker({
        failureThreshold: 3,
        cooldownMs: 60_000,
      });
      this.metricsCollector = new HeartbeatMetricsCollector({
        rollingWindowSize: 10,
      });

      this.runner = new HeartbeatRunner(
        agentEngine,
        soulRepo,
        this.communicationBus,
        hbLogRepo,
        budgetTracker,
        this.createEventBusAdapter(),
        this.circuitBreaker,
        this.metricsCollector
      );
    }
    return this.runner;
  }

  /**
   * The shared AgentCommunicationBus instance. Initialises the runner on
   * first call. Used by crew-tools.ts for broadcast_to_crew.
   */
  getCommunicationBus(): AgentCommunicationBus {
    this.getRunner();
    if (!this.communicationBus) {
      throw new Error('AgentCommunicationBus not initialized — heartbeat runner failed to start');
    }
    return this.communicationBus;
  }

  /**
   * Run a heartbeat cycle for a specific agent. Called by the trigger
   * engine's 'run_heartbeat' action handler.
   */
  async runHeartbeat(
    agentId: string,
    force = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.getRunner().runHeartbeat(agentId, force);
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

  // ---------------------------------------------------------------------------
  // Crew context (membership + unread count) injected into task prompts
  // ---------------------------------------------------------------------------

  private async buildCrewContext(agentId: string, crewId: string): Promise<string | null> {
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
      log.warn('Failed to build crew context for heartbeat', {
        agentId,
        crewId,
        error: String(err),
      });
      return null;
    }
  }

  private async getCachedCrewContext(agentId: string, crewId: string): Promise<string | null> {
    const cacheKey = `${agentId}:${crewId}`;
    const cached = this.crewContextCache.get(cacheKey);
    if (cached !== null) return cached;
    const value = await this.buildCrewContext(agentId, crewId);
    // Cache null as empty string to avoid repeated DB lookups for solo agents
    this.crewContextCache.set(cacheKey, value ?? '');
    return value;
  }

  // ---------------------------------------------------------------------------
  // Agent engine — sends each heartbeat task prompt to the LLM
  // ---------------------------------------------------------------------------

  private createAgentEngine(): IHeartbeatAgentEngine {
    const runtime = this.runtime;
    const getCachedCrewContext = (agentId: string, crewId: string) =>
      this.getCachedCrewContext(agentId, crewId);

    return {
      async processMessage(request) {
        // Dynamic import to avoid circular dependencies
        const { getOrCreateChatAgent } = await import('../agent/service.js');

        // Use provider/model from soul config (passed via context) when available,
        // otherwise resolve via the LLMRouter capability.
        const ctxProvider = request.context?.provider as string | undefined;
        const ctxModel = request.context?.model as string | undefined;
        const ctxFallbackProvider = request.context?.fallbackProvider as string | undefined;
        const ctxFallbackModel = request.context?.fallbackModel as string | undefined;

        const picked = await runtime.llm.pick({
          explicitProvider: ctxProvider,
          explicitModel: ctxModel,
          process: 'pulse',
          errorContext: 'soul heartbeat',
        });

        const provider = picked.provider || 'anthropic';
        const model = picked.model || 'claude-sonnet-4-5-20250514';

        const fallbackProvider = ctxFallbackProvider ?? picked.fallbackProvider;
        const fallbackModel = ctxFallbackModel ?? picked.fallbackModel;
        const fallback =
          fallbackProvider && fallbackModel
            ? { provider: fallbackProvider, model: fallbackModel }
            : undefined;

        const agent = await getOrCreateChatAgent(provider, model, fallback);

        // Inject crew context at the top of the task prompt when in a crew.
        const crewId = request.context?.crewId as string | undefined;
        let taskMessage = request.message;
        if (crewId) {
          log.info(`[Heartbeat ${request.agentId}] Injecting crew context (crew: ${crewId})`);
          const crewSection = await getCachedCrewContext(request.agentId, crewId);
          if (crewSection) {
            taskMessage = `${crewSection}\n${taskMessage}`;
          }
        }

        // Opt-in auto memory recall — mirrors the chat path's
        // context-injection middleware so heartbeats can leverage the same
        // hybrid (vector + FTS) recall instead of forcing every prompt to
        // call the recall_memory tool explicitly. Soft-fails on any error
        // so the heartbeat still runs without memories on a recall miss.
        const wantRecall = request.context?.injectRelevantMemories === true;
        if (wantRecall) {
          const memorySection = await buildRelevantMemorySection(request.agentId, request.message);
          if (memorySection) {
            taskMessage = `${memorySection}\n\n${taskMessage}`;
          }
        }

        // Claw mode (autonomy level 5) — bypass all tool restrictions
        const clawMode = request.context?.clawMode === true;

        // Enforce allowedTools (task-level) and skillAccess (soul-level) restrictions.
        const allowedTools = request.context?.allowedTools as string[] | undefined;
        const skillAccessAllowed = request.context?.skillAccessAllowed as string[] | undefined;
        const skillAccessBlocked = request.context?.skillAccessBlocked as string[] | undefined;

        const hasToolFilter =
          !clawMode &&
          !!(allowedTools?.length || skillAccessAllowed?.length || skillAccessBlocked?.length);

        // Tool authorization is delegated to the unified PermissionGate so
        // every runtime applies the same allow / deny logic.
        const gate = hasToolFilter ? runtime.permissions : null;

        // Per-call workspace scoping. Heartbeats share the cached chat agent
        // across souls, so we cannot setWorkspaceDir on its registry without
        // racing across concurrent souls. Instead we wrap each chat() call in
        // an ExecContext — ToolRegistry consults that AsyncLocalStorage as a
        // third-tier fallback for `context.workspaceDir`, so file-system
        // tools spawned by this heartbeat only see this soul's session dir.
        const taskWorkspaceId = request.context?.workspaceId as string | undefined;
        let workspaceDir: string | undefined;
        if (taskWorkspaceId) {
          try {
            workspaceDir = getSessionWorkspacePath(taskWorkspaceId);
          } catch (err) {
            log.warn(
              `[Heartbeat ${request.agentId}] Could not resolve workspaceId="${taskWorkspaceId}"; file tools will use process.cwd(): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        // Per-task tool-call audit trail. Heartbeat operators have no other
        // way to see which tools a soul actually invoked, so we record a
        // bounded preview per call and return it for persistence with the
        // heartbeat_log row.
        const toolCalls: HeartbeatToolCallRecord[] = [];

        const runChat = () =>
          runInHeartbeatContext({ agentId: request.agentId, crewId }, () =>
            agent.chat(taskMessage, {
              onBeforeToolCall: gate
                ? async (toolCall) => {
                    let parsedArgs: Record<string, unknown> | undefined;
                    if (toolCall.arguments) {
                      try {
                        parsedArgs = JSON.parse(toolCall.arguments) as Record<string, unknown>;
                      } catch {
                        parsedArgs = undefined;
                      }
                    }
                    const decision = await gate.check({
                      actorId: request.agentId,
                      tool: toolCall.name,
                      context: {
                        actorType: 'soul-heartbeat',
                        allowedTools,
                        skillAccessAllowed,
                        skillAccessBlocked,
                        args: parsedArgs,
                      },
                    });
                    if (decision.type === 'allow') {
                      return { approved: true };
                    }
                    return { approved: false, reason: decision.reason };
                  }
                : undefined,
              onToolEnd: (toolCall, toolResult) => {
                toolCalls.push(buildToolCallRecord(toolCall, toolResult));
              },
            })
          );

        const result = workspaceDir
          ? await runInExecContext({ workspaceDir }, runChat)
          : await runChat();

        if (!result.ok) {
          throw result.error;
        }

        const usage = result.value.usage;
        const cost = usage
          ? calculateCost(
              provider as AIProvider,
              model,
              usage.promptTokens ?? 0,
              usage.completionTokens ?? 0
            )
          : undefined;

        return {
          content: result.value.content,
          tokenUsage: usage
            ? { input: usage.promptTokens, output: usage.completionTokens }
            : undefined,
          cost,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      },

      async saveMemory(agentId, content, source) {
        try {
          await runtime.memory.createMemory(agentId, {
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
          await runtime.memory.createMemory('system', {
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
          const { sendTelegramMessage } = await import('../../tools/notification-tools.js');
          if (channel === 'telegram') {
            await sendTelegramMessage(chatId ?? 'default', message);
          } else {
            log.debug(`Channel ${channel} not supported for heartbeat output`);
          }
        } catch (err) {
          log.warn('Failed to send heartbeat output to channel', {
            channel,
            error: String(err),
          });
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Event bus adapter — bridges core IHeartbeatEventBus to the EventSystem
  // ---------------------------------------------------------------------------

  // H5: Wire to real EventBus so soul.heartbeat.* events reach UI/WS subscribers
  private createEventBusAdapter(): IHeartbeatEventBus {
    const runtime = this.runtime;
    return {
      emit(event, payload) {
        try {
          runtime.events.emit(event as never, 'soul-heartbeat', payload as never);
        } catch {
          // EventSystem may not be initialized in tests — fall through to log
        }
        log.info(`[HeartbeatEvent] ${event}`, payload as Record<string, unknown>);
      },
    };
  }
}

// ============================================================================
// Process-default instance + backward-compatible module-level exports
// ============================================================================

let _defaultInstance: SoulHeartbeatService | null = null;

function getDefaultInstance(): SoulHeartbeatService {
  if (!_defaultInstance) {
    _defaultInstance = new SoulHeartbeatService();
  }
  return _defaultInstance;
}

/**
 * Reset the default singleton — disposes the AgentCommunicationBus timer.
 * Call in server shutdown hooks and test teardown.
 */
export function resetHeartbeatRunner(): void {
  if (_defaultInstance) {
    _defaultInstance.reset();
    _defaultInstance = null;
  }
}

export function getHeartbeatRunner(): HeartbeatRunner {
  return getDefaultInstance().getRunner();
}

/**
 * Returns the shared AgentCommunicationBus instance (initialises the runner
 * if not yet started). Used by crew-tools.ts for broadcast_to_crew.
 */
export function getCommunicationBus(): AgentCommunicationBus {
  return getDefaultInstance().getCommunicationBus();
}

/**
 * Run a heartbeat cycle for a specific agent.
 * Called by the trigger engine's 'run_heartbeat' action handler.
 */
export async function runAgentHeartbeat(
  agentId: string,
  force = false
): Promise<{ success: boolean; error?: string }> {
  return getDefaultInstance().runHeartbeat(agentId, force);
}
