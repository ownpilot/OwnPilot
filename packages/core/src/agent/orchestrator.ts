/**
 * Agent Orchestrator
 * Handles tool calling, reasoning, multi-step planning, and agent execution
 */

// EventEmitter removed - using unified EventSystem instead
import type { ToolDefinition, ToolExecutor } from './tools.js';
import { ToolRegistry } from './tools.js';
import type { Message, ToolCall } from './types.js';
import { injectMemoryIntoPrompt, type MemoryInjectionOptions } from './memory-injector.js';
import { getEventSystem } from '../events/index.js';

/**
 * LLM Provider interface for orchestrator
 * Compatible with various provider implementations.
 * Tool calls should use the normalized ToolCall format (flat {id, name, arguments}).
 */
export interface LLMProvider {
  complete(request: {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    content?: string;
    toolCalls?: ToolCall[];
  }>;

  stream?(request: {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
  }): AsyncGenerator<{
    content?: string;
    toolCalls?: ToolCall[];
  }>;
}

// ============================================================================
// TYPES
// ============================================================================

export interface AgentConfig {
  /** Agent name */
  name: string;
  /** Agent description */
  description?: string;
  /** System prompt */
  systemPrompt: string;
  /** LLM provider */
  provider: LLMProvider;
  /** Model to use */
  model: string;
  /** Available tools */
  tools: ToolDefinition[];
  /** Tool executors */
  toolExecutors: Map<string, ToolExecutor>;
  /** Maximum iterations for tool calling loop */
  maxIterations?: number;
  /** Maximum tokens per response */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** User ID for memory injection */
  userId?: string;
  /** Memory injection options */
  memoryOptions?: Omit<MemoryInjectionOptions, 'userId' | 'tools'>;
  /** Enable dynamic prompts with memory */
  enableDynamicPrompts?: boolean;
  /** Per-category execution permissions (persistent in DB) */
  executionPermissions?: import('./types.js').ExecutionPermissions;
  /** Callback to request user approval for sensitive operations (e.g. local code execution) */
  requestApproval?: (
    category: string,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
  ) => Promise<boolean>;
}

export interface OrchestratorContext {
  /** Unique execution ID */
  id: string;
  /** Current iteration number */
  iteration: number;
  /** Messages in this execution */
  messages: Message[];
  /** Tool calls made */
  toolCalls: ToolCallRecord[];
  /** Current status */
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Start time */
  startTime: Date;
  /** End time */
  endTime?: Date;
  /** Final response */
  response?: string;
  /** Error if failed */
  error?: string;
  /** Metadata */
  metadata: Record<string, unknown>;
}

export interface ToolCallRecord {
  /** Tool name */
  name: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
  /** Tool result */
  result: unknown;
  /** Start time */
  startTime: Date;
  /** End time */
  endTime: Date;
  /** Duration in ms */
  duration: number;
  /** Whether call succeeded */
  success: boolean;
  /** Error if failed */
  error?: string;
}

export interface AgentStep {
  /** Step type */
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  /** Step content */
  content: unknown;
  /** Timestamp */
  timestamp: Date;
}


// ============================================================================
// AGENT ORCHESTRATOR
// ============================================================================

export class AgentOrchestrator {
  private config: AgentConfig;
  private registry: ToolRegistry | null = null;
  private currentExecution: OrchestratorContext | null = null;
  private abortController: AbortController | null = null;

