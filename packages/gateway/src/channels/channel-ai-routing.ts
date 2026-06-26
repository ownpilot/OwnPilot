/**
 * Channel AI Routing
 *
 * AI message processing paths for channel messages:
 * - processViaBus:      MessageBus pipeline (primary path)
 * - processDirectAgent: Legacy direct agent.chat() fallback
 * - demoModeReply:      Demo mode response generator
 */

import { randomUUID } from 'node:crypto';
import { pricingByExactKey } from '@ownpilot/core/costs';
import type { ChannelIncomingMessage, ChannelPluginAPI } from '@ownpilot/core/channels';
import type { IMessageBus, NormalizedMessage } from '@ownpilot/core/services';
import type { ToolCall } from '@ownpilot/core/tools';
import type { StreamCallbacks } from '@ownpilot/core/services';
import type { ChannelSessionsRepository } from '../db/repositories/channels/sessions.js';
import { truncate } from '../utils/common.js';
import { stripInternalTags } from './normalizers/base.js';

/** Generate the standard demo-mode reply. */
function demoModeReply(text: string): string {
  return `[Demo Mode] I received your message: "${truncate(text, 100)}"\n\nTo get real AI responses, configure an API key in OwnPilot settings.`;
}

interface ApprovalChannelApi extends ChannelPluginAPI {
  requestApproval(
    chatId: string,
    params: { toolName: string; description: string; riskLevel?: string }
  ): Promise<boolean>;
}

function getApprovalApi(api: ChannelPluginAPI | undefined): ApprovalChannelApi | null {
  if (!api) return null;
  const requestApproval = (api as { requestApproval?: unknown }).requestApproval;
  return typeof requestApproval === 'function' ? (api as ApprovalChannelApi) : null;
}

/**
 * Process a channel message through the MessageBus pipeline.
 * Returns the assistant's response text.
 */
