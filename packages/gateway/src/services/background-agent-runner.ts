/**
 * Background Agent Runner
 *
 * Executes a single cycle of a background agent:
 * 1. Resolve AI provider/model (from config or system model routing)
 * 2. Create Agent instance with FULL tool access (same as chat agents)
 * 3. Build enhanced system prompt with mission + memories + goals
 * 4. Run agent.chat() for one cycle
 * 5. Extract results
 *
 * The runner does NOT own scheduling — that's the manager's job.
 *
 * Full tool registration pipeline (mirrors agent-service.ts createAgentFromRecord):
 * - Core tools (registerAllTools)
 * - Gateway domain tools (memory, goals, custom data, triggers, etc.)
 * - Dynamic tools (custom tools, CRUD meta-tools)
 * - Plugin tools
 * - Extension/Skill tools
 * - MCP tools
 */

import { Agent, ToolRegistry, registerAllTools, getErrorMessage } from '@ownpilot/core';
import type {
  AIProvider,
  BackgroundAgentConfig,
  BackgroundAgentSession,
  BackgroundAgentCycleResult,
  BackgroundAgentToolCall,
  ToolCall,
  ToolId,
} from '@ownpilot/core';
import { getLog } from './log.js';
import { resolveForProcess } from './model-routing.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import {
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} from '../routes/agent-tools.js';
import { gatewayConfigCenter } from './config-center-impl.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';
import { buildEnhancedSystemPrompt } from '../assistant/orchestrator.js';

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
      // 1. Resolve AI provider/model (config override or system model routing)
      let provider: string;
      let model: string;
      if (this.config.provider && this.config.model) {
        provider = this.config.provider;
        model = this.config.model;
      } else {
        const resolved = await resolveForProcess('pulse');
        provider = this.config.provider ?? resolved.provider ?? 'openai';
        model = this.config.model ?? resolved.model ?? 'gpt-4o-mini';
      }

      // 2. Create agent with full tool access
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

    const userId = this.config.userId;
    const conversationId = `bg-${this.config.id}`;

    // Create a fresh ToolRegistry with ALL tool sources (same as chat agents)
    const tools = new ToolRegistry();

    // 1. Core tools (built-in utilities, file, code, web, etc.)
    registerAllTools(tools);
    tools.setConfigCenter(gatewayConfigCenter);

    // 2. Gateway domain tools (memory, goals, custom data, triggers, plans, etc.)
    registerGatewayTools(tools, userId, false);

    // 3. Dynamic tools (custom tools, CRUD meta-tools, user-created tools)
    try {
      await registerDynamicTools(tools, userId, conversationId, false);
    } catch (err) {
      log.debug(`[${this.config.id}] Dynamic tools registration failed: ${getErrorMessage(err)}`);
    }

    // 4. Plugin tools
    try {
      registerPluginTools(tools, false);
    } catch (err) {
      log.debug(`[${this.config.id}] Plugin tools registration failed: ${getErrorMessage(err)}`);
    }

    // 5. Extension/Skill tools
    try {
      registerExtensionTools(tools, userId, false);
    } catch (err) {
      log.debug(`[${this.config.id}] Extension tools registration failed: ${getErrorMessage(err)}`);
    }

    // 6. MCP tools (external MCP servers)
    try {
      registerMcpTools(tools, false);
    } catch (err) {
      log.debug(`[${this.config.id}] MCP tools registration failed: ${getErrorMessage(err)}`);
    }

    // Build enhanced system prompt with memories + goals injected
    const basePrompt = this.buildSystemPrompt();
    let systemPrompt = basePrompt;
    try {
      const enhanced = await buildEnhancedSystemPrompt(basePrompt, {
        userId,
        maxMemories: 10,
        maxGoals: 5,
      });
      systemPrompt = enhanced.prompt;
    } catch (err) {
      log.debug(
        `[${this.config.id}] Enhanced prompt build failed, using base: ${getErrorMessage(err)}`
      );
    }

    // Use allowedTools filter if configured
    const toolFilter =
      this.config.allowedTools.length > 0
        ? this.config.allowedTools.map((t) => t as ToolId)
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
    const parts: string[] = [];

    parts.push(`You are a persistent background agent named "${this.config.name}".`);
    parts.push(
      'You run autonomously in cycles, working toward your mission without human intervention.'
    );
    parts.push('');
    parts.push('## Your Mission');
    parts.push(this.config.mission);
    parts.push('');
    parts.push('## Execution Rules');
    parts.push('1. Each cycle, you receive context updates and should make meaningful progress.');
    parts.push('2. Use tools strategically — plan your approach before acting.');
    parts.push('3. Store important findings in memory tools for future cycles.');
    parts.push('4. When your mission is fully complete, respond with "MISSION_COMPLETE".');
    parts.push('5. Keep responses concise — focus on actions and results.');
    parts.push(
      '6. You have access to ALL system tools: memories, goals, custom data, triggers, extensions, plugins, MCP, and more.'
    );
    parts.push('7. Be efficient — only call tools when needed, batch operations when possible.');

    if (this.config.stopCondition) {
      parts.push(`8. Stop condition: ${this.config.stopCondition}`);
    }

    return parts.join('\n');
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