  constructor(config: AgentConfig) {
    this.config = {
      maxIterations: 10,
      maxTokens: 4096,
      temperature: 0.7,
      verbose: false,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Set tool registry for dynamic tool resolution
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.registry = registry;
  }

  /**
   * Execute agent with user input
   */
  async execute(
    userMessage: string,
    conversationHistory: Message[] = [],
    metadata: Record<string, unknown> = {}
  ): Promise<OrchestratorContext> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Get system prompt (with optional memory injection)
    const systemPrompt = await this.getSystemPrompt(conversationHistory.length);

    const context: OrchestratorContext = {
      id: executionId,
      iteration: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      toolCalls: [],
      status: 'running',
      startTime: new Date(),
      metadata,
    };

    this.currentExecution = context;
    this.abortController = new AbortController();

    try {
      await this.runExecutionLoop(context);
      context.status = 'completed';
      context.endTime = new Date();
      getEventSystem().emit('agent.complete', `orchestrator:${context.id}`, {
        agentId: context.id,
        response: context.response,
        iterationCount: context.iteration,
        duration: context.endTime!.getTime() - context.startTime.getTime(),
      });
    } catch (error: unknown) {
      context.status = 'failed';
      context.error = error instanceof Error ? error.message : String(error);
      context.endTime = new Date();
      getEventSystem().emit('agent.error', `orchestrator:${context.id}`, {
        agentId: context.id,
        error: context.error,
        iteration: context.iteration,
      });
    } finally {
      this.currentExecution = null;
      this.abortController = null;
    }

    return context;
  }

  /**
   * Stream execution with real-time events
   */
  async *stream(
    userMessage: string,
    conversationHistory: Message[] = [],
    metadata: Record<string, unknown> = {}
  ): AsyncGenerator<AgentStep, OrchestratorContext, undefined> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Get system prompt (with optional memory injection)
    const systemPrompt = await this.getSystemPrompt(conversationHistory.length);

    const context: OrchestratorContext = {
      id: executionId,
      iteration: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      toolCalls: [],
      status: 'running',
      startTime: new Date(),
      metadata,
    };

    this.currentExecution = context;
    this.abortController = new AbortController();

    try {
      yield* this.runStreamingExecutionLoop(context);
      context.status = 'completed';
      context.endTime = new Date();
    } catch (error: unknown) {
      context.status = 'failed';
      context.error = error instanceof Error ? error.message : String(error);
      context.endTime = new Date();
    } finally {
      this.currentExecution = null;
      this.abortController = null;
    }

    return context;
  }

  /**
   * Cancel current execution
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentExecution) {
      this.currentExecution.status = 'cancelled';
    }
  }

  /**
   * Get current execution context
   */
  getCurrentExecution(): OrchestratorContext | null {
    return this.currentExecution;
  }

