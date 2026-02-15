/**
 * Personal Assistant Core
 *
 * Central orchestration for the AI Gateway:
 * - Conversation routing and management
 * - Plugin coordination
 * - Code generation with sandbox execution
 * - Multi-modal handling (text, images, files)
 * - Context management
 */

import type { Message, ToolDefinition, ToolCall } from '../agent/types.js';
import type { PluginRegistry, HandlerContext, HandlerResult } from '../plugins/index.js';
import type { SecureMemoryStore } from '../memory/index.js';
import type { Scheduler } from '../scheduler/index.js';
import { CodeGenerator, createCodeGenerator } from '../agent/code-generator.js';
import { getErrorMessage } from '../services/error-utils.js';
import type { CodeGenerationRequest, CodeLanguage } from '../agent/code-generator.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Assistant configuration
 */
export interface AssistantConfig {
  /** Assistant name */
  name: string;
  /** System prompt */
  systemPrompt: string;
  /** Default language */
  language: 'en' | 'auto';
  /** Personality traits */
  personality?: {
    formal?: boolean;
    humor?: boolean;
    verbose?: boolean;
  };
  /** Enabled capabilities */
  capabilities: AssistantCapability[];
  /** Maximum context tokens */
  maxContextTokens?: number;
  /** Tool execution timeout (ms) */
  toolTimeout?: number;
}

/**
 * Assistant capabilities
 */
export type AssistantCapability =
  | 'chat' // General conversation
  | 'code' // Code generation and execution
  | 'tools' // Tool usage
  | 'memory' // Long-term memory
  | 'plugins' // Plugin system
  | 'scheduler' // Scheduled tasks
  | 'multimodal' // Images, audio, files
  | 'web'; // Web browsing

/**
 * User context for personalization
 */
