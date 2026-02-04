/**
 * Agent runtime - orchestrates AI interactions
 */

import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { InternalError, ValidationError, TimeoutError } from '../types/errors.js';
import type {
  AgentConfig,
  AgentState,
  CompletionResponse,
  Message,
  Conversation,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  ModelConfig,
} from './types.js';
import { type IProvider, createProvider } from './provider.js';
import { ToolRegistry, registerCoreTools } from './tools.js';
import { ConversationMemory, createMemory } from './memory.js';

/**
 * Default agent configuration
 */
const DEFAULT_CONFIG: Partial<AgentConfig> = {
  maxTurns: 50,
  maxToolCalls: 200,  // Allow many tool calls for complex multi-step tasks
};

/**
 * Agent class - the main AI interaction orchestrator
 */
export class Agent {
  readonly name: string;
  private readonly config: AgentConfig;
  private readonly provider: IProvider;
  private readonly tools: ToolRegistry;
  private readonly memory: ConversationMemory;
  private state: AgentState;
  /** Additional tool names exposed to the LLM (for direct tool calls from picker) */
  private additionalToolNames: string[] = [];

  constructor(
    config: AgentConfig,
    options?: {
      tools?: ToolRegistry;
      memory?: ConversationMemory;
    }
  ) {
    this.name = config.name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = createProvider(config.provider);
    this.tools = options?.tools ?? new ToolRegistry();
    this.memory = options?.memory ?? createMemory(config.memory);

    // Register core tools if no custom registry provided
    if (!options?.tools) {
      registerCoreTools(this.tools);
    }

    // Initialize state with a new conversation
    const conversation = this.memory.create(config.systemPrompt);
    this.state = {
      conversation,
      toolCallCount: 0,
      turnCount: 0,
      isProcessing: false,
    };
  }

  /**
   * Check if the agent is ready to process requests
   */
  isReady(): boolean {
    return this.provider.isReady();
  }

  /**
   * Get current state
   */
  getState(): Readonly<AgentState> {
    return { ...this.state };
  }

  /**
   * Get current conversation
   */
  getConversation(): Conversation {
    return this.state.conversation;
  }

  /**
   * Get available tool definitions
   */
  getTools(): readonly ToolDefinition[] {
    if (this.config.tools?.length) {
      const names = this.config.tools.map((t) => String(t));
      // Merge additional tool names (from direct tool registration)
      if (this.additionalToolNames.length > 0) {
        const nameSet = new Set(names);
        for (const name of this.additionalToolNames) {
          if (!nameSet.has(name)) {
            names.push(name);
          }
        }
      }
      return this.tools.getDefinitionsByNames(names);
    }
    return this.tools.getDefinitions();
  }

  /**
   * Get ALL registered tool definitions (ignoring the filter).
   * Used to build a tool catalog for the first message.
   */
  getAllToolDefinitions(): readonly ToolDefinition[] {
    return this.tools.getDefinitions();
  }

  /**
   * Temporarily expose additional tools to the LLM by name.
   * Used when user selects tools from the picker for direct calling.
   * Call clearAdditionalTools() after the chat call to reset.
   */
  setAdditionalTools(toolNames: string[]): void {
    this.additionalToolNames = [...toolNames];
  }

  /**
   * Clear any temporarily added tools.
   */
  clearAdditionalTools(): void {
    this.additionalToolNames = [];
  }

