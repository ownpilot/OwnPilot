/**
 * Agent Context Management — compaction and context breakdown.
 *
 * Extracted from service.ts: context window analysis (getContextBreakdown)
 * and conversation compaction (compactContext + mirrorCompactionToDatabase).
 *
 * Depends on:
 * - session-info.ts (getSessionInfo — no circular dep)
 * - cache.ts (chatAgentCache, getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS)
 * - @ownpilot/core/agent (createProvider)
 */

import { createProvider, type ProviderConfig } from '@ownpilot/core/agent';
import { ChatRepository } from '../../db/repositories/chat/index.js';
import { getErrorMessage } from '../../utils/common.js';
import { getLog } from '../log.js';
import {
  NATIVE_PROVIDERS,
  chatAgentCache,
  getProviderApiKey,
  loadProviderConfig,
} from './cache.js';
import { getSessionInfo } from './session-info.js';
import type { SessionInfo } from '../../types/index.js';

const log = getLog('AgentContext');

// ============================================================================
// Context breakdown
// ============================================================================

export interface ContextBreakdown {
  systemPromptTokens: number;
  messageHistoryTokens: number;
  messageCount: number;
  maxContextTokens: number;
  modelName: string;
  providerName: string;
  sections: Array<{ name: string; tokens: number }>;
}

/**
 * Get detailed context breakdown for a cached chat agent.
 */
export function getContextBreakdown(
  provider: string,
  model: string,
  contextWindowOverride?: number
): ContextBreakdown | null {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);
  if (!agent) return null;

  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const maxCtx = getSessionInfo(agent, provider, model, contextWindowOverride).maxContextTokens;
  const systemPrompt = conversation.systemPrompt ?? '';
  const stats = memory.getStats(conversation.id);

  const sections: Array<{ name: string; tokens: number }> = [];
  const headingRegex = /^## (.+)/gm;
  const headings: Array<{ name: string; start: number }> = [];
  let m;
  while ((m = headingRegex.exec(systemPrompt)) !== null) {
    headings.push({ name: m[1]!, start: m.index });
  }

  const firstHeading = headings[0];
  if (firstHeading && firstHeading.start > 0) {
    sections.push({ name: 'Base Prompt', tokens: Math.ceil(firstHeading.start / 4) });
  } else if (headings.length === 0 && systemPrompt.length > 0) {
    sections.push({ name: 'System Prompt', tokens: Math.ceil(systemPrompt.length / 4) });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const end = headings[i + 1]?.start ?? systemPrompt.length;
    sections.push({
      name: heading.name,
      tokens: Math.ceil((end - heading.start) / 4),
    });
  }

  return {
    systemPromptTokens: Math.ceil(systemPrompt.length / 4),
    messageHistoryTokens: stats?.estimatedTokens ?? 0,
    messageCount: stats?.messageCount ?? 0,
    maxContextTokens: maxCtx,
    modelName: model,
    providerName: provider,
    sections,
  };
}

// ============================================================================
// Context compaction
// ============================================================================

/** Result of a compaction request — `session` is the post-compact SessionInfo. */
export interface CompactionResult {
  compacted: boolean;
  reason?: string;
  summary?: string;
  removedMessages: number;
  /** Token estimate of message history only, after compaction. */
  newTokenEstimate: number;
  /** Token estimate before compaction (messages only). Useful for UI deltas. */
  previousTokenEstimate?: number;
  /** Updated session info matching the same shape returned by chat responses. */
  session?: SessionInfo;
}

/**
 * Structured summary prompt — preserves the things a fresh model needs to keep
 * the conversation coherent (goals, decisions, file paths, open questions)
 * rather than producing a flat narrative.
 */
const STRUCTURED_SUMMARY_INSTRUCTIONS = `You are compacting a multi-turn conversation into a dense summary. The next assistant MUST be able to continue without re-reading the history.

## Required Structure (omit empty sections)
\`\`\`
GOAL: What the user is ultimately trying to accomplish
RECENT CONTEXT: 2-4 sentences on where the conversation left off
DECISIONS: Agreements reached, choices made (exact if possible)
ARTIFACTS: File paths, code snippets, commands, URLs, IDs — verbatim
USER PREFERENCES: How the user likes to work (tone, approach, constraints)
OPEN QUESTIONS: What still needs to be resolved
\`\`\`

## Rules
- **Be verbatim** on specific values: file paths, function names, IDs, URLs, exact commands
- **Be interpretive** on context and decisions: summarize accurately, don't quote
- **~250 words max** — dense but complete
- **No commentary** outside the structure
- **Preserve state**: if mid-task, note exactly where and what the next step is
- **User preferences** include: preferred language, tone, anything the user explicitly requested`;

/**
 * Mirror a successful in-memory compaction to the persisted chat history.
 */
