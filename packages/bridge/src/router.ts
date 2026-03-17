/**
 * Message Router
 *
 * Routes incoming messages to Claude Code sessions with appropriate
 * GSD context injection and conversation management.
 */

import { randomUUID } from 'node:crypto';
import { claudeManager } from './claude-manager.ts';
import { getGSDContext } from './gsd-adapter.ts';
import { matchPatterns, isBlocking, hasStructuredOutput } from './pattern-matcher.ts';
import { config } from './config.ts';
import { logger } from './utils/logger.ts';
import type { ChatCompletionRequest, StreamChunk, PendingApproval } from './types.ts';
import { fireBlockingWebhooks } from './webhook-sender.ts';
import { eventBus } from './event-bus.ts';
import { tryInterceptCommand } from './commands/index.ts';
import type { CommandContext } from './commands/index.ts';
import { resolveIntent } from './commands/intent-adapter.ts';
import { resolveLLMIntent } from './commands/llm-router.ts';

export interface RouteOptions {
  conversationId?: string;
  projectDir?: string;
  sessionId?: string;
  /** WORK-04: Request worktree isolation for this session spawn */
  worktree?: boolean;
  /** WORK-04: Optional name for the worktree branch */
  worktreeName?: string;
  /** Orchestrator isolation — from X-Orchestrator-Id header (ORC-ISO-01) */
  orchestratorId?: string;
}

export interface RouteResult {
  conversationId: string;
  sessionId: string;
  stream: AsyncGenerator<StreamChunk>;
}

/**
 * Route a chat completion request to the appropriate Claude Code session.
 * Handles GSD intent detection and system prompt injection.
 */
export async function routeMessage(
  request: ChatCompletionRequest,
  options: RouteOptions = {},
): Promise<RouteResult> {
  // Extract conversation ID from metadata, options, or generate new one
  const conversationId =
    options.conversationId ??
    request.metadata?.conversation_id ??
    randomUUID();

  const projectDir =
    options.projectDir ??
    request.metadata?.project_dir ??
    config.defaultProjectDir;

  const log = logger.child({ conversationId });

  // Extract the last user message
  const lastUserMessage = [...request.messages]
    .reverse()
    .find((m) => m.role === 'user');

  if (!lastUserMessage) {
    log.warn('No user message found in request');
    async function* emptyStream(): AsyncGenerator<StreamChunk> {
      yield { type: 'error', error: 'No user message in request' };
    }
    return {
      conversationId,
      sessionId: '',
      stream: emptyStream(),
    };
  }

  const userMessage = typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content
    : Array.isArray(lastUserMessage.content)
      ? lastUserMessage.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text ?? '')
          .join('\n')
      : String(lastUserMessage.content ?? '');
  log.debug({ messagePreview: userMessage.slice(0, 100) }, 'Routing message');

  // Shared command context (reused for slash + intent routing)
  const commandCtx: CommandContext = {
    conversationId,
    projectDir,
    sessionInfo: claudeManager.getSession(conversationId),
    setConfigOverrides: (o) => claudeManager.setConfigOverrides(conversationId, o),
    getConfigOverrides: () => claudeManager.getConfigOverrides(conversationId),
    terminate: () => claudeManager.terminate(conversationId),
    setDisplayName: (n) => claudeManager.setDisplayName(conversationId, n),
    getDisplayName: () => claudeManager.getDisplayName(conversationId),
    listDiskSessions: (pd) => claudeManager.listDiskSessions(pd),
    getSessionJsonlPath: () => claudeManager.getSessionJsonlPath(conversationId),
  };

  try {
    // Command interceptor: handle bridge-side slash commands before CC spawn
    const commandStream = await tryInterceptCommand(userMessage, commandCtx);
    if (commandStream) {
      return {
        conversationId,
        sessionId: claudeManager.getSession(conversationId)?.sessionId ?? '',
        stream: commandStream,
      };
    }

    // Intent routing: natural language → slash command (TR + EN)
    // Runs after slash command check; resolved command re-enters the registry.
    // If intent maps to a CC-delegated command (e.g. /compact), intentStream
    // will be null and the message falls through to CC naturally.
    const intentCommand = resolveIntent(userMessage);
    if (intentCommand) {
      const intentStream = await tryInterceptCommand(intentCommand, commandCtx);
      if (intentStream) {
        log.info({ intentCommand, messagePreview: userMessage.slice(0, 60) }, 'Intent resolved');
        return {
          conversationId,
          sessionId: claudeManager.getSession(conversationId)?.sessionId ?? '',
          stream: intentStream,
        };
      }
    }

    // Faz 3: LLM fallback routing — handles paraphrased / ambiguous bridge commands.
    // Only runs when regex intent routing returned null and Minimax key is configured.
    // Fast-fails with bypass guards (>80 chars, circuit breaker) to keep latency low.
    if (!intentCommand && config.minimaxApiKey) {
      const llmResult = await resolveLLMIntent(userMessage);
      if (llmResult.command) {
        const llmStream = await tryInterceptCommand(llmResult.command, commandCtx);
        if (llmStream) {
          log.info(
            { command: llmResult.command, confidence: llmResult.confidence, fromLLM: true },
            'LLM intent resolved',
          );
          return {
            conversationId,
            sessionId: claudeManager.getSession(conversationId)?.sessionId ?? '',
            stream: llmStream,
          };
        }
      }
    }

    // Detect GSD intent and build system prompt
    let systemPrompt: string | undefined;
    try {
      const gsdContext = await getGSDContext(userMessage, projectDir);
      systemPrompt = gsdContext.fullSystemPrompt;
      log.info({ command: gsdContext.command, messagePreview: userMessage.slice(0, 60) }, 'GSD intent detected');
    } catch (err) {
      log.warn({ err }, 'Failed to build GSD context — continuing without it');
    }

    // Ensure session exists
    // sessionId override allows callers to resume an existing CC disk session
    const sessionInfo = await claudeManager.getOrCreate(conversationId, {
      projectDir,
      sessionId: options.sessionId ?? request.metadata?.session_id,
      systemPrompt,
      model: request.model ?? config.claudeModel,
      orchestratorId: options.orchestratorId,
    });

    log.info({ sessionId: sessionInfo.sessionId }, 'Session ready');

    // Create the stream
    const stream = sendWithPatternDetection(
      conversationId,
      userMessage,
      projectDir,
      systemPrompt,
      log,
      { worktree: options.worktree, worktreeName: options.worktreeName },
    );

    return {
      conversationId,
      sessionId: sessionInfo.sessionId,
      stream,
    };
  } catch (err) {
    log.error({ err }, 'Unhandled error in routeMessage');
    async function* errorStream(): AsyncGenerator<StreamChunk> {
      yield { type: 'error', error: `Internal routing error: ${err instanceof Error ? err.message : String(err)}` };
    }
    return {
      conversationId,
      sessionId: '',
      stream: errorStream(),
    };
  }
}

