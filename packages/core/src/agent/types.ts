/**
 * Agent types for AI provider integration
 */

import type { PluginId, ToolId } from '../types/branded.js';
import type { ApiServiceConfig, ConfigEntry, ConfigFieldDefinition } from '../services/config-center.js';

/**
 * Permission mode for execution categories
 */
export type PermissionMode = 'blocked' | 'prompt' | 'allowed';

/**
 * Execution category for granular permission control
 */
export type ExecutionCategory = 'execute_javascript' | 'execute_python' | 'execute_shell' | 'compile_code' | 'package_manager';

/**
 * Per-category execution permissions (persistent in DB)
 */
export interface ExecutionPermissions {
  /** Master switch — when false, ALL execution is blocked */
  readonly enabled: boolean;
  /** Execution environment mode: 'local' | 'docker' | 'auto' */
  readonly mode: 'local' | 'docker' | 'auto';
  readonly execute_javascript: PermissionMode;
  readonly execute_python: PermissionMode;
  readonly execute_shell: PermissionMode;
  readonly compile_code: PermissionMode;
  readonly package_manager: PermissionMode;
}

/**
 * Default execution permissions — disabled and all blocked for safety
 */
export const DEFAULT_EXECUTION_PERMISSIONS: ExecutionPermissions = {
  enabled: false,
  mode: 'local',
  execute_javascript: 'blocked',
  execute_python: 'blocked',
  execute_shell: 'blocked',
  compile_code: 'blocked',
  package_manager: 'blocked',
};

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

/**
 * Where a tool originated from
 */
export type ToolSource = 'core' | 'gateway' | 'plugin' | 'custom' | 'dynamic';

/**
 * Security/trust level derived from tool source
 * - trusted: Core and gateway tools with full access
 * - semi-trusted: Plugin tools with scoped config access
 * - sandboxed: Custom/dynamic tools with sandboxed execution and scoped config access
 */
export type ToolTrustLevel = 'trusted' | 'semi-trusted' | 'sandboxed';

/**
 * Unified declaration of a Config Center service dependency.
 * Used by ALL tool sources (core, custom, plugin) to declare what
 * config they need. Auto-registered with Config Center on tool registration.
 */
export interface ToolConfigRequirement {
  /** Config Center service name (lookup key, e.g. 'openweathermap', 'smtp') */
  readonly name: string;
  /** Human-readable display name (used if service doesn't exist yet) */
  readonly displayName?: string;
  /** Description of what this service provides */
  readonly description?: string;
  /** Category for UI grouping (e.g. 'weather', 'email', 'ai') */
  readonly category?: string;
  /** Documentation/signup URL */
  readonly docsUrl?: string;
  /** Whether the service supports multiple config entries (e.g. multiple email accounts) */
  readonly multiEntry?: boolean;
  /**
   * Schema to auto-register if the service doesn't exist in Config Center.
   * If omitted, a default schema with api_key + base_url fields is assumed.
   */
  readonly configSchema?: readonly ConfigFieldDefinition[];
}

export interface ToolDefinition {
  /** Tool name (unique identifier) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Short 5-12 word summary for tool catalog (shown in system prompt) */
  readonly brief?: string;
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
  /** Hidden search tags for tool discovery via search_tools. Not sent to LLM API. */
  readonly tags?: readonly string[];
  /** Config Center services this tool depends on. Auto-registered on tool registration. */
  readonly configRequirements?: readonly ToolConfigRequirement[];
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
  /** Per-category execution permissions (persistent in DB).
   *  undefined = backward compat (non-chat contexts use default behavior). */
  readonly executionPermissions?: ExecutionPermissions;
  /** Tool source for source-aware middleware */
  readonly source?: ToolSource;
  /** Tool trust level for security decisions */
  readonly trustLevel?: ToolTrustLevel;
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
  /** Request user approval for sensitive operations (e.g. local code execution) */
  readonly requestApproval?: (
    category: string,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
  ) => Promise<boolean>;
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
  /** Where this tool originated from */
  readonly source: ToolSource;
  /** Security/trust level derived from source */
  readonly trustLevel: ToolTrustLevel;
  /** Custom tool DB ID (if source is 'custom') */
  readonly customToolId?: string;
  /** Provider name (e.g. 'memory', 'weather-plugin') */
  readonly providerName?: string;
}

/**
 * Tool Provider - groups related tools with their executors.
 * Used to register multiple tools from a domain (memory, goal, etc.)
 * in a single call via ToolRegistry.registerProvider().
 */
export interface ToolProvider {
  /** Provider name (e.g. 'memory', 'goal', 'custom-data') */
  readonly name: string;
  /** Tool source for all tools from this provider */
  readonly source?: ToolSource;
  /** Trust level for all tools from this provider */
  readonly trustLevel?: ToolTrustLevel;
  /** Plugin ID if this provider represents a plugin */
  readonly pluginId?: PluginId;

  /** Return all tool definitions with their executors. */
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutor }>;
}

/**
 * Context passed to tool middleware before/after hooks.
 */
export interface ToolMiddlewareContext {
  toolName: string;
  args: Record<string, unknown>;
  conversationId?: string;
  userId?: string;
  /** Tool source for source-aware middleware decisions */
  readonly source?: ToolSource;
  /** Tool trust level for security decisions */
  readonly trustLevel?: ToolTrustLevel;
  /** Plugin ID (if from a plugin) */
  readonly pluginId?: string;
}

/**
 * Tool Middleware - intercepts tool execution for cross-cutting concerns.
 * Applied globally or per-tool via `use()` / `useFor()`.
 */
export interface ToolMiddleware {
  /** Middleware name for debugging */
  name: string;
  /** Called before tool execution. Can modify args or abort. */
  before?(context: ToolMiddlewareContext): Promise<void>;
  /** Called after tool execution. Can transform the result. */
  after?(context: ToolMiddlewareContext, result: ToolExecutionResult): Promise<ToolExecutionResult>;
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
  /** Per-category execution permissions (persistent in DB) */
  readonly executionPermissions?: ExecutionPermissions;
  /** Callback to request user approval for sensitive operations (e.g. local code execution) */
  readonly requestApproval?: (
    category: string,
    actionType: string,
    description: string,
    params: Record<string, unknown>,
  ) => Promise<boolean>;
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
