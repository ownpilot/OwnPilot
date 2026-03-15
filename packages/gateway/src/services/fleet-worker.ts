/**
 * Fleet Worker
 *
 * Executes a single task using one of 4 worker engines:
 * - ai-chat: Full Agent engine with 250+ tools (like background-agent-runner)
 * - coding-cli: CLI tools via CodingAgentOrchestrator (Claude Code, Gemini, Codex)
 * - api-call: Direct AI provider API (lightweight, no tools)
 * - mcp-bridge: MCP server tool calls
 *
 * The worker does NOT own scheduling — that's the FleetManager's job.
 */

import {
  createProvider,
  generateId,
  getErrorMessage,
} from '@ownpilot/core';
import type {
  AIProvider,
  FleetWorkerConfig,
  FleetWorkerResult,
  FleetTask,
  ToolId,
  CodingAgentProvider,
} from '@ownpilot/core';
import { getLog } from './log.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';
import { buildEnhancedSystemPrompt } from '../assistant/orchestrator.js';
import { startOrchestration } from './coding-agent-orchestrator.js';
import { mcpClientService } from './mcp-client-service.js';
import {
  createConfiguredAgent,
  resolveProviderAndModel,
  resolveToolFilter,
  calculateExecutionCost,
  executeAgentPipeline,
} from './agent-runner-utils.js';

const log = getLog('FleetWorker');

// ============================================================================
// Worker Executor
// ============================================================================

export class FleetWorker {
  private config: FleetWorkerConfig;
  private fleetId: string;
  private sessionId: string;
  private userId: string;
  private defaultProvider?: string;
  private defaultModel?: string;
  private mission: string;

  constructor(opts: {
    config: FleetWorkerConfig;
    fleetId: string;
    sessionId: string;
    userId: string;
    defaultProvider?: string;
    defaultModel?: string;
    mission: string;
  }) {
    this.config = opts.config;
    this.fleetId = opts.fleetId;
    this.sessionId = opts.sessionId;
    this.userId = opts.userId;
    this.defaultProvider = opts.defaultProvider;
    this.defaultModel = opts.defaultModel;
    this.mission = opts.mission;
  }

  /**
   * Execute a single task. Returns result without modifying external state.
   */
  async execute(
    task: FleetTask,
    sharedContext: Record<string, unknown>
  ): Promise<FleetWorkerResult> {
    const startTime = Date.now();
    const workerId = generateId('flw');

    try {
      let result: FleetWorkerResult;

      switch (this.config.type) {
        case 'ai-chat':
          result = await this.executeAiChat(task, sharedContext, workerId, startTime);
          break;
        case 'coding-cli':
          result = await this.executeCodingCli(task, workerId, startTime);
          break;
        case 'api-call':
          result = await this.executeApiCall(task, sharedContext, workerId, startTime);
          break;
        case 'mcp-bridge':
          result = await this.executeMcpBridge(task, workerId, startTime);
          break;
        default:
          throw new Error(`Unknown worker type: ${this.config.type}`);
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);

      log.error(`[${this.fleetId}:${this.config.name}] Task ${task.id} failed: ${errorMsg}`);

      return {
        id: generateId('flr'),
        sessionId: this.sessionId,
        workerId,
        workerName: this.config.name,
        workerType: this.config.type,
        taskId: task.id,
        success: false,
        output: '',
        toolCalls: [],
        costUsd: 0,
        durationMs,
        error: errorMsg,
        executedAt: new Date(),
      };
    }
  }

  // ---------- ai-chat: Full Agent with tools ----------

