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
  Agent,
  ToolRegistry,
  registerAllTools,
  createProvider,
  generateId,
  getErrorMessage,
  qualifyToolName,
  getServiceRegistry,
  Services,
} from '@ownpilot/core';
import type {
  AIProvider,
  FleetWorkerConfig,
  FleetWorkerResult,
  FleetTask,
  ToolCall,
  ToolId,
  CodingAgentProvider,
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
} from '../tools/agent-tool-registry.js';
import { gatewayConfigCenter } from './config-center-impl.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';
import { buildEnhancedSystemPrompt } from '../assistant/orchestrator.js';
import { startOrchestration } from './coding-agent-orchestrator.js';
import { mcpClientService } from './mcp-client-service.js';
import type { ExtensionService } from './extension-service.js';

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

      log.error(
        `[${this.fleetId}:${this.config.name}] Task ${task.id} failed: ${errorMsg}`
      );

      return {
        id: generateId('flr'),
        sessionId: this.sessionId,
        workerId,
        workerName: this.config.name,
        workerType: this.config.type,
        taskId: task.id,
        success: false,
        output: '',
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
    startTime: number
  ): Promise<FleetWorkerResult> {
    const { provider, model } = await this.resolveProvider();
    const apiKey = await getProviderApiKey(provider);
    if (!apiKey) throw new Error(`API key not configured for provider: ${provider}`);

    const providerConfig = loadProviderConfig(provider);
    const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';
    const conversationId = `fleet-${this.fleetId}-${this.config.name}`;

    // Create a fresh ToolRegistry with ALL tool sources
    const tools = new ToolRegistry();
    registerAllTools(tools);
    tools.setConfigCenter(gatewayConfigCenter);
    registerGatewayTools(tools, this.userId, false);

    try {
      await registerDynamicTools(tools, this.userId, conversationId, false);
    } catch (err) {
      log.warn(`Dynamic tools registration failed: ${getErrorMessage(err)}`);
    }
    try {
      registerPluginTools(tools, false);
    } catch (err) {
      log.warn(`Plugin tools registration failed: ${getErrorMessage(err)}`);
    }
    try {
      registerExtensionTools(tools, this.userId, false);
    } catch (err) {
      log.warn(`Extension tools registration failed: ${getErrorMessage(err)}`);
    }
    try {
      registerMcpTools(tools, false);
    } catch (err) {
      log.warn(`MCP tools registration failed: ${getErrorMessage(err)}`);
    }

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
    let toolFilter: ToolId[] | undefined;
    if (this.config.allowedTools?.length || this.config.skills?.length) {
      const allowedSet = new Set(this.config.allowedTools ?? []);
      if (this.config.skills?.length) {
        try {
          const extService = getServiceRegistry().get(Services.Extension) as ExtensionService;
          const allowedSkillIds = new Set(this.config.skills);
          for (const def of extService.getToolDefinitions()) {
            if (allowedSkillIds.has(def.extensionId)) {
              const nsPrefix = def.format === 'agentskills' ? 'skill' : 'ext';
              allowedSet.add(
                qualifyToolName(def.name, nsPrefix as 'skill' | 'ext', def.extensionId)
              );
            }
          }
        } catch (err) {
          log.warn(`Skills filter build failed: ${getErrorMessage(err)}`);
        }
      }
      if (allowedSet.size > 0) toolFilter = [...allowedSet] as ToolId[];
    }

    // Create agent
    const agent = new Agent(
      {
        name: `fleet-${this.config.name}`,
        systemPrompt,
        provider: {
          provider: providerType as AIProvider,
          apiKey,
          baseUrl: providerConfig?.baseUrl,
        },
        model: {
          model,
          maxTokens: this.config.maxTokens ?? AGENT_DEFAULT_MAX_TOKENS,
          temperature: AGENT_DEFAULT_TEMPERATURE,
        },
        tools: toolFilter as ToolId[] | undefined,
        maxTurns: this.config.maxTurns ?? 10,
        maxToolCalls: 50,
      },
      { tools }
    );

    // Build message with task + shared context
    const message = this.buildTaskMessage(task, sharedContext);

    // Collect tool calls
    const toolCalls: Array<{ name: string; args: unknown; result: unknown }> = [];
    const onToolEnd = (
      tc: ToolCall,
      result: { content: string; isError: boolean; durationMs: number }
    ) => {
      toolCalls.push({
        name: tc.name,
        args: safeParseJson(tc.arguments),
        result: result.content,
      });
    };

    // Execute with timeout
    const timeoutMs = this.config.timeoutMs ?? 300_000;
    const chatResult = await Promise.race([
      agent.chat(message, { onToolEnd }),
      timeoutPromise(timeoutMs),
    ]);

    if (!chatResult.ok) {
      throw new Error(chatResult.error?.message ?? 'Agent chat failed');
    }

    const response = chatResult.value;
    const durationMs = Date.now() - startTime;

    log.info(`[${this.fleetId}:${this.config.name}] ai-chat completed`, {
      taskId: task.id,
      toolCalls: toolCalls.length,
      durationMs,
    });

    return {
      id: generateId('flr'),
      sessionId: this.sessionId,
      workerId,
      workerName: this.config.name,
      workerType: 'ai-chat',
      taskId: task.id,
      success: true,
      output: response.content ?? '',
      toolCalls,
      tokensUsed: response.usage
        ? { prompt: response.usage.promptTokens ?? 0, completion: response.usage.completionTokens ?? 0 }
        : undefined,
      durationMs,
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
        goal: `${task.title}: ${task.description}`,
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
    const { orchestrationRunsRepo } = await import(
      '../db/repositories/orchestration-runs.js'
    );

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
          const lastAnalysis = [...record.steps]
            .reverse()
            .find((s) => s.analysis)?.analysis;
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
    const { provider, model } = await this.resolveProvider();
    const apiKey = await getProviderApiKey(provider);
    if (!apiKey) throw new Error(`API key not configured for provider: ${provider}`);

    const providerConfig = loadProviderConfig(provider);
    const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

    const instance = createProvider({
      provider: providerType as AIProvider,
      apiKey,
      baseUrl: providerConfig?.baseUrl,
    });

    const systemContent = this.config.systemPrompt ??
      `You are a fleet worker. Mission: ${this.mission}`;

    const contextStr = Object.keys(sharedContext).length > 0
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
      tokensUsed: result.value.usage
        ? { prompt: result.value.usage.promptTokens ?? 0, completion: result.value.usage.completionTokens ?? 0 }
        : undefined,
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

    // Execute each MCP tool with task input
    const results: Array<{ tool: string; output: unknown }> = [];
    const args = (task.input as Record<string, unknown>) ?? {};

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
        name: r.tool,
        args,
        result: r.output,
      })),
      durationMs,
      executedAt: new Date(),
    };
  }

  // ---------- Helpers ----------

  private async resolveProvider(): Promise<{ provider: string; model: string }> {
    const provider = this.config.provider ?? this.defaultProvider;
    const model = this.config.model ?? this.defaultModel;

    if (provider && model) return { provider, model };

    const resolved = await resolveForProcess('pulse');
    const finalProvider = provider || resolved.provider;
    const finalModel = model || resolved.model;

    if (!finalProvider) {
      throw new Error(
        `No AI provider configured for worker "${this.config.name}". ` +
        'Set provider on the worker, fleet, or configure a default provider.'
      );
    }
    if (!finalModel) {
      throw new Error(
        `No model configured for worker "${this.config.name}". ` +
        'Set model on the worker, fleet, or configure a default model.'
      );
    }

    return { provider: finalProvider, model: finalModel };
  }

  private buildDefaultSystemPrompt(): string {
    return `You are "${this.config.name}", a fleet worker agent.

Fleet mission: ${this.mission}
Worker role: ${this.config.description ?? this.config.name}

You have access to tools to accomplish your tasks. Work efficiently and report results clearly.
When your task is complete, summarize what you accomplished.`;
  }

  private buildTaskMessage(
    task: FleetTask,
    sharedContext: Record<string, unknown>
  ): string {
    const parts: string[] = [
      `## Task: ${task.title}`,
      '',
      task.description,
    ];

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

// ============================================================================
// Utilities
// ============================================================================

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Worker timed out after ${ms}ms`)), ms)
  );
}

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