  /**
   * Get system prompt with optional memory injection
   * If enableDynamicPrompts is true and userId is provided,
   * the prompt will be enhanced with user profile, tools, and context.
   */
  private async getSystemPrompt(messageCount: number = 0): Promise<string> {
    // If dynamic prompts are not enabled, return base prompt
    if (!this.config.enableDynamicPrompts || !this.config.userId) {
      return this.config.systemPrompt;
    }

    try {
      const result = await injectMemoryIntoPrompt(this.config.systemPrompt, {
        userId: this.config.userId,
        tools: this.config.tools,
        includeProfile: true,
        includeInstructions: true,
        includeTimeContext: true,
        includeToolDescriptions: true,
        conversationContext: messageCount > 0 ? {
          messageCount,
        } : undefined,
        capabilities: {
          codeExecution: this.config.tools.some(t => t.category === 'code_execution'),
          fileAccess: this.config.tools.some(t => t.category === 'file_system'),
          webBrowsing: this.config.tools.some(t => t.category === 'web_fetch'),
          memory: true,
        },
        ...this.config.memoryOptions,
      });

      if (this.config.verbose) {
        console.log(`[Orchestrator] Dynamic prompt composed (${result.promptLength} chars)`);
        console.log(`[Orchestrator] - User profile: ${result.userProfile ? 'included' : 'not available'}`);
        console.log(`[Orchestrator] - Tools: ${result.toolCount}`);
        console.log(`[Orchestrator] - Instructions: ${result.instructionCount}`);
      }

      return result.systemPrompt;
    } catch (error) {
      // Fall back to base prompt if memory injection fails
      if (this.config.verbose) {
        console.warn('[Orchestrator] Memory injection failed, using base prompt:', error);
      }
      return this.config.systemPrompt;
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async runExecutionLoop(context: OrchestratorContext): Promise<void> {
    while (context.iteration < this.config.maxIterations!) {
      // Check for cancellation
      if (this.abortController?.signal.aborted) {
        throw new Error('Execution cancelled');
      }

      context.iteration++;
      getEventSystem().emit('agent.iteration', `orchestrator:${context.id}`, {
        agentId: context.id,
        iteration: context.iteration,
      });

      // Call LLM
      const response = await this.config.provider.complete({
        model: this.config.model,
        messages: context.messages,
        tools: this.config.tools.length > 0 ? this.config.tools : undefined,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls
        context.messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall, context);

          // Add tool result to messages
          context.messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult.result),
            toolResults: [{
              toolCallId: toolCall.id,
              content: JSON.stringify(toolResult.result),
              isError: !toolResult.success,
            }],
          });
        }
      } else {
        // No tool calls, we're done
        context.messages.push({
          role: 'assistant',
          content: response.content || '',
        });
        context.response = response.content || '';
        break;
      }
    }

    // If we hit max iterations without completing
    if (!context.response && context.iteration >= this.config.maxIterations!) {
      const lastMessage = context.messages[context.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        context.response = typeof lastMessage.content === 'string'
          ? lastMessage.content
          : '[Complex content]';
      } else {
        context.response = '[Max iterations reached]';
      }
    }
  }

  private async *runStreamingExecutionLoop(
    context: OrchestratorContext
  ): AsyncGenerator<AgentStep, void, undefined> {
    while (context.iteration < this.config.maxIterations!) {
      // Check for cancellation
      if (this.abortController?.signal.aborted) {
        throw new Error('Execution cancelled');
      }

      context.iteration++;

      yield {
        type: 'thinking',
        content: { iteration: context.iteration },
        timestamp: new Date(),
      };

      // Call LLM with streaming
      let fullContent = '';
      let toolCalls: ToolCall[] = [];

      if (this.config.provider.stream) {
        const stream = this.config.provider.stream({
          model: this.config.model,
          messages: context.messages,
          tools: this.config.tools.length > 0 ? this.config.tools : undefined,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        });

        for await (const chunk of stream) {
          if (chunk.content) {
            fullContent += chunk.content;
            yield {
              type: 'response',
              content: { delta: chunk.content, accumulated: fullContent },
              timestamp: new Date(),
            };
          }
          if (chunk.toolCalls) {
            toolCalls = chunk.toolCalls;
          }
        }
      } else {
        // Fallback to non-streaming
        const response = await this.config.provider.complete({
          model: this.config.model,
          messages: context.messages,
          tools: this.config.tools.length > 0 ? this.config.tools : undefined,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        });
        fullContent = response.content || '';
        toolCalls = response.toolCalls || [];

        yield {
          type: 'response',
          content: { delta: fullContent, accumulated: fullContent },
          timestamp: new Date(),
        };
      }

      // Check for tool calls
      if (toolCalls.length > 0) {
        context.messages.push({
          role: 'assistant',
          content: fullContent,
          toolCalls,
        });

        // Execute each tool call
        for (const toolCall of toolCalls) {
          yield {
            type: 'tool_call',
            content: { name: toolCall.name, arguments: toolCall.arguments },
            timestamp: new Date(),
          };

          const toolResult = await this.executeToolCall(toolCall, context);

          yield {
            type: 'tool_result',
            content: toolResult,
            timestamp: new Date(),
          };

          context.messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult.result),
            toolResults: [{
              toolCallId: toolCall.id,
              content: JSON.stringify(toolResult.result),
              isError: !toolResult.success,
            }],
          });
        }
      } else {
        // No tool calls, we're done
        context.messages.push({
          role: 'assistant',
          content: fullContent,
        });
        context.response = fullContent;
        break;
      }
    }
  }

  private async executeToolCall(
    toolCall: ToolCall,
    context: OrchestratorContext
  ): Promise<ToolCallRecord> {
    const startTime = new Date();
    const toolName = toolCall.name;
    let args: Record<string, unknown>;

    try {
      const parsed = typeof toolCall.arguments === 'string'
        ? JSON.parse(toolCall.arguments)
        : toolCall.arguments;
      // Ensure parsed result is a non-null object (not array, primitive, or null)
      args = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      console.warn(`[Orchestrator] Failed to parse tool arguments for "${toolName}":`, toolCall.arguments);
      args = {};
      // Return early with error so the AI can see what went wrong
      return {
        name: toolName,
        arguments: {},
        result: `Error: Invalid JSON in tool arguments. Raw input: ${String(toolCall.arguments).slice(0, 200)}`,
        startTime,
        endTime: new Date(),
        duration: Date.now() - startTime.getTime(),
        success: false,
      };
    }

    const record: ToolCallRecord = {
      name: toolName,
      arguments: args,
      result: null,
      startTime,
      endTime: startTime,
      duration: 0,
      success: false,
    };

    try {
      // Get executor
      const executor = this.config.toolExecutors.get(toolName) ||
        this.registry?.get(toolName)?.executor;

      if (!executor) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      // Execute tool with context
      const toolContext = {
        callId: toolCall.id,
        conversationId: context.id,
        userId: context.metadata.userId as string | undefined,
        requestApproval: this.config.requestApproval,
      };
      const result = await executor(args, toolContext);
      record.result = result.content;
      record.success = !result.isError;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      record.error = errorMessage;
      record.result = { error: errorMessage };
    }

    record.endTime = new Date();
    record.duration = record.endTime.getTime() - startTime.getTime();

    context.toolCalls.push(record);
    getEventSystem().emit('agent.tool_call', `orchestrator:${context.id}`, {
      agentId: context.id,
      toolName: record.name,
      args: record.arguments,
      duration: record.duration,
      success: record.success,
      error: record.error,
    });

    if (this.config.verbose) {
      console.log(`[Tool] ${toolName}:`, args, '->', record.result);
    }

    return record;
  }
}