export async function processViaBus(
  bus: IMessageBus,
  message: ChannelIncomingMessage,
  session: {
    sessionId: string;
    conversationId: string | null;
    context?: Record<string, unknown>;
  },
  channelUser: { ownpilotUserId: string },
  deps: {
    sessionsRepo: ChannelSessionsRepository;
    getChannel: (id: string) => ChannelPluginAPI | undefined;
  },
  progress?: { update(text: string): void }
): Promise<string> {
  const { getOrCreateChatAgent, isDemoMode } = await import('../services/agent/service.js');
  const { resolveForChannel, inferProviderForModel } =
    await import('../services/llm/model-routing.js');

  // Demo mode short-circuit (bus isn't needed for demo)
  if (await isDemoMode()) {
    return demoModeReply(message.text);
  }

  const routing = await resolveForChannel(message.channelPluginId, {
    hasMedia: Boolean(message.attachments?.length),
  });

  // Per-session model override (e.g. Telegram's `/model gpt-4o`). When set it must
  // drive the agent that actually runs AND the cost/context metadata — resolving it
  // separately is what previously let `/model` change the reported model without
  // changing the executing one. A bare model name carries no provider, so infer the
  // owning provider, preferring the routed provider when it already serves the model.
  const preferredModel =
    ((session as { context?: Record<string, unknown> }).context?.preferredModel as
      | string
      | undefined) || undefined;
  const effectiveProvider = preferredModel
    ? (inferProviderForModel(preferredModel, routing.provider) ?? routing.provider ?? 'openai')
    : (routing.provider ?? 'openai');
  const effectiveModel = preferredModel ?? routing.model ?? 'gpt-4o';

  const fallback =
    routing.fallbackProvider && routing.fallbackModel
      ? { provider: routing.fallbackProvider, model: routing.fallbackModel }
      : undefined;
  const agent = await getOrCreateChatAgent(effectiveProvider, effectiveModel, fallback);

  // Load session conversation for context continuity
  let activeConversationId = session.conversationId;
  if (activeConversationId) {
    if (!agent.getMemory().has(activeConversationId)) {
      // Conversation lost (server restart, agent cache eviction) — create a new one
      const systemPrompt = agent.getConversation().systemPrompt;
      const newConv = agent.getMemory().create(systemPrompt);
      activeConversationId = newConv.id;

      // Persist to DB before updating the FK on channel_sessions
      const { createConversationsRepository } =
        await import('../db/repositories/chat/conversations.js');
      const conversationsRepo = createConversationsRepository();
      await conversationsRepo.create({
        id: activeConversationId,
        agentName: 'default',
        metadata: {
          source: 'channel',
          platform: message.platform,
          recoveredFrom: session.conversationId,
        },
      });

      // Now safe to update session FK
      await deps.sessionsRepo.linkConversation(session.sessionId, activeConversationId);
    }
    agent.loadConversation(activeConversationId);
  }

  // Wire tool approval via Telegram inline keyboard (if channel supports it)
  const telegramApi = getApprovalApi(deps.getChannel(message.channelPluginId));
  if (telegramApi) {
    agent.setRequestApproval(async (_category, _actionType, description, params) => {
      return telegramApi.requestApproval(message.platformChatId, {
        toolName: (params.toolName as string) ?? 'unknown',
        description,
        riskLevel: params.riskLevel as string | undefined,
      });
    });
  }

  // Normalize incoming message via channel normalizer
  const { getNormalizer } = await import('./normalizers/index.js');
  const channelNormalizer = getNormalizer(message.platform);
  const incoming = await channelNormalizer.normalizeIncoming(message);

  // Build NormalizedMessage from normalized incoming
  const normalized: NormalizedMessage = {
    id: message.id,
    sessionId: activeConversationId ?? randomUUID(),
    role: 'user',
    content: incoming.text,
    attachments: incoming.attachments,
    metadata: {
      source: 'channel',
      channelPluginId: message.channelPluginId,
      platform: message.platform,
      platformMessageId: message.metadata?.platformMessageId?.toString(),
      provider: effectiveProvider,
      model: effectiveModel,
      conversationId: activeConversationId ?? undefined,
      agentId: 'default',
    },
    timestamp: new Date(),
  };

  // Build stream callbacks for progress updates
  const streamCallbacks: StreamCallbacks | undefined = progress
    ? {
        onToolStart: (tc: ToolCall) => progress.update(`🔧 ${tc.name}...`),
        onToolEnd: (tc: ToolCall, _result: unknown) => progress.update(`✅ ${tc.name} done`),
        onProgress: (msg: string) => progress.update(`⚙️ ${msg}`),
      }
    : undefined;

  // Process through the pipeline with context
  // directToolMode: expose all tools directly to the LLM instead of meta-tool indirection
  // (simpler/local models used via Telegram don't understand use_tool() pattern)
  try {
    const result = await bus.process(normalized, {
      stream: streamCallbacks,
      context: {
        agent,
        userId: channelUser.ownpilotUserId,
        agentId: 'default',
        provider: effectiveProvider,
        model: effectiveModel,
        conversationId: activeConversationId,
        directToolMode: true,
      },
    });

    // Normalize outgoing response via channel normalizer
    // (strips internal tags, decodes entities, splits if needed — markdown→HTML is done by sender)
    const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
    const { content: stripped } = extractMemoriesFromResponse(result.response.content);
    const parts = channelNormalizer.normalizeOutgoing(stripped);
    let responseText = parts.join('\n\n');

    // Context saturation warning — append if input tokens exceed 80% of the
    // active model's actual context window. Uses pricingByExactKey directly
    // (NOT getModelPricing) because the latter falls back to "any model from
    // the same provider" which can return a 1M-window catalog entry for a
    // 128K-window request, hiding the warning when the user is actually
    // near the limit. Unknown models stay on a conservative 128K default.
    const inputTokens = result.response.metadata?.tokens?.input ?? 0;
    if (inputTokens > 0) {
      const pricing = pricingByExactKey.get(`${effectiveProvider}:${effectiveModel}`);
      const contextWindow = pricing?.contextWindow ?? 128_000;
      const fillPercent = Math.round((inputTokens / contextWindow) * 100);
      if (fillPercent >= 80) {
        responseText += `\n\n⚠️ Context is ${fillPercent}% full. Send /clear to start a fresh conversation.`;
      }
    }

    return responseText;
  } finally {
    // Always cleanup per-request overrides — even if bus.process() throws,
    // otherwise the Telegram approval handler leaks to subsequent non-channel requests
    agent.setRequestApproval(undefined);
  }
}

/**
 * Legacy fallback: process directly via agent.chat() without the bus.
 */
export async function processDirectAgent(message: ChannelIncomingMessage): Promise<string> {
  const { getOrCreateChatAgent, isDemoMode } = await import('../services/agent/service.js');
  const { resolveForChannel } = await import('../services/llm/model-routing.js');

  if (await isDemoMode()) {
    return demoModeReply(message.text);
  }

  const routing = await resolveForChannel(message.channelPluginId, {
    hasMedia: Boolean(message.attachments?.length),
  });
  const fallback =
    routing.fallbackProvider && routing.fallbackModel
      ? { provider: routing.fallbackProvider, model: routing.fallbackModel }
      : undefined;
  const agent = await getOrCreateChatAgent(
    routing.provider ?? 'openai',
    routing.model ?? 'gpt-4o',
    fallback
  );
  const result = await agent.chat(message.text);

  if (result.ok) {
    // Strip internal tags so channel users never see prompt-control markup.
    const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
    const { content: stripped } = extractMemoriesFromResponse(result.value.content);
    return stripInternalTags(stripped);
  }
  return `Sorry, I encountered an error: ${result.error.message}`;
}