  private async executeAiChat(
    task: FleetTask,
    sharedContext: Record<string, unknown>,
    workerId: string,
    _startTime: number
  ): Promise<FleetWorkerResult> {
    const { provider, model } = await resolveProviderAndModel(
      this.config.provider ?? this.defaultProvider,
      this.config.model ?? this.defaultModel,
      'pulse',
      `worker "${this.config.name}"`
    );
    const conversationId = `fleet-${this.fleetId}-${this.config.name}`;

    // Build system prompt
    const basePrompt = this.config.systemPrompt ?? this.buildDefaultSystemPrompt();
    let systemPrompt = basePrompt;
    try {
      const enhanced = await buildEnhancedSystemPrompt(basePrompt, {
        userId: this.userId,
        maxMemories: 10,
        maxGoals: 5,
      });
      systemPrompt = enhanced.prompt;
    } catch (err) {
      log.warn(`Enhanced prompt build failed, using base: ${getErrorMessage(err)}`);
    }

    // Tool filter
    const toolFilter = (this.config.allowedTools?.length || this.config.skills?.length)
      ? resolveToolFilter(this.config.allowedTools, this.config.skills, `${this.fleetId}:${this.config.name}`)
      : undefined;

    // Create agent with all tool sources
    const agent = await createConfiguredAgent({
      name: `fleet-${this.config.name}`,
      provider,
      model,
      systemPrompt,
      userId: this.userId,
      conversationId,
      maxTokens: this.config.maxTokens,
      maxTurns: this.config.maxTurns ?? 10,
      maxToolCalls: 50,
      toolFilter: toolFilter as ToolId[] | undefined,
    });

    // Build message with task + shared context
    const message = this.buildTaskMessage(task, sharedContext);

    // Execute via unified pipeline
    const timeoutMs = this.config.timeoutMs ?? 300_000;
    const pipelineResult = await executeAgentPipeline(provider, model, {
      agent,
      message,
      timeoutMs,
      timeoutLabel: 'Worker',
    });

    // Map collector format to fleet's { tool, name, args, result } format
    const toolCalls = pipelineResult.toolCalls.map((tc) => ({
      tool: tc.tool,
      name: tc.tool,
      args: tc.args as unknown,
      result: tc.result as unknown,
    }));

    log.info(`[${this.fleetId}:${this.config.name}] ai-chat completed`, {
      taskId: task.id,
      toolCalls: toolCalls.length,
      durationMs: pipelineResult.durationMs,
    });

    return {
      id: generateId('flr'),
      sessionId: this.sessionId,
      workerId,
      workerName: this.config.name,
      workerType: 'ai-chat',
      taskId: task.id,
      success: true,
      output: pipelineResult.content,
      toolCalls,
      tokensUsed: pipelineResult.usage
        ? { prompt: pipelineResult.usage.promptTokens, completion: pipelineResult.usage.completionTokens }
        : undefined,
      costUsd: pipelineResult.costUsd,
      durationMs: pipelineResult.durationMs,
      executedAt: new Date(),
    };
  }

  // ---------- coding-cli: CLI tool orchestration ----------

