/**
 * Trigger action handlers — chat + the built-in gateway actions.
 *
 * Extracted from server.ts so the boot sequence only wires things up; the
 * handler logic lives with the trigger family and is testable on its own.
 * Registered once at startup via registerTriggerActionHandlers().
 *
 * All LLM resolution goes through the LLMRouter capability
 * (getLLMRouter().pick) — the per-process 'pulse' routing applies.
 */

import { randomUUID } from 'node:crypto';
import type { NormalizedMessage } from '@ownpilot/core';
import type { TriggerEngine } from './engine.js';
import { getErrorMessage } from '../utils/common.js';

/**
 * One-shot, tool-less LLM completion fn for a given user (in-memory
 * conversation — not persisted). Shared by the profile/memory handlers.
 */
function makeComplete(
  userId: string,
  label: string,
  systemPrompt: string
): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    const { createConfiguredAgent } = await import('../services/agent/runner-utils.js');
    const { getLLMRouter } = await import('@ownpilot/core');
    const { provider, model } = await getLLMRouter().pick({
      process: 'pulse',
      errorContext: label,
    });
    const agent = await createConfiguredAgent({
      name: label,
      provider,
      model,
      systemPrompt,
      userId,
      conversationId: `${label}-${Date.now()}`,
      toolFilter: [],
      maxTurns: 1,
      temperature: 0,
    });
    const res = await agent.chat(prompt);
    if (!res.ok) throw new Error(getErrorMessage(res.error, `${label} completion failed`));
    return res.value.content;
  };
}

/** Gather recent conversation text for a user (shared by profile/memory handlers). */
async function gatherConversationText(
  userId: string,
  limit: number,
  maxChars = 12000
): Promise<string> {
  const { ChatRepository } = await import('../db/repositories/chat/index.js');
  const chatRepo = new ChatRepository(userId);
  const recent = await chatRepo.getRecentConversations(limit);
  const parts: string[] = [];
  let total = 0;
  for (const conv of recent) {
    const messages = await chatRepo.getMessages(conv.id, { limit: 50 });
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const line = `${m.role}: ${m.content}`;
      if (total + line.length > maxChars) break;
      parts.push(line);
      total += line.length;
    }
    if (total >= maxChars) break;
  }
  return parts.join('\n');
}

/**
 * Wire the chat handler + built-in action handlers (workflow, run_heartbeat,
 * profile_learn, memory_extract, memory_consolidate) onto the trigger engine.
 */