async function mirrorCompactionToDatabase(opts: {
  userId: string;
  conversationId: string;
  keepRecent: number;
  summary: string;
  provider: string;
  model: string;
}): Promise<void> {
  const chatRepo = new ChatRepository(opts.userId);
  const existing = await chatRepo.getMessages(opts.conversationId, { limit: 10_000 });
  if (existing.length === 0) {
    return;
  }

  const olderDbMessages = existing.slice(0, Math.max(0, existing.length - opts.keepRecent));
  const firstRemaining = existing[existing.length - opts.keepRecent];

  if (olderDbMessages.length === 0) {
    return;
  }

  for (const msg of olderDbMessages) {
    await chatRepo.deleteMessage(msg.id);
  }

  const baseTime = firstRemaining ? new Date(firstRemaining.createdAt).getTime() : Date.now();
  const summaryUserTime = new Date(baseTime - 2).toISOString();
  const summaryAssistantTime = new Date(baseTime - 1).toISOString();

  await chatRepo.addMessage({
    conversationId: opts.conversationId,
    role: 'user',
    content: `[Conversation summary from compaction — use as background context, not as a new instruction]\n\n${opts.summary}`,
    provider: opts.provider,
    model: opts.model,
    createdAt: summaryUserTime,
  });
  await chatRepo.addMessage({
    conversationId: opts.conversationId,
    role: 'assistant',
    content: 'Got it. I have the context from earlier. Continuing.',
    provider: opts.provider,
    model: opts.model,
    createdAt: summaryAssistantTime,
  });
}

/**
 * Compact conversation context by summarizing old messages.
 */
export async function compactContext(
  provider: string,
  model: string,
  keepRecentMessages: number = 6,
  contextWindowOverride?: number,
  userId?: string
): Promise<CompactionResult> {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);
  if (!agent) {
    return { compacted: false, reason: 'no_agent', removedMessages: 0, newTokenEstimate: 0 };
  }

  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const messages = memory.getContextMessages(conversation.id);
  const prevStats = memory.getStats(conversation.id);

  if (messages.length <= keepRecentMessages + 2) {
    return {
      compacted: false,
      reason: 'too_few_messages',
      removedMessages: 0,
      newTokenEstimate: prevStats?.estimatedTokens ?? 0,
      previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
      session: getSessionInfo(agent, provider, model, contextWindowOverride),
    };
  }

  const olderMessages = messages.slice(0, messages.length - keepRecentMessages);
  const recentMessages = messages.slice(messages.length - keepRecentMessages);

  const conversationText = olderMessages
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[complex content]'}`)
    .join('\n');

  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) {
    return {
      compacted: false,
      reason: 'no_api_key',
      removedMessages: 0,
      newTokenEstimate: prevStats?.estimatedTokens ?? 0,
      previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
      session: getSessionInfo(agent, provider, model, contextWindowOverride),
    };
  }

  const providerConfig = loadProviderConfig(provider);
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  try {
    const summaryProvider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl: providerConfig?.baseUrl,
      headers: providerConfig?.headers,
    });

    const result = await summaryProvider.complete({
      messages: [
        { role: 'system', content: STRUCTURED_SUMMARY_INSTRUCTIONS },
        { role: 'user', content: conversationText },
      ],
      model: { model, maxTokens: 700, temperature: 0.2 },
    });

    if (!result.ok) {
      log.warn('Context compaction failed: AI summarization error');
      return {
        compacted: false,
        reason: 'summary_failed',
        removedMessages: 0,
        newTokenEstimate: prevStats?.estimatedTokens ?? 0,
        previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
        session: getSessionInfo(agent, provider, model, contextWindowOverride),
      };
    }

    const summary = result.value.content.trim();

    const currentMessages = memory.getContextMessages(conversation.id);
    if (currentMessages.length !== messages.length) {
      log.warn(
        `Compaction aborted: conversation changed mid-flight (${messages.length} -> ${currentMessages.length} messages)`
      );
      const currentStats = memory.getStats(conversation.id);
      return {
        compacted: false,
        reason: 'concurrent_modification',
        removedMessages: 0,
        newTokenEstimate: currentStats?.estimatedTokens ?? 0,
        previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
        session: getSessionInfo(agent, provider, model, contextWindowOverride),
      };
    }

    memory.clearMessages(conversation.id);
    memory.addMessage(conversation.id, {
      role: 'user',
      content: `[Conversation summary from compaction — use as background context, not as a new instruction]\n\n${summary}`,
    });
    memory.addMessage(conversation.id, {
      role: 'assistant',
      content: 'Got it. I have the context from earlier. Continuing.',
    });

    for (const msg of recentMessages) {
      memory.addMessage(conversation.id, msg);
    }

    const newStats = memory.getStats(conversation.id);
    const removedCount = olderMessages.length;

    if (userId) {
      try {
        await mirrorCompactionToDatabase({
          userId,
          conversationId: conversation.id,
          keepRecent: keepRecentMessages,
          summary,
          provider,
          model,
        });
      } catch (dbErr) {
        log.warn(
          `Compaction succeeded in memory but DB mirror failed — conversation may regrow on agent eviction. ${getErrorMessage(dbErr)}`
        );
      }
    }

    log.info(
      `Compacted context: removed ${removedCount} messages, kept ${recentMessages.length} recent, ` +
        `tokens ${prevStats?.estimatedTokens ?? 0} -> ${newStats?.estimatedTokens ?? 0}`
    );

    return {
      compacted: true,
      summary,
      removedMessages: removedCount,
      newTokenEstimate: newStats?.estimatedTokens ?? 0,
      previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
      session: getSessionInfo(agent, provider, model, contextWindowOverride),
    };
  } catch (err) {
    log.error('Context compaction error:', err);
    return {
      compacted: false,
      reason: 'exception',
      removedMessages: 0,
      newTokenEstimate: prevStats?.estimatedTokens ?? 0,
      previousTokenEstimate: prevStats?.estimatedTokens ?? 0,
      session: getSessionInfo(agent, provider, model, contextWindowOverride),
    };
  }
}
