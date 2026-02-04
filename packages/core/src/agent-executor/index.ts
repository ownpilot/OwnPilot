/**
 * Autonomous Agent Executor
 *
 * Executes agents autonomously with tool calling loops.
 * Agents think, act, observe, and repeat until task completion.
 */

import { randomUUID } from 'node:crypto';
import type { Message, ToolCall, ToolResult, ToolDefinition } from '../agent/types.js';
import type { ToolRegistry } from '../agent/tools.js';
import type { DataGateway, DataStoreType } from '../data-gateway/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Agent configuration for execution
 */
export interface ExecutableAgent {
  id: string;
  name: string;
  systemPrompt: string;
  /** Tool IDs this agent can use */
  allowedTools: string[];
  /** Data stores this agent can access */
  dataAccess: DataStoreType[];
  /** Configuration */
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
  };
}

/**
 * Execution context
 */
export interface AgentExecutionContext {
  /** Unique execution ID */
  executionId: string;
  /** User ID */
  userId: string;
  /** Conversation ID */
  conversationId: string;
  /** Channel (chat, telegram, etc.) */
  channel: string;
  /** Conversation history */
  messages: Message[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Execution result
 */
export interface AgentExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Final response message */
  response: string;
  /** Tool calls made during execution */
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
    duration: number;
  }>;
  /** Number of turns taken */
  turns: number;
  /** Total execution time in ms */
  duration: number;
  /** Error if failed */
  error?: string;
  /** Execution metadata */
  metadata: {
    agentId: string;
    startedAt: string;
    completedAt: string;
    tokensUsed?: {
      prompt: number;
      completion: number;
    };
  };
}

/**
 * Turn result (single iteration of the loop)
 */
interface _TurnResult {
  /** Response from LLM */
  response: string;
  /** Tool calls requested */
  toolCalls?: ToolCall[];
  /** Whether agent is done */
  done: boolean;
  /** Reason for completion */
  doneReason?: 'complete' | 'max_turns' | 'max_tool_calls' | 'error';
}

/**
 * LLM Provider for execution
 */
export interface ExecutorLLMProvider {
  complete(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    usage?: { promptTokens: number; completionTokens: number };
  }>;
}

// =============================================================================
// Agent Executor
// =============================================================================

/**
 * Executor configuration
 */
export interface AgentExecutorConfig {
  /** Maximum turns per execution */
  maxTurns?: number;
  /** Maximum tool calls per execution */
  maxToolCalls?: number;
  /** Timeout per tool call in ms */
  toolTimeout?: number;
  /** Enable execution logging */
  enableLogging?: boolean;
}

const DEFAULT_CONFIG: Required<AgentExecutorConfig> = {
  maxTurns: 50,
  maxToolCalls: 200,
  toolTimeout: 30000,
  enableLogging: true,
};

/**
 * Autonomous Agent Executor
 *
 * Runs agents in an autonomous loop:
 * THINK -> ACT -> OBSERVE -> repeat until DONE
 */
export class AgentExecutor {
  private readonly config: Required<AgentExecutorConfig>;
  private toolRegistry?: ToolRegistry;
  private dataGateway?: DataGateway;
  private llmProvider?: ExecutorLLMProvider;