export interface UserContext {
  userId: string;
  preferences: {
    language: string;
    timezone: string;
    currency: string;
  };
  permissions: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Conversation context
 */
export interface ConversationContext {
  conversationId: string;
  channel: string;
  messages: Message[];
  metadata?: Record<string, unknown>;
}

/**
 * Assistant request
 */
export interface AssistantRequest {
  /** User message */
  message: string;
  /** Attached files/images */
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    data: string;
    mimeType: string;
    name?: string;
  }>;
  /** User context */
  user: UserContext;
  /** Conversation context */
  conversation: ConversationContext;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Assistant response
 */
export interface AssistantResponse {
  /** Response message */
  message: string;
  /** Tool calls made */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  /** Generated code (if any) */
  code?: {
    language: string;
    code: string;
    executionResult?: unknown;
  };
  /** Attachments to send */
  attachments?: Array<{
    type: 'image' | 'file';
    data: string;
    mimeType: string;
    name: string;
  }>;
  /** Suggestions for follow-up */
  suggestions?: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Intent classification result
 */
export interface IntentResult {
  /** Primary intent */
  intent: Intent;
  /** Confidence (0-1) */
  confidence: number;
  /** Extracted entities */
  entities: Record<string, unknown>;
  /** Suggested tools */
  suggestedTools?: string[];
  /** Should delegate to plugin */
  pluginId?: string;
}

/**
 * Possible intents
 */
export type Intent =
  | 'general_chat' // General conversation
  | 'question' // Asking a question
  | 'task' // Requesting a task
  | 'code_request' // Code generation/help
  | 'tool_use' // Explicit tool request
  | 'schedule' // Scheduling related
  | 'memory' // Remember/recall
  | 'settings' // Change settings
  | 'help' // Help request
  | 'unknown';

// =============================================================================
// Intent Classifier
// =============================================================================

/**
 * Simple rule-based intent classifier
 * NOTE: This pattern matching should be replaced by AI-based intent recognition
 * for language-independent operation. The AI should understand user intent in
 * any language and convert it to proper tool parameters.
 */
export function classifyIntent(message: string, _context: ConversationContext): IntentResult {

  // Code-related patterns
  const codePatterns = [
    /(?:generate|create|write)\s*(?:a)?\s*(?:code|script|program|function)/i,
    /(?:python|javascript|typescript|sql|html|css|java|c\+\+|rust|go)\s+code/i,
    /how\s+(?:do\s+)?(?:I|to)\s+(?:write|code|implement)/i,
    /```/,
    /\bcode\b.*\?$/i,
  ];

  for (const pattern of codePatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'code_request',
        confidence: 0.85,
        entities: extractCodeEntities(message),
      };
    }
  }

  // Scheduling patterns
  const schedulePatterns = [
    /every\s+(?:day|morning|evening|week|month)/i,
    /(?:remind|alarm|schedule)/i,
    /at\s+\d{1,2}(?::\d{2})?/i,
    /(?:tomorrow|today)\s+at/i,
  ];

  for (const pattern of schedulePatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'schedule',
        confidence: 0.80,
        entities: extractScheduleEntities(message),
        suggestedTools: ['create_scheduled_task', 'list_scheduled_tasks'],
      };
    }
  }

  // Memory patterns
  const memoryPatterns = [
    /(?:remember|save|note)/i,
    /don't\s+forget/i,
    /what\s+do\s+you\s+know/i,
    /do\s+you\s+remember/i,
  ];

  for (const pattern of memoryPatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'memory',
        confidence: 0.80,
        entities: {},
        suggestedTools: ['create_memory', 'search_memories'],
      };
    }
  }

  // Help patterns
  const helpPatterns = [
    /^(?:help|what\s+can\s+you\s+do)/i,
    /how\s+(?:do\s+I|to)\s+use/i,
    /(?:features|capabilities)/i,
  ];

  for (const pattern of helpPatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'help',
        confidence: 0.90,
        entities: {},
      };
    }
  }

  // Question patterns
  const questionPatterns = [
    /\?$/,
    /^(?:what|who|where|when|why|how|which)/i,
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'question',
        confidence: 0.70,
        entities: {},
      };
    }
  }

  // Task patterns (commands)
  const taskPatterns = [
    /^(?:do|make|create|generate|delete|send|open)/i,
    /please\s+\w+/i,
  ];

  for (const pattern of taskPatterns) {
    if (pattern.test(message)) {
      return {
        intent: 'task',
        confidence: 0.65,
        entities: {},
      };
    }
  }

  // Default: general chat
  return {
    intent: 'general_chat',
    confidence: 0.50,
    entities: {},
  };
}

/**
 * Extract code-related entities
 */
function extractCodeEntities(message: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  // Language detection
  const languages = ['python', 'javascript', 'typescript', 'java', 'c++', 'rust', 'go', 'sql', 'html', 'css'];
  for (const lang of languages) {
    if (message.toLowerCase().includes(lang)) {
      entities.language = lang;
      break;
    }
  }

  // Task type
  if (/function/.test(message.toLowerCase())) {
    entities.type = 'function';
  } else if (/class/.test(message.toLowerCase())) {
    entities.type = 'class';
  } else if (/api|endpoint/.test(message.toLowerCase())) {
    entities.type = 'api';
  }

  return entities;
}

/**
 * Extract schedule-related entities
 */
function extractScheduleEntities(message: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  // Time extraction
  const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]!, 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const period = timeMatch[3]?.toLowerCase();

    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    entities.time = { hour, minute };
  }

  // Frequency
  if (/every\s*day|daily/.test(message.toLowerCase())) {
    entities.frequency = 'daily';
  } else if (/every\s*week|weekly/.test(message.toLowerCase())) {
    entities.frequency = 'weekly';
  } else if (/every\s*month|monthly/.test(message.toLowerCase())) {
    entities.frequency = 'monthly';
  }

  return entities;
}

// =============================================================================
// Code Generator
// =============================================================================

/**
 * Code generation request
 */
export interface CodeRequest {
  /** Description of what to generate */
  description: string;
  /** Target language */
  language?: string;
  /** Code context (existing code to modify/extend) */
  context?: string;
  /** Whether to execute the code */
  execute?: boolean;
  /** Execution environment */
  environment?: 'sandbox' | 'local';
}

/**
 * Code generation result
 */
export interface CodeResult {
  /** Generated code */
  code: string;
  /** Language */
  language: string;
  /** Explanation */
  explanation: string;
  /** Execution result (if executed) */
  execution?: {
    success: boolean;
    output?: string;
    error?: string;
    duration?: number;
  };
}

/**
 * Code execution helper
 * Uses the sandbox module for safe execution
 */
export async function executeCode(
  code: string,
  language: string,
  _timeout: number = 30000
): Promise<{ success: boolean; output?: string; error?: string }> {
  // This would use the sandbox module for execution
  // For now, return placeholder
  return {
    success: false,
    error: 'Code execution requires sandbox integration',
  };
}

// =============================================================================
// Personal Assistant
// =============================================================================

/**
 * Personal Assistant - main orchestrator
 */
export class PersonalAssistant {
  private config: AssistantConfig;
  private pluginRegistry?: PluginRegistry;
  private memoryStore?: SecureMemoryStore;
  private scheduler?: Scheduler;
  private llmProvider?: LLMProvider;
  private codeGenerator: CodeGenerator;

  constructor(config: AssistantConfig) {
    this.config = config;
    this.codeGenerator = createCodeGenerator({
      defaultLanguage: 'javascript',
      autoExecute: false,
    });
  }

  /**
   * Initialize with dependencies
   */
  initialize(deps: {
    pluginRegistry?: PluginRegistry;
    memoryStore?: SecureMemoryStore;
    scheduler?: Scheduler;
    llmProvider?: LLMProvider;
  }): void {
    this.pluginRegistry = deps.pluginRegistry;
    this.memoryStore = deps.memoryStore;
    this.scheduler = deps.scheduler;
    this.llmProvider = deps.llmProvider;
  }

  /**
   * Get code generator for external use
   */
  getCodeGenerator(): CodeGenerator {
    return this.codeGenerator;
  }

  /**
   * Process a user request
   */
  async process(request: AssistantRequest): Promise<AssistantResponse> {
    const { message, attachments: _attachments, user, conversation } = request;

    // 1. Classify intent
    const intent = classifyIntent(message, conversation);

    // 2. Try plugin handlers first
    if (this.pluginRegistry) {
      const handlerContext: HandlerContext = {
        userId: user.userId,
        conversationId: conversation.conversationId,
        channel: conversation.channel,
        metadata: request.metadata,
      };

      const pluginResult = await this.pluginRegistry.routeMessage(message, handlerContext);
      if (pluginResult.handled) {
        return this.processPluginResult(pluginResult, request);
      }
    }

    // 3. Handle based on intent
    switch (intent.intent) {
      case 'code_request':
        return this.handleCodeRequest(message, intent, request);

      case 'schedule':
        return this.handleScheduleRequest(message, intent, request);

      case 'memory':
        return this.handleMemoryRequest(message, intent, request);

      case 'help':
        return this.handleHelpRequest(message, request);

      case 'question':
      case 'general_chat':
      case 'task':
      default:
        return this.handleGeneralRequest(message, intent, request);
    }
  }

  /**
   * Process plugin handler result
   */
  private async processPluginResult(
    result: HandlerResult,
    request: AssistantRequest
  ): Promise<AssistantResponse> {
    const toolResults: AssistantResponse['toolCalls'] = [];

    // Execute tool calls if any
    if (result.toolCalls && this.pluginRegistry) {
      for (const call of result.toolCalls) {
        const tool = this.pluginRegistry.getTool(call.tool);
        if (tool) {
          try {
            const toolResult = await tool.executor(call.args, {
              callId: `call_${Date.now()}`,
              conversationId: request.conversation.conversationId,
              userId: request.user.userId,
            });

            toolResults.push({
              tool: call.tool,
              args: call.args,
              result: toolResult.content,
            });
          } catch (error) {
            toolResults.push({
              tool: call.tool,
              args: call.args,
              result: { error: getErrorMessage(error) },
            });
          }
        }
      }
    }

    return {
      message: result.response ?? this.formatToolResults(toolResults),
      toolCalls: toolResults,
      metadata: result.metadata,
    };
  }

  /**
   * Handle code generation requests
   */
  private async handleCodeRequest(
    message: string,
    intent: IntentResult,
    _request: AssistantRequest
  ): Promise<AssistantResponse> {
    const language = (intent.entities.language as CodeLanguage) ?? 'javascript';

    // Try to generate code
    const codeRequest: CodeGenerationRequest = {
      prompt: message,
      language,
      execute: true, // Auto-execute if safe
    };

    const result = await this.codeGenerator.generate(codeRequest);

    if (result.success && result.code) {
      let responseMessage = `Here is your ${language} code:\n\n\`\`\`${language}\n${result.code}\n\`\`\``;

      if (result.explanation) {
        responseMessage += `\n\n**Explanation:** ${result.explanation}`;
      }

      if (result.execution) {
        if (result.execution.success) {
          responseMessage += `\n\n**Execution Result:**\n\`\`\`\n${JSON.stringify(result.execution.output, null, 2)}\n\`\`\``;
          responseMessage += `\n(${result.execution.duration}ms)`;
        } else {
          responseMessage += `\n\n**Execution Error:** ${result.execution.error}`;
        }
      }

      return {
        message: responseMessage,
        code: {
          language,
          code: result.code,
          executionResult: result.execution?.output,
        },
        suggestions: [
          'Would you like me to modify the code?',
          'Should I also write test code?',
          'Would you like this in a different language?',
        ],
        metadata: {
          intent: intent.intent,
          language,
          execution: result.execution,
        },
      };
    } else {
      return {
        message: result.error ?? 'Could not generate code. Please provide a more detailed description.',
        suggestions: [
          'What problem are you trying to solve?',
          'Can you provide example input/output?',
          'Which framework should I use?',
        ],
        metadata: {
          intent: intent.intent,
          language,
          error: result.error,
        },
      };
    }
  }