/**
 * Send message and post-process the response stream for pattern detection.
 */
async function* sendWithPatternDetection(
  conversationId: string,
  message: string,
  projectDir: string,
  systemPrompt: string | undefined,
  log: ReturnType<typeof logger.child>,
  worktreeOptions?: { worktree?: boolean; worktreeName?: string },
): AsyncGenerator<StreamChunk> {
  const collectedText: string[] = [];

  for await (const chunk of claudeManager.send(
    conversationId,
    message,
    projectDir,
    systemPrompt,
    worktreeOptions,
  )) {
    if (chunk.type === 'text') {
      collectedText.push(chunk.text);
    }
    yield chunk;
  }

  // After stream completes, check for structured patterns.
  // B4: skip if processInteractiveOutput() already ran detection (interactive path).
  // Only runs for SDK path (USE_SDK_SESSION=true) or future non-interactive paths.
  const fullText = collectedText.join('');
  if (!claudeManager.wasPatternDetected(conversationId) && hasStructuredOutput(fullText)) {
    const patterns = matchPatterns(fullText);
    log.info(
      { patterns: patterns.map((p) => ({ key: p.key, value: p.value.slice(0, 80) })) },
      'Structured output patterns detected',
    );

    // Emit phase_complete event to EventBus
    const phasePattern = patterns.find((p) => p.key === 'PHASE_COMPLETE');
    if (phasePattern) {
      const session = claudeManager.getSession(conversationId);
      if (session) {
        eventBus.emit('session.phase_complete', {
          type: 'session.phase_complete',
          conversationId,
          sessionId: session.sessionId,
          pattern: 'PHASE_COMPLETE',
          text: phasePattern.value,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Set pendingApproval if blocking pattern detected, then fire webhooks + EventBus
    if (isBlocking(fullText)) {
      const blockingPattern = patterns.find((p) => p.key === 'QUESTION' || p.key === 'TASK_BLOCKED');
      if (blockingPattern) {
        const approval: PendingApproval = {
          pattern: blockingPattern.key as 'QUESTION' | 'TASK_BLOCKED',
          text: blockingPattern.value,
          detectedAt: Date.now(),
        };
        claudeManager.setPendingApproval(
          conversationId,
          approval.pattern,
          approval.text,
        );

        // Emit blocking event to EventBus for SSE clients
        const session = claudeManager.getSession(conversationId);
        if (session) {
          const bridgeBaseUrl = `http://localhost:${config.port}`;

          eventBus.emit('session.blocking', {
            type: 'session.blocking',
            conversationId,
            sessionId: session.sessionId,
            pattern: approval.pattern,
            text: approval.text,
            respondUrl: `${bridgeBaseUrl}/v1/sessions/${session.sessionId}/input`,
            timestamp: new Date().toISOString(),
          });

          // Fire webhooks (fire-and-forget — never blocks the stream)
          fireBlockingWebhooks(conversationId, session.sessionId, approval, bridgeBaseUrl);
        }
      }
    }
  }
}
