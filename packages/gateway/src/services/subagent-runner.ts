/**
 * Subagent Runner
 *
 * Executes a single subagent task to completion:
 * 1. Resolve AI provider/model (from input or system model routing)
 * 2. Create Agent instance with scoped tool access
 * 3. Build task-oriented system prompt
 * 4. Run agent.chat() with task message
 * 5. Collect results and tool call traces
 *
 * Key difference from BackgroundAgentRunner:
 * - Single execution (not cyclic)
 * - Task-focused prompt (not mission-focused)
 * - Returns full result (not cycle result)
 * - Supports AbortController for cancellation
 *
 * Full tool registration pipeline (mirrors background-agent-runner.ts):
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
  SpawnSubagentInput,
  SubagentLimits,
  SubagentToolCall,
  ToolCall,
  ToolId,
} from '@ownpilot/core';
import { DEFAULT_SUBAGENT_LIMITS } from '@ownpilot/core';
import { getLog } from './log.js';
import { resolveForProcess } from './model-routing.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import {
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} from '../tools/agent-tool-registry.js';
import { gatewayConfigCenter } from './config-center-impl.js';
import { AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';

const log = getLog('SubagentRunner');

// ============================================================================
// Result Type
// ============================================================================

export interface SubagentExecutionResult {
  success: boolean;
  result: string;
  toolCalls: SubagentToolCall[];
  turnsUsed: number;
  toolCallsUsed: number;
  tokensUsed: { prompt: number; completion: number } | null;
  durationMs: number;
  error: string | null;
  provider: string;
  model: string;
}

// ============================================================================
// Runner
// ============================================================================

export class SubagentRunner {
  private input: SpawnSubagentInput;
  private limits: SubagentLimits;
  private abortController: AbortController;

  constructor(input: SpawnSubagentInput) {
    this.input = input;
    this.limits = {
      ...DEFAULT_SUBAGENT_LIMITS,
      ...input.limits,
    };
    this.abortController = new AbortController();
  }

  /**
   * Execute the subagent task. Returns when task is complete.
   */
  async run(
    onToolEnd?: (
      tc: ToolCall,
      result: { content: string; isError: boolean; durationMs: number }
    ) => void
  ): Promise<SubagentExecutionResult> {
    const startTime = Date.now();

    try {
      // Check for immediate cancellation
      if (this.abortController.signal.aborted) {
        return this.cancelledResult(Date.now() - startTime);
      }

      // 1. Resolve AI provider/model (input override or system model routing)
      let provider: string;
      let model: string;
      if (this.input.provider && this.input.model) {
        provider = this.input.provider;
        model = this.input.model;
      } else {
        const resolved = await resolveForProcess('subagent');
        provider = this.input.provider ?? resolved.provider ?? 'openai';
        model = this.input.model ?? resolved.model ?? 'gpt-4o-mini';
      }

      // 2. Create agent with full tool access
      const agent = await this.createAgent(provider, model);

      // 3. Build the task message
      const taskMessage = this.buildTaskMessage();

      // 4. Collect tool calls via callback
      const toolCalls: SubagentToolCall[] = [];
      const wrappedOnToolEnd = (
        tc: ToolCall,
        result: { content: string; isError: boolean; durationMs: number }
      ) => {
        toolCalls.push({
          tool: tc.name,
          args: safeParseJson(tc.arguments),
          result: result.content,
          success: !result.isError,
          durationMs: result.durationMs,
        });
        onToolEnd?.(tc, result);
      };

      // 5. Execute agent.chat() with timeout and cancellation
      const chatResult = await Promise.race([
        agent.chat(taskMessage, { onToolEnd: wrappedOnToolEnd }),
        this.timeoutPromise(this.limits.timeoutMs),
        this.cancellationPromise(),
      ]);

      const durationMs = Date.now() - startTime;

      // Check if cancelled during execution
      if (this.abortController.signal.aborted) {
        return this.cancelledResult(durationMs, toolCalls, provider, model);
      }

      // 6. Unwrap Result type
      if (!chatResult.ok) {
        throw new Error(chatResult.error?.message ?? 'Subagent execution failed');
      }

      const response = chatResult.value;

      log.info(
        `[subagent:${this.input.name}] Completed: ${toolCalls.length} tool calls, ${durationMs}ms`
      );

      return {
        success: true,
        result: response.content ?? '',
        toolCalls,
        turnsUsed: 1,
        toolCallsUsed: toolCalls.length,
        tokensUsed: response.usage
          ? {
              prompt: response.usage.promptTokens ?? 0,
              completion: response.usage.completionTokens ?? 0,
            }
          : null,
        durationMs,
        error: null,
        provider,
        model,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (this.abortController.signal.aborted) {
        return this.cancelledResult(durationMs);
      }

      const errorMsg = getErrorMessage(error);

      log.error(`[subagent:${this.input.name}] Failed: ${errorMsg}`);

      return {
        success: false,
        result: '',
        toolCalls: [],
        turnsUsed: 0,
        toolCallsUsed: 0,
        tokensUsed: null,
        durationMs,
        error: errorMsg,
        provider: this.input.provider ?? 'unknown',
        model: this.input.model ?? 'unknown',
      };
    }
  }

  /** Cancel execution */
  cancel(): void {
    this.abortController.abort();
  }

  /** Whether the runner has been cancelled */
  get cancelled(): boolean {
    return this.abortController.signal.aborted;
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

    const userId = this.input.userId;
    const conversationId = `subagent-${Date.now()}`;

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
      log.debug(
        `[subagent:${this.input.name}] Dynamic tools registration failed: ${getErrorMessage(err)}`
      );
    }

    // 4. Plugin tools
    try {
      registerPluginTools(tools, false);
    } catch (err) {
      log.debug(
        `[subagent:${this.input.name}] Plugin tools registration failed: ${getErrorMessage(err)}`
      );
    }

    // 5. Extension/Skill tools
    try {
      registerExtensionTools(tools, userId, false);
    } catch (err) {
      log.debug(
        `[subagent:${this.input.name}] Extension tools registration failed: ${getErrorMessage(err)}`
      );
    }

    // 6. MCP tools (external MCP servers)
    try {
      registerMcpTools(tools, false);
    } catch (err) {
      log.debug(
        `[subagent:${this.input.name}] MCP tools registration failed: ${getErrorMessage(err)}`
      );
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt();

    // Use allowedTools filter if configured
    const toolFilter =
      this.input.allowedTools && this.input.allowedTools.length > 0
        ? this.input.allowedTools.map((t) => t as ToolId)
        : undefined;

    const agent = new Agent(
      {
        name: `subagent-${this.input.name}`,
        systemPrompt,
        provider: {
          provider: providerType as AIProvider,
          apiKey,
          baseUrl,
          headers: providerConfig?.headers,
        },
        model: {
          model,
          maxTokens: this.limits.maxTokens,
          temperature: AGENT_DEFAULT_TEMPERATURE,
        },
        maxTurns: this.limits.maxTurns,
        maxToolCalls: this.limits.maxToolCalls,
        tools: toolFilter,
      },
      { tools }
    );

    // Enable direct tool mode (no meta-tool indirection)
    agent.setDirectToolMode(true);

    return agent;
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    parts.push(`You are a specialized subagent named "${this.input.name}".`);
    parts.push(
      'You have been delegated a specific task by a parent agent. Complete it thoroughly and report your findings concisely.'
    );
    parts.push('');
    parts.push('## Rules');
    parts.push('1. Focus exclusively on the assigned task — do not deviate.');
    parts.push('2. Use tools when necessary to gather information or take actions.');
    parts.push('3. Be thorough but concise in your response.');
    parts.push('4. When done, provide a clear, structured summary of your findings or results.');
    parts.push(
      '5. You have access to system tools: memories, goals, custom data, triggers, extensions, plugins, and more.'
    );

    return parts.join('\n');
  }

  private buildTaskMessage(): string {
    const parts: string[] = [];

    // Current date/time context
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    parts.push(
      `Current date: ${days[now.getDay()]} ${now.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`
    );
    parts.push('');

    parts.push('## Task');
    parts.push(this.input.task);

    if (this.input.context) {
      parts.push('');
      parts.push('## Context');
      parts.push(this.input.context);
    }

    parts.push('');
    parts.push('Complete this task now. Provide a thorough response.');

    return parts.join('\n');
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Subagent timed out after ${ms}ms`)), ms)
    );
  }

  private cancellationPromise(): Promise<never> {
    return new Promise((_, reject) => {
      if (this.abortController.signal.aborted) {
        reject(new Error('Subagent cancelled'));
        return;
      }
      this.abortController.signal.addEventListener('abort', () => {
        reject(new Error('Subagent cancelled'));
      });
    });
  }

  private cancelledResult(
    durationMs: number,
    toolCalls: SubagentToolCall[] = [],
    provider = this.input.provider ?? 'unknown',
    model = this.input.model ?? 'unknown'
  ): SubagentExecutionResult {
    return {
      success: false,
      result: '',
      toolCalls,
      turnsUsed: 0,
      toolCallsUsed: toolCalls.length,
      tokensUsed: null,
      durationMs,
      error: 'Subagent cancelled',
      provider,
      model,
    };
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
