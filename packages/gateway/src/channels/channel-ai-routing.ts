/**
 * Channel AI Routing
 *
 * AI message processing paths for channel messages:
 * - processViaBus:      MessageBus pipeline (primary path)
 * - processDirectAgent: Legacy direct agent.chat() fallback
 * - demoModeReply:      Demo mode response generator
 */

import { randomUUID } from 'node:crypto';
import type {
  ChannelIncomingMessage,
  ChannelPluginAPI,
  IMessageBus,
  NormalizedMessage,
  StreamCallbacks,
  ToolCall,
} from '@ownpilot/core';
import type { ChannelSessionsRepository } from '../db/repositories/channel-sessions.js';
import { truncate } from '../routes/helpers.js';

/** Generate the standard demo-mode reply. */
export function demoModeReply(text: string): string {
  return `[Demo Mode] I received your message: "${truncate(text, 100)}"\n\nTo get real AI responses, configure an API key in OwnPilot settings.`;
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
  const { getOrCreateChatAgent, isDemoMode } = await import('../routes/agents.js');
  const { resolveForProcess } = await import('../services/model-routing.js');

  // Demo mode short-circuit (bus isn't needed for demo)
  if (await isDemoMode()) {
    return demoModeReply(message.text);
  }

  const routing = await resolveForProcess('channel');
  const fallback =
    routing.fallbackProvider && routing.fallbackModel
      ? { provider: routing.fallbackProvider, model: routing.fallbackModel }
      : undefined;
  const agent = await getOrCreateChatAgent(
    routing.provider ?? 'openai',
    routing.model ?? 'gpt-4o',
    fallback
  );

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
        await import('../db/repositories/conversations.js');
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
  const api = deps.getChannel(message.channelPluginId);
  if (api && typeof (api as unknown as Record<string, unknown>).requestApproval === 'function') {
    const telegramApi = api as typeof api & {
      requestApproval(
        chatId: string,
        params: { toolName: string; description: string; riskLevel?: string }
      ): Promise<boolean>;
    };
    agent.setRequestApproval(async (_category, _actionType, description, params) => {
      return telegramApi.requestApproval(message.platformChatId, {
        toolName: (params.toolName as string) ?? 'unknown',
        description,
        riskLevel: params.riskLevel as string | undefined,
      });
    });
  }

  // Check session for preferred model override
  const preferredModel = (session as { context?: Record<string, unknown> }).context
    ?.preferredModel as string | undefined;

  // Resolve provider/model from agent config (or session override)
  const { resolveProviderAndModel } = await import('../routes/settings.js');
  const resolved = await resolveProviderAndModel('default', preferredModel ?? 'default');

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
      provider: resolved.provider ?? undefined,
      model: resolved.model ?? undefined,
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
        provider: resolved.provider ?? 'unknown',
        model: resolved.model ?? 'unknown',
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

    // Context saturation warning — append if input tokens exceed 80% of context window
    const inputTokens = result.response.metadata?.tokens?.input ?? 0;
    if (inputTokens > 0) {
      const contextWindow = 128000;
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
  const { getOrCreateChatAgent, isDemoMode } = await import('../routes/agents.js');
  const { resolveForProcess } = await import('../services/model-routing.js');

  if (await isDemoMode()) {
    return demoModeReply(message.text);
  }

  const routing = await resolveForProcess('channel');
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
    // Strip <memories> and <suggestions> tags from channel response
    const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
    const { content: stripped } = extractMemoriesFromResponse(result.value.content);
    return stripped.replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '').trimEnd();
  }
  return `Sorry, I encountered an error: ${result.error.message}`;
}
