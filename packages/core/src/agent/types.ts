/**
 * Agent types for AI provider integration
 */

import type { PluginId, ToolId } from '../types/branded.js';
import type { ApiServiceConfig, ConfigEntry } from '../services/config-center.js';

/**
 * Supported AI providers (Updated January 2026)
 */
export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'zhipu'
  | 'cohere'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'openrouter'
  | 'xai'
  | 'local'
  | 'custom';

/**
 * Message role in conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Content types in messages
 */
export type ContentType = 'text' | 'image' | 'audio' | 'file';

/**
 * Text content part
 */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Image content part
 */
export interface ImageContent {
  readonly type: 'image';
  /** Base64 encoded image data or URL */
  readonly data: string;
  /** Image media type */
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Whether data is a URL */
  readonly isUrl?: boolean;
}

/**
 * File content part
 */
export interface FileContent {
  readonly type: 'file';
  /** File name */
  readonly name: string;
  /** File data (base64) */
  readonly data: string;
  /** MIME type */
  readonly mimeType: string;
}

/**
 * Content part union
 */
export type ContentPart = TextContent | ImageContent | FileContent;

/**
 * Tool call request from the model
 */
export interface ToolCall {
  /** Unique ID for this tool call */
  readonly id: string;
  /** Tool name */
  readonly name: string;
  /** Tool arguments as JSON string */
  readonly arguments: string;
  /** Provider-specific metadata (e.g., thought_signature for Gemini) */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tool call result
 */
export interface ToolResult {
  /** Tool call ID this is responding to */
  readonly toolCallId: string;
  /** Result content */
  readonly content: string;
  /** Whether the tool execution failed */
  readonly isError?: boolean;
}

/**
 * Chat message
 */
export interface Message {
  /** Message role */
  readonly role: MessageRole;
  /** Message content (string or content parts) */
  readonly content: string | readonly ContentPart[];
  /** Tool calls (for assistant messages) */
  readonly toolCalls?: readonly ToolCall[];
  /** Tool results (for tool messages) */
  readonly toolResults?: readonly ToolResult[];
  /** Message metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Conversation history
 */
export interface Conversation {
  /** Conversation ID */
  readonly id: string;
  /** System prompt */
  readonly systemPrompt?: string;
  /** Messages in order */
  readonly messages: readonly Message[];
  /** Created timestamp */
  readonly createdAt: Date;
  /** Last updated timestamp */
  readonly updatedAt: Date;
  /** Conversation metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  /** Tool name (unique identifier) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** JSON Schema for parameters */
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, JSONSchemaProperty>;
    readonly required?: readonly string[];
  };
  /** Whether this tool requires confirmation */
  readonly requiresConfirmation?: boolean;
  /** Tool category for grouping */
  readonly category?: string;
}

/**
 * JSON Schema property definition
 */
export interface JSONSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: readonly (string | number)[];
  readonly items?: JSONSchemaProperty;
  readonly properties?: Record<string, JSONSchemaProperty>;
  readonly required?: readonly string[];
  readonly default?: unknown;
  readonly additionalProperties?: boolean | JSONSchemaProperty;
}

/**
 * Tool executor function
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolExecutionResult>;

/**
 * Tool execution context
 */