// ============================================================================
// AGENT BUILDER (Fluent API)
// ============================================================================

export class AgentBuilder {
  private config: Partial<AgentConfig> = {};
  private toolDefs: ToolDefinition[] = [];
  private toolExecs: Map<string, ToolExecutor> = new Map();

  /**
   * Set agent name
   */
  name(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * Set agent description
   */
  description(description: string): this {
    this.config.description = description;
    return this;
  }

  /**
   * Set system prompt
   */
  systemPrompt(prompt: string): this {
    this.config.systemPrompt = prompt;
    return this;
  }

  /**
   * Set LLM provider
   */
  provider(provider: LLMProvider): this {
    this.config.provider = provider;
    return this;
  }

  /**
   * Set model
   */
  model(model: string): this {
    this.config.model = model;
    return this;
  }

  /**
   * Add a tool
   */
  tool(definition: ToolDefinition, executor: ToolExecutor): this {
    this.toolDefs.push(definition);
    this.toolExecs.set(definition.name, executor);
    return this;
  }

  /**
   * Add multiple tools
   */
  tools(tools: Array<{ definition: ToolDefinition; executor: ToolExecutor }>): this {
    for (const tool of tools) {
      this.tool(tool.definition, tool.executor);
    }
    return this;
  }

  /**
   * Set max iterations
   */
  maxIterations(max: number): this {
    this.config.maxIterations = max;
    return this;
  }

  /**
   * Set max tokens
   */
  maxTokens(max: number): this {
    this.config.maxTokens = max;
    return this;
  }

  /**
   * Set temperature
   */
  temperature(temp: number): this {
    this.config.temperature = temp;
    return this;
  }

  /**
   * Enable verbose mode
   */
  verbose(enabled: boolean = true): this {
    this.config.verbose = enabled;
    return this;
  }

  /**
   * Build the agent
   */
  build(): AgentOrchestrator {
    if (!this.config.name) throw new Error('Agent name is required');
    if (!this.config.systemPrompt) throw new Error('System prompt is required');
    if (!this.config.provider) throw new Error('LLM provider is required');
    if (!this.config.model) throw new Error('Model is required');

    return new AgentOrchestrator({
      name: this.config.name,
      description: this.config.description,
      systemPrompt: this.config.systemPrompt,
      provider: this.config.provider,
      model: this.config.model,
      tools: this.toolDefs,
      toolExecutors: this.toolExecs,
      maxIterations: this.config.maxIterations,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      verbose: this.config.verbose,
    });
  }
}

/**
 * Create a new agent builder
 */
export function createAgent(): AgentBuilder {
  return new AgentBuilder();
}

// ============================================================================
// MULTI-AGENT ORCHESTRATOR
// ============================================================================

export interface AgentTeam {
  /** Team name */
  name: string;
  /** Team agents */
  agents: Map<string, AgentOrchestrator>;
  /** Agent routing function */
  router: (message: string, context: Record<string, unknown>) => string;
  /** Shared context */
  sharedContext: Record<string, unknown>;
}

export class MultiAgentOrchestrator {
  private teams: Map<string, AgentTeam> = new Map();
  private defaultTeam: string | null = null;

