/**
 * Background Agent Runner
 *
 * Executes a single cycle of a background agent:
 * 1. Build system prompt (mission + persistent context + inbox)
 * 2. Create Agent instance with tools from shared registry
 * 3. Run agent.chat() for one cycle
 * 4. Extract results
 *
 * The runner does NOT own scheduling — that's the manager's job.
 */

import {
  Agent,
  ToolRegistry,
  registerAllTools,
  registerCoreTools,
  getErrorMessage,
} from '@ownpilot/core';
import type {
  AIProvider,
  BackgroundAgentConfig,
  BackgroundAgentSession,
  BackgroundAgentCycleResult,
  BackgroundAgentToolCall,
  ToolCall,
} from '@ownpilot/core';
import { getLog } from './log.js';
import { resolveForProcess } from './model-routing.js';
import {
  getProviderApiKey,
  loadProviderConfig,
  NATIVE_PROVIDERS,
} from '../routes/agent-cache.js';
import { registerGatewayTools } from '../routes/agent-tools.js';
import { gatewayConfigCenter } from './config-center-impl.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';

const log = getLog('BackgroundAgentRunner');

// ============================================================================
// Runner
// ============================================================================

export class BackgroundAgentRunner {
  private config: BackgroundAgentConfig;

  constructor(config: BackgroundAgentConfig) {
    this.config = config;
  }

  /** Update config (e.g. after DB update) */
  updateConfig(config: BackgroundAgentConfig): void {
    this.config = config;
  }

  /**
   * Execute a single cycle.
   * Returns the cycle result without modifying any external state.
   */
  async runCycle(session: BackgroundAgentSession): Promise<BackgroundAgentCycleResult> {
    const startTime = Date.now();
    const cycleNumber = session.cyclesCompleted + 1;

    log.info(`[${this.config.id}] Starting cycle ${cycleNumber}`);

    try {
      // 1. Resolve AI provider/model via model routing
      const resolved = await resolveForProcess('pulse');
      const provider = resolved.provider ?? 'openai';
      const model = resolved.model ?? 'gpt-4o-mini';

      // 2. Create agent with scoped tools
      const agent = await this.createAgent(provider, model);

      // 3. Build the cycle message
      const cycleMessage = this.buildCycleMessage(session, cycleNumber);

      // 4. Collect tool calls via callback
      const toolCalls: BackgroundAgentToolCall[] = [];
      const onToolEnd = (
        tc: ToolCall,
        result: { content: string; isError: boolean; durationMs: number }
      ) => {
        toolCalls.push({
          tool: tc.name,
          args: safeParseJson(tc.arguments),
          result: result.content,
          duration: result.durationMs,
        });
      };

      // 5. Execute agent.chat() with timeout
      const chatResult = await Promise.race([
        agent.chat(cycleMessage, { onToolEnd }),
        this.timeoutPromise(this.config.limits.cycleTimeoutMs),
      ]);

      const durationMs = Date.now() - startTime;

      // 6. Unwrap Result type
      if (!chatResult.ok) {
        throw new Error(chatResult.error?.message ?? 'Agent chat failed');
      }

      const response = chatResult.value;

      log.info(
        `[${this.config.id}] Cycle ${cycleNumber} completed: ${toolCalls.length} tool calls, ${durationMs}ms`
      );

      return {
        success: true,
        toolCalls,
        outputMessage: response.content ?? '',
        tokensUsed: response.usage
          ? {
              prompt: response.usage.promptTokens ?? 0,
              completion: response.usage.completionTokens ?? 0,
            }
          : undefined,
        durationMs,
        turns: 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);

      log.error(`[${this.config.id}] Cycle ${cycleNumber} failed: ${errorMsg}`);

      return {
        success: false,
        toolCalls: [],
        outputMessage: '',
        durationMs,
        turns: 0,
        error: errorMsg,
      };
    }
  }

  // ---------- Private Helpers ----------

  private async createAgent(provider: string, model: string): Promise<Agent> {
    const apiKey = await getProviderApiKey(provider);
    if (!apiKey) {
      throw new Error(`API key not configured for provider: ${provider}`);
    }

    const providerConfig = loadProviderConfig(provider);
    const baseUrl = providerConfig?.baseUrl;
    const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

    // Create a fresh ToolRegistry with core + gateway tools
    const tools = new ToolRegistry();
    registerAllTools(tools);
    registerCoreTools(tools);
    tools.setConfigCenter(gatewayConfigCenter);
    registerGatewayTools(tools, this.config.userId, false);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt();

    // Use allowedTools filter if configured
    const toolFilter =
      this.config.allowedTools.length > 0
        ? this.config.allowedTools.map((t) => t as import('@ownpilot/core').ToolId)
        : undefined;

    const agent = new Agent(
      {
        name: `bg-agent-${this.config.id}`,
        systemPrompt,
        provider: {
          provider: providerType as AIProvider,
          apiKey,
          baseUrl,
          headers: providerConfig?.headers,
        },
        model: {
          model,
          maxTokens: AGENT_DEFAULT_MAX_TOKENS,
          temperature: AGENT_DEFAULT_TEMPERATURE,
        },
        maxTurns: this.config.limits.maxTurnsPerCycle,
        maxToolCalls: this.config.limits.maxToolCallsPerCycle,
        tools: toolFilter,
      },
      { tools }
    );

    // Enable direct tool mode for background agents (no meta-tool indirection)
    agent.setDirectToolMode(true);

    return agent;
  }

  private buildSystemPrompt(): string {
    return `You are a background agent running autonomously. Your mission:

${this.config.mission}

## Execution Rules
1. You run in cycles. Each cycle you receive context updates and should make progress on your mission.
2. Use the available tools to accomplish your mission.
3. Be efficient — only use tools when needed.
4. If your mission is complete, clearly state "MISSION_COMPLETE" in your response.
5. Keep responses concise — focus on actions, not explanations.`;
  }

  private buildCycleMessage(session: BackgroundAgentSession, cycleNumber: number): string {
    const parts: string[] = [];

    parts.push(`--- Cycle ${cycleNumber} ---`);

    // Include persistent context if non-empty
    if (Object.keys(session.persistentContext).length > 0) {
      parts.push(
        `\n## Your Working Memory\n\`\`\`json\n${JSON.stringify(session.persistentContext, null, 2)}\n\`\`\``
      );
    }

    // Include inbox messages
    if (session.inbox.length > 0) {
      parts.push(`\n## Inbox Messages`);
      for (const msg of session.inbox) {
        parts.push(`- ${msg}`);
      }
    }

    // Stats
    parts.push(`\nCycles completed: ${session.cyclesCompleted}`);
    parts.push(`Total tool calls: ${session.totalToolCalls}`);

    if (this.config.stopCondition) {
      parts.push(`\nStop condition: ${this.config.stopCondition}`);
    }

    parts.push('\nContinue your mission. What actions will you take this cycle?');

    return parts.join('\n');
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Cycle timed out after ${ms}ms`)), ms)
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str || '{}');
  } catch {
    return { _raw: str };
  }
}
