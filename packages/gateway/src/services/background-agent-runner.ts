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

import { getErrorMessage } from '@ownpilot/core';
import type {
  BackgroundAgentConfig,
  BackgroundAgentSession,
  BackgroundAgentCycleResult,
  BackgroundAgentToolCall,
} from '@ownpilot/core';
import { getLog } from './log.js';
import { buildEnhancedSystemPrompt } from '../assistant/orchestrator.js';
import {
  resolveProviderAndModel,
  createConfiguredAgent,
  resolveToolFilter,
  executeAgentPipeline,
  buildDateTimeContext,
} from './agent-runner-utils.js';

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
      const { provider, model } = await resolveProviderAndModel(
        this.config.provider,
        this.config.model,
        'pulse'
      );

      // 2. Create agent with full tool access
      const agent = await this.createAgent(provider, model);

      // 3. Build the cycle message
      const cycleMessage = this.buildCycleMessage(session, cycleNumber);

      // 4. Execute via unified pipeline
      const pipelineResult = await executeAgentPipeline(provider, model, {
        agent,
        message: cycleMessage,
        timeoutMs: this.config.limits.cycleTimeoutMs,
        timeoutLabel: 'Cycle',
      });

      // Map to BackgroundAgentCycleResult
      const toolCalls: BackgroundAgentToolCall[] = pipelineResult.toolCalls.map((tc) => ({
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
        duration: tc.durationMs,
      }));

      log.info(`[${this.config.id}] Cycle ${cycleNumber} completed`, {
        toolCalls: toolCalls.length,
        tools: toolCalls.map((tc) => tc.tool),
        durationMs: pipelineResult.durationMs,
        outputLength: pipelineResult.content.length,
      });

      return {
        success: true,
        toolCalls,
        output: pipelineResult.content,
        outputMessage: pipelineResult.content,
        tokensUsed: pipelineResult.usage
          ? { prompt: pipelineResult.usage.promptTokens, completion: pipelineResult.usage.completionTokens }
          : undefined,
        costUsd: pipelineResult.costUsd,
        durationMs: pipelineResult.durationMs,
        turns: 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);

      log.error(`[${this.config.id}] Cycle ${cycleNumber} failed: ${errorMsg}`);

      return {
        success: false,
        toolCalls: [],
        output: '',
        outputMessage: '',
        durationMs,
        turns: 0,
        error: errorMsg,
      };
    }
  }

  // ---------- Private Helpers ----------

  private async createAgent(provider: string, model: string) {
    const userId = this.config.userId;
    const conversationId = `bg-${this.config.id}`;

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
      log.warn(
        `[${this.config.id}] Enhanced prompt build failed, using base: ${getErrorMessage(err)}`
      );
    }

    // Build tool filter from allowedTools + skills
    const toolFilter = resolveToolFilter(
      this.config.allowedTools,
      this.config.skills,
      this.config.id
    );

    return createConfiguredAgent({
      name: `bg-agent-${this.config.id}`,
      provider,
      model,
      systemPrompt,
      userId,
      conversationId,
      maxTurns: this.config.limits.maxTurnsPerCycle,
      maxToolCalls: this.config.limits.maxToolCallsPerCycle,
      toolFilter,
    });
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

    // Current date/time context
    parts.push(`\n## Current Time\n${buildDateTimeContext()}`);

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
}