  /**
   * Register an agent team
   */
  registerTeam(team: AgentTeam): void {
    this.teams.set(team.name, team);
    if (!this.defaultTeam) {
      this.defaultTeam = team.name;
    }
  }

  /**
   * Set default team
   */
  setDefaultTeam(teamName: string): void {
    if (!this.teams.has(teamName)) {
      throw new Error(`Team not found: ${teamName}`);
    }
    this.defaultTeam = teamName;
  }

  /**
   * Route message to appropriate agent and execute
   */
  async execute(
    message: string,
    teamName?: string,
    context: Record<string, unknown> = {}
  ): Promise<OrchestratorContext> {
    const team = this.teams.get(teamName || this.defaultTeam!);
    if (!team) {
      throw new Error(`Team not found: ${teamName || this.defaultTeam}`);
    }

    // Route to agent
    const agentName = team.router(message, { ...team.sharedContext, ...context });
    const agent = team.agents.get(agentName);

    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    // Execute
    return agent.execute(message, [], { ...team.sharedContext, ...context });
  }

  /**
   * Get all teams
   */
  getTeams(): string[] {
    return Array.from(this.teams.keys());
  }

  /**
   * Get agents in a team
   */
  getAgents(teamName: string): string[] {
    const team = this.teams.get(teamName);
    return team ? Array.from(team.agents.keys()) : [];
  }
}

// ============================================================================
// PLANNING AGENT
// ============================================================================

export interface Plan {
  goal: string;
  steps: PlanStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  currentStep: number;
}

export interface PlanStep {
  id: number;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn: number[];
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  result?: unknown;
}

/**
 * Creates a planning prompt for decomposing tasks
 */
export function createPlanningPrompt(goal: string, availableTools: ToolDefinition[]): string {
  const toolList = availableTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `You are a planning agent. Your task is to decompose the following goal into a series of steps.

GOAL: ${goal}

AVAILABLE TOOLS:
${toolList}

Create a plan with numbered steps. For each step:
1. Describe what needs to be done
2. Specify which tool to use (if applicable)
3. List any dependencies on previous steps

Output the plan in JSON format:
{
  "goal": "the goal",
  "steps": [
    {
      "id": 1,
      "description": "step description",
      "toolName": "tool_name or null",
      "toolArgs": { "arg1": "value1" } or null,
      "dependsOn": []
    }
  ]
}`;
}

/**
 * Parse plan from LLM response
 */
export function parsePlan(response: string): Plan | null {
  try {
    // Find JSON in response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    interface ParsedStep {
      id?: number;
      description: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      dependsOn?: number[];
    }

    return {
      goal: parsed.goal as string,
      steps: (parsed.steps as ParsedStep[]).map((s, i: number) => ({
        id: s.id ?? i + 1,
        description: s.description,
        toolName: s.toolName,
        toolArgs: s.toolArgs,
        dependsOn: s.dependsOn ?? [],
        status: 'pending' as const,
      })),
      status: 'pending',
      currentStep: 0,
    };
  } catch {
    return null;
  }
}