  /**
   * Handle scheduling requests
   */
  private async handleScheduleRequest(
    message: string,
    intent: IntentResult,
    _request: AssistantRequest
  ): Promise<AssistantResponse> {
    return {
      message: 'I understand your scheduling request. You can use these tools:',
      suggestions: [
        '"Tell me the weather every morning at 9" - create_scheduled_task',
        '"Show my scheduled tasks" - list_scheduled_tasks',
        '"Cancel task X" - delete_scheduled_task',
      ],
      metadata: {
        intent: intent.intent,
        entities: intent.entities,
      },
    };
  }

  /**
   * Handle memory requests
   */
  private async handleMemoryRequest(
    _message: string,
    _intent: IntentResult,
    _request: AssistantRequest
  ): Promise<AssistantResponse> {
    return {
      message: 'I understand your memory request. What would you like me to remember or recall?',
      suggestions: [
        '"Remember that my name is X"',
        '"What do you know about me?"',
        '"Remind me what we discussed yesterday"',
      ],
    };
  }

  /**
   * Handle help requests
   */
  private async handleHelpRequest(
    _message: string,
    _request: AssistantRequest
  ): Promise<AssistantResponse> {
    const capabilities = [
      '**General Chat**: Answer questions, have conversations',
      '**Finance Tracking**: Record and report expenses',
      '**Scheduling**: Create recurring tasks',
      '**Memory**: Remember and recall information',
      '**Code Generation**: Write code in various languages',
      '**File Operations**: Read/write/search files',
      '**Web**: Make HTTP requests, fetch web pages',
    ];

    return {
      message: `I'm ${this.config.name}, your personal AI assistant. Here's what I can do:\n\n${capabilities.join('\n')}`,
      suggestions: [
        'How much did I spend today?',
        'Wake me up every morning at 9',
        'Write a fibonacci function in Python',
      ],
    };
  }