  private async executeCodingCli(
    task: FleetTask,
    workerId: string,
    startTime: number
  ): Promise<FleetWorkerResult> {
    const cliProvider = this.config.cliProvider ?? 'claude-code';
    const cwd = this.config.cwd;

    const run = await startOrchestration(
      {
        goal: `Fleet mission: ${this.mission}\n\nTask: ${task.title}: ${task.description}`,
        provider: cliProvider as CodingAgentProvider,
        cwd: cwd ?? '.',
        maxSteps: this.config.maxTurns ?? 10,
        autoMode: true,
        enableAnalysis: true,
      },
      this.userId
    );

    // Wait for completion (poll with timeout)
    const timeoutMs = this.config.timeoutMs ?? 600_000; // 10 min for CLI
    const deadline = Date.now() + timeoutMs;
    let finalRun = run;

    // Import the repo to check status
    const { orchestrationRunsRepo } = await import('../db/repositories/orchestration-runs.js');

    while (Date.now() < deadline) {
      const record = await orchestrationRunsRepo.getById(run.id, this.userId);
      if (!record) break;

      if (
        record.status === 'completed' ||
        record.status === 'failed' ||
        record.status === 'cancelled'
      ) {
        finalRun = { ...run, status: record.status as 'completed' | 'failed' | 'cancelled' };
        break;
      }

      // Wait 2s before polling again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Fetch step details for rich output
    let outputSummary = `Orchestration ${run.id}: ${finalRun.status}`;
    try {
      const record = await orchestrationRunsRepo.getById(run.id, this.userId);
      if (record?.steps?.length) {
        const stepSummaries = record.steps
          .filter((s) => s.status === 'completed' || s.status === 'failed')
          .map((s) => {
            const analysisSummary = s.analysis?.summary ?? '';
            const stepOutput = s.outputSummary ?? '';
            const status = s.exitCode === 0 ? 'OK' : `exit:${s.exitCode ?? '?'}`;
            return `Step ${s.index + 1} [${status}]: ${analysisSummary || stepOutput || s.prompt.slice(0, 100)}`;
          });
        if (stepSummaries.length > 0) {
          outputSummary = `Orchestration ${run.id} (${finalRun.status})\n\n${stepSummaries.join('\n')}`;
          const lastAnalysis = [...record.steps].reverse().find((s) => s.analysis)?.analysis;
          if (lastAnalysis?.summary) {
            outputSummary += `\n\nFinal: ${lastAnalysis.summary}`;
          }
        }
      }
    } catch {
      // Non-critical: keep basic output
    }

    const durationMs = Date.now() - startTime;
    const success = finalRun.status === 'completed';

    log.info(`[${this.fleetId}:${this.config.name}] coding-cli completed`, {
      taskId: task.id,
      cliProvider,
      status: finalRun.status,
      durationMs,
    });

    return {
      id: generateId('flr'),
      sessionId: this.sessionId,
      workerId,
      workerName: this.config.name,
      workerType: 'coding-cli',
      taskId: task.id,
      success,
      output: outputSummary,
      toolCalls: [],
      costUsd: 0,
      durationMs,
      error: success ? undefined : `Orchestration ${finalRun.status}`,
      executedAt: new Date(),
    };
  }

  // ---------- api-call: Direct AI provider call ----------

  private async executeApiCall(
    task: FleetTask,
    sharedContext: Record<string, unknown>,
    workerId: string,
    startTime: number
  ): Promise<FleetWorkerResult> {
    const { provider, model } = await resolveProviderAndModel(
      this.config.provider ?? this.defaultProvider,
      this.config.model ?? this.defaultModel,
      'pulse',
      `worker "${this.config.name}"`
    );
    const apiKey = await getProviderApiKey(provider);
    if (!apiKey) throw new Error(`API key not configured for provider: ${provider}`);

    const providerConfig = loadProviderConfig(provider);
    const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

    const instance = createProvider({
      provider: providerType as AIProvider,
      apiKey,
      baseUrl: providerConfig?.baseUrl,
    });

    const systemContent =
      this.config.systemPrompt ?? `You are a fleet worker. Mission: ${this.mission}`;

    const contextStr =
      Object.keys(sharedContext).length > 0
        ? `\n\nShared context: ${JSON.stringify(sharedContext, null, 2)}`
        : '';

    const userMessage = `Task: ${task.title}\n\n${task.description}${contextStr}`;

    const result = await instance.complete({
      model: {
        model,
        maxTokens: this.config.maxTokens ?? AGENT_DEFAULT_MAX_TOKENS,
        temperature: AGENT_DEFAULT_TEMPERATURE,
      },
      messages: [
        { role: 'system' as const, content: systemContent },
        { role: 'user' as const, content: userMessage },
      ],
    });

    if (!result.ok) {
      throw new Error(result.error?.message ?? 'AI provider call failed');
    }

    const durationMs = Date.now() - startTime;
    const content = result.value.content ?? '';

    log.info(`[${this.fleetId}:${this.config.name}] api-call completed`, {
      taskId: task.id,
      provider,
      model,
      durationMs,
    });

    return {
      id: generateId('flr'),
      sessionId: this.sessionId,
      workerId,
      workerName: this.config.name,
      workerType: 'api-call',
      taskId: task.id,
      success: true,
      output: content,
      toolCalls: [],
      tokensUsed: result.value.usage
        ? {
            prompt: result.value.usage.promptTokens ?? 0,
            completion: result.value.usage.completionTokens ?? 0,
          }
        : undefined,
      costUsd: calculateExecutionCost(provider, model, result.value.usage),
      durationMs,
      executedAt: new Date(),
    };
  }

  // ---------- mcp-bridge: MCP server tool calls ----------

  private async executeMcpBridge(
    task: FleetTask,
    workerId: string,
    startTime: number
  ): Promise<FleetWorkerResult> {
    const serverName = this.config.mcpServer;
    if (!serverName) throw new Error('MCP server name not configured for mcp-bridge worker');

    const mcpTools = this.config.mcpTools;
    if (!mcpTools?.length) throw new Error('No MCP tools specified for mcp-bridge worker');

    // Execute each MCP tool with task input (mission context included via args)
    const results: Array<{ tool: string; output: unknown }> = [];
    const baseArgs = (task.input as Record<string, unknown>) ?? {};
    const args = { ...baseArgs, _mission: this.mission, _task: `${task.title}: ${task.description}` };

    for (const toolName of mcpTools) {
      const toolResult = await mcpClientService.callTool(serverName, toolName, args);
      results.push({ tool: toolName, output: toolResult });
    }

    const durationMs = Date.now() - startTime;
    const output = JSON.stringify(results, null, 2);

    log.info(`[${this.fleetId}:${this.config.name}] mcp-bridge completed`, {
      taskId: task.id,
      serverName,
      toolCount: results.length,
      durationMs,
    });

    return {
      id: generateId('flr'),
      sessionId: this.sessionId,
      workerId,
      workerName: this.config.name,
      workerType: 'mcp-bridge',
      taskId: task.id,
      success: true,
      output,
      toolCalls: results.map((r) => ({
        tool: r.tool,
        name: r.tool,
        args,
        result: r.output,
      })),
      costUsd: 0,
      durationMs,
      executedAt: new Date(),
    };
  }

  // ---------- Helpers ----------

  private buildDefaultSystemPrompt(): string {
    return `You are "${this.config.name}", a fleet worker agent.

Fleet mission: ${this.mission}
Worker role: ${this.config.description ?? this.config.name}

You have access to tools to accomplish your tasks. Work efficiently and report results clearly.
When your task is complete, summarize what you accomplished.`;
  }

  private buildTaskMessage(task: FleetTask, sharedContext: Record<string, unknown>): string {
    const parts: string[] = [`## Task: ${task.title}`, '', task.description];

    if (task.input && Object.keys(task.input).length > 0) {
      parts.push('', '### Input Data', '```json', JSON.stringify(task.input, null, 2), '```');
    }

    if (Object.keys(sharedContext).length > 0) {
      parts.push(
        '',
        '### Shared Context (from other workers)',
        '```json',
        JSON.stringify(sharedContext, null, 2),
        '```'
      );
    }

    return parts.join('\n');
  }
}