  /**
   * Send a message and get a response
   */
  async chat(
    message: string,
    options?: {
      stream?: boolean;
      onChunk?: (chunk: StreamChunk) => void;
      /** Callback to approve/reject tool calls before execution */
      onBeforeToolCall?: (toolCall: ToolCall) => Promise<{ approved: boolean; reason?: string }>;
      /** Callback when a tool execution starts */
      onToolStart?: (toolCall: ToolCall) => void;
      /** Callback when a tool execution completes */
      onToolEnd?: (toolCall: ToolCall, result: { content: string; isError: boolean; durationMs: number }) => void;
      /** Callback for progress updates */
      onProgress?: (message: string, data?: Record<string, unknown>) => void;
    }
  ): Promise<Result<CompletionResponse, InternalError | ValidationError | TimeoutError>> {
    if (this.state.isProcessing) {
      return err(new ValidationError('Agent is already processing a request'));
    }

    if (!this.isReady()) {
      return err(new ValidationError('Agent provider is not configured'));
    }

    this.state = { ...this.state, isProcessing: true, lastError: undefined };

    try {
      // Add user message
      this.memory.addUserMessage(this.state.conversation.id, message);

      // Process with potential tool calls
      return await this.processConversation({
        stream: options?.stream,
        onChunk: options?.onChunk,
        onBeforeToolCall: options?.onBeforeToolCall,
        onToolStart: options?.onToolStart,
        onToolEnd: options?.onToolEnd,
        onProgress: options?.onProgress,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, lastError: errorMessage };
      return err(new InternalError(errorMessage));
    } finally {
      this.state = { ...this.state, isProcessing: false };
    }
  }

  /**
   * Process conversation with tool call loop
   */
  private async processConversation(options?: {
    stream?: boolean;
    onChunk?: (chunk: StreamChunk) => void;
    onBeforeToolCall?: (toolCall: ToolCall) => Promise<{ approved: boolean; reason?: string }>;
    onToolStart?: (toolCall: ToolCall) => void;
    onToolEnd?: (toolCall: ToolCall, result: { content: string; isError: boolean; durationMs: number }) => void;
    onProgress?: (message: string, data?: Record<string, unknown>) => void;
  }): Promise<Result<CompletionResponse, InternalError | ValidationError | TimeoutError>> {
    let turnCount = 0;
    const maxTurns = this.config.maxTurns ?? 10;
    const maxToolCalls = this.config.maxToolCalls ?? 200;

    while (turnCount < maxTurns) {
      turnCount++;
      this.state = { ...this.state, turnCount: this.state.turnCount + 1 };

      // Get context messages
      const messages = this.memory.getFullContext(this.state.conversation.id);

      // Build completion request
      const request = {
        messages,
        model: this.config.model,
        tools: this.getTools(),
        toolChoice: 'auto' as const,
        stream: options?.stream ?? false,
      };

      // Notify that we're about to call the model
      options?.onProgress?.(`Calling ${this.config.model.model || 'AI model'}...`, {
        model: this.config.model.model,
        turn: turnCount,
        messageCount: messages.length,
      });

      // Get completion
      let response: CompletionResponse;

      if (options?.stream && options.onChunk) {
        // Stream response
        const streamResult = await this.streamCompletion(request, options.onChunk);
        if (!streamResult.ok) {
          return streamResult;
        }
        response = streamResult.value;
      } else {
        // Non-streaming response
        const result = await this.provider.complete(request);
        if (!result.ok) {
          return result;
        }
        response = result.value;
      }

      // Add assistant message
      this.memory.addAssistantMessage(
        this.state.conversation.id,
        response.content,
        response.toolCalls
      );

      // Check for tool calls - execute if present regardless of finishReason
      // (Some providers like Google may return 'stop' even with tool calls)
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Check tool call limit
        if (this.state.toolCallCount + response.toolCalls.length > maxToolCalls) {
          return err(
            new ValidationError(`Tool call limit exceeded (max ${maxToolCalls})`)
          );
        }

        // Filter tool calls through approval callback if provided
        const approvedToolCalls: ToolCall[] = [];
        const rejectedResults: { toolCallId: string; content: string; isError: boolean }[] = [];

        for (const toolCall of response.toolCalls) {
          if (options?.onBeforeToolCall) {
            const approval = await options.onBeforeToolCall(toolCall);
            if (!approval.approved) {
              // Add rejection as tool result
              rejectedResults.push({
                toolCallId: toolCall.id,
                content: `Tool call rejected: ${approval.reason ?? 'Not approved by autonomy settings'}`,
                isError: true,
              });
              continue;
            }
          }
          approvedToolCalls.push(toolCall);
        }

        // Notify progress if we're about to execute tools
        if (approvedToolCalls.length > 0) {
          options?.onProgress?.(`Executing ${approvedToolCalls.length} tool(s)`, {
            tools: approvedToolCalls.map((tc) => tc.name),
          });
        }

        // Execute approved tool calls with callbacks
        const executionResults: { toolCallId: string; content: string; isError: boolean }[] = [];
        if (approvedToolCalls.length > 0) {
          // Execute in parallel but with callbacks
          const execPromises = approvedToolCalls.map(async (toolCall) => {
            const startTime = Date.now();
            options?.onToolStart?.(toolCall);

            const result = await this.tools.executeToolCall(
              toolCall,
              this.state.conversation.id
            );

            const durationMs = Date.now() - startTime;
            options?.onToolEnd?.(toolCall, {
              content: result.content,
              isError: result.isError ?? false,
              durationMs,
            });

            // Normalize isError to boolean for the local array
            return {
              toolCallId: result.toolCallId,
              content: result.content,
              isError: result.isError ?? false,
            };
          });

          const settled = await Promise.allSettled(execPromises);
          for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
              executionResults.push(outcome.value);
            } else {
              // Rejected tool call — report error back to the model
              executionResults.push({
                toolCallId: 'unknown',
                content: `Tool execution failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
                isError: true,
              });
            }
          }
        }

        // Combine results
        const results = [...rejectedResults, ...executionResults];

        // Add tool results to conversation
        this.memory.addToolResults(this.state.conversation.id, results);

        this.state = {
          ...this.state,
          toolCallCount: this.state.toolCallCount + response.toolCalls.length,
        };

        // Continue loop to get next response
        continue;
      }

      // No tool calls, return final response
      return ok(response);
    }

    return err(new ValidationError(`Maximum turns exceeded (${maxTurns})`));
  }

  /**
   * Stream completion and collect final response
   */
  private async streamCompletion(
    request: {
      messages: readonly Message[];
      model: ModelConfig;
      tools: readonly ToolDefinition[];
      toolChoice: 'auto';
      stream: boolean;
    },
    onChunk: (chunk: StreamChunk) => void
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError>> {
    let content = '';
    const toolCallsArr: ToolCall[] = [];
    let finishReason: CompletionResponse['finishReason'] = 'stop';
    let usage: CompletionResponse['usage'];
    let responseId = '';

    const generator = this.provider.stream(request);

    for await (const result of generator) {
      if (!result.ok) {
        return result;
      }

      const chunk = result.value;
      onChunk(chunk);

      if (chunk.id) responseId = chunk.id;
      if (chunk.content) content += chunk.content;
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.usage) usage = chunk.usage;

      // Accumulate tool calls
      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          if (tc.id) {
            toolCallsArr.push({
              id: tc.id,
              name: tc.name ?? '',
              arguments: tc.arguments ?? '',
              metadata: tc.metadata, // Preserve metadata (e.g., thoughtSignature for Gemini)
            });
          } else if (toolCallsArr.length > 0) {
            // Append to last tool call's arguments
            const last = toolCallsArr[toolCallsArr.length - 1];
            if (last && tc.arguments) {
              (last as { arguments: string }).arguments += tc.arguments;
            }
            // Also merge metadata if present
            if (tc.metadata && last) {
              (last as { metadata?: Record<string, unknown> }).metadata = {
                ...last.metadata,
                ...tc.metadata,
              };
            }
          }
        }
      }
    }

    return ok({
      id: responseId,
      content,
      toolCalls: toolCallsArr.length > 0 ? toolCallsArr : undefined,
      finishReason,
      usage,
      model: request.model.model,
      createdAt: new Date(),
    });
  }

  /**
   * Reset conversation
   */
  reset(): Conversation {
    const conversation = this.memory.create(this.config.systemPrompt);
    this.state = {
      conversation,
      toolCallCount: 0,
      turnCount: 0,
      isProcessing: false,
    };
    return conversation;
  }

  /**
   * Load a conversation
   */
  loadConversation(conversationId: string): boolean {
    const conversation = this.memory.get(conversationId);
    if (!conversation) return false;

    this.state = {
      ...this.state,
      conversation,
    };
    return true;
  }

  /**
   * Fork current conversation
   */
  fork(): Conversation | undefined {
    const forked = this.memory.fork(this.state.conversation.id);
    if (forked) {
      this.state = { ...this.state, conversation: forked };
    }
    return forked;
  }

  /**
   * Update system prompt
   */
  updateSystemPrompt(prompt: string): void {
    this.memory.updateSystemPrompt(this.state.conversation.id, prompt);
    const conversation = this.memory.get(this.state.conversation.id);
    if (conversation) {
      this.state = { ...this.state, conversation };
    }
  }

  /**
   * Get the tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.tools;
  }

  /**
   * Get the memory manager
   */
  getMemory(): ConversationMemory {
    return this.memory;
  }

  /**
   * Set the workspace directory for file operations
   * This overrides the default WORKSPACE_DIR environment variable
   */
  setWorkspaceDir(dir: string | undefined): void {
    this.tools.setWorkspaceDir(dir);
  }

  /**
   * Cancel any ongoing request
   */
  cancel(): void {
    if ('cancel' in this.provider && typeof this.provider.cancel === 'function') {
      this.provider.cancel();
    }
    this.state = { ...this.state, isProcessing: false };
  }
}

/**
 * Create an agent instance
 */
export function createAgent(
  config: AgentConfig,
  options?: {
    tools?: ToolRegistry;
    memory?: ConversationMemory;
  }
): Agent {
  return new Agent(config, options);
}

/**
 * Create a simple agent with minimal configuration
 */
export function createSimpleAgent(
  provider: 'openai' | 'anthropic',
  apiKey: string,
  options?: {
    name?: string;
    systemPrompt?: string;
    model?: string;
  }
): Agent {
  const config: AgentConfig = {
    name: options?.name ?? 'Assistant',
    systemPrompt:
      options?.systemPrompt ?? 'You are a helpful AI assistant.',
    provider: {
      provider,
      apiKey,
    },
    model: {
      model:
        options?.model ??
        (provider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022'),
      maxTokens: 4096,
      temperature: 0.7,
    },
  };

  return createAgent(config);
}
