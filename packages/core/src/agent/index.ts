/**
 * Agent module - AI interaction orchestration
 *
 * Provides:
 * - Multi-provider support (OpenAI, Anthropic, Zhipu, DeepSeek, Groq, Google, etc.)
 * - Tool/function calling (File System, Code Execution, Web Fetch)
 * - Conversation memory management
 * - Streaming responses
 * - Agent orchestration (planning, reasoning, multi-step execution)
 */

// Types
export type {
  Message,
  Conversation,
  ToolDefinition,
  JSONSchemaProperty,
  ToolCall,
  ToolResult,
  ToolExecutor,
  ToolContext,
  ToolExecutionResult,
  RegisteredTool,
  ToolProvider,
  ToolMiddleware,
  ToolMiddlewareContext,
  ToolSource,
  ToolTrustLevel,
  ToolConfigRequirement,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ProviderConfig,
  ModelConfig,
  MemoryConfig,
  AgentConfig,
  AgentState,
  PermissionMode,
  ExecutionCategory,
  ExecutionPermissions,
  ContentPart,
  TextContent,
  ImageContent,
  FileContent,
} from './types.js';

export { DEFAULT_EXECUTION_PERMISSIONS } from './types.js';

// Provider
export { type IProvider, BaseProvider, createProvider } from './provider.js';

// Tools - Core
export {
  ToolRegistry,
  registerCoreTools,
  createToolRegistry,
  CORE_TOOLS,
  CORE_EXECUTORS,
} from './tools.js';

// Tool Configuration
export {
  TOOL_GROUPS,
  DEFAULT_ENABLED_GROUPS,
  FAMILIAR_TOOLS,
  getEnabledTools,
  getToolGroups,
  getGroupForTool,
  getToolStats,
  type ToolGroupConfig,
} from './tool-config.js';

// Tool Validation (anti-hallucination)
export {
  validateToolCall,
  validateAgainstSchema,
  findSimilarToolNames,
  formatParamSchema,
  buildExampleValue,
  buildToolHelpText,
  formatFullToolHelp,
  validateRequiredParams,
  type ToolCallValidation,
  type ToolValidationError,
} from './tool-validation.js';

// Tool Namespace
export {
  qualifyToolName,
  getBaseName,
  getNamespace,
  isQualifiedName,
  sanitizeToolName,
  desanitizeToolName,
  UNPREFIXED_META_TOOLS,
  type ToolNamespacePrefix,
} from './tool-namespace.js';

// Tools - Aggregation arrays and utilities (individual tool defs accessed via source files)
export {
  // Tool set aggregation arrays
  FILE_SYSTEM_TOOLS,
  CODE_EXECUTION_TOOLS,
  WEB_FETCH_TOOLS,
  ALL_TOOLS,
  TOOL_SETS,
  TOOL_CATEGORIES,
  // Tool helpers
  getToolDefinitions,
  getToolExecutors,
  registerAllTools,
  registerToolSet,
  getToolsByCategory,
  // Definition-only tools (executors in gateway)
  CUSTOM_DATA_TOOLS,
  CUSTOM_DATA_TOOL_NAMES,
  MEMORY_TOOLS,
  MEMORY_TOOL_NAMES,
  GOAL_TOOLS,
  GOAL_TOOL_NAMES,
  PERSONAL_DATA_TOOLS,
  PERSONAL_DATA_TOOL_NAMES,
  // Dynamic Tools (LLM-created tools)
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
  createDynamicToolRegistry,
  type DynamicToolRegistry,
  type DynamicToolDefinition,
  type DynamicToolPermission,
  // Module resolver for pnpm strict mode
  setModuleResolver,
  tryImport,
  // Tool search tags
  TOOL_SEARCH_TAGS,
  // Tool max limits
  TOOL_MAX_LIMITS,
  applyToolLimits,
  type ToolLimit,
} from './tools/index.js';

// Middleware
export { createPluginSecurityMiddleware } from './middleware/plugin-security.js';

// Memory
export { ConversationMemory, createMemory } from './memory.js';

// Prompt Composer (Dynamic System Prompts)
export {
  PromptComposer,
  createPromptComposer,
  composeSystemPrompt,
  getTimeContext,
  type PromptContext,
  type TimeContext,
  type AgentCapabilities,
  type PromptConversationContext,
  type PromptComposerOptions,
  type WorkspaceContext,
} from './prompt-composer.js';

// Memory Injector (Context-Aware Prompts)
export {
  MemoryInjector,
  getMemoryInjector,
  injectMemoryIntoPrompt,
  createEnhancedAgentPrompt,
  type MemoryInjectionOptions,
  type InjectedPromptResult,
} from './memory-injector.js';

// Agent
export { Agent, createAgent, createSimpleAgent } from './agent.js';

