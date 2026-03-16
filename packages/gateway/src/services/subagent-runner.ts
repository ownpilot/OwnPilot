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

import { getErrorMessage } from '@ownpilot/core';
import type {
  SpawnSubagentInput,
  SubagentLimits,
  SubagentToolCall,
  ToolCall,
  ToolId,
} from '@ownpilot/core';
import { DEFAULT_SUBAGENT_LIMITS } from '@ownpilot/core';
import { getLog } from './log.js';
import {
  createConfiguredAgent,
  resolveProviderAndModel,
  executeAgentPipeline,
  buildDateTimeContext,
} from './agent-runner-utils.js';

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
  costUsd: number;
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
      const { provider, model } = await resolveProviderAndModel(
        this.input.provider,
        this.input.model,
        'subagent',
        `subagent:${this.input.name}`
      );

      // 2. Create agent with full tool access
      const agent = await this.createAgent(provider, model);

      // 3. Build the task message
      const taskMessage = this.buildTaskMessage();

      // 4. Execute via unified pipeline (with cancellation support)
      const pipelineResult = await executeAgentPipeline(provider, model, {
        agent,
        message: taskMessage,
        timeoutMs: this.limits.timeoutMs,
        timeoutLabel: 'Subagent',
        abortSignal: this.abortController.signal,
        onToolEnd,
      });

      // Check if cancelled during execution
      if (this.abortController.signal.aborted) {
        return this.cancelledResult(
          pipelineResult.durationMs,
          pipelineResult.toolCalls,
          provider,
          model
        );
      }

      log.info(
        `[subagent:${this.input.name}] Completed: ${pipelineResult.toolCalls.length} tool calls, ${pipelineResult.durationMs}ms`
      );

      return {
        success: true,
        result: pipelineResult.content,
        toolCalls: pipelineResult.toolCalls,
        turnsUsed: 1,
        toolCallsUsed: pipelineResult.toolCalls.length,
        tokensUsed: pipelineResult.usage
          ? {
              prompt: pipelineResult.usage.promptTokens,
              completion: pipelineResult.usage.completionTokens,
            }
          : null,
        costUsd: pipelineResult.costUsd,
        durationMs: pipelineResult.durationMs,
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
        costUsd: 0,
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

  private async createAgent(provider: string, model: string) {
    const systemPrompt = this.buildSystemPrompt();

    const toolFilter =
      this.input.allowedTools && this.input.allowedTools.length > 0
        ? this.input.allowedTools.map((t) => t as ToolId)
        : undefined;

    return createConfiguredAgent({
      name: `subagent-${this.input.name}`,
      provider,
      model,
      systemPrompt,
      userId: this.input.userId,
      conversationId: `subagent-${Date.now()}`,
      maxTokens: this.limits.maxTokens,
      maxTurns: this.limits.maxTurns,
      maxToolCalls: this.limits.maxToolCalls,
      toolFilter,
    });
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
    parts.push(`Current date: ${buildDateTimeContext()}`);
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
      costUsd: 0,
      durationMs,
      error: 'Subagent cancelled',
      provider,
      model,
    };
  }
}