export function registerTriggerActionHandlers(triggerEngine: TriggerEngine): void {
  // Chat handler — routes through the MessageBus pipeline so trigger-initiated
  // chats get context injection, persistence, audit logging, and post-processing.
  triggerEngine.setChatHandler(async (message, _payload) => {
    const { getOrCreateChatAgent } = await import('../services/agent/service.js');
    const { getLLMRouter } = await import('@ownpilot/core');
    const resolved = await getLLMRouter().pick({ process: 'pulse' });
    const provider = resolved.provider ?? 'openai';
    const model = resolved.model ?? 'gpt-4o-mini';
    const fallback =
      resolved.fallbackProvider && resolved.fallbackModel
        ? { provider: resolved.fallbackProvider, model: resolved.fallbackModel }
        : undefined;
    const agent = await getOrCreateChatAgent(provider, model, fallback);

    // Reset conversation for each trigger fire — prevents stale context from
    // previous executions causing "Empty conversation context" errors.
    agent.reset();

    const { getMessageBus } = await import('@ownpilot/core');
    const bus = getMessageBus();
    const conversationId = agent.getConversation().id;
    const normalized: NormalizedMessage = {
      id: randomUUID(),
      sessionId: conversationId,
      role: 'user',
      content: message,
      metadata: { source: 'scheduler', provider, model },
      timestamp: new Date(),
    };

    const result = await bus.process(normalized, {
      context: {
        agent,
        userId: 'default',
        agentId: 'chat',
        provider,
        model,
        conversationId,
      },
    });

    return {
      content: result.response.content,
      toolCalls: result.response.metadata?.toolCalls?.length ?? 0,
    };
  });

  // 'workflow' — run a workflow by id
  triggerEngine.registerActionHandler('workflow', async (payload) => {
    const { getWorkflowService } = await import('../services/workflow/index.js');
    const workflowId = payload.workflowId as string;
    if (!workflowId) return { success: false, error: 'Missing workflowId in payload' };
    const service = getWorkflowService();
    if (service.isRunning(workflowId)) return { success: false, error: 'Workflow already running' };
    try {
      const wfLog = await service.executeWorkflow(workflowId, 'default');
      return {
        success: wfLog.status === 'completed',
        message: `Workflow ${wfLog.status}`,
        data: { logId: wfLog.id, status: wfLog.status, durationMs: wfLog.durationMs },
        error: wfLog.error ?? undefined,
      };
    } catch (err) {
      return { success: false, error: getErrorMessage(err, 'Workflow execution failed') };
    }
  });

  // 'run_heartbeat' — Soul Heartbeat Runner
  triggerEngine.registerActionHandler('run_heartbeat', async (payload) => {
    const agentId = payload.agentId as string;
    if (!agentId) return { success: false, error: 'Missing agentId in payload' };
    const { runAgentHeartbeat } = await import('../services/heartbeat/soul-service.js');
    return await runAgentHeartbeat(agentId);
  });

  // 'profile_learn' — dialectic user-modeling loop. Reviews recent
  // conversations and writes inferred facts into the personal profile
  // (always source='ai_inferred', never overwriting user-stated data).
  triggerEngine.registerActionHandler('profile_learn', async (payload) => {
    const userId = (payload.userId as string) ?? 'default';
    const conversationLimit =
      typeof payload.conversations === 'number' ? Math.min(payload.conversations, 20) : 5;
    const conversationText = await gatherConversationText(userId, conversationLimit);

    const complete = makeComplete(
      userId,
      'profile_learn',
      'You extract durable user facts as a JSON array. Output only JSON.'
    );

    const { getPersonalMemoryStore, learnProfileFromText } = await import('@ownpilot/core');
    const store = await getPersonalMemoryStore(userId);
    const result = await learnProfileFromText(store, conversationText, complete);

    return {
      success: true,
      message: `Profile learn: +${result.created} new, ${result.updated} updated, ${result.skipped} skipped${result.reason ? ` (${result.reason})` : ''}`,
      data: result,
    };
  });

  const memoryAssistantPrompt =
    'You are a precise memory assistant. Follow the instructions exactly.';

  // 'memory_extract' — distill recent conversations into long-term memories.
  triggerEngine.registerActionHandler('memory_extract', async (payload) => {
    const userId = (payload.userId as string) ?? 'default';
    const limit =
      typeof payload.conversations === 'number' ? Math.min(payload.conversations, 20) : 5;
    const conversationText = await gatherConversationText(userId, limit);
    const { getMemoryEngine } = await import('../services/memory/engine.js');
    const result = await getMemoryEngine().extractFromConversations(
      userId,
      conversationText,
      makeComplete(userId, 'memory_extract', memoryAssistantPrompt)
    );
    return {
      success: true,
      message: `Memory extract: ${result.created} new, ${result.deduplicated} deduplicated (of ${result.extracted})`,
      data: result,
    };
  });

  // 'memory_consolidate' — merge near-duplicate memories + decay/cleanup.
  triggerEngine.registerActionHandler('memory_consolidate', async (payload) => {
    const userId = (payload.userId as string) ?? 'default';
    const { getMemoryEngine } = await import('../services/memory/engine.js');
    const result = await getMemoryEngine().consolidate(
      userId,
      makeComplete(userId, 'memory_consolidate', memoryAssistantPrompt),
      {
        similarityThreshold:
          typeof payload.similarityThreshold === 'number' ? payload.similarityThreshold : undefined,
      }
    );
    return {
      success: true,
      message: `Memory consolidate: merged ${result.merged} cluster(s), removed ${result.removed}, decayed ${result.decayed}, cleaned ${result.cleaned}`,
      data: result,
    };
  });
}
