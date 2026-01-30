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
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ProviderConfig,
  ModelConfig,
  MemoryConfig,
  AgentConfig,
  AgentState,
} from './types.js';

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
  getEnabledTools,
  getToolGroups,
  getGroupForTool,
  getToolStats,
  type ToolGroupConfig,
} from './tool-config.js';

// Tools - Extended (File System, Code Execution, Web Fetch)
export {
  // File System Tools
  FILE_SYSTEM_TOOLS,
  readFileTool,
  readFileExecutor,
  writeFileTool,
  writeFileExecutor,
  listDirectoryTool,
  listDirectoryExecutor,
  searchFilesTool,
  searchFilesExecutor,
  downloadFileTool,
  downloadFileExecutor,
  fileInfoTool,
  fileInfoExecutor,
  deleteFileTool,
  deleteFileExecutor,
  copyFileTool,
  copyFileExecutor,
  // Code Execution Tools
  CODE_EXECUTION_TOOLS,
  executeJavaScriptTool,
  executeJavaScriptExecutor,
  executePythonTool,
  executePythonExecutor,
  executeShellTool,
  executeShellExecutor,
  compileCodeTool,
  compileCodeExecutor,
  packageManagerTool,
  packageManagerExecutor,
  // Web Fetch Tools
  WEB_FETCH_TOOLS,
  httpRequestTool,
  httpRequestExecutor,
  fetchWebPageTool,
  fetchWebPageExecutor,
  searchWebTool,
  searchWebExecutor,
  jsonApiTool,
  jsonApiExecutor,
  // All Tools
  ALL_TOOLS,
  TOOL_SETS,
  TOOL_CATEGORIES,
  getToolDefinitions,
  getToolExecutors,
  registerAllTools,
  registerToolSet,
  getToolsByCategory,
  // Custom Data Tools (definitions only)
  CUSTOM_DATA_TOOLS,
  CUSTOM_DATA_TOOL_NAMES,
  // Memory Tools (definitions only)
  MEMORY_TOOLS,
  MEMORY_TOOL_NAMES,
  // Goal Tools (definitions only)
  GOAL_TOOLS,
  GOAL_TOOL_NAMES,
  // Personal Data Tools (definitions only)
  PERSONAL_DATA_TOOLS,
  PERSONAL_DATA_TOOL_NAMES,
  // Dynamic Tools (LLM-created tools)
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
  createDynamicToolRegistry,
  type DynamicToolRegistry,
  type DynamicToolDefinition,
  type DynamicToolPermission,
  // Tool search tags
  TOOL_SEARCH_TAGS,
  // Tool max limits
  TOOL_MAX_LIMITS,
  applyToolLimits,
  type ToolLimit,
} from './tools/index.js';

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
  type OrchestratorEvents,
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
  // Config loaders
  loadProviderConfigs,
  getProviderConfig,
  getAvailableProviders,
  getAllProviderConfigs,
  resolveProviderConfig,
  getConfiguredProviders,
  getModelConfig,
  findModels,
  selectBestModel,
  getCheapestModel,
  getFastestModel,
  getSmartestModel,
  clearConfigCache,
  loadCustomProviderConfig,
  getDefaultModelForProvider,
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