  /**
   * Handle general requests (delegate to LLM)
   */
  private async handleGeneralRequest(
    message: string,
    intent: IntentResult,
    _request: AssistantRequest
  ): Promise<AssistantResponse> {
    // In production, this would call the LLM
    return {
      message: 'This request requires LLM integration. Currently operating with basic pattern matching.',
      metadata: {
        intent: intent.intent,
        confidence: intent.confidence,
      },
    };
  }

  /**
   * Format tool results for display
   */
  private formatToolResults(results: AssistantResponse['toolCalls']): string {
    if (!results || results.length === 0) return '';

    return results.map(r => {
      const resultStr = typeof r.result === 'string'
        ? r.result
        : JSON.stringify(r.result, null, 2);
      return `**${r.tool}**:\n${resultStr}`;
    }).join('\n\n');
  }

  /**
   * Get available tools
   */
  getAvailableTools(): ToolDefinition[] {
    if (!this.pluginRegistry) return [];
    return this.pluginRegistry.getAllTools().map(t => t.definition);
  }

  /**
   * Get config
   */
  getConfig(): AssistantConfig {
    return this.config;
  }
}

// =============================================================================
// LLM Provider Interface
// =============================================================================

/**
 * LLM Provider interface for assistant
 */
export interface LLMProvider {
  complete(request: {
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }>;

  stream(request: {
    messages: Message[];
    tools?: ToolDefinition[];
  }): AsyncIterable<{ content?: string; toolCalls?: ToolCall[] }>;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a personal assistant
 */
export function createAssistant(config: Partial<AssistantConfig> = {}): PersonalAssistant {
  const defaultConfig: AssistantConfig = {
    name: 'Gateway Assistant',
    systemPrompt: 'You are a helpful personal assistant.',
    language: 'auto',
    capabilities: ['chat', 'tools', 'memory', 'plugins', 'scheduler'],
    maxContextTokens: 128000,
    toolTimeout: 30000,
  };

  return new PersonalAssistant({ ...defaultConfig, ...config });
}

/**
 * Default assistant singleton
 */
let defaultAssistant: PersonalAssistant | null = null;

export function getDefaultAssistant(): PersonalAssistant {
  if (!defaultAssistant) {
    defaultAssistant = createAssistant();
  }
  return defaultAssistant;
}

// =============================================================================
// Skills & Roles System
// =============================================================================

export * from './skills.js';

// =============================================================================
// Memory Oversight
// =============================================================================

export * from './memory-oversight.js';