export interface ToolContext {
  /** Tool call ID */
  readonly callId: string;
  /** Conversation ID */
  readonly conversationId: string;
  /** User ID (if authenticated) */
  readonly userId?: string;
  /** Plugin ID (if from a plugin) */
  readonly pluginId?: PluginId;
  /** Abort signal for cancellation */
  readonly signal?: AbortSignal;
  /** Workspace directory for file operations (overrides WORKSPACE_DIR) */
  readonly workspaceDir?: string;
  /** Get API key for a named service from Config Center (returns undefined if not configured) */
  readonly getApiKey?: (serviceName: string) => string | undefined;
  /** Get full service config from Config Center (returns null if service not found) */
  readonly getServiceConfig?: (serviceName: string) => ApiServiceConfig | null;
  /** Get a config entry's data by service name and optional entry label */
  readonly getConfigEntry?: (serviceName: string, entryLabel?: string) => ConfigEntry | null;
  /** Get all config entries for a service (for multi-entry services) */
  readonly getConfigEntries?: (serviceName: string) => ConfigEntry[];
  /** Get a resolved field value from a service config entry */
  readonly getFieldValue?: (serviceName: string, fieldName: string, entryLabel?: string) => unknown;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  /** Result content (will be stringified if object) */
  readonly content: unknown;
  /** Whether execution failed */
  readonly isError?: boolean;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Registered tool with definition and executor
 */
export interface RegisteredTool {
  readonly id: ToolId;
  readonly definition: ToolDefinition;
  executor: ToolExecutor;  // Mutable to allow executor overrides
  readonly pluginId?: PluginId;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model identifier (e.g., "gpt-4o", "claude-3-5-sonnet") */
  readonly model: string;
  /** Maximum tokens in response */
  readonly maxTokens?: number;
  /** Temperature (0-2) */
  readonly temperature?: number;
  /** Top-p sampling */
  readonly topP?: number;
  /** Frequency penalty */
  readonly frequencyPenalty?: number;
  /** Presence penalty */
  readonly presencePenalty?: number;
  /** Stop sequences */
  readonly stop?: readonly string[];
  /** Response format */
  readonly responseFormat?: 'text' | 'json';
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Provider type */
  readonly provider: AIProvider;
  /** API key (should be stored securely) */
  readonly apiKey?: string;
  /** API base URL (for custom endpoints) */
  readonly baseUrl?: string;
  /** Organization ID (OpenAI) */
  readonly organization?: string;
  /** Default model configuration */
  readonly defaultModel?: ModelConfig;
  /** Request timeout in ms */
  readonly timeout?: number;
  /** Maximum retries */
  readonly maxRetries?: number;
}

/**
 * Completion request
 */
export interface CompletionRequest {
  /** Messages to send */
  readonly messages: readonly Message[];
  /** Model configuration */
  readonly model: ModelConfig;
  /** Available tools */
  readonly tools?: readonly ToolDefinition[];
  /** Tool choice behavior */
  readonly toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  /** Whether to stream the response */
  readonly stream?: boolean;
  /** User identifier for rate limiting */
  readonly user?: string;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  /** Prompt tokens */
  readonly promptTokens: number;
  /** Completion tokens */
  readonly completionTokens: number;
  /** Total tokens */
  readonly totalTokens: number;
  /** Cached tokens (if applicable) */
  readonly cachedTokens?: number;
}

/**
 * Completion response
 */
export interface CompletionResponse {
  /** Response ID */
  readonly id: string;
  /** Response content */
  readonly content: string;
  /** Tool calls (if any) */
  readonly toolCalls?: readonly ToolCall[];
  /** Finish reason */
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  /** Token usage */
  readonly usage?: TokenUsage;
  /** Model used */
  readonly model: string;
  /** Created timestamp */
  readonly createdAt: Date;
}

/**
 * Streaming chunk
 */
export interface StreamChunk {
  /** Chunk ID */
  readonly id: string;
  /** Delta content */
  readonly content?: string;
  /** Delta tool calls */
  readonly toolCalls?: readonly Partial<ToolCall>[];
  /** Whether this is the final chunk */
  readonly done: boolean;
  /** Finish reason (only in final chunk) */
  readonly finishReason?: CompletionResponse['finishReason'];
  /** Token usage (only in final chunk) */
  readonly usage?: TokenUsage;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent name */
  readonly name: string;
  /** System prompt */
  readonly systemPrompt: string;
  /** Provider configuration */
  readonly provider: ProviderConfig;
  /** Model configuration */
  readonly model: ModelConfig;
  /** Available tools */
  readonly tools?: readonly ToolId[];
  /** Maximum conversation turns */
  readonly maxTurns?: number;
  /** Maximum tool calls per turn */
  readonly maxToolCalls?: number;
  /** Memory configuration */
  readonly memory?: MemoryConfig;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  /** Maximum messages to keep in context */
  readonly maxMessages?: number;
  /** Maximum tokens in context */
  readonly maxTokens?: number;
  /** Whether to summarize old messages */
  readonly summarize?: boolean;
  /** Persistence strategy */
  readonly persistence?: 'none' | 'session' | 'persistent';
}

/**
 * Agent state
 */
export interface AgentState {
  /** Current conversation */
  readonly conversation: Conversation;
  /** Tool call count this turn */
  readonly toolCallCount: number;
  /** Total turns */
  readonly turnCount: number;
  /** Is currently processing */
  readonly isProcessing: boolean;
  /** Last error (if any) */
  readonly lastError?: string;
}