  constructor(config: AgentExecutorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set dependencies
   */
  initialize(deps: {
    toolRegistry?: ToolRegistry;
    dataGateway?: DataGateway;
    llmProvider?: ExecutorLLMProvider;
  }): void {
    this.toolRegistry = deps.toolRegistry;
    this.dataGateway = deps.dataGateway;
    this.llmProvider = deps.llmProvider;
  }

  /**
   * Execute an agent for a user request
   */
  async execute(
    agent: ExecutableAgent,
    userMessage: string,
    context: Omit<AgentExecutionContext, 'executionId'>
  ): Promise<AgentExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    const fullContext: AgentExecutionContext = {
      ...context,
      executionId,
    };

    // Initialize data gateway permissions
    if (this.dataGateway && agent.dataAccess.length > 0) {
      this.dataGateway.grantAccess(agent.id, agent.dataAccess);
    }

    // Get available tools for this agent
    const tools = this.getAgentTools(agent);

    // Build initial messages
    const messages: Message[] = [
      { role: 'system', content: this.buildSystemPrompt(agent, tools) },
      ...fullContext.messages,
      { role: 'user', content: userMessage },
    ];

    const toolCallHistory: AgentExecutionResult['toolCalls'] = [];
    let turns = 0;
    let totalToolCalls = 0;
    let lastResponse = '';
    const tokensUsed = { prompt: 0, completion: 0 };

    this.log(`[${executionId}] Starting execution with agent: ${agent.id}`);

    try {
      // Execution loop
      while (turns < (agent.config.maxTurns || this.config.maxTurns)) {
        turns++;
        this.log(`[${executionId}] Turn ${turns}`);

        // Check tool call limit
        if (totalToolCalls >= (agent.config.maxToolCalls || this.config.maxToolCalls)) {
          this.log(`[${executionId}] Max tool calls reached`);
          break;
        }

        // Run a turn
        const turnResult = await this.runTurn(
          messages,
          tools,
          agent.config,
          totalToolCalls < (agent.config.maxToolCalls || this.config.maxToolCalls)
        );

        // Track tokens
        if (turnResult.tokensUsed) {
          tokensUsed.prompt += turnResult.tokensUsed.prompt;
          tokensUsed.completion += turnResult.tokensUsed.completion;
        }

        lastResponse = turnResult.response;

        // If no tool calls, we're done
        if (!turnResult.toolCalls || turnResult.toolCalls.length === 0) {
          this.log(`[${executionId}] No tool calls, completing`);
          break;
        }

        // Execute tool calls
        const toolResults: ToolResult[] = [];
        for (const toolCall of turnResult.toolCalls) {
          totalToolCalls++;

          this.log(`[${executionId}] Calling tool: ${toolCall.name}`);

          const toolStart = Date.now();
          const result = await this.executeTool(
            toolCall,
            agent,
            fullContext
          );
          const toolDuration = Date.now() - toolStart;

          toolCallHistory.push({
            tool: toolCall.name,
            args: JSON.parse(toolCall.arguments || '{}'),
            result: result.content,
            duration: toolDuration,
          });

          toolResults.push({
            toolCallId: toolCall.id,
            content: JSON.stringify(result.content),
          });
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: turnResult.response,
          toolCalls: turnResult.toolCalls,
        });

        // Add tool results as individual tool messages
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            content: result.content,
            toolResults: [result],
          });
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        response: lastResponse,
        toolCalls: toolCallHistory,
        turns,
        duration,
        metadata: {
          agentId: agent.id,
          startedAt,
          completedAt: new Date().toISOString(),
          tokensUsed: tokensUsed.prompt > 0 ? tokensUsed : undefined,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log(`[${executionId}] Execution failed: ${errorMessage}`);

      return {
        success: false,
        response: `I encountered an error while processing your request: ${errorMessage}`,
        toolCalls: toolCallHistory,
        turns,
        duration,
        error: errorMessage,
        metadata: {
          agentId: agent.id,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
    } finally {
      // Clean up permissions
      if (this.dataGateway && agent.dataAccess.length > 0) {
        this.dataGateway.revokeAccess(agent.id, agent.dataAccess);
      }
    }
  }

  /**
   * Run a single turn of the execution loop
   */
  private async runTurn(
    messages: Message[],
    tools: ToolDefinition[],
    config: ExecutableAgent['config'],
    allowTools: boolean
  ): Promise<{
    response: string;
    toolCalls?: ToolCall[];
    tokensUsed?: { prompt: number; completion: number };
  }> {
    if (!this.llmProvider) {
      throw new Error('LLM provider not configured');
    }

    const result = await this.llmProvider.complete({
      messages,
      tools: allowTools ? tools : undefined,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    return {
      response: result.content,
      toolCalls: result.toolCalls,
      tokensUsed: result.usage
        ? { prompt: result.usage.promptTokens, completion: result.usage.completionTokens }
        : undefined,
    };
  }

  /**
   * Execute a tool call
   */
  private async executeTool(
    toolCall: ToolCall,
    agent: ExecutableAgent,
    context: AgentExecutionContext
  ): Promise<{ content: unknown; error?: string }> {
    const toolName = toolCall.name;

    // Check if agent has access to this tool
    if (!agent.allowedTools.includes(toolName)) {
      return {
        content: { error: `Agent ${agent.id} does not have access to tool: ${toolName}` },
        error: 'Permission denied',
      };
    }

    // Parse arguments
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments || '{}');
    } catch {
      return {
        content: { error: 'Invalid tool arguments' },
        error: 'Parse error',
      };
    }

    // Execute tool
    if (!this.toolRegistry) {
      return {
        content: { error: 'Tool registry not configured' },
        error: 'Not configured',
      };
    }

    const toolContext = {
      conversationId: context.conversationId,
      userId: context.userId,
      agentId: agent.id,
    };

    const timeoutMs = this.config.toolTimeout;
    const result = await Promise.race([
      this.toolRegistry.execute(toolName, args, toolContext),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]).catch((err: Error) => ({ ok: false as const, error: err }));

    if (result.ok) {
      return { content: result.value.content };
    } else {
      return {
        content: { error: result.error.message },
        error: result.error.message,
      };
    }
  }

  /**
   * Get tool definitions for an agent
   */
  private getAgentTools(agent: ExecutableAgent): ToolDefinition[] {
    if (!this.toolRegistry) return [];

    return this.toolRegistry.getDefinitionsByNames(agent.allowedTools) as ToolDefinition[];
  }

  /**
   * Build system prompt for agent
   */
  private buildSystemPrompt(agent: ExecutableAgent, tools: ToolDefinition[]): string {
    const toolList =
      tools.length > 0
        ? `\n\n## Available Tools\nYou have access to the following tools:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}\n\nUse tools when they help accomplish the user's request. You can call multiple tools if needed.`
        : '';

    const dataAccessList =
      agent.dataAccess.length > 0
        ? `\n\n## Data Access\nYou have access to the following personal data stores:\n${agent.dataAccess.map((d) => `- ${d}`).join('\n')}\n\nUse appropriate tools to read/write this data when needed.`
        : '';

    return `${agent.systemPrompt}${toolList}${dataAccessList}

## Execution Rules
1. Analyze the user's request carefully
2. Use tools when they help accomplish the task
3. Process tool results and continue if more work is needed
4. Provide a clear, helpful final response
5. Be concise but thorough`;
  }

  /**
   * Log message (if enabled)
   */
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[AgentExecutor] ${message}`);
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

let _executor: AgentExecutor | null = null;

export function getAgentExecutor(): AgentExecutor {
  if (!_executor) {
    _executor = new AgentExecutor();
  }
  return _executor;
}

export function createAgentExecutor(config?: AgentExecutorConfig): AgentExecutor {
  return new AgentExecutor(config);
}