// Orchestrator
export {
  AgentOrchestrator,
  AgentBuilder,
  MultiAgentOrchestrator,
  createAgent as createAgentBuilder,
  createPlanningPrompt,
  parsePlan,
  type AgentConfig as OrchestratorAgentConfig,
  type OrchestratorContext,
  type ToolCallRecord,
  type AgentStep,

  type AgentTeam,
  type Plan,
  type PlanStep,
} from './orchestrator.js';

// Provider Presets
export {
  PROVIDER_PRESETS,
  getProviderPreset,
  listProviderPresets,
  createProviderConfigFromPreset,
  getDefaultModelConfig,
  type ProviderPreset,
} from './presets.js';

// =============================================================================
// Multi-Provider Support (Config-driven)
// =============================================================================

// Provider Configurations (JSON-based)
export {
  // Config types
  type ProviderConfig as ProviderJsonConfig,
  type ModelConfig as ModelJsonConfig,
  type ResolvedProviderConfig,
  type ProviderSelectionCriteria,
  type ModelCapability,
  type ProviderFeatures,
  type ProviderType,
  // Provider IDs
  PROVIDER_IDS,
  type ProviderId,
  // Config loaders
  loadProviderConfig,
  getProviderConfig,
  getDefaultModelForProvider,
  getAvailableProviders,
  getAllProviderConfigs,
  resolveProviderConfig,
  getConfiguredProviders,
  findModels,
  selectBestModel,
  getCheapestModel,
  getFastestModel,
  getSmartestModel,
  clearConfigCache,
  // Sync functions (models.dev API)
  fetchModelsDevApi,
  syncProvider,
  syncAllProviders,
  syncProviders,
  listModelsDevProviders,
} from './providers/configs/index.js';

// OpenAI-Compatible Provider (DeepSeek, Groq, Together, Mistral, Fireworks, xAI, Perplexity)
export {
  OpenAICompatibleProvider,
  createOpenAICompatibleProvider,
  createDeepSeekProvider,
  createGroqProvider,
  createTogetherProvider,
  createFireworksProvider,
  createMistralProvider,
  createXAIProvider,
  createPerplexityProvider,
} from './providers/openai-compatible.js';

// Zhipu Provider
export {
  createZhipuProvider,
  type ZhipuProvider,
} from './providers/zhipu.js';

// Google Provider
export {
  GoogleProvider,
  createGoogleProvider,
} from './providers/google.js';

// Provider Router (smart selection)
export {
  ProviderRouter,
  createRouter,
  getDefaultRouter,
  routedComplete,
  getCheapestProvider,
  getFastestProvider,
  getSmartestProvider,
  type RouterConfig,
  type RoutingStrategy,
  type RoutingResult,
} from './providers/router.js';

// Aggregator Providers (fal.ai, together.ai, groq, fireworks, etc.)
export {
  AGGREGATOR_PROVIDERS,
  getAggregatorIds,
  getAggregatorProvider,
  getAllAggregatorProviders,
  isAggregatorProvider,
  getAggregatorModels,
  type AggregatorModel,
  type AggregatorProvider,
} from './providers/aggregators.js';

// Fallback Provider (automatic failover between providers)
export {
  FallbackProvider,
  createFallbackProvider,
  createProviderWithFallbacks,
  type FallbackProviderConfig,
} from './providers/fallback.js';

// Permission System
export {
  // Types
  type PermissionLevel,
  type ToolCategory,
  type ToolPermissionConfig,
  type UserPermissions,
  type PermissionCheckResult,
  type PermissionPolicy,
  // Constants
  DEFAULT_TOOL_PERMISSIONS,
  DEFAULT_PERMISSION_POLICY,
  // Utilities
  hasPermissionLevel,
  getHighestPermissionLevel,
  // Class
  PermissionChecker,
  // Factory functions
  createPermissionChecker,
  createRestrictiveChecker,
  createPermissiveChecker,
  // Middleware
  withPermissionCheck,
} from './permissions.js';

// Code Generation with Sandbox Execution
export {
  // Types
  type CodeLanguage,
  type CodeGenerationRequest,
  type CodeGenerationResponse,
  type CodeExecutionResult,
  type CodeSnippet,
  type CodeLLMProvider,
  type CodeGeneratorConfig,
  // Class
  CodeGenerator,
  // Factory functions
  createCodeGenerator,
  executeCodeSnippet,
} from './code-generator.js';

// Retry mechanism for AI provider calls
export {
  // Types
  type RetryConfig,
  // Functions
  withRetry,
  isRetryableError,
  createRetryWrapper,
} from './retry.js';

// Debug logging for AI interactions
export {
  // Types
  type DebugLogEntry,
  type RequestDebugInfo,
  type ResponseDebugInfo,
  type ToolCallDebugInfo,
  type ToolResultDebugInfo,
  // Functions
  debugLog,
  logRequest,
  logResponse,
  logToolCall,
  logToolResult,
  logRetry,
  logError,
  buildRequestDebugInfo,
  buildResponseDebugInfo,
  getDebugInfo,
} from './debug.js';
